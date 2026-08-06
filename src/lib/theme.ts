import { useEffect, useState } from 'react'

export type Theme = 'dark' | 'light'

const KEY = 'liveblog:theme'

let current: Theme = (typeof localStorage !== 'undefined' && (localStorage.getItem(KEY) as Theme)) || 'dark'
const listeners = new Set<() => void>()

export function getTheme(): Theme {
  return current
}

export function setTheme(t: Theme): void {
  current = t
  try {
    localStorage.setItem(KEY, t)
  } catch {
    /* ignore */
  }
  if (typeof document !== 'undefined') document.documentElement.dataset.theme = t
  listeners.forEach((l) => l())
}

export function toggleTheme(): void {
  setTheme(current === 'dark' ? 'light' : 'dark')
}

/** Subscribe to theme changes; re-renders the component on change. */
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
