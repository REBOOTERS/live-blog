import { useEffect, useMemo, useRef, useState } from 'react'
import { useAnimationFrame } from '../lib/useAnimationFrame'
import { prepareCanvas, palette } from '../lib/canvas'
import { useTheme } from '../lib/theme'
import type { WidgetDefinition } from './registry'

interface AirfoilProps {
  alpha: number // angle of attack, degrees
  speed: number // m/s
  autoSweep: boolean
}

const W = 560
const H = 360
const CX = 232 // airfoil center x
const CY = H * 0.56
const CHORD = 200
const THICK = 0.14 * CHORD
const CAMBER = 0.018 * CHORD // slight camber → zero-lift AoA ≈ -1.8°

const RHO = 1.225 // air density kg/m³
const AREA = 1 // reference wing area m²
const ZERO_LIFT_AOA = -1.8 // degrees (cambered airfoil)
const STALL_AOA = 16
const CD0 = 0.02
const AR = 8
const E = 0.82

// lift coefficient model: thin-airfoil slope until stall, then break
function clModel(aoaDeg: number): number {
  const a = aoaDeg - ZERO_LIFT_AOA
  const slope = 2 * Math.PI * (Math.PI / 180) // per degree
  const clMax = slope * (STALL_AOA - ZERO_LIFT_AOA) * 0.92
  if (a < -STALL_AOA - 2) return -clMax * 0.85 - (a + STALL_AOA + 2) * 0.02
  if (a > STALL_AOA) return clMax - (a - STALL_AOA) * 0.075
  return slope * a
}

function cdModel(cl: number, aoaDeg: number): number {
  let cd = CD0 + (cl * cl) / (Math.PI * E * AR)
  if (aoaDeg > STALL_AOA) cd += (aoaDeg - STALL_AOA) * 0.012
  if (aoaDeg < -STALL_AOA - 2) cd += (-STALL_AOA - 2 - aoaDeg) * 0.012
  return cd
}

interface Vtx {
  x: number
  y: number
  p: number // pressure: -1 low (warm) .. +1 high (cool)
}

function hexRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}
function mixColor(a: string, b: string, t: number): string {
  const A = hexRgb(a)
  const B = hexRgb(b)
  return `rgb(${A.map((x, i) => Math.round(x + (B[i] - x) * t)).join(',')})`
}

// NACA-ish thickness at normalized chord position xbar ∈ [-1,1]
function thicknessAt(xbar: number): number {
  const x = (xbar + 1) / 2 // 0..1 LE..TE
  const naca = 0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1015 * x ** 4
  return THICK * naca / 0.2969 * (1 - 0.3 * x) // taper TE a touch
}
function camberAt(xbar: number): number {
  // parabolic camber line, max near 30% chord (screen y-up = negative)
  const x = (xbar + 1) / 2
  return -CAMBER * 4 * x * (1 - x)
}

function buildAirfoil(): { upper: { x: number; y: number }[]; lower: { x: number; y: number }[] } {
  const upper: { x: number; y: number }[] = []
  const lower: { x: number; y: number }[] = []
  const N = 48
  for (let i = 0; i <= N; i++) {
    const xbar = -1 + (2 * i) / N
    const x = (xbar * CHORD) / 2
    const t = thicknessAt(xbar)
    const c = camberAt(xbar)
    upper.push({ x, y: c - t })
    lower.push({ x, y: c + t })
  }
  return { upper, lower }
}

const AIRFOIL = buildAirfoil()

// Precompute a streamline in screen coords (y-down) for an inlet offset y0.
function buildLine(y0: number, alpha: number, stall: boolean): Vtx[] {
  const pts: Vtx[] = []
  const upper = y0 < 0
  const side = upper ? -1 : 1
  const absy = Math.abs(y0)
  const th0 = thicknessAt(0)
  const f = Math.exp(-Math.pow((absy - th0) / (CHORD * 0.42), 2))
  const xStart = -CHORD * 1.15
  const xEnd = CHORD * 2.0
  const steps = 76
  const sinA = Math.sin(alpha)
  for (let i = 0; i <= steps; i++) {
    const x = xStart + ((xEnd - xStart) * i) / steps
    const xbar = Math.max(-1, Math.min(1, (2 * x) / CHORD))
    const t = thicknessAt(xbar)
    let y = y0 + side * t * f
    // upwash ahead of the leading edge
    y -= CHORD * 0.05 * f * Math.exp(-Math.pow((x + CHORD * 0.62) / (CHORD * 0.2), 2))
    // downwash after trailing edge (screen y-down)
    const tt = (x - CHORD / 2) / (CHORD * 0.9)
    if (tt > 0) {
      const ramp = 1 - Math.exp(-tt * 2.4)
      const band = Math.exp(-Math.pow(y0 / (CHORD * 0.62), 2))
      y += CHORD * 0.85 * alpha * ramp * band
    }
    if (stall && upper && x > CHORD * 0.1) {
      // separated / turbulent wake on top
      const k = (x - CHORD * 0.1) / (CHORD * 1.2)
      y += side * Math.sin(i * 1.7 + x * 0.05) * CHORD * 0.05 * k
    }
    const thFrac = t / th0
    const speedMult = 1 + (upper ? 1 : -1) * 0.85 * sinA * thFrac * f * (x < CHORD / 2 ? 1 : 0.25)
    const p = -(speedMult - 1)
    pts.push({ x, y, p: Math.max(-1, Math.min(1, p)) })
  }
  return pts
}

