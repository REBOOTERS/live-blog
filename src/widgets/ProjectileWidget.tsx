import { useEffect, useRef, useState } from 'react'
import { useAnimationFrame } from '../lib/useAnimationFrame'
import { prepareCanvas } from '../lib/canvas'
import type { WidgetDefinition } from './registry'

interface ProjectileProps {
  gravity: number // m/s^2
  showVelocity: boolean
  airDrag: number // per-second coefficient applied to velocity
  trail: boolean
}

const W = 480
const H = 320
const ORIGIN = { x: 60, y: H - 40 } // launch point, bottom-left
const SCALE = 4 // pixels per meter
// V_MAX chosen so a 45° max-power shot (range = v²/g = 32²/9.8 ≈ 104 m) lands at
// ~416 px — right at the 420 px usable width — and a steep shot's apex (~52 m)
// fits the ~260 px usable height.
const V_MAX = 32
const PREDICT_DT = 1 / 120

interface Pt {
  x: number
  y: number
}

interface State {
  x: number
  y: number
  vx: number
  vy: number
  flying: boolean
  trail: Pt[]
  t: number
  maxH: number
  landed: boolean
  range: number
  flightTime: number
}

const IDLE: State = {
  x: 0,
  y: 0,
  vx: 0,
  vy: 0,
  flying: false,
  trail: [],
  t: 0,
  maxH: 0,
  landed: false,
  range: 0,
  flightTime: 0,
}

