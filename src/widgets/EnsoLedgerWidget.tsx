import { useEffect, useMemo, useRef, useState } from 'react'
import { prepareCanvas, palette, type CanvasPalette } from '../lib/canvas'
import { useTheme } from '../lib/theme'
import type { WidgetDefinition } from './registry'

/**
 * 教学账本，不是某一年的预报，也不是浅水方程的解。
 * 坡度：信风 s 以 0.1 为一档。高差 = 40s cm。
 * 20°C 等温线：西边 100+50s m，东边 100−50s m。
 * 海温：西边 28+min(s,1) °C，东边 29−5s °C。s=1 是气候平均锚点
 * （西高 40 cm，西 150 m / 东 50 m，西 29°C / 东 24°C）。
 * 指数：|距平|≥0.5°C 且连续 5 个重叠季才涂色。分档看峰值：
 * 0.5–0.9 弱，1.0–1.4 中等，1.5–1.9 强，≥2.0 超强。
 * 2.2 / 2.4 / 2.8 是 ONI（ERSSTv5）1982、1997、2015 年 NDJ 的峰值。
 * 回波：第 0、2、6、12、16、18 月的距平（十分之一度）
 * 0、+5、+15、+2、−8、−3，中间按月直线连接。
 */

const W = 640
const H = 440

export type EnsoMode = 'slope' | 'index' | 'wave'

interface EnsoProps {
  mode: EnsoMode
  /** 信风相对气候平均的倍数，0.2–1.8 */
  wind: number
  /** 尼诺 3.4 三个月距平，°C，−2.5–2.8 */
  anomaly: number
  /** 连续过线的重叠季数，1–8 */
  seasons: number
  /** 西风爆发之后的月数，0–18 */
  month: number
}

const MODES: { id: EnsoMode; label: string }[] = [
  { id: 'slope', label: '坡度' },
  { id: 'index', label: '指数' },
  { id: 'wave', label: '回波' },
]

/** ONI（ERSSTv5）NDJ 峰值，画在指数尺上当参照，不随滑块改变。 */
export const ONI_PEAKS: { year: string; tenths: number }[] = [
  { year: '1982', tenths: 22 },
  { year: '1997', tenths: 24 },
  { year: '2015', tenths: 28 },
]

const WAVE_KEYS: { m: number; tenths: number }[] = [
  { m: 0, tenths: 0 },
  { m: 2, tenths: 5 },
  { m: 6, tenths: 15 },
  { m: 12, tenths: 2 },
  { m: 16, tenths: -8 },
  { m: 18, tenths: -3 },
]

export function clampMode(mode: string): EnsoMode {
  if (mode === 'index' || mode === 'wave' || mode === 'slope') return mode
  return 'slope'
}

export function windTenths(n: number): number {
  const t = Math.round(Number(n) * 10)
  if (!Number.isFinite(t)) return 10
  return Math.max(2, Math.min(18, t))
}

export function anomalyTenths(n: number): number {
  const t = Math.round(Number(n) * 10)
  if (!Number.isFinite(t)) return 5
  return Math.max(-25, Math.min(28, t))
}

export function clampSeasons(n: number): number {
  const x = Math.round(Number(n))
  if (!Number.isFinite(x)) return 5
  return Math.max(1, Math.min(8, x))
}

export function clampMonth(n: number): number {
  const x = Math.round(Number(n))
  if (!Number.isFinite(x)) return 0
  return Math.max(0, Math.min(18, x))
}

function roundHalfAway(n: number): number {
  return Math.sign(n) * Math.round(Math.abs(n))
}

/** 十分之一度写成一位小数。负号用 ASCII，方便再换成负号。 */
export function fmtTenths(tenths: number): string {
  const v = Math.abs(tenths)
  return `${tenths < 0 ? '-' : ''}${Math.floor(v / 10)}.${v % 10}`
}

export function fmtSignedTenths(tenths: number): string {
  if (tenths === 0) return '0.0'
  const body = fmtTenths(Math.abs(tenths))
  return tenths > 0 ? `+${body}` : `−${body}`
}