function pathLength(pts: Vtx[]): number {
  let L = 0
  for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)
  return L
}

function pointAt(pts: Vtx[], dist: number): { x: number; y: number; p: number } {
  let d = dist
  for (let i = 1; i < pts.length; i++) {
    const seg = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)
    if (d <= seg) {
      const t = d / seg
      return {
        x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t,
        y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t,
        p: pts[i - 1].p + (pts[i].p - pts[i - 1].p) * t,
      }
    }
    d -= seg
  }
  return pts[pts.length - 1]
}

const INLETS = [-0.62, -0.46, -0.33, -0.22, -0.13, 0.13, 0.22, 0.33, 0.46, 0.62].map((v) => v * CHORD)

export function Airfoil({ props }: { props: AirfoilProps }) {
  const P = palette()
  useTheme()
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const [alpha, setAlpha] = useState(props.alpha)
  const [speed, setSpeed] = useState(props.speed)
  const [playing, setPlaying] = useState(props.autoSweep)
  const alphaRef = useRef(alpha * (Math.PI / 180))
  const speedRef = useRef(speed)
  useEffect(() => setAlpha(props.alpha), [props.alpha])
  useEffect(() => setSpeed(props.speed), [props.speed])
  useEffect(() => setPlaying(props.autoSweep), [props.autoSweep])
  useEffect(() => {
    alphaRef.current = alpha * (Math.PI / 180)
    speedRef.current = speed
  }, [alpha, speed])

  // particle phases
  const particles = useMemo(() => {
    const arr: { line: number; phase: number }[] = []
    INLETS.forEach((_, li) => {
      for (let k = 0; k < 4; k++) arr.push({ line: li, phase: Math.random() })
    })
    return arr
  }, [])
  const phaseRef = useRef(0)
  const [, force] = useState(0)

  useAnimationFrame((dt) => {
    if (playing) {
      // sweep alpha between -6 and 24 degrees
      setAlpha((a) => {
        let na = a + 7 * dt
        if (na > 24) na = -6
        return na
      })
    }
    // particle advance; base flow speed maps to px/s via speedRef (~30..150 → 120..420 px/s)
    const pxPerSec = 90 + speedRef.current * 2.4
    phaseRef.current = (phaseRef.current + (pxPerSec * dt) / 1000) % 100000
    force((n) => (n + 1) % 1_000_000)
  })

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = prepareCanvas(canvas, W, H)
    if (!ctx) return
    ctx.clearRect(0, 0, W, H)

    const bg = ctx.createLinearGradient(0, 0, 0, H)
    bg.addColorStop(0, P.bg)
    bg.addColorStop(1, P.bg2)
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, W, H)

    const alphaDeg = alpha
    const alphaRad = alphaRef.current
    const stall = alphaDeg > STALL_AOA

    // streamlines (faint reference paths)
    const lines = INLETS.map((y0) => buildLine(y0, alphaRad, stall))
    ctx.lineWidth = 1
    for (const pts of lines) {
      ctx.beginPath()
      pts.forEach((q, i) => {
        const x = CX + q.x
        const y = CY + q.y
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      })
      ctx.strokeStyle = P.grid
      ctx.stroke()
    }

    // particles
    for (const part of particles) {
      const pts = lines[part.line]
      const L = pathLength(pts)
      const q = pointAt(pts, (part.phase * L + phaseRef.current) % L)
      const x = CX + q.x
      const y = CY + q.y
      const col = q.p < 0 ? mixColor(P.muted, P.warn, Math.min(1, -q.p)) : mixColor(P.muted, P.accent, Math.min(1, q.p))
      ctx.fillStyle = col
      ctx.beginPath()
      ctx.arc(x, y, 2.4, 0, Math.PI * 2)
      ctx.fill()
    }

    // airfoil (rotated about center by AoA)
    ctx.save()
    ctx.translate(CX, CY)
    ctx.rotate(alphaRad)
    // pressure fill: top warm (low), bottom cool (high)
    ctx.beginPath()
    AIRFOIL.upper.forEach((q, i) => {
      const x = q.x
      const y = q.y
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    })
    for (let i = AIRFOIL.lower.length - 1; i >= 0; i--) ctx.lineTo(AIRFOIL.lower[i].x, AIRFOIL.lower[i].y)
    ctx.closePath()
    const pgrad = ctx.createLinearGradient(0, -THICK, 0, THICK)
    const lowC = mixColor(P.bg2, P.warn, 0.55 + 0.3 * Math.sin(alphaRad))
    const highC = mixColor(P.bg2, P.accent, 0.55 + 0.3 * Math.sin(alphaRad))
    pgrad.addColorStop(0, lowC)
    pgrad.addColorStop(0.5, P.bg2)
    pgrad.addColorStop(1, highC)
    ctx.fillStyle = pgrad
    ctx.fill()
    ctx.strokeStyle = P.muted
    ctx.lineWidth = 1.2
    ctx.stroke()
    // chord line
    ctx.strokeStyle = P.ghost
    ctx.setLineDash([3, 3])
    ctx.beginPath()
    ctx.moveTo(-CHORD / 2, 0)
    ctx.lineTo(CHORD / 2, 0)
    ctx.stroke()
    ctx.setLineDash([])
    ctx.restore()

    // forces
    const cl = clModel(alphaDeg)
    const cd = cdModel(cl, alphaDeg)
    const q = 0.5 * RHO * speed * speed
    const L = q * AREA * cl
    const D = q * AREA * cd
    const liftScale = 0.09
    const dragScale = 0.09
    // clamp on-screen arrow length (lift can reach ~10 kN at high speed); the
    // numeric label always shows the true value
    const liftPx = Math.min(L * liftScale, 110)
    const dragPx = Math.min(D * dragScale, 80)
    ctx.strokeStyle = P.accent
    ctx.fillStyle = P.accent
    drawArrow(ctx, CX, CY + 18, CX, CY + 18 - liftPx, P.accent, 3)
    drawArrow(ctx, CX, CY + 18, CX + dragPx, CY + 18, P.danger, 3)
    ctx.font = '600 12px ui-monospace, monospace'
    ctx.fillStyle = P.accent
    ctx.fillText(`升力 L = ${L.toFixed(0)} N`, CX - 70, CY + 18 - liftPx - 10)
    ctx.fillStyle = P.danger
    ctx.fillText(`阻力 D`, CX + dragPx + 8, CY + 22)

    // readouts
    ctx.fillStyle = P.text
    ctx.font = '12px ui-monospace, monospace'
    ctx.fillText(`迎角 α = ${alphaDeg.toFixed(1)}°`, 14, 24)
    ctx.fillText(`空速 v = ${speed.toFixed(0)} m/s`, 14, 42)
    ctx.fillStyle = P.muted
    ctx.fillText(`Cl = ${cl.toFixed(2)}   Cd = ${cd.toFixed(3)}   L/D = ${cd > 0 ? (cl / cd).toFixed(1) : '—'}`, 14, 60)
    if (stall) {
      ctx.fillStyle = P.danger
      ctx.font = '600 12px ui-sans-serif, system-ui'
      ctx.fillText('⚠ 气流分离：失速（升力骤降、阻力激增）', 14, 80)
    }

    drawClPlot(ctx, P, alphaDeg, W - 150, 18, 136, 80)
  })

  return (
    <div className="lb-surface">
      <canvas
        ref={canvasRef}
        style={{ width: '100%', aspectRatio: `${W} / ${H}`, touchAction: 'none' }}
        className="touch-none"
      />
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <label className="t-muted flex items-center gap-2 text-xs">
          <span className="w-12 shrink-0">迎角</span>
          <input type="range" min={-8} max={26} step={0.5} value={alpha} onChange={(e) => { setAlpha(Number(e.target.value)); setPlaying(false) }} className="w-40" />
          <span className="t-strong w-12 text-right font-mono tabular-nums">{alpha.toFixed(1)}°</span>
        </label>
        <label className="t-muted flex items-center gap-2 text-xs">
          <span className="w-12 shrink-0">空速</span>
          <input type="range" min={20} max={140} step={1} value={speed} onChange={(e) => setSpeed(Number(e.target.value))} className="w-32" />
          <span className="t-strong w-16 text-right font-mono tabular-nums">{speed} m/s</span>
        </label>
        <button onClick={() => setPlaying((p) => !p)} className="t-btn-primary ml-auto rounded-full px-4 py-1.5 text-xs">
          {playing ? '⏸ 暂停' : '▶ 自动扫迎角（看失速）'}
        </button>
      </div>
    </div>
  )
}

