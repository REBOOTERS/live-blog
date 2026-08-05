import { useMemo, useState } from 'react'
import type { WidgetDefinition } from './registry'

interface TransformerProps {
  sentenceId: number
  usePosition: boolean
}

// ---- Hand-crafted semantic feature space (8 dims) -------------------
// 0: entity  1: action  2: state  3: animate  4: function  5: determiner  6: tense  7: food
type Vec = number[]
const LEX: Record<string, Vec> = {
  猫: [0.9, 0.1, 0.1, 0.9, 0, 0, 0, 0],
  狗: [0.9, 0.1, 0.1, 0.9, 0, 0, 0, 0],
  老鼠: [0.85, 0.1, 0.1, 0.9, 0, 0, 0, 0.5],
  主人: [0.9, 0.1, 0.1, 0.9, 0, 0, 0, 0],
  小孩: [0.9, 0.1, 0.1, 0.9, 0, 0, 0, 0],
  苹果: [0.9, 0, 0.1, 0, 0, 0, 0, 0.85],
  尾巴: [0.7, 0, 0, 0.5, 0, 0.4, 0, 0],
  追: [0.1, 0.95, 0.1, 0, 0, 0, 0, 0],
  看: [0.1, 0.9, 0.1, 0, 0, 0, 0, 0],
  见: [0.1, 0.7, 0, 0, 0, 0, 0, 0],
  摇: [0.1, 0.9, 0.1, 0, 0, 0, 0, 0],
  吃: [0.1, 0.95, 0.1, 0, 0, 0, 0, 0.3],
  掉: [0.1, 0.55, 0.1, 0, 0.5, 0, 0.6, 0],
  饿: [0.1, 0.1, 0.95, 0.4, 0, 0, 0, 0.6],
  甜: [0.1, 0, 0.95, 0, 0, 0, 0, 0.7],
  因为: [0, 0, 0, 0, 0.95, 0, 0, 0],
  被: [0, 0, 0, 0, 0.9, 0, 0, 0],
  它: [0.6, 0, 0, 0.75, 0.2, 0, 0, 0],
  了: [0, 0, 0, 0, 0.8, 0, 0.6, 0],
  着: [0, 0, 0, 0, 0.8, 0, 0.6, 0],
  一: [0.1, 0, 0, 0, 0.4, 0.6, 0, 0],
  只: [0.1, 0, 0, 0, 0.4, 0.6, 0, 0],
  个: [0.1, 0, 0, 0, 0.4, 0.6, 0, 0],
  那: [0.1, 0, 0, 0, 0.5, 0.5, 0, 0],
  这: [0.1, 0, 0, 0, 0.5, 0.5, 0, 0],
}

function embedding(token: string, pos: number, usePos: boolean): Vec {
  let base = LEX[token]
  if (!base) {
    // deterministic fallback so any token still has a stable vector
    let h = 0
    for (let i = 0; i < token.length; i++) h = (h * 31 + token.charCodeAt(i)) % 997
    base = Array.from({ length: 8 }, (_, k) => ((h >> k) & 1) ? 0.6 : 0.1)
  }
  if (!usePos) return base.slice()
  // sinusoidal positional encoding (adds locality signal)
  const out = base.slice()
  for (let k = 0; k < 8; k++) {
    const angle = pos / Math.pow(80, k / 8)
    out[k] += k % 2 === 0 ? Math.sin(angle) * 0.25 : Math.cos(angle) * 0.25
  }
  return out
}

// Each head projects the embedding into a different subspace by masking
// feature dims — so heads specialise in different relations.
const HEADS: { id: number; name: string; desc: string; mask: number[] }[] = [
  { id: 0, name: '共指', desc: '关注实体/有生（代词↔名词）', mask: [1, 0, 0, 1, 0.1, 0, 0, 0.3] },
  { id: 1, name: '句法', desc: '关注动作与状态（名词↔动词）', mask: [0.4, 1, 0.7, 0, 0, 0, 0, 0.2] },
  { id: 2, name: '局部', desc: '只看相邻位置（局部依赖）', mask: [0, 0, 0, 0, 0, 0, 0, 0] },
]

function project(v: Vec, mask: number[]): Vec {
  return v.map((x, i) => x * mask[i])
}

function dot(a: Vec, b: Vec): number {
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i] * b[i]
  return s
}

function softmax(arr: number[]): number[] {
  const m = Math.max(...arr)
  const exps = arr.map((x) => Math.exp((x - m) * 6)) // ×6 temperature sharpening base
  const sum = exps.reduce((a, b) => a + b, 0)
  return exps.map((e) => e / sum)
}

