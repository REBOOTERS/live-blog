import { useMemo, useState } from 'react'
import type { WidgetDefinition } from './registry'
import { palette } from '../lib/canvas'
import { useTheme } from '../lib/theme'

// 检测不「读」文本：持钥者用生成时的密钥重新着色，然后只数绿色占比。
// 中文没有空格，词序列预先切好（57 词，含错别字「渡假」，供编辑深度演示修正）。
const WORDS = [
  '这座', '渔港', '小城', '的', '变化', '起先', '很慢，', '后来', '又', '快得', '出奇。',
  '许多', '年里，', '渔船', '天不亮', '就', '出海，', '晌午前', '满载', '回港，', '全城',
  '的', '作息', '都', '跟着', '渔汛', '走。', '轮渡', '航线', '一通，', '节奏', '全变了：',
  '新面孔', '多起来，', '钱', '也', '多起来，', '靠', '力气', '吃饭', '的', '码头', '渐渐',
  '成了', '游客', '渡假', '的', '步道，', '几乎', '没人', '说得清', '它', '是', '从', '哪一年',
  '开始', '变的。',
]

const KEY_A = 'echo-8' // 生成这段文字时用的密钥
const KEY_B = 'bravo-3' // 错误的密钥
const KEY_TABS = [
  { key: KEY_A, label: '密钥 A · 生成时用的' },
  { key: KEY_B, label: '密钥 B · 错误的' },
]

