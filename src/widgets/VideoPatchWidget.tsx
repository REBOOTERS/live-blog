import { useEffect, useRef, useState } from 'react'
import { useAnimationFrame } from '../lib/useAnimationFrame'
import { prepareCanvas, palette } from '../lib/canvas'
import { useTheme } from '../lib/theme'
import type { WidgetDefinition } from './registry'

interface VideoPatchProps {
  duration: number // 秒
  patch: 'fine' | 'coarse'
}

const W = 560
const H = 280
const LAT_H = 90 // 真实 720p 潜网格高
const LAT_W = 160 // 真实 720p 潜网格宽
const FPS = 24
const COLS = 24 // 示意网格列数
const GRID_L = 28
const GRID_R = W - 28
const GRID_T = 26
const GRID_B = 146
const STRIP_Y = 176
const STRIP_H = 22
const STRIP_CELLS = 96
const STRIP_CW = (GRID_R - GRID_L) / STRIP_CELLS

const PATCHES = {
  // 真实潜网格上的补丁尺寸 (t×h×w)，与示意网格上的行/列覆盖数
  fine: { t: 1, h: 2, w: 2, sRows: 1, sCols: 2, label: '1×2×2' },
  coarse: { t: 2, h: 4, w: 4, sRows: 2, sCols: 4, label: '2×4×4' },
} as const

function fmt(n: number): string {
  if (n >= 1e8) return `${(n / 1e8).toFixed(1)} 亿`
  if (n >= 1e4) return `${(n / 1e4).toFixed(1)} 万`
  return String(Math.round(n))
}

