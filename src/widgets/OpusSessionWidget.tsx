import { useEffect, useMemo, useRef, useState } from 'react'
import { prepareCanvas, palette, type CanvasPalette } from '../lib/canvas'
import { useTheme } from '../lib/theme'
import type { WidgetDefinition } from './registry'

interface OpusSessionProps {
  effort: EffortId
  rounds: number
  /** 起始上下文，单位：千 token */
  contextK: number
  /** 每轮工具结果，单位：千 token */
  toolK: number
  /** 每轮思考，单位：千 token。账本不把它当成模型的真实思考量。 */
  thinkK: number
  /** 每轮可见回复，单位：千 token */
  replyK: number
}

type EffortId = 'low' | 'medium' | 'high' | 'xhigh' | 'max'
type ModelId = 'opus55' | 'opus5' | 'sonnet55'
type Stop = 'ok' | 'disabled' | 'max_out' | 'window' | 'window_mid'

const WINDOW = 1_000_000
const MAX_OUT = 128_000
const OPUS45_WINDOW = 200_000
const OPUS45_OUT = 64_000
const MIN_CACHE = 512
const MAX_ROUNDS = 36
const MAX_TURN = 160_000

const W = 640
const H = 428

const EFFORTS: { id: EffortId; note: string }[] = [
  {
    id: 'low',
    note: '最省的一档。文档说它留给简单任务和子代理；难题上仍会想，只是比高档少。不是一张固定折扣。',
  },
  {
    id: 'medium',
    note: 'Opus 5.5 的默认。省略 effort 就是它。Opus 5 省略时走 high，同一段旧请求搬过来会低一档。',
  },
  {
    id: 'high',
    note: '文档：按任务需要花 token，把事情做好。Opus 5 和更早的 Opus 默认停在这里。',
  },
  {
    id: 'xhigh',
    note: '通用说明里面向长程任务。5.5 的专页强调：同一档往往比 Opus 5 想得更多，max_tokens 要留够。',
  },
  {
    id: 'max',
    note: '不限制 token 花费的最高档。文档的建议是留到你自己的评测确实测出质量增益再用。',
  },
]

interface ModelPrice {
  id: ModelId
  name: string
  /** 每个 token 的纳美元。$/百万 token × 1000。 */
  read: number
  write: number
  out: number
  input: number
}

const MODELS: ModelPrice[] = [
  { id: 'opus55', name: 'Opus 5.5', read: 200, write: 5000, out: 20000, input: 4000 },
  { id: 'opus5', name: 'Opus 5', read: 500, write: 6250, out: 25000, input: 5000 },
  { id: 'sonnet55', name: 'Sonnet 5.5', read: 100, write: 2500, out: 10000, input: 2000 },
]

interface RoundSnap {
  index: number
  input: number
  cached: number
  fresh: number
  output: number
  billedOutput: number
  ran: boolean
  stop: Stop
  /** 这一轮若跑在 Opus 4.5 上会怎样。4.5 不参与计价。 */
  opus45: 'ok' | 'window' | 'max_out'
  cost: Record<ModelId, number>
  uncached55: number
  read55: number
}

interface Sim {
  rounds: RoundSnap[]
  totals: Record<ModelId, number>
  uncached55: number
  read55: number
  /** 最后一轮成功之后，下一轮将要读到的上下文；若最后一轮没跑成，则是被拒绝的那次输入。 */
  context: number
  readShare: number
}

function money(nano: number): string {
  const sign = nano < 0 ? '-' : ''
  const v = Math.abs(Math.round(nano))
  const dollars = Math.floor(v / 1e9)
  const frac = Math.floor((v % 1e9) / 1e4)
    .toString()
    .padStart(5, '0')
    .replace(/0+$/, '')
  return `${sign}$${dollars}.${frac.padEnd(2, '0')}`
}

function charge(pricePerToken: number, tokens: number): number {
  return pricePerToken * tokens
}

/**
 * 教学账本，不是流量回放。
 * 第一轮把前缀按 5 分钟缓存写入；之后已缓存的按读取、新 token 按写入。
 * 思考和回复按输出价，并留在下一轮上下文里。Opus 5 的写入价用发布稿那一档，没有单独的 1 小时价。
 */
