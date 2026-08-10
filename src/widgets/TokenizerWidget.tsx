import { useEffect, useMemo, useState } from 'react'
import type { WidgetDefinition } from './registry'
import { palette } from '../lib/canvas'
import { useTheme } from '../lib/theme'

type TokenizerMode = 'o200k' | 'cl100k'

interface TokenizerProps {
  mode: TokenizerMode
}

type TokenKind = 'word' | 'stem' | 'suffix' | 'cjk' | 'cjk-rare' | 'number' | 'punct' | 'space' | 'newline'

interface Token {
  text: string
  kind: TokenKind
  count: number
}

// ---- 示意用 BPE 分词器 ---------------------------------------------------
// 真实分词器（o200k_base / cl100k_base）拥有十万级词表，这里用一套可解释的
// 启发式规则近似其行为：常见短词整体成 token、长词沿词缀/词干切分、数字按
// 3 位分组、CJK 按字切分。结果用于**直观理解**，与真实计数会有出入。

const COMMON_WORDS = new Set(
  (
    'the a an and or but if then of to in on at by for with from as is are was were be been being have has had do does did will would can could should may might must ' +
    'i you he she it we they me him her us them my your his its our their this that these those there here what when where who how why which ' +
    'not no yes so very just about up out over under into onto off again more most some any all each every both few many such only own same than too very s t ' +
    'one two three new old good bad big small first last long little right high different small large next early young important few public bad same able ' +
    'say said go going went get got make made know knew think thought see saw come came take took want gave use used find found tell told ask asked ' +
    'work worked call called try tried leave left feel felt put set keep kept let begin began show showed hear heard play ran run move moved live lived ' +
    'believe bring brought happen wrote read remember love like liked token model text prompt context message response system user assistant language ' +
    'word data code function return value type number string class method object array result true false null const let var import export default async await'
  ).split(/\s+/),
)

// 常见后缀，按长度降序匹配，命中后作为独立 token
const SUFFIXES = [
  'ization', 'isation', 'ationally', 'ational', 'tional', 'ation',
  'ness', 'ment', 'able', 'ible', 'ously', 'ively', 'ally', 'ional',
  'ing', 'tion', 'sion', 'ized', 'ised', 'izer', 'iser',
  'ly', 'er', 'est', 'ous', 'ive', 'ity', 'ize', 'ise',
  'al', 'es', 'ed', 's',
]

// 高频汉字：在旧版 cl100k 中这些字常为 1 个 token，其余多为 2 个；
// 新版 o200k 对中文大幅优化，几乎所有常用字都是 1 个 token。
const COMMON_CJK = new Set(
  (
    '的一是不了人在我有他这中大来上个国到说们为子和你地出也时得就自那以要会可没她还过能对而所去然作种里年想下面又都行后于事开样现长些方同如从两各本好当新正心法天日前天文通化对所'+
    '生学部其家成性如相让被第已无此与但者最知明象点间内因什少力工实合品式月金长将做见场'
  ).split(''),
)

function isCJK(ch: string): boolean {
  const c = ch.codePointAt(0) ?? 0
  return c >= 0x4e00 && c <= 0x9fff
}

