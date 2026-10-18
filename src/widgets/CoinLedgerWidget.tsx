import { useEffect, useMemo, useRef, useState } from 'react'
import { prepareCanvas, palette, type CanvasPalette } from '../lib/canvas'
import { useTheme } from '../lib/theme'
import type { WidgetDefinition } from './registry'

/**
 * 教学账本，不连任何一条链，也不算哈希。
 * 各记各的：同一枚签给两个人，两本账都没看见另一笔，所以都收下。
 * 同一本：先写上的把这枚标成花过，后写的退回。
 * 改页：一页记着上一页的指纹。改掉旧页，从那一页到最新一页都要重写。
 * 10 分钟是协议里的目标间隔，6 页是收款习惯，不是共识规则。
 * 发行按比特币的整数补贴：50 枚起，每 210,000 页砍半，不够 1 聪就停。
 */

const COIN = 100_000_000n
const HALVING = 210_000
const CAP = 21_000_000n * COIN
const PAGE_MINUTES = 10
const PAGES = [0, 210_000, 420_000, 630_000, 840_000, 1_050_000] as const
const W = 680
const H = 448

export type CoinMode = 'copies' | 'pages' | 'rules'
export type Payee = 'yi' | 'bing'

interface CoinLedgerProps {
  mode: CoinMode
  shared: boolean
  first: Payee
  /** 从最新一页往回数，1 到 6 */
  back: number
  /** 已经翻过的页数，对齐 210,000 的倍数 */
  height: number
}

const MODES: { id: CoinMode; label: string }[] = [
  { id: 'copies', label: '双花' },
  { id: 'pages', label: '改页' },
  { id: 'rules', label: '发行' },
]

export function clampBack(n: number): number {
  const x = Math.round(Number(n))
  if (!Number.isFinite(x)) return 1
  return Math.max(1, Math.min(6, x))
}

export function clampPages(n: number): number {
  const x = Number(n)
  if (!Number.isFinite(x)) return 840_000
  let best: number = PAGES[0]
  let dist = Infinity
  for (const step of PAGES) {
    const d = Math.abs(step - x)
    if (d < dist) {
      dist = d
      best = step
    }
  }
  return best
}

export function clampPayee(value: string): Payee {
  return value === 'bing' ? 'bing' : 'yi'
}

function payeeName(id: Payee): string {
  return id === 'yi' ? '乙' : '丙'
}

export function issuedSats(pagesWritten: number): bigint {
  let left = BigInt(clampPages(pagesWritten))
  let reward = 50n * COIN
  let total = 0n
  while (left > 0n && reward > 0n) {
    const n = left > BigInt(HALVING) ? BigInt(HALVING) : left
    total += n * reward
    left -= n
    reward /= 2n
  }
  return total
}

/** 已经翻过这么多页之后，下一页新写多少。 */
export function subsidySats(pagesWritten: number): bigint {
  let halvings = Math.floor(clampPages(pagesWritten) / HALVING)
  let reward = 50n * COIN
  while (halvings > 0 && reward > 0n) {
    reward /= 2n
    halvings -= 1
  }
  return reward
}

export function formatBtc(sats: bigint): string {
  const neg = sats < 0n
  const v = neg ? -sats : sats
  const whole = v / COIN
  const frac = v % COIN
  const text = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  if (frac === 0n) return (neg ? '-' : '') + text
  const digits = frac.toString().padStart(8, '0').replace(/0+$/, '')
  return (neg ? '-' : '') + text + '.' + digits
}