export interface SlopeState {
  windTenths: number
  dhCm: number
  westM: number
  eastM: number
  westTenths: number
  eastTenths: number
  diffTenths: number
  rain: string
  upwell: string
  trades: string
}

export function slopeOf(wind: number): SlopeState {
  const t = windTenths(wind)
  const westTenths = 280 + Math.min(t, 10)
  const eastTenths = 290 - 5 * t
  const diffTenths = westTenths - eastTenths
  const eastM = 100 - 5 * t
  let rain = '雨仍偏西'
  if (diffTenths <= 15) rain = '雨在中太平洋'
  else if (diffTenths >= 40) rain = '雨在西边暖池'
  let upwell = '东边冷舌还在'
  if (eastM >= 80) upwell = '东边抽上暖水'
  else if (eastM <= 40) upwell = '东边抽上冷水'
  return {
    windTenths: t,
    dhCm: 4 * t,
    westM: 100 + 5 * t,
    eastM,
    westTenths,
    eastTenths,
    diffTenths,
    rain,
    upwell,
    trades: t >= 8 ? '信风向西' : '信风变弱',
  }
}

export type Phase = 'neutral' | 'nino' | 'nina'

export function phaseOf(anomaly: number): Phase {
  const t = anomalyTenths(anomaly)
  if (t >= 5) return 'nino'
  if (t <= -5) return 'nina'
  return 'neutral'
}

export function strengthWord(anomaly: number): string | null {
  const mag = Math.abs(anomalyTenths(anomaly))
  if (mag < 5) return null
  if (mag >= 20) return '超强'
  if (mag >= 15) return '强'
  if (mag >= 10) return '中等'
  return '弱'
}

export function phaseLabel(anomaly: number): string {
  const word = strengthWord(anomaly)
  const phase = phaseOf(anomaly)
  if (!word || phase === 'neutral') return '中性'
  return `${word}${phase === 'nino' ? '厄尔尼诺' : '拉尼娜'}`
}

export function historyPaint(anomaly: number, seasons: number): 'red' | 'blue' | 'none' {
  if (phaseOf(anomaly) === 'neutral' || clampSeasons(seasons) < 5) return 'none'
  return anomalyTenths(anomaly) > 0 ? 'red' : 'blue'
}

export function slopeHeadline(wind: number): string {
  const s = slopeOf(wind)
  return `信风 ${fmtTenths(s.windTenths)} 时，西边比东边高 ${s.dhCm} cm。20°C 等温线西边 ${s.westM} m、东边 ${s.eastM} m。西边 ${fmtTenths(s.westTenths)}°C，东边 ${fmtTenths(s.eastTenths)}°C。`
}

export function indexHeadline(anomaly: number, seasons: number): string {
  const t = anomalyTenths(anomaly)
  const n = clampSeasons(seasons)
  const mag = fmtTenths(Math.abs(t))
  const signed = t > 0 ? `偏高 ${mag}°C` : t < 0 ? `偏低 ${mag}°C` : '距平 0.0°C'
  if (Math.abs(t) < 5) return `${signed}，连续 ${n} 季。不到 0.5°C，记成中性。`
  const label = phaseLabel(anomaly)
  if (n >= 5) {
    const color = t > 0 ? '红' : '蓝'
    return `${signed}，连续 ${n} 季。这是一次${label}，历史表会涂${color}。`
  }
  return `${signed}，只连续 ${n} 季。海温过线了，历史表先不涂。还差 ${5 - n} 季。`
}

export function waveTenths(month: number): number {
  const m = clampMonth(month)
  for (let i = 0; i < WAVE_KEYS.length - 1; i++) {
    const a = WAVE_KEYS[i]
    const b = WAVE_KEYS[i + 1]
    if (m <= b.m) {
      const raw = a.tenths + ((b.tenths - a.tenths) * (m - a.m)) / (b.m - a.m)
      return roundHalfAway(raw)
    }
  }
  return WAVE_KEYS[WAVE_KEYS.length - 1].tenths
}

