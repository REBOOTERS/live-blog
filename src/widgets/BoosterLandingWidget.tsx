import { useEffect, useRef, useState } from 'react'
import { useAnimationFrame } from '../lib/useAnimationFrame'
import { prepareCanvas, palette } from '../lib/canvas'
import { useTheme } from '../lib/theme'
import type { WidgetDefinition } from './registry'

interface BoosterLandingProps {
  auto: boolean
}

const W = 440
const H = 420
const PAD_Y = H - 36
const TOP_Y = 56
// Post-entry-burn envelope: the real Falcon 9 scrubs off the hypersonic
// descent with a 3-engine entry burn higher up; a single centre engine then
// performs the landing burn from ~95 m/s at ~2 km. Starting faster/lower is
// physically unrecoverable (full thrust can't stop in time).
const START_H = 2000
const SCALE = (PAD_Y - TOP_Y) / START_H // px per meter

const DRY = 25000 // kg
const FUEL0 = 3500 // kg
const T_MAX = 900_000 // N (single engine landing burn)
const MIN_THROTTLE = 0.4
const ISP = 290 // s
const CD_A = 8 // effective drag area with grid fins, m²
const G = 9.8
const START_V = 95 // m/s downward
const SUB_DT = 0.005 // 200 Hz integration — keeps the landing burn stable

type Phase = 'falling' | 'burning' | 'landed' | 'crashed'

interface SimState {
  h: number
  v: number // downward +
  fuel: number
  phase: Phase
  t: number
  message: string
  throttleShow: number
}

function makeState(): SimState {
  return { h: START_H, v: START_V, fuel: FUEL0, phase: 'falling', t: 0, message: '', throttleShow: 0 }
}

// Distance (m) needed to reach v≈0 from the current state at constant full
// throttle. Returns Infinity if the booster would hit the ground before
// stopping (i.e. ignition right now is already too late).
function brakingDistance(h0: number, v0: number, fuel0: number): number {
  let h = h0
  let v = v0
  let fuel = fuel0
  let m = DRY + fuel
  let dist = 0
  for (let i = 0; i < 60000; i++) {
    if (v <= 0.1) return dist
    if (h <= 0) return Infinity
    const rho = 1.225 * Math.exp(-h / 8500)
    const drag = 0.5 * rho * v * v * CD_A
    const T = T_MAX
    const a = G - drag / m - T / m
    v += a * SUB_DT
    if (v < 0) v = 0
    h -= v * SUB_DT
    fuel -= (T / (ISP * G)) * SUB_DT
    if (fuel < 0) fuel = 0
    m = DRY + fuel
    dist += v * SUB_DT
  }
  return Infinity
}

// Suicide-burn guidance: pick thrust so the booster reaches v=0 exactly at
// h=0, i.e. net upward acceleration a_up = v²/(2h). If the required thrust is
// below the engine's minimum throttle, shut the engine off entirely — min
// throttle still exceeds weight near touchdown, so clamping to the minimum
// would stop the rocket a few metres up and push it back into the air.
function autoThrottle(s: SimState): number {
  if (s.v <= 0.3) return 0 // not descending — let gravity pull it back
  const h = Math.max(s.h, 0.3)
  const aUp = (s.v * s.v) / (2 * h)
  const m = DRY + s.fuel
  const thr = (m * (G + aUp)) / T_MAX
  if (thr < MIN_THROTTLE) return 0
  return Math.min(1, thr)
}

