import { useEffect, useMemo, useRef, useState } from 'react'
import { useAnimationFrame } from '../lib/useAnimationFrame'
import { prepareCanvas, palette } from '../lib/canvas'
import { useTheme } from '../lib/theme'
import type { WidgetDefinition } from './registry'

// Processing happens on a small offscreen buffer (cheap: 360×220 ≈ 79k px);
// the result is scaled up crisply onto the display canvas via prepareCanvas.
const PROC_W = 360
const PROC_H = 220
const DSP_W = 540
const DSP_H = 330
const CELL = DSP_W / PROC_W // display px per processing px (= 1.5)

type Mode = 'pixels' | 'adjust' | 'kernel'
type KernelId = 'identity' | 'blur' | 'sharpen' | 'edge' | 'emboss'

interface VideoFilterProps {
  mode: Mode
  brightness: number
  contrast: number
  saturation: number
  hue: number
  kernel: KernelId
  intensity: number
  playing: boolean
}

interface PointParams {
  brightness: number
  contrast: number
  saturation: number
  hue: number
}

const KERNELS: { id: KernelId; label: string; k: number[]; div: number }[] = [
  { id: 'identity', label: '无变化', k: [0, 0, 0, 0, 1, 0, 0, 0, 0], div: 1 },
  { id: 'blur', label: '高斯模糊', k: [1, 2, 1, 2, 4, 2, 1, 2, 1], div: 16 },
  { id: 'sharpen', label: '锐化', k: [0, -1, 0, -1, 5, -1, 0, -1, 0], div: 1 },
  { id: 'edge', label: '边缘', k: [-1, -1, -1, -1, 8, -1, -1, -1, -1], div: 1 },
  { id: 'emboss', label: '浮雕', k: [-2, -1, 0, -1, 1, 1, 0, 1, 2], div: 1 },
]

const PRESETS: { id: string; label: string; p: PointParams }[] = [
  { id: 'none', label: '原图', p: { brightness: 0, contrast: 1, saturation: 1, hue: 0 } },
  { id: 'vintage', label: '复古', p: { brightness: 0.04, contrast: 1.12, saturation: 0.65, hue: 12 } },
  { id: 'cool', label: '冷调', p: { brightness: 0, contrast: 1.05, saturation: 1.08, hue: -18 } },
  { id: 'warm', label: '暖调', p: { brightness: 0.03, contrast: 1.05, saturation: 1.12, hue: 20 } },
  { id: 'bw', label: '黑白', p: { brightness: 0, contrast: 1.25, saturation: 0, hue: 0 } },
  { id: 'cinema', label: '电影', p: { brightness: -0.03, contrast: 1.2, saturation: 0.85, hue: -8 } },
]

const clamp255 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v)

/** W3C SVG filter hue-rotate matrix — a 3×3 RGB transform, no per-pixel allocation. */
function makeHueMatrix(deg: number): number[] | null {
  if (Math.abs(deg) < 0.5) return null
  const a = (deg * Math.PI) / 180
  const c = Math.cos(a)
  const s = Math.sin(a)
  return [
    0.213 + c * 0.787 - s * 0.213, 0.715 - c * 0.715 - s * 0.715, 0.072 - c * 0.072 + s * 0.928,
    0.213 - c * 0.213 + s * 0.143, 0.715 + c * 0.285 + s * 0.14, 0.072 - c * 0.072 - s * 0.283,
    0.213 - c * 0.213 - s * 0.787, 0.715 - c * 0.715 + s * 0.715, 0.072 + c * 0.928 + s * 0.072,
  ]
}

