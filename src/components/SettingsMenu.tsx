import { useEffect, useRef, useState } from 'react'
import { DEFAULT_SETTINGS, updateSettings, useSettings } from '../lib/settings'
import { setThemeMode, useThemeMode, type ThemeMode } from '../lib/theme'

const FPS_CHOICES = [24, 30, 60]
const THEME_MODES: { value: ThemeMode; label: string }[] = [
  { value: 'system', label: '跟随系统' },
  { value: 'light', label: '日间' },
  { value: 'dark', label: '夜间' },
]

function GearIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.01a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  )
}

/** 顶栏「设置」弹出面板：配置 Widget 演示视频导出参数。 */
export function SettingsMenu() {
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const settings = useSettings()
  const themeMode = useThemeMode()

  // 外点 / Escape 关闭（与收藏夹菜单同一套约定）
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        title="设置"
        aria-label="设置"
        aria-expanded={open}
        className="t-btn flex h-9 w-9 items-center justify-center rounded-full"
      >
        <GearIcon className="h-[18px] w-[18px]" />
      </button>
      {open && (
        <div
          className="t-panel absolute right-0 top-11 z-50 w-[20rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl shadow-2xl"
          style={{
            background: 'var(--lb-surface-bg)',
            border: '1px solid var(--lb-border-soft)',
          }}
        >
          <div
            className="t-heading flex items-center gap-2 border-b px-5 py-3.5 text-[15px] font-semibold"
            style={{ borderColor: 'var(--lb-border-soft)' }}
          >
            <GearIcon className="h-[15px] w-[15px]" />
            设置
          </div>
          <div className="space-y-5 p-5">
            <div>
              <div className="t-muted mb-2 text-[12.5px] font-medium">外观</div>
              <div className="flex gap-1.5">
                {THEME_MODES.map((m) => (
                  <button
                    key={m.value}
                    type="button"
                    onClick={() => setThemeMode(m.value)}
                    className={`flex-1 cursor-pointer whitespace-nowrap rounded-lg px-2 py-1.5 text-xs transition-colors ${
                      themeMode === m.value ? 't-btn-primary' : 't-btn'
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div className="t-muted mb-2 text-[12.5px] font-medium">
                录制时长 <span className="lb-mono t-faint">（{settings.exportDurationSec} 秒）</span>
              </div>
              <div className="flex items-center gap-2.5">
                <input
                  type="range"
                  min={3}
                  max={30}
                  step={1}
                  value={settings.exportDurationSec}
                  onChange={(e) => updateSettings({ exportDurationSec: Number(e.target.value) })}
                  className="min-w-0 flex-1"
                  aria-label="录制时长（秒）"
                />
                <input
                  type="number"
                  min={3}
                  max={30}
                  step={1}
                  value={settings.exportDurationSec}
                  onChange={(e) => updateSettings({ exportDurationSec: Number(e.target.value) })}
                  className="t-input lb-mono w-16 rounded px-2 py-1 text-right text-xs"
                  aria-label="录制时长（秒）"
                />
              </div>
            </div>
            <div>
              <div className="t-muted mb-2 text-[12.5px] font-medium">导出帧率</div>
              <div className="flex gap-1.5">
                {FPS_CHOICES.map((fps) => (
                  <button
                    key={fps}
                    type="button"
                    onClick={() => updateSettings({ exportFps: fps })}
                    className={`lb-mono flex-1 cursor-pointer whitespace-nowrap rounded-lg px-2 py-1.5 text-xs transition-colors ${
                      settings.exportFps === fps ? 't-btn-primary' : 't-btn'
                    }`}
                  >
                    {fps} fps
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-center justify-between border-t pt-3.5" style={{ borderColor: 'var(--lb-border-soft)' }}>
              <span className="t-faint text-[11.5px]">导出按钮与倒计时会实时跟随这里的设置</span>
              <button
                type="button"
                onClick={() => updateSettings(DEFAULT_SETTINGS)}
                className="t-btn t-faint shrink-0 cursor-pointer whitespace-nowrap rounded-full px-3 py-1 text-[12px]"
              >
                恢复默认
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
