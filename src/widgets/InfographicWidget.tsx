import { useEffect, useMemo, useRef, useState } from 'react'
import { prepareCanvas, palette, type CanvasPalette } from '../lib/canvas'
import { useTheme } from '../lib/theme'
import type { WidgetDefinition } from './registry'

/**
 * 教学账本，不是任何一家的采样日志。
 * 弯路是 y = 0.8 sin(πs)。欧拉法用该点的切线走完全步，所以步数少时终点浮在图上方。
 * 直线 z_t = (1-t)x + tε 的速度是常数，步数 ≥ 1 时终点误差是 0。
 * 20 个字里最后两个（流失那一行的 4 和 %）阈值在 1 之外，走完也不锁。
 */

const BOW = 0.8
const MAX_STEPS = 10
const GLYPHS = 20
const STUCK = 2
const W = 640
const H = 408

const TITLE = 'Q3 +72%'
const ROWS = [
  { label: '访问', value: '72%', target: 72 },
  { label: '付费', value: '18%', target: 18 },
  { label: '流失', value: '4%', target: 4 },
] as const

const HATS = [210, 28, 130]
const RADII = [16, 22, 13]

export type PosterMode = 'flow' | 'glyphs' | 'typeset' | 'cast'

interface InfographicProps {
  mode: PosterMode
  steps: number
  anchor: boolean
}

export function bowPoint(s: number): [number, number] {
  return [1 - s, Math.sin(Math.PI * s) * BOW]
}

export function eulerPath(steps: number): { x: number; y: number }[] {
  const n = Math.max(1, Math.round(steps))
  let s = 1
  let x = bowPoint(1)[0]
  let y = bowPoint(1)[1]
  const ds = 1 / n
  const h = 1e-4
  const pts = [{ x, y }]
  for (let i = 0; i < n; i++) {
    const a = bowPoint(s)
    const b = bowPoint(Math.max(0, s - h))
    x += ((b[0] - a[0]) / h) * ds
    y += ((b[1] - a[1]) / h) * ds
    s -= ds
    pts.push({ x, y })
  }
  return pts
}

export function curveMiss(steps: number): number {
  const path = eulerPath(steps)
  const last = path[path.length - 1]
  if (!last) return 1
  const [tx, ty] = bowPoint(0)
  return Math.hypot(last.x - tx, last.y - ty)
}

export function glyphChars(): string[] {
  const chars: string[] = []
  for (const ch of TITLE) if (ch !== ' ') chars.push(ch)
  for (const row of ROWS) {
    for (const ch of row.label) chars.push(ch)
    for (const ch of row.value) chars.push(ch)
  }
  return chars
}

export function lockedCount(steps: number, mode: PosterMode): number {
  if (mode === 'typeset') return GLYPHS
  const clarity = Math.max(0, Math.min(MAX_STEPS, Math.round(steps))) / MAX_STEPS
  if (clarity >= 1) return GLYPHS - STUCK
  return Math.floor(clarity * (GLYPHS - STUCK))
}

function clarityOf(steps: number): number {
  return Math.max(0, Math.min(MAX_STEPS, Math.round(steps))) / MAX_STEPS
}

function noise01(i: number): number {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453
  return x - Math.floor(x)
}

function barPct(target: number, row: number, steps: number): number {
  const clarity = clarityOf(steps)
  const noisy = 12 + noise01(row) * 78
  return noisy * (1 - clarity) + target * clarity
}

function hatHue(frame: number, anchor: boolean): number {
  return anchor ? HATS[0] : HATS[frame]
}

function hatRadius(frame: number, anchor: boolean): number {
  return anchor ? RADII[0] : RADII[frame]
}

export function hueGap(anchor: boolean): number {
  if (anchor) return 0
  let max = 0
  for (let i = 0; i < HATS.length; i++) {
    for (let j = i + 1; j < HATS.length; j++) {
      const d = Math.abs(HATS[i] - HATS[j])
      max = Math.max(max, Math.min(d, 360 - d))
    }
  }
  return max
}

function fmt3(n: number): string {
  return n.toFixed(3)
}

function headline(mode: PosterMode, steps: number, anchor: boolean): string {
  if (mode === 'flow') {
    return `直线偏差 ${fmt3(0)}，弯路偏差 ${fmt3(curveMiss(steps))}。`
  }
  if (mode === 'cast') {
    return anchor ? '三顶帽子的色相差 0°。' : `三顶帽子的色相最大差 ${hueGap(false)}°。`
  }
  const wrong = GLYPHS - lockedCount(steps, mode)
  return `错字 ${wrong} / ${GLYPHS}。`
}