function simulate(
  context: number,
  tool: number,
  think: number,
  reply: number,
  rounds: number,
  opts: { disabled: boolean; breakLast: boolean },
): Sim {
  const totals: Record<ModelId, number> = { opus55: 0, opus5: 0, sonnet55: 0 }
  let uncached55 = 0
  let read55 = 0
  let cached = 0
  let fresh = Math.max(0, Math.round(context))
  const output = Math.max(0, Math.round(think)) + Math.max(0, Math.round(reply))
  const toolTokens = Math.max(0, Math.round(tool))
  const snaps: RoundSnap[] = []

  const limit = Math.max(1, Math.min(MAX_ROUNDS, Math.round(rounds)))
  for (let index = 1; index <= limit; index++) {
    const input = cached + fresh
    let stop: Stop = 'ok'
    let ran = true
    let billedOutput = output

    if (opts.disabled) {
      stop = 'disabled'
      ran = false
      billedOutput = 0
    } else if (output > MAX_OUT) {
      stop = 'max_out'
      ran = false
      billedOutput = 0
    } else if (input >= WINDOW) {
      stop = 'window'
      ran = false
      billedOutput = 0
    } else if (input + output > WINDOW) {
      stop = 'window_mid'
      billedOutput = WINDOW - input
    }

    const opus45: RoundSnap['opus45'] =
      input > OPUS45_WINDOW ? 'window' : billedOutput > OPUS45_OUT ? 'max_out' : 'ok'

    const cost = { opus55: 0, opus5: 0, sonnet55: 0 }
    let roundUncached = 0
    let roundRead = 0

    if (ran) {
      const rewrite = opts.breakLast && index === limit
      const tooSmallToCache = cached === 0 && fresh < MIN_CACHE && !rewrite
      for (const model of MODELS) {
        let nano = 0
        if (tooSmallToCache) {
          nano += charge(model.input, fresh)
        } else if (rewrite) {
          nano += charge(model.write, input)
        } else {
          nano += charge(model.read, cached)
          nano += charge(model.write, fresh)
        }
        nano += charge(model.out, billedOutput)
        cost[model.id] = nano
        totals[model.id] += nano
      }
      const m55 = MODELS[0]
      if (!tooSmallToCache && !rewrite) roundRead = charge(m55.read, cached)
      read55 += roundRead
      roundUncached = charge(m55.input, input) + charge(m55.out, billedOutput)
      uncached55 += roundUncached
    }

    snaps.push({
      index,
      input,
      cached,
      fresh,
      output,
      billedOutput,
      ran,
      stop,
      opus45,
      cost,
      uncached55: roundUncached,
      read55: roundRead,
    })

    if (!ran || stop === 'window_mid') break

    const wrote = cached === 0 && fresh < MIN_CACHE ? 0 : fresh
    cached += wrote
    fresh = (cached === 0 ? fresh : 0) + billedOutput + toolTokens
  }

  const last = snaps[snaps.length - 1]
  const contextAfter =
    last == null
      ? fresh
      : last.ran && last.stop === 'ok'
        ? last.input + last.billedOutput + toolTokens
        : last.input

  const total55 = totals.opus55
  return {
    rounds: snaps,
    totals,
    uncached55,
    read55,
    context: contextAfter,
    readShare: total55 > 0 ? read55 / total55 : 0,
  }
}

const CTX = { x: 28, y: 40, w: 584, h: 30 }
const ROUNDS = { x: 28, y: 118, w: 584, h: 16 }
const OUT = { x: 28, y: 186, w: 584, h: 26 }
const CHART = { x: 52, y: 268, w: 560, h: 140 }

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n))
}

