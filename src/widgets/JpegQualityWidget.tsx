import { useEffect, useMemo, useRef, useState } from 'react'
import { prepareCanvas, palette } from '../lib/canvas'
import { useTheme } from '../lib/theme'
import { dct8, idct8, scaledQuantTable } from '../lib/dct'
import type { WidgetDefinition } from './registry'

interface JpegQualityProps {
  quality: number
  view: 'result' | 'error'
}

const W = 540
const H = 340
const N = 128 // 处理分辨率：16×16 = 256 个块，原图恰 16 KB（灰度每像素 1 字节）
const MAIN = 300
const MAIN_X = 16
const MAIN_Y = 26
const ZOOM_SRC = 32
const ZOOM = 160
const ZOOM_X = 348
const ZOOM_Y = 26

const VIEWS = [
  { id: 'result', label: '压缩结果' },
  { id: 'error', label: '误差 ×8' },
] as const
type ViewId = (typeof VIEWS)[number]['id']

// 确定性测试图：渐变天空（纯低频）+ 硬边太阳 + 山脊斜线 + 大字「压」（锐利笔画 = 丰富高频）
function drawScene(ctx: CanvasRenderingContext2D) {
  const sky = ctx.createLinearGradient(0, 0, 0, 90)
  sky.addColorStop(0, '#ececec')
  sky.addColorStop(1, '#8f8f8f')
  ctx.fillStyle = sky
  ctx.fillRect(0, 0, N, 90)
  ctx.fillStyle = '#f8f8f8'
  ctx.beginPath()
  ctx.arc(93, 30, 13, 0, Math.PI * 2)
  ctx.fill()
  // 字形在平台间略有差异，演示对每台机器自洽
  ctx.font = "bold 46px 'PingFang SC','Microsoft YaHei','Noto Sans SC',system-ui,sans-serif"
  ctx.textBaseline = 'top'
  ctx.fillStyle = '#1e1e1e'
  ctx.fillText('压', 8, 6)
  ctx.fillStyle = '#3d3d3d'
  ctx.beginPath()
  ctx.moveTo(0, 90)
  ctx.lineTo(26, 62)
  ctx.lineTo(48, 88)
  ctx.lineTo(72, 52)
  ctx.lineTo(100, 92)
  ctx.lineTo(N, 74)
  ctx.lineTo(N, N)
  ctx.lineTo(0, N)
  ctx.closePath()
  ctx.fill()
}

function sceneLuma(): Float64Array {
  const c = document.createElement('canvas')
  c.width = N
  c.height = N
  const ctx = c.getContext('2d', { willReadFrequently: true })!
  drawScene(ctx)
  const d = ctx.getImageData(0, 0, N, N).data
  const luma = new Float64Array(N * N)
  for (let i = 0; i < N * N; i++) luma[i] = d[i * 4]
  // 底部草地带：确定性白噪声 = 最高频成分，量化第一个杀它
  for (let y = 104; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453
      const n = (s - Math.floor(s)) * 2 - 1
      luma[y * N + x] = 96 + 26 * n
    }
  }
  return luma
}

interface CompressResult {
  recon: Float64Array
  nonzero: number
  estBits: number
  mse: number
}

function compress(orig: Float64Array, table: Float64Array): CompressResult {
  const recon = new Float64Array(orig.length)
  const f = new Float64Array(64)
  const F = new Float64Array(64)
  let nonzero = 0
  let estBits = 0
  for (let by = 0; by < N / 8; by++) {
    for (let bx = 0; bx < N / 8; bx++) {
      const base = by * 8 * N + bx * 8
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) f[y * 8 + x] = orig[base + y * N + x] - 128
      }
      dct8(f, F)
      for (let i = 0; i < 64; i++) {
        const q = Math.round(F[i] / table[i])
        if (q !== 0) {
          nonzero++
          // 熵编码粗估：幅值类别位 + 1 符号位 + ~2 前缀位
          estBits += Math.ceil(Math.log2(Math.abs(q) + 1)) + 3
        }
        F[i] = q * table[i]
      }
      estBits += 4 // EOB：后面全是 0
      idct8(F, f)
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
          const v = f[y * 8 + x] + 128
          recon[base + y * N + x] = v < 0 ? 0 : v > 255 ? 255 : v
        }
      }
    }
  }
  let mse = 0
  for (let i = 0; i < orig.length; i++) {
    const e = orig[i] - recon[i]
    mse += e * e
  }
  mse /= orig.length
  return { recon, nonzero, estBits, mse }
}

