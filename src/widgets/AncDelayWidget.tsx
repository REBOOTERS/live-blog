import { useEffect, useRef, useState } from 'react'
import { useAnimationFrame } from '../lib/useAnimationFrame'
import { prepareCanvas, palette } from '../lib/canvas'
import { useTheme } from '../lib/theme'
import type { WidgetDefinition } from './registry'

interface AncDelayProps {
  latency: number // 系统延迟（微秒）：麦克风 → 芯片 → 扬声器
  freq: number // 噪声频率（Hz）
}

const W = 540
const H = 356
const PAD = 14
const FMIN = 40
const FMAX = 4000

function hexToRgba(hex: string, a: number): string {
  const v = parseInt(hex.slice(1), 16)
  return `rgba(${(v >> 16) & 255}, ${(v >> 8) & 255}, ${v & 255}, ${a})`
}

// 残余振幅（相对原噪声）：反噪声延迟 τ 后与噪声叠加 = 2·|sin(π f τ)|
const residual = (f: number, tauUs: number) => 2 * Math.abs(Math.sin(Math.PI * f * (tauUs / 1e6)))

export function AncDelay({ props }: { props: AncDelayProps }) {
  useTheme() // re-render so palette() re-reads on theme switch
  const P = palette()
  const [lat, setLat] = useState(props.latency)
  const [freq, setFreq] = useState(props.freq)
  useEffect(() => setLat(props.latency), [props.latency])
  useEffect(() => setFreq(props.freq), [props.freq])

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const tRef = useRef(0)
  const stateRef = useRef({ lat, freq })
  stateRef.current = { lat, freq }

  useAnimationFrame((dt) => {
    tRef.current += dt
    draw()
  })

  const draw = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = prepareCanvas(canvas, W, H)
    if (!ctx) return
    const P = palette()

    const bg = ctx.createLinearGradient(0, 0, 0, H)
    bg.addColorStop(0, P.bg)
    bg.addColorStop(1, P.bg2)
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, W, H)

    const { lat: tauUs, freq: f } = stateRef.current
    const tau = tauUs / 1e6
    const res = residual(f, tauUs)
    const db = 20 * Math.log10(Math.max(res, 1e-4))

    // ---- lane 1: noise vs anti-noise at the eardrum (time domain, 3 periods) ----
    const cy1 = 58
    const h1 = 34
    ctx.fillStyle = P.muted
    ctx.font = '10px ui-monospace, monospace'
    ctx.fillText(`耳膜处 · 时域（噪声 ${f} Hz 的 3 个周期，延迟 ${tauUs} µs）`, PAD, 16)
    ctx.strokeStyle = P.grid
    ctx.beginPath()
    ctx.moveTo(0, cy1)
    ctx.lineTo(W, cy1)
    ctx.stroke()

    const win = 3 / f // seconds shown
    ctx.strokeStyle = P.accent
    ctx.lineWidth = 2
    ctx.beginPath()
    for (let x = 0; x <= W; x += 2) {
      const tt = (x / W) * win
      const y = cy1 - Math.sin(2 * Math.PI * f * tt) * h1
      if (x === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()
    ctx.strokeStyle = P.pink
    ctx.lineWidth = 1.8
    ctx.setLineDash([5, 4])
    ctx.beginPath()
    for (let x = 0; x <= W; x += 2) {
      const tt = (x / W) * win
      const y = cy1 + Math.sin(2 * Math.PI * f * (tt - tau)) * h1
      if (x === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()
    ctx.setLineDash([])
    ctx.fillStyle = P.accent
    ctx.fillText('噪声', W - 92, 26)
    ctx.fillStyle = P.pink
    ctx.fillText('反噪声（延迟后）', W - 92, 40)

    // ---- lane 2: residual ----
    const cy2 = 138
    const h2 = 28
    ctx.fillStyle = P.muted
    ctx.fillText('残余（两者叠加）', PAD, cy2 - h2 - 8)
    ctx.strokeStyle = P.grid
    ctx.beginPath()
    ctx.moveTo(0, cy2)
    ctx.lineTo(W, cy2)
    ctx.stroke()
    const sumColor = res < 0.3 ? P.good : res > 1.02 ? P.danger : P.warn
    ctx.strokeStyle = sumColor
    ctx.lineWidth = 2.4
    ctx.beginPath()
    for (let x = 0; x <= W; x += 2) {
      const tt = (x / W) * win
      const y = cy2 - (Math.sin(2 * Math.PI * f * tt) - Math.sin(2 * Math.PI * f * (tt - tau))) * h2
      if (x === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()

    // ---- bottom: attenuation vs frequency ----
    const top = 196
    const bot = H - 22
    const dbMax = 6
    const dbMin = -30
    const fy = (v: number) => top + ((dbMax - v) / (dbMax - dbMin)) * (bot - top)
    const fx = (fr: number) => PAD + (Math.log10(fr / FMIN) / Math.log10(FMAX / FMIN)) * (W - 2 * PAD)

    // amplification zone tint
    ctx.fillStyle = hexToRgba(P.danger, 0.07)
    ctx.fillRect(PAD, top, W - 2 * PAD, fy(0) - top)

    // grid: frequency decades + dB lines
    ctx.strokeStyle = P.grid
    ctx.lineWidth = 1
    ctx.fillStyle = P.faint
    ctx.font = '9px ui-monospace, monospace'
    for (const fr of [50, 100, 200, 500, 1000, 2000]) {
      const gx = fx(fr)
      ctx.beginPath()
      ctx.moveTo(gx, top)
      ctx.lineTo(gx, bot)
      ctx.stroke()
      const lb = fr >= 1000 ? `${fr / 1000}k` : `${fr}`
      ctx.fillText(lb, gx - 8, bot + 13)
    }
    for (const v of [0, -10, -20, -30]) {
      ctx.strokeStyle = v === 0 ? P.axis : P.grid
      ctx.beginPath()
      ctx.moveTo(PAD, fy(v))
      ctx.lineTo(W - PAD, fy(v))
      ctx.stroke()
      ctx.fillStyle = v === 0 ? P.muted : P.faint
      ctx.fillText(`${v} dB`, W - PAD - 32, fy(v) - 3)
    }

    // curve
    ctx.strokeStyle = P.accent2
    ctx.lineWidth = 2
    ctx.beginPath()
    for (let i = 0; i <= 200; i++) {
      const fr = FMIN * Math.pow(FMAX / FMIN, i / 200)
      const v = Math.max(20 * Math.log10(Math.max(residual(fr, tauUs), 1e-4)), dbMin)
      const x = fx(fr)
      const y = fy(Math.min(v, dbMax))
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()

    // quarter-period failure line: f·τ = 1/4
    if (tauUs > 0) {
      const fq = 1 / (4 * tau)
      if (fq >= FMIN && fq <= FMAX) {
        const gx = fx(fq)
        ctx.strokeStyle = P.warn
        ctx.setLineDash([4, 4])
        ctx.beginPath()
        ctx.moveTo(gx, top)
        ctx.lineTo(gx, bot)
        ctx.stroke()
        ctx.setLineDash([])
        ctx.fillStyle = P.warn
        ctx.fillText('f·τ=¼（失效线）', gx + 4, top + 12)
      }
    }

    // marker at current frequency
    const mx = fx(f)
    ctx.strokeStyle = P.accent
    ctx.setLineDash([3, 3])
    ctx.beginPath()
    ctx.moveTo(mx, top)
    ctx.lineTo(mx, bot)
    ctx.stroke()
    ctx.setLineDash([])
    const mv = Math.min(Math.max(db, dbMin), dbMax)
    ctx.fillStyle = P.accent
    ctx.beginPath()
    ctx.arc(mx, fy(mv), 4, 0, Math.PI * 2)
    ctx.fill()

    // titles
    ctx.fillStyle = P.muted
    ctx.font = '10px ui-monospace, monospace'
    ctx.fillText('不同频率能降多少（当前延迟下）', PAD, top - 8)
    ctx.fillStyle = P.danger
    ctx.fillText('放噪区', W - PAD - 34, top + 12)
  }

  const phaseErr = (360 * freq * lat) / 1e6
  const res = residual(freq, lat)
  const db = 20 * Math.log10(Math.max(res, 1e-4))
  const amp = res > 1.02

  return (
    <div className="lb-surface">
      <canvas ref={canvasRef} style={{ width: '100%', aspectRatio: `${W} / ${H}`, borderRadius: 8 }} />

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span
          className="rounded-full px-2.5 py-1 font-mono text-xs"
          style={{
            color: amp ? P.danger : P.good,
            background: `color-mix(in srgb, ${amp ? P.danger : P.good} 10%, transparent)`,
          }}
        >
          {amp ? `放噪 +${db.toFixed(1)} dB` : res === 0 ? '完全抵消' : `降噪 ${db < -45 ? '≥ 45' : db.toFixed(1)} dB`}
        </span>
        <span className="t-muted font-mono text-xs tabular-nums">
          相位误差 {phaseErr.toFixed(1)}° = 周期的 {(phaseErr / 360 * 100).toFixed(1)}%
        </span>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="t-muted flex items-center gap-2 text-xs">
          <span className="w-20 shrink-0">系统延迟</span>
          <input type="range" min={0} max={1000} step={5} value={lat} onChange={(e) => setLat(Number(e.target.value))} className="flex-1" />
          <span className="t-strong w-16 text-right font-mono tabular-nums">{lat}µs</span>
        </label>
        <label className="t-muted flex items-center gap-2 text-xs">
          <span className="w-20 shrink-0">噪声频率</span>
          <input type="range" min={40} max={2000} step={10} value={freq} onChange={(e) => setFreq(Number(e.target.value))} className="flex-1" />
          <span className="t-strong w-16 text-right font-mono tabular-nums">{freq}Hz</span>
        </label>
      </div>

      <p className="t-faint mt-2 text-xs">
        延迟固定、频率升高，相位误差按比例增大：误差过 90° 就从「降不干净」变成「放大噪声」。1 kHz 的周期只有 1 ms——四分之一周期只有 250 µs。
      </p>
    </div>
  )
}

export const AncDelayWidget: WidgetDefinition<AncDelayProps> = {
  type: 'anc-delay',
  label: '降噪延迟与频率',
  description: '固定延迟下，看不同频率的残余噪声曲线——为什么主动降噪对低频有效、对高频甚至放大。',
  icon: '🎧',
  defaultProps: { latency: 100, freq: 100 },
  configSchema: [
    { key: 'latency', label: '系统延迟', type: 'range', min: 0, max: 1000, step: 5, unit: 'µs' },
    { key: 'freq', label: '噪声频率', type: 'range', min: 40, max: 2000, step: 10, unit: 'Hz' },
  ],
  exportable: true,
  Component: AncDelay,
}
