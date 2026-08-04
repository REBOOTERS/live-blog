import { useEffect, useRef } from 'react'

/**
 * Calls `cb(dt, elapsed)` every animation frame. `dt` is in seconds, capped to
 * avoid large jumps after tab switches. The callback is stored in a ref so the
 * effect never re-subscribes.
 */
export function useAnimationFrame(cb: (dt: number, elapsed: number) => void, active = true) {
  const cbRef = useRef(cb)
  cbRef.current = cb

  useEffect(() => {
    if (!active) return
    let raf = 0
    let last = performance.now()
    let elapsed = 0
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      elapsed += dt
      cbRef.current(dt, elapsed)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [active])
}
