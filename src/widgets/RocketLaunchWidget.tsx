import { useEffect, useRef, useState } from 'react'
import { useAnimationFrame } from '../lib/useAnimationFrame'
import { prepareCanvas, palette } from '../lib/canvas'
import { useTheme } from '../lib/theme'
import type { WidgetDefinition } from './registry'

interface RocketLaunchProps {
  twr: number // initial thrust-to-weight ratio
  stages: number // 1 | 2 | 3
}

const W = 480
const H = 420
const ROCKET_X = W * 0.5
const GROUND_Y = H - 34
const FLIGHT_TOP = 70 // rockets never rise above this screen-y
const VIS = GROUND_Y - FLIGHT_TOP // available vertical travel in px
const HALF_ALT = 1800 // altitude (m) at which the rocket is halfway up the frame
const G0 = 9.80665
const R_EARTH = 6_371_000
const PAYLOAD = 4000 // payload + final avionics, kg — keeps m>0 after all stages burn out

interface Stage {
  dry: number
  fuel: number
  fuel0: number
  isp: number
  thrust: number
}

interface Piece {
  h: number
  v: number
  side: number
  drift: number
}

interface SimState {
  stageIdx: number
  stages: Stage[]
  h: number
  v: number
  t: number
  gravityLoss: number
  dragLoss: number
  idealDv: number
  phase: 'idle' | 'burning' | 'coast' | 'apogee'
  pieces: Piece[]
  exhaust: { x: number; y: number; vy: number; life: number }[]
  apogee: number
}

function buildStages(count: number, twr: number): Stage[] {
  let list: Stage[]
  if (count === 1) {
    list = [{ dry: 14000, fuel: 90000, fuel0: 90000, isp: 300, thrust: 0 }]
  } else if (count === 2) {
    list = [
      { dry: 22000, fuel: 200000, fuel0: 200000, isp: 285, thrust: 0 },
      { dry: 13000, fuel: 28000, fuel0: 28000, isp: 345, thrust: 0 },
    ]
  } else {
    list = [
      { dry: 22000, fuel: 210000, fuel0: 210000, isp: 285, thrust: 0 },
      { dry: 6000, fuel: 30000, fuel0: 30000, isp: 335, thrust: 0 },
      { dry: 4500, fuel: 9000, fuel0: 9000, isp: 360, thrust: 0 },
    ]
  }
  for (let i = 0; i < list.length; i++) {
    let massAtIgnition = 0
    for (let j = i; j < list.length; j++) massAtIgnition += list[j].dry + list[j].fuel
    const ratio = i === 0 ? twr : 1.5
    list[i].thrust = ratio * massAtIgnition * G0
  }
  return list
}

function totalMass(stages: Stage[], from: number): number {
  let m = PAYLOAD
  for (let i = from; i < stages.length; i++) m += stages[i].dry + stages[i].fuel
  return m
}

function idealDeltaV(stages: Stage[]): number {
  let dv = 0
  for (let i = 0; i < stages.length; i++) {
    const m0 = totalMass(stages, i)
    const mf = m0 - stages[i].fuel0
    if (mf > 0 && stages[i].fuel0 > 0) dv += stages[i].isp * G0 * Math.log(m0 / mf)
  }
  return dv
}

function makeState(count: number, twr: number): SimState {
  const stages = buildStages(count, twr)
  return {
    stageIdx: 0,
    stages,
    h: 0,
    v: 0,
    t: 0,
    gravityLoss: 0,
    dragLoss: 0,
    idealDv: idealDeltaV(stages),
    phase: 'idle',
    pieces: [],
    exhaust: [],
    apogee: 0,
  }
}

// Altitude (m) → screen y of the rocket's base. Ground is fixed; the rocket
// actually travels up the screen, with a saturating (hyperbolic) mapping so it
// stays visible all the way from pad to space.
function altToY(h: number): number {
  return GROUND_Y - (VIS * h) / (h + HALF_ALT)
}
function rocketScale(h: number): number {
  // shrink gently with altitude for a sense of distance
  return 0.62 + 0.38 * (HALF_ALT / (h + HALF_ALT))
}