const SENTENCES: { id: number; text: string; tokens: string[]; note: string }[] = [
  { id: 0, text: '猫 追 老鼠 因为 它 饿 了', tokens: ['猫', '追', '老鼠', '因为', '它', '饿', '了'], note: '它 指代谁？看「共指」头' },
  { id: 1, text: '狗 摇 尾巴 因为 它 见 主人', tokens: ['狗', '摇', '尾巴', '因为', '它', '见', '主人'], note: '它 指代狗，依赖实体相似度' },
  { id: 2, text: '苹果 被 小孩 吃 掉 因为 它 甜', tokens: ['苹果', '被', '小孩', '吃', '掉', '因为', '它', '甜'], note: '它 指代苹果还是小孩？' },
]

export function SelfAttention({ props }: { props: TransformerProps }) {
  const [sentenceId, setSentenceId] = useState(props.sentenceId)
  const [usePos, setUsePos] = useState(props.usePosition)
  const [head, setHead] = useState(0)
  const [query, setQuery] = useState(0)

  const sentence = SENTENCES[sentenceId] ?? SENTENCES[0]
  const tokens = sentence.tokens
  const activeHead = HEADS[head]

  // recompute attention for the selected query under current head/config
  const { weights, matrix } = useMemo(() => {
    const emb = tokens.map((tk, i) => embedding(tk, i, usePos))
    const isLocal = activeHead.id === 2
    const dk = 8
    const scoreOf = (qi: number, kj: number): number => {
      if (isLocal) {
        // pure positional proximity (Gaussian falloff)
        return -Math.pow(qi - kj, 2) / 4
      }
      const q = project(emb[qi], activeHead.mask)
      const k = project(emb[kj], activeHead.mask)
      return dot(q, k) / Math.sqrt(dk)
    }
    const matrix = tokens.map((_, qi) => softmax(tokens.map((_, kj) => scoreOf(qi, kj))))
    return { weights: matrix[query] ?? matrix[0], matrix }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sentenceId, head, usePos, query])

  const clampQuery = Math.min(query, tokens.length - 1)

  return (
    <div className="lb-surface">
      {/* sentence selector */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-white/10 bg-slate-950/60 p-0.5">
          {SENTENCES.map((s) => (
            <button
              key={s.id}
              onClick={() => {
                setSentenceId(s.id)
                setQuery(0)
              }}
              className={`rounded-[6px] px-2.5 py-1 text-xs font-medium transition ${
                sentenceId === s.id
                  ? 'bg-gradient-to-r from-indigo-500 to-cyan-400 text-slate-950'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              例{s.id + 1}
            </button>
          ))}
        </div>
        <span className="ml-auto font-mono text-[10px] text-slate-500">{sentence.note}</span>
      </div>

      {/* token row with attention arcs (SVG) */}
      <AttentionArcs
        tokens={tokens}
        weights={weights}
        query={clampQuery}
        onPick={(i) => setQuery(i)}
        headColor={['#22d3ee', '#a5b4fc', '#34d399'][head]}
      />

      {/* head selector */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="font-mono text-[10px] uppercase tracking-wider text-indigo-300/80">注意力头</span>
        <div className="inline-flex rounded-lg border border-white/10 bg-slate-950/60 p-0.5">
          {HEADS.map((h) => (
            <button
              key={h.id}
              onClick={() => setHead(h.id)}
              className={`rounded-[6px] px-2.5 py-1 text-xs font-medium transition ${
                head === h.id ? 'bg-white/15 text-cyan-200' : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              {h.name}
            </button>
          ))}
        </div>
        <label className="ml-auto flex cursor-pointer items-center gap-2 text-xs text-slate-400">
          <input
            type="checkbox"
            checked={usePos}
            onChange={(e) => setUsePos(e.target.checked)}
            className="h-3.5 w-3.5 rounded accent-indigo-500"
          />
          位置编码
        </label>
      </div>
      <p className="mt-1.5 text-xs text-slate-500">{activeHead.desc}</p>

      {/* full attention matrix heatmap */}
      <div className="mt-3">
        <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-indigo-300/80">
          注意力矩阵（行=查询，列=被关注，{head === 2 ? '深=高' : '亮=高'}）
        </div>
        <AttentionMatrix matrix={matrix} query={clampQuery} tokens={tokens} />
      </div>

      <p className="mt-2 text-xs text-slate-400">
        点击上方任一词作为查询（高亮），弧线粗细 = softmax(Q·K/√d) 注意力权重。
        切换不同「头」看模型如何同时学习多种依赖关系——这正是 Transformer 的核心。
      </p>
    </div>
  )
}

function AttentionArcs({
  tokens,
  weights,
  query,
  onPick,
  headColor,
}: {
  tokens: string[]
  weights: number[]
  query: number
  onPick: (i: number) => void
  headColor: string
}) {
  const W = 540
  const baseY = 96
  const pad = 28
  const slot = (W - pad * 2) / (tokens.length - 1 || 1)
  const xOf = (i: number) => pad + i * slot
  const maxW = Math.max(...weights, 0.0001)

  return (
    <svg viewBox={`0 0 ${W} 120`} className="w-full" style={{ background: '#0a0f1e', borderRadius: 8 }}>
      {/* arcs from query to every token */}
      {weights.map((w, j) => {
        if (j === query) return null
        const x1 = xOf(query)
        const x2 = xOf(j)
        const lift = 24 + Math.abs(x2 - x1) * 0.28
        const mid = (x1 + x2) / 2
        const norm = w / maxW
        return (
          <path
            key={j}
            d={`M ${x1} ${baseY} Q ${mid} ${baseY - lift} ${x2} ${baseY}`}
            fill="none"
            stroke={headColor}
            strokeWidth={0.5 + norm * 6}
            strokeOpacity={0.2 + norm * 0.8}
            strokeLinecap="round"
          />
        )
      })}
      {/* tokens */}
      {tokens.map((tk, i) => {
        const isQ = i === query
        return (
          <g key={i} onClick={() => onPick(i)} style={{ cursor: 'pointer' }}>
            <rect
              x={xOf(i) - 22}
              y={baseY - 2}
              width={44}
              height={26}
              rx={6}
              fill={isQ ? headColor : '#111a2e'}
              stroke={isQ ? headColor : 'rgba(129,140,248,0.4)'}
              strokeWidth={isQ ? 0 : 1}
            />
            <text
              x={xOf(i)}
              y={baseY + 15}
              textAnchor="middle"
              fontSize={13}
              fontWeight={isQ ? 700 : 500}
              fill={isQ ? '#0a0f1e' : '#cbd5e1'}
            >
              {tk}
            </text>
            <text
              x={xOf(i)}
              y={baseY + 38}
              textAnchor="middle"
              fontSize={9}
              fontFamily="ui-monospace, monospace"
              fill={isQ ? headColor : '#475569'}
            >
              {(weights[i] * 100).toFixed(0)}%
            </text>
          </g>
        )
      })}
    </svg>
  )
}

function AttentionMatrix({
  matrix,
  query,
  tokens,
}: {
  matrix: number[][]
  query: number
  tokens: string[]
}) {
  const cell = 26
  const label = 34
  const W = label + tokens.length * cell
  const H = label + tokens.length * cell
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: 280 }}>
      {matrix.map((row, i) =>
        row.map((v, j) => {
          const t = Math.min(1, v / 0.6)
          const fill =
            i === query
              ? `rgba(34,211,238,${0.12 + t * 0.85})`
              : `rgba(129,140,248,${0.06 + t * 0.5})`
          return (
            <g key={`${i}-${j}`}>
              <rect
                x={label + j * cell}
                y={label + i * cell}
                width={cell - 2}
                height={cell - 2}
                rx={3}
                fill={fill}
              />
              <text
                x={label + j * cell + (cell - 2) / 2}
                y={label + i * cell + (cell - 2) / 2 + 3}
                textAnchor="middle"
                fontSize={8}
                fontFamily="ui-monospace, monospace"
                fill={t > 0.4 ? '#0a0f1e' : '#64748b'}
              >
                {(v * 100).toFixed(0)}
              </text>
            </g>
          )
        }),
      )}
      {/* column headers */}
      {tokens.map((tk, j) => (
        <text
          key={`c${j}`}
          x={label + j * cell + (cell - 2) / 2}
          y={label - 6}
          textAnchor="middle"
          fontSize={10}
          fill="#64748b"
        >
          {tk}
        </text>
      ))}
      {/* row headers */}
      {tokens.map((tk, i) => (
        <text
          key={`r${i}`}
          x={label - 6}
          y={label + i * cell + (cell - 2) / 2 + 3}
          textAnchor="end"
          fontSize={10}
          fill={i === query ? '#22d3ee' : '#64748b'}
          fontWeight={i === query ? 700 : 400}
        >
          {tk}
        </text>
      ))}
    </svg>
  )
}

export const TransformerWidget: WidgetDefinition<TransformerProps> = {
  type: 'transformer',
  label: 'Transformer 自注意力',
  description: '点击句子中的词，看它如何用 Q·K 注意力关注其他词；切换多头与位置编码。',
  icon: '🧩',
  defaultProps: {
    sentenceId: 0,
    usePosition: true,
  },
  configSchema: [
    { key: 'sentenceId', label: '例句', type: 'range', min: 0, max: 2, step: 1 },
    { key: 'usePosition', label: '位置编码', type: 'checkbox' },
  ],
  Component: SelfAttention,
}