export function waveKind(month: number): string {
  const m = clampMonth(month)
  if (m < 2) return '暖开尔文波向东'
  if (m === 2) return '开尔文波到东岸'
  if (m < 8) return '罗斯贝波向西'
  if (m < 12) return '冷开尔文波向东'
  if (m === 12) return '冷水波到东岸'
  return '冷信号在东岸'
}

export function waveHeadline(month: number): string {
  const m = clampMonth(month)
  const a = fmtSignedTenths(waveTenths(m))
  if (m === 0) return `第 0 月，西风爆发。东边异常 ${a}°C。开尔文波刚从西边出发。`
  if (m < 2) return `第 ${m} 月，开尔文波还在向东。东边异常 ${a}°C。`
  if (m === 2) return `第 2 月，开尔文波到达东岸。东边异常 ${a}°C。刚过厄尔尼诺状态的线。`
  if (m < 6) return `第 ${m} 月，正反馈把东边继续加热。东边异常 ${a}°C。`
  if (m === 6) return `第 6 月，正反馈推到强事件。东边异常 ${a}°C。冷水波还在往西走。`
  if (m < 12) return `第 ${m} 月，暖事件还在。冷水波正向东回来。东边异常 ${a}°C。`
  if (m === 12) return `第 12 月，回头的冷水波到达东岸。东边异常 ${a}°C。暖事件被同一次出发种下的波关掉。`
  if (m < 16) return `第 ${m} 月，东边继续回落。东边异常 ${a}°C。`
  if (m === 16) return `第 16 月，过冲。东边异常 ${a}°C。这是拉尼娜状态，历史表还要看它能不能守住 5 季。`
  return `第 ${m} 月，冷相位开始往回走。东边异常 ${a}°C。`
}

function headline(props: EnsoProps): string {
  if (props.mode === 'index') return indexHeadline(props.anomaly, props.seasons)
  if (props.mode === 'wave') return waveHeadline(props.month)
  return slopeHeadline(props.wind)
}

function detail(props: EnsoProps): string {
  if (props.mode === 'index') {
    return '尼诺 3.4 区：5°N–5°S，170°W–120°W。三个月滑动平均，绝对值到 0.5°C 叫过线。连续 5 个重叠季，历史表才涂色。0.5–0.9 弱，1.0–1.4 中等，1.5–1.9 强，2.0 及以上超强。2026 年 2 月起业务用 RONI，阈值相同。尺上的 2.2、2.4、2.8 是 ONI 旧表的 NDJ 峰值。'
  }
  if (props.mode === 'wave') {
    return '锚点是第 0 月 0.0°C、第 2 月 +0.5°C、第 6 月 +1.5°C、第 12 月 +0.2°C、第 16 月 −0.8°C、第 18 月 −0.3°C，中间按月直线连接。0–2 月暖开尔文波东行，2–8 月罗斯贝波西行，8–12 月冷开尔文波东行。这是延迟振子的教学时间表。'
  }
  const s = slopeOf(props.wind)
  return `高差 = 40 × 信风。西边深度 = 100 + 50 × 信风，东边 = 100 − 50 × 信风。西边海温 = 28 + min(信风, 1)，东边 = 29 − 5 × 信风。1.0 是气候平均的锚点。这一档温差 ${fmtTenths(s.diffTenths)}°C，${s.trades}。`
}

function chips(props: EnsoProps): string[] {
  if (props.mode === 'index') {
    const paint = historyPaint(props.anomaly, props.seasons)
    const table =
      paint === 'red' ? '历史表涂红' : paint === 'blue' ? '历史表涂蓝' : phaseOf(props.anomaly) === 'neutral' ? '历史表不涂' : `还差 ${5 - clampSeasons(props.seasons)} 季`
    return [phaseLabel(props.anomaly), table, '门槛 ±0.5°C']
  }
  if (props.mode === 'wave') {
    return [waveKind(props.month), `东边 ${fmtSignedTenths(waveTenths(props.month))}°C`, '教学曲线']
  }
  const s = slopeOf(props.wind)
  return [`温差 ${fmtTenths(s.diffTenths)}°C`, s.rain, s.upwell]
}

