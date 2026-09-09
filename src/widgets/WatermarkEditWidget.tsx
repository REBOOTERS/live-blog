import { useEffect, useState } from 'react'
import type { WidgetDefinition } from './registry'
import { palette } from '../lib/canvas'
import { useTheme } from '../lib/theme'

interface WatermarkEditProps {
  depth: number // 0..4 编辑深度
}

// 中文没有空格，五档文本全部预分词（与计数 Widget 的 57 词原文同源）。
// 五档编辑深度：从只修一个错别字（渡假→度假）到彻底重组，保留的连续措辞逐档减少。
const VERSIONS: { label: string; words: string[] }[] = [
  {
    label: '原文',
    words: [
      '这座', '渔港', '小城', '的', '变化', '起先', '很慢，', '后来', '又', '快得', '出奇。',
      '许多', '年里，', '渔船', '天不亮', '就', '出海，', '晌午前', '满载', '回港，', '全城',
      '的', '作息', '都', '跟着', '渔汛', '走。', '轮渡', '航线', '一通，', '节奏', '全变了：',
      '新面孔', '多起来，', '钱', '也', '多起来，', '靠', '力气', '吃饭', '的', '码头', '渐渐',
      '成了', '游客', '渡假', '的', '步道，', '几乎', '没人', '说得清', '它', '是', '从', '哪一年',
      '开始', '变的。',
    ],
  },
  {
    label: '修正错别字',
    words: [
      '这座', '渔港', '小城', '的', '变化', '起先', '很慢，', '后来', '又', '快得', '出奇。',
      '许多', '年里，', '渔船', '天不亮', '就', '出海，', '晌午前', '满载', '回港，', '全城',
      '的', '作息', '都', '跟着', '渔汛', '走。', '轮渡', '航线', '一通，', '节奏', '全变了：',
      '新面孔', '多起来，', '钱', '也', '多起来，', '靠', '力气', '吃饭', '的', '码头', '渐渐',
      '成了', '游客', '度假', '的', '步道，', '几乎', '没人', '说得清', '它', '是', '从', '哪一年',
      '开始', '变的。',
    ],
  },
  {
    label: '轻度润色',
    words: [
      '这座', '渔港', '小城', '的', '变化', '一开始', '很慢，', '后来', '又', '快得', '出奇。',
      '许多', '年里，', '渔船', '天不亮', '就', '出海，', '中午前', '满载', '回港，', '全城',
      '的', '作息', '都', '跟着', '渔汛', '走。', '轮渡', '航线', '一通，', '节奏', '全变了：',
      '生面孔', '多起来，', '钱', '也', '多起来，', '靠', '力气', '吃饭', '的', '码头', '慢慢',
      '成了', '游客', '度假', '的', '步道，', '差不多', '没人', '说得清', '它', '是', '从', '哪一年',
      '开始', '变的。',
    ],
  },
  {
    label: '中度改写',
    words: [
      '这座', '渔港', '小城', '的', '变化', '起先', '很慢，', '后来', '又', '快得', '出奇。',
      '很长', '一段', '日子', '里，', '渔船', '摸黑', '出海、', '中午', '回港，', '小城',
      '的', '作息', '全看', '潮水', '和', '渔汛。', '轮渡', '通了', '以后，', '一切', '都',
      '提速了：', '生面孔', '多起来，', '外面', '的', '钱', '也', '跟了', '进来，', '靠', '力气',
      '吃饭', '的', '码头', '一点点', '变成', '游客', '度假', '的', '步道，', '没人', '说得清',
      '是', '从', '哪天', '开始', '的。',
    ],
  },
  {
    label: '完整重写',
    words: [
      '小城', '是', '一步', '一步', '变过来', '的：', '先是', '不知不觉，', '后来', '忽然',
      '提速。', '当年', '打鱼', '的', '人', '跟着', '渔汛', '安排', '起居。', '轮渡',
      '航线', '一开，', '一切', '都', '快了', '起来——', '生面孔、', '外面', '的钱，', '货运',
      '码头', '成了', '景观', '步道，', '是', '谁', '点', '的', '头，', '已经', '没人', '记得。',
    ],
  },
]

const norm = (w: string) => w.replace(/[.,;:!?，。、；：！？…—·"'“”‘’（）()\s]/g, '')

// 词级 LCS：与原文对齐后，「在两侧都连续的 ≥2 词原样存活」才算可计数的证据窗口——
// 着色哈希看的是实际文本里的前一个词，孤立的同词、或中间被隔开的匹配都只是抛硬币噪音。
function diffSurviving(orig: string[], edited: string[]): boolean[] {
  const a = orig.map(norm)
  const b = edited.map(norm)
  const n = a.length
  const m = b.length
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  const pairI = new Array<number>(m).fill(-1)
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      pairI[j] = i
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) i++
    else j++
  }
  const surviving = new Array<boolean>(m).fill(false)
  let runStart = -1
  for (let k = 0; k <= m; k++) {
    const ok = k < m && pairI[k] >= 0 && k > 0 && pairI[k - 1] === pairI[k] - 1
    if (ok) {
      if (runStart < 0) runStart = k - 1
    } else {
      if (runStart >= 0 && k - runStart >= 2) for (let r = runStart; r < k; r++) surviving[r] = true
      runStart = -1
    }
  }
  return surviving
}

