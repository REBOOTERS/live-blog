import { useEffect, useRef, useState } from 'react'
import {
  downloadBlob,
  isCanvasRecordingSupported,
  recordCanvas,
  recordElement,
  sanitizeFilePart,
  type RecordHandle,
} from '../lib/recorder'
import { useSettings } from '../lib/settings'

export type ExportTarget =
  | { kind: 'canvas'; canvas: HTMLCanvasElement }
  | { kind: 'dom'; node: HTMLElement }

interface Props {
  widgetType: string
  getTarget: () => ExportTarget | null
  /** 文件名前缀（文章名-章节名），由阅读视图注入；缺省时退回仅组件类型。 */
  namePrefix?: string
}

type Phase = 'idle' | 'recording' | 'saving'

/** 图头右侧的「导出演示视频」按钮：按设置中的时长/帧率录制并下载 MP4/WebM。 */
export function WidgetExportButton({ widgetType, getTarget, namePrefix }: Props) {
  const settings = useSettings()
  const [phase, setPhase] = useState<Phase>('idle')
  const [remaining, setRemaining] = useState(settings.exportDurationSec)
  const handleRef = useRef<RecordHandle | null>(null)
  const timerRef = useRef<number | null>(null)

  const clearTimer = () => {
    if (timerRef.current != null) {
      window.clearInterval(timerRef.current)
      timerRef.current = null
    }
  }

  useEffect(() => {
    return () => {
      clearTimer()
      handleRef.current?.stop()
    }
  }, [])

  if (!isCanvasRecordingSupported()) return null

  const start = () => {
    const target = getTarget()
    if (!target) return
    // 时长在开始录制时定格，录制中途改设置不影响本轮倒计时
    const durationSec = settings.exportDurationSec
    const handle =
      target.kind === 'canvas'
        ? recordCanvas(target.canvas, { durationSec, fps: settings.exportFps })
        : recordElement(target.node, { durationSec, fps: settings.exportFps })
    handleRef.current = handle
    const startedAt = performance.now()
    setRemaining(durationSec)
    setPhase('recording')
    clearTimer()
    timerRef.current = window.setInterval(() => {
      setRemaining(Math.max(0, durationSec - (performance.now() - startedAt) / 1000))
    }, 100)

    handle.result
      .then(({ blob, ext }) => {
        const stem = [namePrefix, widgetType]
          .map((part) => (part ? sanitizeFilePart(part) : ''))
          .filter(Boolean)
          .join('-')
        downloadBlob(blob, `${stem}-${Date.now()}.${ext}`)
        setPhase('saving')
        window.setTimeout(() => setPhase('idle'), 1200)
      })
      .catch(() => setPhase('idle'))
      .finally(() => {
        clearTimer()
        handleRef.current = null
      })
  }

  if (phase === 'recording') {
    return (
      <button
        type="button"
        className="flex shrink-0 cursor-pointer items-center gap-1.5 bg-transparent border-none p-0 text-[12px] tabular-nums"
        style={{ color: '#e5484d' }}
        title="停止并保存"
        aria-label="停止并保存"
        onClick={() => handleRef.current?.stop()}
      >
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: '#e5484d' }} />
        {remaining.toFixed(1)}s
      </button>
    )
  }

  if (phase === 'saving') {
    return (
      <span className="t-muted shrink-0 text-[12px]" aria-live="polite">
        已保存 ✓
      </span>
    )
  }

  return (
    <button
      type="button"
      className="lb-export-btn t-btn flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-full"
      title={`导出 ${settings.exportDurationSec} 秒演示视频`}
      aria-label={`导出 ${settings.exportDurationSec} 秒演示视频`}
      onClick={start}
    >
      {/* 摄像机 + 右下角下载角标：表达「录制并下载」而非「播放」 */}
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <rect x="2.5" y="5.5" width="12.5" height="11.5" rx="2.5" stroke="currentColor" strokeWidth="1.8" />
        <path d="M15 9.8 21 6.5v9.5l-6-3.3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="18.5" cy="18.5" r="4.5" fill="var(--lb-accent)" />
        <path d="M18.5 16.2v4.6M16.9 19.3l1.6 1.6 1.6-1.6" stroke="#fff" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  )
}