function formatInt(n: number): string {
  return Math.trunc(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

export function copyHeadline(shared: boolean, first: Payee): string {
  if (!shared) return '两本账都收下了。这枚被花了两次。'
  return `只收下先写的${payeeName(first)}。${payeeName(first === 'yi' ? 'bing' : 'yi')}被退回。`
}

export function pageHeadline(back: number): string {
  const n = clampBack(back)
  return `改倒数第 ${n} 页，要重写 ${n} 页。按 10 分钟一页，这是 ${n * PAGE_MINUTES} 分钟。`
}

export function supplyHeadline(height: number): string {
  const pages = clampPages(height)
  return `翻过 ${formatInt(pages)} 页，写出 ${formatBtc(issuedSats(pages))}。这一页 ${formatBtc(subsidySats(pages))}。`
}

function headline(mode: CoinMode, shared: boolean, first: Payee, back: number, height: number): string {
  if (mode === 'pages') return pageHeadline(back)
  if (mode === 'rules') return supplyHeadline(height)
  return copyHeadline(shared, first)
}

function detail(mode: CoinMode, shared: boolean, height: number): string {
  if (mode === 'pages') {
    return '左边更旧。每一页记着上一页的指纹。改掉某一页，它自己和比它新的页都对不上，都要重写。10 分钟是目标节奏，不是保证。'
  }
  if (mode === 'rules') {
    const gap = formatBtc(CAP - issuedSats(height))
    return `每 210,000 页，新写的数量砍半。离 21,000,000 这条线还差 ${gap}。不够 1 聪就停，所以到不了正好 21,000,000。押金本没有这条线。欠条的美元不在账上。`
  }
  if (!shared) return '两本账各记各的。乙的账里没写付给丙，丙的账里没写付给乙。两张签名都对，所以两本都收下。'
  return '同一本里，先写上的那笔把这枚标成花过了。后写的还是这一枚，对不上，退回。'
}

function CoinLedger({ props }: { props: CoinLedgerProps }) {
  const theme = useTheme()
  const [mode, setMode] = useState<CoinMode>(props.mode)
  const [shared, setShared] = useState(Boolean(props.shared))
  const [first, setFirst] = useState<Payee>(clampPayee(props.first))
  const [back, setBack] = useState(clampBack(props.back))
  const [height, setHeight] = useState(clampPages(props.height))

  useEffect(() => setMode(props.mode), [props.mode])
  useEffect(() => setShared(Boolean(props.shared)), [props.shared])
  useEffect(() => setFirst(clampPayee(props.first)), [props.first])
  useEffect(() => setBack(clampBack(props.back)), [props.back])
  useEffect(() => setHeight(clampPages(props.height)), [props.height])

  const view = useMemo(() => ({ mode, shared, first, back, height }), [mode, shared, first, back, height])
  const loser: Payee = first === 'yi' ? 'bing' : 'yi'
  const chips =
    mode === 'pages'
      ? [`重写 ${back} 页`, `${back * PAGE_MINUTES} 分钟`, back === 6 ? '习惯等的页数' : `还差 ${6 - back} 页到 6`]
      : mode === 'rules'
        ? [`已写出 ${formatBtc(issuedSats(height))}`, `这一页 ${formatBtc(subsidySats(height))}`, `还差 ${formatBtc(CAP - issuedSats(height))}`]
        : shared
          ? [`${payeeName(first)} 1`, `${payeeName(loser)} 0`, '退回 1']
          : ['乙 1', '丙 1', '退回 0']

  return (
    <div className="lb-surface">
      <p className="t-strong text-sm">{headline(mode, shared, first, back, height)}</p>
      <LedgerCanvas theme={theme} view={view} />
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
        {mode === 'copies' && (
          <div className="t-panel inline-flex flex-wrap rounded-lg p-0.5">
            <button
              onClick={() => setShared(false)}
              className={`rounded-[6px] px-2.5 py-1 text-xs font-medium transition-colors ${
                shared ? 't-muted' : 't-btn-primary'
              }`}
            >
              各记各的
            </button>
            <button
              onClick={() => setShared(true)}
              className={`rounded-[6px] px-2.5 py-1 text-xs font-medium transition-colors ${
                shared ? 't-btn-primary' : 't-muted'
              }`}
            >
              同一本
            </button>
          </div>
        )}
      </div>
      <div className="mt-3">
        {mode === 'copies' ? (
          <Slider
            label="先写谁"
            value={first === 'yi' ? 0 : 1}
            min={0}
            max={1}
            step={1}
            text={payeeName(first)}
            onChange={(n) => setFirst(n === 0 ? 'yi' : 'bing')}
          />
        ) : mode === 'pages' ? (
          <Slider label="改到" value={back} min={1} max={6} step={1} text={String(back)} onChange={(n) => setBack(clampBack(n))} />
        ) : (
          <Slider
            label="页数"
            value={height}
            min={0}
            max={1_050_000}
            step={HALVING}
            text={formatInt(height)}
            onChange={(n) => setHeight(clampPages(n))}
          />
        )}
      </div>
      <div className="mt-3 flex flex-wrap gap-2 font-mono text-[11px] tabular-nums">
        {chips.map((item) => (
          <span key={item} className="t-panel rounded-full px-3 py-1">
            {item}
          </span>
        ))}
      </div>
      <p className="t-faint mt-2 text-xs leading-5">{detail(mode, shared, height)}</p>
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
      <span className="w-12 shrink-0">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1"
      />
      <span className="t-strong w-24 text-right font-mono tabular-nums">{text}</span>
    </label>
  )
}

function LedgerCanvas({
  theme,
  view,
}: {
  theme: string
  view: { mode: CoinMode; shared: boolean; first: Payee; back: number; height: number }
}) {
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
    if (view.mode === 'pages') drawPages(ctx, P, view.back)
    else if (view.mode === 'rules') drawRules(ctx, P, view.height)
    else drawCopies(ctx, P, view.shared, view.first)
  }, [theme, view])

  return (
    <canvas
      ref={canvasRef}
      className="mt-3 touch-none"
      style={{ width: '100%', aspectRatio: `${W} / ${H}`, borderRadius: 8, touchAction: 'none' }}
    />
  )
}