// 生成时的绿名单（42/57）：等价于「生成这段话时骰子被推向绿色」的离线结果。
const GREEN_A: Set<number> = (() => {
  let s = 7
  const rng = () => {
    s |= 0
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const idx = WORDS.map((_, i) => i)
  for (let i = idx.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[idx[i], idx[j]] = [idx[j], idx[i]]
  }
  return new Set(idx.slice(0, 42))
})()

function hash01(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return ((h >>> 0) % 100000) / 100000
}

// 错误密钥的着色与前一个词挂钩，和真实方案的哈希上下文一致
function isGreen(key: string, i: number): boolean {
  if (key === KEY_A) return GREEN_A.has(i)
  const prev = i === 0 ? '<s>' : WORDS[i - 1]
  return hash01(`${key}|${prev}|${WORDS[i]}`) < 0.5
}

// 二项分布尾概率 P(X ≥ k)，n 次抛硬币得到 ≥k 次正面的概率
function binomTail(n: number, k: number): number {
  if (k <= 0) return 1
  let mass = 0
  let term = Math.pow(0.5, n)
  for (let i = 0; i < k && i <= n; i++) {
    mass += term
    term *= (n - i) / (i + 1)
  }
  return Math.max(0, 1 - mass)
}

// 1% 误报率下的「标记线」：纯抛硬币涨过这条线的概率只有 1%
function thresholdK(n: number): number {
  let mass = 0
  let term = Math.pow(0.5, n)
  for (let i = 0; i <= n; i++) {
    mass += term
    if (1 - mass <= 0.01) return i + 1
    term *= (n - i) / (i + 1)
  }
  return n
}

function fmtPct(p: number): string {
  const v = p * 100
  if (v >= 1) return `${v.toFixed(1)}%`
  if (v >= 0.01) return `${v.toFixed(2)}%`
  return '< 0.01%'
}

function Count() {
  const P = palette()
  useTheme()
  const [keyIdx, setKeyIdx] = useState(0)
  const tab = KEY_TABS[keyIdx]
  const n = WORDS.length

  const greens = useMemo(() => WORDS.map((_, i) => isGreen(tab.key, i)), [tab])
  const greenCount = greens.filter(Boolean).length
  const share = greenCount / n
  const threshold = useMemo(() => thresholdK(n), [n])
  const tailP = binomTail(n, greenCount)
  const marked = greenCount >= threshold
  const rightKey = keyIdx === 0

  return (
    <div className="lb-surface">
      {/* key tabs */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="t-panel inline-flex rounded-lg p-0.5">
          {KEY_TABS.map((t, i) => (
            <button
              key={t.key}
              onClick={() => setKeyIdx(i)}
              className={`rounded-[6px] px-3 py-1 text-xs font-medium transition-colors ${
                keyIdx === i ? 't-btn-primary' : 't-muted'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <span className="t-faint ml-auto hidden font-mono text-xs sm:block">{n} 个词</span>
      </div>

      {/* the paragraph, re-colored under the chosen key */}
      <div className="t-panel rounded-xl px-4 py-3 text-[15px] leading-loose">
        {WORDS.map((w, i) =>
          greens[i] ? (
            <span
              key={i}
              title="绿名单 —— 密钥持有者算得出的颜色"
              className="mr-[1px] inline-block rounded-[4px] px-[2px] pb-[1px]"
              style={{
                color: P.good,
                background: `color-mix(in srgb, ${P.good} 10%, transparent)`,
                borderBottom: `2px solid ${P.good}`,
              }}
            >
              {w}
            </span>
          ) : (
            <span
              key={i}
              title="红名单 —— 只是被轻轻降了权"
              className="t-muted mr-[1px] inline-block rounded-[4px] px-[2px] pb-[1px]"
              style={{ borderBottom: `2px dashed color-mix(in srgb, ${P.danger} 45%, transparent)` }}
            >
              {w}
            </span>
          ),
        )}
      </div>

      {/* count + gauge */}
      <div className="mt-3 flex flex-wrap items-stretch gap-2.5">
        <div className="t-panel flex items-center gap-3 rounded-lg px-3.5 py-2">
          <div>
            <div className="t-faint text-[10px] uppercase tracking-wider">绿色</div>
            <div className="font-mono text-xl font-semibold tabular-nums" style={{ color: marked ? P.good : P.muted }}>
              {greenCount} / {n}
            </div>
          </div>
          <div>
            <div className="t-faint text-[10px] uppercase tracking-wider">占比</div>
            <div className="font-mono text-xl font-semibold tabular-nums" style={{ color: marked ? P.good : P.muted }}>
              {(share * 100).toFixed(0)}%
            </div>
          </div>
        </div>
        <div className="t-panel min-w-[240px] flex-1 rounded-lg px-3.5 py-2">
          <div className="t-faint text-[10px] uppercase tracking-wider">绿色占比 vs 两条参考线</div>
          <div className="relative mt-2.5">
            <div className="h-2.5 rounded-full" style={{ background: P.bg2 }} />
            <div
              className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-200"
              style={{ width: `${share * 100}%`, background: marked ? P.good : P.muted }}
            />
            <div className="absolute -top-1 bottom-[-4px] w-0.5" style={{ left: '50%', background: P.faint }} />
            <div
              className="absolute -top-1 bottom-[-4px] w-0.5"
              style={{ left: `${(threshold / n) * 100}%`, background: P.danger }}
            />
          </div>
          <div className="relative mt-1 h-4 font-mono text-[10px]">
            <span className="t-faint absolute -translate-x-1/2" style={{ left: '50%' }}>
              抛硬币 50%
            </span>
            <span
              className="absolute -translate-x-1/2 whitespace-nowrap"
              style={{ left: `${(threshold / n) * 100}%`, color: P.danger }}
            >
              标记线 {Math.round((threshold / n) * 100)}%
            </span>
          </div>
        </div>
      </div>

      {/* verdict */}
      <div
        className="mt-2.5 rounded-lg px-3.5 py-2.5 text-sm leading-relaxed"
        style={{
          background: `color-mix(in srgb, ${marked ? P.good : P.muted} 9%, transparent)`,
          color: marked ? P.good : P.muted,
        }}
      >
        {rightKey
          ? `正确密钥：${greenCount}/${n} 落在标记线之上。若无标记，纯抛硬币涨到这里的概率 ≈ ${fmtPct(tailP)}——判为带标记。`
          : `错误密钥：${greenCount}/${n}，远在标记线之下。随机就能涨到这里（概率 ≈ ${fmtPct(tailP)}）——分割毫无信息。`}
      </div>

      <p className="t-faint mt-2.5 text-[11px] leading-relaxed">
        实心下划线 = 绿名单，虚线 = 红名单；着色只存在于密钥持有者的哈希里，文字本身一个字符都没变。演示的倾斜画得较强；
        生产水印温和得多——同样强度下，一篇 1,500 词的文档只要约 55% 绿色就足以定案。小的倾斜只有靠长度才变得有说服力，
        这就是短文本难判的原因。
      </p>
    </div>
  )
}

export const WatermarkCountWidget: WidgetDefinition<Record<string, never>> = {
  type: 'watermark-count',
  label: '水印计数器',
  description: '用正确/错误的密钥为同一段落重新着色并计数绿色——统计检验一眼见分晓。',
  icon: '🔍',
  defaultProps: {},
  configSchema: [],
  exportable: true,
  Component: Count,
}
