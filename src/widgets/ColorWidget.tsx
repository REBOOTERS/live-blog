import { useEffect, useRef, useState } from 'react'
import { useAnimationFrame } from '../lib/useAnimationFrame'
import { prepareCanvas } from '../lib/canvas'
import type { WidgetDefinition } from './registry'

interface ColorProps {
  mode: 'additive' | 'subtractive'
  animate: boolean
}

// Channel state lives in refs so the rAF loop can repaint without re-rendering
// React each frame; the sliders are the source of truth and update both the
// ref and a throttled React state used only for the numeric readouts.
const W = 460
const H = 300
const R = 78 // circle radius
// Three circle centers arranged in a triangle
const C = {
  r: { x: W / 2 - R * 0.62, y: H / 2 - R * 0.52 },
  g: { x: W / 2 + R * 0.62, y: H / 2 - R * 0.52 },
  b: { x: W / 2, y: H / 2 + R * 0.72 },
}

type RGB = { r: number; g: number; b: number }

export function ColorMix({ props }: { props: ColorProps }) {
  const { animate } = props
  const [mode, setMode] = useState<ColorProps['mode']>(props.mode)
  useEffect(() => setMode(props.mode), [props.mode])

  const rgbRef = useRef<RGB>({ r: 255, g: 255, b: 255 })
  const [, force] = useState(0)

  // smooth animated breathing of each channel
  const tRef = useRef(0)

  useAnimationFrame((dt) => {
    if (animate) {
      tRef.current += dt
      const t = tRef.current
      rgbRef.current = {
        r: Math.round(127.5 + 127.5 * Math.sin(t * 0.9)),
        g: Math.round(127.5 + 127.5 * Math.sin(t * 0.7 + 2.1)),
        b: Math.round(127.5 + 127.5 * Math.sin(t * 1.1 + 4.0)),
      }
      force((n) => (n + 1) % 1_000_000)
    }
    draw()
  })

  const canvasRef = useRef<HTMLCanvasElement>(null)

  const setChannel = (k: keyof RGB) => (v: number) => {
    rgbRef.current = { ...rgbRef.current, [k]: v }
    tRef.current = 0
    force((n) => n + 1)
  }

  const draw = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = prepareCanvas(canvas, W, H)
    if (!ctx) return

    // The canvas background is dictated by the color-mixing *physics*, not the
    // page theme: additive (light) needs a dark "darkroom" so the glowing beams
    // read; subtractive (pigment) needs a white "paper" so CMY inks darken.
    const dark = mode === 'additive'
    const bg = ctx.createLinearGradient(0, 0, 0, H)
    bg.addColorStop(0, dark ? '#0a0f1e' : '#ffffff')
    bg.addColorStop(1, dark ? '#070b16' : '#f5f5f7')
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, W, H)

    const { r, g, b } = rgbRef.current

    // Three overlapping glowing circles. In additive (light) mode we use
    // 'lighter' compositing so overlapping regions brighten toward white;
    // in subtractive (pigment) mode we multiply so mixes darken toward black.
    ctx.save()
    if (mode === 'additive') {
      ctx.globalCompositeOperation = 'lighter'
      drawBlob(ctx, C.r, `rgba(255,40,60,${r / 255})`)
      drawBlob(ctx, C.g, `rgba(40,255,90,${g / 255})`)
      drawBlob(ctx, C.b, `rgba(50,120,255,${b / 255})`)
    } else {
      // subtractive: CMY pigments. Map RGB sliders to C/M/Y ink amounts.
      const cInk = 1 - r / 255
      const mInk = 1 - g / 255
      const yInk = 1 - b / 255
      ctx.globalCompositeOperation = 'multiply'
      drawBlob(ctx, C.r, `rgba(0,255,255,${cInk})`)
      drawBlob(ctx, C.g, `rgba(255,0,255,${mInk})`)
      drawBlob(ctx, C.b, `rgba(255,255,0,${yInk})`)
    }
    ctx.restore()

    // labels on each circle (contrast against the mode's background)
    ctx.globalCompositeOperation = 'source-over'
    ctx.font = '600 12px ui-monospace, monospace'
    ctx.textAlign = 'center'
    ctx.fillStyle = dark ? 'rgba(255,255,255,0.85)' : 'rgba(29,29,31,0.75)'
    ctx.fillText(mode === 'additive' ? `R ${r}` : `C ${255 - r}`, C.r.x, C.r.y + 4)
    ctx.fillText(mode === 'additive' ? `G ${g}` : `M ${255 - g}`, C.g.x, C.g.y + 4)
    ctx.fillText(mode === 'additive' ? `B ${b}` : `Y ${255 - b}`, C.b.x, C.b.y + 4)
  }

  const { r, g, b } = rgbRef.current
  const hex = `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`
  const lum = Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b)
  const comp = `#${[255 - r, 255 - g, 255 - b].map((v) => v.toString(16).padStart(2, '0')).join('')}`
  // HSL
  const hsl = rgbToHsl(r, g, b)

  return (
    <div className="lb-surface">
      <div className="grid gap-4 sm:grid-cols-[1fr_150px]">
        <canvas
          ref={canvasRef}
          style={{ width: '100%', aspectRatio: `${W} / ${H}`, borderRadius: 8 }}
        />
        {/* resulting color preview */}
        <div className="flex flex-col gap-2">
          <div
            className="flex-1 rounded-lg border"
            style={{ background: hex, minHeight: 80, boxShadow: `0 0 28px -6px ${hex}`, borderColor: 'var(--lb-border-soft)' }}
          />
          <div className="t-panel t-text rounded-lg p-2 font-mono text-[11px] leading-relaxed">
            <div>HEX <span style={{ color: 'var(--lb-accent)' }}>{hex}</span></div>
            <div>RGB {r},{g},{b}</div>
            <div>HSL {hsl.h}°,{hsl.s}%,{hsl.l}%</div>
            <div className="t-faint mt-1">亮度 {lum}</div>
            <div className="flex items-center gap-1.5 pt-1">
              <span className="t-faint">互补</span>
              <span className="inline-block h-3.5 w-3.5 rounded-sm" style={{ background: comp, border: '1px solid var(--lb-border-soft)' }} />
              <span className="t-muted">{comp}</span>
            </div>
          </div>
        </div>
      </div>

      {/* channel sliders */}
      <div className="mt-3 space-y-2">
        <ChannelSlider label={mode === 'additive' ? '红 R' : '青 C (缺红)'} value={r} onChange={setChannel('r')} track="#fb7185" />
        <ChannelSlider label={mode === 'additive' ? '绿 G' : '品红 M (缺绿)'} value={g} onChange={setChannel('g')} track="#34d399" />
        <ChannelSlider label={mode === 'additive' ? '蓝 B' : '黄 Y (缺蓝)'} value={b} onChange={setChannel('b')} track="#60a5fa" />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <div className="t-panel inline-flex rounded-lg p-0.5">
          {(['additive', 'subtractive'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`rounded-[6px] px-3 py-1 text-xs font-medium transition ${
                mode === m ? 't-btn-primary' : 't-muted'
              }`}
            >
              {m === 'additive' ? '加色（光）' : '减色（颜料）'}
            </button>
          ))}
        </div>
        <button
          onClick={() => {
            rgbRef.current = { r: 255, g: 255, b: 255 }
            tRef.current = 0
            force((n) => n + 1)
          }}
          className="t-btn rounded-md px-3 py-1.5 text-xs"
        >
          复位白光
        </button>
        <span className="t-faint ml-auto font-mono text-[10px]">
          {mode === 'additive' ? '三束光叠加 → 越加越亮，全开为白' : '三种颜料叠加 → 越混越暗，全混为黑'}
        </span>
      </div>
    </div>
  )
}