function hitZone(x: number, y: number, think: number): 'rounds' | 'think' | 'reply' | null {
  if (y >= ROUNDS.y - 10 && y <= ROUNDS.y + ROUNDS.h + 14 && x >= ROUNDS.x - 8 && x <= ROUNDS.x + ROUNDS.w + 8) {
    return 'rounds'
  }
  if (y >= OUT.y - 8 && y <= OUT.y + OUT.h + 10 && x >= OUT.x - 8 && x <= OUT.x + OUT.w + 28) {
    const thinkEnd = OUT.x + (Math.min(think, MAX_OUT) / MAX_OUT) * OUT.w
    return x <= thinkEnd + 10 ? 'think' : 'reply'
  }
  return null
}

function drawRoundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, r)
}

function draw(
  ctx: CanvasRenderingContext2D,
  P: CanvasPalette,
  sim: Sim,
  think: number,
  reply: number,
  rounds: number,
  effort: EffortId,
) {
  ctx.clearRect(0, 0, W, H)
  ctx.fillStyle = P.bg
  ctx.fillRect(0, 0, W, H)
  ctx.font = '12px ui-sans-serif, system-ui, sans-serif'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = P.muted
  ctx.textAlign = 'left'
  ctx.fillText('上下文 · 下一轮要读多少', 28, 18)
  ctx.textAlign = 'right'
  ctx.fillStyle = P.faint
  ctx.fillText(`${sim.context.toLocaleString()} / 1,000,000`, 612, 18)

  ctx.fillStyle = P.bg2
  drawRoundRect(ctx, CTX.x, CTX.y, CTX.w, CTX.h, 6)
  ctx.fill()

  // 前缀是第一轮的 fresh。每一轮成功后，下一轮的 fresh 就是写回的思考、回复和工具结果。
  const growth: number[] = []
  if (sim.rounds[0]) {
    growth.push(sim.rounds[0].fresh)
    for (let i = 0; i < sim.rounds.length; i++) {
      const r = sim.rounds[i]
      if (!r.ran || r.stop !== 'ok') break
      const next = sim.rounds[i + 1]
      growth.push(next ? next.fresh : Math.max(0, sim.context - r.input))
    }
  }

  let x = CTX.x
  growth.forEach((tokens, i) => {
    const w = (tokens / WINDOW) * CTX.w
    if (w <= 0 || x >= CTX.x + CTX.w) return
    ctx.fillStyle = i % 2 === 0 ? P.accent : P.accent2
    ctx.globalAlpha = 0.88
    ctx.fillRect(x, CTX.y, Math.min(w, CTX.x + CTX.w - x), CTX.h)
    ctx.globalAlpha = 1
    x += w
  })

  const wallX = CTX.x + (OPUS45_WINDOW / WINDOW) * CTX.w
  ctx.save()
  ctx.strokeStyle = P.warn
  ctx.setLineDash([3, 3])
  ctx.beginPath()
  ctx.moveTo(wallX, CTX.y - 4)
  ctx.lineTo(wallX, CTX.y + CTX.h + 4)
  ctx.stroke()
  ctx.restore()
  ctx.fillStyle = P.warn
  ctx.textAlign = 'center'
  ctx.font = '11px ui-sans-serif, system-ui, sans-serif'
  ctx.fillText('20 万 · Opus 4.5', wallX, CTX.y + CTX.h + 14)
  ctx.fillStyle = P.faint
  ctx.textAlign = 'right'
  ctx.fillText('100 万', CTX.x + CTX.w, CTX.y + CTX.h + 14)
  ctx.textAlign = 'left'
  ctx.fillText('0', CTX.x, CTX.y + CTX.h + 14)

  ctx.fillStyle = P.muted
  ctx.font = '12px ui-sans-serif, system-ui, sans-serif'
  ctx.fillText('工具轮次 · 拖这条轴', 28, 104)
  ctx.textAlign = 'right'
  ctx.fillStyle = P.text
  ctx.fillText(`${rounds} 轮`, 612, 104)
  ctx.textAlign = 'left'

  ctx.fillStyle = P.bg2
  drawRoundRect(ctx, ROUNDS.x, ROUNDS.y, ROUNDS.w, ROUNDS.h, 8)
  ctx.fill()
  const knobT = (rounds - 1) / (MAX_ROUNDS - 1)
  const knobX = ROUNDS.x + knobT * ROUNDS.w
  ctx.fillStyle = P.accent
  ctx.beginPath()
  ctx.arc(knobX, ROUNDS.y + ROUNDS.h / 2, 8, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = P.bg
  ctx.beginPath()
  ctx.arc(knobX, ROUNDS.y + ROUNDS.h / 2, 3, 0, Math.PI * 2)
  ctx.fill()

  ctx.fillStyle = P.muted
  ctx.fillText('这一轮的输出额度 · 左拖思考，右拖回复', 28, 164)
  ctx.textAlign = 'right'
  ctx.fillStyle = think + reply > MAX_OUT ? P.danger : P.text
  ctx.fillText(`${(think + reply).toLocaleString()} / 128,000`, 612, 164)
  ctx.textAlign = 'left'

  ctx.fillStyle = P.bg2
  drawRoundRect(ctx, OUT.x, OUT.y, OUT.w, OUT.h, 6)
  ctx.fill()
  const thinkW = (Math.min(think, MAX_OUT) / MAX_OUT) * OUT.w
  const replyRoom = Math.max(0, MAX_OUT - think)
  const replyW = (Math.min(reply, replyRoom) / MAX_OUT) * OUT.w
  ctx.fillStyle = P.accent
  ctx.globalAlpha = 0.9
  ctx.fillRect(OUT.x, OUT.y, thinkW, OUT.h)
  ctx.fillStyle = P.good
  ctx.fillRect(OUT.x + thinkW, OUT.y, replyW, OUT.h)
  ctx.globalAlpha = 1
  if (think + reply > MAX_OUT) {
    ctx.strokeStyle = P.danger
    ctx.lineWidth = 1.5
    drawRoundRect(ctx, OUT.x, OUT.y, OUT.w, OUT.h, 6)
    ctx.stroke()
  }
  const cap64 = OUT.x + (OPUS45_OUT / MAX_OUT) * OUT.w
  ctx.save()
  ctx.strokeStyle = P.faint
  ctx.setLineDash([3, 3])
  ctx.beginPath()
  ctx.moveTo(cap64, OUT.y - 3)
  ctx.lineTo(cap64, OUT.y + OUT.h + 3)
  ctx.stroke()
  ctx.restore()
  ctx.font = '11px ui-sans-serif, system-ui, sans-serif'
  ctx.fillStyle = P.accent
  ctx.fillText(`思考 ${think.toLocaleString()}`, OUT.x, OUT.y + OUT.h + 14)
  ctx.fillStyle = P.good
  ctx.fillText(`回复 ${reply.toLocaleString()}`, OUT.x + 150, OUT.y + OUT.h + 14)
  ctx.fillStyle = P.faint
  ctx.textAlign = 'center'
  ctx.fillText('6.4 万', cap64, OUT.y + OUT.h + 14)
  ctx.textAlign = 'right'
  ctx.fillText('12.8 万', OUT.x + OUT.w, OUT.y + OUT.h + 14)

  ctx.textAlign = 'left'
  ctx.font = '12px ui-sans-serif, system-ui, sans-serif'
  ctx.fillStyle = P.muted
  ctx.fillText(`累计账单 · effort ${effort} 不改变这些数`, 28, 248)

  const lastStop = sim.rounds[sim.rounds.length - 1]?.stop
  if (lastStop && lastStop !== 'ok') {
    ctx.fillStyle = P.danger
    ctx.textAlign = 'right'
    ctx.font = '11px ui-sans-serif, system-ui, sans-serif'
    const label =
      lastStop === 'disabled'
        ? '400 · thinking 关不掉'
        : lastStop === 'max_out'
          ? '输出超过 12.8 万'
          : lastStop === 'window'
            ? '输入已经顶满 100 万'
            : '生成中途撞上窗口'
    ctx.fillText(label, 612, 248)
    ctx.textAlign = 'left'
    ctx.font = '12px ui-sans-serif, system-ui, sans-serif'
  }

  const ranRounds = sim.rounds.filter((r) => r.ran)
  const cum: Record<ModelId, number[]> = { opus55: [], opus5: [], sonnet55: [] }
  const cumUncached: number[] = []
  let a = 0
  let b = 0
  let c = 0
  let u = 0
  for (const r of ranRounds) {
    a += r.cost.opus55
    b += r.cost.opus5
    c += r.cost.sonnet55
    u += r.uncached55
    cum.opus55.push(a)
    cum.opus5.push(b)
    cum.sonnet55.push(c)
    cumUncached.push(u)
  }
  const maxY = Math.max(u, a, b, c, 1)

  ctx.fillStyle = P.bg2
  ctx.fillRect(CHART.x, CHART.y, CHART.w, CHART.h)
  ctx.strokeStyle = P.grid
  ctx.lineWidth = 1
  for (let i = 0; i <= 3; i++) {
    const y = CHART.y + (CHART.h * i) / 3
    ctx.beginPath()
    ctx.moveTo(CHART.x, y)
    ctx.lineTo(CHART.x + CHART.w, y)
    ctx.stroke()
    ctx.fillStyle = P.faint
    ctx.font = '10px ui-sans-serif, system-ui, sans-serif'
    ctx.textAlign = 'right'
    ctx.fillText(money(maxY * (1 - i / 3)), CHART.x - 6, y)
  }

  const plot = (series: number[], color: string, dashed: boolean) => {
    if (!series.length) return
    ctx.beginPath()
    series.forEach((v, i) => {
      const px = CHART.x + (series.length === 1 ? CHART.w / 2 : (i / (series.length - 1)) * CHART.w)
      const py = CHART.y + CHART.h - (v / maxY) * CHART.h
      if (i === 0) ctx.moveTo(px, py)
      else ctx.lineTo(px, py)
    })
    ctx.strokeStyle = color
    ctx.lineWidth = dashed ? 1.25 : 1.75
    ctx.setLineDash(dashed ? [4, 3] : [])
    ctx.stroke()
    ctx.setLineDash([])
  }
  plot(cumUncached, P.ghost, true)
  plot(cum.opus5, P.accent2, false)
  plot(cum.sonnet55, P.good, false)
  plot(cum.opus55, P.accent, false)

  ctx.font = '11px ui-sans-serif, system-ui, sans-serif'
  ctx.textAlign = 'left'
  const legendY = H - 12
  const items: { color: string; label: string; dash: boolean }[] = [
    { color: P.accent, label: 'Opus 5.5 缓存', dash: false },
    { color: P.accent2, label: 'Opus 5 缓存', dash: false },
    { color: P.good, label: 'Sonnet 5.5 缓存', dash: false },
    { color: P.ghost, label: '5.5 不缓存', dash: true },
  ]
  let lx = 28
  for (const item of items) {
    ctx.strokeStyle = item.color
    ctx.lineWidth = 2
    ctx.setLineDash(item.dash ? [3, 2] : [])
    ctx.beginPath()
    ctx.moveTo(lx, legendY)
    ctx.lineTo(lx + 16, legendY)
    ctx.stroke()
    ctx.setLineDash([])
    ctx.fillStyle = P.muted
    ctx.fillText(item.label, lx + 20, legendY)
    lx += ctx.measureText(item.label).width + 44
  }
}

function OpusSession({ props }: { props: OpusSessionProps }) {
  const theme = useTheme()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const dragRef = useRef<'rounds' | 'think' | 'reply' | null>(null)

  const [effort, setEffort] = useState<EffortId>(props.effort)
  const [rounds, setRounds] = useState(props.rounds)
  const [contextTokens, setContextTokens] = useState(Math.round(props.contextK * 1000))
  const [toolTokens, setToolTokens] = useState(Math.round(props.toolK * 1000))
  const [thinkTokens, setThinkTokens] = useState(Math.round(props.thinkK * 1000))
  const [replyTokens, setReplyTokens] = useState(Math.round(props.replyK * 1000))
  const [disabled, setDisabled] = useState(false)
  const [breakLast, setBreakLast] = useState(false)

  useEffect(() => setEffort(props.effort), [props.effort])
  useEffect(() => setRounds(props.rounds), [props.rounds])
  useEffect(() => setContextTokens(Math.round(props.contextK * 1000)), [props.contextK])
  useEffect(() => setToolTokens(Math.round(props.toolK * 1000)), [props.toolK])
  useEffect(() => setThinkTokens(Math.round(props.thinkK * 1000)), [props.thinkK])
  useEffect(() => setReplyTokens(Math.round(props.replyK * 1000)), [props.replyK])

  const sim = useMemo(
    () =>
      simulate(contextTokens, toolTokens, thinkTokens, replyTokens, rounds, {
        disabled,
        breakLast,
      }),
    [contextTokens, toolTokens, thinkTokens, replyTokens, rounds, disabled, breakLast],
  )

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = prepareCanvas(canvas, W, H)
    if (!ctx) return
    draw(ctx, palette(), sim, thinkTokens, replyTokens, rounds, effort)
  }, [theme, sim, thinkTokens, replyTokens, rounds, effort])

  const applyDrag = (zone: 'rounds' | 'think' | 'reply', x: number) => {
    if (zone === 'rounds') {
      const t = clamp((x - ROUNDS.x) / ROUNDS.w, 0, 1)
      setRounds(Math.round(1 + t * (MAX_ROUNDS - 1)))
      return
    }
    const over = Math.max(0, x - (OUT.x + OUT.w))
    const tokens = clamp(Math.round(((x - OUT.x) / OUT.w) * MAX_OUT + (over / OUT.w) * 32_000), 0, MAX_TURN)
    const stepped = Math.round(tokens / 500) * 500
    if (zone === 'think') setThinkTokens(stepped)
    else setReplyTokens(stepped)
  }

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    return {
      x: ((e.clientX - r.left) / r.width) * W,
      y: ((e.clientY - r.top) / r.height) * H,
    }
  }

  const first = sim.rounds[0]
  const refused45 = sim.rounds.find((r) => r.opus45 !== 'ok')
  const effortNote = EFFORTS.find((e) => e.id === effort)?.note ?? ''

  return (
    <div className="lb-surface">
      <canvas
        ref={canvasRef}
        className="touch-none"
        style={{ width: '100%', aspectRatio: `${W} / ${H}`, borderRadius: 8, touchAction: 'none' }}
        onPointerDown={(e) => {
          const p = point(e)
          const zone = hitZone(p.x, p.y, thinkTokens)
          if (!zone) return
          dragRef.current = zone
          e.currentTarget.setPointerCapture(e.pointerId)
          applyDrag(zone, p.x)
        }}
        onPointerMove={(e) => {
          const p = point(e)
          const zone = dragRef.current ?? hitZone(p.x, p.y, thinkTokens)
          e.currentTarget.style.cursor = zone ? 'ew-resize' : 'default'
          if (dragRef.current) applyDrag(dragRef.current, p.x)
        }}
        onPointerUp={() => {
          dragRef.current = null
        }}
        onPointerCancel={() => {
          dragRef.current = null
        }}
        onPointerLeave={(e) => {
          if (!dragRef.current) e.currentTarget.style.cursor = 'default'
        }}
      />

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <div className="t-panel inline-flex rounded-lg p-0.5">
          {EFFORTS.map((item) => (
            <button
              key={item.id}
              onClick={() => setEffort(item.id)}
              className={`rounded-[6px] px-2.5 py-1 text-xs font-medium transition-colors ${
                effort === item.id ? 't-btn-primary' : 't-muted'
              }`}
            >
              {item.id}
            </button>
          ))}
        </div>
        <button
          onClick={() => setDisabled((v) => !v)}
          className={`rounded-full px-3 py-1 text-xs font-medium ${disabled ? 't-btn-primary' : 't-btn'}`}
        >
          {disabled ? '思考已请求关闭' : '尝试关闭思考'}
        </button>
        <button
          onClick={() => setBreakLast((v) => !v)}
          className={`rounded-full px-3 py-1 text-xs font-medium ${breakLast ? 't-btn-primary' : 't-btn'}`}
        >
          {breakLast ? '最后一轮已改顶层 effort' : '最后一轮改顶层 effort'}
        </button>
      </div>
      <p className="t-faint mt-2 text-xs">{effortNote}</p>

      <div className="mt-3 grid gap-x-4 gap-y-2 sm:grid-cols-2">
        <Slider label="起始上下文" value={contextTokens} min={1000} max={980000} step={1000} onChange={setContextTokens} />
        <Slider label="每轮工具结果" value={toolTokens} min={0} max={80000} step={500} onChange={setToolTokens} />
        <Slider label="每轮思考" value={thinkTokens} min={0} max={MAX_TURN} step={500} onChange={setThinkTokens} />
        <Slider label="每轮回复" value={replyTokens} min={0} max={MAX_TURN} step={500} onChange={setReplyTokens} />
      </div>

      <div className="mt-3 flex flex-wrap gap-2 font-mono text-[11px] tabular-nums">
        {MODELS.map((model) => (
          <span key={model.id} className="t-panel rounded-full px-3 py-1">
            {model.name} {money(sim.totals[model.id])}
          </span>
        ))}
        <span className="t-panel rounded-full px-3 py-1">5.5 不缓存 {money(sim.uncached55)}</span>
        <span className="t-panel rounded-full px-3 py-1">5.5 读取占比 {(sim.readShare * 100).toFixed(1)}%</span>
      </div>
      <p className="t-faint mt-2 text-xs">
        {first?.ran
          ? `第一轮 ${money(first.cost.opus55)}。累计上下文 ${sim.context.toLocaleString()} token。`
          : '这一轮没有执行，累计账单停在上一次成功的请求。'}
        {refused45
          ? ` Opus 4.5 从第 ${refused45.index} 轮起${refused45.opus45 === 'window' ? '因超过 20 万上下文拒收' : '因输出超过 6.4 万放不下'}。`
          : ' Opus 4.5 的 20 万窗口和 6.4 万输出还盖得住这些轮。'}
        {disabled ? ' 关闭思考返回 400 invalid_request_error，请求不算钱。' : ''}
        {breakLast ? ' 最后一轮整段上下文按写入价重计，模拟顶层 effort 换档导致缓存失效。' : ''}
      </p>
      <p className="t-faint mt-1 text-xs">
        价是公布的 5 分钟缓存写入、缓存读取和输出。思考滑块是你假设的 token 数，effort 不会替你填这个数。输出价是缓存读取价的 100 倍（$20 / $0.20）。
      </p>
    </div>
  )
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (n: number) => void
}) {
  return (
    <label className="t-muted flex items-center gap-2 text-xs">
      <span className="w-24 shrink-0">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1"
      />
      <span className="t-strong w-16 text-right font-mono tabular-nums">{value.toLocaleString()}</span>
    </label>
  )
}