export function BoosterLanding({ props }: { props: BoosterLandingProps }) {
  const P = palette()
  useTheme()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [, force] = useState(0)

  const [auto, setAuto] = useState(!!props.auto)
  const stateRef = useRef<SimState>(makeState())
  const autoRef = useRef(auto)
  useEffect(() => {
    autoRef.current = auto
  }, [auto])
  useEffect(() => setAuto(!!props.auto), [props.auto])

  const ignite = () => {
    const s = stateRef.current
    if (s.phase === 'falling') {
      s.phase = 'burning'
      force((n) => n + 1)
    }
  }
  const reset = () => {
    stateRef.current = makeState()
    force((n) => n + 1)
  }

  useAnimationFrame((dt) => {
    const s = stateRef.current
    if (s.phase === 'landed' || s.phase === 'crashed') return

    // auto guidance: ignite at the last possible moment (hover-slam)
    if (autoRef.current && s.phase === 'falling') {
      const d = brakingDistance(s.h, s.v, s.fuel)
      if (s.h <= d + 2) s.phase = 'burning'
    }

    const steps = Math.max(1, Math.ceil(dt / SUB_DT))
    const hdt = dt / steps
    let curThrottle = 0
    for (let i = 0; i < steps; i++) {
      // Manual mode only chooses WHEN to ignite; the throttle profile itself
      // is flown by the same suicide-burn guidance — a fixed human throttle
      // can't soft-land because the engine's minimum thrust still exceeds
      // weight near touchdown (it would stop mid-air and rebound upward).
      const thr = s.phase === 'burning' ? autoThrottle(s) : 0
      curThrottle = thr
      const rho = 1.225 * Math.exp(-s.h / 8500)
      const drag = 0.5 * rho * s.v * s.v * CD_A * (s.v > 0 ? 1 : 0)
      const T = thr * T_MAX
      const m = DRY + s.fuel
      const a = G - drag / m - T / m
      s.v += a * hdt
      s.h -= s.v * hdt
      s.t += hdt
      if (s.phase === 'burning') {
        s.fuel -= (T / (ISP * G)) * hdt
        if (s.fuel <= 0) {
          s.fuel = 0
          s.phase = 'falling'
          s.message = '推进剂耗尽'
        }
      }
      if (s.h <= 0) {
        s.h = 0
        // touchdown speed = current downward speed (v>0 means still descending)
        if (s.v < 3.0) {
          s.phase = 'landed'
          s.v = 0
          s.message = '软着陆成功'
        } else {
          s.phase = 'crashed'
          s.message = `坠毁（触地速度 ${s.v.toFixed(0)} m/s）`
        }
        break
      }
    }
    s.throttleShow = curThrottle
    force((n) => (n + 1) % 1_000_000)
  })

  const s = stateRef.current
  const m = DRY + s.fuel
  const tW = s.phase === 'burning' ? (s.throttleShow * T_MAX) / (m * G) : 0
  const dStop = s.phase === 'falling' ? brakingDistance(s.h, s.v, s.fuel) : Infinity
  const canRecover = isFinite(dStop)
  const running = s.phase === 'falling' || s.phase === 'burning'

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = prepareCanvas(canvas, W, H)
    if (!ctx) return
    ctx.clearRect(0, 0, W, H)

    const sky = ctx.createLinearGradient(0, 0, 0, H)
    sky.addColorStop(0, P.bg)
    sky.addColorStop(1, P.bg2)
    ctx.fillStyle = sky
    ctx.fillRect(0, 0, W, H)

    const boosterX = W * 0.5
    const boosterY = Math.max(TOP_Y, Math.min(PAD_Y, PAD_Y - s.h * SCALE))
    const markerY = PAD_Y - dStop * SCALE

    // braking point marker
    if (s.phase === 'falling' && canRecover && dStop < s.h) {
      ctx.strokeStyle = P.warn
      ctx.setLineDash([6, 5])
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.moveTo(40, markerY)
      ctx.lineTo(W - 40, markerY)
      ctx.stroke()
      ctx.setLineDash([])
      ctx.fillStyle = P.warn
      ctx.font = '10px ui-monospace, monospace'
      ctx.fillText(`最晚点火点 ≈ ${dStop.toFixed(0)} m`, 44, markerY - 5)
    }

    // altitude scale (left)
    ctx.strokeStyle = P.grid
    ctx.fillStyle = P.faint
    ctx.font = '9px ui-monospace, monospace'
    for (let km = 0; km * 1000 <= START_H; km += 0.5) {
      const yy = PAD_Y - km * 1000 * SCALE
      ctx.beginPath()
      ctx.moveTo(28, yy)
      ctx.lineTo(34, yy)
      ctx.stroke()
      if (km % 1 === 0) ctx.fillText(`${km}k`, 6, yy + 3)
    }

    // ground + pad
    ctx.fillStyle = mix(P.bg2, '#000000', 0.25)
    ctx.fillRect(0, PAD_Y, W, H - PAD_Y)
    ctx.strokeStyle = P.axis
    ctx.beginPath()
    ctx.moveTo(0, PAD_Y)
    ctx.lineTo(W, PAD_Y)
    ctx.stroke()
    ctx.strokeStyle = P.accent
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.ellipse(boosterX, PAD_Y + 6, 26, 7, 0, 0, Math.PI * 2)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(boosterX - 16, PAD_Y + 6)
    ctx.lineTo(boosterX + 16, PAD_Y + 6)
    ctx.stroke()
    ctx.lineWidth = 1

    // velocity arrow (downward)
    if (running && s.v > 1) {
      const len = Math.min(70, s.v * 0.35)
      ctx.strokeStyle = P.danger
      ctx.fillStyle = P.danger
      ctx.lineWidth = 2.5
      ctx.beginPath()
      ctx.moveTo(boosterX - 60, boosterY)
      ctx.lineTo(boosterX - 60, boosterY + len)
      ctx.stroke()
      arrowHead(ctx, boosterX - 60, boosterY + len, Math.PI / 2)
      ctx.font = '10px ui-monospace, monospace'
      ctx.fillText(`${s.v.toFixed(0)}`, boosterX - 86, boosterY + len + 4)
      ctx.lineWidth = 1
    }
    // thrust arrow (upward)
    if (s.phase === 'burning') {
      const len = Math.min(80, tW * 22)
      ctx.strokeStyle = P.good
      ctx.fillStyle = P.good
      ctx.lineWidth = 2.5
      ctx.beginPath()
      ctx.moveTo(boosterX + 60, boosterY)
      ctx.lineTo(boosterX + 60, boosterY - len)
      ctx.stroke()
      arrowHead(ctx, boosterX + 60, boosterY - len, -Math.PI / 2)
      ctx.font = '10px ui-monospace, monospace'
      ctx.fillText(`T/W ${tW.toFixed(1)}`, boosterX + 66, boosterY - len + 4)
      ctx.lineWidth = 1
    }

    drawBooster(ctx, P, boosterX, boosterY, s.phase, s.phase === 'burning' ? s.throttleShow : 0, s.h < 200 && s.phase === 'burning')

    ctx.fillStyle = P.text
    ctx.font = '11px ui-monospace, monospace'
    ctx.fillText(`高度 ${s.h.toFixed(0)} m`, 12, 22)
    ctx.fillText(`下降速度 ${Math.max(0, s.v).toFixed(1)} m/s`, 12, 38)
    ctx.fillStyle = P.muted
    const fuelPct = (s.fuel / FUEL0) * 100
    ctx.fillText(`推进剂 ${fuelPct.toFixed(0)}%   最小油门推重比 ${((MIN_THROTTLE * T_MAX) / (m * G)).toFixed(2)}`, 12, 54)

    ctx.font = '600 11px ui-sans-serif, system-ui'
    const phaseLabel =
      s.phase === 'falling' ? '气动下降 · 栅格舵制导' : s.phase === 'burning' ? '着陆反推点火' : s.phase === 'landed' ? '✅ 软着陆' : '💥 坠毁'
    ctx.fillStyle = s.phase === 'crashed' ? P.danger : s.phase === 'landed' ? P.good : P.accent
    ctx.fillText(phaseLabel, W - 150, 22)

    if (s.message) {
      ctx.fillStyle = s.phase === 'crashed' ? P.danger : P.muted
      ctx.font = '11px ui-monospace, monospace'
      ctx.fillText(s.message, W - 150, 40)
    }

    const minTwr = (MIN_THROTTLE * T_MAX) / (m * G)
    if (minTwr > 1 && s.phase !== 'landed' && s.phase !== 'crashed') {
      ctx.fillStyle = P.warn
      ctx.font = '10px ui-sans-serif, system-ui'
      ctx.fillText('⚠ 最小油门推力 > 重力：无法悬停，必须 hover-slam', 12, H - 26)
    }
    if (s.phase === 'falling' && !canRecover) {
      ctx.fillStyle = P.danger
      ctx.font = '600 10px ui-sans-serif, system-ui'
      ctx.fillText('⚠ 满推力也无法在触地前停下——现在点火已来不及', 12, H - 10)
    }
  })

  return (
    <div className="lb-surface">
      <canvas
        ref={canvasRef}
        style={{ width: '100%', aspectRatio: `${W} / ${H}`, touchAction: 'none' }}
        className="touch-none"
      />
      <div className="mt-3 grid grid-cols-3 gap-2">
        <Stat label="高度" value={`${s.h.toFixed(0)} m`} P={P} />
        <Stat label="下降速度" value={`${Math.max(0, s.v).toFixed(1)} m/s`} P={P} danger={s.phase === 'crashed'} />
        <Stat label="制动距离" value={s.phase === 'falling' ? (canRecover ? `${dStop.toFixed(0)} m` : '来不及了') : '—'} P={P} danger={s.phase === 'falling' && !canRecover} />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <div className="t-panel inline-flex rounded-lg p-0.5">
          <button
            onClick={() => setAuto(false)}
            className={`rounded-[6px] px-3 py-1 text-xs font-medium transition-colors ${!auto ? 't-btn-primary' : 't-muted'}`}
          >
            手动点火
          </button>
          <button
            onClick={() => setAuto(true)}
            className={`rounded-[6px] px-3 py-1 text-xs font-medium transition-colors ${auto ? 't-btn-primary' : 't-muted'}`}
          >
            自动制导
          </button>
        </div>

        {!auto && (
          <span className="t-faint text-[11px]">盯着黄色虚线，在助推器落到最晚点火点前点「着陆点火」</span>
        )}

        <div className="ml-auto flex gap-2">
          <button onClick={reset} className="t-btn rounded-full px-4 py-1.5 text-xs">↺ 重置</button>
          {!auto && (
            <button
              onClick={ignite}
              disabled={s.phase !== 'falling'}
              className="t-btn-primary rounded-full px-5 py-1.5 text-xs disabled:opacity-40"
            >
              🔥 着陆点火
            </button>
          )}
        </div>
      </div>
      <p className="t-faint mt-2 text-[11px] leading-relaxed">
        黄色虚线是飞控实时积分算出的<strong className="t-muted">最晚点火高度</strong>。手动模式下由你决定何时点火（这是唯一的操作），
        点火后的油门由制导律自动收放——因为发动机最小油门推重比仍大于 1，人手固定一个油门根本无法软着陆，
        点早了费油、点晚了坠毁。切到「自动制导」看飞控如何卡在最后一刻点火。
      </p>
    </div>
  )
}