export function Projectile({ props }: { props: ProjectileProps }) {
  const { gravity, showVelocity, airDrag, trail } = props
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const draggingRef = useRef(false)
  const aimRef = useRef<{ vx: number; vy: number; speed: number } | null>(null)
  const propsRef = useRef({ gravity, showVelocity, airDrag, trail })
  propsRef.current = { gravity, showVelocity, airDrag, trail }

  const stateRef = useRef<State>({ ...IDLE })
  const [, force] = useState(0)

  useAnimationFrame((dt) => {
    const s = stateRef.current
    let needsRedraw = false
    if (s.flying) {
      const { gravity: g, airDrag: d, trail: showTrail } = propsRef.current
      s.vy -= g * dt
      s.vx *= 1 - d * dt
      s.vy *= 1 - d * dt
      s.x += s.vx * dt
      s.y += s.vy * dt
      s.t += dt
      if (s.y > s.maxH) s.maxH = s.y
      if (s.y <= 0 && s.vy < 0) {
        s.y = 0
        s.flying = false
        s.landed = true
        s.range = s.x
        s.flightTime = s.t
      }
      if (showTrail) s.trail.push({ x: s.x, y: s.y })
      if (s.trail.length > 600) s.trail.shift()
      needsRedraw = true
    }
    if (draggingRef.current) needsRedraw = true // keep redrawing while aiming
    if (needsRedraw) force((n) => (n + 1) % 1_000_000)
  })

  const aimFromEvent = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!
    const r = canvas.getBoundingClientRect()
    const px = ((e.clientX - r.left) / r.width) * W
    const py = ((e.clientY - r.top) / r.height) * H
    const wx = (px - ORIGIN.x) / SCALE // meters, +right
    const wy = (ORIGIN.y - py) / SCALE // meters, +up
    if (wy <= 0) {
      aimRef.current = null // refuse aiming at/below ground
      return
    }
    let vx = wx
    let vy = wy
    const sp = Math.hypot(vx, vy)
    if (sp > V_MAX) {
      vx = (vx / sp) * V_MAX
      vy = (vy / sp) * V_MAX
    }
    aimRef.current = { vx, vy, speed: Math.min(sp, V_MAX) }
  }

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (stateRef.current.flying) return
    draggingRef.current = true
    e.currentTarget.setPointerCapture(e.pointerId)
    aimFromEvent(e)
    force((n) => n + 1)
  }
  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!draggingRef.current) return
    aimFromEvent(e)
    force((n) => n + 1)
  }
  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!draggingRef.current) return
    draggingRef.current = false
    e.currentTarget.releasePointerCapture(e.pointerId)
    const a = aimRef.current
    if (a && a.speed > 1) {
      stateRef.current = {
        ...IDLE,
        vx: a.vx,
        vy: a.vy,
        flying: true,
      }
    }
    aimRef.current = null
  }

  const reset = () => {
    stateRef.current = { ...IDLE }
    aimRef.current = null
    draggingRef.current = false
    force((n) => n + 1)
  }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = prepareCanvas(canvas, W, H)
    if (!ctx) return
    ctx.clearRect(0, 0, W, H)

    const { showVelocity, trail: showTrail, gravity: g, airDrag: d } = propsRef.current

    // background
    const bg = ctx.createLinearGradient(0, 0, 0, H)
    bg.addColorStop(0, '#0a0f1e')
    bg.addColorStop(1, '#070b16')
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, W, H)

    // ground
    ctx.fillStyle = 'rgba(34,211,238,0.06)'
    ctx.fillRect(0, ORIGIN.y, W, H - ORIGIN.y)
    ctx.strokeStyle = 'rgba(129,140,248,0.5)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(0, ORIGIN.y)
    ctx.lineTo(W, ORIGIN.y)
    ctx.stroke()

    // grid
    ctx.strokeStyle = 'rgba(148,163,184,0.08)'
    for (let mx = 0; mx * SCALE < W; mx += 5) {
      ctx.beginPath()
      ctx.moveTo(ORIGIN.x + mx * SCALE, 0)
      ctx.lineTo(ORIGIN.x + mx * SCALE, ORIGIN.y)
      ctx.stroke()
    }

    const s = stateRef.current

    // trail
    if (showTrail && s.trail.length > 1) {
      ctx.strokeStyle = 'rgba(34,211,238,0.5)'
      ctx.lineWidth = 2
      ctx.shadowColor = 'rgba(34,211,238,0.6)'
      ctx.shadowBlur = 8
      ctx.beginPath()
      s.trail.forEach((pt, i) => {
        const x = ORIGIN.x + pt.x * SCALE
        const y = ORIGIN.y - pt.y * SCALE
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      })
      ctx.stroke()
      ctx.shadowBlur = 0
    }

    const aim = aimRef.current

    // predicted trajectory while aiming
    if (aim) {
      const pts = predict(aim.vx, aim.vy, g, d)
      if (pts.length > 1) {
        ctx.strokeStyle = 'rgba(148,163,184,0.7)'
        ctx.lineWidth = 1.5
        ctx.setLineDash([4, 5])
        ctx.beginPath()
        pts.forEach((pt, i) => {
          const x = ORIGIN.x + pt.x * SCALE
          const y = ORIGIN.y - pt.y * SCALE
          if (i === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        })
        ctx.stroke()
        ctx.setLineDash([])
        // landing marker
        const last = pts[pts.length - 1]
        const lx = ORIGIN.x + last.x * SCALE
        const ly = ORIGIN.y
        ctx.fillStyle = '#94a3b8'
        ctx.beginPath()
        ctx.arc(lx, ly, 4, 0, Math.PI * 2)
        ctx.fill()
      }
      // launch vector arrow
      const aimLen = aim.speed * 3
      drawArrow(
        ctx,
        ORIGIN.x,
        ORIGIN.y,
        ORIGIN.x + (aim.vx / aim.speed) * aimLen,
        ORIGIN.y - (aim.vy / aim.speed) * aimLen,
        '#22d3ee',
      )
      const angle = (Math.atan2(aim.vy, aim.vx) * 180) / Math.PI
      ctx.fillStyle = '#a5b4fc'
      ctx.font = '12px ui-monospace, monospace'
      ctx.fillText(`v₀ = ${aim.speed.toFixed(1)} m/s`, 12, 22)
      ctx.fillText(`α = ${angle.toFixed(0)}°`, 12, 40)
    }

    // ball
    const px = ORIGIN.x + s.x * SCALE
    const py = ORIGIN.y - s.y * SCALE
    const ballGrad = ctx.createRadialGradient(px - 2, py - 2, 1, px, py, 8)
    ballGrad.addColorStop(0, '#a5b4fc')
    ballGrad.addColorStop(1, '#6366f1')
    ctx.fillStyle = ballGrad
    ctx.shadowColor = 'rgba(99,102,241,0.7)'
    ctx.shadowBlur = 14
    ctx.beginPath()
    ctx.arc(px, py, 8, 0, Math.PI * 2)
    ctx.fill()
    ctx.shadowBlur = 0

    // velocity vectors during flight
    if (showVelocity && s.flying) {
      drawArrow(ctx, px, py, px + s.vx * SCALE * 0.3, py, '#fb7185', 'vx')
      drawArrow(ctx, px, py, px, py - s.vy * SCALE * 0.3, '#34d399', 'vy')
      drawArrow(ctx, px, py, px + s.vx * SCALE * 0.3, py - s.vy * SCALE * 0.3, '#e2e8f0')
    }

    // origin marker
    ctx.fillStyle = '#cbd5e1'
    ctx.beginPath()
    ctx.arc(ORIGIN.x, ORIGIN.y, 4, 0, Math.PI * 2)
    ctx.fill()

    if (!s.flying && !aim && !s.landed) {
      ctx.fillStyle = '#64748b'
      ctx.font = '12px ui-sans-serif, system-ui'
      ctx.fillText('从发射点朝目标方向拖拽，松手发射', 12, H - 14)
    }
    if (s.flying) {
      ctx.fillStyle = '#94a3b8'
      ctx.font = '12px ui-monospace, monospace'
      ctx.fillText(`x = ${s.x.toFixed(1)} m   y = ${s.y.toFixed(1)} m`, W - 168, 22)
      ctx.fillText(`vx = ${s.vx.toFixed(1)}   vy = ${s.vy.toFixed(1)}`, W - 168, 40)
    }
    if (s.landed) {
      ctx.fillStyle = '#67e8f9'
      ctx.font = '600 12px ui-monospace, monospace'
      ctx.fillText(
        `射程 ${s.range.toFixed(1)} m · 最高 ${s.maxH.toFixed(1)} m · 飞行 ${s.flightTime.toFixed(2)} s`,
        12,
        H - 14,
      )
    }
  })

  return (
    <div className="lb-surface">
      <canvas
        ref={canvasRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        style={{ width: '100%', aspectRatio: `${W} / ${H}`, touchAction: 'none' }}
        className="cursor-crosshair touch-none"
      />
      <div className="mt-2 flex justify-end">
        <button
          onClick={reset}
          className="rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-slate-300 hover:bg-white/10"
        >
          ↺ 重置
        </button>
      </div>
    </div>
  )
}