const ANALYSIS = VERSIONS.map((v) => {
  const words = v.words
  const surviving = diffSurviving(VERSIONS[0].words, words)
  const survCount = surviving.filter(Boolean).length
  return { words, surviving, survCount, total: words.length, f: words.length ? survCount / words.length : 0 }
})

function verdictOf(f: number): { text: string; tone: 'good' | 'warn' | 'danger' } {
  if (f >= 0.85) return { text: '仍然明显可检测', tone: 'good' }
  if (f >= 0.4) return { text: '标记被稀释 —— 文本够长仍可检测', tone: 'warn' }
  if (f >= 0.12) return { text: '证据所剩无几', tone: 'warn' }
  return { text: '检测塌缩到抛硬币', tone: 'danger' }
}

// 编辑器的 select 会传来字符串，这里统一收敛为 0..4
const clampDepth = (v: unknown) => Math.min(4, Math.max(0, Math.round(Number(v) || 0)))

function Edit({ props }: { props: WatermarkEditProps }) {
  const P = palette()
  useTheme()
  const [depth, setDepth] = useState(clampDepth(props.depth))
  useEffect(() => setDepth(clampDepth(props.depth)), [props.depth])

  const a = ANALYSIS[depth]
  const verdict = verdictOf(a.f)
  const toneColor = verdict.tone === 'good' ? P.good : verdict.tone === 'warn' ? P.warn : P.danger
  const extrapolation =
    a.f >= 0.85
      ? '窗口几乎完整保留，1,500 词的文档证据充分。'
      : a.f >= 0.4
        ? '证据打了折但没有消失——更长的文本能把稀释补回来。'
        : `要把证据强度补回来，需要约 ${Math.round(1 / (a.f * a.f))} 倍长的文本——实际等于没有。`

  return (
    <div className="lb-surface">
      {/* depth selector */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="t-panel inline-flex flex-wrap rounded-lg p-0.5">
          {VERSIONS.map((v, i) => (
            <button
              key={v.label}
              onClick={() => setDepth(i)}
              className={`rounded-[6px] px-3 py-1 text-xs font-medium transition-colors ${
                depth === i ? 't-btn-primary' : 't-muted'
              }`}
            >
              {v.label}
            </button>
          ))}
        </div>
      </div>

      {/* edited paragraph: highlighted = verbatim survival */}
      <div className="t-panel rounded-xl px-4 py-3 text-[15px] leading-loose">
        {a.words.map((w, i) =>
          a.surviving[i] ? (
            <span
              key={i}
              title="这段措辞与原文逐词一致 —— 检测器可以在这里计数"
              className="mr-[1px] inline-block rounded-[4px] px-[2px]"
              style={{ background: `color-mix(in srgb, ${P.accent} 14%, transparent)`, color: P.text }}
            >
              {w}
            </span>
          ) : (
            <span key={i} className="t-faint mr-[1px]">
              {w}
            </span>
          ),
        )}
      </div>

      {/* stats + verdict */}
      <div className="mt-3 flex flex-wrap items-center gap-2.5">
        <div className="t-panel flex items-center gap-3 rounded-lg px-3.5 py-2">
          <div>
            <div className="t-faint text-[10px] uppercase tracking-wider">存活窗口</div>
            <div className="font-mono text-xl font-semibold tabular-nums" style={{ color: toneColor }}>
              {Math.round(a.f * 100)}%
            </div>
          </div>
          <div>
            <div className="t-faint text-[10px] uppercase tracking-wider">逐词存活</div>
            <div className="t-strong font-mono text-xl font-semibold tabular-nums">
              {a.survCount} / {a.total}
            </div>
          </div>
        </div>
        <div
          className="flex min-w-[220px] flex-1 flex-col justify-center rounded-lg px-3.5 py-2.5"
          style={{ background: `color-mix(in srgb, ${toneColor} 9%, transparent)` }}
        >
          <div className="text-sm font-semibold" style={{ color: toneColor }}>
            {verdict.text}
          </div>
          <div className="t-muted mt-0.5 text-xs leading-relaxed">
            外推到 1,500 词（z ≈ f·√N·z₁）：{extrapolation}
          </div>
        </div>
      </div>

      <p className="t-faint mt-2.5 text-[11px] leading-relaxed">
        高亮 = 与原文连续一致的措辞，检测器能在那里重新着色计数；褪色 = 新措辞，只剩抛硬币噪音。真实重写管线的测量
        （开放实现 KGW / EXP）：约 0.5% 窗口存活，检测 AUC 0.99 → ≈0.5；不依赖邻居的单字水印在改写下存活
        0.73–0.84。已发表实验中，人类轻度改写约 800 token 后检测又能恢复。
      </p>
    </div>
  )
}

export const WatermarkEditWidget: WidgetDefinition<WatermarkEditProps> = {
  type: 'watermark-edit',
  label: '水印编辑深度',
  description: '从修拼写到完整重写：拖动编辑深度，看连续措辞的存活窗口如何收缩、检测判决如何变化。',
  icon: '✂️',
  defaultProps: { depth: 1 },
  configSchema: [
    {
      key: 'depth',
      label: '编辑深度',
      type: 'select',
      options: VERSIONS.map((v, i) => ({ value: String(i), label: v.label })),
    },
  ],
  exportable: true,
  Component: Edit,
}