function hexToRgba(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`
}

function tokenCount(duration: number, patch: 'fine' | 'coarse'): number {
  const p = PATCHES[patch]
  const lFrames = Math.max(1, Math.round((FPS * duration) / 4))
  return Math.ceil(lFrames / p.t) * Math.ceil(LAT_H / p.h) * Math.ceil(LAT_W / p.w)
}

function Patches({ props }: { props: VideoPatchProps }) {
  const P = palette()
  useTheme() // re-render so palette() re-reads on theme switch
  const [duration, setDuration] = useState(props.duration)
  const [patch, setPatch] = useState(props.patch)
  useEffect(() => setDuration(props.duration), [props.duration])
  useEffect(() => setPatch(props.patch), [props.patch])

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const hoverRef = useRef(-1)

  const p = PATCHES[patch]
  const lFrames = Math.max(1, Math.round((FPS * duration) / 4))
  const tokens = tokenCount(duration, patch)
  const costX = (tokens / tokenCount(2, patch)) ** 2

  useAnimationFrame(() => {
    draw()
  })

  const draw = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = prepareCanvas(canvas, W, H)
    if (!ctx) return
    const P = palette()

    const bg = ctx.createLinearGradient(0, 0, 0, H)
    bg.addColorStop(0, P.bg)
    bg.addColorStop(1, P.bg2)
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, W, H)

    // ---- 潜视频网格（示意）：每行 1 个潜帧 ----
    ctx.fillStyle = P.faint
    ctx.font = '11px ui-monospace, monospace'
    ctx.fillText(`潜视频网格（示意）· 每行 1 个潜帧 · F = ${lFrames}`, GRID_L, 16)

    const rows = Math.min(lFrames, 48)
    const rh = (GRID_B - GRID_T) / Math.max(rows, 1)
    const cw = (GRID_R - GRID_L) / COLS
    const patchRows = Math.ceil(rows / p.sRows)
    const patchCols = Math.ceil(COLS / p.sCols)
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < COLS; c++) {
        const pi = Math.floor(r / p.sRows) * patchCols + Math.floor(c / p.sCols)
        ctx.fillStyle = hexToRgba(P.accent, 0.1 + 0.08 * (pi % 3))
        ctx.fillRect(GRID_L + c * cw, GRID_T + r * rh, Math.max(cw - 1, 1), Math.max(rh - 1, 0.6))
      }
    }
    ctx.strokeStyle = hexToRgba(P.accent, 0.45)
    ctx.lineWidth = 1
    for (let pr = 0; pr < patchRows; pr++) {
      for (let pc = 0; pc < patchCols; pc++) {
        ctx.strokeRect(
          GRID_L + pc * p.sCols * cw,
          GRID_T + pr * p.sRows * rh,
          p.sCols * cw,
          p.sRows * rh,
        )
      }
    }

    // ---- 切块拉平 ----
    ctx.fillStyle = P.muted
    ctx.fillText('↓ 切成时空补丁 · 拉平成一个 token 序列', GRID_L, 166)

    // ---- token 序列条：悬停一格，画它对其余全部 token 的注意力 ----
    const hi = hoverRef.current
    if (hi >= 0 && hi < STRIP_CELLS) {
      ctx.strokeStyle = hexToRgba(P.accent, 0.3)
      ctx.lineWidth = 1
      const cy = STRIP_Y + STRIP_H / 2
      for (let i = 0; i < STRIP_CELLS; i++) {
        if (i === hi) continue
        ctx.beginPath()
        ctx.moveTo(GRID_L + hi * STRIP_CW + STRIP_CW / 2, cy)
        ctx.lineTo(GRID_L + i * STRIP_CW + STRIP_CW / 2, cy)
        ctx.stroke()
      }
    }
    for (let i = 0; i < STRIP_CELLS; i++) {
      ctx.fillStyle = i === hi ? P.accent : P.bg2
      ctx.fillRect(GRID_L + i * STRIP_CW, STRIP_Y, Math.max(STRIP_CW - 1, 1), STRIP_H)
    }

    // ---- 账目 ----
    ctx.font = '11px ui-monospace, monospace'
    ctx.fillStyle = P.muted
    ctx.fillText(
      `token 总数 N = ${tokens.toLocaleString('en-US')}（真实 720p 潜网格 ${LAT_H}×${LAT_W}）`,
      GRID_L,
      218,
    )
    if (hi >= 0) {
      ctx.fillStyle = P.accent
      ctx.fillText(
        `光标停在第 ${hi + 1} 格：一次注意力，同时看到其余 ${STRIP_CELLS - 1} 格`,
        GRID_L,
        236,
      )
    } else {
      ctx.fillStyle = P.faint
      ctx.fillText('把鼠标放进 token 条：任意一个补丁，都同时看到其他所有补丁', GRID_L, 236)
    }
    ctx.fillStyle = P.warn
    ctx.fillText(
      `注意力配对数 N² ≈ ${fmt(tokens * tokens)} · 时长翻倍 -> N 翻倍 -> 这里 ×4`,
      GRID_L,
      254,
    )
  }

  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const x = ((e.clientX - r.left) / r.width) * W
    const y = ((e.clientY - r.top) / r.height) * H
    hoverRef.current =
      y >= STRIP_Y - 5 && y <= STRIP_Y + STRIP_H + 5 && x >= GRID_L && x <= GRID_R
        ? Math.min(STRIP_CELLS - 1, Math.max(0, Math.floor((x - GRID_L) / STRIP_CW)))
        : -1
  }

  return (
    <div className="lb-surface">
      <canvas
        ref={canvasRef}
        onPointerMove={onMove}
        onPointerLeave={() => (hoverRef.current = -1)}
        style={{ width: '100%', aspectRatio: `${W} / ${H}`, borderRadius: 8 }}
      />

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <div className="t-panel inline-flex rounded-lg p-0.5">
          {[2, 4, 8].map((d) => (
            <button
              key={d}
              onClick={() => setDuration(d)}
              className={`rounded-[6px] px-3 py-1 text-xs font-medium transition ${
                Math.abs(duration - d) < 0.01 ? 't-btn-primary' : 't-muted'
              }`}
            >
              {d} 秒
            </button>
          ))}
        </div>
        <div className="t-panel inline-flex rounded-lg p-0.5">
          {(['fine', 'coarse'] as const).map((pk) => (
            <button
              key={pk}
              onClick={() => setPatch(pk)}
              className={`rounded-[6px] px-3 py-1 text-xs font-medium transition ${
                patch === pk ? 't-btn-primary' : 't-muted'
              }`}
            >
              {PATCHES[pk].label}
            </button>
          ))}
        </div>
        <span className="t-muted ml-auto font-mono text-xs tabular-nums">
          注意力开销 vs 2 秒：×{costX.toFixed(1)}
        </span>
      </div>

      <div className="mt-2 flex flex-wrap gap-2">
        <span className="t-panel rounded-full px-3 py-1 font-mono text-[11px] tabular-nums">
          潜帧 F = {lFrames}
        </span>
        <span className="t-panel rounded-full px-3 py-1 font-mono text-[11px] tabular-nums">
          token N = {tokens.toLocaleString('en-US')}
        </span>
        <span
          className="t-panel rounded-full px-3 py-1 font-mono text-[11px] tabular-nums"
          style={{ color: P.warn }}
        >
          N² ≈ {fmt(tokens * tokens)}
        </span>
        <span className="t-panel rounded-full px-3 py-1 font-mono text-[11px]">
          补丁 {p.label}（潜空间）
        </span>
      </div>
    </div>
  )
}

export const VideoPatchWidget: WidgetDefinition<VideoPatchProps> = {
  type: 'video-patches',
  label: '时空补丁',
  description: '潜视频切块拉平成 token 序列；悬停任一补丁看注意力的全连接，时长翻倍开销翻四倍。',
  icon: '🧩',
  defaultProps: { duration: 4, patch: 'fine' },
  configSchema: [
    { key: 'duration', label: '时长（秒）', type: 'range', min: 1, max: 8, step: 1 },
    {
      key: 'patch',
      label: '补丁尺寸',
      type: 'select',
      options: [
        { value: 'fine', label: '细 1×2×2' },
        { value: 'coarse', label: '粗 2×4×4' },
      ],
    },
  ],
  exportable: true,
  Component: Patches,
}
