import { useEffect, useMemo, useRef, useState } from 'react'
import { prepareCanvas, palette, type CanvasPalette } from '../lib/canvas'
import { useTheme } from '../lib/theme'
import type { WidgetDefinition } from './registry'

/**
 * 教学走廊，不是某一本教材里的格子世界。
 * 四格从左到右：起点、甲、乙、丙。离开丙马上拿到 10，前面三格马上是 0。
 * 这一格 = 马上拿到的 + 折扣 × 下一格。因为是确定的，走一趟就把格子改成新数。
 * 循环按离开的顺序从左往右写：改这一格时，下一格还是上一趟的数，所以分数每趟只往回一格。
 */

const FAR = 10
const NEAR = 3
const NAMES = ['起点', '甲', '乙', '丙'] as const
const W = 640
const H = 408

export type HallMode = 'back' | 'fork' | 'trips'

interface HallwayProps {
  mode: HallMode
  /** 0 到 1，步长 0.1 */
  discount: number
  trips: number
}

const MODES: { id: HallMode; label: string }[] = [
  { id: 'back', label: '回传' },
  { id: 'fork', label: '岔路' },
  { id: 'trips', label: '走趟' },
]

export function tenthOf(discount: number): number {
  const n = Math.round(Number(discount) * 10)
  if (!Number.isFinite(n)) return 5
  return Math.max(0, Math.min(10, n))
}

export function clampTrips(n: number): number {
  const x = Math.round(Number(n))
  if (!Number.isFinite(x)) return 1
  return Math.max(0, Math.min(8, x))
}

function powTenth(tenth: number, exp: number): number {
  let n = 1
  for (let i = 0; i < exp; i++) n *= tenth / 10
  return n
}

export function fmt3(n: number): string {
  return (Math.round(n * 1000) / 1000).toFixed(3)
}

/** 从左到右：起点、甲、乙、丙。丙是 10，往左每格多乘一次折扣。 */
export function hallwayValues(discount: number): number[] {
  const tenth = tenthOf(discount)
  return [3, 2, 1, 0].map((exp) => powTenth(tenth, exp) * FAR)
}

export function farAtFork(discount: number): number {
  return powTenth(tenthOf(discount), 3) * FAR
}

/**
 * 从左往右改。离开丙拿到 10，之后没有下一格。
 * 改前面几格时，右边还是这一趟开始前的数。
 */
export function walked(trips: number): number[] {
  const v = [0, 0, 0, 0]
  const n = clampTrips(trips)
  for (let t = 0; t < n; t++) {
    for (let i = 0; i < 4; i++) {
      const immediate = i === 3 ? FAR : 0
      const next = i === 3 ? 0 : v[i + 1]
      v[i] = immediate + 0.5 * next
    }
  }
  return v
}

/** 这一趟新写上的格子。第 1 趟写丙，第 4 趟写起点。再走就没有新格子。 */
export function freshIndex(trips: number): number | null {
  const n = clampTrips(trips)
  if (n < 1 || n > 4) return null
  return 4 - n
}

function headline(mode: HallMode, discount: number, trips: number): string {
  if (mode === 'fork') {
    const far = farAtFork(discount)
    if (far > NEAR) return `选远处的。传回来是 ${fmt3(far)}，眼前是 ${fmt3(NEAR)}。`
    return `选眼前的 ${fmt3(NEAR)}。远处传回来是 ${fmt3(far)}。`
  }
  if (mode === 'trips') {
    const v = walked(trips)
    return `走了 ${clampTrips(trips)} 趟。四格是 ${v.map(fmt3).join('、')}。`
  }
  const v = hallwayValues(discount)
  return `起点值 ${fmt3(v[0])}。四格是 ${v.map(fmt3).join('、')}。`
}

function detail(mode: HallMode, discount: number, trips: number): string {
  if (mode === 'fork') {
    const far = farAtFork(discount)
    return `左边走 1 步，马上拿到 ${NEAR}，折扣乘不上去。右边就是刚才那条走廊，10 写在丙上，传回岔路口要乘三次折扣，现在是 ${fmt3(far)}。`
  }
  if (mode === 'trips') {
    const n = clampTrips(trips)
    const idx = freshIndex(n)
    const wrote = idx === null ? '没有新的格子。数已经和折扣 0.5 时填完的一样。' : `这一趟新写上的是${NAMES[idx]}。`
    return `折扣固定 0.5。离开格子时，用的是下一格当时的数。下一格还是 0，这一格就写成 0。${wrote}`
  }
  const g = (tenthOf(discount) / 10).toFixed(1)
  return `离开丙马上拿到 10，所以丙是 10.000。往左每一格等于折扣 ${g} 乘右边那一格。马上拿到的只有丙那一步，前面三格都是 0。`
}