function step(s: SimState, dt: number) {
  if (s.phase === 'apogee') return
  const g = G0 * (R_EARTH / (R_EARTH + s.h)) ** 2
  const rho = 1.225 * Math.exp(-s.h / 8500)
  let T = 0
  if (s.phase === 'burning') {
    const cur = s.stages[s.stageIdx]
    if (cur) {
      T = cur.thrust
      const mdot = T / (cur.isp * G0)
      cur.fuel -= mdot * dt
      if (cur.fuel <= 0) {
        cur.fuel = 0
        s.pieces.push({ h: s.h, v: s.v, side: Math.random() < 0.5 ? -1 : 1, drift: 0 })
        s.stageIdx++
        if (s.stageIdx >= s.stages.length) {
          s.phase = 'coast'
          T = 0
        }
      }
    } else {
      s.phase = 'coast'
    }
  }
  const m = totalMass(s.stages, s.stageIdx)
  const drag = 0.5 * rho * s.v * s.v * 2.4 // Cd*A ≈ 2.4 m²
  const a = T / m - g - (drag / m) * (s.v > 0 ? 1 : 0)
  s.v += a * dt
  if (s.v < 0) s.v = 0
  s.h += s.v * dt
  s.t += dt
  s.gravityLoss += g * dt
  s.dragLoss += (drag / m) * dt
  if (s.h < 0) {
    s.h = 0
    s.v = 0
  }
  for (const p of s.pieces) {
    const pg = G0 * (R_EARTH / (R_EARTH + p.h)) ** 2
    p.v -= pg * dt
    p.h += p.v * dt
    p.drift += p.side * 6 * dt
  }
  s.pieces = s.pieces.filter((p) => p.h > s.h - 400000)
  if (s.h > s.apogee) s.apogee = s.h
  if (s.phase === 'coast' && s.v <= 0.1) {
    s.phase = 'apogee'
    s.v = 0
  }
}