function detail(mode: PosterMode, steps: number, anchor: boolean): string {
  if (mode === 'flow') {
    return `步数 ${Math.round(steps)}。直线每步都落在终点上。弯路用这一步的切线走完，终点的高度还没回到 0。schnell 的 1 到 4 步是蒸馏，不是这条弯路。`
  }
  if (mode === 'cast') {
    return anchor
      ? '有参考。三格的帽子都是 210°，半径都是 16。变的是背后的条纹。'
      : '无参考。三句不同的提示重新抽了帽子：210°、28°、130°。同一句提示加同一颗种子才会得到同一张像素，那是复现，不是换场景还认得这个人。'
  }
  const locked = lockedCount(steps, mode)
  if (mode === 'typeset') {
    return '字从第 1 步之前就由字体画出。柱子仍沿着直线从噪声长出来。错字不参与采样。'
  }
  const pending = glyphChars().slice(locked)
  const tail =
    pending.length <= 4
      ? `还没锁上的是${pending.map((ch) => `「${ch}」`).join('')}。`
      : `还剩 ${pending.length} 个没锁上。`
  return `锁上了前 ${locked} 个。${tail}最后两个是流失那一行的 4 和 %，阈值在 1 外面。`
}

function draw(
  ctx: CanvasRenderingContext2D,
  P: CanvasPalette,
  mode: PosterMode,
  steps: number,
  anchor: boolean,
) {
  ctx.clearRect(0, 0, W, H)
  ctx.fillStyle = P.bg
  ctx.fillRect(0, 0, W, H)
  if (mode === 'flow') drawFlow(ctx, P, steps)
  else if (mode === 'cast') drawCast(ctx, P, anchor)
  else drawCard(ctx, P, steps, mode)
}