function Hallway({ props }: { props: HallwayProps }) {
  const theme = useTheme()
  const [mode, setMode] = useState<HallMode>(props.mode)
  const [discount, setDiscount] = useState(tenthOf(props.discount) / 10)
  const [trips, setTrips] = useState(clampTrips(props.trips))

  useEffect(() => setMode(props.mode), [props.mode])
  useEffect(() => setDiscount(tenthOf(props.discount) / 10), [props.discount])
  useEffect(() => setTrips(clampTrips(props.trips)), [props.trips])

  const view = useMemo(() => ({ mode, discount, trips }), [mode, discount, trips])

  const chips =
    mode === 'fork'
      ? [`眼前 ${fmt3(NEAR)}`, `远处 ${fmt3(farAtFork(discount))}`, farAtFork(discount) > NEAR ? '选远处' : '选眼前']
      : mode === 'trips'
        ? [`第 ${trips} 趟`, `起点 ${fmt3(walked(trips)[0])}`, freshIndex(trips) === null ? '没有新格子' : `写上${NAMES[freshIndex(trips)!]}`]
        : [`折扣 ${(tenthOf(discount) / 10).toFixed(1)}`, `起点 ${fmt3(hallwayValues(discount)[0])}`, `丙 ${fmt3(hallwayValues(discount)[3])}`]

  return (
    <div className="lb-surface">
      <p className="t-strong text-sm">{headline(view.mode, view.discount, view.trips)}</p>
      <HallCanvas theme={theme} view={view} />
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
      </div>
      <div className="mt-3">
        {mode === 'trips' ? (
          <Slider
            label="趟数"
            value={trips}
            min={0}
            max={8}
            step={1}
            text={String(trips)}
            onChange={(n) => setTrips(clampTrips(n))}
          />
        ) : (
          <Slider
            label="折扣"
            value={tenthOf(discount)}
            min={0}
            max={10}
            step={1}
            text={(tenthOf(discount) / 10).toFixed(1)}
            onChange={(n) => setDiscount(n / 10)}
          />
        )}
      </div>
      <div className="mt-3 flex flex-wrap gap-2 font-mono text-[11px] tabular-nums">
        {chips.map((item) => (
          <span key={item} className="t-panel rounded-full px-3 py-1">
            {item}
          </span>
        ))}
      </div>
      <p className="t-faint mt-2 text-xs leading-5">{detail(mode, discount, trips)}</p>
    </div>
  )
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  text,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  text: string
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
      <span className="t-strong w-10 text-right font-mono tabular-nums">{text}</span>
    </label>
  )
}

function HallCanvas({
  theme,
  view,
}: {
  theme: string
  view: { mode: HallMode; discount: number; trips: number }
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = prepareCanvas(canvas, W, H)
    if (!ctx) return
    const P = palette()
    ctx.clearRect(0, 0, W, H)
    ctx.fillStyle = P.bg
    ctx.fillRect(0, 0, W, H)
    if (view.mode === 'fork') drawFork(ctx, P, view.discount)
    else if (view.mode === 'trips') drawRow(ctx, P, walked(view.trips), NAMES, freshIndex(view.trips), '大数字是这一格值多少。小字是离开时马上拿到的。')
    else drawRow(ctx, P, hallwayValues(view.discount), NAMES, null, '大数字是这一格值多少。小字是离开时马上拿到的。')
  }, [theme, view])

  return (
    <canvas
      ref={canvasRef}
      className="mt-3 touch-none"
      style={{ width: '100%', aspectRatio: `${W} / ${H}`, borderRadius: 8, touchAction: 'none' }}
    />
  )
}

function drawRow(
  ctx: CanvasRenderingContext2D,
  P: CanvasPalette,
  values: number[],
  names: readonly string[],
  fresh: number | null,
  note: string,
) {
  ctx.fillStyle = P.muted
  ctx.font = '12px ui-sans-serif, system-ui, sans-serif'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillText(note, 28, 36)
  if (fresh !== null) {
    ctx.fillStyle = P.accent
    ctx.textAlign = 'right'
    ctx.fillText(`这一趟写上 ${names[fresh]}`, W - 28, 36)
  }
  const cellW = 118
  const cellH = 132
  const gap = 28
  const rowW = values.length * cellW + (values.length - 1) * gap
  const x0 = (W - rowW) / 2
  const y = 118
  values.forEach((value, i) => {
    const x = x0 + i * (cellW + gap)
    if (i > 0) drawArrow(ctx, P, x - gap + 4, y + cellH / 2, gap - 8)
    const immediate = i === values.length - 1 ? FAR : 0
    drawCell(ctx, P, x, y, cellW, cellH, names[i], value, immediate, i === fresh)
  })
}