export function RocketLaunch({ props }: { props: RocketLaunchProps }) {
  const P = palette()
  useTheme()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [, force] = useState(0)
  const [twr, setTwr] = useState(Number(props.twr))
  const [count, setCount] = useState(Number(props.stages))
  const propsRef = useRef({ twr, count })
  propsRef.current = { twr, count }
  const stateRef = useRef<SimState>(makeState(count, twr))

  useEffect(() => {
    stateRef.current = makeState(count, twr)
    force((n) => n + 1)
  }, [count, twr])

  useAnimationFrame((dt) => {
    const s = stateRef.current
    if (s.phase === 'burning' || s.phase === 'coast') {
      // sub-step for stable integration near staging
      const steps = Math.max(1, Math.ceil(dt / 0.01))
      const hdt = dt / steps
      for (let i = 0; i < steps; i++) step(s, hdt)
      if (s.phase === 'burning') {
        const ry = altToY(s.h)
        const rs = rocketScale(s.h)
        for (let k = 0; k < 3; k++) {
          s.exhaust.push({
            x: ROCKET_X + (Math.random() - 0.5) * 10 * rs,
            y: ry + 4 * rs,
            vy: 120 + Math.random() * 160,
            life: 0.5 + Math.random() * 0.4,
          })
        }
      }
      for (const e of s.exhaust) {
        e.y += e.vy * dt
        e.life -= dt
      }
      s.exhaust = s.exhaust.filter((e) => e.life > 0 && e.y < H + 20)
      force((n) => (n + 1) % 1_000_000)
    }
  })

  const launch = () => {
    const s = stateRef.current
    if (s.phase !== 'idle') return
    s.phase = 'burning'
    force((n) => n + 1)
  }
  const reset = () => {
    stateRef.current = makeState(propsRef.current.count, propsRef.current.twr)
    force((n) => n + 1)
  }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = prepareCanvas(canvas, W, H)
    if (!ctx) return
    ctx.clearRect(0, 0, W, H)
    const s = stateRef.current

    // sky → space with altitude
    const atm = Math.exp(-s.h / 9000)
    const topCol = mix(P.bg, '#05070d', 1 - atm)
    const botCol = mix(P.bg2, '#0b1020', 1 - atm * 0.6)
    const sky = ctx.createLinearGradient(0, 0, 0, H)
    sky.addColorStop(0, topCol)
    sky.addColorStop(1, botCol)
    ctx.fillStyle = sky
    ctx.fillRect(0, 0, W, H)

    if (atm < 0.6) drawStars(ctx, 1 - atm / 0.6)

    // distant clouds in the lower atmosphere (parallax, fade out high up)
    if (atm > 0.35) drawClouds(ctx, s.h, atm)

    // ground (fixed)
    ctx.fillStyle = mix('#3a2a1a', P.bg2, 0.25)
    ctx.fillRect(0, GROUND_Y, W, H - GROUND_Y)
    ctx.strokeStyle = P.axis
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(0, GROUND_Y)
    ctx.lineTo(W, GROUND_Y)
    ctx.stroke()
    // launch pad
    ctx.fillStyle = P.muted
    ctx.fillRect(ROCKET_X - 26, GROUND_Y - 2, 52, 5)
    ctx.fillRect(ROCKET_X - 20, GROUND_Y - 14, 4, 12)
    ctx.fillRect(ROCKET_X + 16, GROUND_Y - 14, 4, 12)

    drawAltitudeTape(ctx, P, s.h)

    // separated pieces — they fall back toward the fixed ground
    for (const p of s.pieces) {
      const sy = altToY(Math.max(0, p.h))
      const ps = rocketScale(Math.max(0, p.h))
      if (sy > -40 && sy < H + 40) {
        ctx.save()
        ctx.translate(ROCKET_X + p.drift + p.side * 22, sy)
        ctx.rotate(p.side * 0.7)
        ctx.scale(ps, ps)
        drawBooster(ctx, P, 26, false)
        ctx.restore()
      }
    }

    // exhaust (behind rocket)
    for (const e of s.exhaust) {
      ctx.globalAlpha = Math.max(0, e.life)
      ctx.fillStyle = P.warn
      ctx.beginPath()
      ctx.arc(e.x, e.y, 3 + e.life * 4, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.globalAlpha = 1

    // the rocket itself, rising up the screen
    const ry = altToY(s.h)
    const rs = rocketScale(s.h)
    ctx.save()
    ctx.translate(ROCKET_X, ry)
    ctx.scale(rs, rs)
    drawRocket(ctx, P, rocketHeight(s), s.phase === 'burning')
    ctx.restore()

    drawTelemetry(ctx, P, s)

    if (s.phase === 'idle') {
      ctx.fillStyle = P.faint
      ctx.font = '12px ui-sans-serif, system-ui'
      ctx.fillText('点「发射」观察分级与速度累积', 14, H - 44)
    }
    if (s.phase === 'apogee') {
      ctx.fillStyle = P.accent
      ctx.font = '600 12px ui-monospace, monospace'
      ctx.fillText(`关机点后到达远地点 ${(s.apogee / 1000).toFixed(1)} km`, 14, H - 44)
    }
  })

  const s = stateRef.current
  const cur = s.stages[s.stageIdx]
  const mass = totalMass(s.stages, s.stageIdx)
  const twrNow = s.phase === 'burning' && cur ? cur.thrust / (mass * G0) : 0

  return (
    <div className="lb-surface">
      <canvas
        ref={canvasRef}
        style={{ width: '100%', aspectRatio: `${W} / ${H}`, touchAction: 'none' }}
        className="touch-none"
      />
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="高度" value={`${(s.h / 1000).toFixed(2)} km`} P={P} />
        <Stat label="速度" value={`${s.v.toFixed(0)} m/s`} P={P} />
        <Stat label="当前 TWR" value={s.phase === 'burning' ? twrNow.toFixed(2) : '—'} P={P} />
        <Stat label="级数" value={`${count}`} P={P} />
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2">
        <Stat label="理想 Δv" value={`${s.idealDv.toFixed(0)} m/s`} P={P} small />
        <Stat label="重力损耗" value={`${s.gravityLoss.toFixed(0)} m/s`} P={P} small />
        <Stat label="阻力损耗" value={`${s.dragLoss.toFixed(0)} m/s`} P={P} small />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <label className="t-muted flex items-center gap-2 text-xs">
          <span className="w-14 shrink-0">起飞 TWR</span>
          <input type="range" min={1.15} max={2.2} step={0.05} value={twr} onChange={(e) => setTwr(Number(e.target.value))} className="w-32" />
          <span className="t-strong w-10 text-right font-mono tabular-nums">{twr.toFixed(2)}</span>
        </label>
        <div className="t-panel inline-flex rounded-lg p-0.5">
          {[1, 2, 3].map((n) => (
            <button
              key={n}
              onClick={() => setCount(n)}
              className={`rounded-[6px] px-3 py-1 text-xs font-medium transition-colors ${count === n ? 't-btn-primary' : 't-muted'}`}
            >
              {n} 级
            </button>
          ))}
        </div>
        <div className="ml-auto flex gap-2">
          <button onClick={reset} className="t-btn rounded-full px-4 py-1.5 text-xs">↺ 重置</button>
          <button onClick={launch} disabled={s.phase !== 'idle'} className="t-btn-primary rounded-full px-5 py-1.5 text-xs disabled:opacity-40">
            🚀 发射
          </button>
        </div>
      </div>
    </div>
  )
}

