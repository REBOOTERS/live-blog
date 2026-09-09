import { useEffect, useState } from 'react'

/** 实际生效的主题（system 已解析为 light/dark），Widget 重绘用它。 */
export type Theme = 'dark' | 'light'
/** 用户选择的模式，'system' 表示跟随系统。 */
export type ThemeMode = 'dark' | 'light' | 'system'

const KEY = 'liveblog:theme'

function systemTheme(): Theme {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function normalizeMode(v: unknown): ThemeMode {
  return v === 'dark' || v === 'light' || v === 'system' ? v : 'system'
}

function resolve(mode: ThemeMode): Theme {
  return mode === 'system' ? systemTheme() : mode
}

function getInitialMode(): ThemeMode {
  if (typeof localStorage !== 'undefined') {
    return normalizeMode(localStorage.getItem(KEY))
  }
  return 'system'
}

let currentMode: ThemeMode = getInitialMode()
let current: Theme = typeof window !== 'undefined' ? resolve(currentMode) : 'light'
const listeners = new Set<() => void>()

export function getTheme(): Theme {
  return current
}

export function getThemeMode(): ThemeMode {
  return currentMode
}

function apply(mode: ThemeMode): void {
  currentMode = mode
  current = resolve(mode)
  try {
    localStorage.setItem(KEY, mode)
  } catch {
    /* ignore */
  }
  if (typeof document !== 'undefined') document.documentElement.dataset.theme = current
  listeners.forEach((l) => l())
}

export function setThemeMode(mode: ThemeMode): void {
  apply(mode)
}

// 「跟随系统」模式下，系统切换日夜时实时跟随（含已打开页面的重绘）
if (typeof window !== 'undefined') {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (currentMode === 'system') apply('system')
  })
}

/** Subscribe to resolved theme changes; re-renders the component on change. */
export function useTheme(): Theme {
  const [t, setT] = useState<Theme>(current)
  useEffect(() => {
    const l = () => setT(current)
    listeners.add(l)
    document.documentElement.dataset.theme = current
    return () => {
      listeners.delete(l)
    }
  }, [])
  return t
}

/** Subscribe to the user-chosen mode (for the settings UI's 3-way selector). */
export function useThemeMode(): ThemeMode {
  const [m, setM] = useState<ThemeMode>(currentMode)
  useEffect(() => {
    const l = () => setM(currentMode)
    listeners.add(l)
    return () => {
      listeners.delete(l)
    }
  }, [])
  return m
}
