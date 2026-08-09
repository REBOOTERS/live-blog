import { useEffect, useRef, useState } from 'react'
import { useAnimationFrame } from '../lib/useAnimationFrame'
import { prepareCanvas, palette } from '../lib/canvas'
import { useTheme } from '../lib/theme'
import type { WidgetDefinition } from './registry'

interface SoundProps {
  mode: 'single' | 'beats'
}

type Wave = 'sine' | 'square' | 'triangle' | 'sawtooth'

const W = 540
const H = 220
const PAD = 16

export function SoundWave({ props }: { props: SoundProps }) {
  const { mode: modeProp } = props
  const [mode, setMode] = useState<SoundProps['mode']>(modeProp)
  useEffect(() => setMode(modeProp), [modeProp])
  useTheme() // re-render so palette() re-reads on theme switch

  // live controls (mirror nothing to props — these are reader-only tweaks)
  const [freq1, setFreq1] = useState(261.63) // C4
  const [freq2, setFreq2] = useState(329.63) // E4
  const [amp, setAmp] = useState(0.35)
  const [wave, setWave] = useState<Wave>('sine')
  const [playing, setPlaying] = useState(false)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const tRef = useRef(0)

  // Web Audio refs
  const ctxRef = useRef<AudioContext | null>(null)
  const oscA = useRef<OscillatorNode | null>(null)
  const oscB = useRef<OscillatorNode | null>(null)
  const gainA = useRef<GainNode | null>(null)
  const gainB = useRef<GainNode | null>(null)

  const freqRef = useRef({ f1: freq1, f2: freq2, amp, wave, mode })
  freqRef.current = { f1: freq1, f2: freq2, amp, wave, mode }

  // keep live audio params in sync while playing
  useEffect(() => {
    if (oscA.current) oscA.current.frequency.value = freq1
    if (oscB.current) oscB.current.frequency.value = freq2
  }, [freq1, freq2])
  useEffect(() => {
    if (gainA.current) gainA.current.gain.value = mode === 'beats' ? amp / 2 : amp
    if (gainB.current) gainB.current.gain.value = mode === 'beats' ? amp / 2 : 0
  }, [amp, mode])
  useEffect(() => {
    if (oscA.current) oscA.current.type = wave
    if (oscB.current) oscB.current.type = wave
  }, [wave])

  const stop = () => {
    oscA.current?.stop()
    oscB.current?.stop()
    oscA.current = oscB.current = null
    gainA.current = gainB.current = null
    setPlaying(false)
  }

  // cleanup on unmount
  useEffect(() => () => {
    oscA.current?.stop()
    oscB.current?.stop()
    ctxRef.current?.close().catch(() => {})
  }, [])

  const play = () => {
    if (playing) {
      stop()
      return
    }
    // AudioContext must be created in response to a user gesture
    if (!ctxRef.current) {
      const Ctx = window.AudioContext || (window as any).webkitAudioContext
      ctxRef.current = new Ctx()
    }
    const ctx = ctxRef.current!
    if (ctx.state === 'suspended') ctx.resume()

    const gA = ctx.createGain()
    gA.gain.value = mode === 'beats' ? amp / 2 : amp
    gA.connect(ctx.destination)
    const oA = ctx.createOscillator()
    oA.type = wave
    oA.frequency.value = freq1
    oA.connect(gA)
    oA.start()
    oscA.current = oA
    gainA.current = gA

    if (mode === 'beats') {
      const gB = ctx.createGain()
      gB.gain.value = amp / 2
      gB.connect(ctx.destination)
      const oB = ctx.createOscillator()
      oB.type = wave
      oB.frequency.value = freq2
      oB.connect(gB)
      oB.start()
      oscB.current = oB
      gainB.current = gB
    }
    setPlaying(true)
  }

  // stop oscillators when switching mode (so the second osc is created/removed)
  useEffect(() => {
    if (playing) stop()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode])

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

    // bg
    const bg = ctx.createLinearGradient(0, 0, 0, H)
    bg.addColorStop(0, P.bg)
    bg.addColorStop(1, P.bg2)
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, W, H)

    // grid + zero line
    ctx.strokeStyle = P.grid
    ctx.lineWidth = 1
    for (let gx = 0; gx <= W; gx += 40) {
      ctx.beginPath()
      ctx.moveTo(gx, 0)
      ctx.lineTo(gx, H)
      ctx.stroke()
    }
    ctx.strokeStyle = P.axis
    ctx.beginPath()
    ctx.moveTo(0, H / 2)
    ctx.lineTo(W, H / 2)
    ctx.stroke()

    const { f1, f2, amp, wave: wv, mode: md } = freqRef.current
    const t = tRef.current
    const half = H / 2 - PAD

    const sample = (x: number): number => {
      const phase = (x / W) * Math.PI * 2 * 2 // show ~2 reference cycles across the width baseline
      const one = waveValue(wv, f1, phase, t)
      if (md === 'single') return one * amp
      const two = waveValue(wv, f2, phase, t)
      return (one + two) / 2 * amp
    }

    // ghost component waves in beats mode
    if (md === 'beats') {
      ctx.strokeStyle = P.ghost
      ctx.lineWidth = 1.2
      ctx.beginPath()
      for (let x = 0; x <= W; x++) {
        const phase = (x / W) * Math.PI * 2 * 2
        const y = H / 2 - waveValue(wv, f1, phase, t) * (amp / 2) * half
        if (x === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.stroke()
      ctx.strokeStyle = P.ghost
      ctx.beginPath()
      for (let x = 0; x <= W; x++) {
        const phase = (x / W) * Math.PI * 2 * 2
        const y = H / 2 - waveValue(wv, f2, phase, t) * (amp / 2) * half
        if (x === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.stroke()
    }

    // composite wave
    ctx.strokeStyle = P.accent
    ctx.lineWidth = 2.5
    ctx.shadowColor = P.glow
    ctx.shadowBlur = 10
    ctx.beginPath()
    for (let x = 0; x <= W; x++) {
      const y = H / 2 - sample(x) * half
      if (x === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()
    ctx.shadowBlur = 0

    // labels
    ctx.fillStyle = P.muted
    ctx.font = '11px ui-monospace, monospace'
    ctx.fillText(md === 'single' ? `${f1.toFixed(1)} Hz · ${waveName(wv)}` : `${f1.toFixed(1)} + ${f2.toFixed(1)} Hz`, PAD, 18)
    if (md === 'beats') {
      const beat = Math.abs(f1 - f2)
      ctx.fillStyle = P.warn
      ctx.fillText(`拍频 ≈ ${beat.toFixed(1)} Hz（每秒起伏 ${beat.toFixed(1)} 次）`, PAD, H - 8)
    }
  }

  const noteName = (f: number) => {
    const notes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
    const n = Math.round(12 * Math.log2(f / 440) + 69)
    const note = notes[((n % 12) + 12) % 12]
    const oct = Math.floor(n / 12) - 1
    return `${note}${oct}`
  }

  return (
    <div className="lb-surface">
      <canvas
        ref={canvasRef}
        style={{ width: '100%', aspectRatio: `${W} / ${H}`, borderRadius: 8 }}
      />

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <div className="t-panel inline-flex rounded-lg p-0.5">
          {(['single', 'beats'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`rounded-[6px] px-3 py-1 text-xs font-medium transition ${mode === m ? 't-btn-primary' : 't-muted'}`}
            >
              {m === 'single' ? '单音' : '双音叠加（拍频）'}
            </button>
          ))}
        </div>
        <button
          onClick={play}
          className="rounded-md px-4 py-1.5 text-sm font-semibold transition"
          style={
            playing
              ? { background: 'rgba(244,63,94,0.9)', color: '#fff' }
              : { background: 'var(--lb-accent-grad)', color: '#fff' }
          }
        >
          {playing ? '⏸ 停止' : '▶ 发声'}
        </button>
        <span className="t-faint ml-auto font-mono text-[10px]">
          {playing ? '🔊 正在通过扬声器播放' : '点击发声以真实播放（需允许音频）'}
        </span>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="t-muted flex items-center gap-2 text-xs">
          <span className="w-20 shrink-0">频率 {noteName(freq1)}</span>
          <input type="range" min={80} max={1200} step={1} value={freq1} onChange={(e) => setFreq1(Number(e.target.value))} className="flex-1" />
          <span className="t-strong w-16 text-right font-mono tabular-nums">{freq1.toFixed(0)}Hz</span>
        </label>
        {mode === 'beats' ? (
          <label className="t-muted flex items-center gap-2 text-xs">
            <span className="w-20 shrink-0">频率② {noteName(freq2)}</span>
            <input type="range" min={80} max={1200} step={1} value={freq2} onChange={(e) => setFreq2(Number(e.target.value))} className="flex-1" />
            <span className="t-strong w-16 text-right font-mono tabular-nums">{freq2.toFixed(0)}Hz</span>
          </label>
        ) : (
          <label className="t-muted flex items-center gap-2 text-xs">
            <span className="w-20 shrink-0">振幅（响度）</span>
            <input type="range" min={0.02} max={0.6} step={0.01} value={amp} onChange={(e) => setAmp(Number(e.target.value))} className="flex-1" />
            <span className="t-strong w-16 text-right font-mono tabular-nums">{Math.round(amp * 100)}%</span>
          </label>
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <div className="t-panel inline-flex rounded-lg p-0.5">
          {(['sine', 'square', 'triangle', 'sawtooth'] as const).map((wv) => (
            <button
              key={wv}
              onClick={() => setWave(wv)}
              className={`rounded-[6px] px-2.5 py-1 text-xs font-medium transition ${wave === wv ? 't-btn-primary' : 't-muted'}`}
            >
              {waveName(wv)}
            </button>
          ))}
        </div>
        <p className="t-faint ml-auto text-xs">
          {mode === 'beats'
            ? '两条频率相近的波相加，振幅周期性起伏即「拍频」——调音师靠它判断是否合拍。'
            : '频率↑音调升高，振幅↑响度增大，波形决定音色。'}
        </p>
      </div>
    </div>
  )
}

function waveValue(wave: Wave, freq: number, phase: number, t: number): number {
  // phase is a spatial progress across the canvas; combine with time so the
  // wave animates. freq scales how many cycles fit in the visible window.
  const arg = phase * freq / 80 + t * (freq / 80) * 2
  switch (wave) {
    case 'sine':
      return Math.sin(arg)
    case 'square':
      return Math.sin(arg) >= 0 ? 1 : -1
    case 'triangle':
      return (2 / Math.PI) * Math.asin(Math.sin(arg))
    case 'sawtooth': {
      const p = (arg / (2 * Math.PI)) % 1
      const v = (p < 0 ? p + 1 : p) * 2 - 1
      return v
    }
  }
}

function waveName(w: Wave) {
  return { sine: '正弦', square: '方波', triangle: '三角', sawtooth: '锯齿' }[w]
}

export const SoundWaveWidget: WidgetDefinition<SoundProps> = {
  type: 'sound-wave',
  label: '声波与频率',
  description: '调节频率、振幅与波形，真实发声并可视化；双音叠加演示拍频。',
  icon: '🔊',
  defaultProps: {
    mode: 'single',
  },
  configSchema: [
    {
      key: 'mode',
      label: '模式',
      type: 'select',
      options: [
        { value: 'single', label: '单音' },
        { value: 'beats', label: '双音叠加（拍频）' },
      ],
    },
  ],
  Component: SoundWave,
}