function isLetter(ch: string): boolean {
  return /[A-Za-z']/.test(ch)
}

function splitStem(stem: string): { text: string; kind: TokenKind }[] {
  if (stem.length <= 4 || COMMON_WORDS.has(stem.toLowerCase())) {
    return [{ text: stem, kind: 'word' }]
  }
  const out: { text: string; kind: TokenKind }[] = []
  const n = stem.length
  let i = 0
  while (i < n) {
    let take = Math.min(4, n - i)
    if (n - i - take === 1) take = 3 // 避免留下单字母尾巴
    out.push({ text: stem.slice(i, i + take), kind: 'stem' })
    i += take
  }
  return out
}

function splitWord(word: string): { text: string; kind: TokenKind }[] {
  const lower = word.toLowerCase()
  if (word.length <= 4 || COMMON_WORDS.has(lower)) {
    return [{ text: word, kind: 'word' }]
  }
  for (const suf of SUFFIXES) {
    if (lower.length > suf.length && lower.endsWith(suf) && lower.length - suf.length >= 3) {
      const stem = word.slice(0, -suf.length)
      const pieces = splitStem(stem)
      pieces.push({ text: word.slice(-suf.length), kind: 'suffix' })
      return pieces
    }
  }
  return splitStem(word)
}

function tokenize(input: string, mode: TokenizerMode): Token[] {
  const tokens: Token[] = []
  const n = input.length
  let i = 0
  let pendingSpace = ''

  const flushSpace = () => {
    if (!pendingSpace) return
    tokens.push({ text: pendingSpace, kind: 'space', count: Math.max(1, Math.ceil(pendingSpace.length / 4)) })
    pendingSpace = ''
  }

  while (i < n) {
    const ch = input[i]

    if (ch === '\n') {
      flushSpace()
      tokens.push({ text: '↵', kind: 'newline', count: 1 })
      i++
      continue
    }
    if (ch === ' ' || ch === '\t') {
      let ws = ''
      while (i < n && (input[i] === ' ' || input[i] === '\t')) {
        ws += input[i]
        i++
      }
      pendingSpace += ws
      continue
    }
    if (isCJK(ch)) {
      flushSpace()
      const common = mode === 'o200k' || COMMON_CJK.has(ch)
      tokens.push({ text: ch, kind: common ? 'cjk' : 'cjk-rare', count: common ? 1 : 2 })
      i++
      continue
    }
    if (isLetter(ch)) {
      let word = ''
      while (i < n && isLetter(input[i])) {
        word += input[i]
        i++
      }
      const pieces = splitWord(word)
      if (pendingSpace) {
        pieces[0].text = pendingSpace + pieces[0].text
        pendingSpace = ''
      }
      for (const p of pieces) tokens.push({ text: p.text, kind: p.kind, count: 1 })
      continue
    }
    if (/[0-9]/.test(ch)) {
      let num = ''
      while (i < n && /[0-9]/.test(input[i])) {
        num += input[i]
        i++
      }
      const groups = num.match(/.{1,3}/g) ?? [num]
      if (pendingSpace) {
        groups[0] = pendingSpace + groups[0]
        pendingSpace = ''
      }
      for (const g of groups) tokens.push({ text: g, kind: 'number', count: 1 })
      continue
    }
    flushSpace()
    tokens.push({ text: ch, kind: 'punct', count: 1 })
    i++
  }
  flushSpace()
  return tokens
}

// ---- 示例文本 -------------------------------------------------------------

const SAMPLES: { key: string; label: string; text: string }[] = [
  {
    key: 'mixed',
    label: '混合',
    text:
      '大模型并不知道「字」是什么，它看到的只是一个个 token。\n' +
      'Tokenization splits long words into subwords: tokenization → token + ization.\n' +
      '在中文里，一个汉字通常是 1～2 个 token，而英文平均 4 个字符才折合 1 个 token。',
  },
  {
    key: 'zh',
    label: '中文',
    text:
      '分词是大模型处理文本的第一步。模型并不直接读取字符，而是把文本切分成一个个 token，' +
      '再把每个 token 映射为向量。新版分词器对中文更加友好，常用汉字大多只需一个 token，' +
      '这让同样长度的中文文本消耗的 token 数量明显下降。',
  },
  {
    key: 'en',
    label: 'English',
    text:
      'Tokenization is the first step of processing text. Models never read characters directly; ' +
      'they split text into tokens and map each token to a vector. Common short words stay whole, ' +
      'while longer, rarer words are broken into subword pieces like stems and suffixes.',
  },
  {
    key: 'code',
    label: '代码',
    text:
      'function estimateTokens(text, charsPerToken) {\n' +
      '  // 粗略估算：英文约 4 字符/token，中文约 1.5 字符/token\n' +
      '  return Math.ceil(text.length / charsPerToken);\n' +
      '}',
  },
]

// ---- 颜色 ----------------------------------------------------------------

function chipStyle(kind: TokenKind, P: ReturnType<typeof palette>) {
  switch (kind) {
    case 'word':
      return { fg: P.accent, bg: `color-mix(in srgb, ${P.accent} 12%, transparent)` }
    case 'stem':
      return { fg: P.accent2, bg: `color-mix(in srgb, ${P.accent2} 12%, transparent)` }
    case 'suffix':
      return { fg: P.pink, bg: `color-mix(in srgb, ${P.pink} 14%, transparent)` }
    case 'cjk':
      return { fg: P.good, bg: `color-mix(in srgb, ${P.good} 12%, transparent)` }
    case 'cjk-rare':
      return { fg: P.danger, bg: `color-mix(in srgb, ${P.danger} 14%, transparent)` }
    case 'number':
      return { fg: P.warn, bg: `color-mix(in srgb, ${P.warn} 14%, transparent)` }
    case 'newline':
      return { fg: P.faint, bg: `color-mix(in srgb, ${P.faint} 14%, transparent)` }
    case 'space':
      return { fg: 'transparent', bg: `color-mix(in srgb, ${P.muted} 10%, transparent)` }
    default:
      return { fg: P.muted, bg: `color-mix(in srgb, ${P.muted} 10%, transparent)` }
  }
}

function Tokenizer({ props }: { props: TokenizerProps }) {
  const P = palette()
  useTheme()
  const [mode, setMode] = useState<TokenizerMode>(props.mode)
  const [text, setText] = useState(SAMPLES[0].text)
  useEffect(() => setMode(props.mode), [props.mode])

  const tokens = useMemo(() => tokenize(text, mode), [text, mode])
  const stats = useMemo(() => {
    const tokenCount = tokens.reduce((s, t) => s + t.count, 0)
    const charCount = text.length
    const cjkChars = Array.from(text).filter(isCJK).length
    const letters = (text.match(/[A-Za-z]/g) ?? []).length
    const words = text.trim() ? text.trim().split(/\s+/).length : 0
    const ratio = tokenCount ? charCount / tokenCount : 0
    return { tokenCount, charCount, cjkChars, letters, words, ratio }
  }, [text, tokens])

  const legend: { kind: TokenKind; label: string }[] = [
    { kind: 'word', label: '整词' },
    { kind: 'stem', label: '词干' },
    { kind: 'suffix', label: '后缀' },
    { kind: 'cjk', label: '常用汉字 (1)' },
    { kind: 'cjk-rare', label: '生僻汉字 (2)' },
    { kind: 'number', label: '数字' },
    { kind: 'punct', label: '标点/空白' },
  ]

  return (
    <div className="lb-surface">
      {/* mode + samples */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="t-panel inline-flex rounded-lg p-0.5">
          {(['o200k', 'cl100k'] as TokenizerMode[]).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`rounded-[6px] px-3 py-1 text-xs font-medium transition-colors ${
                mode === m ? 't-btn-primary' : 't-muted'
              }`}
            >
              {m === 'o200k' ? 'o200k · GPT-4o' : 'cl100k · GPT-4/3.5'}
            </button>
          ))}
        </div>
        <div className="t-panel ml-auto inline-flex rounded-lg p-0.5">
          {SAMPLES.map((s) => (
            <button
              key={s.key}
              onClick={() => setText(s.text)}
              className="t-muted rounded-[6px] px-2.5 py-1 text-xs font-medium transition-colors hover:text-current"
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        spellCheck={false}
        className="t-input w-full rounded-lg p-3 font-mono text-xs leading-relaxed"
        style={{ minHeight: 110, resize: 'vertical' }}
      />

      {/* token chips */}
      <div
        className="t-panel mt-3 flex flex-wrap items-start rounded-lg p-2.5"
        style={{ minHeight: 64, lineHeight: 1.5 }}
      >
        {tokens.length === 0 && <span className="t-faint p-1 text-xs">输入文本后，这里会显示切分结果…</span>}
        {tokens.map((t, idx) => {
          const s = chipStyle(t.kind, P)
          const hasSpace = t.text.startsWith(' ') || t.text.startsWith('\t')
          return (
            <span
              key={idx}
              title={t.kind === 'cjk-rare' ? `${t.text.trim() || '空格'} · 2 个 token` : `${JSON.stringify(t.text)} · ${t.count} token`}
              className="relative mx-0.5 my-0.5 inline-flex items-center rounded-md font-mono text-[11px]"
              style={{
                color: s.fg,
                background: s.bg,
                border: `1px solid color-mix(in srgb, ${s.fg} 22%, transparent)`,
                padding: '1px 5px',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
              }}
            >
              {hasSpace && (
                <span
                  className="absolute left-0 top-0 bottom-0"
                  style={{ width: 3, background: s.fg, opacity: 0.5, borderRadius: '6px 0 0 6px' }}
                />
              )}
              {t.text || ' '}
              {t.count > 1 && (
                <span
                  className="ml-0.5 rounded-sm px-0.5 text-[9px] font-bold leading-tight"
                  style={{ background: s.fg, color: P.bg }}
                >
                  {t.count}
                </span>
              )}
            </span>
          )
        })}
      </div>

      {/* legend */}
      <div className="mt-2.5 flex flex-wrap gap-x-3 gap-y-1">
        {legend.map((l) => {
          const s = chipStyle(l.kind, P)
          return (
            <span key={l.kind} className="t-faint flex items-center gap-1 text-[10px]">
              <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: s.fg }} />
              {l.label}
            </span>
          )
        })}
      </div>

      {/* stats */}
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="字符数" value={stats.charCount} P={P} />
        <Stat label="Token 数" value={stats.tokenCount} P={P} highlight />
        <Stat label="词数（约）" value={stats.words} P={P} />
        <Stat label="字符 / Token" value={stats.ratio.toFixed(2)} P={P} />
      </div>
      <p className="t-faint mt-2 text-[11px] leading-relaxed">
        蓝色为整词、紫色为词干、粉色为后缀、绿色为汉字、红色表示该字在旧分词器下需 2 个 token。
        这是帮助理解的<strong className="t-muted">近似切分</strong>，真实计数以各模型官方分词器（如 tiktoken）为准。
      </p>
    </div>
  )
}

function Stat({ label, value, P, highlight }: { label: string; value: string | number; P: ReturnType<typeof palette>; highlight?: boolean }) {
  return (
    <div className="t-panel rounded-lg px-3 py-2">
      <div className="t-faint text-[10px] uppercase tracking-wider">{label}</div>
      <div
        className="mt-0.5 font-mono text-lg font-semibold tabular-nums"
        style={{ color: highlight ? P.accent : P.text }}
      >
        {value}
      </div>
    </div>
  )
}

export const TokenizerWidget: WidgetDefinition<TokenizerProps> = {
  type: 'tokenizer',
  label: '分词可视化',
  description: '输入文本，实时观察它如何被切成 token；对比中英文与新旧分词器的差异。',
  icon: '🔤',
  defaultProps: {
    mode: 'o200k',
  },
  configSchema: [
    {
      key: 'mode',
      label: '分词器',
      type: 'select',
      options: [
        { value: 'o200k', label: 'o200k_base（GPT-4o 等新版）' },
        { value: 'cl100k', label: 'cl100k_base（GPT-4/3.5）' },
      ],
    },
  ],
  Component: Tokenizer,
}
