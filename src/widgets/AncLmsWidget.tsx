import { useEffect, useRef, useState } from 'react'
import { useAnimationFrame } from '../lib/useAnimationFrame'
import { prepareCanvas, palette } from '../lib/canvas'
import { useTheme } from '../lib/theme'
import type { WidgetDefinition } from './registry'

interface AncLmsProps {
  mu: number // LMS 步长
}

const W = 540
const H = 348
const PAD = 14
const L = 16 // 自适应滤波器抽头数
const STEPS = 40 // 每帧推进的样本数
const TONE = 150 // 参考噪声里的窄带成分（Hz，fs = 1000）
const HIST_MAX = 1200 // 学习曲线保留的点数（每点 = 一帧）
// 参考信号整体缩放：让总功率 ≈ 2，LMS 稳定上限 2/λmax ≈ 1（好读）
const XSCALE = 2.3

// 一条未知的「声学通路」：参考麦克风到耳膜的 FIR 响应（含几个样本延迟）
function makePath(delay: number): number[] {
  const h = new Array<number>(L).fill(0)
  h[delay] = 0.55 + Math.random() * 0.4
  h[delay + 1] = (Math.random() - 0.5) * 0.5
  h[delay + 2] = (Math.random() - 0.5) * 0.3
  return h
}

// 近似高斯白噪声（4 个均匀分布之和）
function gauss(): number {
  return (Math.random() + Math.random() + Math.random() + Math.random() - 2) * 1.03
}

