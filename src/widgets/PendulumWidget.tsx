import { useEffect, useRef, useState } from 'react'
import { useAnimationFrame } from '../lib/useAnimationFrame'
import type { WidgetDefinition } from './registry'

interface PendulumProps {
  length: number // meters (logical)
  gravity: number // m/s^2
  damping: number // 0..1 per second approximation
  initialAngle: number // radians
  showEnergy: boolean
}

const W = 480
const H = 360
const PIVOT = { x: W / 2, y: 48 }
const MAX_PX_LEN = H - PIVOT.y - 60 // pixels available for the rod

export function Pendulum({ props }: { props: PendulumProps }) {
  const { length, gravity, damping, initialAngle, showEnergy } = props
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const draggingRef = useRef(false)

  // physics state in refs so rAF doesn't re-render
  const angleRef = useRef(initialAngle)
  const omegaRef = useRef(0)
  const [, force] = useState(0)
  const propsRef = useRef({ length, gravity, damping })
  propsRef.current = { length, gravity, damping }

  // reset when initial angle / length / gravity change
  useEffect(() => {
    angleRef.current = initialAngle
    omegaRef.current = 0
  }, [initialAngle, length, gravity])

  const rodLength = () => 40 + (propsRef.current.length / 3) * (MAX_PX_LEN - 40)

  useAnimationFrame((dt) => {
    if (!draggingRef.current) {
      // semi-implicit Euler
      const { gravity: g, length: l, damping: d } = propsRef.current
      const alpha = -(g / l) * Math.sin(angleRef.current) - d * omegaRef.current
      omegaRef.current += alpha * dt
      angleRef.current += omegaRef.current * dt
    }
    // always redraw so dragging is visually responsive
    force((n) => (n + 1) % 1_000_000)
  })

  const angleFromEvent = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!
    const r = canvas.getBoundingClientRect()
    const x = ((e.clientX - r.left) / r.width) * W
    const y = ((e.clientY - r.top) / r.height) * H
    angleRef.current = Math.atan2(x - PIVOT.x, y - PIVOT.y)
    omegaRef.current = 0
  }

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    draggingRef.current = true
    e.currentTarget.setPointerCapture(e.pointerId)
    angleFromEvent(e)
  }
  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!draggingRef.current) return
    angleFromEvent(e)
  }
  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    draggingRef.current = false
    e.currentTarget.releasePointerCapture(e.pointerId)
  }

  // render
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const dpr = window.devicePixelRatio || 1
    if (canvas.width !== W * dpr) {
      canvas.width = W * dpr
      canvas.height = H * dpr
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, W, H)

    // background grid
    ctx.strokeStyle = '#eef2f7'
    ctx.lineWidth = 1
    for (let x = 0; x < W; x += 24) {
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, H)
      ctx.stroke()
    }

    const L = rodLength()
    const theta = angleRef.current
    const bx = PIVOT.x + L * Math.sin(theta)
    const by = PIVOT.y + L * Math.cos(theta)

    // trail arc
    ctx.strokeStyle = '#c7d2fe'
    ctx.setLineDash([4, 4])
    ctx.beginPath()
    ctx.arc(PIVOT.x, PIVOT.y, L, Math.PI / 2 - 0.9, Math.PI / 2 + 0.9)
    ctx.stroke()
    ctx.setLineDash([])

    // rod
    ctx.strokeStyle = '#475569'
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.moveTo(PIVOT.x, PIVOT.y)
    ctx.lineTo(bx, by)
    ctx.stroke()

    // pivot
    ctx.fillStyle = '#1e293b'
    ctx.beginPath()
    ctx.arc(PIVOT.x, PIVOT.y, 6, 0, Math.PI * 2)
    ctx.fill()

    // bob
    const speed = L * omegaRef.current
    const energy =
      0.5 * (L / 100) * (L / 100) * speed * speed +
      (L / 100) * propsRef.current.gravity * (1 - Math.cos(theta))
    const r = 18
    const grad = ctx.createRadialGradient(bx - 5, by - 5, 2, bx, by, r)
    grad.addColorStop(0, '#818cf8')
    grad.addColorStop(1, '#4338ca')
    ctx.fillStyle = grad
    ctx.beginPath()
    ctx.arc(bx, by, r, 0, Math.PI * 2)
    ctx.fill()

    // angle readout near pivot
    ctx.fillStyle = '#334155'
    ctx.font = '13px ui-sans-serif, system-ui'
    const deg = ((theta * 180) / Math.PI).toFixed(1)
    ctx.fillText(`θ = ${deg}°`, PIVOT.x + 14, PIVOT.y - 8)

    if (showEnergy) {
      ctx.fillStyle = '#475569'
      ctx.fillText(`ω = ${omegaRef.current.toFixed(2)} rad/s`, 16, 24)
      ctx.fillText(`E ≈ ${energy.toFixed(3)}（守恒演示）`, 16, 44)
    }

    // hint
    if (Math.abs(omegaRef.current) < 0.02 && !draggingRef.current) {
      ctx.fillStyle = '#94a3b8'
      ctx.font = '12px ui-sans-serif, system-ui'
      ctx.fillText('拖动小球设定角度，松手开始摆动', 16, H - 16)
    }
  })

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <canvas
        ref={canvasRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        style={{ width: '100%', aspectRatio: `${W} / ${H}`, touchAction: 'none' }}
        className="block cursor-grab touch-none active:cursor-grabbing"
      />
    </div>
  )
}

export const PendulumWidget: WidgetDefinition<PendulumProps> = {
  type: 'pendulum',
  label: '单摆',
  description: '拖动小球释放，观察简谐运动与能量守恒。',
  icon: '🎯',
  defaultProps: {
    length: 1.2,
    gravity: 9.8,
    damping: 0.05,
    initialAngle: 0.6,
    showEnergy: true,
  },
  configSchema: [
    { key: 'length', label: '摆长', type: 'range', min: 0.4, max: 3, step: 0.1, unit: 'm' },
    { key: 'gravity', label: '重力加速度', type: 'range', min: 1, max: 25, step: 0.1, unit: 'm/s²' },
    { key: 'damping', label: '阻尼', type: 'range', min: 0, max: 1, step: 0.01 },
    { key: 'initialAngle', label: '初始角度', type: 'range', min: -1.4, max: 1.4, step: 0.05, unit: 'rad' },
    { key: 'showEnergy', label: '显示能量信息', type: 'checkbox' },
  ],
  Component: Pendulum,
}
