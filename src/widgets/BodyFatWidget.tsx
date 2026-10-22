import { useEffect, useMemo, useRef, useState } from 'react'
import { prepareCanvas, palette, type CanvasPalette } from '../lib/canvas'
import { useTheme } from '../lib/theme'
import type { WidgetDefinition } from './registry'

/**
 * 教学体脂账，不是某一台秤的公式。
 * 截面：肢体看成一根导体，肌肉和脂肪并联。脂肪几乎不导电，所以占截面变大时，电阻涨、电流仍走肌肉。
 * 账本：全身看成一根等效圆柱。水 = 0.7 × 身高² / 电阻，去脂 = 水 / 0.73，脂肪 = 体重 − 去脂。
 * 喝水：同一个人加减若干升水，体重跟着加减，电阻按这根圆柱反算，再用同一套式子重估。身上的脂肪公斤数不动。
 * 0.7 来自教学电阻率 700 Ω·cm。0.73 是健康成人去脂体重里水的比例。两套电阻率不要互抄。
 */

const RHO_MUSCLE = 300
const RHO_FAT = 2500
const PATH_LENGTH = 100
const PATH_AREA = 70
const CYLINDER = 0.7
const HYDRATION = 0.73
const W = 640
const H = 420

export type BodyFatMode = 'path' | 'ledger' | 'day'

interface BodyFatProps {
  mode: BodyFatMode
  /** 脂肪占截面的百分比，5 到 55 */
  fatPct: number
  heightCm: number
  weightKg: number
  ohm: number
  /** 相对基准多出来的水，升。可以为负。 */
  waterDelta: number
}

const MODES: { id: BodyFatMode; label: string }[] = [
  { id: 'path', label: '截面' },
  { id: 'ledger', label: '账本' },
  { id: 'day', label: '喝水' },
]

export function fmt1(n: number): string {
  return (Math.round(n * 10) / 10).toFixed(1)
}

export function fmt2(n: number): string {
  return (Math.round(n * 100) / 100).toFixed(2)
}

export function clampMode(mode: string): BodyFatMode {
  if (mode === 'ledger' || mode === 'day' || mode === 'path') return mode
  return 'path'
}

export function clampFatPct(n: number): number {
  const x = Math.round(Number(n))
  if (!Number.isFinite(x)) return 25
  return Math.max(5, Math.min(55, x))
}

export function clampHeight(n: number): number {
  const x = Math.round(Number(n))
  if (!Number.isFinite(x)) return 170
  return Math.max(150, Math.min(200, x))
}

export function clampWeight(n: number): number {
  const x = Math.round(Number(n))
  if (!Number.isFinite(x)) return 70
  return Math.max(40, Math.min(120, x))
}

export function clampOhm(n: number): number {
  const x = Math.round(Number(n) / 5) * 5
  if (!Number.isFinite(x)) return 500
  return Math.max(350, Math.min(800, x))
}

export function clampWater(n: number): number {
  const x = Math.round(Number(n) * 10)
  if (!Number.isFinite(x)) return 0
  return Math.max(-20, Math.min(20, x)) / 10
}

export interface PathStats {
  fatPct: number
  ohm: number
  fatShare: number
  muscleShare: number
}

/** 脂肪和肌肉沿同一段长度并联。电流占比等于各自电导占总电导的比例。 */
export function pathOhm(fatPct: number): PathStats {
  const pct = clampFatPct(fatPct)
  const f = pct / 100
  const k = (1 - f) / RHO_MUSCLE + f / RHO_FAT
  return {
    fatPct: pct,
    ohm: PATH_LENGTH / (PATH_AREA * k),
    fatShare: f / RHO_FAT / k,
    muscleShare: (1 - f) / RHO_MUSCLE / k,
  }
}

export interface LedgerStats {
  height: number
  weight: number
  ohm: number
  index: number
  water: number
  lean: number
  fat: number
  pct: number
}

