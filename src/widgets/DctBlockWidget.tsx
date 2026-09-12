import { useEffect, useMemo, useRef, useState } from 'react'
import { prepareCanvas, palette } from '../lib/canvas'
import { useTheme } from '../lib/theme'
import { dct8, scaledQuantTable, ZIGZAG } from '../lib/dct'
import type { WidgetDefinition } from './registry'

interface DctBlockProps {
  patch: 'gradient' | 'edge' | 'texture'
  quant: boolean
  quality: number
  zigzag: boolean
}

const W = 540
const H = 300
const CELL = 25
const LEFT_X = 40
const RIGHT_X = 300
const GRID_Y = 52
const GRID = CELL * 8

const PATCHES = [
  { id: 'gradient', label: '平缓渐变' },
  { id: 'edge', label: '锐利边缘' },
  { id: 'texture', label: '细密纹理' },
] as const
type PatchId = (typeof PATCHES)[number]['id']

function hexToRgba(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`
}

// 确定性图块：三种频率成分对比鲜明的内容（天空 / 轮廓 / 细纹理的抽象）
function makePatch(id: PatchId): Float64Array {
  const f = new Float64Array(64)
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      f[y * 8 + x] =
        id === 'gradient'
          ? 70 + 84 * (x / 7) + 36 * (y / 7)
          : id === 'edge'
            ? x < 4
              ? 185
              : 60
            : (x + y) % 2 === 0
              ? 185
              : 65
    }
  }
  return f
}

export function DctBlock({ props }: { props: DctBlockProps }) {
  const theme = useTheme()
  const [patch, setPatch] = useState<PatchId>(props.patch)
  const [quant, setQuant] = useState(props.quant)
  const [quality, setQuality] = useState(props.quality)
  const [zigzag, setZigzag] = useState(props.zigzag)
  useEffect(() => setPatch(props.patch), [props.patch])
  useEffect(() => setQuant(props.quant), [props.quant])
  useEffect(() => setQuality(props.quality), [props.quality])
  useEffect(() => setZigzag(props.zigzag), [props.zigzag])

  const [hover, setHover] = useState<{ side: 'px' | 'coef'; i: number } | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  // 量化取整用 Math.round（JS 对负数偏向 +∞，与 libjpeg 的对称取整差 ≤ 半步，不可感知）
  const analysis = useMemo(() => {
    const block = makePatch(patch)
    const F = new Float64Array(64)
    dct8(block, F)
    const table = scaledQuantTable(quality)
    const qIdx = new Int16Array(64)
    for (let i = 0; i < 64; i++) qIdx[i] = Math.round(F[i] / table[i])
    let nRaw = 0
    let nKeep = 0
    let energy = 0
    for (let i = 0; i < 64; i++) {
      if (Math.abs(F[i]) >= 1) nRaw++
      if (qIdx[i] !== 0) nKeep++
      energy += F[i] * F[i]
    }
    let e10 = 0
    for (let k = 0; k < 10; k++) e10 += F[ZIGZAG[k]] * F[ZIGZAG[k]]
    const cMax = Math.max(1e-9, ...Array.from(F, Math.abs))
    return { block, F, table, qIdx, nRaw, nKeep, energyPct: energy > 0 ? (e10 / energy) * 100 : 100, cMax }
  }, [patch, quality])

  const draw = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = prepareCanvas(canvas, W, H)
    if (!ctx) return
    ctx.clearRect(0, 0, W, H)
    const P = palette()
    const { block, F, qIdx, cMax } = analysis

    const bg = ctx.createLinearGradient(0, 0, 0, H)
    bg.addColorStop(0, P.bg)
    bg.addColorStop(1, P.bg2)
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, W, H)

    ctx.font = '11px ui-monospace, monospace'
    ctx.fillStyle = P.muted
    ctx.fillText('时域：64 个亮度（0–255）', LEFT_X, 40)
    ctx.fillText('频域：64 个系数 F(v,u)', RIGHT_X, 40)

    // ---- 左：像素表格（数字是图像内容，对比度随格子亮度走，与主题无关）----
    ctx.textAlign = 'center'
    for (let i = 0; i < 64; i++) {
      const cx = LEFT_X + (i % 8) * CELL
      const cy = GRID_Y + ((i / 8) | 0) * CELL
      const v = Math.round(block[i])
      ctx.fillStyle = `rgb(${v},${v},${v})`
      ctx.fillRect(cx, cy, CELL, CELL)
      ctx.font = '10px ui-monospace, monospace'
      ctx.fillStyle = v > 140 ? 'rgba(0,0,0,0.72)' : 'rgba(255,255,255,0.88)'
      ctx.fillText(`${v}`, cx + CELL / 2, cy + CELL / 2 + 3.5)
      ctx.strokeStyle = P.grid
      ctx.lineWidth = 0.5
      ctx.strokeRect(cx + 0.25, cy + 0.25, CELL - 0.5, CELL - 0.5)
    }

    // ---- 中：变换说明 ----
    ctx.textAlign = 'center'
    ctx.font = '11px ui-monospace, monospace'
    ctx.fillStyle = P.faint
    ctx.fillText('→ DCT →', (LEFT_X + GRID + RIGHT_X) / 2, GRID_Y + GRID / 2 - 4)
    if (quant) {
      ctx.fillStyle = P.warn
      ctx.font = '10px ui-monospace, monospace'
      ctx.fillText('÷ Q 量化', (LEFT_X + GRID + RIGHT_X) / 2, GRID_Y + GRID / 2 + 14)
    }

    // ---- 右：系数账本 ----
    // |F| < 0.5 视为「本来就约等于零」（浮点残余）；量化把它杀成 0 的实质系数画成幽灵格
    for (let i = 0; i < 64; i++) {
      const cx = RIGHT_X + (i % 8) * CELL
      const cy = GRID_Y + ((i / 8) | 0) * CELL
      const f = F[i]
      const negligible = Math.abs(f) < 0.5
      const killed = quant && !negligible && qIdx[i] === 0
      if (negligible || killed) {
        ctx.fillStyle = P.bg2
      } else {
        const a = 0.1 + 0.8 * Math.min(1, Math.abs(f) / cMax)
        ctx.fillStyle = f >= 0 ? hexToRgba(P.accent, a) : hexToRgba(P.pink, a)
      }
      ctx.fillRect(cx, cy, CELL, CELL)
      if (killed) {
        ctx.strokeStyle = P.muted
        ctx.lineWidth = 1.2
        ctx.setLineDash([2.5, 2])
        ctx.strokeRect(cx + 1.5, cy + 1.5, CELL - 3, CELL - 3)
        ctx.setLineDash([])
      } else {
        ctx.strokeStyle = P.grid
        ctx.lineWidth = 0.5
        ctx.strokeRect(cx + 0.25, cy + 0.25, CELL - 0.5, CELL - 0.5)
      }
      if (i === 0) {
        // 直流格：账本的第一笔
        ctx.strokeStyle = P.text
        ctx.lineWidth = 1
        ctx.strokeRect(cx + 0.5, cy + 0.5, CELL - 1, CELL - 1)
      }
    }

    // ---- 之字形扫描路径：从直流出发，颜色渐隐表示「越走越接近末尾的 0」----
    if (zigzag) {
      const cxOf = (i: number) => RIGHT_X + (i % 8) * CELL + CELL / 2
      const cyOf = (i: number) => GRID_Y + ((i / 8) | 0) * CELL + CELL / 2
      ctx.lineWidth = 1.5
      for (let k = 0; k < 20; k++) {
        const a = ZIGZAG[k]
        const b = ZIGZAG[k + 1]
        ctx.strokeStyle = hexToRgba(P.warn, 0.85 - (0.7 * k) / 20)
        ctx.beginPath()
        ctx.moveTo(cxOf(a), cyOf(a))
        ctx.lineTo(cxOf(b), cyOf(b))
        ctx.stroke()
      }
      for (let k = 0; k < 21; k++) {
        const a = ZIGZAG[k]
        ctx.fillStyle = hexToRgba(P.warn, 0.9 - (0.7 * k) / 20)
        ctx.beginPath()
        ctx.arc(cxOf(a), cyOf(a), 1.6, 0, Math.PI * 2)
        ctx.fill()
      }
    }

    // ---- hover 高亮 ----
    if (hover) {
      const gx = hover.side === 'px' ? LEFT_X : RIGHT_X
      ctx.strokeStyle = P.accent
      ctx.lineWidth = 2
      ctx.strokeRect(gx + (hover.i % 8) * CELL, GRID_Y + ((hover.i / 8) | 0) * CELL, CELL, CELL)
    }

    ctx.textAlign = 'left'
    ctx.font = '10px ui-monospace, monospace'
    ctx.fillStyle = P.faint
    ctx.fillText('每格 = 1 个像素的亮度', LEFT_X, 286)
    ctx.fillText('颜色深浅 = |系数|，蓝正粉负', RIGHT_X, 286)
    ctx.textAlign = 'start'
  }

  useEffect(() => {
    draw()
  }, [analysis, quant, zigzag, hover, theme])

  const hitCell = (
    e: React.PointerEvent<HTMLCanvasElement>,
  ): { side: 'px' | 'coef'; i: number } | null => {
    const r = e.currentTarget.getBoundingClientRect()
    const mx = ((e.clientX - r.left) / r.width) * W
    const my = ((e.clientY - r.top) / r.height) * H
    for (const side of [
      { key: 'px' as const, x: LEFT_X },
      { key: 'coef' as const, x: RIGHT_X },
    ]) {
      if (mx >= side.x && mx < side.x + GRID && my >= GRID_Y && my < GRID_Y + GRID) {
        const cx = ((mx - side.x) / CELL) | 0
        const cy = ((my - GRID_Y) / CELL) | 0
        return { side: side.key, i: cy * 8 + cx }
      }
    }
    return null
  }

  const hoverChip = (() => {
    if (!hover) return null
    if (hover.side === 'px') {
      return `亮度(${hover.i % 8}, ${(hover.i / 8) | 0}) = ${Math.round(analysis.block[hover.i])}`
    }
    const i = hover.i
    const f = analysis.F[i]
    const tail = quant
      ? analysis.qIdx[i] === 0
        ? ' → 量化后 0（被扔）'
        : ` → 量化 ${analysis.qIdx[i]} × 步长 ${analysis.table[i]}`
      : ''
    return `F(${(i / 8) | 0},${i % 8}) = ${f >= 0 ? ' ' : '−'}${Math.abs(f).toFixed(1)}${tail}`
  })()

  return (
    <div className="lb-surface">
      <canvas
        ref={canvasRef}
        className="touch-none"
        onPointerMove={(e) => {
          const h = hitCell(e)
          setHover((prev) => (prev?.side === h?.side && prev?.i === h?.i ? prev : h))
        }}
        onPointerLeave={() => setHover(null)}
        style={{ width: '100%', aspectRatio: `${W} / ${H}`, borderRadius: 8, touchAction: 'none' }}
      />

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <div className="t-panel inline-flex rounded-lg p-0.5">
          {PATCHES.map((p) => (
            <button
              key={p.id}
              onClick={() => setPatch(p.id)}
              className={`rounded-[6px] px-3 py-1 text-xs font-medium transition ${
                patch === p.id ? 't-btn-primary' : 't-muted'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <button
          onClick={() => setQuant((v) => !v)}
          className={`rounded-full px-3 py-1 text-xs transition ${quant ? 't-btn-primary' : 't-btn'}`}
        >
          量化 {quant ? '开' : '关'}
        </button>
        <button
          onClick={() => setZigzag((v) => !v)}
          className={`rounded-full px-3 py-1 text-xs transition ${zigzag ? 't-btn-primary' : 't-btn'}`}
        >
          之字形扫描
        </button>
      </div>

      {quant && (
        <label className="t-muted mt-3 flex items-center gap-2 text-xs">
          <span className="w-16 shrink-0">质量 q</span>
          <input
            type="range"
            min={1}
            max={100}
            step={1}
            value={quality}
            onChange={(e) => setQuality(Number(e.target.value))}
            className="flex-1"
          />
          <span className="t-strong w-14 text-right font-mono tabular-nums">{quality}</span>
        </label>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2 font-mono text-[11px] tabular-nums">
        <span className="t-panel rounded-full px-3 py-1">实质系数 |F|≥1：{analysis.nRaw}/64</span>
        {quant && (
          <span className="t-panel rounded-full px-3 py-1">量化后保留：{analysis.nKeep}/64</span>
        )}
        <span className="t-panel rounded-full px-3 py-1">
          之字形前 10 项能量：{analysis.energyPct.toFixed(1)}%
        </span>
        {hoverChip && <span className="t-panel rounded-full px-3 py-1">{hoverChip}</span>}
      </div>
    </div>
  )
}

export const DctBlockWidget: WidgetDefinition<DctBlockProps> = {
  type: 'dct-block',
  label: '8×8 频域账本',
  description:
    '同一个 8×8 方块的两本账：左边 64 个亮度，右边 64 个系数。切图块、开量化，看能量如何挤进左上角、高频如何被扔。',
  icon: '🧾',
  defaultProps: { patch: 'gradient', quant: false, quality: 75, zigzag: false },
  configSchema: [
    {
      key: 'patch',
      label: '图块类型',
      type: 'select',
      options: PATCHES.map((p) => ({ value: p.id, label: p.label })),
    },
    { key: 'quant', label: '量化', type: 'checkbox' },
    { key: 'quality', label: '质量 q', type: 'range', min: 1, max: 100, step: 1 },
    { key: 'zigzag', label: '之字形扫描路径', type: 'checkbox' },
  ],
  exportable: true,
  Component: DctBlock,
}
