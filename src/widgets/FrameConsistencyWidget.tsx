import { useEffect, useRef, useState } from 'react'
import { useAnimationFrame } from '../lib/useAnimationFrame'
import { prepareCanvas, palette } from '../lib/canvas'
import { useTheme } from '../lib/theme'
import type { WidgetDefinition } from './registry'

interface FrameConsistencyProps {
  corr: number // 帧间噪声相关性：0 = 每帧独立采样（融尾巴），1 = 完全共享（时间低通）
}

const W = 560
const H = 300
const K = 7 // 尾巴控制点数
const RESAMPLE_HZ = 12 // 「视频帧率」：白噪声按这个频率重掷
const HISTORY = 48 // 轨迹保留的视频帧数（12Hz × 4s）

// 尾巴各点的固定相位：协调模式下沿平滑曲线摆动
const PHASES = Array.from({ length: K + 1 }, (_, i) => (i * 2.399) % (Math.PI * 2))

function smoothNoise(i: number, t: number): number {
  return 0.6 * Math.sin(t * 1.6 + PHASES[i]) + 0.4 * Math.sin(t * 2.7 + PHASES[i] * 1.7)
}

function hexToRgba(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`
}

function FrameConsistency({ props }: { props: FrameConsistencyProps }) {
  useTheme() // re-render so palette() re-reads on theme switch
  const [corr, setCorr] = useState(props.corr)
  useEffect(() => setCorr(props.corr), [props.corr])
  const [playing, setPlaying] = useState(true)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const tRef = useRef(0)
  const sinceResample = useRef(0)
  const whiteRef = useRef<number[]>(new Array(K + 1).fill(0))
  const tipRef = useRef(0)
  const historyRef = useRef<number[]>([])
  const stateRef = useRef({ corr, playing })
  stateRef.current = { corr, playing }

  useAnimationFrame((dt) => {
    if (stateRef.current.playing) {
      tRef.current += dt
      sinceResample.current += dt
      if (sinceResample.current >= 1 / RESAMPLE_HZ) {
        sinceResample.current = 0
        // 逐帧独立采样：每个「视频帧」重新掷一遍噪声，没有谁负责与上一帧协调
        whiteRef.current = whiteRef.current.map(() => Math.random() * 2 - 1)
        historyRef.current.push(tipRef.current)
        if (historyRef.current.length > HISTORY) historyRef.current.shift()
      }
    }
    // 拖拽/暂停时也持续重绘，画面不冻结
    draw()
  })

  const draw = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = prepareCanvas(canvas, W, H)
    if (!ctx) return
    const P = palette()
    const c = stateRef.current.corr
    const t = tRef.current

    const bg = ctx.createLinearGradient(0, 0, 0, H)
    bg.addColorStop(0, P.bg)
    bg.addColorStop(1, P.bg2)
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, W, H)

    // 尾巴各点偏移：独立白噪声按 (1-ρ) 权重混入，协调分量按 ρ
    const off: number[] = []
    for (let i = 0; i <= K; i++) {
      const amp = 3 + i * 6
      off[i] = amp * ((1 - c) * whiteRef.current[i] + c * smoothNoise(i, t))
    }
    tipRef.current = off[K]

    const groundY = 208
    ctx.strokeStyle = P.grid
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(24, groundY)
    ctx.lineTo(W - 24, groundY)
    ctx.stroke()

    // 尾巴（主角）：从身后伸出的渐细折线
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    for (let i = 0; i < K; i++) {
      const x0 = 270 - i * 12
      const y0 = 150 - i * 6 + off[i]
      const x1 = 270 - (i + 1) * 12
      const y1 = 150 - (i + 1) * 6 + off[i + 1]
      ctx.strokeStyle = hexToRgba(P.accent, 1 - i * 0.06)
      ctx.lineWidth = 9 - i
      ctx.beginPath()
      ctx.moveTo(x0, y0)
      ctx.lineTo(x1, y1)
      ctx.stroke()
    }

    // 身体与头：头也吃同一套噪声（幅度小得多）
    const bob = 4 * ((1 - c) * whiteRef.current[0] + c * smoothNoise(0, t))
    ctx.fillStyle = hexToRgba(P.text, 0.05)
    ctx.strokeStyle = P.muted
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.ellipse(318, 172, 52, 30, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()

    const hy = 124 + bob
    ctx.beginPath()
    ctx.arc(398, hy, 26, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
    // 耳朵
    for (const [x0, y0, x1, y1, x2, y2] of [
      [382, hy - 20, 392, hy - 48, 402, hy - 24],
      [404, hy - 24, 416, hy - 50, 424, hy - 22],
    ]) {
      ctx.beginPath()
      ctx.moveTo(x0, y0)
      ctx.lineTo(x1, y1)
      ctx.lineTo(x2, y2)
      ctx.closePath()
      ctx.fill()
      ctx.stroke()
    }
    // 眼睛与胡须
    ctx.fillStyle = P.text
    ctx.beginPath()
    ctx.arc(392, hy - 4, 2.5, 0, Math.PI * 2)
    ctx.fill()
    ctx.beginPath()
    ctx.arc(410, hy - 4, 2.5, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = P.faint
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(422, hy + 2)
    ctx.lineTo(448, hy - 4)
    ctx.moveTo(422, hy + 8)
    ctx.lineTo(448, hy + 10)
    ctx.stroke()

    // 尾巴尖轨迹：把「帧间是否协调」变成一条看得见的线
    const SL_L = 28
    const SL_R = W - 28
    const SL_BASE = 258
    ctx.fillStyle = P.faint
    ctx.font = '11px ui-monospace, monospace'
    ctx.fillText('尾巴尖的位置 · 最近 4 秒（12 帧/秒）', SL_L, 232)
    ctx.strokeStyle = P.grid
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(SL_L, SL_BASE)
    ctx.lineTo(SL_R, SL_BASE)
    ctx.stroke()
    const hist = historyRef.current
    if (hist.length > 1) {
      ctx.strokeStyle = hexToRgba(P.accent2, 0.9)
      ctx.lineWidth = 1.6
      ctx.beginPath()
      hist.forEach((v, i) => {
        const x = SL_L + (i / (HISTORY - 1)) * (SL_R - SL_L)
        const y = SL_BASE - Math.max(-42, Math.min(42, v)) * 0.55
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      })
      ctx.stroke()
    }

    // 状态行
    ctx.fillStyle = P.muted
    ctx.font = '11px ui-monospace, monospace'
    ctx.fillText(
      `ρ = ${c.toFixed(2)} · ${c < 0.5 ? '逐帧独立采样' : '时间协调（噪声低通）'}`,
      28,
      20,
    )
  }

  return (
    <div className="lb-surface">
      <canvas
        ref={canvasRef}
        style={{ width: '100%', aspectRatio: `${W} / ${H}`, borderRadius: 8 }}
      />

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <div className="t-panel inline-flex rounded-lg p-0.5">
          {[
            { v: 0, l: '逐帧独立' },
            { v: 0.9, l: '时间协调' },
          ].map((o) => (
            <button
              key={o.l}
              onClick={() => setCorr(o.v)}
              className={`rounded-[6px] px-3 py-1 text-xs font-medium transition ${
                Math.abs(corr - o.v) < 0.03 ? 't-btn-primary' : 't-muted'
              }`}
            >
              {o.l}
            </button>
          ))}
        </div>
        <button onClick={() => setPlaying((p) => !p)} className="t-btn rounded-md px-3 py-1.5 text-sm">
          {playing ? '⏸ 暂停' : '▶ 播放'}
        </button>
        <label className="t-muted flex w-full items-center gap-2 text-xs sm:w-64">
          <span className="shrink-0">噪声相关性 ρ</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={corr}
            onChange={(e) => setCorr(Number(e.target.value))}
            className="flex-1"
          />
          <span className="t-strong w-8 text-right font-mono tabular-nums">{corr.toFixed(2)}</span>
        </label>
        <p className="t-faint ml-auto text-xs">
          {corr < 0.5 ? '每帧各自掷噪声：尾巴融化、画面沸腾' : '噪声沿时间低通：相邻帧彼此通气'}
        </p>
      </div>
    </div>
  )
}

export const FrameConsistencyWidget: WidgetDefinition<FrameConsistencyProps> = {
  type: 'frame-consistency',
  label: '帧间一致性',
  description: '同一只猫两种采样方式：逐帧独立掷噪声时尾巴融化，噪声时间相关后立刻连续。',
  icon: '🎞️',
  defaultProps: { corr: 0 },
  configSchema: [{ key: 'corr', label: '噪声时间相关性 ρ', type: 'range', min: 0, max: 1, step: 0.05 }],
  exportable: true,
  Component: FrameConsistency,
}