function drawCopies(ctx: CanvasRenderingContext2D, P: CanvasPalette, shared: boolean, first: Payee) {
  ctx.font = '12px ui-sans-serif, system-ui, sans-serif'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = P.muted
  ctx.fillText(shared ? '一本账。先写上的留下，后写的退回。' : '两本账。同一枚，各自都没看见另一笔。', 24, 28)

  if (!shared) {
    drawBook(ctx, P, 24, 52, 308, 364, '乙的账', [
      { who: '乙', ok: true },
    ])
    drawBook(ctx, P, 348, 52, 308, 364, '丙的账', [
      { who: '丙', ok: true },
    ])
    return
  }

  const order: Payee[] = first === 'yi' ? ['yi', 'bing'] : ['bing', 'yi']
  drawBook(
    ctx,
    P,
    24,
    52,
    632,
    364,
    '同一本',
    order.map((id, i) => ({ who: payeeName(id), ok: i === 0 })),
  )
}

function drawBook(
  ctx: CanvasRenderingContext2D,
  P: CanvasPalette,
  x: number,
  y: number,
  w: number,
  h: number,
  title: string,
  rows: { who: string; ok: boolean }[],
) {
  round(ctx, x, y, w, h, 14)
  ctx.fillStyle = P.bg2
  ctx.fill()
  ctx.lineWidth = 1
  ctx.strokeStyle = P.grid
  ctx.stroke()

  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = P.text
  ctx.font = '15px ui-sans-serif, system-ui, sans-serif'
  ctx.fillText(title, x + 20, y + 32)
  ctx.fillStyle = P.faint
  ctx.font = '12px ui-sans-serif, system-ui, sans-serif'
  ctx.fillText('这一枚，还没在这本里花过', x + 20, y + 58)

  const rowH = rows.length === 1 ? 168 : 108
  const rowGap = 16
  const blockH = rows.length * rowH + (rows.length - 1) * rowGap
  const rowTop = y + 78 + Math.max(0, (h - 96 - blockH) / 2)
  rows.forEach((row, i) => {
    const ry = rowTop + i * (rowH + rowGap)
    round(ctx, x + 16, ry, w - 32, rowH, 12)
    ctx.fillStyle = row.ok ? P.soft : P.bg
    ctx.fill()
    ctx.lineWidth = row.ok ? 2 : 1
    ctx.strokeStyle = row.ok ? P.good : P.danger
    ctx.stroke()
    ctx.fillStyle = P.faint
    ctx.font = '12px ui-sans-serif, system-ui, sans-serif'
    ctx.textAlign = 'left'
    ctx.fillText(i === 0 && rows.length > 1 ? '先写' : rows.length > 1 ? '后写' : '这本只看见这一笔', x + 32, ry + rowH * 0.32)
    ctx.fillStyle = P.text
    ctx.font = '18px ui-sans-serif, system-ui, sans-serif'
    ctx.fillText(`付给${row.who}`, x + 32, ry + rowH * 0.62)
    ctx.fillStyle = row.ok ? P.good : P.danger
    ctx.font = '14px ui-monospace, monospace'
    ctx.textAlign = 'right'
    ctx.fillText(row.ok ? '收下 1' : '退回', x + w - 32, ry + rowH * 0.62)
  })
}

