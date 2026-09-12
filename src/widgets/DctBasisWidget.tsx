import { useEffect, useRef, useState } from 'react'
import { prepareCanvas, palette } from '../lib/canvas'
import { useTheme } from '../lib/theme'
import { DCT_BASIS } from '../lib/dct'
import type { WidgetDefinition } from './registry'

interface DctBasisProps {
  select: number // 初始选中的基底，自然序 v*8+u（0 = 直流）
}

const W = 540
const H = 300
const GRID_X = 14
const GRID_Y = 26
const TILE = 30
const PITCH = 33
const BIG = 150
const BIG_X = 368
const BIG_Y = 34

// 基函数每行的峰值（c(0)=√(1/8)，其余 √(2/8)）：归一化用，否则两个基相乘最亮只有 0.25
const ROW_MAX = [Math.sqrt(1 / 8), ...new Array<number>(7).fill(Math.sqrt(2 / 8))]

function clamp255(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v
}

// 放大格用连续坐标求值（亚像素），条纹更平滑。归一化系数 c(u)·c(v) 与分母的
// 行峰值正好约掉，剩下的就是两个余弦的乘积，值域恰为 [−1, 1]。
function basisAt(u: number, v: number, xh: number, yh: number): number {
  return (
    Math.cos(((2 * xh + 1) * u * Math.PI) / 16) * Math.cos(((2 * yh + 1) * v * Math.PI) / 16)
  )
}

function describe(u: number, v: number): { stripes: string; plain: string; badge: string } {
  if (u === 0 && v === 0)
    return { stripes: '条纹：无（整块同色）', plain: '它记这一块的平均亮度', badge: '直流分量 DC' }
  if (v === 0)
    return {
      stripes: `条纹：${u} 组亮暗竖纹`,
      plain: `亮度沿水平方向起伏 ${u} 次`,
      badge: `交流 AC · 频率档位 ${u}`,
    }
  if (u === 0)
    return {
      stripes: `条纹：${v} 组亮暗横纹`,
      plain: `亮度沿垂直方向起伏 ${v} 次`,
      badge: `交流 AC · 频率档位 ${v}`,
    }
  return {
    stripes: `条纹：横 ${u} 组 · 纵 ${v} 组`,
    plain: '两个方向的波纹叠成网格',
    badge: `交流 AC · 档位 ${u}+${v}`,
  }
}

