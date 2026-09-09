import { useEffect, useState } from 'react'
import { palette } from '../lib/canvas'
import { useTheme } from '../lib/theme'
import type { WidgetDefinition } from './registry'

interface VideoLedgerProps {
  resolution: '360p' | '480p' | '720p' | '1080p'
  duration: number
  fps: number
}

const RESOLUTIONS = ['360p', '480p', '720p', '1080p'] as const
const FPSS = [12, 24, 30] as const
const RES: Record<VideoLedgerProps['resolution'], [number, number]> = {
  '360p': [640, 360],
  '480p': [854, 480],
  '720p': [1280, 720],
  '1080p': [1920, 1080],
}
const MAX_VAL = 1920 * 1080 * 8 * 30 // 对数条满刻度：1080p · 8 秒 · 30fps

function fmt(n: number): string {
  if (n >= 1e8) return `${(n / 1e8).toFixed(2)} 亿`
  if (n >= 1e4) return `${(n / 1e4).toFixed(1)} 万`
  return String(Math.round(n))
}

function Ledger({ props }: { props: VideoLedgerProps }) {
  const P = palette()
  useTheme() // re-render so palette() re-reads on theme switch
  const [res, setRes] = useState(props.resolution)
  const [duration, setDuration] = useState(props.duration)
  const [fps, setFps] = useState(props.fps)
  useEffect(() => setRes(props.resolution), [props.resolution])
  useEffect(() => setDuration(props.duration), [props.duration])
  useEffect(() => setFps(props.fps), [props.fps])

  const [w, h] = RES[res]
  const frames = Math.round(fps * duration)
  const lFrames = Math.max(1, Math.round(frames / 4))
  const lattice = (w / 8) * (h / 8) * lFrames
  const pixels = w * h * frames
  const latentNums = lattice * 16
  const tokens = lattice / 4
  const barW = (v: number) => `${Math.max(2, (Math.log10(v) / Math.log10(MAX_VAL)) * 100)}%`

  return (
    <div className="lb-surface">
      {/* controls */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="t-panel inline-flex rounded-lg p-0.5">
          {RESOLUTIONS.map((r) => (
            <button
              key={r}
              onClick={() => setRes(r)}
              className={`rounded-[6px] px-2.5 py-1 text-xs font-medium transition ${
                res === r ? 't-btn-primary' : 't-muted'
              }`}
            >
              {r}
            </button>
          ))}
        </div>
        <div className="t-panel inline-flex rounded-lg p-0.5">
          {FPSS.map((f) => (
            <button
              key={f}
              onClick={() => setFps(f)}
              className={`rounded-[6px] px-2.5 py-1 text-xs font-medium transition ${
                fps === f ? 't-btn-primary' : 't-muted'
              }`}
            >
              {f}fps
            </button>
          ))}
        </div>
        <label className="t-muted ml-auto flex w-full items-center gap-2 text-xs sm:w-56">
          <span className="shrink-0">时长 {duration} 秒</span>
          <input
            type="range"
            min={1}
            max={8}
            step={1}
            value={duration}
            onChange={(e) => setDuration(Number(e.target.value))}
            className="flex-1"
          />
        </label>
      </div>

      {/* the two ledgers */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="t-panel rounded-xl p-4">
          <div className="t-faint mb-1 text-[10px] uppercase tracking-wider">像素账 · 在像素上干活</div>
          <div className="t-strong text-2xl font-semibold tabular-nums">
            {fmt(pixels)}
            <span className="t-muted ml-1 text-sm font-normal">个像素读数</span>
          </div>
          <div className="t-faint mt-1 font-mono text-[11px] tabular-nums">
            {w}×{h} × {frames} 帧 = {pixels.toLocaleString('en-US')}
          </div>
          <div className="mt-3 h-3 rounded-full" style={{ background: P.bg2 }}>
            <div
              className="h-3 rounded-full transition-[width] duration-300"
              style={{ width: barW(pixels), background: `color-mix(in srgb, ${P.muted} 55%, transparent)` }}
            />
          </div>
        </div>
        <div className="t-panel rounded-xl p-4">
          <div className="t-faint mb-1 text-[10px] uppercase tracking-wider">潜账 · 3D 因果 VAE 之后</div>
          <div className="text-2xl font-semibold tabular-nums" style={{ color: P.accent }}>
            {fmt(latentNums)}
            <span className="t-muted ml-1 text-sm font-normal">个数</span>
          </div>
          <div className="t-faint mt-1 font-mono text-[11px] tabular-nums">
            {lFrames} 潜帧 × {w / 8}×{h / 8} 潜格 × 16 通道 = {latentNums.toLocaleString('en-US')}
          </div>
          <div className="mt-3 h-3 rounded-full" style={{ background: P.bg2 }}>
            <div
              className="h-3 rounded-full transition-[width] duration-300"
              style={{ width: barW(latentNums), background: P.accent }}
            />
          </div>
        </div>
      </div>

      {/* summary chips */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="t-panel rounded-full px-3 py-1 text-xs" style={{ color: P.accent }}>
          空间 ÷8 · 时间 ÷4 · ×16 通道 = 数字个数压到 1/16
        </span>
        <span className="t-panel rounded-full px-3 py-1 text-xs" style={{ color: P.accent }}>
          切成 1×2×2 补丁 → {fmt(tokens)} 个 token
        </span>
      </div>

      {/* frame strip: time compression */}
      <div className="mt-4">
        <div className="t-faint mb-1.5 text-[10px] uppercase tracking-wider">
          时间方向：4 个像素帧 → 1 个潜帧
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap gap-[3px]">
            {Array.from({ length: Math.min(frames, 40) }, (_, i) => (
              <span
                key={i}
                className="h-3.5 w-3.5 rounded-[3px]"
                style={{ background: P.bg2, border: `1px solid ${P.grid}` }}
              />
            ))}
          </div>
          <span className="shrink-0 font-mono text-sm" style={{ color: P.accent }}>
            →
          </span>
          <div className="flex flex-wrap gap-1">
            {Array.from({ length: Math.min(lFrames, 10) }, (_, i) => (
              <span
                key={i}
                className="flex h-7 w-7 items-center justify-center rounded-md font-mono text-[9px]"
                style={{
                  background: `color-mix(in srgb, ${P.accent} 14%, transparent)`,
                  border: `1px solid ${P.accent}`,
                  color: P.accent,
                }}
              >
                ×16
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

export const VideoLedgerWidget: WidgetDefinition<VideoLedgerProps> = {
  type: 'video-ledger',
  label: '压缩账本',
  description: '拨动分辨率/帧率/时长，实时看像素账如何被 3D VAE 压成潜账，再切成 token。',
  icon: '🧮',
  defaultProps: { resolution: '720p', duration: 5, fps: 24 },
  configSchema: [
    {
      key: 'resolution',
      label: '分辨率',
      type: 'select',
      options: RESOLUTIONS.map((r) => ({ value: r, label: r })),
    },
    { key: 'duration', label: '时长（秒）', type: 'range', min: 1, max: 8, step: 1 },
    { key: 'fps', label: '帧率', type: 'range', min: 12, max: 30, step: 1 },
  ],
  exportable: true,
  Component: Ledger,
}