function drawPages(ctx: CanvasRenderingContext2D, P: CanvasPalette, back: number) {
  const n = clampBack(back)
  ctx.font = '12px ui-sans-serif, system-ui, sans-serif'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = P.muted
  ctx.fillText('旧在左，新在右。蓝框是要重写的页。', 24, 28)
  ctx.textAlign = 'right'
  ctx.fillStyle = P.accent
  ctx.fillText(`重写 ${n} 页`, W - 24, 28)

  const cellW = 92
  const gap = 16
  const cellH = 168
  const rowW = 6 * cellW + 5 * gap
  const x0 = (W - rowW) / 2
  const y = 120
  for (let i = 0; i < 6; i++) {
    const fromTip = 5 - i
    const rewrite = fromTip < n
    const x = x0 + i * (cellW + gap)
    if (i > 0) {
      ctx.strokeStyle = rewrite ? P.accent : P.ghost
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.moveTo(x - gap + 3, y + cellH / 2)
      ctx.lineTo(x - 6, y + cellH / 2)
      ctx.stroke()
    }
    round(ctx, x, y, cellW, cellH, 12)
    ctx.fillStyle = rewrite ? P.soft : P.bg2
    ctx.fill()
    ctx.lineWidth = rewrite ? 2 : 1
    ctx.strokeStyle = rewrite ? P.accent : P.grid
    ctx.stroke()
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = P.faint
    ctx.font = '12px ui-sans-serif, system-ui, sans-serif'
    ctx.fillText(`倒数第 ${6 - i}`, x + 10, y + 28)
    ctx.fillStyle = rewrite ? P.accent : P.text
    ctx.font = '13px ui-monospace, monospace'
    ctx.fillText(rewrite ? `新 ${i + 1}` : `旧 ${i + 1}`, x + 10, y + 64)
    ctx.fillStyle = P.faint
    ctx.font = '11px ui-sans-serif, system-ui, sans-serif'
    ctx.fillText('上一页', x + 10, y + 104)
    const prev = i === 0 ? '没有' : rewrite || fromTip + 1 < n ? `新 ${i}` : `旧 ${i}`
    ctx.fillStyle = i > 0 && rewrite ? P.accent : P.muted
    ctx.font = '13px ui-monospace, monospace'
    ctx.fillText(prev, x + 10, y + 128)
  }

  ctx.textAlign = 'left'
  ctx.fillStyle = P.muted
  ctx.font = '12px ui-sans-serif, system-ui, sans-serif'
  ctx.fillText(`别人大约每 ${PAGE_MINUTES} 分钟加一页。你要在这段时间里写完这 ${n} 页，旧的才换得掉。`, 24, 340)
  ctx.fillText('等到 6 页是收款的习惯。账本没有这条规定。', 24, 366)
}

