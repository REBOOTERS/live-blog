import { useEffect, useMemo, useRef, useState } from 'react'
import { prepareCanvas, palette, type CanvasPalette } from '../lib/canvas'
import { useAnimationFrame } from '../lib/useAnimationFrame'
import { useTheme } from '../lib/theme'
import type { WidgetDefinition } from './registry'

/**
 * 教学制冷账，不是某一台空调的标定。
 * 室内搬走的热量 Qe = COP × W。室外必须收下 Qc = Qe + W。
 * 蒸发温度取室内 − 20°C，冷凝温度取室外 + 10°C，排气温度取冷凝 + 25°C。
 * 制热把蒸发器和冷凝器对调：室内收下 Qe + W，室外被抽走 Qe。
 */

const W = 640
const H = 420

export type AirConMode = 'move' | 'cycle' | 'heat'
export type AirDirection = 'cool' | 'warm'

interface AirConProps {
  mode: AirConMode
  /** 压缩机耗电，千瓦 */
  watts: number
  /** 制冷能效比 COP = 室内搬走的热 / 耗电 */
  cop: number
  indoorC: number
  outdoorC: number
  direction: AirDirection
}

const MODES: { id: AirConMode; label: string }[] = [
  { id: 'move', label: '搬热' },
  { id: 'cycle', label: '四站' },
  { id: 'heat', label: '掉头' },
]

const DIRECTIONS: { id: AirDirection; label: string }[] = [
  { id: 'cool', label: '制冷' },
  { id: 'warm', label: '制热' },
]

export function clampMode(mode: string): AirConMode {
  if (mode === 'cycle' || mode === 'heat' || mode === 'move') return mode
  return 'move'
}

export function clampDirection(direction: string): AirDirection {
  return direction === 'warm' ? 'warm' : 'cool'
}

export function clampWatts(n: number): number {
  const x = Math.round(Number(n) * 10) / 10
  if (!Number.isFinite(x)) return 1
  return Math.max(0.5, Math.min(2.5, x))
}

export function clampCop(n: number): number {
  const x = Math.round(Number(n) * 10) / 10
  if (!Number.isFinite(x)) return 3
  return Math.max(2, Math.min(5, x))
}

export function clampIndoor(n: number): number {
  const x = Math.round(Number(n))
  if (!Number.isFinite(x)) return 27
  return Math.max(18, Math.min(32, x))
}

export function clampOutdoor(n: number): number {
  const x = Math.round(Number(n))
  if (!Number.isFinite(x)) return 35
  return Math.max(-5, Math.min(45, x))
}

export function fmt1(n: number): string {
  return (Math.round(n * 10) / 10).toFixed(1)
}

export function fmt0(n: number): string {
  return String(Math.round(n))
}

/** 蒸发侧空气温度减 20°C，冷凝侧空气温度加 10°C。空气本身先各自夹紧。 */
export function evaporatingC(airC: number): number {
  return airC - 20
}

export function condensingC(airC: number): number {
  return airC + 10
}

export function dischargeC(outdoorC: number): number {
  return condensingC(clampOutdoor(outdoorC)) + 25
}

export interface HeatLedger {
  watts: number
  cop: number
  qIn: number
  qOut: number
  indoorC: number
  outdoorC: number
}

export function heatLedger(watts: number, cop: number, indoorC: number, outdoorC: number): HeatLedger {
  const w = clampWatts(watts)
  const c = clampCop(cop)
  const qIn = c * w
  return {
    watts: w,
    cop: c,
    qIn,
    qOut: qIn + w,
    indoorC: clampIndoor(indoorC),
    outdoorC: clampOutdoor(outdoorC),
  }
}

/** 卡诺制冷上限：Te / (Tc − Te)，温度用开尔文。 */
export function carnotCool(indoorC: number, outdoorC: number): number {
  const te = evaporatingC(indoorC) + 273.15
  const tc = condensingC(outdoorC) + 273.15
  return te / (tc - te)
}

export interface CycleStats {
  te: number
  tc: number
  td: number
  indoorC: number
  outdoorC: number
  carnot: number
}

