import { useRef, useState } from 'react'
import { palette } from '../lib/canvas'
import { useTheme } from '../lib/theme'
import type { WidgetDefinition } from './registry'

interface MatrixProps {
  a: number
  b: number
  c: number
  d: number
  showGrid: boolean
  showDeterminant: boolean
}

type M2 = [number, number, number, number] // [a,b,c,d]

const W = 520
const H = 380
// World coordinates: x in [-XMAX, XMAX], y scaled to match the W/H aspect.
// The viewBox MUST be in the same coordinate scale as the rendered geometry
// (Grid/Arrow/Handle all draw in world coords). A pixel-scale viewBox here
// would shrink everything to an invisible dot at the center.
const XMAX = 5
const YMAX = (XMAX * H) / W
const VB = `${-XMAX} ${-YMAX} ${2 * XMAX} ${2 * YMAX}`
const UNIT = W / 2 / XMAX // viewBox-pixels per world unit (used by toWorld)
const RANGE = XMAX - 0.5

// A right-pointing arrow shape; makes rotation / shear / reflection obvious.
const SHAPE: [number, number][] = [
  [0, 0],
  [1, 0],
  [1, 0.25],
  [1.5, 0.5],
  [1, 0.75],
  [1, 1],
  [0, 1],
]

const PRESETS: { label: string; m: M2 }[] = [
  { label: '单位矩阵', m: [1, 0, 0, 1] },
  { label: '旋转 90°', m: [0, -1, 1, 0] },
  { label: '缩放', m: [2, 0, 0, 1.5] },
  { label: '水平错切', m: [1, 1, 0, 1] },
  { label: '反射 (y=x)', m: [0, 1, 1, 0] },
  { label: '投影', m: [1, 0, 0, 0] },
]

const IDENTITY: M2 = [1, 0, 0, 1]

export function Matrix({ props }: { props: MatrixProps }) {
  const { showGrid, showDeterminant } = props
  useTheme() // re-render on theme change
  const P = palette()
  const [m, setM] = useState<M2>([props.a, props.b, props.c, props.d])
  const dragRef = useRef<0 | 1 | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)

  const [a, b, c, d] = m
  const det = a * d - b * c
  const collapsed = Math.abs(det) < 0.02
  const reversed = det < -0.02

  const apply = (p: [number, number]): [number, number] => [
    a * p[0] + b * p[1],
    c * p[0] + d * p[1],
  ]

  const toWorld = (e: React.PointerEvent): [number, number] => {
    const svg = svgRef.current!
    const r = svg.getBoundingClientRect()
    const x = ((e.clientX - r.left) / r.width) * W - W / 2
    const y = ((e.clientY - r.top) / r.height) * H - H / 2
    return [x / UNIT, -y / UNIT] // flip y so world y is up
  }

  const onTipDown = (which: 0 | 1) => (e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragRef.current = which
    svgRef.current?.setPointerCapture(e.pointerId)
  }
  const onMove = (e: React.PointerEvent) => {
    const which = dragRef.current
    if (which === null) return
    const [wx, wy] = toWorld(e)
    const cx = clamp(wx, -RANGE, RANGE)
    const cy = clamp(wy, -RANGE, RANGE)
    setM((prev) => {
      const next = prev.slice() as M2
      if (which === 0) {
        next[0] = round(cx)
        next[2] = round(cy)
      } else {
        next[1] = round(cx)
        next[3] = round(cy)
      }
      return next
    })
  }
  const onUp = (e: React.PointerEvent) => {
    if (dragRef.current === null) return
    dragRef.current = null
    svgRef.current?.releasePointerCapture(e.pointerId)
  }

  const setEntry = (i: 0 | 1 | 2 | 3) => (v: number) =>
    setM((prev) => {
      const next = prev.slice() as M2
      next[i] = v
      return next
    })

  const transformed = SHAPE.map(apply)
  const shapePath = polygonPath(transformed)
  const origPath = polygonPath(SHAPE)

  const fill = collapsed ? '#64748b' : reversed ? '#fb7185' : '#22d3ee'

  return (
    <div className="lb-surface">
      <svg
        ref={svgRef}
        viewBox={VB}
        className="w-full touch-none"
        style={{ aspectRatio: `${W} / ${H}`, background: P.bg, borderRadius: 8 }}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      >
        <defs>
          <filter id="mx-glow" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="0.12" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        {showGrid && <Grid />}

        {/* original shape (faint dashed) */}
        <path d={origPath} fill="none" stroke="rgba(148,163,184,0.35)" strokeWidth={0.04} strokeDasharray="0.12 0.08" pointerEvents="none" />

        {/* original unit basis (faint) */}
        <line x1={0} y1={0} x2={1} y2={0} stroke="rgba(251,113,133,0.35)" strokeWidth={0.03} pointerEvents="none" />
        <line x1={0} y1={0} x2={0} y2={1} stroke="rgba(56,189,248,0.35)" strokeWidth={0.03} pointerEvents="none" />

        {/* transformed shape */}
        <path
          d={shapePath}
          fill={fill}
          fillOpacity={collapsed ? 0.18 : 0.16}
          stroke={fill}
          strokeWidth={0.05}
          strokeLinejoin="round"
          filter="url(#mx-glow)"
          pointerEvents="none"
        />

        {/* transformed basis vectors = columns of M */}
        <Arrow x={a} y={-c} color="#fb7185" label="î→" />
        <Arrow x={b} y={-d} color="#38bdf8" label="ĵ→" />

        {/* draggable tips */}
        <Handle cx={a} cy={-c} color="#fb7185" onPointerDown={onTipDown(0)} />
        <Handle cx={b} cy={-d} color="#38bdf8" onPointerDown={onTipDown(1)} />
      </svg>

      <div className="mt-3 flex flex-wrap items-start gap-4">
        <div className="flex items-center gap-3">
          <span className="font-mono text-sm" style={{ color: 'var(--lb-accent)' }}>M =</span>
          <div className="grid grid-cols-2 gap-1">
            <NumInput value={a} onChange={setEntry(0)} />
            <NumInput value={b} onChange={setEntry(1)} />
            <NumInput value={c} onChange={setEntry(2)} />
            <NumInput value={d} onChange={setEntry(3)} />
          </div>
        </div>

        {showDeterminant && (
          <div className="t-panel rounded-lg px-3 py-2 text-xs">
            <div className="t-muted">
              det(M) = <span className="t-strong font-mono">{det.toFixed(2)}</span>
            </div>
            <div className="mt-1 font-medium" style={{ color: collapsed ? P.faint : reversed ? '#fb7185' : '#06b6d4' }}>
              {collapsed ? '降维：图形被压扁成一条线（奇异矩阵）' : reversed ? `镜像翻转，面积缩放 ${Math.abs(det).toFixed(2)}×` : `保持定向，面积缩放 ${Math.abs(det).toFixed(2)}×`}
            </div>
          </div>
        )}

        <div className="ml-auto flex flex-wrap gap-1.5">
          {PRESETS.map((p) => (
            <button
              key={p.label}
              onClick={() => setM(p.m)}
              className="t-btn rounded-md px-2.5 py-1 text-xs transition"
            >
              {p.label}
            </button>
          ))}
          <button onClick={() => setM(IDENTITY)} className="t-btn rounded-md px-2.5 py-1 text-xs">
            重置
          </button>
        </div>
      </div>

      <p className="t-muted mt-2 text-xs">
        拖动红色 î→、青色 ĵ→ 两个箭头端点——它们就是矩阵的两列。被填充的图形是单位形状经 M 变换后的结果。
      </p>
    </div>
  )
}

