import { useEffect, useMemo, useState } from 'react'
import type { WidgetDefinition } from './registry'
import { palette } from '../lib/canvas'
import { useTheme } from '../lib/theme'

interface TokenBudgetProps {
  window: number // context window in tokens
  priceIn: number // USD per 1M input tokens
  priceOut: number // USD per 1M output tokens
}

type Lang = 'en' | 'zh' | 'code' | 'mixed'

const LANG_RATIO: Record<Lang, { label: string; charsPerToken: number; hint: string }> = {
  en: { label: '英文', charsPerToken: 4, hint: '约 4 字符/token' },
  zh: { label: '中文', charsPerToken: 1.5, hint: '约 1.5 字符/token' },
  code: { label: '代码', charsPerToken: 3.5, hint: '约 3.5 字符/token' },
  mixed: { label: '中英混合', charsPerToken: 2.5, hint: '约 2.5 字符/token' },
}

const WINDOWS = [
  { value: 8192, label: '8K' },
  { value: 32768, label: '32K' },
  { value: 128000, label: '128K' },
  { value: 200000, label: '200K' },
  { value: 1000000, label: '1M' },
]

// A few illustrative price points (USD per 1M tokens). Prices change often;
// the reader can still override input/output price directly.
const PRICE_PRESETS: { label: string; in: number; out: number }[] = [
  { label: 'GPT-4o', in: 2.5, out: 10 },
  { label: 'GPT-4 Turbo', in: 10, out: 30 },
  { label: 'Claude 3.5 Sonnet', in: 3, out: 15 },
  { label: 'Gemini 1.5 Pro', in: 1.25, out: 5 },
  { label: '自定义', in: 3, out: 15 },
]

interface Seg {
  key: string
  label: string
  tokens: number
  color: string
}

