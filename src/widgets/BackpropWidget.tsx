import { useEffect, useMemo, useRef, useState } from 'react'
import { useAnimationFrame } from '../lib/useAnimationFrame'
import { prepareCanvas, palette } from '../lib/canvas'
import type { WidgetDefinition } from './registry'

interface BackpropProps {
  hidden: number
  learningRate: number
  speed: number // gradient steps per frame
  target: TargetId
}

type TargetId = 'sine' | 'step' | 'gaussian' | 'cubic'

const TARGETS: { id: TargetId; label: string; fn: (x: number) => number }[] = [
  { id: 'sine', label: '正弦 sin(πx)', fn: (x) => Math.sin(Math.PI * x) },
  { id: 'step', label: '阶跃', fn: (x) => (x > 0 ? 0.9 : -0.9) },
  { id: 'gaussian', label: '高斯峰', fn: (x) => 2 * Math.exp(-((3 * x) ** 2)) - 1 },
  { id: 'cubic', label: '三次曲线', fn: (x) => 2 * x ** 3 - x },
]

const NS = 48 // training samples
const PLOT_W = 540
const PLOT_H = 220
const PAD = 30

interface Weights {
  h: number
  w1: Float64Array
  b1: Float64Array
  w2: Float64Array
  b2: number
}

function initWeights(h: number): Weights {
  const w1 = new Float64Array(h)
  const b1 = new Float64Array(h)
  const w2 = new Float64Array(h)
  for (let i = 0; i < h; i++) {
    w1[i] = (Math.random() * 2 - 1) * 0.8
    b1[i] = (Math.random() * 2 - 1) * 0.3
    w2[i] = (Math.random() * 2 - 1) * 0.6
  }
  return { h, w1, b1, w2, b2: 0 }
}

const tanh = Math.tanh

function forward(w: Weights, x: number): { y: number; a1: Float64Array } {
  const a1 = new Float64Array(w.h)
  let y = w.b2
  for (let i = 0; i < w.h; i++) {
    const a = tanh(w.w1[i] * x + w.b1[i])
    a1[i] = a
    y += w.w2[i] * a
  }
  return { y, a1 }
}

/** One full-batch gradient descent step; returns the MSE loss. */
function trainStep(w: Weights, xs: number[], ys: number[], lr: number): number {
  const h = w.h
  const n = xs.length
  const dw1 = new Float64Array(h)
  const db1 = new Float64Array(h)
  const dw2 = new Float64Array(h)
  let db2 = 0
  let loss = 0

  for (let s = 0; s < n; s++) {
    const x = xs[s]
    const target = ys[s]
    const { y, a1 } = forward(w, x)
    const err = y - target
    loss += err * err
    const delta = (err * 2) / n // dL/dy

    for (let i = 0; i < h; i++) {
      dw2[i] += delta * a1[i]
      db2 += delta
      // tanh'(z) = 1 - a^2
      const dh = delta * w.w2[i] * (1 - a1[i] * a1[i])
      dw1[i] += dh * x
      db1[i] += dh
    }
  }

  for (let i = 0; i < h; i++) {
    w.w2[i] -= lr * dw2[i]
    w.b1[i] -= lr * db1[i]
    w.w1[i] -= lr * dw1[i]
  }
  w.b2 -= lr * db2
  return loss / n
}