export function JpegQuality({ props }: { props: JpegQualityProps }) {
  const theme = useTheme()
  const [quality, setQuality] = useState(props.quality)
  const [view, setView] = useState<ViewId>(props.view)
  useEffect(() => setQuality(props.quality), [props.quality])
  useEffect(() => setView(props.view), [props.view])
  const [showOriginal, setShowOriginal] = useState(false)
  const [zoom, setZoom] = useState({ x: 10, y: 6 }) // 默认对准「压」的笔画
  const draggingRef = useRef(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const origRef = useRef<Float64Array | null>(null)
  const workRef = useRef<HTMLCanvasElement | null>(null)

  const getOrig = () => {
    if (!origRef.current) origRef.current = sceneLuma()
    return origRef.current
  }

  const result = useMemo(() => compress(getOrig(), scaledQuantTable(quality)), [quality])
  const psnr = result.mse > 0 ? 10 * Math.log10((255 * 255) / result.mse) : Infinity
  const estKb = result.estBits / 8 / 1024

  const draw = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = prepareCanvas(canvas, W, H)
    if (!ctx) return
    ctx.clearRect(0, 0, W, H)
    const P = palette()
    const orig = getOrig()

    const bg = ctx.createLinearGradient(0, 0, 0, H)
    bg.addColorStop(0, P.bg)
    bg.addColorStop(1, P.bg2)
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, W, H)

    // ---- 128×128 工作缓冲：重建图 / 误差图 / 原图 ----
    if (!workRef.current && typeof document !== 'undefined') {
      const w = document.createElement('canvas')
      w.width = N
      w.height = N
      workRef.current = w
    }
    if (workRef.current) {
      const wc = workRef.current.getContext('2d')!
      const img = wc.createImageData(N, N)
      const d = img.data
      for (let i = 0; i < N * N; i++) {
        let v: number
        if (showOriginal) v = orig[i]
        else if (view === 'error') v = Math.min(255, Math.abs(orig[i] - result.recon[i]) * 8)
        else v = result.recon[i]
        const o = i * 4
        d[o] = v
        d[o + 1] = v
        d[o + 2] = v
        d[o + 3] = 255
      }
      wc.putImageData(img, 0, 0)

      ctx.fillStyle = P.muted
      ctx.font = '11px ui-monospace, monospace'
      ctx.fillText(
        showOriginal
          ? '原图（128×128 灰度 = 16 KB）'
          : view === 'error'
            ? '误差图 ×8：亮 = 被量化扔掉的'
            : `压缩结果 q = ${quality}`,
        MAIN_X,
        16,
      )
      ctx.imageSmoothingEnabled = true
      ctx.drawImage(workRef.current, MAIN_X, MAIN_Y, MAIN, MAIN)
      ctx.strokeStyle = P.text
      ctx.lineWidth = 1
      ctx.strokeRect(MAIN_X - 0.5, MAIN_Y - 0.5, MAIN + 1, MAIN + 1)

      // 4× 放大：关平滑，让 8×8 块边界与振铃原形毕露
      ctx.imageSmoothingEnabled = false
      ctx.drawImage(workRef.current, zoom.x, zoom.y, ZOOM_SRC, ZOOM_SRC, ZOOM_X, ZOOM_Y, ZOOM, ZOOM)
      ctx.imageSmoothingEnabled = true
      ctx.strokeStyle = P.text
      ctx.lineWidth = 1.5
      ctx.strokeRect(ZOOM_X - 0.5, ZOOM_Y - 0.5, ZOOM + 1, ZOOM + 1)
      ctx.fillStyle = P.faint
      ctx.font = '10px ui-monospace, monospace'
      ctx.fillText('放大 4×（无插值）', ZOOM_X, ZOOM_Y + ZOOM + 14)
      ctx.fillText('拖主图上的蓝框换位置', ZOOM_X, ZOOM_Y + ZOOM + 28)

      // 主图上的缩放框
      const s = MAIN / N
      ctx.strokeStyle = P.accent
      ctx.lineWidth = 1.5
      ctx.strokeRect(MAIN_X + zoom.x * s, MAIN_Y + zoom.y * s, ZOOM_SRC * s, ZOOM_SRC * s)
    }
  }

  useEffect(() => {
    draw()
  }, [result, view, showOriginal, zoom, quality, theme])

  const updateZoom = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const mx = ((e.clientX - r.left) / r.width) * W
    const my = ((e.clientY - r.top) / r.height) * H
    const gx = (mx - MAIN_X) / MAIN
    const gy = (my - MAIN_Y) / MAIN
    if (gx < 0 || gx > 1 || gy < 0 || gy > 1) return
    const zx = Math.max(0, Math.min(N - ZOOM_SRC, Math.round(gx * N - ZOOM_SRC / 2)))
    const zy = Math.max(0, Math.min(N - ZOOM_SRC, Math.round(gy * N - ZOOM_SRC / 2)))
    setZoom((prev) => (prev.x === zx && prev.y === zy ? prev : { x: zx, y: zy }))
  }

  const inMain = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const mx = ((e.clientX - r.left) / r.width) * W
    const my = ((e.clientY - r.top) / r.height) * H
    return mx >= MAIN_X && mx < MAIN_X + MAIN && my >= MAIN_Y && my < MAIN_Y + MAIN
  }

  return (
    <div className="lb-surface">
      <canvas
        ref={canvasRef}
        className="touch-none"
        onPointerDown={(e) => {
          if (!inMain(e)) return
          draggingRef.current = true
          e.currentTarget.setPointerCapture(e.pointerId)
          updateZoom(e)
        }}
        onPointerMove={(e) => {
          e.currentTarget.style.cursor = inMain(e) ? 'crosshair' : 'default'
          if (draggingRef.current) updateZoom(e)
        }}
        onPointerUp={() => {
          draggingRef.current = false
        }}
        onPointerCancel={() => {
          draggingRef.current = false
        }}
        onPointerLeave={(e) => {
          e.currentTarget.style.cursor = 'default'
        }}
        style={{ width: '100%', aspectRatio: `${W} / ${H}`, borderRadius: 8, touchAction: 'none' }}
      />

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <div className="t-panel inline-flex rounded-lg p-0.5">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              onClick={() => setView(v.id)}
              className={`rounded-[6px] px-3 py-1 text-xs font-medium transition ${
                view === v.id && !showOriginal ? 't-btn-primary' : 't-muted'
              }`}
            >
              {v.label}
            </button>
          ))}
        </div>
        <button
          onPointerDown={() => setShowOriginal(true)}
          onPointerUp={() => setShowOriginal(false)}
          onPointerLeave={() => setShowOriginal(false)}
          onPointerCancel={() => setShowOriginal(false)}
          className={`t-btn rounded-md px-3 py-1.5 text-sm select-none ${showOriginal ? 't-btn-primary' : ''}`}
        >
          按住显示原图
        </button>
      </div>

      <label className="t-muted mt-3 flex items-center gap-2 text-xs">
        <span className="w-16 shrink-0">质量 q</span>
        <input
          type="range"
          min={1}
          max={100}
          step={1}
          value={quality}
          onChange={(e) => setQuality(Number(e.target.value))}
          className="flex-1"
        />
        <span className="t-strong w-14 text-right font-mono tabular-nums">{quality}</span>
      </label>

      <div className="mt-3 flex flex-wrap items-center gap-2 font-mono text-[11px] tabular-nums">
        <span className="t-panel rounded-full px-3 py-1">
          非零系数 {result.nonzero.toLocaleString()} / 16,384 ·{' '}
          {((result.nonzero / 16384) * 100).toFixed(1)}%
        </span>
        <span className="t-panel rounded-full px-3 py-1">
          估算码流 ≈ {estKb.toFixed(1)} KB（原图 16 KB）
        </span>
        <span className="t-panel rounded-full px-3 py-1">
          PSNR {Number.isFinite(psnr) ? `${psnr.toFixed(1)} dB` : '> 60 dB'}
        </span>
      </div>

      <p className="t-faint mt-2 text-xs">
        每个系数按「幅值类别 + 符号 + 前缀」估算熵编码比特，零系数几乎不花钱——这是码流估算而非真实文件大小，但两者的走势一致。
      </p>
    </div>
  )
}

export const JpegQualityWidget: WidgetDefinition<JpegQualityProps> = {
  type: 'jpeg-quality',
  label: 'JPEG 质量滑块',
  description:
    '拖动质量滑块，看整张图被逐块压缩：非零系数、估算码流、PSNR 与误差图同步变化，放大 4× 还能抓到块效应。',
  icon: '🗜️',
  defaultProps: { quality: 75, view: 'result' },
  configSchema: [
    { key: 'quality', label: '质量 q', type: 'range', min: 1, max: 100, step: 1 },
    {
      key: 'view',
      label: '视图',
      type: 'select',
      options: VIEWS.map((v) => ({ value: v.id, label: v.id === 'result' ? '压缩结果' : '误差（×8）' })),
    },
  ],
  exportable: true,
  Component: JpegQuality,
}