function drawArrow(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color: string,
  width: number,
) {
  ctx.strokeStyle = color
  ctx.fillStyle = color
  ctx.lineWidth = width
  ctx.beginPath()
  ctx.moveTo(x1, y1)
  ctx.lineTo(x2, y2)
  ctx.stroke()
  const ang = Math.atan2(y2 - y1, x2 - x1)
  const head = 9
  ctx.beginPath()
  ctx.moveTo(x2, y2)
  ctx.lineTo(x2 - head * Math.cos(ang - 0.4), y2 - head * Math.sin(ang - 0.4))
  ctx.lineTo(x2 - head * Math.cos(ang + 0.4), y2 - head * Math.sin(ang + 0.4))
  ctx.closePath()
  ctx.fill()
}

function drawClPlot(
  ctx: CanvasRenderingContext2D,
  P: ReturnType<typeof palette>,
  alphaDeg: number,
  x0: number,
  y0: number,
  w: number,
  h: number,
) {
  ctx.save()
  ctx.fillStyle = P.bg2
  ctx.strokeStyle = P.grid
  ctx.lineWidth = 1
  roundRect(ctx, x0, y0, w, h, 8)
  ctx.fill()
  ctx.stroke()
  // clip
  ctx.beginPath()
  roundRect(ctx, x0, y0, w, h, 8)
  ctx.clip()

  const aMin = -10
  const aMax = 26
  const clMin = -0.8
  const clMax = 1.8
  const px = (a: number) => x0 + ((a - aMin) / (aMax - aMin)) * w
  const py = (cl: number) => y0 + h - ((cl - clMin) / (clMax - clMin)) * h

  // stall region
  ctx.fillStyle = P.danger
  ctx.globalAlpha = 0.1
  ctx.fillRect(px(STALL_AOA), y0, x0 + w - px(STALL_AOA), h)
  ctx.globalAlpha = 1

  // zero line
  ctx.strokeStyle = P.grid
  ctx.beginPath()
  ctx.moveTo(x0, py(0))
  ctx.lineTo(x0 + w, py(0))
  ctx.stroke()

  // curve
  ctx.strokeStyle = P.accent
  ctx.lineWidth = 1.8
  ctx.beginPath()
  for (let a = aMin; a <= aMax; a += 0.5) {
    const cl = clModel(a)
    const x = px(a)
    const y = py(cl)
    if (a === aMin) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.stroke()

  // current point
  const cl = clModel(alphaDeg)
  ctx.fillStyle = alphaDeg > STALL_AOA ? P.danger : P.accent
  ctx.beginPath()
  ctx.arc(px(alphaDeg), py(cl), 3.5, 0, Math.PI * 2)
  ctx.fill()

  ctx.globalAlpha = 1
  ctx.fillStyle = P.faint
  ctx.font = '9px ui-monospace, monospace'
  ctx.fillText('Cl', x0 + 6, y0 + 12)
  ctx.fillText('α', x0 + w - 12, y0 + h - 5)
  ctx.fillText('失速', px(STALL_AOA) + 3, y0 + h - 5)
  ctx.restore()
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

export const AirfoilWidget: WidgetDefinition<AirfoilProps> = {
  type: 'airfoil',
  label: '翼型升力与失速',
  description: '调节迎角与空速，观察绕流、压力分布、升阻力变化与失速分离。',
  icon: '✈️',
  defaultProps: {
    alpha: 6,
    speed: 80,
    autoSweep: false,
  },
  configSchema: [
    { key: 'alpha', label: '迎角', type: 'range', min: -8, max: 26, step: 0.5, unit: '°' },
    { key: 'speed', label: '空速', type: 'range', min: 20, max: 140, step: 1, unit: 'm/s' },
    { key: 'autoSweep', label: '自动扫迎角', type: 'checkbox' },
  ],
  Component: Airfoil,
}