function drawBlob(ctx: CanvasRenderingContext2D, c: { x: number; y: number }, color: string) {
  const grad = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, R)
  grad.addColorStop(0, color)
  grad.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = grad
  ctx.beginPath()
  ctx.arc(c.x, c.y, R, 0, Math.PI * 2)
  ctx.fill()
}

function ChannelSlider({
  label,
  value,
  onChange,
  track,
}: {
  label: string
  value: number
  onChange: (v: number) => void
  track: string
}) {
  return (
    <label className="t-muted flex items-center gap-3 text-xs">
      <span className="w-24 shrink-0 font-mono">{label}</span>
      <input
        type="range"
        min={0}
        max={255}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1"
        style={{ accentColor: track }}
      />
      <span className="t-strong w-9 text-right font-mono tabular-nums">{value}</span>
    </label>
  )
}

function rgbToHsl(r: number, g: number, b: number) {
  r /= 255
  g /= 255
  b /= 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  let h = 0
  const l = (max + min) / 2
  const d = max - min
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1))
  if (d !== 0) {
    switch (max) {
      case r:
        h = ((g - b) / d) % 6
        break
      case g:
        h = (b - r) / d + 2
        break
      default:
        h = (r - g) / d + 4
    }
    h *= 60
    if (h < 0) h += 360
  }
  return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) }
}

export const ColorWidget: WidgetDefinition<ColorProps> = {
  type: 'color-mix',
  label: '三原色混色',
  description: '拖动 R/G/B 通道，观察加色（光）与减色（颜料）如何混合出所有颜色。',
  icon: '🎨',
  defaultProps: {
    mode: 'additive',
    animate: false,
  },
  configSchema: [
    {
      key: 'mode',
      label: '混合模式',
      type: 'select',
      options: [
        { value: 'additive', label: '加色（光）' },
        { value: 'subtractive', label: '减色（颜料）' },
      ],
    },
    { key: 'animate', label: '自动循环演示', type: 'checkbox' },
  ],
  Component: ColorMix,
}