export function bodyLedger(heightCm: number, weightKg: number, ohm: number): LedgerStats {
  const height = clampHeight(heightCm)
  const weight = clampWeight(weightKg)
  const resistance = clampOhm(ohm)
  const index = (height * height) / resistance
  const water = CYLINDER * index
  const lean = water / HYDRATION
  const fat = weight - lean
  return {
    height,
    weight,
    ohm: resistance,
    index,
    water,
    lean,
    fat,
    pct: (fat / weight) * 100,
  }
}

export interface DayStats {
  delta: number
  weight: number
  ohm: number
  trueFat: number
  truePct: number
  fat: number
  pct: number
  water: number
}

/** 基准人是 170 cm、70 kg、500 Ω。加水时体重同步加，电阻按圆柱反算。 */
export function dayReading(waterDelta: number): DayStats {
  const base = bodyLedger(170, 70, 500)
  const delta = clampWater(waterDelta)
  const water = base.water + delta
  const weight = base.weight + delta
  const ohm = (CYLINDER * base.height * base.height) / water
  const lean = water / HYDRATION
  const fat = weight - lean
  return {
    delta,
    weight,
    ohm,
    trueFat: base.fat,
    truePct: (base.fat / weight) * 100,
    fat,
    pct: (fat / weight) * 100,
    water,
  }
}

export function pathHeadline(fatPct: number): string {
  const s = pathOhm(fatPct)
  return `脂肪占截面 ${s.fatPct}% 时，电阻 ${Math.round(s.ohm)} Ω。电流里脂肪只占 ${fmt1(s.fatShare * 100)}%。`
}

export function ledgerHeadline(heightCm: number, weightKg: number, ohm: number): string {
  const s = bodyLedger(heightCm, weightKg, ohm)
  if (s.fat < 0) {
    return `去脂 ${fmt2(s.lean)} kg，已经超过体重 ${fmt2(s.weight)} kg。脂肪记成 0.00 kg。`
  }
  return `脂肪 ${fmt2(s.fat)} kg，体脂率 ${fmt1(s.pct)}%。水 ${fmt2(s.water)} L，去脂 ${fmt2(s.lean)} kg。`
}

export function dayHeadline(waterDelta: number): string {
  const s = dayReading(waterDelta)
  if (s.delta === 0) {
    return `水没变。身上和秤上都是 ${fmt2(s.trueFat)} kg，体脂率 ${fmt1(s.pct)}%。`
  }
  return `身上的脂肪还是 ${fmt2(s.trueFat)} kg（${fmt1(s.truePct)}%）。秤写成 ${fmt2(s.fat)} kg（${fmt1(s.pct)}%）。`
}

function headline(props: BodyFatProps): string {
  if (props.mode === 'ledger') return ledgerHeadline(props.heightCm, props.weightKg, props.ohm)
  if (props.mode === 'day') return dayHeadline(props.waterDelta)
  return pathHeadline(props.fatPct)
}

function detail(props: BodyFatProps): string {
  if (props.mode === 'ledger') {
    const s = bodyLedger(props.heightCm, props.weightKg, props.ohm)
    return `指数 ${fmt2(s.index)} = ${s.height}² / ${s.ohm}。水 = 0.700 × 指数。去脂 = 水 / 0.73。脂肪 = 体重 − 去脂。这是一根等效圆柱，不是脚到脚那一屏的电阻。`
  }
  if (props.mode === 'day') {
    const s = dayReading(props.waterDelta)
    const moved = fmt2(Math.abs(s.trueFat - s.fat))
    const waterLine =
      s.delta === 0
        ? '水和基准一样'
        : `水比基准${s.delta > 0 ? '多' : '少'} ${fmt1(Math.abs(s.delta))} L`
    return `基准是 170 cm、70 kg、500 Ω。${waterLine}，体重 ${fmt1(s.weight)} kg，电阻 ${fmt1(s.ohm)} Ω。秤上的脂肪和身上相差 ${moved} kg。每升约 0.37 kg，来自 1 − 1/0.73。`
  }
  const s = pathOhm(props.fatPct)
  return `教学圆柱长 ${PATH_LENGTH} cm、截面 ${PATH_AREA} cm²。肌肉 ${RHO_MUSCLE}、脂肪 ${RHO_FAT}，单位 Ω·cm，并联。肌肉电流 ${fmt1(s.muscleShare * 100)}%。`
}