function TokenBudget({ props }: { props: TokenBudgetProps }) {
  const P = palette()
  useTheme()

  const [win, setWin] = useState(Number(props.window))
  const [priceIn, setPriceIn] = useState(Number(props.priceIn))
  const [priceOut, setPriceOut] = useState(Number(props.priceOut))
  const [pricePreset, setPricePreset] = useState(4)
  useEffect(() => setWin(Number(props.window)), [props.window])
  useEffect(() => {
    setPriceIn(Number(props.priceIn))
    setPriceOut(Number(props.priceOut))
  }, [props.priceIn, props.priceOut])

  const [lang, setLang] = useState<Lang>('mixed')
  const [systemChars, setSystemChars] = useState(600)
  const [userChars, setUserChars] = useState(400)
  const [historyTurns, setHistoryTurns] = useState(6)
  const [turnChars, setTurnChars] = useState(500)
  const [ragChars, setRagChars] = useState(3000)
  const [outTokens, setOutTokens] = useState(1024)

  const ratio = LANG_RATIO[lang].charsPerToken
  const toTokens = (chars: number) => Math.max(0, Math.round(chars / ratio))

  const calc = useMemo(() => {
    const system = toTokens(systemChars)
    const user = toTokens(userChars)
    const history = toTokens(historyTurns * turnChars)
    const rag = toTokens(ragChars)
    const input = system + user + history + rag
    const output = outTokens
    const total = input + output
    const remaining = Math.max(0, win - total)
    const usedPct = Math.min(100, (total / win) * 100)
    const over = total > win
    const cost = (input / 1_000_000) * priceIn + (output / 1_000_000) * priceOut
    return { system, user, history, rag, input, output, total, remaining, usedPct, over, cost }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [systemChars, userChars, historyTurns, turnChars, ragChars, outTokens, ratio, win, priceIn, priceOut])

  const segs: Seg[] = [
    { key: 'sys', label: '系统提示词', tokens: calc.system, color: P.accent },
    { key: 'hist', label: '历史对话', tokens: calc.history, color: P.accent2 },
    { key: 'rag', label: '上下文/检索', tokens: calc.rag, color: P.pink },
    { key: 'user', label: '当前用户输入', tokens: calc.user, color: P.good },
    { key: 'out', label: '预留输出', tokens: calc.output, color: P.warn },
  ]

  return (
    <div className="lb-surface">
      {/* language + context window */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="t-panel inline-flex rounded-lg p-0.5">
          {(Object.keys(LANG_RATIO) as Lang[]).map((l) => (
            <button
              key={l}
              onClick={() => setLang(l)}
              className={`rounded-[6px] px-2.5 py-1 text-xs font-medium transition-colors ${
                lang === l ? 't-btn-primary' : 't-muted'
              }`}
            >
              {LANG_RATIO[l].label}
            </button>
          ))}
        </div>
        <span className="t-faint ml-1 font-mono text-[10px]">{LANG_RATIO[lang].hint}</span>

        <div className="t-panel ml-auto inline-flex rounded-lg p-0.5">
          {WINDOWS.map((w) => (
            <button
              key={w.value}
              onClick={() => setWin(w.value)}
              className={`rounded-[6px] px-2.5 py-1 text-xs font-medium transition-colors ${
                win === w.value ? 't-btn-primary' : 't-muted'
              }`}
            >
              {w.label}
            </button>
          ))}
        </div>
      </div>

      {/* inputs */}
      <div className="grid gap-x-4 gap-y-2.5 sm:grid-cols-2">
        <CharField label="系统提示词（字符）" value={systemChars} onChange={setSystemChars} max={10000} tokens={calc.system} P={P} />
        <CharFieldTurns label="历史对话轮数 × 每轮字符" turns={historyTurns} onTurns={setHistoryTurns} turnChars={turnChars} onTurnChars={setTurnChars} tokens={calc.history} P={P} />
        <CharField label="检索/RAG 上下文（字符）" value={ragChars} onChange={setRagChars} max={200000} tokens={calc.rag} P={P} />
        <CharField label="当前用户输入（字符）" value={userChars} onChange={setUserChars} max={10000} tokens={calc.user} P={P} />
      </div>

      <div className="mt-2.5">
        <label className="t-muted flex items-center gap-2 text-xs">
          <span className="w-36 shrink-0">预留输出长度</span>
          <input type="range" min={64} max={8192} step={64} value={outTokens} onChange={(e) => setOutTokens(Number(e.target.value))} className="flex-1" />
          <span className="t-strong w-20 text-right font-mono tabular-nums">{outTokens} tok</span>
        </label>
      </div>

      {/* stacked context bar */}
      <div className="mt-4">
        <div className="mb-1.5 flex items-baseline justify-between">
          <span className="t-faint font-mono text-[10px] uppercase tracking-wider">上下文窗口占用</span>
          <span className="t-faint font-mono text-[10px] tabular-nums">
            {calc.total.toLocaleString()} / {win.toLocaleString()}
          </span>
        </div>
        <div className="t-panel relative h-7 w-full overflow-hidden rounded-lg">
          <div className="flex h-full w-full">
            {segs.map((s) => {
              const pct = (s.tokens / win) * 100
              if (pct <= 0) return null
              return (
                <div
                  key={s.key}
                  title={`${s.label}：${s.tokens.toLocaleString()} tokens`}
                  className="h-full transition-[width] duration-150"
                  style={{ width: `${Math.min(pct, 100)}%`, background: s.color, opacity: 0.85 }}
                />
              )
            })}
          </div>
          {/* 80% warning line */}
          <div className="absolute top-0 bottom-0" style={{ left: '80%', borderLeft: `1px dashed ${P.faint}` }} />
        </div>
        {/* legend */}
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
          {segs.map((s) => (
            <span key={s.key} className="t-faint flex items-center gap-1 text-[10px]">
              <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />
              {s.label}
              <span className="font-mono tabular-nums" style={{ color: P.muted }}>
                {s.tokens.toLocaleString()}
              </span>
            </span>
          ))}
        </div>
      </div>

      {/* big stats */}
      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="输入 tokens" value={calc.input.toLocaleString()} P={P} />
        <Stat label="输出 tokens" value={calc.output.toLocaleString()} P={P} />
        <Stat label="合计 tokens" value={calc.total.toLocaleString()} P={P} highlight={!calc.over} danger={calc.over} />
        <Stat label="窗口占用" value={`${calc.usedPct.toFixed(1)}%`} P={P} danger={calc.over} warn={calc.usedPct > 80 && !calc.over} />
      </div>

      {calc.over ? (
        <p className="mt-2 rounded-lg px-3 py-2 text-xs font-medium" style={{ background: `color-mix(in srgb, ${P.danger} 12%, transparent)`, color: P.danger }}>
          ⚠ 超出上下文窗口 {calc.total - win > 0 ? (calc.total - win).toLocaleString() : ''} tokens —— 历史消息或检索内容会被截断，请求可能直接失败。
        </p>
      ) : calc.usedPct > 80 ? (
        <p className="t-muted mt-2 rounded-lg px-3 py-2 text-xs" style={{ background: `color-mix(in srgb, ${P.warn} 12%, transparent)` }}>
          已用超过 80%。建议压缩历史、减少检索片段，或预留更多输出空间。
        </p>
      ) : (
        <p className="t-faint mt-2 text-[11px] leading-relaxed">
          剩余 <span className="font-mono tabular-nums">{calc.remaining.toLocaleString()}</span> tokens 可用。虚线为 80% 警戒线——越接近上限，模型越容易「忘记」早期内容或提前截断。
        </p>
      )}

      {/* pricing */}
      <div className="mt-4 border-t pt-3" style={{ borderColor: 'var(--lb-border-soft)' }}>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className="t-faint font-mono text-[10px] uppercase tracking-wider">费用估算（每次请求）</span>
          <div className="t-panel ml-auto inline-flex rounded-lg p-0.5">
            {PRICE_PRESETS.map((pp, idx) => (
              <button
                key={pp.label}
                onClick={() => {
                  setPricePreset(idx)
                  setPriceIn(pp.in)
                  setPriceOut(pp.out)
                }}
                className={`rounded-[6px] px-2.5 py-1 text-[11px] font-medium transition-colors ${
                  pricePreset === idx ? 't-btn-primary' : 't-muted'
                }`}
              >
                {pp.label}
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <PriceStat label="输入费用" sub={`$${(calc.input / 1_000_000 * priceIn).toFixed(4)}`} P={P} />
          <PriceStat label="输出费用" sub={`$${(calc.output / 1_000_000 * priceOut).toFixed(4)}`} P={P} />
          <PriceStat label="合计" sub={`$${calc.cost.toFixed(4)}`} P={P} strong />
        </div>
        <div className="mt-2 flex items-center gap-3">
          <label className="t-faint flex items-center gap-1 text-[10px]">
            输入 $/1M
            <input
              type="number"
              step="0.1"
              value={priceIn}
              onChange={(e) => {
                setPriceIn(Number(e.target.value))
                setPricePreset(4)
              }}
              className="t-input w-16 rounded px-1.5 py-0.5 font-mono text-[11px]"
            />
          </label>
          <label className="t-faint flex items-center gap-1 text-[10px]">
            输出 $/1M
            <input
              type="number"
              step="0.1"
              value={priceOut}
              onChange={(e) => {
                setPriceOut(Number(e.target.value))
                setPricePreset(4)
              }}
              className="t-input w-16 rounded px-1.5 py-0.5 font-mono text-[11px]"
            />
          </label>
          <span className="t-faint ml-auto text-[10px]">价格仅为示意，以官方最新定价为准</span>
        </div>
      </div>
    </div>
  )
}

function CharField({
  label,
  value,
  onChange,
  max,
  tokens,
  P,
}: {
  label: string
  value: number
  onChange: (v: number) => void
  max: number
  tokens: number
  P: ReturnType<typeof palette>
}) {
  return (
    <label className="block">
      <div className="mb-1 flex items-center justify-between">
        <span className="t-muted text-xs">{label}</span>
        <span className="font-mono text-[10px] tabular-nums" style={{ color: P.accent }}>
          ≈ {tokens.toLocaleString()} tok
        </span>
      </div>
      <div className="flex items-center gap-2">
        <input type="range" min={0} max={max} step={50} value={Math.min(value, max)} onChange={(e) => onChange(Number(e.target.value))} className="flex-1" />
        <input
          type="number"
          min={0}
          value={value}
          onChange={(e) => onChange(Math.max(0, Number(e.target.value)))}
          className="t-input w-20 rounded px-2 py-1 text-right font-mono text-xs tabular-nums"
        />
      </div>
    </label>
  )
}

function CharFieldTurns({
  label,
  turns,
  onTurns,
  turnChars,
  onTurnChars,
  tokens,
  P,
}: {
  label: string
  turns: number
  onTurns: (v: number) => void
  turnChars: number
  onTurnChars: (v: number) => void
  tokens: number
  P: ReturnType<typeof palette>
}) {
  return (
    <label className="block">
      <div className="mb-1 flex items-center justify-between">
        <span className="t-muted text-xs">{label}</span>
        <span className="font-mono text-[10px] tabular-nums" style={{ color: P.accent }}>
          ≈ {tokens.toLocaleString()} tok
        </span>
      </div>
      <div className="flex items-center gap-2">
        <input type="range" min={0} max={50} step={1} value={turns} onChange={(e) => onTurns(Number(e.target.value))} className="flex-1" />
        <input
          type="number"
          min={0}
          value={turns}
          onChange={(e) => onTurns(Math.max(0, Number(e.target.value)))}
          className="t-input w-12 rounded px-1.5 py-1 text-center font-mono text-xs tabular-nums"
        />
        <span className="t-faint font-mono text-[10px]">×</span>
        <input
          type="number"
          min={0}
          value={turnChars}
          onChange={(e) => onTurnChars(Math.max(0, Number(e.target.value)))}
          className="t-input w-16 rounded px-1.5 py-1 text-right font-mono text-xs tabular-nums"
        />
      </div>
    </label>
  )
}

function Stat({
  label,
  value,
  P,
  highlight,
  danger,
  warn,
}: {
  label: string
  value: string
  P: ReturnType<typeof palette>
  highlight?: boolean
  danger?: boolean
  warn?: boolean
}) {
  const color = danger ? P.danger : warn ? P.warn : highlight ? P.accent : P.text
  return (
    <div className="t-panel rounded-lg px-3 py-2">
      <div className="t-faint text-[10px] uppercase tracking-wider">{label}</div>
      <div className="mt-0.5 font-mono text-base font-semibold tabular-nums" style={{ color }}>
        {value}
      </div>
    </div>
  )
}

function PriceStat({ label, sub, P, strong }: { label: string; sub: string; P: ReturnType<typeof palette>; strong?: boolean }) {
  return (
    <div className="t-panel rounded-lg px-3 py-2 text-center">
      <div className="t-faint text-[10px] uppercase tracking-wider">{label}</div>
      <div
        className="mt-0.5 font-mono tabular-nums"
        style={{ color: strong ? P.accent : P.text, fontSize: strong ? 17 : 14, fontWeight: strong ? 650 : 500 }}
      >
        {sub}
      </div>
    </div>
  )
}

export const TokenBudgetWidget: WidgetDefinition<TokenBudgetProps> = {
  type: 'token-budget',
  label: 'Token 预算估算',
  description: '按系统提示词、历史对话、检索上下文与输出长度，实时估算 token 占用与费用。',
  icon: '🧮',
  defaultProps: {
    window: 128000,
    priceIn: 3,
    priceOut: 15,
  },
  configSchema: [
    {
      key: 'window',
      label: '上下文窗口（tokens）',
      type: 'select',
      options: WINDOWS.map((w) => ({ value: String(w.value), label: w.label })),
    },
    { key: 'priceIn', label: '输入价格（$/1M）', type: 'number', min: 0, step: 0.1, unit: '$' },
    { key: 'priceOut', label: '输出价格（$/1M）', type: 'number', min: 0, step: 0.1, unit: '$' },
  ],
  Component: TokenBudget,
}