export function DctBasis({ props }: { props: DctBasisProps }) {
  const theme = useTheme()
  const [sel, setSel] = useState(props.select)
  useEffect(() => setSel(props.select), [props.select])
  const [hover, setHover] = useState<number | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const mosaicRef = useRef<HTMLCanvasElement | null>(null) // 64 块基底墙，烘焙一次
  const bigRef = useRef<HTMLCanvasElement | null>(null) // 放大格，按 sel 缓存
  const bigSelRef = useRef(-1)

  const draw = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = prepareCanvas(canvas, W, H)
    if (!ctx) return
    ctx.clearRect(0, 0, W, H)
    const P = palette()
    const bg = ctx.createLinearGradient(0, 0, 0, H)
    bg.addColorStop(0, P.bg)
    bg.addColorStop(1, P.bg2)
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, W, H)

    // ---- 基底墙（8×8 个 8×8 图案，每个图案 8 个逻辑像素放大到 30px）----
    if (!mosaicRef.current && typeof document !== 'undefined') {
      const m = document.createElement('canvas')
      m.width = 8 * PITCH
      m.height = 8 * PITCH
      const mc = m.getContext('2d')!
      const img = mc.createImageData(TILE, TILE)
      for (let v = 0; v < 8; v++) {
        for (let u = 0; u < 8; u++) {
          const d = img.data
          for (let py = 0; py < TILE; py++) {
            const sy = Math.min(7, ((py * 8) / TILE) | 0)
            for (let px = 0; px < TILE; px++) {
              const sx = Math.min(7, ((px * 8) / TILE) | 0)
              const t =
                (DCT_BASIS[v * 8 + sy] * DCT_BASIS[u * 8 + sx]) / (ROW_MAX[v] * ROW_MAX[u])
              const g = clamp255(Math.round((t + 1) * 127.5))
              const o = (py * TILE + px) * 4
              d[o] = g
              d[o + 1] = g
              d[o + 2] = g
              d[o + 3] = 255
            }
          }
          mc.putImageData(img, u * PITCH, v * PITCH)
        }
      }
      mosaicRef.current = m
    }

    ctx.fillStyle = P.muted
    ctx.font = '11px ui-monospace, monospace'
    ctx.fillText('DCT 字母表：64 个固定的 8×8 图案 · 悬停浏览，点击查看', GRID_X, 16)

    if (mosaicRef.current) {
      ctx.drawImage(mosaicRef.current, GRID_X, GRID_Y)
      for (let v = 0; v < 8; v++) {
        for (let u = 0; u < 8; u++) {
          ctx.strokeStyle = P.grid
          ctx.lineWidth = 1
          ctx.strokeRect(GRID_X + u * PITCH, GRID_Y + v * PITCH, TILE, TILE)
        }
      }
      if (hover !== null && hover !== sel) {
        const hu = hover % 8
        const hv = (hover / 8) | 0
        ctx.strokeStyle = P.accent
        ctx.lineWidth = 1.5
        ctx.strokeRect(GRID_X + hu * PITCH, GRID_Y + hv * PITCH, TILE, TILE)
      }
      const su = sel % 8
      const sv = (sel / 8) | 0
      ctx.save()
      ctx.shadowColor = P.glow
      ctx.shadowBlur = 6
      ctx.strokeStyle = P.accent
      ctx.lineWidth = 2
      ctx.strokeRect(GRID_X + su * PITCH, GRID_Y + sv * PITCH, TILE, TILE)
      ctx.restore()
      // 选中格 → 放大格 的连接线
      ctx.strokeStyle = P.ghost
      ctx.lineWidth = 1
      ctx.setLineDash([3, 3])
      ctx.beginPath()
      ctx.moveTo(GRID_X + su * PITCH + TILE, GRID_Y + sv * PITCH + TILE / 2)
      ctx.lineTo(BIG_X, BIG_Y + BIG / 2)
      ctx.stroke()
      ctx.setLineDash([])
    }
    ctx.fillStyle = P.faint
    ctx.font = '10px ui-monospace, monospace'
    ctx.fillText('u：横向频率 →　·　v：纵向频率 ↓', GRID_X, 298)

    // ---- 放大格：连续坐标逐像素求值 ----
    if (!bigRef.current && typeof document !== 'undefined') {
      const b = document.createElement('canvas')
      b.width = BIG
      b.height = BIG
      bigRef.current = b
    }
    if (bigRef.current && bigSelRef.current !== sel) {
      const bc = bigRef.current.getContext('2d')!
      const img = bc.createImageData(BIG, BIG)
      const d = img.data
      const u = sel % 8
      const v = (sel / 8) | 0
      for (let py = 0; py < BIG; py++) {
        const yh = ((py + 0.5) / BIG) * 8 - 0.5
        for (let px = 0; px < BIG; px++) {
          const xh = ((px + 0.5) / BIG) * 8 - 0.5
          const t = basisAt(u, v, xh, yh)
          const g = clamp255(Math.round((t + 1) * 127.5))
          const o = (py * BIG + px) * 4
          d[o] = g
          d[o + 1] = g
          d[o + 2] = g
          d[o + 3] = 255
        }
      }
      bc.putImageData(img, 0, 0)
      bigSelRef.current = sel
    }
    if (bigRef.current) {
      ctx.drawImage(bigRef.current, BIG_X, BIG_Y)
      ctx.strokeStyle = P.text
      ctx.lineWidth = 1.5
      ctx.strokeRect(BIG_X, BIG_Y, BIG, BIG)
    }

    const u = sel % 8
    const v = (sel / 8) | 0
    const info = describe(u, v)
    ctx.font = 'bold 13px ui-monospace, monospace'
    ctx.fillStyle = P.text
    ctx.fillText(`u = ${u}　v = ${v}`, BIG_X, BIG_Y + BIG + 22)
    ctx.font = '11px ui-monospace, monospace'
    ctx.fillStyle = P.muted
    ctx.fillText(info.stripes, BIG_X, BIG_Y + BIG + 40)
    ctx.fillStyle = P.muted
    ctx.fillText(info.plain, BIG_X, BIG_Y + BIG + 56)
    ctx.fillStyle = u === 0 && v === 0 ? P.accent : P.accent2
    ctx.fillText(info.badge, BIG_X, BIG_Y + BIG + 80)
  }

  useEffect(() => {
    draw()
  }, [sel, hover, theme])

  const hitTile = (e: React.PointerEvent<HTMLCanvasElement>): number | null => {
    const r = e.currentTarget.getBoundingClientRect()
    const mx = ((e.clientX - r.left) / r.width) * W
    const my = ((e.clientY - r.top) / r.height) * H
    if (mx < GRID_X || my < GRID_Y) return null
    const cx = ((mx - GRID_X) / PITCH) | 0
    const cy = ((my - GRID_Y) / PITCH) | 0
    if (cx > 7 || cy > 7) return null
    if (((mx - GRID_X) % PITCH) > TILE || ((my - GRID_Y) % PITCH) > TILE) return null // 缝隙
    return cy * 8 + cx
  }

  return (
    <div className="lb-surface">
      <canvas
        ref={canvasRef}
        className="touch-none"
        onPointerMove={(e) => {
          const t = hitTile(e)
          e.currentTarget.style.cursor = t === null ? 'default' : 'pointer'
          setHover((prev) => (prev === t ? prev : t))
        }}
        onPointerLeave={(e) => {
          e.currentTarget.style.cursor = 'default'
          setHover(null)
        }}
        onPointerDown={(e) => {
          const t = hitTile(e)
          if (t !== null) setSel(t)
        }}
        style={{ width: '100%', aspectRatio: `${W} / ${H}`, borderRadius: 8, touchAction: 'none' }}
      />
      <p className="t-faint mt-2 text-xs">
        从左上角的直流（整块平均亮度）走到右下角最细密的棋盘纹理，64 个图案由粗到细排好——任何一个 8×8
        图像块，都是这 64 个图案各乘一个系数再叠起来。
      </p>
    </div>
  )
}

export const DctBasisWidget: WidgetDefinition<DctBasisProps> = {
  type: 'dct-basis',
  label: 'DCT 基底',
  description: '64 个固定的余弦图案：点击任意基底，看它在 8×8 方块里长什么样——这就是 JPEG 的字母表。',
  icon: '▦',
  defaultProps: { select: 1 },
  configSchema: [{ key: 'select', label: '初始选中 (v×8+u)', type: 'range', min: 0, max: 63, step: 1 }],
  exportable: true,
  Component: DctBasis,
}
