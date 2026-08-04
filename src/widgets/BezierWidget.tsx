import { useEffect, useRef, useState } from 'react'
import type { WidgetDefinition } from './registry'

interface BezierProps {
  p0x: number
  p0y: number
  p1x: number
  p1y: number
  p2x: number
  p2y: number
  p3x: number
  p3y: number
  animate: boolean
  showConstruction: boolean
  color: string
}

const W = 480
const H = 360

type Pt = { x: number; y: number }
type HandleId = 0 | 1 | 2 | 3

function lerp(a: Pt, b: Pt, t: number): Pt {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v))
}

export function Bezier({ props }: { props: BezierProps }) {
  const { animate, showConstruction, color } = props
  const [t, setT] = useState(0.4)
  const tRef = useRef(0.4)
  const dragRef = useRef<HandleId | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const [points, setPoints] = useState<Pt[]>([
    { x: props.p0x, y: props.p0y },
    { x: props.p1x, y: props.p1y },
    { x: props.p2x, y: props.p2y },
    { x: props.p3x, y: props.p3y },
  ])

  // sync initial points when props change externally
  useEffect(() => {
    setPoints([
      { x: props.p0x, y: props.p0y },
      { x: props.p1x, y: props.p1y },
      { x: props.p2x, y: props.p2y },
      { x: props.p3x, y: props.p3y },
    ])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.p0x, props.p0y, props.p1x, props.p1y, props.p2x, props.p2y, props.p3x, props.p3y])

  // animation of t
  useEffect(() => {
    if (!animate) return
    let raf = 0
    let last = performance.now()
    let dir = 1
    const tick = (now: number) => {
      const dt = (now - last) / 1000
      last = now
      let v = tRef.current + dir * dt * 0.4
      if (v >= 1) { v = 1; dir = -1 }
      if (v <= 0) { v = 0; dir = 1 }
      tRef.current = v
      setT(v)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [animate])

  const toSvg = (e: React.PointerEvent): Pt => {
    const svg = svgRef.current!
    const r = svg.getBoundingClientRect()
    return {
      x: ((e.clientX - r.left) / r.width) * W,
      y: ((e.clientY - r.top) / r.height) * H,
    }
  }

  const onHandleDown = (id: HandleId) => (e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragRef.current = id
    svgRef.current?.setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const id = dragRef.current
    if (id === null) return
    const p = toSvg(e)
    setPoints((prev) =>
      prev.map((q, i) =>
        i === id ? { x: clamp(p.x, 10, W - 10), y: clamp(p.y, 10, H - 10) } : q,
      ),
    )
  }

  const onPointerUp = (e: React.PointerEvent) => {
    if (dragRef.current === null) return
    dragRef.current = null
    svgRef.current?.releasePointerCapture(e.pointerId)
  }

  const [p0, p1, p2, p3] = points
  const tt = t
  // De Casteljau
  const a01 = lerp(p0, p1, tt)
  const a12 = lerp(p1, p2, tt)
  const a23 = lerp(p2, p3, tt)
  const b012 = lerp(a01, a12, tt)
  const b123 = lerp(a12, a23, tt)
  const c0123 = lerp(b012, b123, tt)

  const path = `M ${p0.x} ${p0.y} C ${p1.x} ${p1.y}, ${p2.x} ${p2.y}, ${p3.x} ${p3.y}`
  const ctrlPath = `M ${p0.x} ${p0.y} L ${p1.x} ${p1.y} L ${p2.x} ${p2.y} L ${p3.x} ${p3.y}`

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="block w-full touch-none"
        style={{ aspectRatio: `${W} / ${H}` }}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {/* grid */}
        <defs>
          <pattern id="bz-grid" width="24" height="24" patternUnits="userSpaceOnUse">
            <path d="M 24 0 L 0 0 0 24" fill="none" stroke="#f1f5f9" strokeWidth="1" />
          </pattern>
        </defs>
        <rect width={W} height={H} fill="url(#bz-grid)" />

        {/* control polygon */}
        <path d={ctrlPath} fill="none" stroke="#cbd5e1" strokeWidth={1.5} strokeDasharray="5 4" />

        {/* cubic curve */}
        <path d={path} fill="none" stroke={color} strokeWidth={3} strokeLinecap="round" />

        {showConstruction && (
          <>
            <line x1={a01.x} y1={a01.y} x2={a12.x} y2={a12.y} stroke="#a5b4fc" strokeWidth={1.5} />
            <line x1={a12.x} y1={a12.y} x2={a23.x} y2={a23.y} stroke="#a5b4fc" strokeWidth={1.5} />
            <line x1={b012.x} y1={b012.y} x2={b123.x} y2={b123.y} stroke="#f59e0b" strokeWidth={1.5} />
            <circle cx={a01.x} cy={a01.y} r={4} fill="#a5b4fc" />
            <circle cx={a12.x} cy={a12.y} r={4} fill="#a5b4fc" />
            <circle cx={a23.x} cy={a23.y} r={4} fill="#a5b4fc" />
            <circle cx={b012.x} cy={b012.y} r={4} fill="#f59e0b" />
            <circle cx={b123.x} cy={b123.y} r={4} fill="#f59e0b" />
          </>
        )}

        {/* moving point on curve */}
        <circle cx={c0123.x} cy={c0123.y} r={6} fill="#ef4444" />

        {/* endpoints / handles */}
        <Handle pt={p0} color="#0f172a" onPointerDown={onHandleDown(0)} />
        <Handle pt={p1} color="#64748b" onPointerDown={onHandleDown(1)} />
        <Handle pt={p2} color="#64748b" onPointerDown={onHandleDown(2)} />
        <Handle pt={p3} color="#0f172a" onPointerDown={onHandleDown(3)} />
      </svg>

      <div className="mt-3 flex items-center gap-3">
        <span className="text-xs text-slate-500 w-8">t</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.001}
          value={t}
          onChange={(e) => {
            const v = Number(e.target.value)
            tRef.current = v
            setT(v)
          }}
          className="flex-1 accent-indigo-600"
          disabled={animate}
        />
        <span className="w-12 text-right text-xs tabular-nums text-slate-600">{t.toFixed(2)}</span>
      </div>
      <p className="mt-2 text-xs text-slate-500">
        拖动四个控制点调整曲线；红色点为当前 t 值在曲线上的位置，黄色点展示 De Casteljau 递推过程。
      </p>
    </div>
  )
}