export function Backprop({ props }: { props: BackpropProps }) {
  // Mirror props into local state so readers can experiment live without
  // persisting; the editor's ConfigPanel drives the saved defaults via props.
  const [hidden, setHidden] = useState(props.hidden)
  const [learningRate, setLearningRate] = useState(props.learningRate)
  const [speed, setSpeed] = useState(props.speed)
  const [target, setTarget] = useState<TargetId>(props.target)
  useEffect(() => setHidden(props.hidden), [props.hidden])
  useEffect(() => setLearningRate(props.learningRate), [props.learningRate])
  useEffect(() => setSpeed(props.speed), [props.speed])
  useEffect(() => setTarget(props.target), [props.target])

  const [playing, setPlaying] = useState(true)
  const [, force] = useState(0)
  const [epoch, setEpoch] = useState(0)
  const lossRef = useRef(0)
  const [lossDisplay, setLossDisplay] = useState(0)
  const historyRef = useRef<number[]>([])

  const weightsRef = useRef<Weights>(initWeights(hidden))
  const lrRef = useRef(learningRate)
  lrRef.current = learningRate

  const xs = useMemo(() => Array.from({ length: NS }, (_, i) => -1 + (2 * i) / (NS - 1)), [])
  const ys = useMemo(() => {
    const fn = TARGETS.find((t) => t.id === target)!.fn
    return xs.map(fn)
  }, [xs, target])

  // reset network when structure / target changes
  useEffect(() => {
    weightsRef.current = initWeights(hidden)
    historyRef.current = []
    setEpoch(0)
    lossRef.current = 0
    setLossDisplay(0)
  }, [hidden, target])

  const stepOnce = () => {
    const loss = trainStep(weightsRef.current, xs, ys, lrRef.current)
    lossRef.current = loss
    const hist = historyRef.current
    hist.push(loss)
    if (hist.length > 160) hist.shift()
  }

  // Batch several gradient steps per frame, then trigger a single React update
  // (calling setState per step would be thousands of updates/sec at high speed).
  useAnimationFrame((dt) => {
    if (playing) {
      const steps = Math.max(1, Math.round(speed * dt * 60))
      for (let i = 0; i < steps; i++) stepOnce()
      setEpoch((e) => e + steps)
    }
    drawPlot()
    force((n) => (n + 1) % 1_000_000)
  })

  // sync displayed loss ~4x/sec
  useEffect(() => {
    const id = setInterval(() => setLossDisplay(lossRef.current), 250)
    return () => clearInterval(id)
  }, [])

  const plotRef = useRef<HTMLCanvasElement>(null)
  const lossRefCanvas = useRef<HTMLCanvasElement>(null)

  const drawPlot = () => {
    const canvas = plotRef.current
    if (!canvas) return
    const ctx = prepareCanvas(canvas, PLOT_W, PLOT_H)
    if (!ctx) return
    ctx.clearRect(0, 0, PLOT_W, PLOT_H)
    const P = palette()

    const xOf = (x: number) => PAD + ((x + 1) / 2) * (PLOT_W - 2 * PAD)
    const yOf = (y: number) => PLOT_H / 2 - (y / 1.3) * (PLOT_H / 2 - 16)

    // bg
    ctx.fillStyle = P.bg
    ctx.fillRect(PAD, 12, PLOT_W - 2 * PAD, PLOT_H - 24)
    // grid
    ctx.strokeStyle = P.grid
    ctx.lineWidth = 1
    for (let gx = -1; gx <= 1; gx += 0.5) {
      ctx.beginPath()
      ctx.moveTo(xOf(gx), 12)
      ctx.lineTo(xOf(gx), PLOT_H - 12)
      ctx.stroke()
    }
    for (let gy = -1; gy <= 1; gy += 0.5) {
      ctx.beginPath()
      ctx.moveTo(PAD, yOf(gy))
      ctx.lineTo(PLOT_W - PAD, yOf(gy))
      ctx.stroke()
    }
    // axes
    ctx.strokeStyle = P.axis
    ctx.beginPath()
    ctx.moveTo(PAD, yOf(0))
    ctx.lineTo(PLOT_W - PAD, yOf(0))
    ctx.moveTo(xOf(0), 12)
    ctx.lineTo(xOf(0), PLOT_H - 12)
    ctx.stroke()

    // target
    ctx.strokeStyle = P.ghost
    ctx.lineWidth = 2
    ctx.setLineDash([4, 4])
    ctx.beginPath()
    for (let i = 0; i < xs.length; i++) {
      const px = xOf(xs[i])
      const py = yOf(ys[i])
      if (i === 0) ctx.moveTo(px, py)
      else ctx.lineTo(px, py)
    }
    ctx.stroke()
    ctx.setLineDash([])

    // prediction
    const w = weightsRef.current
    ctx.strokeStyle = '#22d3ee'
    ctx.lineWidth = 2.5
    ctx.shadowColor = 'rgba(34,211,238,0.5)'
    ctx.shadowBlur = 8
    ctx.beginPath()
    for (let i = 0; i < xs.length; i++) {
      const px = xOf(xs[i])
      const py = yOf(forward(w, xs[i]).y)
      if (i === 0) ctx.moveTo(px, py)
      else ctx.lineTo(px, py)
    }
    ctx.stroke()
    ctx.shadowBlur = 0

    drawLossChart()
  }

  const drawLossChart = () => {
    const canvas = lossRefCanvas.current
    if (!canvas) return
    const CW = 200
    const CH = 110
    const ctx = prepareCanvas(canvas, CW, CH)
    if (!ctx) return
    const P = palette()
    ctx.clearRect(0, 0, CW, CH)
    ctx.fillStyle = P.bg
    ctx.fillRect(0, 0, CW, CH)
    ctx.strokeStyle = P.grid
    ctx.lineWidth = 1
    for (let gy = 0.25; gy < 1; gy += 0.25) {
      ctx.beginPath()
      ctx.moveTo(0, gy * CH)
      ctx.lineTo(CW, gy * CH)
      ctx.stroke()
    }
    const hist = historyRef.current
    if (hist.length < 2) {
      ctx.fillStyle = P.faint
      ctx.font = '11px ui-monospace, monospace'
      ctx.fillText('loss →', 8, 18)
      return
    }
    const max = Math.max(...hist)
    const min = Math.min(...hist)
    const range = max - min || 1
    // gradient-filled loss curve
    const grad = ctx.createLinearGradient(0, 0, 0, CH)
    grad.addColorStop(0, 'rgba(34,211,238,0.35)')
    grad.addColorStop(1, 'rgba(34,211,238,0)')
    ctx.fillStyle = grad
    ctx.beginPath()
    hist.forEach((v, i) => {
      const x = (i / (hist.length - 1)) * CW
      const y = CH - 4 - ((v - min) / range) * (CH - 16)
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    })
    ctx.lineTo(CW, CH)
    ctx.lineTo(0, CH)
    ctx.closePath()
    ctx.fill()
    ctx.strokeStyle = '#22d3ee'
    ctx.lineWidth = 1.5
    ctx.beginPath()
    hist.forEach((v, i) => {
      const x = (i / (hist.length - 1)) * CW
      const y = CH - 4 - ((v - min) / range) * (CH - 16)
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    })
    ctx.stroke()
    ctx.fillStyle = P.muted
    ctx.font = '10px ui-monospace, monospace'
    ctx.fillText('loss', 6, 12)
  }

  const reset = () => {
    weightsRef.current = initWeights(hidden)
    historyRef.current = []
    setEpoch(0)
    lossRef.current = 0
    setLossDisplay(0)
  }

  const w = weightsRef.current
  const maxAbsW = Math.max(0.01, ...w.w1, ...w.w2, ...w.b1.map((v) => Math.abs(v)))

  return (
    <div className="lb-surface">
      <canvas
        ref={plotRef}
        style={{ width: '100%', aspectRatio: `${PLOT_W} / ${PLOT_H}`, borderRadius: 8 }}
      />

      {/* controls */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <select
          value={target}
          onChange={(e) => setTarget(e.target.value as TargetId)}
          className="t-input rounded-md px-2 py-1.5 text-sm outline-none"
        >
          {TARGETS.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
        <button onClick={() => setPlaying((p) => !p)} className="t-btn-primary rounded-md px-3 py-1.5 text-sm">
          {playing ? '⏸ 暂停' : '▶ 训练'}
        </button>
        <button
          onClick={() => {
            stepOnce()
            setEpoch((e) => e + 1)
          }}
          className="t-btn rounded-md px-3 py-1.5 text-sm"
        >
          单步
        </button>
        <button onClick={reset} className="t-btn rounded-md px-3 py-1.5 text-sm">
          ↺ 重置
        </button>
        <div className="t-faint ml-auto flex items-center gap-3 font-mono text-xs">
          <span className="t-muted tabular-nums">epoch {epoch}</span>
          <span className="tabular-nums" style={{ color: 'var(--lb-accent)' }}>
            loss {lossDisplay.toFixed(4)}
          </span>
        </div>
      </div>

      <div className="mt-3 grid gap-4 md:grid-cols-[1fr_220px]">
        {/* network graph */}
        <NetworkGraph w={w} maxAbsW={maxAbsW} />

        <div>
          <canvas
            ref={lossRefCanvas}
            style={{ width: '100%', aspectRatio: '200 / 110', borderRadius: 8 }}
          />
          <div className="t-muted mt-2 grid grid-cols-1 gap-2 text-xs">
            <label className="flex items-center gap-2">
              <span className="w-12 shrink-0">隐藏层</span>
              <input
                type="range"
                min={2}
                max={6}
                step={1}
                value={hidden}
                onChange={(e) => setHidden(Number(e.target.value))}
                className="flex-1"
              />
              <span className="t-strong w-4 text-right font-mono tabular-nums">{hidden}</span>
            </label>
            <label className="flex items-center gap-2">
              <span className="w-12 shrink-0">学习率</span>
              <input
                type="range"
                min={0.005}
                max={0.3}
                step={0.005}
                value={learningRate}
                onChange={(e) => setLearningRate(Number(e.target.value))}
                className="flex-1"
              />
              <span className="t-strong w-10 text-right font-mono tabular-nums">{learningRate.toFixed(3)}</span>
            </label>
          </div>
        </div>
      </div>

      <p className="t-muted mt-2 text-xs">
        灰色虚线是目标函数，青色实线是这个 1→{hidden}→1 小网络的当前输出。连线颜色表示权重正负（青正红负），粗细表示权重大小——训练时观察误差如何沿网络反向传播并更新这些连线。
      </p>
    </div>
  )
}

function NetworkGraph({ w, maxAbsW }: { w: Weights; maxAbsW: number }) {
  const W = 320
  const H = 150
  const inX = 30
  const outX = W - 30
  const hidX = W / 2
  const hiddenYs = Array.from({ length: w.h }, (_, i) => (H / (w.h + 1)) * (i + 1))
  const inY = H / 2
  const outY = H / 2

  const edge = (weight: number, x1: number, y1: number, x2: number, y2: number, key: string) => {
    const norm = Math.abs(weight) / maxAbsW
    const color = weight >= 0 ? `rgba(34,211,238,${0.25 + norm * 0.7})` : `rgba(251,113,133,${0.25 + norm * 0.7})`
    return (
      <line
        key={key}
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        stroke={color}
        strokeWidth={0.5 + norm * 3.5}
      />
    )
  }

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full rounded-lg"
      style={{ maxHeight: 160, background: 'var(--lb-panel)' }}
    >
      {/* input -> hidden */}
      {hiddenYs.map((hy, i) => edge(w.w1[i], inX, inY, hidX, hy, `i${i}`))}
      {/* hidden -> output */}
      {hiddenYs.map((hy, i) => edge(w.w2[i], hidX, hy, outX, outY, `o${i}`))}

      <Node cx={inX} cy={inY} label="x" />
      {hiddenYs.map((hy, i) => (
        <Node key={`h${i}`} cx={hidX} cy={hy} label={`h${i + 1}`} bias={w.b1[i]} />
      ))}
      <Node cx={outX} cy={outY} label="ŷ" bias={w.b2} />
    </svg>
  )
}

function Node({ cx, cy, label, bias }: { cx: number; cy: number; label: string; bias?: number }) {
  return (
    <g>
      <circle cx={cx} cy={cy} r={11} strokeWidth={1.5} style={{ fill: 'var(--lb-panel)', stroke: 'var(--lb-accent)' }} />
      <text x={cx} y={cy + 3.5} textAnchor="middle" fontSize={9} fontWeight={600} style={{ fill: 'var(--lb-text-heading)' }}>
        {label}
      </text>
      {bias !== undefined && Math.abs(bias) > 0.05 && (
        <text x={cx} y={cy + 22} textAnchor="middle" fontSize={8} fontFamily="ui-monospace, monospace" style={{ fill: 'var(--lb-faint)' }}>
          b={bias.toFixed(2)}
        </text>
      )}
    </g>
  )
}

export const BackpropWidget: WidgetDefinition<BackpropProps> = {
  type: 'backprop',
  label: '反向传播',
  description: '观察一个小神经网络如何通过梯度下降与反向传播拟合目标函数。',
  icon: '🧠',
  defaultProps: {
    hidden: 4,
    learningRate: 0.08,
    speed: 8,
    target: 'sine',
  },
  configSchema: [
    { key: 'hidden', label: '隐藏层神经元', type: 'range', min: 2, max: 6, step: 1 },
    { key: 'learningRate', label: '学习率', type: 'range', min: 0.005, max: 0.3, step: 0.005 },
    { key: 'speed', label: '训练速度', type: 'range', min: 1, max: 30, step: 1, unit: '步/帧' },
    {
      key: 'target',
      label: '目标函数',
      type: 'select',
      options: TARGETS.map((t) => ({ value: t.id, label: t.label })),
    },
  ],
  Component: Backprop,
}