function drawBooster(
  ctx: CanvasRenderingContext2D,
  P: ReturnType<typeof palette>,
  x: number,
  y: number,
  phase: Phase,
  throttleAmt: number,
  legsOut: boolean,
) {
  // Local coordinate system: (0,0) is the touchdown point (nozzle rim / feet),
  // the body extends upward into negative y. At landing y===PAD_Y and nothing is
  // drawn below y=0, so the rocket can't sink through the pad.
  const w = 20
  const HGT = 78
  const NOZ = 10 // nozzle height
  const top = -HGT
  ctx.save()
  ctx.translate(x, y)

  // grid fins near the top (interstage)
  ctx.fillStyle = P.muted
  for (const sx of [-1, 1]) {
    ctx.beginPath()
    ctx.moveTo(sx * (w / 2 - 1), top + 8)
    ctx.lineTo(sx * (w / 2 + 9), top + 2)
    ctx.lineTo(sx * (w / 2 + 9), top + 16)
    ctx.lineTo(sx * (w / 2 - 1), top + 18)
    ctx.closePath()
    ctx.fill()
  }

  // flame (only while airborne + burning; extends below the engine)
  if (phase === 'burning' && throttleAmt > 0) {
    const fl = (20 + Math.random() * 16) * (0.5 + throttleAmt * 0.7)
    const grad = ctx.createLinearGradient(0, 0, 0, fl)
    grad.addColorStop(0, P.warn)
    grad.addColorStop(0.5, mix(P.warn, P.danger, 0.5))
    grad.addColorStop(1, 'rgba(255,180,0,0)')
    ctx.fillStyle = grad
    ctx.beginPath()
    ctx.moveTo(-w * 0.3, 0)
    ctx.lineTo(w * 0.3, 0)
    ctx.lineTo((Math.random() - 0.5) * 4, fl)
    ctx.closePath()
    ctx.fill()
  }

  // body tube — runs from the top down to the nozzle, no gap
  const body = ctx.createLinearGradient(-w / 2, 0, w / 2, 0)
  body.addColorStop(0, '#cfd5de')
  body.addColorStop(0.5, '#ffffff')
  body.addColorStop(1, '#aab2c0')
  ctx.fillStyle = body
  ctx.strokeStyle = P.muted
  ctx.lineWidth = 1
  roundRectPath(ctx, -w / 2, top, w, HGT - NOZ, 5)
  ctx.fill()
  ctx.stroke()
  // stage band + logo
  ctx.strokeStyle = P.grid
  ctx.beginPath()
  ctx.moveTo(-w / 2, top + 30)
  ctx.lineTo(w / 2, top + 30)
  ctx.stroke()
  ctx.fillStyle = P.accent
  ctx.beginPath()
  ctx.arc(0, top + 18, 2.5, 0, Math.PI * 2)
  ctx.fill()

  // engine bell — trapezoid from body bottom (-NOZ) down to rim (0)
  ctx.fillStyle = P.text
  ctx.beginPath()
  ctx.moveTo(-5, -NOZ)
  ctx.lineTo(-8, 0)
  ctx.lineTo(8, 0)
  ctx.lineTo(5, -NOZ)
  ctx.closePath()
  ctx.fill()

  // landing legs — hinge on the body, foot exactly at y=0
  if (legsOut) {
    ctx.strokeStyle = P.text
    ctx.lineWidth = 2
    for (const sx of [-1, 1]) {
      ctx.beginPath()
      ctx.moveTo(sx * (w / 2 - 2), -16)
      ctx.lineTo(sx * (w / 2 + 13), 0)
      ctx.stroke()
    }
    ctx.lineWidth = 1
  }
  ctx.restore()
}