function drawFork(ctx: CanvasRenderingContext2D, P: CanvasPalette, discount: number) {
  const far = farAtFork(discount)
  const right = hallwayValues(discount)
  const pickFar = far > NEAR

  ctx.font = '13px ui-sans-serif, system-ui, sans-serif'
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'
  ctx.fillStyle = pickFar ? P.muted : P.good
  ctx.fillText(pickFar ? '左边' : '左边 · 选这条', 28, 28)
  ctx.fillStyle = pickFar ? P.good : P.muted
  ctx.fillText(pickFar ? '右边 · 选这条' : '右边', 28, 214)

  drawCell(ctx, P, 28, 48, 200, 120, '岔口', NEAR, NEAR, !pickFar)
  drawArrow(ctx, P, 240, 108, 36)
  round(ctx, 284, 48, 200, 120, 12)
  ctx.fillStyle = P.bg2
  ctx.fill()
  ctx.strokeStyle = P.grid
  ctx.lineWidth = 1
  ctx.stroke()
  ctx.fillStyle = P.faint
  ctx.font = '12px ui-sans-serif, system-ui, sans-serif'
  ctx.textAlign = 'left'
  ctx.fillText('走 1 步就停', 300, 78)
  ctx.fillStyle = P.text
  ctx.font = '22px ui-monospace, monospace'
  ctx.fillText('马上 3', 300, 114)

  const cellW = 118
  const gap = 28
  const y = 240
  const names = ['岔口', '甲', '乙', '丙']
  right.forEach((value, i) => {
    const x = 28 + i * (cellW + gap)
    if (i > 0) drawArrow(ctx, P, x - gap + 4, y + 52, gap - 8)
    const immediate = i === 3 ? FAR : 0
    drawCell(ctx, P, x, y, cellW, 104, names[i], value, immediate, pickFar && i === 0, true)
  })
}

function drawCell(
  ctx: CanvasRenderingContext2D,
  P: CanvasPalette,
  x: number,
  y: number,
  w: number,
  h: number,
  name: string,
  value: number,
  immediate: number,
  hot: boolean,
  compact = false,
) {
  round(ctx, x, y, w, h, 12)
  ctx.fillStyle = value > 0 ? P.soft : P.bg2
  ctx.fill()
  ctx.lineWidth = hot ? 2 : 1
  ctx.strokeStyle = hot ? P.accent : P.grid
  ctx.stroke()
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = P.faint
  ctx.font = '12px ui-sans-serif, system-ui, sans-serif'
  ctx.fillText(name, x + 14, y + (compact ? 24 : 28))
  ctx.fillStyle = value > 0 ? P.text : P.faint
  ctx.font = compact ? '18px ui-monospace, monospace' : '22px ui-monospace, monospace'
  ctx.fillText(fmt3(value), x + 14, y + (compact ? 52 : 64))
  ctx.fillStyle = immediate > 0 ? P.accent : P.faint
  ctx.font = '12px ui-sans-serif, system-ui, sans-serif'
  ctx.fillText(`马上 ${immediate}`, x + 14, y + (compact ? 80 : 100))
}

function drawArrow(ctx: CanvasRenderingContext2D, P: CanvasPalette, x: number, y: number, w: number) {
  ctx.strokeStyle = P.ghost
  ctx.fillStyle = P.ghost
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(x, y)
  ctx.lineTo(x + w - 7, y)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(x + w - 7, y - 4)
  ctx.lineTo(x + w, y)
  ctx.lineTo(x + w - 7, y + 4)
  ctx.closePath()
  ctx.fill()
}

function round(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, r)
}

export const HallwayWidget: WidgetDefinition<HallwayProps> = {
  type: 'hallway',
  label: '走廊账本',
  description: '一条四格走廊。最后一格才有 10 分，看折扣怎么把这个分传回起点，以及走一趟能记住多远。',
  icon: '🍪',
  defaultProps: { mode: 'back', discount: 0.5, trips: 1 },
  configSchema: [
    {
      key: 'mode',
      label: '模式',
      type: 'select',
      options: MODES.map((m) => ({ value: m.id, label: m.label })),
    },
    { key: 'discount', label: '折扣', type: 'range', min: 0, max: 1, step: 0.1 },
    { key: 'trips', label: '趟数', type: 'range', min: 0, max: 8, step: 1 },
  ],
  Component: Hallway,
}
