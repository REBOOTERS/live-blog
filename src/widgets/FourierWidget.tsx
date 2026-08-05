import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAnimationFrame } from '../lib/useAnimationFrame'
import { prepareCanvas } from '../lib/canvas'
import type { WidgetDefinition } from './registry'

interface FourierProps {
  harmonics: number // K: number of frequency components used in reconstruction
  speed: number // cursor sweep speed (cycles per second)
  showSpectrum: boolean
}

const N = 64
const W = 540
const H = 300
const PAD_L = 36
const PAD_R = 16
const SIG_TOP = 12
const SIG_BOT = 150
const SPEC_TOP = 172
const SPEC_BOT = H - 14
const PLOT_W = W - PAD_L - PAD_R

type Preset = 'sine' | 'square' | 'triangle' | 'sawtooth' | 'sum'

function presetSignal(p: Preset): number[] {
  const x = new Array<number>(N)
  for (let n = 0; n < N; n++) {
    const t = n / N
    switch (p) {
      case 'sine':
        x[n] = Math.sin(2 * Math.PI * 2 * t)
        break
      case 'square':
        x[n] = Math.sin(2 * Math.PI * t) >= 0 ? 1 : -1
        break
      case 'triangle':
        x[n] = (2 / Math.PI) * Math.asin(Math.sin(2 * Math.PI * t))
        break
      case 'sawtooth':
        x[n] = 2 * t - 1
        break
      case 'sum':
        x[n] = 0.55 * Math.sin(2 * Math.PI * 1 * t) + 0.3 * Math.sin(2 * Math.PI * 5 * t) + 0.15 * Math.sin(2 * Math.PI * 9 * t)
        break
    }
  }
  return x
}

interface DFT {
  re: Float64Array
  im: Float64Array
  amp: Float64Array // display amplitude per k (0..N/2)
}

function computeDFT(sig: number[]): DFT {
  const re = new Float64Array(N)
  const im = new Float64Array(N)
  for (let k = 0; k < N; k++) {
    let sr = 0
    let si = 0
    for (let n = 0; n < N; n++) {
      const ang = (2 * Math.PI * k * n) / N
      sr += sig[n] * Math.cos(ang)
      si += sig[n] * Math.sin(ang)
    }
    // X[k] = sum x[n] e^{-i ang} = sr - i*si
    re[k] = sr
    im[k] = -si
  }
  const half = N / 2
  const amp = new Float64Array(half + 1)
  for (let k = 0; k <= half; k++) {
    const mag = Math.hypot(re[k], im[k])
    amp[k] = k === 0 || k === half ? mag / N : (2 * mag) / N
  }
  return { re, im, amp }
}

function reconstruct(dft: DFT, K: number): number[] {
  const out = new Array<number>(N)
  const kMax = Math.min(K, N / 2)
  for (let n = 0; n < N; n++) {
    let v = dft.re[0] / N
    for (let k = 1; k <= kMax; k++) {
      const ang = (2 * Math.PI * k * n) / N
      v += (2 / N) * (dft.re[k] * Math.cos(ang) - dft.im[k] * Math.sin(ang))
    }
    out[n] = v
  }
  return out
}

const PRESETS: { id: Preset; label: string }[] = [
  { id: 'sine', label: '正弦' },
  { id: 'square', label: '方波' },
  { id: 'triangle', label: '三角波' },
  { id: 'sawtooth', label: '锯齿波' },
  { id: 'sum', label: '多频叠加' },
]

