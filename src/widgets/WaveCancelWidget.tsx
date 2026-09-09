import { useEffect, useRef, useState } from 'react'
import { useAnimationFrame } from '../lib/useAnimationFrame'
import { prepareCanvas, palette } from '../lib/canvas'
import { useTheme } from '../lib/theme'
import type { WidgetDefinition } from './registry'

interface WaveCancelProps {
  freq: number // 噪声频率（Hz，仅影响画面密度）
  phase: number // 反噪声相位差（度）
  amp: number // 反噪声相对振幅（1 = 与噪声等幅）
}

const W = 540
const H = 336
const LANE = 112 // lane pitch
const HALF = 40 // wave half-height

export function WaveCancel({ props }: { props: WaveCancelProps }) {
  useTheme() // re-render so palette() re-reads on theme switch
  const [freq, setFreq] = useState(props.freq)
  const [phase, setPhase] = useState(props.phase)
  const [amp, setAmp] = useState(props.amp)
  useEffect(() => setFreq(props.freq), [props.freq])
  useEffect(() => setPhase(props.phase), [props.phase])
  useEffect(() => setAmp(props.amp), [props.amp])

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const tRef = useRef(0)
  const stateRef = useRef({ freq, phase, amp })
  stateRef.current = { freq, phase, amp }

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

    const { freq: f, phase: ph, amp: r } = stateRef.current
    const t = tRef.current
    const cycles = Math.max(1, f / 60) // cycles across the canvas
    const theta = (x: number) => Math.PI * 2 * (cycles * (x / W) - t * 1.2)
    const phRad = (ph * Math.PI) / 180

    const lanes = [
      { label: '噪声', color: P.accent, sample: (x: number) => Math.sin(theta(x)) },
      { label: '反噪声', color: P.pink, sample: (x: number) => r * Math.sin(theta(x) + phRad) },
    ]

    // residual amplitude relative to the noise wave (A = 1)
    const res = Math.sqrt(1 + r * r + 2 * r * Math.cos(phRad))
    const db = res <= 0.0015 ? null : 20 * Math.log10(res)

    lanes.forEach((lane, i) => {
      const cy = 62 + i * LANE
      // lane separator + label
      ctx.strokeStyle = P.grid
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(0, cy + HALF + 18)
      ctx.lineTo(W, cy + HALF + 18)
      ctx.stroke()
      ctx.fillStyle = P.muted
      ctx.font = '11px ui-monospace, monospace'
      ctx.fillText(lane.label, 14, cy - HALF - 8)
      // zero line
      ctx.strokeStyle = P.grid
      ctx.beginPath()
      ctx.moveTo(0, cy)
      ctx.lineTo(W, cy)
      ctx.stroke()
      // wave
      ctx.strokeStyle = lane.color
      ctx.lineWidth = 2.2
      ctx.beginPath()
      for (let x = 0; x <= W; x += 2) {
        const y = cy - lane.sample(x) * HALF
        if (x === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.stroke()
    })

    // sum lane
    const cy = 62 + 2 * LANE
    const sumColor = res < 0.25 ? P.good : res > 1.02 ? P.danger : P.warn
    ctx.fillStyle = P.muted
    ctx.font = '11px ui-monospace, monospace'
    ctx.fillText('叠加（耳膜处听到的）', 14, cy - HALF - 8)
    ctx.strokeStyle = P.grid
    ctx.beginPath()
    ctx.moveTo(0, cy)
    ctx.lineTo(W, cy)
    ctx.stroke()
    ctx.strokeStyle = sumColor
    ctx.lineWidth = 2.5
    ctx.beginPath()
    for (let x = 0; x <= W; x += 2) {
      const y = cy - (Math.sin(theta(x)) + r * Math.sin(theta(x) + phRad)) * HALF
      if (x === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()

    // residual readout
    ctx.fillStyle = sumColor
    ctx.font = '12px ui-monospace, monospace'
    const resText =
      db === null
        ? '残余 ×0.00 · 完全抵消（−∞ dB）'
        : `残余 ×${res.toFixed(2)} · ${db >= 0 ? '+' : ''}${db.toFixed(1)} dB`
    ctx.fillText(resText, W - ctx.measureText(resText).width - 14, 20)
  }

  return (
    <div className="lb-surface">
      <canvas ref={canvasRef} style={{ width: '100%', aspectRatio: `${W} / ${H}`, borderRadius: 8 }} />

      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <label className="t-muted flex items-center gap-2 text-xs">
          <span className="w-16 shrink-0">相位差</span>
          <input type="range" min={0} max={360} step={1} value={phase} onChange={(e) => setPhase(Number(e.target.value))} className="flex-1" />
          <span className="t-strong w-14 text-right font-mono tabular-nums">{phase}°</span>
        </label>
        <label className="t-muted flex items-center gap-2 text-xs">
          <span className="w-16 shrink-0">反相波振幅</span>
          <input type="range" min={0.4} max={1.6} step={0.01} value={amp} onChange={(e) => setAmp(Number(e.target.value))} className="flex-1" />
          <span className="t-strong w-14 text-right font-mono tabular-nums">{Math.round(amp * 100)}%</span>
        </label>
        <label className="t-muted flex items-center gap-2 text-xs">
          <span className="w-16 shrink-0">噪声频率</span>
          <input type="range" min={50} max={400} step={5} value={freq} onChange={(e) => setFreq(Number(e.target.value))} className="flex-1" />
          <span className="t-strong w-14 text-right font-mono tabular-nums">{freq}Hz</span>
        </label>
      </div>

      <p className="t-faint mt-2 text-xs">
        相位差 180° 且等幅时两波完全抵消——拖着相位滑块离开 180°，残余立刻长出来；反相波振幅哪怕只差 10%，抵消就只能到 −26 dB。
      </p>
    </div>
  )
}

export const WaveCancelWidget: WidgetDefinition<WaveCancelProps> = {
  type: 'wave-cancel',
  label: '波的相消干涉',
  description: '两列等频声波叠加：拖动相位差与振幅，看什么时候完全抵消、什么时候反而增强。',
  icon: '〰️',
  defaultProps: { freq: 120, phase: 180, amp: 1 },
  configSchema: [
    { key: 'freq', label: '噪声频率', type: 'range', min: 50, max: 400, step: 5, unit: 'Hz' },
    { key: 'phase', label: '相位差', type: 'range', min: 0, max: 360, step: 1, unit: '°' },
    { key: 'amp', label: '反相波振幅', type: 'range', min: 0.4, max: 1.6, step: 0.01 },
  ],
  exportable: true,
  Component: WaveCancel,
}