export function cycleStats(indoorC: number, outdoorC: number): CycleStats {
  const indoor = clampIndoor(indoorC)
  const outdoor = clampOutdoor(outdoorC)
  return {
    te: evaporatingC(indoor),
    tc: condensingC(outdoor),
    td: dischargeC(outdoor),
    indoorC: indoor,
    outdoorC: outdoor,
    carnot: carnotCool(indoor, outdoor),
  }
}

export function moveHeadline(watts: number, cop: number): string {
  const s = heatLedger(watts, cop, 27, 35)
  return `${fmt1(s.watts)} kW 电，室内搬走 ${fmt1(s.qIn)} kW 热，室外要收下 ${fmt1(s.qOut)} kW。`
}

export function cycleHeadline(indoorC: number, outdoorC: number): string {
  const s = cycleStats(indoorC, outdoorC)
  return `室外 ${fmt0(s.outdoorC)}°C 时，冷凝约 ${fmt0(s.tc)}°C，蒸发约 ${fmt0(s.te)}°C。压缩机出口大约 ${fmt0(s.td)}°C。`
}

export function heatHeadline(direction: AirDirection, watts: number, cop: number, outdoorC: number): string {
  const s = heatLedger(watts, cop, 27, outdoorC)
  if (direction === 'warm') {
    return `掉头之后，${fmt1(s.watts)} kW 电给室内送来 ${fmt1(s.qOut)} kW 热。室外被抽走 ${fmt1(s.qIn)} kW。`
  }
  return `制冷时，${fmt1(s.watts)} kW 电从室内搬走 ${fmt1(s.qIn)} kW。室外收下 ${fmt1(s.qOut)} kW。`
}

function headline(props: AirConProps): string {
  if (props.mode === 'cycle') return cycleHeadline(props.indoorC, props.outdoorC)
  if (props.mode === 'heat') return heatHeadline(props.direction, props.watts, props.cop, props.outdoorC)
  return moveHeadline(props.watts, props.cop)
}

function detail(props: AirConProps): string {
  if (props.mode === 'cycle') {
    const s = cycleStats(props.indoorC, props.outdoorC)
    return `蒸发取室内 − 20°C，冷凝取室外 + 10°C，排气取冷凝 + 25°C。卡诺制冷上限 ${fmt1(s.carnot)}。真机能效比通常远低于这个数。`
  }
  if (props.mode === 'heat') {
    const s = heatLedger(props.watts, props.cop, 27, props.outdoorC)
    if (props.direction === 'warm') {
      return `制热能效比 = (Qe + W) / W = ${fmt1(s.cop + 1)}。室外盘管变成蒸发器，温度大约 ${fmt0(evaporatingC(props.outdoorC))}°C。太冷时结霜。`
    }
    return `制冷能效比 COP = Qe / W = ${fmt1(s.cop)}。同一台机器，四通阀一换，两台换热器角色对调。`
  }
  const s = heatLedger(props.watts, props.cop, props.indoorC, props.outdoorC)
  return `Qe = COP × W = ${fmt1(s.qIn)} kW。Qc = Qe + W = ${fmt1(s.qOut)} kW。空调不消灭热，只是把热连同压缩机做的功一起搬到室外。`
}