export function Fourier({ props }: { props: FourierProps }) {
  const { showSpectrum } = props
  // Local copies so readers can tweak without persisting; the editor's
  // ConfigPanel still drives the saved defaults via props.
  const [harmonics, setHarmonics] = useState(props.harmonics)
  const [speed, setSpeed] = useState(props.speed)
  useEffect(() => setHarmonics(props.harmonics), [props.harmonics])
  useEffect(() => setSpeed(props.speed), [props.speed])

  const [signal, setSignal] = useState<number[]>(() => presetSignal('square'))
  const [preset, setPreset] = useState<Preset | 'custom'>('square')
  const [playing, setPlaying] = useState(true)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawingRef = useRef(false)
  const lastIdxRef = useRef(-1)
  const signalRef = useRef(signal)
  signalRef.current = signal
  const phaseRef = useRef(0)

  const dft = useMemo(() => computeDFT(signal), [signal])
  const recon = useMemo(() => reconstruct(dft, harmonics), [dft, harmonics])
  const maxAmp = useMemo(() => Math.max(0.001, ...Array.from(dft.amp)), [dft])

  const choosePreset = (p: Preset) => {
    setPreset(p)
    setSignal(presetSignal(p))
  }

  // --- pointer drawing ---
  const posToSample = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!
    const r = canvas.getBoundingClientRect()
    const x = ((e.clientX - r.left) / r.width) * W
    const y = ((e.clientY - r.top) / r.height) * H
    if (y < SIG_TOP - 4 || y > SIG_BOT + 4) return null
    const idx = Math.round(((x - PAD_L) / PLOT_W) * (N - 1))
    if (idx < 0 || idx >= N) return null
    const mid = (SIG_TOP + SIG_BOT) / 2
    const half = (SIG_BOT - SIG_TOP) / 2
    const v = -((y - mid) / half)
    return { idx: Math.max(0, Math.min(N - 1, idx)), v: Math.max(-1.1, Math.min(1.1, v)) }
  }

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const hit = posToSample(e)
    if (!hit) return
    drawingRef.current = true
    lastIdxRef.current = hit.idx
    e.currentTarget.setPointerCapture(e.pointerId)
    setPreset('custom')
    paint(hit.idx, hit.v)
  }
  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return
    const hit = posToSample(e)
    if (!hit) return
    paint(hit.idx, hit.v)
  }
  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return
    drawingRef.current = false
    lastIdxRef.current = -1
    e.currentTarget.releasePointerCapture(e.pointerId)
  }

  const paint = useCallback((idx: number, v: number) => {
    const last = lastIdxRef.current
    // freehand: linearly interpolate between the previous and current sample
    setSignal((prev) => {
      const next = prev.slice()
      if (last < 0) {
        next[idx] = v
      } else {
        const lo = Math.min(last, idx)
        const hi = Math.max(last, idx)
        const span = hi - lo || 1
        for (let i = lo; i <= hi; i++) {
          const t = (i - lo) / span
          next[i] = prev[last] * (1 - t) + v * t
        }
      }
      return next
    })
    lastIdxRef.current = idx
  }, [])

  // --- animation: sweep cursor ---
  useAnimationFrame((dt) => {
    if (playing && !drawingRef.current) phaseRef.current = (phaseRef.current + dt * speed) % 1
    draw()
  })

  const draw = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = prepareCanvas(canvas, W, H)
    if (!ctx) return
    ctx.clearRect(0, 0, W, H)

    const sig = signalRef.current
    const mid = (SIG_TOP + SIG_BOT) / 2
    const half = (SIG_BOT - SIG_TOP) / 2
    const xOf = (n: number) => PAD_L + (n / (N - 1)) * PLOT_W
    const yOf = (v: number) => mid - v * half

    // canvas background
    ctx.fillStyle = '#070b16'
    ctx.fillRect(0, 0, W, H)

    // signal panel background
    ctx.fillStyle = '#0a0f1e'
    ctx.fillRect(PAD_L, SIG_TOP - 4, PLOT_W, SIG_BOT - SIG_TOP + 8)
    // zero line
    ctx.strokeStyle = 'rgba(129,140,248,0.25)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(PAD_L, mid)
    ctx.lineTo(W - PAD_R, mid)
    ctx.stroke()
    // gridlines at ±1
    ctx.strokeStyle = 'rgba(148,163,184,0.08)'
    for (const gv of [-1, 1]) {
      ctx.beginPath()
      ctx.moveTo(PAD_L, yOf(gv))
      ctx.lineTo(W - PAD_R, yOf(gv))
      ctx.stroke()
    }

    // original signal (faint dashed)
    ctx.strokeStyle = 'rgba(148,163,184,0.6)'
    ctx.lineWidth = 1.5
    ctx.setLineDash([3, 3])
    drawPath(ctx, sig, xOf, yOf)
    ctx.setLineDash([])

    // reconstruction (bold neon)
    ctx.strokeStyle = '#22d3ee'
    ctx.lineWidth = 2.5
    ctx.shadowColor = 'rgba(34,211,238,0.5)'
    ctx.shadowBlur = 8
    drawPath(ctx, recon, xOf, yOf)
    ctx.shadowBlur = 0

    // filled area under reconstruction up to cursor
    const cursorN = phaseRef.current * (N - 1)
    const ci = Math.round(cursorN)
    ctx.fillStyle = 'rgba(34,211,238,0.1)'
    ctx.beginPath()
    ctx.moveTo(xOf(0), mid)
    for (let n = 0; n <= ci; n++) ctx.lineTo(xOf(n), yOf(recon[n]))
    ctx.lineTo(xOf(ci), mid)
    ctx.closePath()
    ctx.fill()

    // cursor
    ctx.strokeStyle = '#fb7185'
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(xOf(ci), SIG_TOP - 4)
    ctx.lineTo(xOf(ci), SIG_BOT + 4)
    ctx.stroke()
    ctx.fillStyle = '#fb7185'
    ctx.shadowColor = 'rgba(251,113,133,0.8)'
    ctx.shadowBlur = 8
    ctx.beginPath()
    ctx.arc(xOf(ci), yOf(recon[ci]), 4, 0, Math.PI * 2)
    ctx.fill()
    ctx.shadowBlur = 0

    // axis labels
    ctx.fillStyle = '#64748b'
    ctx.font = '10px ui-monospace, monospace'
    ctx.fillText('+1', 6, yOf(1) + 3)
    ctx.fillText(' 0', 10, mid + 3)
    ctx.fillText('-1', 8, yOf(-1) + 3)
    ctx.fillStyle = '#818cf8'
    ctx.fillText('时域 n →', PAD_L, SIG_BOT + 12)

    if (!showSpectrum) return

    // spectrum panel
    const specH = SPEC_BOT - SPEC_TOP
    ctx.fillStyle = '#0a0f1e'
    ctx.fillRect(PAD_L, SPEC_TOP - 4, PLOT_W, specH + 8)
    ctx.fillStyle = '#818cf8'
    ctx.font = '10px ui-monospace, monospace'
    ctx.fillText('频域 |X[k]| →', PAD_L, SPEC_TOP - 8)

    const kCount = N / 2 + 1
    const gap = 2
    const barW = (PLOT_W - gap * (kCount - 1)) / kCount
    for (let k = 0; k < kCount; k++) {
      const h = (dft.amp[k] / maxAmp) * (specH - 6)
      const x = PAD_L + k * (barW + gap)
      const used = k <= harmonics
      ctx.fillStyle = used ? '#6366f1' : 'rgba(148,163,184,0.25)'
      if (used) {
        ctx.shadowColor = 'rgba(99,102,241,0.5)'
        ctx.shadowBlur = 6
      }
      ctx.fillRect(x, SPEC_BOT - h, barW, h)
      ctx.shadowBlur = 0
    }
  }

  return (
    <div className="lb-surface">
      <canvas
        ref={canvasRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        style={{ width: '100%', aspectRatio: `${W} / ${H}`, touchAction: 'none' }}
        className="touch-none"
      />

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-white/10 bg-slate-950/60 p-0.5">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              onClick={() => choosePreset(p.id)}
              className={`rounded-[6px] px-2.5 py-1 text-xs font-medium transition-colors ${
                preset === p.id
                  ? 'bg-gradient-to-r from-indigo-500 to-cyan-400 text-slate-950'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <button
          onClick={() => setPlaying((v) => !v)}
          className="ml-auto rounded-md bg-gradient-to-r from-indigo-500 to-cyan-400 px-3 py-1.5 text-xs font-semibold text-slate-950 shadow-[0_0_16px_-6px_rgba(99,102,241,1)] hover:brightness-110"
        >
          {playing ? '⏸ 暂停' : '▶ 播放'}
        </button>
      </div>

      <div className="mt-3 space-y-2">
        <label className="flex items-center gap-3 text-xs text-slate-400">
          <span className="w-28 shrink-0">重建频率数 K</span>
          <input
            type="range"
            min={0}
            max={N / 2}
            step={1}
            value={harmonics}
            onChange={(e) => setHarmonics(Number(e.target.value))}
            className="flex-1"
          />
          <span className="w-10 text-right font-mono tabular-nums text-slate-300">{harmonics}</span>
        </label>
        <label className="flex items-center gap-3 text-xs text-slate-400">
          <span className="w-28 shrink-0">扫描速度</span>
          <input
            type="range"
            min={0.1}
            max={2}
            step={0.05}
            value={speed}
            onChange={(e) => setSpeed(Number(e.target.value))}
            className="flex-1"
          />
          <span className="w-10 text-right font-mono tabular-nums text-slate-300">{speed.toFixed(2)}×</span>
        </label>
      </div>
      <p className="mt-2 text-xs text-slate-400">
        灰色虚线为原始信号，青色实线为前 {harmonics} 个频率分量的重建；在上方时域图中拖动鼠标可手绘信号，频谱中深色柱为已采用的分量。
      </p>
    </div>
  )
}

function drawPath(
  ctx: CanvasRenderingContext2D,
  data: number[],
  xOf: (n: number) => number,
  yOf: (v: number) => number,
) {
  ctx.beginPath()
  for (let n = 0; n < data.length; n++) {
    const x = xOf(n)
    const y = yOf(data[n])
    if (n === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.stroke()
}

export const FourierWidget: WidgetDefinition<FourierProps> = {
  type: 'fourier',
  label: '傅里叶变换',
  description: '调节参与重建的频率分量数，观察任意信号如何被分解为正弦波的叠加。',
  icon: '🌊',
  defaultProps: {
    harmonics: 4,
    speed: 0.4,
    showSpectrum: true,
  },
  configSchema: [
    { key: 'harmonics', label: '重建频率数 K', type: 'range', min: 0, max: 32, step: 1 },
    { key: 'speed', label: '扫描速度', type: 'range', min: 0.1, max: 2, step: 0.05 },
    { key: 'showSpectrum', label: '显示频谱', type: 'checkbox' },
  ],
  Component: Fourier,
}