function drawRules(ctx: CanvasRenderingContext2D, P: CanvasPalette, height: number) {
  const pages = clampPages(height)
  const issued = issuedSats(pages)
  const subsidy = subsidySats(pages)
  const ratio = Number(issued) / Number(CAP)

  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = P.faint
  ctx.font = '12px ui-sans-serif, system-ui, sans-serif'
  ctx.fillText('已经写出来的', 24, 28)
  ctx.fillStyle = P.text
  ctx.font = '28px ui-monospace, monospace'
  ctx.fillText(formatBtc(issued), 24, 64)
  ctx.fillStyle = P.accent
  ctx.font = '14px ui-sans-serif, system-ui, sans-serif'
  ctx.fillText(`这一页新写 ${formatBtc(subsidy)}`, 24, 100)

  const barX = 24
  const barY = 128
  const barW = W - 48
  round(ctx, barX, barY, barW, 14, 7)
  ctx.fillStyle = P.bg2
  ctx.fill()
  round(ctx, barX, barY, Math.max(8, barW * ratio), 14, 7)
  ctx.fillStyle = P.accent
  ctx.fill()
  ctx.fillStyle = P.faint
  ctx.font = '12px ui-sans-serif, system-ui, sans-serif'
  ctx.fillText('0', barX, 162)
  ctx.textAlign = 'right'
  ctx.fillText('21,000,000', barX + barW, 162)

  const cards: { title: string; lines: string[]; hot: boolean }[] = [
    { title: '比特币', lines: ['谁都能抢下一页', `这一页新写 ${formatBtc(subsidy)}`, '页上只记转账'], hot: true },
    { title: '押金本', lines: ['先押一笔才写得了', '没有 2100 万这条线', '页上可以夹程序'], hot: false },
    { title: '欠条', lines: ['账上写着 1 枚', '美元是公司答应的', '账本变不出美元'], hot: false },
  ]
  const cardW = 204
  const gap = 16
  const y = 196
  cards.forEach((card, i) => {
    const x = 24 + i * (cardW + gap)
    round(ctx, x, y, cardW, 220, 12)
    ctx.fillStyle = card.hot ? P.soft : P.bg2
    ctx.fill()
    ctx.lineWidth = card.hot ? 2 : 1
    ctx.strokeStyle = card.hot ? P.accent : P.grid
    ctx.stroke()
    ctx.textAlign = 'left'
    ctx.fillStyle = card.hot ? P.accent : P.text
    ctx.font = '16px ui-sans-serif, system-ui, sans-serif'
    ctx.fillText(card.title, x + 16, y + 32)
    card.lines.forEach((line, lineIndex) => {
      ctx.fillStyle = P.muted
      ctx.font = '13px ui-sans-serif, system-ui, sans-serif'
      ctx.fillText(line, x + 16, y + 78 + lineIndex * 36)
    })
  })
}

function round(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.roundRect(x, y, Math.max(0, w), h, r)
}

export const CoinLedgerWidget: WidgetDefinition<CoinLedgerProps> = {
  type: 'coin-ledger',
  label: '货币账本',
  description: '同一枚能不能花两次，改旧页要重写几页，以及新币按页写出来、写到哪条线停。',
  icon: '🪙',
  defaultProps: { mode: 'copies', shared: false, first: 'yi', back: 1, height: 840000 },
  configSchema: [
    {
      key: 'mode',
      label: '模式',
      type: 'select',
      options: MODES.map((m) => ({ value: m.id, label: m.label })),
    },
    { key: 'shared', label: '同一本账', type: 'checkbox' },
    {
      key: 'first',
      label: '先写谁',
      type: 'select',
      options: [
        { value: 'yi', label: '乙' },
        { value: 'bing', label: '丙' },
      ],
    },
    { key: 'back', label: '改倒数第几页', type: 'range', min: 1, max: 6, step: 1 },
    { key: 'height', label: '已翻页数', type: 'range', min: 0, max: 1050000, step: 210000 },
  ],
  Component: CoinLedger,
}