function rocketHeight(s: SimState): number {
  return 16 + s.stages.slice(s.stageIdx).length * 22
}

function drawClouds(ctx: CanvasRenderingContext2D, h: number, atm: number) {
  ctx.save()
  ctx.globalAlpha = (atm - 0.35) / 0.65
  ctx.fillStyle = 'rgba(255,255,255,0.55)'
  // parallax: clouds scroll down as the rocket climbs
  const off = (h * 0.15) % 120
  for (let i = 0; i < 5; i++) {
    const cx = ((i * 137) % W)
    const cy = GROUND_Y - 40 - i * 70 + off
    if (cy < FLIGHT_TOP - 20 || cy > GROUND_Y) continue
    ctx.beginPath()
    ctx.ellipse(cx, cy, 34, 9, 0, 0, Math.PI * 2)
    ctx.ellipse(cx + 22, cy + 2, 22, 7, 0, 0, Math.PI * 2)
    ctx.ellipse(cx - 20, cy + 3, 20, 6, 0, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
}

function drawRocket(
  ctx: CanvasRenderingContext2D,
  P: ReturnType<typeof palette>,
  hgt: number,
  burning: boolean,
) {
  const w = 18
  const ENG = 8 // engine bell height
  const top = -hgt
  // flame (drawn first, below the engine)
  if (burning) {
    const fl = 26 + Math.random() * 16
    const grad = ctx.createLinearGradient(0, 0, 0, fl)
    grad.addColorStop(0, P.warn)
    grad.addColorStop(0.5, mix(P.warn, P.danger, 0.5))
    grad.addColorStop(1, 'rgba(255,180,0,0)')
    ctx.fillStyle = grad
    ctx.beginPath()
    ctx.moveTo(-w * 0.35, 0)
    ctx.lineTo(w * 0.35, 0)
    ctx.lineTo((Math.random() - 0.5) * 4, fl)
    ctx.closePath()
    ctx.fill()
  }
  // fins (bottom of body, above the engine rim at y=0)
  ctx.fillStyle = P.muted
  ctx.beginPath()
  ctx.moveTo(-w / 2, -ENG)
  ctx.lineTo(-w / 2 - 8, 0)
  ctx.lineTo(-w / 2, 0)
  ctx.closePath()
  ctx.fill()
  ctx.beginPath()
  ctx.moveTo(w / 2, -ENG)
  ctx.lineTo(w / 2 + 8, 0)
  ctx.lineTo(w / 2, 0)
  ctx.closePath()
  ctx.fill()
  // body — runs from the nose down to the engine with no gap
  const bodyGrad = ctx.createLinearGradient(-w / 2, 0, w / 2, 0)
  bodyGrad.addColorStop(0, '#cfd5de')
  bodyGrad.addColorStop(0.5, '#ffffff')
  bodyGrad.addColorStop(1, '#aab2c0')
  ctx.fillStyle = bodyGrad
  ctx.strokeStyle = P.muted
  ctx.lineWidth = 1
  roundRectPath(ctx, -w / 2, top, w, hgt - ENG, 6)
  ctx.fill()
  ctx.stroke()
  // stage band
  ctx.strokeStyle = P.grid
  ctx.beginPath()
  ctx.moveTo(-w / 2, top + 34)
  ctx.lineTo(w / 2, top + 34)
  ctx.stroke()
  // nose cone
  ctx.fillStyle = P.accent
  ctx.beginPath()
  ctx.moveTo(-w / 2, top + 6)
  ctx.lineTo(0, top - 2)
  ctx.lineTo(w / 2, top + 6)
  ctx.closePath()
  ctx.fill()
  // window
  ctx.fillStyle = P.bg
  ctx.beginPath()
  ctx.arc(0, top + 16, 3.2, 0, Math.PI * 2)
  ctx.fill()
  // engine bell — body bottom (-ENG) down to rim (0)
  ctx.fillStyle = P.text
  ctx.beginPath()
  ctx.moveTo(-5, -ENG)
  ctx.lineTo(-7, 0)
  ctx.lineTo(7, 0)
  ctx.lineTo(5, -ENG)
  ctx.closePath()
  ctx.fill()
}

function drawBooster(ctx: CanvasRenderingContext2D, P: ReturnType<typeof palette>, hgt: number, burning: boolean) {
  const w = 16
  ctx.fillStyle = '#c2c8d2'
  ctx.strokeStyle = P.muted
  roundRectPath(ctx, -w / 2, -hgt / 2, w, hgt, 5)
  ctx.fill()
  ctx.stroke()
  if (burning) {
    ctx.fillStyle = P.warn
    ctx.beginPath()
    ctx.moveTo(-4, hgt / 2)
    ctx.lineTo(4, hgt / 2)
    ctx.lineTo(0, hgt / 2 + 12)
    ctx.closePath()
    ctx.fill()
  }
}

function drawStars(ctx: CanvasRenderingContext2D, alpha: number) {
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.fillStyle = '#ffffff'
  for (let i = 0; i < 60; i++) {
    const x = (i * 97) % W
    const y = (i * 53) % (H - 60)
    ctx.fillRect(x, y, 1, 1)
  }
  ctx.restore()
}

function drawAltitudeTape(ctx: CanvasRenderingContext2D, P: ReturnType<typeof palette>, h: number) {
  const x = W - 50
  const top = 12
  const barH = H - 24
  ctx.fillStyle = P.bg2
  ctx.globalAlpha = 0.7
  ctx.fillRect(x, top, 38, barH)
  ctx.globalAlpha = 1
  ctx.strokeStyle = P.grid
  ctx.strokeRect(x, top, 38, barH)
  ctx.fillStyle = P.faint
  ctx.font = '9px ui-monospace, monospace'
  for (let k = 0; k <= 100; k += 20) {
    const yy = top + barH - (k / 100) * barH
    ctx.strokeStyle = P.grid
    ctx.beginPath()
    ctx.moveTo(x, yy)
    ctx.lineTo(x + 5, yy)
    ctx.stroke()
    ctx.fillText(`${k}`, x + 7, yy + 3)
  }
  const frac = Math.min(1, h / 100000)
  const my = top + barH - frac * barH
  ctx.strokeStyle = P.accent
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(x, my)
  ctx.lineTo(x + 38, my)
  ctx.stroke()
  ctx.lineWidth = 1
  ctx.fillStyle = P.accent
  ctx.font = '600 9px ui-monospace, monospace'
  ctx.fillText(`${(h / 1000).toFixed(0)} km`, x + 4, my - 4)
}

function drawTelemetry(ctx: CanvasRenderingContext2D, P: ReturnType<typeof palette>, s: SimState) {
  ctx.fillStyle = P.text
  ctx.font = '11px ui-monospace, monospace'
  const mass = totalMass(s.stages, s.stageIdx)
  ctx.fillText(`质量 ${(mass / 1000).toFixed(1)} t`, 12, 22)
  ctx.fillStyle = P.muted
  ctx.fillText(`阶段 ${s.stageIdx + 1}/${s.stages.length}   t=${s.t.toFixed(1)}s`, 12, 38)
  if (s.phase === 'idle') {
    ctx.fillStyle = P.faint
    ctx.font = '11px ui-sans-serif, system-ui'
    ctx.fillText('垂直起飞演示；真实入轨还需重力转弯获得水平速度', 12, 56)
  }
}

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

function mix(a: string, b: string, t: number): string {
  const A = hexRgb(a)
  const B = hexRgb(b)
  if (!A || !B) return a
  return `rgb(${A.map((x, i) => Math.round(x + (B[i] - x) * t)).join(',')})`
}
function hexRgb(hex: string): [number, number, number] | null {
  if (!hex.startsWith('#')) return null
  const h = hex.replace('#', '')
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

function Stat({ label, value, P, small }: { label: string; value: string; P: ReturnType<typeof palette>; small?: boolean }) {
  return (
    <div className="t-panel rounded-lg px-3 py-2">
      <div className="t-faint text-[10px] uppercase tracking-wider">{label}</div>
      <div className="mt-0.5 font-mono tabular-nums" style={{ color: P.text, fontSize: small ? 14 : 16, fontWeight: 600 }}>
        {value}
      </div>
    </div>
  )
}

export const RocketLaunchWidget: WidgetDefinition<RocketLaunchProps> = {
  type: 'rocket-launch',
  label: '火箭发射与分级',
  description: '真实积分推力/重力/阻力与燃料消耗，观察分级、Δv、重力损耗与阻力损耗。',
  icon: '🚀',
  defaultProps: {
    twr: 1.5,
    stages: 2,
  },
  configSchema: [
    { key: 'twr', label: '起飞推重比', type: 'range', min: 1.15, max: 2.2, step: 0.05 },
    {
      key: 'stages',
      label: '级数',
      type: 'select',
      options: [
        { value: '1', label: '单级' },
        { value: '2', label: '二级' },
        { value: '3', label: '三级' },
      ],
    },
  ],
  Component: RocketLaunch,
}