/** Forward-simulate the same integration used in the live loop, from (0,0). */
function predict(vx: number, vy: number, g: number, d: number): Pt[] {
  const pts: Pt[] = []
  let x = 0
  let y = 0
  for (let i = 0; i < 800; i++) {
    vy -= g * PREDICT_DT
    vx *= 1 - d * PREDICT_DT
    vy *= 1 - d * PREDICT_DT
    x += vx * PREDICT_DT
    y += vy * PREDICT_DT
    pts.push({ x, y })
    if (y <= 0 && i > 0) break
    if (x * SCALE > W) break
  }
  return pts
}

function drawArrow(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color: string,
  label?: string,
) {
  ctx.strokeStyle = color
  ctx.fillStyle = color
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(x1, y1)
  ctx.lineTo(x2, y2)
  ctx.stroke()
  const ang = Math.atan2(y2 - y1, x2 - x1)
  const head = 7
  ctx.beginPath()
  ctx.moveTo(x2, y2)
  ctx.lineTo(x2 - head * Math.cos(ang - 0.4), y2 - head * Math.sin(ang - 0.4))
  ctx.lineTo(x2 - head * Math.cos(ang + 0.4), y2 - head * Math.sin(ang + 0.4))
  ctx.closePath()
  ctx.fill()
  if (label) {
    ctx.font = '11px ui-sans-serif, system-ui'
    ctx.fillText(label, x2 + 4, y2 - 4)
  }
}

export const ProjectileWidget: WidgetDefinition<ProjectileProps> = {
  type: 'projectile',
  label: '抛体运动',
  description: '朝目标方向拖拽设定初速度与角度，实时预览抛物线与速度分量。',
  icon: '🚀',
  defaultProps: {
    gravity: 9.8,
    showVelocity: true,
    airDrag: 0,
    trail: true,
  },
  configSchema: [
    { key: 'gravity', label: '重力', type: 'range', min: 1, max: 25, step: 0.1, unit: 'm/s²' },
    { key: 'airDrag', label: '空气阻力', type: 'range', min: 0, max: 0.2, step: 0.005 },
    { key: 'showVelocity', label: '显示速度分量', type: 'checkbox' },
    { key: 'trail', label: '显示轨迹', type: 'checkbox' },
  ],
  Component: Projectile,
}