function AirCon({ props }: { props: AirConProps }) {
  const theme = useTheme()
  const [mode, setMode] = useState<AirConMode>(clampMode(props.mode))
  const [watts, setWatts] = useState(clampWatts(props.watts))
  const [cop, setCop] = useState(clampCop(props.cop))
  const [indoorC, setIndoorC] = useState(clampIndoor(props.indoorC))
  const [outdoorC, setOutdoorC] = useState(clampOutdoor(props.outdoorC))
  const [direction, setDirection] = useState<AirDirection>(clampDirection(props.direction))

  useEffect(() => setMode(clampMode(props.mode)), [props.mode])
  useEffect(() => setWatts(clampWatts(props.watts)), [props.watts])
  useEffect(() => setCop(clampCop(props.cop)), [props.cop])
  useEffect(() => setIndoorC(clampIndoor(props.indoorC)), [props.indoorC])
  useEffect(() => setOutdoorC(clampOutdoor(props.outdoorC)), [props.outdoorC])
  useEffect(() => setDirection(clampDirection(props.direction)), [props.direction])

  const view = useMemo<AirConProps>(
    () => ({ mode, watts, cop, indoorC, outdoorC, direction }),
    [mode, watts, cop, indoorC, outdoorC, direction],
  )

  const chips =
    mode === 'cycle'
      ? (() => {
          const s = cycleStats(indoorC, outdoorC)
          return [`蒸发 ${fmt0(s.te)}°C`, `冷凝 ${fmt0(s.tc)}°C`, `卡诺 ${fmt1(s.carnot)}`]
        })()
      : mode === 'heat'
        ? (() => {
            const s = heatLedger(watts, cop, 27, outdoorC)
            return direction === 'warm'
              ? [`室内 +${fmt1(s.qOut)} kW`, `室外 −${fmt1(s.qIn)} kW`, `制热 COP ${fmt1(s.cop + 1)}`]
              : [`室内 −${fmt1(s.qIn)} kW`, `室外 +${fmt1(s.qOut)} kW`, `制冷 COP ${fmt1(s.cop)}`]
          })()
        : (() => {
            const s = heatLedger(watts, cop, indoorC, outdoorC)
            return [`电 ${fmt1(s.watts)} kW`, `室内 −${fmt1(s.qIn)} kW`, `室外 +${fmt1(s.qOut)} kW`]
          })()

  return (
    <div className="lb-surface">
      <p className="t-strong text-sm">{headline(view)}</p>
      <AirCanvas view={view} theme={theme} />
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
        {mode === 'heat' ? (
          <div className="t-panel inline-flex flex-wrap rounded-lg p-0.5">
            {DIRECTIONS.map((item) => (
              <button
                key={item.id}
                onClick={() => setDirection(item.id)}
                className={`rounded-[6px] px-2.5 py-1 text-xs font-medium transition-colors ${
                  direction === item.id ? 't-btn-primary' : 't-muted'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <div className="mt-3 space-y-2">
        {mode === 'move' ? (
          <>
            <Slider
              label="耗电"
              value={Math.round(watts * 10)}
              min={5}
              max={25}
              step={1}
              text={`${fmt1(watts)}`}
              onChange={(n) => setWatts(clampWatts(n / 10))}
            />
            <Slider
              label="COP"
              value={Math.round(cop * 10)}
              min={20}
              max={50}
              step={1}
              text={fmt1(cop)}
              onChange={(n) => setCop(clampCop(n / 10))}
            />
          </>
        ) : null}
        {mode === 'cycle' ? (
          <>
            <Slider
              label="室内"
              value={indoorC}
              min={18}
              max={32}
              step={1}
              text={`${indoorC}`}
              onChange={(n) => setIndoorC(clampIndoor(n))}
            />
            <Slider
              label="室外"
              value={outdoorC}
              min={-5}
              max={45}
              step={1}
              text={`${outdoorC}`}
              onChange={(n) => setOutdoorC(clampOutdoor(n))}
            />
          </>
        ) : null}
        {mode === 'heat' ? (
          <>
            <Slider
              label="耗电"
              value={Math.round(watts * 10)}
              min={5}
              max={25}
              step={1}
              text={`${fmt1(watts)}`}
              onChange={(n) => setWatts(clampWatts(n / 10))}
            />
            <Slider
              label="COP"
              value={Math.round(cop * 10)}
              min={20}
              max={50}
              step={1}
              text={fmt1(cop)}
              onChange={(n) => setCop(clampCop(n / 10))}
            />
            <Slider
              label="室外"
              value={outdoorC}
              min={-5}
              max={45}
              step={1}
              text={`${outdoorC}`}
              onChange={(n) => setOutdoorC(clampOutdoor(n))}
            />
          </>
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

function AirCanvas({ theme, view }: { theme: string; view: AirConProps }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const phaseRef = useRef(0)
  const viewRef = useRef(view)
  viewRef.current = view

  useAnimationFrame((dt) => {
    phaseRef.current = (phaseRef.current + dt * 0.35) % 1
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = prepareCanvas(canvas, W, H)
    if (!ctx) return
    // theme 参与闭包，切主题时回调会被换成新的。
    void theme
    const P = palette()
    const current = viewRef.current
    ctx.clearRect(0, 0, W, H)
    ctx.fillStyle = P.bg
    ctx.fillRect(0, 0, W, H)
    if (current.mode === 'cycle') {
      drawCycle(ctx, P, cycleStats(current.indoorC, current.outdoorC), phaseRef.current)
    } else if (current.mode === 'heat') {
      drawHeat(
        ctx,
        P,
        heatLedger(current.watts, current.cop, 27, current.outdoorC),
        current.direction,
        current.outdoorC,
      )
    } else {
      drawMove(ctx, P, heatLedger(current.watts, current.cop, current.indoorC, current.outdoorC))
    }
  })

  return (
    <canvas
      ref={canvasRef}
      className="mt-3 touch-none"
      style={{ width: '100%', aspectRatio: `${W} / ${H}`, borderRadius: 8, touchAction: 'none' }}
    />
  )
}

function drawMove(ctx: CanvasRenderingContext2D, P: CanvasPalette, stats: HeatLedger) {
  note(ctx, P, '左边是室内少掉的热，右边是室外多出来的热。中间那一格是电。')

  const cards = [
    {
      title: '室内搬走',
      value: `−${fmt1(stats.qIn)}`,
      unit: 'kW',
      sub: `空气大约 ${fmt0(stats.indoorC)}°C`,
      color: P.accent,
      hot: true,
    },
    {
      title: '压缩机耗电',
      value: fmt1(stats.watts),
      unit: 'kW',
      sub: `COP ${fmt1(stats.cop)}`,
      color: P.warn,
      hot: false,
    },
    {
      title: '室外收下',
      value: `+${fmt1(stats.qOut)}`,
      unit: 'kW',
      sub: `空气大约 ${fmt0(stats.outdoorC)}°C`,
      color: P.danger,
      hot: true,
    },
  ]

  cards.forEach((card, i) => {
    const x = 28 + i * 200
    round(ctx, x, 78, 184, 230, 16)
    ctx.fillStyle = card.hot ? P.soft : P.bg2
    ctx.fill()
    ctx.lineWidth = card.hot ? 1.5 : 1
    ctx.strokeStyle = card.hot ? card.color : P.grid
    ctx.stroke()

    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = P.faint
    ctx.font = '13px ui-sans-serif, system-ui, sans-serif'
    ctx.fillText(card.title, x + 18, 112)

    ctx.fillStyle = card.color
    ctx.font = '34px ui-monospace, monospace'
    ctx.fillText(card.value, x + 18, 178)

    ctx.fillStyle = P.muted
    ctx.font = '14px ui-sans-serif, system-ui, sans-serif'
    ctx.fillText(card.unit, x + 18, 218)

    ctx.fillStyle = P.faint
    ctx.font = '13px ui-sans-serif, system-ui, sans-serif'
    ctx.fillText(card.sub, x + 18, 268)
  })

  ctx.fillStyle = P.faint
  ctx.font = '13px ui-sans-serif, system-ui, sans-serif'
  ctx.textAlign = 'left'
  ctx.fillText(`${fmt1(stats.qIn)} + ${fmt1(stats.watts)} = ${fmt1(stats.qOut)}。室外那一格永远比室内多出压缩机做的功。`, 28, 350)
}

function drawCycle(ctx: CanvasRenderingContext2D, P: CanvasPalette, stats: CycleStats, phase: number) {
  note(ctx, P, '制冷剂顺时针走一圈。低压吸热，高压放热。')

  const cx = 210
  const cy = 230
  const rx = 128
  const ry = 110

  ctx.strokeStyle = P.grid
  ctx.lineWidth = 10
  ctx.beginPath()
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2)
  ctx.stroke()

  ctx.strokeStyle = P.accent
  ctx.globalAlpha = 0.35
  ctx.lineWidth = 4
  ctx.beginPath()
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2)
  ctx.stroke()
  ctx.globalAlpha = 1

  const stations: {
    label: string
    sub: string
    angle: number
    color: string
  }[] = [
    { label: '蒸发器', sub: `${fmt0(stats.te)}°C 气`, angle: Math.PI * 0.15, color: P.accent },
    { label: '压缩机', sub: `${fmt0(stats.td)}°C 热气`, angle: Math.PI * 1.15, color: P.warn },
    { label: '冷凝器', sub: `${fmt0(stats.tc)}°C 液`, angle: Math.PI * 1.85, color: P.danger },
    { label: '节流', sub: `${fmt0(stats.te)}°C 两相`, angle: Math.PI * 0.65, color: P.good },
  ]

  // 室内 / 室外分区提示
  round(ctx, 28, 78, 100, 52, 10)
  ctx.fillStyle = P.soft
  ctx.fill()
  ctx.fillStyle = P.accent
  ctx.font = '13px ui-sans-serif, system-ui, sans-serif'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillText(`室内 ${fmt0(stats.indoorC)}°C`, 42, 104)

  round(ctx, 292, 78, 100, 52, 10)
  ctx.fillStyle = P.bg2
  ctx.fill()
  ctx.strokeStyle = P.danger
  ctx.lineWidth = 1
  ctx.stroke()
  ctx.fillStyle = P.danger
  ctx.fillText(`室外 ${fmt0(stats.outdoorC)}°C`, 306, 104)

  stations.forEach((station) => {
    const x = cx + Math.cos(station.angle) * rx
    const y = cy + Math.sin(station.angle) * ry
    ctx.beginPath()
    ctx.arc(x, y, 16, 0, Math.PI * 2)
    ctx.fillStyle = P.bg
    ctx.fill()
    ctx.lineWidth = 2.5
    ctx.strokeStyle = station.color
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(x, y, 6, 0, Math.PI * 2)
    ctx.fillStyle = station.color
    ctx.fill()

    const labelX = x + Math.cos(station.angle) * 42
    const labelY = y + Math.sin(station.angle) * 34
    ctx.textAlign = 'center'
    ctx.fillStyle = P.text
    ctx.font = '13px ui-sans-serif, system-ui, sans-serif'
    ctx.fillText(station.label, labelX, labelY)
    ctx.fillStyle = P.faint
    ctx.font = '12px ui-monospace, monospace'
    ctx.fillText(station.sub, labelX, labelY + 18)
  })

  for (let i = 0; i < 8; i++) {
    const t = (phase + i / 8) % 1
    const angle = -Math.PI / 2 + t * Math.PI * 2
    const x = cx + Math.cos(angle) * rx
    const y = cy + Math.sin(angle) * ry
    ctx.beginPath()
    ctx.arc(x, y, 4, 0, Math.PI * 2)
    ctx.fillStyle = P.accent2
    ctx.globalAlpha = 0.35 + 0.65 * ((i % 4) / 4)
    ctx.fill()
    ctx.globalAlpha = 1
  }

  // 右侧温度账
  const rows = [
    { name: '蒸发', value: `${fmt0(stats.te)}°C`, tip: '室内 − 20' },
    { name: '冷凝', value: `${fmt0(stats.tc)}°C`, tip: '室外 + 10' },
    { name: '排气', value: `${fmt0(stats.td)}°C`, tip: '冷凝 + 25' },
    { name: '卡诺', value: fmt1(stats.carnot), tip: 'Te / (Tc − Te)' },
  ]
  rows.forEach((row, i) => {
    const y = 150 + i * 52
    round(ctx, 430, y, 180, 42, 10)
    ctx.fillStyle = P.bg2
    ctx.fill()
    ctx.fillStyle = P.text
    ctx.font = '14px ui-sans-serif, system-ui, sans-serif'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillText(row.name, 446, y + 21)
    ctx.fillStyle = P.faint
    ctx.font = '11px ui-sans-serif, system-ui, sans-serif'
    ctx.fillText(row.tip, 500, y + 21)
    ctx.textAlign = 'right'
    ctx.fillStyle = P.accent
    ctx.font = '15px ui-monospace, monospace'
    ctx.fillText(row.value, 594, y + 21)
  })
}

function drawHeat(
  ctx: CanvasRenderingContext2D,
  P: CanvasPalette,
  stats: HeatLedger,
  direction: AirDirection,
  outdoorC: number,
) {
  const warm = direction === 'warm'
  note(
    ctx,
    P,
    warm
      ? '四通阀掉头：室外盘管吸热，室内盘管放热。'
      : '制冷方向：室内盘管吸热，室外盘管放热。',
  )

  const indoor = warm
    ? { title: '室内机', tip: '冷凝器', value: `+${fmt1(stats.qOut)} kW`, color: P.danger }
    : { title: '室内机', tip: '蒸发器', value: `−${fmt1(stats.qIn)} kW`, color: P.accent }
  const outdoor = warm
    ? {
        title: '室外机',
        tip: `蒸发器 · 约 ${fmt0(evaporatingC(outdoorC))}°C`,
        value: `−${fmt1(stats.qIn)} kW`,
        color: P.accent,
      }
    : {
        title: '室外机',
        tip: `冷凝器 · 约 ${fmt0(condensingC(outdoorC))}°C`,
        value: `+${fmt1(stats.qOut)} kW`,
        color: P.danger,
      }

  ;[indoor, outdoor].forEach((card, i) => {
    const x = 36 + i * 300
    round(ctx, x, 88, 268, 180, 16)
    ctx.fillStyle = P.soft
    ctx.fill()
    ctx.lineWidth = 1.5
    ctx.strokeStyle = card.color
    ctx.stroke()
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = P.faint
    ctx.font = '14px ui-sans-serif, system-ui, sans-serif'
    ctx.fillText(card.title, x + 24, 128)
    ctx.fillStyle = P.muted
    ctx.font = '13px ui-sans-serif, system-ui, sans-serif'
    ctx.fillText(card.tip, x + 24, 158)
    ctx.fillStyle = card.color
    ctx.font = '32px ui-monospace, monospace'
    ctx.fillText(card.value, x + 24, 214)
  })

  // 中间箭头
  ctx.strokeStyle = P.warn
  ctx.lineWidth = 3
  ctx.beginPath()
  if (warm) {
    ctx.moveTo(330, 178)
    ctx.lineTo(310, 178)
  } else {
    ctx.moveTo(310, 178)
    ctx.lineTo(330, 178)
  }
  ctx.stroke()
  const tipX = warm ? 310 : 330
  ctx.beginPath()
  ctx.moveTo(tipX, 178)
  ctx.lineTo(tipX + (warm ? 8 : -8), 172)
  ctx.lineTo(tipX + (warm ? 8 : -8), 184)
  ctx.closePath()
  ctx.fillStyle = P.warn
  ctx.fill()

  round(ctx, 36, 292, 568, 72, 12)
  ctx.fillStyle = P.bg2
  ctx.fill()
  ctx.fillStyle = P.text
  ctx.font = '14px ui-sans-serif, system-ui, sans-serif'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  if (warm) {
    ctx.fillText(
      `制热 COP ${fmt1(stats.cop + 1)} = ${fmt1(stats.qOut)} / ${fmt1(stats.watts)}。室外 ${fmt0(outdoorC)}°C 时，蒸发大约 ${fmt0(evaporatingC(outdoorC))}°C。`,
      56,
      328,
    )
  } else {
    ctx.fillText(
      `制冷 COP ${fmt1(stats.cop)} = ${fmt1(stats.qIn)} / ${fmt1(stats.watts)}。室外收下的永远是室内搬走的，再加上电。`,
      56,
      328,
    )
  }
}

function note(ctx: CanvasRenderingContext2D, P: CanvasPalette, text: string) {
  ctx.fillStyle = P.muted
  ctx.font = '13px ui-sans-serif, system-ui, sans-serif'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, 28, 36)
}

function round(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, r)
}

export const AirConWidget: WidgetDefinition<AirConProps> = {
  type: 'air-con',
  label: '空调账本',
  description: '空调把热从室内搬到室外。Qe = COP × W，室外收下 Qe + W。制热时两台换热器对调。',
  icon: '❄️',
  defaultProps: {
    mode: 'move',
    watts: 1,
    cop: 3,
    indoorC: 27,
    outdoorC: 35,
    direction: 'cool',
  },
  configSchema: [
    {
      key: 'mode',
      label: '模式',
      type: 'select',
      options: MODES.map((m) => ({ value: m.id, label: m.label })),
    },
    { key: 'watts', label: '耗电 kW', type: 'range', min: 0.5, max: 2.5, step: 0.1 },
    { key: 'cop', label: 'COP', type: 'range', min: 2, max: 5, step: 0.1 },
    { key: 'indoorC', label: '室内 °C', type: 'range', min: 18, max: 32, step: 1 },
    { key: 'outdoorC', label: '室外 °C', type: 'range', min: -5, max: 45, step: 1 },
    {
      key: 'direction',
      label: '方向',
      type: 'select',
      options: DIRECTIONS.map((d) => ({ value: d.id, label: d.label })),
    },
  ],
  Component: AirCon,
}