function Handle({
  pt,
  color,
  onPointerDown,
}: {
  pt: Pt
  color: string
  onPointerDown: (e: React.PointerEvent) => void
}) {
  return (
    <g onPointerDown={onPointerDown} style={{ cursor: 'grab' }}>
      {/* larger transparent hit area — fill="transparent" still captures events */}
      <circle cx={pt.x} cy={pt.y} r={14} fill="transparent" stroke="none" />
      <circle cx={pt.x} cy={pt.y} r={6} fill="white" stroke={color} strokeWidth={2.5} pointerEvents="none" />
    </g>
  )
}

export const BezierWidget: WidgetDefinition<BezierProps> = {
  type: 'bezier',
  label: '贝塞尔曲线',
  description: '拖动控制点，观察三次贝塞尔曲线与 De Casteljau 构造。',
  icon: '〰️',
  defaultProps: {
    p0x: 40,
    p0y: 280,
    p1x: 160,
    p1y: 60,
    p2x: 320,
    p2y: 300,
    p3x: 440,
    p3y: 100,
    animate: true,
    showConstruction: true,
    color: '#4f46e5',
  },
  configSchema: [
    { key: 'animate', label: '自动播放 t', type: 'checkbox' },
    { key: 'showConstruction', label: '显示构造线', type: 'checkbox' },
    { key: 'color', label: '曲线颜色', type: 'color' },
  ],
  Component: Bezier,
}
