/**
 * Prepare a canvas for crisp HiDPI drawing at any displayed size.
 *
 * The classic bug this fixes: setting `canvas.width = W * dpr` while the CSS
 * width is `100%`. When the container is wider than `W` (typical here: ~880px
 * container vs W=540 logical), the browser stretches the `W*dpr` backing
 * store to fill the displayed area, blurring all text and lines.
 *
 * Correct approach: size the backing store to the *actual displayed CSS size*
 * times dpr, then set a transform that maps the logical 0..W / 0..H coordinate
 * system onto that backing store. Result is pixel-perfect at any width.
 *
 * Usage in a draw function:
 *   const ctx = prepareCanvas(canvas, W, H)
 *   if (!ctx) return
 *   ctx.clearRect(0, 0, W, H)
 *   ... draw in logical 0..W / 0..H coords ...
 */
export function prepareCanvas(
  canvas: HTMLCanvasElement,
  logicalW: number,
  logicalH: number,
): CanvasRenderingContext2D | null {
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  const dpr = window.devicePixelRatio || 1
  const rect = canvas.getBoundingClientRect()
  const cw = rect.width || logicalW
  const ch = rect.height || logicalH
  const bw = Math.round(cw * dpr)
  const bh = Math.round(ch * dpr)
  if (canvas.width !== bw || canvas.height !== bh) {
    canvas.width = bw
    canvas.height = bh
  }
  // map logical 0..W / 0..H onto the full backing store (uniform scale when
  // the CSS aspect ratio matches logicalW/logicalH, which it always does here)
  ctx.setTransform((cw * dpr) / logicalW, 0, 0, (ch * dpr) / logicalH, 0, 0)
  return ctx
}

/**
 * Theme-aware canvas palette. Reads the current `data-theme` on <html> and
 * returns background / grid / axis / text colors that stay readable in either
 * theme. Accent colors (cyan/indigo/etc.) are left to each widget since they
 * have enough contrast on both backgrounds.
 */
export interface CanvasPalette {
  bg: string
  bg2: string
  grid: string
  axis: string
  text: string
  muted: string
  faint: string
  ghost: string // faint reference data line
}

export function palette(): CanvasPalette {
  const light =
    typeof document !== 'undefined' && document.documentElement.dataset.theme === 'light'
  return light
    ? {
        bg: '#f8fafc',
        bg2: '#eef2f7',
        grid: 'rgba(100,116,139,0.12)',
        axis: 'rgba(99,102,241,0.35)',
        text: '#334155',
        muted: '#64748b',
        faint: '#94a3b8',
        ghost: 'rgba(100,116,139,0.5)',
      }
    : {
        bg: '#0a0f1e',
        bg2: '#070b16',
        grid: 'rgba(148,163,184,0.08)',
        axis: 'rgba(129,140,248,0.3)',
        text: '#e2e8f0',
        muted: '#94a3b8',
        faint: '#64748b',
        ghost: 'rgba(148,163,184,0.6)',
      }
}