function EnsoLedger({ props }: { props: EnsoProps }) {
  const theme = useTheme()
  const [mode, setMode] = useState<EnsoMode>(clampMode(props.mode))
  const [wind, setWind] = useState(windTenths(props.wind) / 10)
  const [anomaly, setAnomaly] = useState(anomalyTenths(props.anomaly) / 10)
  const [seasons, setSeasons] = useState(clampSeasons(props.seasons))
  const [month, setMonth] = useState(clampMonth(props.month))

  useEffect(() => setMode(clampMode(props.mode)), [props.mode])
  useEffect(() => setWind(windTenths(props.wind) / 10), [props.wind])
  useEffect(() => setAnomaly(anomalyTenths(props.anomaly) / 10), [props.anomaly])
  useEffect(() => setSeasons(clampSeasons(props.seasons)), [props.seasons])
  useEffect(() => setMonth(clampMonth(props.month)), [props.month])

  const view = useMemo<EnsoProps>(() => ({ mode, wind, anomaly, seasons, month }), [mode, wind, anomaly, seasons, month])

  return (
    <div className="lb-surface">
      <p className="t-strong text-sm">{headline(view)}</p>
      <EnsoCanvas theme={theme} view={view} />
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
        {mode === 'slope' ? (
          <Slider
            label="信风"
            value={wind}
            min={0.2}
            max={1.8}
            step={0.1}
            text={fmtTenths(windTenths(wind))}
            onChange={(n) => setWind(windTenths(n) / 10)}
          />
        ) : null}
        {mode === 'index' ? (
          <>
            <Slider
              label="距平"
              value={anomaly}
              min={-2.5}
              max={2.8}
              step={0.1}
              text={fmtSignedTenths(anomalyTenths(anomaly))}
              onChange={(n) => setAnomaly(anomalyTenths(n) / 10)}
            />
            <Slider
              label="季数"
              value={seasons}
              min={1}
              max={8}
              step={1}
              text={`${seasons}`}
              onChange={(n) => setSeasons(clampSeasons(n))}
            />
          </>
        ) : null}
        {mode === 'wave' ? (
          <Slider
            label="月份"
            value={month}
            min={0}
            max={18}
            step={1}
            text={`${month}`}
            onChange={(n) => setMonth(clampMonth(n))}
          />
        ) : null}
      </div>
      <div className="mt-3 flex flex-wrap gap-2 font-mono text-[11px] tabular-nums">
        {chips(view).map((item) => (
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
      <span className="t-strong w-12 text-right font-mono tabular-nums">{text}</span>
    </label>
  )
}

function EnsoCanvas({ theme, view }: { theme: string; view: EnsoProps }) {
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
    if (view.mode === 'index') drawIndex(ctx, P, anomalyTenths(view.anomaly), clampSeasons(view.seasons))
    else if (view.mode === 'wave') drawWave(ctx, P, clampMonth(view.month))
    else drawSlope(ctx, P, slopeOf(view.wind))
  }, [theme, view])

  return (
    <canvas
      ref={canvasRef}
      className="mt-3 touch-none"
      style={{ width: '100%', aspectRatio: `${W} / ${H}`, borderRadius: 8, touchAction: 'none' }}
    />
  )
}

function rgba(hex: string, alpha: number): string {
  const n = rgb(hex)
  return `rgba(${n.r},${n.g},${n.b},${alpha})`
}

function inkOn(hex: string): string {
  const { r, g, b } = rgb(hex)
  return (r * 299 + g * 587 + b * 114) / 1000 > 160 ? '#1d1d1f' : '#ffffff'
}

function rgb(hex: string): { r: number; g: number; b: number } {
  const n = parseInt(hex.replace('#', ''), 16)
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}

function drawSlope(ctx: CanvasRenderingContext2D, P: CanvasPalette, s: SlopeState) {
  const left = 48
  const right = 592
  const base = 200
  const floor = 368
  const lift = (s.dhCm / 40) * 26

  ctx.fillStyle = P.faint
  ctx.font = '13px ui-sans-serif, system-ui, sans-serif'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillText('西 · 暖池', left, 36)
  ctx.textAlign = 'right'
  ctx.fillText('东 · 冷舌', right, 36)

  ctx.textAlign = 'left'
  ctx.fillStyle = P.text
  ctx.font = '22px ui-monospace, monospace'
  ctx.fillText(`${fmtTenths(s.westTenths)}°C`, left, 62)
  ctx.textAlign = 'right'
  ctx.fillStyle = s.eastTenths >= 270 ? P.warn : P.accent
  ctx.fillText(`${fmtTenths(s.eastTenths)}°C`, right, 62)

  const yWest = base - lift
  const yEast = base
  const depthY = (meters: number, surface: number) => surface + ((floor - base) * meters) / 220

  ctx.beginPath()
  ctx.moveTo(left, yWest)
  ctx.lineTo(right, yEast)
  ctx.lineTo(right, floor)
  ctx.lineTo(left, floor)
  ctx.closePath()
  ctx.fillStyle = rgba(P.accent, 0.14)
  ctx.fill()

  const yThermWest = depthY(s.westM, yWest)
  const yThermEast = depthY(s.eastM, yEast)
  ctx.beginPath()
  ctx.moveTo(left, yWest)
  ctx.lineTo(right, yEast)
  ctx.lineTo(right, yThermEast)
  ctx.lineTo(left, yThermWest)
  ctx.closePath()
  ctx.fillStyle = rgba(P.warn, 0.28)
  ctx.fill()

  ctx.beginPath()
  ctx.moveTo(left, yWest)
  ctx.lineTo(right, yEast)
  ctx.strokeStyle = P.accent
  ctx.lineWidth = 2
  ctx.stroke()

  ctx.beginPath()
  ctx.moveTo(left, yThermWest)
  ctx.lineTo(right, yThermEast)
  ctx.strokeStyle = P.warn
  ctx.lineWidth = 2.5
  ctx.stroke()

  ctx.font = '12px ui-sans-serif, system-ui, sans-serif'
  ctx.textAlign = 'left'
  ctx.fillStyle = P.muted
  ctx.fillText(`20°C · ${s.westM} m`, left + 8, Math.min(yThermWest + 16, floor - 12))
  ctx.textAlign = 'right'
  ctx.fillText(`${s.eastM} m`, right - 8, Math.min(yThermEast + 18, floor - 12))

  const rainX = left + (right - left) * rainCenter(s.diffTenths)
  drawCloud(ctx, P, rainX, 104)
  drawTrades(ctx, P, s.windTenths, 156, rainX)

  ctx.fillStyle = P.faint
  ctx.font = '12px ui-sans-serif, system-ui, sans-serif'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillText('印尼', left, 392)
  ctx.textAlign = 'center'
  ctx.fillText(`西高 ${s.dhCm} cm`, (left + right) / 2, 392)
  ctx.textAlign = 'right'
  ctx.fillText('秘鲁', right, 392)
  ctx.textAlign = 'left'
  ctx.fillText(s.trades, left, 416)
  ctx.textAlign = 'right'
  ctx.fillText(s.upwell, right, 416)
}

function rainCenter(diffTenths: number): number {
  if (diffTenths >= 40) return 0.2
  if (diffTenths <= 15) return 0.62
  const t = (40 - diffTenths) / (40 - 15)
  return 0.2 + t * (0.62 - 0.2)
}

function drawCloud(ctx: CanvasRenderingContext2D, P: CanvasPalette, x: number, y: number) {
  ctx.fillStyle = rgba(P.accent, 0.22)
  ctx.beginPath()
  ctx.arc(x - 14, y + 4, 12, 0, Math.PI * 2)
  ctx.arc(x + 2, y - 2, 16, 0, Math.PI * 2)
  ctx.arc(x + 16, y + 4, 11, 0, Math.PI * 2)
  ctx.fill()
}

function drawTrades(ctx: CanvasRenderingContext2D, P: CanvasPalette, tenths: number, y: number, avoidX: number) {
  const len = 28 + tenths * 5
  const color = tenths >= 8 ? P.accent : P.warn
  ctx.strokeStyle = color
  ctx.fillStyle = color
  ctx.lineWidth = 1.5
  for (const x of [250, 360, 470]) {
    if (Math.abs(x - avoidX) < 56) continue
    ctx.beginPath()
    ctx.moveTo(x + len / 2, y)
    ctx.lineTo(x - len / 2, y)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(x - len / 2, y)
    ctx.lineTo(x - len / 2 + 8, y - 4)
    ctx.lineTo(x - len / 2 + 8, y + 4)
    ctx.closePath()
    ctx.fill()
  }
}

function drawIndex(ctx: CanvasRenderingContext2D, P: CanvasPalette, tenths: number, seasons: number) {
  const phase = phaseLabel(tenths / 10)
  const paint = historyPaint(tenths / 10, seasons)
  const color = tenths >= 20 ? P.danger : tenths > 0 ? P.warn : tenths < 0 ? P.accent : P.text

  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = P.faint
  ctx.font = '13px ui-sans-serif, system-ui, sans-serif'
  ctx.fillText('尼诺 3.4 区 · 三个月平均', 320, 36)
  ctx.fillStyle = color
  ctx.font = '40px ui-monospace, monospace'
  ctx.fillText(`${fmtSignedTenths(tenths)}°C`, 320, 84)
  ctx.font = '16px ui-sans-serif, system-ui, sans-serif'
  ctx.fillStyle = P.text
  ctx.fillText(phase, 320, 122)

  const left = 56
  const right = 584
  const y = 176
  const xOf = (valueTenths: number) => left + ((valueTenths + 25) / 53) * (right - left)

  ctx.beginPath()
  ctx.roundRect(left, y, right - left, 16, 8)
  ctx.fillStyle = P.bg2
  ctx.fill()

  const x0 = xOf(0)
  const xA = xOf(tenths)
  ctx.beginPath()
  ctx.roundRect(Math.min(x0, xA), y, Math.max(8, Math.abs(xA - x0)), 16, 8)
  ctx.fillStyle = rgba(color, 0.85)
  ctx.fill()

  for (const tick of [-25, -5, 0, 5, 15, 20, 28]) {
    const x = xOf(tick)
    ctx.beginPath()
    ctx.moveTo(x, y + 20)
    ctx.lineTo(x, y + 28)
    ctx.strokeStyle = tick === -5 || tick === 5 ? P.text : P.faint
    ctx.lineWidth = tick === -5 || tick === 5 ? 1.5 : 1
    ctx.stroke()
  }
  ctx.font = '11px ui-sans-serif, system-ui, sans-serif'
  ctx.fillStyle = P.muted
  ctx.textAlign = 'center'
  ctx.fillText('−2.5', xOf(-25), y + 52)
  ctx.fillText('−0.5', xOf(-5), y + 52)
  ctx.fillText('0', xOf(0), y + 52)
  ctx.fillText('+0.5', xOf(5), y + 52)
  ctx.fillText('+2.0', xOf(20), y + 52)
  ctx.fillText('+2.8', xOf(28), y + 52)

  ctx.beginPath()
  ctx.arc(xA, y + 8, 7, 0, Math.PI * 2)
  ctx.fillStyle = P.bg
  ctx.fill()
  ctx.lineWidth = 2
  ctx.strokeStyle = color
  ctx.stroke()

  ctx.fillStyle = P.faint
  ctx.font = '12px ui-sans-serif, system-ui, sans-serif'
  ctx.textAlign = 'left'
  ctx.fillText('连续的重叠季', left, 268)

  const box = 48
  const gap = 12
  const total = 8 * box + 7 * gap
  const xStart = (W - total) / 2
  for (let i = 0; i < 8; i++) {
    const x = xStart + i * (box + gap)
    const on = i < seasons
    const filled = on && paint !== 'none'
    const fill = paint === 'blue' ? P.accent : P.warn
    ctx.beginPath()
    ctx.roundRect(x, 286, box, 36, 8)
    ctx.fillStyle = filled ? fill : on ? rgba(P.muted, 0.22) : P.bg2
    ctx.fill()
    if (i === 4 && !filled) {
      ctx.lineWidth = 1.5
      ctx.strokeStyle = P.warn
      ctx.stroke()
    }
    ctx.fillStyle = filled ? inkOn(fill) : P.muted
    ctx.font = '13px ui-monospace, monospace'
    ctx.textAlign = 'center'
    ctx.fillText(`${i + 1}`, x + box / 2, 304)
  }

  const seasonNote =
    paint === 'none'
      ? seasons >= 5
        ? '距平没过 0.5°C，季数再多也不涂。'
        : '第 5 格还空着，历史表先不涂。'
      : seasons > 5
        ? `连续 ${seasons} 季，涂色要的 5 季已经满了。`
        : '前 5 格都满了，历史表涂色。'
  ctx.fillStyle = P.muted
  ctx.font = '12px ui-sans-serif, system-ui, sans-serif'
  ctx.textAlign = 'left'
  ctx.fillText(seasonNote, left, 348)

  ctx.textAlign = 'center'
  ctx.fillStyle = P.faint
  ctx.fillText('ONI 峰值', 320, 386)
  ctx.font = '12px ui-monospace, monospace'
  ctx.fillStyle = P.text
  const refs = ONI_PEAKS.map((item) => `${item.year}  ${fmtSignedTenths(item.tenths)}`).join('     ')
  ctx.fillText(refs, 320, 410)
}

function drawWave(ctx: CanvasRenderingContext2D, P: CanvasPalette, month: number) {
  const tenths = waveTenths(month)
  const left = 48
  const right = 592
  const base = 168
  const floor = 300
  const eastM = Math.max(16, Math.min(200, 50 + 4 * tenths))
  const westM = Math.max(16, Math.min(210, 150 - 2 * tenths))
  const depthY = (meters: number) => base + ((floor - base) * meters) / 220

  ctx.fillStyle = P.faint
  ctx.font = '13px ui-sans-serif, system-ui, sans-serif'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillText('西', left, 36)
  ctx.textAlign = 'right'
  ctx.fillText('东', right, 36)
  ctx.textAlign = 'center'
  ctx.fillStyle = tenths > 0 ? P.warn : tenths < 0 ? P.accent : P.text
  ctx.font = '22px ui-monospace, monospace'
  ctx.fillText(`东边 ${fmtSignedTenths(tenths)}°C`, 320, 36)

  ctx.beginPath()
  ctx.moveTo(left, base)
  ctx.lineTo(right, base)
  ctx.lineTo(right, floor)
  ctx.lineTo(left, floor)
  ctx.closePath()
  ctx.fillStyle = rgba(P.accent, 0.12)
  ctx.fill()

  const yWest = depthY(westM)
  const yEast = depthY(eastM)
  ctx.beginPath()
  ctx.moveTo(left, base)
  ctx.lineTo(right, base)
  ctx.lineTo(right, yEast)
  ctx.lineTo(left, yWest)
  ctx.closePath()
  ctx.fillStyle = rgba(P.warn, tenths >= 0 ? 0.34 : 0.16)
  ctx.fill()

  ctx.beginPath()
  ctx.moveTo(left, yWest)
  ctx.lineTo(right, yEast)
  ctx.strokeStyle = P.warn
  ctx.lineWidth = 2.5
  ctx.stroke()

  ctx.font = '12px ui-sans-serif, system-ui, sans-serif'
  ctx.fillStyle = P.muted
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillText(`西 ${westM} m`, left + 8, floor - 16)
  ctx.textAlign = 'right'
  ctx.fillText(`东 ${eastM} m`, right - 8, floor - 16)

  ctx.fillStyle = P.text
  ctx.font = '14px ui-sans-serif, system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText(waveKind(month), 320, 112)

  const marker = waveMarker(month)
  const x = left + (right - left) * marker.x
  const yLine = (yWest - base) * (1 - marker.x) + (yEast - base) * marker.x
  const y = base + yLine - 18
  ctx.beginPath()
  ctx.arc(x, y, 8, 0, Math.PI * 2)
  ctx.fillStyle = marker.cold ? P.accent : P.warn
  ctx.fill()

  const axisY = 360
  ctx.beginPath()
  ctx.moveTo(left, axisY)
  ctx.lineTo(right, axisY)
  ctx.strokeStyle = P.faint
  ctx.lineWidth = 1
  ctx.stroke()
  for (const mark of [0, 2, 6, 12, 16, 18]) {
    const mx = left + ((right - left) * mark) / 18
    ctx.beginPath()
    ctx.moveTo(mx, axisY - 5)
    ctx.lineTo(mx, axisY + 5)
    ctx.strokeStyle = mark === month ? P.accent : P.faint
    ctx.stroke()
    ctx.fillStyle = mark === month ? P.text : P.muted
    ctx.font = '12px ui-monospace, monospace'
    ctx.textAlign = 'center'
    ctx.fillText(`${mark}`, mx, axisY + 20)
  }
  const nowX = left + ((right - left) * month) / 18
  ctx.beginPath()
  ctx.arc(nowX, axisY, 5, 0, Math.PI * 2)
  ctx.fillStyle = P.accent
  ctx.fill()
  ctx.fillStyle = P.faint
  ctx.font = '12px ui-sans-serif, system-ui, sans-serif'
  ctx.textAlign = 'left'
  ctx.fillText('月', left, 414)
  ctx.textAlign = 'center'
  ctx.fillText(marker.caption, 320, 414)
}

function waveMarker(month: number): { x: number; cold: boolean; caption: string } {
  if (month <= 2) {
    return { x: 0.12 + (month / 2) * 0.76, cold: false, caption: '暖水信号往东走' }
  }
  if (month <= 8) {
    const t = (month - 2) / 6
    return { x: 0.88 - t * 0.76, cold: true, caption: '冷信号先往西走' }
  }
  if (month <= 12) {
    const t = (month - 8) / 4
    return { x: 0.12 + t * 0.76, cold: true, caption: '冷信号折返向东' }
  }
  return { x: 0.88, cold: true, caption: '冷信号已经到东岸' }
}

export const EnsoLedgerWidget: WidgetDefinition<EnsoProps> = {
  type: 'enso-ledger',
  label: '厄尔尼诺账本',
  description: '信风决定赤道海面的倾斜。距平连续 5 季过 ±0.5°C，历史表才涂色。冷水波大约第 12 月回到东岸，把暖事件关掉。',
  icon: '🌊',
  defaultProps: { mode: 'slope', wind: 1, anomaly: 0.5, seasons: 5, month: 0 },
  configSchema: [
    {
      key: 'mode',
      label: '模式',
      type: 'select',
      options: MODES.map((item) => ({ value: item.id, label: item.label })),
    },
    { key: 'wind', label: '信风', type: 'range', min: 0.2, max: 1.8, step: 0.1 },
    { key: 'anomaly', label: '距平 °C', type: 'range', min: -2.5, max: 2.8, step: 0.1 },
    { key: 'seasons', label: '季数', type: 'range', min: 1, max: 8, step: 1 },
    { key: 'month', label: '月份', type: 'range', min: 0, max: 18, step: 1 },
  ],
  Component: EnsoLedger,
}