function BodyFat({ props }: { props: BodyFatProps }) {
  const theme = useTheme()
  const [mode, setMode] = useState<BodyFatMode>(clampMode(props.mode))
  const [fatPct, setFatPct] = useState(clampFatPct(props.fatPct))
  const [heightCm, setHeightCm] = useState(clampHeight(props.heightCm))
  const [weightKg, setWeightKg] = useState(clampWeight(props.weightKg))
  const [ohm, setOhm] = useState(clampOhm(props.ohm))
  const [waterDelta, setWaterDelta] = useState(clampWater(props.waterDelta))

  useEffect(() => setMode(clampMode(props.mode)), [props.mode])
  useEffect(() => setFatPct(clampFatPct(props.fatPct)), [props.fatPct])
  useEffect(() => setHeightCm(clampHeight(props.heightCm)), [props.heightCm])
  useEffect(() => setWeightKg(clampWeight(props.weightKg)), [props.weightKg])
  useEffect(() => setOhm(clampOhm(props.ohm)), [props.ohm])
  useEffect(() => setWaterDelta(clampWater(props.waterDelta)), [props.waterDelta])

  const view = useMemo<BodyFatProps>(
    () => ({ mode, fatPct, heightCm, weightKg, ohm, waterDelta }),
    [mode, fatPct, heightCm, weightKg, ohm, waterDelta],
  )

  const chips =
    mode === 'ledger'
      ? (() => {
          const s = bodyLedger(heightCm, weightKg, ohm)
          return [`指数 ${fmt2(s.index)}`, `水 ${fmt2(s.water)} L`, `脂肪 ${fmt2(Math.max(0, s.fat))} kg`]
        })()
      : mode === 'day'
        ? (() => {
            const s = dayReading(waterDelta)
            return [`多 ${fmt1(s.delta)} L`, `体重 ${fmt1(s.weight)} kg`, `电阻 ${fmt1(s.ohm)} Ω`]
          })()
        : (() => {
            const s = pathOhm(fatPct)
            return [
              `电阻 ${Math.round(s.ohm)} Ω`,
              `脂肪电流 ${fmt1(s.fatShare * 100)}%`,
              `肌肉电流 ${fmt1(s.muscleShare * 100)}%`,
            ]
          })()

  return (
    <div className="lb-surface">
      <p className="t-strong text-sm">{headline(view)}</p>
      <BodyCanvas theme={theme} view={view} />
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
      <div className="mt-3 space-y-2">
        {mode === 'path' ? (
          <Slider
            label="脂肪截面"
            value={fatPct}
            min={5}
            max={55}
            step={1}
            text={`${fatPct}%`}
            onChange={(n) => setFatPct(clampFatPct(n))}
          />
        ) : null}
        {mode === 'ledger' ? (
          <>
            <Slider label="身高" value={heightCm} min={150} max={200} step={1} text={`${heightCm}`} onChange={(n) => setHeightCm(clampHeight(n))} />
            <Slider label="体重" value={weightKg} min={40} max={120} step={1} text={`${weightKg}`} onChange={(n) => setWeightKg(clampWeight(n))} />
            <Slider label="电阻" value={ohm} min={350} max={800} step={5} text={`${ohm}`} onChange={(n) => setOhm(clampOhm(n))} />
          </>
        ) : null}
        {mode === 'day' ? (
          <Slider
            label="多的水"
            value={Math.round(waterDelta * 10)}
            min={-20}
            max={20}
            step={1}
            text={fmt1(waterDelta)}
            onChange={(n) => setWaterDelta(clampWater(n / 10))}
          />
        ) : null}
      </div>
      <div className="mt-3 flex flex-wrap gap-2 font-mono text-[11px] tabular-nums">
        {chips.map((item) => (
          <span key={item} className="t-panel rounded-full px-3 py-1">
            {item}
          </span>
        ))}
      </div>
      <p className="t-faint mt-2 text-xs leading-5">{detail(view)}</p>
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
      <span className="w-16 shrink-0">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1"
      />
      <span className="t-strong w-12 text-right font-mono tabular-nums">{text}</span>
    </label>
  )
}

