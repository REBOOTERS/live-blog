import { useEffect, useMemo, useRef, useState } from 'react'
import type { WidgetDefinition } from './registry'
import { palette } from '../lib/canvas'
import { useTheme } from '../lib/theme'

interface WatermarkDiceProps {
  keyed: boolean
  boost: number // 绿名单轻推强度 δ，0 = 不推动
}

// 一个真实的低熵分叉：句子只差最后一个词，四个候选都通顺。
const CANDIDATES = [
  { word: '重要', p: 0.4 },
  { word: '关键', p: 0.3 },
  { word: '突出', p: 0.2 },
  { word: '难得', p: 0.1 },
]

// 着色由「密钥 + 前缀」决定：换前缀，同一批候选颜色整体重排。
const PREFIXES = [
  { label: '…结果非常', lead: '这项研究的结果非常' },
  { label: '…结果相当', lead: '这项研究的结果相当' },
  { label: '…数据十分', lead: '这次的实验数据十分' },
  { label: '…发现很是', lead: '整项发现很是' },
  { label: '…显得格外', lead: '同类工作里它显得格外' },
  { label: '…进展特别', lead: '过去一年里的进展特别' },
]

const KEY_POOL = ['echo-8', 'cypress-9', 'delta-4', 'gale-6', 'mux-3']

// FNV-1a → [0,1)。同一密钥永远复现同一套绿/红，这就是「只有持钥者能重放着色」。
function hash01(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return ((h >>> 0) % 100000) / 100000
}

const BAR_SCALE = 0.9 // 条宽满刻度对应的概率
const MAX_DOTS = 22 // 每列最多显示的落点（更早的折叠进计数）

interface Roll {
  n: number // 全局序号，作 key 让滑动窗口不重播动画
  word: number
  green: boolean
}

