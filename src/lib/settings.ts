import { useEffect, useState } from 'react'

export interface Settings {
  /** Widget 演示视频导出的录制时长（秒） */
  exportDurationSec: number
  /** Widget 演示视频导出的帧率 */
  exportFps: number
}

const KEY = 'liveblog:settings:v1'

export const DEFAULT_SETTINGS: Settings = { exportDurationSec: 10, exportFps: 30 }

const FPS_CHOICES = [24, 30, 60]

function clamp(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.round(n)))
}

function normalize(raw: unknown): Settings {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Partial<Settings>
  const fps = FPS_CHOICES.includes(Number(o.exportFps)) ? Number(o.exportFps) : DEFAULT_SETTINGS.exportFps
  return {
    exportDurationSec: clamp(o.exportDurationSec, 3, 30, DEFAULT_SETTINGS.exportDurationSec),
    exportFps: fps,
  }
}

function loadSettings(): Settings {
  try {
    const saved = localStorage.getItem(KEY)
    if (!saved) return { ...DEFAULT_SETTINGS }
    return normalize(JSON.parse(saved))
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

let current: Settings = loadSettings()
const listeners = new Set<() => void>()

export function getSettings(): Settings {
  return current
}

export function updateSettings(patch: Partial<Settings>): void {
  current = normalize({ ...current, ...patch })
  try {
    localStorage.setItem(KEY, JSON.stringify(current))
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l())
}

/** Subscribe to settings changes; re-renders the component on change. */
export function useSettings(): Settings {
  const [s, setS] = useState<Settings>(current)
  useEffect(() => {
    const l = () => setS(current)
    listeners.add(l)
    return () => {
      listeners.delete(l)
    }
  }, [])
  return s
}