function applyPointTo(data: Uint8ClampedArray, p: PointParams, m: number[] | null) {
  const bn = p.brightness * 255
  const hasHue = m !== null
  for (let i = 0; i < data.length; i += 4) {
    let r = data[i] + bn
    let g = data[i + 1] + bn
    let b = data[i + 2] + bn
    r = (r - 128) * p.contrast + 128
    g = (g - 128) * p.contrast + 128
    b = (b - 128) * p.contrast + 128
    const gray = 0.299 * r + 0.587 * g + 0.114 * b
    r = gray + (r - gray) * p.saturation
    g = gray + (g - gray) * p.saturation
    b = gray + (b - gray) * p.saturation
    if (hasHue) {
      const nr = r * m[0] + g * m[1] + b * m[2]
      const ng = r * m[3] + g * m[4] + b * m[5]
      const nb = r * m[6] + g * m[7] + b * m[8]
      r = nr
      g = ng
      b = nb
    }
    data[i] = clamp255(r)
    data[i + 1] = clamp255(g)
    data[i + 2] = clamp255(b)
  }
}

function applyConvolution(
  src: Uint8ClampedArray,
  out: Uint8ClampedArray,
  k: number[],
  div: number,
  intensity: number,
) {
  for (let y = 1; y < PROC_H - 1; y++) {
    for (let x = 1; x < PROC_W - 1; x++) {
      const i = (y * PROC_W + x) * 4
      let r = 0
      let g = 0
      let b = 0
      let ki = 0
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const si = ((y + dy) * PROC_W + (x + dx)) * 4
          const w = k[ki++]
          r += src[si] * w
          g += src[si + 1] * w
          b += src[si + 2] * w
        }
      }
      r /= div
      g /= div
      b /= div
      out[i] = clamp255(src[i] + (r - src[i]) * intensity)
      out[i + 1] = clamp255(src[i + 1] + (g - src[i + 1]) * intensity)
      out[i + 2] = clamp255(src[i + 2] + (b - src[i + 2]) * intensity)
      out[i + 3] = 255
    }
  }
}

/** Trace one pixel through every point stage — used only by the inspector. */
function pointTrace(r0: number, g0: number, b0: number, p: PointParams, m: number[] | null) {
  const stages: { label: string; rgb: [number, number, number] }[] = []
  const push = (label: string, r: number, g: number, b: number) =>
    stages.push({ label, rgb: [clamp255(r), clamp255(g), clamp255(b)] })
  let r = r0
  let g = g0
  let b = b0
  push('原图', r, g, b)
  const bn = p.brightness * 255
  r += bn
  g += bn
  b += bn
  push('亮度', r, g, b)
  r = (r - 128) * p.contrast + 128
  g = (g - 128) * p.contrast + 128
  b = (b - 128) * p.contrast + 128
  push('对比度', r, g, b)
  const gray = 0.299 * r + 0.587 * g + 0.114 * b
  r = gray + (r - gray) * p.saturation
  g = gray + (g - gray) * p.saturation
  b = gray + (b - gray) * p.saturation
  push('饱和度', r, g, b)
  if (m) {
    const nr = r * m[0] + g * m[1] + b * m[2]
    const ng = r * m[3] + g * m[4] + b * m[5]
    const nb = r * m[6] + g * m[7] + b * m[8]
    push(`色相 ${p.hue > 0 ? '+' : ''}${Math.round(p.hue)}°`, nr, ng, nb)
  }
  return stages
}