function Grid() {
  const P = palette()
  const lines = []
  for (let i = -5; i <= 5; i++) {
    lines.push(
      <line key={`v${i}`} x1={i} y1={-5} x2={i} y2={5} stroke={i === 0 ? P.axis : P.grid} strokeWidth={i === 0 ? 0.04 : 0.02} />,
    )
    lines.push(
      <line key={`h${i}`} x1={-5} y1={i} x2={5} y2={i} stroke={i === 0 ? P.axis : P.grid} strokeWidth={i === 0 ? 0.04 : 0.02} />,
    )
  }
  return <g>{lines}</g>
}

function Arrow({ x, y, color, label }: { x: number; y: number; color: string; label: string }) {
  const len = Math.hypot(x, y)
  if (len < 0.02) return null
  const head = 0.18
  const ang = Math.atan2(y, x)
  const tipX = x
  const tipY = y
  const bx = tipX - head * Math.cos(ang - 0.4)
  const by = tipY - head * Math.sin(ang - 0.4)
  const cx = tipX - head * Math.cos(ang + 0.4)
  const cy = tipY - head * Math.sin(ang + 0.4)
  return (
    <g>
      <line x1={0} y1={0} x2={x} y2={y} stroke={color} strokeWidth={0.05} strokeLinecap="round" />
      <polygon points={`${tipX},${tipY} ${bx},${by} ${cx},${cy}`} fill={color} />
      <text x={x * 0.5 + 0.15} y={y * 0.5 - 0.1} fill={color} fontSize={0.35} fontWeight={600}>
        {label}
      </text>
    </g>
  )
}

function Handle({
  cx,
  cy,
  color,
  onPointerDown,
}: {
  cx: number
  cy: number
  color: string
  onPointerDown: (e: React.PointerEvent) => void
}) {
  return (
    <g onPointerDown={onPointerDown} style={{ cursor: 'grab' }}>
      <circle cx={cx} cy={cy} r={0.55} fill="transparent" stroke="none" />
      <circle cx={cx} cy={cy} r={0.22} stroke={color} strokeWidth={0.09} pointerEvents="none" style={{ fill: 'var(--lb-panel)' }} />
      <circle cx={cx} cy={cy} r={0.08} fill={color} pointerEvents="none" />
    </g>
  )
}

function NumInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <input
      type="number"
      step={0.1}
      value={Number.isFinite(value) ? value : 0}
      onChange={(e) => onChange(Number(e.target.value))}
      className="t-input w-14 rounded px-1.5 py-1 text-center text-xs tabular-nums outline-none transition"
    />
  )
}

function polygonPath(pts: [number, number][]): string {
  // SVG y is down; data uses world-y-up, so flip here (negate y).
  return pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p[0].toFixed(3)} ${(-p[1]).toFixed(3)}`).join(' ') + ' Z'
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v))
}
function round(v: number) {
  return Math.round(v * 100) / 100
}

export const MatrixWidget: WidgetDefinition<MatrixProps> = {
  type: 'matrix',
  label: '矩阵变换',
  description: '拖动矩阵两列（基向量的像），观察线性变换如何旋转、拉伸、翻转或压平图形。',
  icon: '🔢',
  defaultProps: {
    a: 1,
    b: 1,
    c: 0,
    d: 1,
    showGrid: true,
    showDeterminant: true,
  },
  configSchema: [
    { key: 'showGrid', label: '显示网格', type: 'checkbox' },
    { key: 'showDeterminant', label: '显示行列式', type: 'checkbox' },
  ],
  Component: Matrix,
}