const EFFORT_OPTIONS = EFFORTS.map((e) => ({ value: e.id, label: e.id }))

export const OpusSessionWidget: WidgetDefinition<OpusSessionProps> = {
  type: 'opus-session',
  label: '会话账本',
  description: '拖动工具轮次、思考和上下文，按公布价格看一次代理会话的账单，以及 20 万、100 万、12.8 万三道墙。',
  icon: '📒',
  defaultProps: { effort: 'medium', rounds: 2, contextK: 100, toolK: 4, thinkK: 2, replyK: 1 },
  configSchema: [
    { key: 'effort', label: 'effort', type: 'select', options: EFFORT_OPTIONS },
    { key: 'rounds', label: '工具轮次', type: 'range', min: 1, max: MAX_ROUNDS, step: 1 },
    { key: 'contextK', label: '起始上下文（千 token）', type: 'range', min: 1, max: 900, step: 1 },
    { key: 'toolK', label: '每轮工具结果（千 token）', type: 'range', min: 0, max: 40, step: 1 },
    { key: 'thinkK', label: '每轮思考（千 token）', type: 'range', min: 0, max: 128, step: 1 },
    { key: 'replyK', label: '每轮回复（千 token）', type: 'range', min: 0, max: 128, step: 1 },
  ],
  Component: OpusSession,
}