/** Draws the static landscape once onto an offscreen canvas; the ball is added per-frame. */
function renderScene(ctx: CanvasRenderingContext2D) {
  const sky = ctx.createLinearGradient(0, 0, 0, 150)
  sky.addColorStop(0, '#2e6fb8')
  sky.addColorStop(1, '#bcdcff')
  ctx.fillStyle = sky
  ctx.fillRect(0, 0, PROC_W, 150)

  const glow = ctx.createRadialGradient(286, 50, 4, 286, 50, 36)
  glow.addColorStop(0, '#fff6c2')
  glow.addColorStop(0.5, '#ffd966')
  glow.addColorStop(1, 'rgba(255,217,102,0)')
  ctx.fillStyle = glow
  ctx.beginPath()
  ctx.arc(286, 50, 36, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#fff1a8'
  ctx.beginPath()
  ctx.arc(286, 50, 16, 0, Math.PI * 2)
  ctx.fill()

  ctx.fillStyle = '#7fae5a'
  ctx.beginPath()
  ctx.moveTo(0, 142)
  ctx.quadraticCurveTo(70, 102, 140, 136)
  ctx.quadraticCurveTo(210, 166, 280, 126)
  ctx.quadraticCurveTo(330, 100, 360, 132)
  ctx.lineTo(360, PROC_H)
  ctx.lineTo(0, PROC_H)
  ctx.closePath()
  ctx.fill()

  ctx.fillStyle = '#4f8f3a'
  ctx.beginPath()
  ctx.moveTo(0, 176)
  ctx.quadraticCurveTo(120, 150, 220, 170)
  ctx.quadraticCurveTo(300, 186, 360, 166)
  ctx.lineTo(360, PROC_H)
  ctx.lineTo(0, PROC_H)
  ctx.closePath()
  ctx.fill()

  ctx.fillStyle = '#b5403a'
  ctx.fillRect(58, 148, 52, 42)
  ctx.fillStyle = '#7a2a26'
  ctx.beginPath()
  ctx.moveTo(52, 150)
  ctx.lineTo(84, 124)
  ctx.lineTo(116, 150)
  ctx.closePath()
  ctx.fill()
  ctx.fillStyle = '#5d3a1a'
  ctx.fillRect(77, 165, 16, 25)
  ctx.fillStyle = '#ffe9a8'
  ctx.fillRect(64, 158, 12, 12)
  ctx.strokeStyle = '#8a6a2a'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(70, 158)
  ctx.lineTo(70, 170)
  ctx.moveTo(64, 164)
  ctx.lineTo(76, 164)
  ctx.stroke()

  ctx.fillStyle = '#6b4226'
  ctx.fillRect(258, 150, 9, 30)
  ctx.fillStyle = '#2f7d32'
  ctx.beginPath()
  ctx.arc(262, 142, 20, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#3a8f3c'
  ctx.beginPath()
  ctx.arc(250, 148, 12, 0, Math.PI * 2)
  ctx.arc(274, 148, 12, 0, Math.PI * 2)
  ctx.fill()
}

const MODES: { id: Mode; label: string }[] = [
  { id: 'pixels', label: '帧与像素' },
  { id: 'adjust', label: '调色' },
  { id: 'kernel', label: '卷积' },
]

export function VideoFilter({ props }: { props: VideoFilterProps }) {
  useTheme()
  const [mode, setMode] = useState<Mode>(props.mode)
  const [brightness, setBrightness] = useState(props.brightness)
  const [contrast, setContrast] = useState(props.contrast)
  const [saturation, setSaturation] = useState(props.saturation)
  const [hue, setHue] = useState(props.hue)
  const [kernel, setKernel] = useState<KernelId>(props.kernel)
  const [intensity, setIntensity] = useState(props.intensity)
  const [playing, setPlaying] = useState(props.playing)
  useEffect(() => setMode(props.mode), [props.mode])
  useEffect(() => setBrightness(props.brightness), [props.brightness])
  useEffect(() => setContrast(props.contrast), [props.contrast])
  useEffect(() => setSaturation(props.saturation), [props.saturation])
  useEffect(() => setHue(props.hue), [props.hue])
  useEffect(() => setKernel(props.kernel), [props.kernel])
  useEffect(() => setIntensity(props.intensity), [props.intensity])
  useEffect(() => setPlaying(props.playing), [props.playing])

  const [hover, setHover] = useState<{ px: number; py: number } | null>(null)
  const [showOriginal, setShowOriginal] = useState(false)
  const [, setTick] = useState(0)

  const displayRef = useRef<HTMLCanvasElement>(null)
  const sceneRef = useRef<HTMLCanvasElement | null>(null)
  const workRef = useRef<HTMLCanvasElement | null>(null)
  const sourceBuf = useRef(new Uint8ClampedArray(PROC_W * PROC_H * 4))
  const processedBuf = useRef(new Uint8ClampedArray(PROC_W * PROC_H * 4))
  const timeRef = useRef(0)
  const frameRef = useRef(0)

  if (!sceneRef.current && typeof document !== 'undefined') {
    const c = document.createElement('canvas')
    c.width = PROC_W
    c.height = PROC_H
    renderScene(c.getContext('2d')!)
    sceneRef.current = c
  }
  if (!workRef.current && typeof document !== 'undefined') {
    const c = document.createElement('canvas')
    c.width = PROC_W
    c.height = PROC_H
    workRef.current = c
  }

  const hueM = useMemo(() => makeHueMatrix(hue), [hue])
  const pointParams: PointParams = { brightness, contrast, saturation, hue }

  const draw = () => {
    const display = displayRef.current
    const work = workRef.current
    const scene = sceneRef.current
    if (!display || !work || !scene) return
    const wctx = work.getContext('2d')!
    wctx.clearRect(0, 0, PROC_W, PROC_H)
    wctx.drawImage(scene, 0, 0)

    // Bouncing ball — three hops per crossing.
    const cycle = 3.2
    const p = (timeRef.current % cycle) / cycle
    const bx = 18 + p * (PROC_W - 36)
    const bp = (p * 3.5) % 1
    const by = 188 - 4 * 52 * bp * (1 - bp)
    wctx.fillStyle = 'rgba(0,0,0,0.18)'
    wctx.beginPath()
    wctx.ellipse(bx, 196, 12, 3, 0, 0, Math.PI * 2)
    wctx.fill()
    const bg = wctx.createRadialGradient(bx - 3, by - 3, 1, bx, by, 11)
    bg.addColorStop(0, '#ff8a8a')
    bg.addColorStop(1, '#c01818')
    wctx.fillStyle = bg
    wctx.beginPath()
    wctx.arc(bx, by, 10, 0, Math.PI * 2)
    wctx.fill()

    const src = wctx.getImageData(0, 0, PROC_W, PROC_H)
    sourceBuf.current.set(src.data)
    let out = src
    if (!showOriginal) {
      if (mode === 'adjust') {
        applyPointTo(src.data, pointParams, hueM)
      } else if (mode === 'kernel') {
        const kd = KERNELS.find((k) => k.id === kernel)!
        out = wctx.createImageData(PROC_W, PROC_H)
        out.data.set(src.data)
        applyConvolution(src.data, out.data, kd.k, kd.div, intensity)
      }
    }
    processedBuf.current.set(out.data)
    wctx.putImageData(out, 0, 0)

    const ctx = prepareCanvas(display, DSP_W, DSP_H)
    if (!ctx) return
    ctx.clearRect(0, 0, DSP_W, DSP_H)
    ctx.imageSmoothingEnabled = true
    ctx.drawImage(work, 0, 0, DSP_W, DSP_H)

    if (hover) {
      const P = palette()
      const { px, py } = hover
      const dx = px * CELL
      const dy = py * CELL
      ctx.strokeStyle = P.accent
      ctx.lineWidth = 1
      ctx.setLineDash([3, 3])
      ctx.beginPath()
      ctx.moveTo(dx, 0)
      ctx.lineTo(dx, DSP_H)
      ctx.moveTo(0, dy)
      ctx.lineTo(DSP_W, dy)
      ctx.stroke()
      ctx.setLineDash([])
      ctx.strokeStyle = 'rgba(255,255,255,0.9)'
      ctx.lineWidth = 1
      ctx.strokeRect(dx - 0.5, dy - 0.5, CELL + 1, CELL + 1)

      // Magnified lens — 10×10 processing pixels drawn blocky, from the current (processed) frame.
      const Z = 10
      const LENS = 92
      const sx = Math.max(0, Math.min(PROC_W - Z, px - (Z >> 1)))
      const sy = Math.max(0, Math.min(PROC_H - Z, py - (Z >> 1)))
      ctx.imageSmoothingEnabled = false
      ctx.drawImage(work, sx, sy, Z, Z, 8, 8, LENS, LENS)
      ctx.imageSmoothingEnabled = true
      ctx.strokeStyle = P.text
      ctx.lineWidth = 1.5
      ctx.strokeRect(8, 8, LENS, LENS)
      const cx = 8 + (LENS / Z) * (px - sx + 0.5)
      const cy = 8 + (LENS / Z) * (py - sy + 0.5)
      ctx.strokeStyle = P.accent
      ctx.strokeRect(cx - LENS / Z / 2, cy - LENS / Z / 2, LENS / Z, LENS / Z)
      ctx.fillStyle = P.bg
      ctx.fillRect(8, 8 + LENS - 16, LENS, 16)
      ctx.fillStyle = P.text
      ctx.font = '10px ui-monospace, monospace'
      ctx.textAlign = 'left'
      ctx.fillText(`(${px}, ${py})  放大 9×`, 12, 8 + LENS - 4)
    }
  }

  useAnimationFrame((dt) => {
    if (playing) {
      timeRef.current += dt
      frameRef.current++
    }
    draw()
    if (frameRef.current % 4 === 0) setTick((t) => (t + 1) % 1_000_000)
  })

  const step = () => {
    timeRef.current += 1 / 30
    frameRef.current++
    draw()
    setTick((t) => t + 1)
  }

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = displayRef.current
    if (!c) return
    const r = c.getBoundingClientRect()
    const px = Math.floor(((e.clientX - r.left) / r.width) * PROC_W)
    const py = Math.floor(((e.clientY - r.top) / r.height) * PROC_H)
    if (px >= 0 && px < PROC_W && py >= 0 && py < PROC_H) setHover({ px, py })
    else setHover(null)
  }

  const applyPreset = (p: PointParams) => {
    setBrightness(p.brightness)
    setContrast(p.contrast)
    setSaturation(p.saturation)
    setHue(p.hue)
  }

  const resetPoint = () => applyPreset(PRESETS[0].p)

  // ---- inspector values (read from the persistent buffers at render time) ----
  const idx = hover ? (hover.py * PROC_W + hover.px) * 4 : -1
  const s = sourceBuf.current
  const d = processedBuf.current
  const sR = idx >= 0 ? s[idx] : 0
  const sG = idx >= 0 ? s[idx + 1] : 0
  const sB = idx >= 0 ? s[idx + 2] : 0
  const dR = idx >= 0 ? d[idx] : 0
  const dG = idx >= 0 ? d[idx + 1] : 0
  const dB = idx >= 0 ? d[idx + 2] : 0
  const trace =
    hover && mode === 'adjust' ? pointTrace(sR, sG, sB, pointParams, hueM) : null

  let kernelSum: { r: number; g: number; b: number } | null = null
  let neighbors: { r: number; g: number; b: number }[] = []
  if (hover && mode === 'kernel' && idx >= 0) {
    const kd = KERNELS.find((k) => k.id === kernel)!
    let r = 0
    let g = 0
    let b = 0
    const nb: { r: number; g: number; b: number }[] = []
    let ki = 0
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const ni = ((hover.py + dy) * PROC_W + (hover.px + dx)) * 4
        const nr = s[ni]
        const ng = s[ni + 1]
        const nb2 = s[ni + 2]
        nb.push({ r: nr, g: ng, b: nb2 })
        const w = kd.k[ki++]
        r += nr * w
        g += ng * w
        b += nb2 * w
      }
    }
    neighbors = nb
    kernelSum = { r: r / kd.div, g: g / kd.div, b: b / kd.div }
  }

  const activeKernel = KERNELS.find((k) => k.id === kernel)!

  return (
    <div className="lb-surface">
      <canvas
        ref={displayRef}
        onPointerMove={onPointerMove}
        onPointerLeave={() => setHover(null)}
        style={{ width: '100%', aspectRatio: `${DSP_W} / ${DSP_H}`, borderRadius: 8, touchAction: 'none' }}
      />

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <div className="t-panel inline-flex rounded-lg p-0.5">
          {MODES.map((m) => (
            <button
              key={m.id}
              onClick={() => setMode(m.id)}
              className={`rounded-[6px] px-3 py-1 text-xs font-medium transition ${
                mode === m.id ? 't-btn-primary' : 't-muted'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>

        {mode === 'pixels' ? (
          <>
            <button
              onClick={() => setPlaying((v) => !v)}
              className="t-btn-primary rounded-md px-3 py-1.5 text-sm"
            >
              {playing ? '⏸ 暂停' : '▶ 播放'}
            </button>
            <button onClick={step} disabled={playing} className="t-btn rounded-md px-3 py-1.5 text-sm disabled:opacity-40">
              › 单帧
            </button>
            <span className="t-faint ml-auto font-mono text-xs tabular-nums">第 {frameRef.current} 帧 · 约 60 fps</span>
          </>
        ) : (
          <>
            <button
              onPointerDown={() => setShowOriginal(true)}
              onPointerUp={() => setShowOriginal(false)}
              onPointerLeave={() => setShowOriginal(false)}
              onPointerCancel={() => setShowOriginal(false)}
              className={`t-btn rounded-md px-3 py-1.5 text-sm select-none ${showOriginal ? 't-btn-primary' : ''}`}
            >
              按住显示原图
            </button>
            <span className="t-faint ml-auto font-mono text-xs">
              {mode === 'adjust' ? '点运算：逐像素独立变换' : `卷积核：${activeKernel.label}`}
            </span>
          </>
        )}
      </div>

      {mode === 'pixels' && (
        <p className="t-muted mt-3 text-xs leading-relaxed">
          暂停后点「› 单帧」一帧一帧推进；把鼠标移到画面任意位置，左上角放大镜把该点周围 10×10 个像素放大 9 倍，下方面板显示该像素的 RGB 三个数。一段视频，就是这样一摞写满数字的方格。
        </p>
      )}

      {mode === 'adjust' && (
        <div className="mt-3">
          <div className="mb-3 flex flex-wrap gap-1.5">
            {PRESETS.map((preset) => (
              <button
                key={preset.id}
                onClick={() => applyPreset(preset.p)}
                className="t-btn rounded-full px-3 py-1 text-xs"
              >
                {preset.label}
              </button>
            ))}
            <button onClick={resetPoint} className="t-btn rounded-full px-3 py-1 text-xs">
              ↺ 复位
            </button>
          </div>
          <div className="grid gap-x-5 gap-y-2 sm:grid-cols-2">
            <Slider label="亮度" value={brightness} min={-0.5} max={0.5} step={0.01} onChange={setBrightness} fmt={(v) => `${v > 0 ? '+' : ''}${Math.round(v * 255)}`} />
            <Slider label="对比度" value={contrast} min={0} max={2} step={0.01} onChange={setContrast} fmt={(v) => v.toFixed(2)} />
            <Slider label="饱和度" value={saturation} min={0} max={2} step={0.01} onChange={setSaturation} fmt={(v) => v.toFixed(2)} />
            <Slider label="色相" value={hue} min={-180} max={180} step={1} onChange={setHue} fmt={(v) => `${v > 0 ? '+' : ''}${v}°`} />
          </div>
        </div>
      )}

      {mode === 'kernel' && (
        <div className="mt-3 grid gap-4 sm:grid-cols-[1fr_auto]">
          <div>
            <div className="mb-3 flex flex-wrap gap-1.5">
              {KERNELS.map((k) => (
                <button
                  key={k.id}
                  onClick={() => setKernel(k.id)}
                  className={`rounded-full px-3 py-1 text-xs transition ${
                    kernel === k.id ? 't-btn-primary' : 't-btn'
                  }`}
                >
                  {k.label}
                </button>
              ))}
            </div>
            <Slider label="强度" value={intensity} min={0} max={1} step={0.01} onChange={setIntensity} fmt={(v) => `${Math.round(v * 100)}%`} />
            <p className="t-faint mt-2 font-mono text-[11px] leading-relaxed">
              输出 = 原图 ×(1−强度) + 卷积结果 ×强度
            </p>
          </div>
          <KernelGrid k={activeKernel.k} div={activeKernel.div} />
        </div>
      )}

      {/* Inspector */}
      <div className="t-panel mt-3 rounded-lg p-3">
        {!hover ? (
          <p className="t-faint text-xs">把鼠标移到画面上，查看任意像素的 RGB 数值{mode === 'kernel' ? '和 3×3 邻域' : mode === 'adjust' ? '与逐阶段变换' : ''}。</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-[auto_1fr]">
            <div className="flex items-center gap-3">
              <div className="flex flex-col items-center gap-1">
                <Swatch r={sR} g={sG} b={sB} label="原图" />
                <span className="t-faint font-mono text-[10px] tabular-nums">
                  {sR},{sG},{sB}
                </span>
              </div>
              <span className="t-faint text-xs">→</span>
              <div className="flex flex-col items-center gap-1">
                <Swatch r={dR} g={dG} b={dB} label="输出" />
                <span className="t-faint font-mono text-[10px] tabular-nums">
                  {dR},{dG},{dB}
                </span>
              </div>
            </div>

            <div className="min-w-0">
              <div className="t-faint mb-1.5 font-mono text-[11px]">
                像素 ({hover.px}, {hover.py})
                {mode === 'pixels' && ` · 第 ${frameRef.current} 帧`}
              </div>

              {trace && (
                <div className="flex flex-wrap items-center gap-1.5">
                  {trace.map((st, i) => (
                    <div key={i} className="flex items-center gap-1.5">
                      {i > 0 && <span className="t-faint text-xs">›</span>}
                      <div className="flex flex-col items-center" title={st.label}>
                        <span
                          className="inline-block h-5 w-5 rounded border"
                          style={{
                            background: `rgb(${st.rgb[0]},${st.rgb[1]},${st.rgb[2]})`,
                            borderColor: 'var(--lb-border-soft)',
                          }}
                        />
                        <span className="t-faint mt-0.5 text-[9px] leading-none">{st.label}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {mode === 'kernel' && kernelSum && (
                <div>
                  <div className="mb-1.5 grid grid-cols-3 gap-0.5" style={{ width: 108 }}>
                    {neighbors.map((n, i) => {
                      const w = activeKernel.k[i]
                      const wCol =
                        w > 0 ? `rgba(0,113,227,${Math.min(0.9, 0.18 + w / 8)})` : w < 0 ? `rgba(225,29,72,${Math.min(0.9, 0.18 - w / 8)})` : 'transparent'
                      return (
                        <div
                          key={i}
                          className="relative flex items-center justify-center"
                          style={{
                            height: 34,
                            background: `rgb(${n.r},${n.g},${n.b})`,
                            outline: i === 4 ? '2px solid var(--lb-accent)' : 'none',
                            outlineOffset: -2,
                          }}
                          title={`邻居 ${i}: rgb(${n.r},${n.g},${n.b}) × ${w}${activeKernel.div !== 1 ? `/${activeKernel.div}` : ''}`}
                        >
                          <span
                            className="font-mono text-[9px] font-semibold"
                            style={{
                              color:
                                0.299 * n.r + 0.587 * n.g + 0.114 * n.b > 150 ? 'rgba(0,0,0,0.7)' : 'rgba(255,255,255,0.85)',
                              background: wCol,
                              borderRadius: 3,
                              padding: '0 2px',
                            }}
                          >
                            {w}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                  <p className="t-faint font-mono text-[10px] leading-relaxed">
                    Σ 邻居×权重 = ({Math.round(kernelSum.r)},{Math.round(kernelSum.g)},{Math.round(kernelSum.b)})
                    {activeKernel.div !== 1 ? ` /${activeKernel.div}` : ''}
                    {' → '}混合后 ({dR},{dG},{dB})
                  </p>
                </div>
              )}

              {mode === 'pixels' && (
                <p className="t-muted text-xs leading-relaxed">
                  这一个像素只有三个数。一帧 1080p 有约 200 万个这样的三元组；30 帧/秒的 10 秒视频，就是 18 亿个数。
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  fmt,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (v: number) => void
  fmt: (v: number) => string
}) {
  return (
    <label className="t-muted flex items-center gap-2 text-xs">
      <span className="w-14 shrink-0">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1"
      />
      <span className="t-strong w-12 text-right font-mono tabular-nums">{fmt(value)}</span>
    </label>
  )
}

function KernelGrid({ k, div }: { k: number[]; div: number }) {
  return (
    <div>
      <div className="t-faint mb-1 font-mono text-[10px]">3×3 卷积核</div>
      <div className="grid grid-cols-3 gap-0.5" style={{ width: 108 }}>
        {k.map((w, i) => (
          <div
            key={i}
            className="flex items-center justify-center rounded-[3px] font-mono text-[11px] tabular-nums"
            style={{
              height: 32,
              width: 34,
              background:
                w > 0
                  ? `rgba(0,113,227,${Math.min(0.85, 0.1 + w / 8)})`
                  : w < 0
                  ? `rgba(225,29,72,${Math.min(0.85, 0.1 - w / 8)})`
                  : 'var(--lb-panel-soft)',
              color: w > 0 ? '#0071e3' : w < 0 ? '#e11d48' : 'var(--lb-faint)',
              border: '1px solid var(--lb-border-soft)',
              fontWeight: i === 4 ? 700 : 400,
            }}
          >
            {w}
          </div>
        ))}
      </div>
      {div !== 1 && <div className="t-faint mt-1 text-right font-mono text-[10px]">÷ {div}</div>}
    </div>
  )
}

function Swatch({ r, g, b, label }: { r: number; g: number; b: number; label: string }) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span
        className="inline-block h-9 w-9 rounded-md border"
        style={{ background: `rgb(${r},${g},${b})`, borderColor: 'var(--lb-border-soft)' }}
      />
      <span className="t-faint text-[10px] leading-none">{label}</span>
    </div>
  )
}

export const VideoFilterWidget: WidgetDefinition<VideoFilterProps> = {
  type: 'video-filter',
  label: '视频滤镜',
  description: '逐像素拆解视频滤镜：帧与像素、亮度/对比度/饱和度/色相等点运算、3×3 卷积核（模糊/锐化/边缘）。',
  icon: '🎞️',
  defaultProps: {
    mode: 'adjust',
    brightness: 0,
    contrast: 1,
    saturation: 1,
    hue: 0,
    kernel: 'edge',
    intensity: 1,
    playing: true,
  },
  configSchema: [
    {
      key: 'mode',
      label: '模式',
      type: 'select',
      options: MODES.map((m) => ({ value: m.id, label: m.label })),
    },
    { key: 'brightness', label: '亮度', type: 'range', min: -0.5, max: 0.5, step: 0.01 },
    { key: 'contrast', label: '对比度', type: 'range', min: 0, max: 2, step: 0.01 },
    { key: 'saturation', label: '饱和度', type: 'range', min: 0, max: 2, step: 0.01 },
    { key: 'hue', label: '色相', type: 'range', min: -180, max: 180, step: 1, unit: '°' },
    {
      key: 'kernel',
      label: '卷积核',
      type: 'select',
      options: KERNELS.map((k) => ({ value: k.id, label: k.label })),
    },
    { key: 'intensity', label: '卷积强度', type: 'range', min: 0, max: 1, step: 0.01 },
    { key: 'playing', label: '自动播放', type: 'checkbox' },
  ],
  Component: VideoFilter,
}