function BodyCanvas({ theme, view }: { theme: string; view: BodyFatProps }) {
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
    if (view.mode === 'ledger') drawLedger(ctx, P, bodyLedger(view.heightCm, view.weightKg, view.ohm))
    else if (view.mode === 'day') drawDay(ctx, P, dayReading(view.waterDelta))
    else drawPath(ctx, P, pathOhm(view.fatPct))
  }, [theme, view])

  return (
    <canvas
      ref={canvasRef}
      className="mt-3 touch-none"
      style={{ width: '100%', aspectRatio: `${W} / ${H}`, borderRadius: 8, touchAction: 'none' }}
    />
  )
}

function drawPath(ctx: CanvasRenderingContext2D, P: CanvasPalette, stats: PathStats) {
  note(ctx, P, '外圈是脂肪，内圈是肌肉。右边是这一截面上的电流怎么分。')
  const cx = 168
  const cy = 230
  const radius = 112
  const inner = radius * Math.sqrt(Math.max(0, 1 - stats.fatPct / 100))

  ctx.beginPath()
  ctx.arc(cx, cy, radius, 0, Math.PI * 2)
  ctx.fillStyle = P.warn
  ctx.globalAlpha = 0.9
  ctx.fill()
  ctx.globalAlpha = 1
  ctx.beginPath()
  ctx.arc(cx, cy, inner, 0, Math.PI * 2)
  ctx.fillStyle = P.accent
  ctx.fill()
  ctx.lineWidth = 1
  ctx.strokeStyle = P.bg
  ctx.stroke()

  ctx.font = '12px ui-sans-serif, system-ui, sans-serif'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  dot(ctx, P.accent, 78, 372)
  ctx.fillStyle = P.muted
  ctx.fillText('肌肉', 92, 372)
  dot(ctx, P.warn, 150, 372)
  ctx.fillStyle = P.muted
  ctx.fillText('脂肪', 164, 372)

  const rows = [
    { label: '肌肉', share: stats.muscleShare, color: P.accent },
    { label: '脂肪', share: stats.fatShare, color: P.warn },
  ]
  rows.forEach((row, i) => {
    const y = 150 + i * 88
    ctx.fillStyle = P.faint
    ctx.font = '13px ui-sans-serif, system-ui, sans-serif'
    ctx.textAlign = 'left'
    ctx.fillText(row.label, 340, y)
    ctx.fillStyle = P.text
    ctx.font = '13px ui-monospace, monospace'
    ctx.textAlign = 'right'
    ctx.fillText(`${fmt1(row.share * 100)}%`, 612, y)
    round(ctx, 340, y + 16, 272, 18, 9)
    ctx.fillStyle = P.bg2
    ctx.fill()
    const width = Math.max(4, 272 * row.share)
    round(ctx, 340, y + 16, width, 18, 9)
    ctx.fillStyle = row.color
    ctx.fill()
  })
}

function drawLedger(ctx: CanvasRenderingContext2D, P: CanvasPalette, stats: LedgerStats) {
  note(ctx, P, '脂肪是减出来的。水由身高和电阻决定，去脂假定 73% 是水。')
  const rows: { name: string; formula: string; value: string; hot?: boolean }[] = [
    { name: '指数', formula: `${stats.height}² / ${stats.ohm}`, value: fmt2(stats.index) },
    { name: '水', formula: '0.700 × 指数', value: `${fmt2(stats.water)} L` },
    { name: '去脂', formula: '水 / 0.73', value: `${fmt2(stats.lean)} kg` },
    {
      name: '脂肪',
      formula: '体重 − 去脂',
      value: stats.fat < 0 ? '0.00 kg' : `${fmt2(stats.fat)} kg`,
      hot: true,
    },
  ]
  rows.forEach((row, i) => {
    const y = 78 + i * 72
    round(ctx, 36, y, 568, 58, 12)
    ctx.fillStyle = row.hot ? P.soft : P.bg2
    ctx.fill()
    ctx.lineWidth = row.hot ? 1.5 : 1
    ctx.strokeStyle = row.hot ? P.accent : P.grid
    ctx.stroke()
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = P.text
    ctx.font = '15px ui-sans-serif, system-ui, sans-serif'
    ctx.fillText(row.name, 56, y + 29)
    ctx.fillStyle = P.faint
    ctx.font = '14px ui-sans-serif, system-ui, sans-serif'
    ctx.fillText(row.formula, 120, y + 29)
    ctx.textAlign = 'right'
    ctx.fillStyle = row.hot ? P.accent : P.text
    ctx.font = '18px ui-monospace, monospace'
    ctx.fillText(row.value, 580, y + 29)
  })
}