function Dice({ props }: { props: WatermarkDiceProps }) {
  const P = palette()
  useTheme() // re-render so palette() re-reads on theme switch
  const [keyOn, setKeyOn] = useState(props.keyed)
  const [boost, setBoost] = useState(props.boost)
  useEffect(() => setKeyOn(props.keyed), [props.keyed])
  useEffect(() => setBoost(props.boost), [props.boost])

  const [keyIdx, setKeyIdx] = useState(0)
  const [prefixIdx, setPrefixIdx] = useState(0)
  const key = KEY_POOL[keyIdx]
  const prefix = PREFIXES[prefixIdx]

  const colors = useMemo(
    () => CANDIDATES.map((c) => (keyOn ? hash01(`${key}|${prefix.label}|${c.word}`) < 0.5 : null)),
    [keyOn, key, prefix],
  )

  // KGW 式轻推的示意版：绿 ×(1+2δ)、红 ×(1−0.8δ)，再归一化。红词仍可能赢。
  const probs = useMemo(() => {
    const raw = CANDIDATES.map((c, i) =>
      colors[i] === null ? c.p : c.p * (colors[i] ? 1 + boost * 2 : 1 - boost * 0.8),
    )
    const tot = raw.reduce((s, v) => s + v, 0)
    return raw.map((v) => v / tot)
  }, [colors, boost])

  const [rolls, setRolls] = useState<Roll[]>([])
  const [burst, setBurst] = useState(0)
  const probsRef = useRef(probs)
  probsRef.current = probs
  const colorsRef = useRef(colors)
  colorsRef.current = colors

  const roll = () => {
    const pr = probsRef.current
    let r = Math.random()
    let pick = pr.length - 1
    for (let i = 0; i < pr.length; i++) {
      r -= pr[i]
      if (r <= 0) {
        pick = i
        break
      }
    }
    setRolls((rs) => [...rs, { n: rs.length, word: pick, green: colorsRef.current[pick] !== false }])
  }

  useEffect(() => {
    if (burst <= 0) return
    const t = setTimeout(() => {
      roll()
      setBurst((b) => b - 1)
    }, 90)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [burst])

  const last = rolls[rolls.length - 1]
  const columns = CANDIDATES.map((_, i) => rolls.filter((r) => r.word === i))
  const greens = rolls.filter((r) => r.green).length
  const lead = keyOn ? prefix.lead : PREFIXES[0].lead

  return (
    <div className="lb-surface">
      {/* key controls */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="t-panel inline-flex rounded-lg p-0.5">
          {[false, true].map((on) => (
            <button
              key={String(on)}
              onClick={() => setKeyOn(on)}
              className={`rounded-[6px] px-3 py-1 text-xs font-medium transition-colors ${
                keyOn === on ? 't-btn-primary' : 't-muted'
              }`}
            >
              {on ? '密钥 开' : '密钥 关'}
            </button>
          ))}
        </div>
        {keyOn && (
          <>
            <span
              className="rounded-full px-2.5 py-1 font-mono text-xs"
              style={{ border: '1px solid var(--lb-border)', color: P.accent }}
            >
              🔑 {key}
            </span>
            <button onClick={() => setKeyIdx((k) => (k + 1) % KEY_POOL.length)} className="t-btn rounded-md px-3 py-1.5 text-xs">
              换一把密钥
            </button>
          </>
        )}
        {keyOn && (
          <label className="t-muted ml-auto flex w-full items-center gap-2 text-xs sm:w-64">
            <span className="shrink-0">推动强度 δ</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={boost}
              onChange={(e) => setBoost(Number(e.target.value))}
              className="flex-1"
            />
            <span className="t-strong w-8 text-right font-mono tabular-nums">{boost.toFixed(2)}</span>
          </label>
        )}
      </div>

      {/* sentence being written */}
      <div className="t-panel rounded-xl px-4 py-3">
        <div className="t-faint mb-1 text-[10px] uppercase tracking-wider">正在写的句子</div>
        <div className="text-[15px] leading-relaxed">
          {lead}
          {last ? (
            <span
              className="mx-0.5 rounded-md px-1.5 py-0.5 font-medium"
              style={
                keyOn
                  ? {
                      color: last.green ? P.good : P.danger,
                      background: `color-mix(in srgb, ${last.green ? P.good : P.danger} 12%, transparent)`,
                      borderBottom: `2px ${last.green ? 'solid' : 'dashed'} ${last.green ? P.good : P.danger}`,
                    }
                  : { color: P.accent, background: `color-mix(in srgb, ${P.accent} 12%, transparent)` }
              }
            >
              {CANDIDATES[last.word].word}
            </span>
          ) : (
            <span
              className="mx-0.5 inline-block w-12 rounded-md border border-dashed px-1.5 py-0.5 text-center"
              style={{ borderColor: P.faint, color: P.faint }}
            >
              ？
            </span>
          )}
          。
        </div>
      </div>

      {/* candidates: nudged bar over dashed original */}
      <div className="mt-3 space-y-2">
        {CANDIDATES.map((c, i) => {
          const g = colors[i]
          const barColor = keyOn ? (g ? P.good : P.danger) : P.accent
          const cur = probs[i]
          const changed = keyOn && Math.abs(cur - c.p) > 0.002
          return (
            <div key={c.word} className="flex items-center gap-2.5">
              <span
                className="w-[64px] shrink-0 rounded-md px-1.5 py-0.5 text-center text-xs"
                style={
                  keyOn
                    ? {
                        color: g ? P.good : P.danger,
                        background: `color-mix(in srgb, ${g ? P.good : P.danger} 10%, transparent)`,
                      }
                    : { color: P.muted, background: P.bg2 }
                }
              >
                {c.word}
              </span>
              <div className="relative h-4 flex-1">
                {changed && (
                  <div
                    className="absolute inset-y-0 left-0 rounded-md border border-dashed"
                    style={{ width: `${(c.p / BAR_SCALE) * 100}%`, borderColor: P.faint }}
                  />
                )}
                <div
                  className="absolute inset-y-0 left-0 rounded-md transition-[width] duration-200"
                  style={{ width: `${(cur / BAR_SCALE) * 100}%`, background: `color-mix(in srgb, ${barColor} 65%, transparent)` }}
                />
              </div>
              <div className="w-[92px] shrink-0 text-right font-mono text-xs tabular-nums">
                <span style={{ color: barColor }}>{(cur * 100).toFixed(0)}%</span>
                {changed && <span className="t-faint"> / {(c.p * 100).toFixed(0)}%</span>}
              </div>
            </div>
          )
        })}
      </div>

      {/* dot plot */}
      <div className="mt-3 flex items-stretch gap-2">
        {CANDIDATES.map((c, i) => {
          const visible = columns[i].slice(-MAX_DOTS)
          return (
            <div key={c.word} className="t-panel flex min-h-[150px] flex-1 flex-col items-center rounded-lg px-1 pb-2 pt-1.5">
              <span className="t-muted font-mono text-[10px] tabular-nums">{columns[i].length}</span>
              <div className="flex flex-1 flex-col-reverse items-center gap-[3px] pt-1">
                {visible.map((r) => (
                  <span
                    key={r.n}
                    className="wm-dot block h-[7px] w-[7px] rounded-full"
                    style={{ background: keyOn ? (r.green ? P.good : P.danger) : P.accent }}
                  />
                ))}
              </div>
              <span className="t-faint mt-1 w-full truncate text-center text-[10px]">{c.word}</span>
            </div>
          )
        })}
      </div>

      {/* transport */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button onClick={roll} disabled={burst > 0} className="t-btn rounded-md px-3 py-1.5 text-sm disabled:opacity-30">
          🎲 掷一次
        </button>
        <button
          onClick={() => setBurst((b) => b + 20)}
          disabled={burst > 0}
          className="t-btn-primary rounded-md px-3.5 py-1.5 text-sm disabled:opacity-30"
        >
          {burst > 0 ? `掷骰中 ${burst}` : '连掷 20 次'}
        </button>
        <button
          onClick={() => {
            setRolls([])
            setBurst(0)
          }}
          className="t-btn rounded-md px-3 py-1.5 text-sm"
        >
          重置
        </button>
        <span className="t-muted ml-auto font-mono text-xs tabular-nums">
          已掷 {rolls.length} 次
          {keyOn && rolls.length > 0 && ` · 绿色 ${greens}（${Math.round((greens / rolls.length) * 100)}%）`}
        </span>
      </div>

      {/* prefix strip */}
      {keyOn && (
        <div className="mt-4">
          <div className="t-faint mb-1.5 text-[10px] uppercase tracking-wider">
            着色只认前缀 —— 点一条换上下文，同一批词颜色整体重排
          </div>
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
            {PREFIXES.map((pfx, pi) => {
              const active = pi === prefixIdx
              return (
                <button
                  key={pfx.label}
                  onClick={() => setPrefixIdx(pi)}
                  className="t-panel flex items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 transition-colors"
                  style={
                    active
                      ? { borderColor: P.accent, background: `color-mix(in srgb, ${P.accent} 8%, transparent)` }
                      : undefined
                  }
                >
                  <span className="t-muted font-mono text-[10px]">{pfx.label}</span>
                  <span className="flex shrink-0 gap-[3px]">
                    {CANDIDATES.map((c) => (
                      <span
                        key={c.word}
                        className="h-2 w-2 rounded-full"
                        style={{ background: hash01(`${key}|${pfx.label}|${c.word}`) < 0.5 ? P.good : P.danger }}
                      />
                    ))}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

export const WatermarkDiceWidget: WidgetDefinition<WatermarkDiceProps> = {
  type: 'watermark-dice',
  label: '水印骰子',
  description: '语言模型如何在候选词里掷骰子；打开密钥，看绿名单如何轻轻拨动概率。',
  icon: '🎲',
  defaultProps: { keyed: false, boost: 0.6 },
  configSchema: [
    { key: 'keyed', label: '启用密钥着色', type: 'checkbox' },
    { key: 'boost', label: '推动强度 δ', type: 'range', min: 0, max: 1, step: 0.05 },
  ],
  exportable: true,
  Component: Dice,
}