function arrowHead(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number) {
  ctx.beginPath()
  ctx.moveTo(x, y)
  ctx.lineTo(x - 7 * Math.cos(angle - 0.4), y - 7 * Math.sin(angle - 0.4))
  ctx.lineTo(x - 7 * Math.cos(angle + 0.4), y - 7 * Math.sin(angle + 0.4))
  ctx.closePath()
  ctx.fill()
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

function Stat({ label, value, P, danger }: { label: string; value: string; P: ReturnType<typeof palette>; danger?: boolean }) {
  return (
    <div className="t-panel rounded-lg px-3 py-2">
      <div className="t-faint text-[10px] uppercase tracking-wider">{label}</div>
      <div className="mt-0.5 font-mono text-base font-semibold tabular-nums" style={{ color: danger ? P.danger : P.text }}>
        {value}
      </div>
    </div>
  )
}

export const BoosterLandingWidget: WidgetDefinition<BoosterLandingProps> = {
  type: 'booster-landing',
  label: '火箭回收与着陆',
  description: '再入点火已把速度压到约 95 m/s；手动/自动完成最后的单发动机着陆反推，理解最小油门约束、hover-slam 与制动点计算。',
  icon: '🛬',
  defaultProps: {
    auto: false,
  },
  configSchema: [{ key: 'auto', label: '默认自动制导', type: 'checkbox' }],
  Component: BoosterLanding,
}