function drawDay(ctx: CanvasRenderingContext2D, P: CanvasPalette, stats: DayStats) {
  note(ctx, P, '左边公斤数不随喝水改变。右边用同一套公式重算。')
  const cards = [
    { title: '身上的脂肪', kg: stats.trueFat, pct: stats.truePct, hot: false },
    { title: '秤上的脂肪', kg: stats.fat, pct: stats.pct, hot: stats.delta !== 0 },
  ]
  cards.forEach((card, i) => {
    const x = 36 + i * 300
    round(ctx, x, 92, 268, 210, 16)
    ctx.fillStyle = card.hot ? P.soft : P.bg2
    ctx.fill()
    ctx.lineWidth = card.hot ? 1.5 : 1
    ctx.strokeStyle = card.hot ? P.accent : P.grid
    ctx.stroke()
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = P.faint
    ctx.font = '14px ui-sans-serif, system-ui, sans-serif'
    ctx.fillText(card.title, x + 24, 132)
    ctx.fillStyle = P.text
    ctx.font = '36px ui-monospace, monospace'
    ctx.fillText(fmt2(card.kg), x + 24, 188)
    ctx.fillStyle = P.muted
    ctx.font = '14px ui-sans-serif, system-ui, sans-serif'
    ctx.fillText('kg', x + 168, 196)
    ctx.fillStyle = card.hot ? P.accent : P.muted
    ctx.font = '16px ui-monospace, monospace'
    ctx.fillText(`体脂率 ${fmt1(card.pct)}%`, x + 24, 250)
  })
  ctx.fillStyle = P.faint
  ctx.font = '13px ui-sans-serif, system-ui, sans-serif'
  ctx.textAlign = 'left'
  ctx.fillText(`这一刻体重 ${fmt1(stats.weight)} kg，电阻 ${fmt1(stats.ohm)} Ω。身上的体脂率用这个新体重做分母。`, 36, 360)
}

function note(ctx: CanvasRenderingContext2D, P: CanvasPalette, text: string) {
  ctx.fillStyle = P.muted
  ctx.font = '13px ui-sans-serif, system-ui, sans-serif'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, 28, 36)
}

function dot(ctx: CanvasRenderingContext2D, color: string, x: number, y: number) {
  ctx.beginPath()
  ctx.arc(x, y, 5, 0, Math.PI * 2)
  ctx.fillStyle = color
  ctx.fill()
}

function round(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, r)
}

export const BodyFatWidget: WidgetDefinition<BodyFatProps> = {
  type: 'body-fat',
  label: '体脂账本',
  description: '脚到脚的电流几乎不走脂肪。脂肪是用身高、电阻和 73% 的含水，从体重里减出来的。',
  icon: '⚖️',
  defaultProps: { mode: 'path', fatPct: 25, heightCm: 170, weightKg: 70, ohm: 500, waterDelta: 0 },
  configSchema: [
    {
      key: 'mode',
      label: '模式',
      type: 'select',
      options: MODES.map((m) => ({ value: m.id, label: m.label })),
    },
    { key: 'fatPct', label: '脂肪截面 %', type: 'range', min: 5, max: 55, step: 1 },
    { key: 'heightCm', label: '身高 cm', type: 'range', min: 150, max: 200, step: 1 },
    { key: 'weightKg', label: '体重 kg', type: 'range', min: 40, max: 120, step: 1 },
    { key: 'ohm', label: '电阻 Ω', type: 'range', min: 350, max: 800, step: 5 },
    { key: 'waterDelta', label: '多的水 L', type: 'range', min: -2, max: 2, step: 0.1 },
  ],
  Component: BodyFat,
}