export function AncLms({ props }: { props: AncLmsProps }) {
  useTheme() // re-render so palette() re-reads on theme switch
  const P = palette()
  const [mu, setMu] = useState(props.mu)
  useEffect(() => setMu(props.mu), [props.mu])

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const muRef = useRef(mu)
  muRef.current = mu

  const simRef = useRef({
    h: makePath(3),
    w: new Array<number>(L).fill(0),
    x: new Array<number>(L).fill(0),
    ema: NaN, // 残余 e² 的指数平均
    emaPx: NaN, // 参考信号功率的指数平均（估计 λmax 用）
    ema0: NaN, // 初始参考
    n: 0,
    hist: [] as number[], // 每帧一点的学习曲线（dB）
    diverged: false,
  })

  // 残余读数节流刷新（约 4 次/秒），不逐帧 setState
  const [, setTick] = useState(0)
  const tickRef = useRef(0)

  const reset = () => {
    const s = simRef.current
    s.w = new Array<number>(L).fill(0)
    s.ema = NaN
    s.emaPx = NaN
    s.ema0 = NaN
    s.n = 0
    s.hist = []
    s.diverged = false
    setTick((t) => t + 1)
  }

  const shift = () => {
    const s = simRef.current
    if (s.diverged) return
    s.h = makePath(2 + Math.floor(Math.random() * 3))
  }

  useAnimationFrame(() => {
    const s = simRef.current
    if (!s.diverged) {
      for (let k = 0; k < STEPS; k++) {
        s.n++
        const xNew = XSCALE * (0.85 * gauss() + 0.5 * Math.sin((2 * Math.PI * TONE * s.n) / 1000))
        s.x.shift()
        s.x.push(xNew)
        let d = 0
        let y = 0
        for (let j = 0; j < L; j++) {
          d += s.h[j] * s.x[L - 1 - j]
          y += s.w[j] * s.x[L - 1 - j]
        }
        const e = d - y
        if (!Number.isFinite(e) || Math.abs(e) > 1e6) {
          s.diverged = true
          break
        }
        for (let j = 0; j < L; j++) s.w[j] += muRef.current * e * s.x[L - 1 - j]
        s.ema = Number.isNaN(s.ema) ? e * e : 0.98 * s.ema + 0.02 * e * e
        s.emaPx = Number.isNaN(s.emaPx) ? xNew * xNew : 0.99 * s.emaPx + 0.01 * xNew * xNew
      }
      if (Number.isNaN(s.ema0)) s.ema0 = s.ema
      s.hist.push(10 * Math.log10(Math.max(s.ema / s.ema0, 1e-6)))
      if (s.hist.length > HIST_MAX) s.hist.shift()
    }
    if (++tickRef.current % 15 === 0) setTick((t) => t + 1)
    draw()
  })

  const draw = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = prepareCanvas(canvas, W, H)
    if (!ctx) return
    const P = palette()
    const s = simRef.current

    const bg = ctx.createLinearGradient(0, 0, 0, H)
    bg.addColorStop(0, P.bg)
    bg.addColorStop(1, P.bg2)
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, W, H)

    // ---- top: learning curve ----
    const top = 26
    const bot = 186
    const dbMax = 4
    const dbMin = -50
    const fy = (v: number) => top + ((dbMax - v) / (dbMax - dbMin)) * (bot - top)
    const view = s.hist.slice(-900)
    const fx = (i: number) => PAD + (i / (view.length - 1 || 1)) * (W - 2 * PAD)

    ctx.fillStyle = P.muted
    ctx.font = '10px ui-monospace, monospace'
    ctx.fillText('残余噪声（dB，相对初始）', PAD, 16)
    for (const v of [0, -10, -20, -30, -40]) {
      ctx.strokeStyle = v === 0 ? P.axis : P.grid
      ctx.beginPath()
      ctx.moveTo(PAD, fy(v))
      ctx.lineTo(W - PAD, fy(v))
      ctx.stroke()
      ctx.fillStyle = v === 0 ? P.muted : P.faint
      ctx.fillText(`${v}`, W - PAD - 22, fy(v) - 3)
    }
    // 每格 ≈ 1 秒（60 帧一点）
    for (let sec = 1; sec * 60 < view.length; sec++) {
      const gx = fx(sec * 60)
      ctx.strokeStyle = P.grid
      ctx.beginPath()
      ctx.moveTo(gx, top)
      ctx.lineTo(gx, bot)
      ctx.stroke()
      ctx.fillStyle = P.faint
      ctx.fillText(`${sec}s`, gx - 6, bot + 12)
    }
    if (view.length > 1) {
      ctx.strokeStyle = s.diverged ? P.danger : P.good
      ctx.lineWidth = 1.8
      ctx.beginPath()
      view.forEach((v, i) => {
        const y = fy(Math.min(Math.max(v, dbMin), dbMax))
        if (i === 0) ctx.moveTo(fx(i), y)
        else ctx.lineTo(fx(i), y)
      })
      ctx.stroke()
    }

    // ---- bottom: adaptive weights vs unknown path ----
    const bTop = 212
    const bBot = H - 24
    const cy = (bTop + bBot) / 2
    const bw = (W - 2 * PAD) / L
    const wMax = Math.max(0.8, ...s.h.map(Math.abs))
    const scale = (bBot - bTop) / 2 / wMax

    ctx.fillStyle = P.muted
    ctx.fillText('自适应权重 w（实心）→ 未知声学通路 h（描边）', PAD, bTop - 6)
    ctx.strokeStyle = P.grid
    ctx.beginPath()
    ctx.moveTo(PAD, cy)
    ctx.lineTo(W - PAD, cy)
    ctx.stroke()

    for (let j = 0; j < L; j++) {
      const cx0 = PAD + j * bw + bw * 0.18
      const wid = bw * 0.64
      // target h
      const hh = s.h[j] * scale
      ctx.strokeStyle = P.ghost
      ctx.lineWidth = 1.2
      ctx.setLineDash([3, 3])
      ctx.strokeRect(cx0, Math.min(cy, cy - hh), wid, Math.abs(hh))
      ctx.setLineDash([])
      // current w（发散时钳在边界，仍能看出乱飞）
      const wv = Math.max(-wMax, Math.min(wMax, s.w[j])) * scale
      ctx.fillStyle = s.diverged ? P.danger : P.good
      if (Math.abs(wv) > 0.5) {
        ctx.fillRect(cx0, Math.min(cy, cy - wv), wid, Math.abs(wv))
      }
    }
  }

  const s = simRef.current
  const lastDb = s.hist.length ? s.hist[s.hist.length - 1] : 0
  const muMax = Number.isNaN(s.emaPx) ? 1 : 2 / s.emaPx

  return (
    <div className="lb-surface">
      <canvas ref={canvasRef} style={{ width: '100%', aspectRatio: `${W} / ${H}`, borderRadius: 8 }} />

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button onClick={reset} className="t-btn rounded-md px-3 py-1.5 text-sm">
          ↺ 重置
        </button>
        <button onClick={shift} className="t-btn rounded-md px-3 py-1.5 text-sm">
          🔀 环境突变（换一条通路）
        </button>
        {s.diverged ? (
          <span
            className="rounded-full px-2.5 py-1 font-mono text-xs"
            style={{ color: P.danger, background: `color-mix(in srgb, ${P.danger} 10%, transparent)` }}
          >
            发散：μ 超出稳定上限，权重飞了——点重置，把 μ 调小
          </span>
        ) : (
          <span className="t-muted ml-auto font-mono text-xs tabular-nums">
            残余 {lastDb <= -49.9 ? '≤ −50' : lastDb.toFixed(1)} dB
          </span>
        )}
      </div>

      <label className="t-muted mt-3 flex items-center gap-2 text-xs">
        <span className="w-16 shrink-0">步长 μ</span>
        <input type="range" min={0.001} max={1.6} step={0.001} value={mu} onChange={(e) => setMu(Number(e.target.value))} className="flex-1" />
        <span className="t-strong w-14 text-right font-mono tabular-nums">{mu.toFixed(3)}</span>
        <span className="t-faint hidden w-44 shrink-0 sm:block">稳定上限 ≈ {muMax.toFixed(2)}</span>
      </label>

      <p className="t-faint mt-2 text-xs">
        滤波器从零开始学：误差一出现就按 μ·e·x 修正每个权重。μ 小学得慢但稳，μ 大学得快、越过稳定上限直接发散。
      </p>
    </div>
  )
}

export const AncLmsWidget: WidgetDefinition<AncLmsProps> = {
  type: 'anc-lms',
  label: 'LMS 自适应降噪',
  description: '自适应滤波器现场学习未知的声学通路：看误差曲线收敛、权重长成目标、μ 过大发散。',
  icon: '🎚️',
  defaultProps: { mu: 0.006 },
  configSchema: [{ key: 'mu', label: '步长 μ', type: 'range', min: 0.001, max: 1.6, step: 0.001 }],
  exportable: true,
  Component: AncLms,
}