function drawFlow(ctx: CanvasRenderingContext2D, P: CanvasPalette, steps: number) {
  const plot = { x: 46, y: 36, w: 340, h: 250 }
  const yMax = 1
  const mapX = (v: number) => plot.x + v * plot.w
  const mapY = (v: number) => plot.y + plot.h - (Math.max(0, Math.min(yMax, v)) / yMax) * plot.h

  ctx.fillStyle = P.bg2
  ctx.fillRect(plot.x, plot.y, plot.w, plot.h)

  ctx.strokeStyle = P.grid
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(plot.x, mapY(0))
  ctx.lineTo(plot.x + plot.w, mapY(0))
  ctx.stroke()

  ctx.beginPath()
  for (let i = 0; i <= 40; i++) {
    const s = 1 - i / 40
    const [x, y] = bowPoint(s)
    const px = mapX(x)
    const py = mapY(y)
    if (i === 0) ctx.moveTo(px, py)
    else ctx.lineTo(px, py)
  }
  ctx.strokeStyle = P.ghost
  ctx.lineWidth = 1.5
  ctx.stroke()

  ctx.beginPath()
  ctx.moveTo(mapX(0), mapY(0))
  ctx.lineTo(mapX(1), mapY(0))
  ctx.strokeStyle = P.accent
  ctx.lineWidth = 2
  ctx.stroke()

  const path = eulerPath(steps)
  ctx.beginPath()
  path.forEach((p, i) => {
    const px = mapX(p.x)
    const py = mapY(p.y)
    if (i === 0) ctx.moveTo(px, py)
    else ctx.lineTo(px, py)
  })
  ctx.strokeStyle = P.warn
  ctx.lineWidth = 1.75
  ctx.stroke()

  const last = path[path.length - 1]
  ctx.fillStyle = P.warn
  ctx.beginPath()
  ctx.arc(mapX(last.x), mapY(last.y), 5, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = P.accent
  ctx.beginPath()
  ctx.arc(mapX(1), mapY(0), 4, 0, Math.PI * 2)
  ctx.fill()

  ctx.fillStyle = P.muted
  ctx.font = '11px ui-sans-serif, system-ui, sans-serif'
  ctx.textAlign = 'left'
  ctx.fillText('噪声', plot.x, plot.y + plot.h + 16)
  ctx.textAlign = 'right'
  ctx.fillText('图像', plot.x + plot.w, plot.y + plot.h + 16)

  ctx.textAlign = 'left'
  ctx.fillStyle = P.faint
  ctx.fillText('灰线是弯路，沿底边的是直线，暖色折线是弯路上的欧拉步。', 46, 328)

  drawMiniBars(ctx, P, steps, 420, 36, 180, 250)
}

function drawMiniBars(
  ctx: CanvasRenderingContext2D,
  P: CanvasPalette,
  steps: number,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  ctx.fillStyle = P.bg2
  ctx.fillRect(x, y, w, h)
  ctx.fillStyle = P.muted
  ctx.font = '11px ui-sans-serif, system-ui, sans-serif'
  ctx.textAlign = 'left'
  ctx.fillText('潜空间里的柱子', x + 12, y + 22)
  const clarity = clarityOf(steps)
  ROWS.forEach((row, i) => {
    const pct = barPct(row.target, i, steps)
    const by = y + 58 + i * 58
    ctx.fillStyle = P.grid
    ctx.fillRect(x + 16, by, w - 32, 16)
    ctx.fillStyle = P.accent
    ctx.globalAlpha = 0.35 + 0.65 * clarity
    ctx.fillRect(x + 16, by, ((w - 32) * pct) / 100, 16)
    ctx.globalAlpha = 1
  })
  ctx.fillStyle = P.faint
  ctx.font = '11px ui-sans-serif, system-ui, sans-serif'
  ctx.fillText(`清晰度 ${(clarity * 100).toFixed(0)}%`, x + 12, y + h - 16)
}

function drawCard(ctx: CanvasRenderingContext2D, P: CanvasPalette, steps: number, mode: PosterMode) {
  const card = { x: 36, y: 28, w: 568, h: 340 }
  ctx.fillStyle = P.bg2
  ctx.fillRect(card.x, card.y, card.w, card.h)

  const locked = lockedCount(steps, mode)
  let cursor = 0
  cursor = drawRun(ctx, P, TITLE, card.x + 28, card.y + 58, 28, cursor, locked)

  ROWS.forEach((row, i) => {
    const y = card.y + 130 + i * 64
    const pct = barPct(row.target, i, steps)
    const barX = card.x + 132
    const barW = 250
    ctx.fillStyle = P.grid
    ctx.fillRect(barX, y - 14, barW, 18)
    ctx.fillStyle = P.accent
    ctx.globalAlpha = 0.45 + 0.55 * clarityOf(steps)
    ctx.fillRect(barX, y - 14, (barW * pct) / 100, 18)
    ctx.globalAlpha = 1
    cursor = drawRun(ctx, P, row.label, card.x + 28, y, 18, cursor, locked)
    cursor = drawRun(ctx, P, row.value, card.x + 408, y, 18, cursor, locked)
  })

  ctx.fillStyle = P.faint
  ctx.font = '12px ui-sans-serif, system-ui, sans-serif'
  ctx.textAlign = 'left'
  const note =
    mode === 'typeset' ? '红框不会出现。这些字是字体画的。' : '红框是还没锁上的字。柱子和字走的不是同一条路。'
  ctx.fillText(note, card.x + 28, card.y + card.h - 18)
}

function drawRun(
  ctx: CanvasRenderingContext2D,
  P: CanvasPalette,
  text: string,
  x: number,
  y: number,
  size: number,
  cursor: number,
  locked: number,
): number {
  ctx.font = `${size}px ui-sans-serif, system-ui, sans-serif`
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  let pen = x
  for (const ch of text) {
    if (ch === ' ') {
      pen += size * 0.34
      continue
    }
    const on = cursor < locked
    if (on) {
      ctx.fillStyle = P.text
      ctx.fillText(ch, pen, y)
      pen += ctx.measureText(ch).width + 2
    } else {
      const w = size * 0.72
      const h = size * 0.86
      ctx.strokeStyle = P.danger
      ctx.lineWidth = 1.25
      ctx.strokeRect(pen, y - h + 2, w, h)
      pen += w + 3
    }
    cursor += 1
  }
  return cursor
}

function drawCast(ctx: CanvasRenderingContext2D, P: CanvasPalette, anchor: boolean) {
  for (let i = 0; i < 3; i++) {
    const x = 28 + i * 204
    drawFigure(ctx, P, x, 36, 188, 300, i, anchor)
  }
  ctx.fillStyle = P.faint
  ctx.font = '12px ui-sans-serif, system-ui, sans-serif'
  ctx.textAlign = 'left'
  ctx.fillText(
    anchor ? '参考图的潜变量还在序列里，所以帽子不再重抽。' : '没有参考图。换一句提示，帽子就重新抽一次。',
    28,
    368,
  )
}

function drawFigure(
  ctx: CanvasRenderingContext2D,
  P: CanvasPalette,
  x: number,
  y: number,
  w: number,
  h: number,
  frame: number,
  anchor: boolean,
) {
  ctx.fillStyle = P.bg2
  ctx.fillRect(x, y, w, h)
  const stripe = 18 + frame * 22
  ctx.fillStyle = P.accent2
  ctx.fillRect(x + stripe, y + 16, 10, h - 48)

  const cx = x + w / 2
  const headY = y + 118
  const radius = hatRadius(frame, anchor)
  ctx.fillStyle = P.accent
  ctx.globalAlpha = 0.9
  ctx.beginPath()
  ctx.arc(cx, headY, radius, 0, Math.PI * 2)
  ctx.fill()
  ctx.globalAlpha = 1

  ctx.fillStyle = `hsl(${hatHue(frame, anchor)} 58% 42%)`
  ctx.fillRect(cx - radius, headY - radius - 10, radius * 2, 8)

  ctx.fillStyle = P.muted
  ctx.fillRect(cx - 16, headY + radius + 8, 32, 46)

  ctx.fillStyle = P.text
  ctx.font = '12px ui-sans-serif, system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText(`${hatHue(frame, anchor)}°`, cx, y + h - 22)
}

const MODES: { id: PosterMode; label: string }[] = [
  { id: 'flow', label: '直线' },
  { id: 'glyphs', label: '字在像素里' },
  { id: 'typeset', label: '字先排' },
  { id: 'cast', label: '一致性' },
]

function Infographic({ props }: { props: InfographicProps }) {
  const theme = useTheme()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [mode, setMode] = useState<PosterMode>(props.mode)
  const [steps, setSteps] = useState(props.steps)
  const [anchor, setAnchor] = useState(props.anchor)

  useEffect(() => setMode(props.mode), [props.mode])
  useEffect(() => setSteps(props.steps), [props.steps])
  useEffect(() => setAnchor(props.anchor), [props.anchor])

  const view = useMemo(() => {
    const n = Math.max(1, Math.min(MAX_STEPS, Math.round(steps)))
    return {
      n,
      straight: 0,
      curve: curveMiss(n),
      locked: lockedCount(n, mode),
      gap: hueGap(mode === 'cast' ? anchor : false),
    }
  }, [steps, mode, anchor])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = prepareCanvas(canvas, W, H)
    if (!ctx) return
    draw(ctx, palette(), mode, view.n, anchor)
  }, [theme, mode, view.n, anchor])

  return (
    <div className="lb-surface">
      <p className="t-strong text-sm">{headline(mode, view.n, anchor)}</p>
      <canvas
        ref={canvasRef}
        className="mt-3 touch-none"
        style={{ width: '100%', aspectRatio: `${W} / ${H}`, borderRadius: 8, touchAction: 'none' }}
      />
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <div className="t-panel inline-flex flex-wrap rounded-lg p-0.5">
          {MODES.map((item) => (
            <button
              key={item.id}
              onClick={() => setMode(item.id)}
              className={`rounded-[6px] px-2.5 py-1 text-xs font-medium transition-colors ${
                mode === item.id ? 't-btn-primary' : 't-muted'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
        {mode === 'cast' && (
          <button
            onClick={() => setAnchor((v) => !v)}
            className={`rounded-full px-3 py-1 text-xs font-medium ${anchor ? 't-btn-primary' : 't-btn'}`}
          >
            {anchor ? '有参考' : '无参考'}
          </button>
        )}
      </div>
      {mode !== 'cast' && (
        <div className="mt-3">
          <Slider label="步数" value={view.n} min={1} max={MAX_STEPS} step={1} onChange={setSteps} />
        </div>
      )}
      <div className="mt-3 flex flex-wrap gap-2 font-mono text-[11px] tabular-nums">
        {mode === 'flow' ? (
          <>
            <span className="t-panel rounded-full px-3 py-1">直线偏差 {fmt3(view.straight)}</span>
            <span className="t-panel rounded-full px-3 py-1">弯路偏差 {fmt3(view.curve)}</span>
          </>
        ) : mode === 'cast' ? (
          <span className="t-panel rounded-full px-3 py-1">帽色差 {view.gap}°</span>
        ) : (
          <span className="t-panel rounded-full px-3 py-1">
            错字 {GLYPHS - view.locked} / {GLYPHS}
          </span>
        )}
      </div>
      <p className="t-faint mt-2 text-xs leading-5">{detail(mode, view.n, anchor)}</p>
    </div>
  )
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (n: number) => void
}) {
  return (
    <label className="t-muted flex items-center gap-2 text-xs">
      <span className="w-10 shrink-0">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1"
      />
      <span className="t-strong w-8 text-right font-mono tabular-nums">{value}</span>
    </label>
  )
}

export const InfographicWidget: WidgetDefinition<InfographicProps> = {
  type: 'infographic',
  label: '信息图账本',
  description: '看直线流怎么把噪声收成柱子，字画在像素里为什么会错，以及没有参考图时角色对不上。',
  icon: '🖼️',
  defaultProps: { mode: 'flow', steps: 4, anchor: false },
  configSchema: [
    {
      key: 'mode',
      label: '模式',
      type: 'select',
      options: MODES.map((m) => ({ value: m.id, label: m.label })),
    },
    { key: 'steps', label: '步数', type: 'range', min: 1, max: MAX_STEPS, step: 1 },
    { key: 'anchor', label: '有参考图', type: 'checkbox' },
  ],
  Component: Infographic,
}
