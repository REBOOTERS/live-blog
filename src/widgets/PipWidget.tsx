import { useEffect, useRef, useState } from 'react'
import { useAnimationFrame } from '../lib/useAnimationFrame'
import { prepareCanvas, palette } from '../lib/canvas'
import { useTheme } from '../lib/theme'
import type { WidgetDefinition } from './registry'

// Logical size of the "video"; the canvas is scaled crisply to whatever slot
// it lives in (inline card or floating mini-window) by prepareCanvas.
const VW = 480
const VH = 270
const DURATION = 220 // 3:40

interface PipProps {
  mode: 'video' | 'document'
  autoStart: boolean
}

const CAPTIONS = [
  '大家好，欢迎来到今天的发布会',
  '接下来给大家演示画中画功能',
  '注意看右下角的小窗口',
  '它始终浮在所有内容之上',
  '这就是文档画中画的威力',
  '我们下个版本再见',
]

function fmtTime(s: number): string {
  const m = Math.floor(s / 60)
  const ss = Math.floor(s % 60)
  return `${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

// A self-contained "video" scene. Drawn dark regardless of page theme because
// a video player surface is conventionally dark media chrome; only the accent
// follows the theme.
function drawScene(
  ctx: CanvasRenderingContext2D,
  t: number,
  playing: boolean,
  accent: string,
  progress: number,
) {
  const g = ctx.createLinearGradient(0, 0, 0, VH)
  g.addColorStop(0, '#223b5c')
  g.addColorStop(1, '#0b1622')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, VW, VH)

  const spot = ctx.createRadialGradient(VW / 2, VH * 0.5, 10, VW / 2, VH * 0.5, 200)
  spot.addColorStop(0, 'rgba(96,165,250,0.18)')
  spot.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = spot
  ctx.fillRect(0, 0, VW, VH)

  const cx = VW / 2
  const cy = VH * 0.42

  // speaker silhouette
  ctx.fillStyle = 'rgba(255,255,255,0.10)'
  ctx.beginPath()
  ctx.ellipse(cx, cy + 78, 96, 44, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = 'rgba(255,255,255,0.22)'
  ctx.beginPath()
  ctx.arc(cx, cy, 40, 0, Math.PI * 2)
  ctx.fill()

  // waveform
  const bars = 26
  const bw = 4
  const gap = 6
  const total = bars * (bw + gap) - gap
  const sx = (VW - total) / 2
  const by = VH * 0.74
  ctx.fillStyle = 'rgba(125,200,255,0.82)'
  for (let i = 0; i < bars; i++) {
    const h = playing ? 8 + 30 * (0.5 + 0.5 * Math.sin(t * 6 + i * 0.55)) : 8
    roundRect(ctx, sx + i * (bw + gap), by - h / 2, bw, h, 2)
    ctx.fill()
  }

  // progress
  const py = VH - 13
  ctx.fillStyle = 'rgba(255,255,255,0.18)'
  ctx.fillRect(0, py, VW, 3)
  ctx.fillStyle = accent
  ctx.fillRect(0, py, VW * progress, 3)

  // chrome text
  ctx.fillStyle = 'rgba(255,255,255,0.9)'
  ctx.font = '600 12px -apple-system, "PingFang SC", sans-serif'
  ctx.textAlign = 'left'
  ctx.fillText('● 直播中 · 产品发布会', 12, 22)
  ctx.font = '600 11px ui-monospace, monospace'
  ctx.fillStyle = 'rgba(255,255,255,0.78)'
  ctx.fillText(`${fmtTime(progress * DURATION)} / 03:40`, 12, py - 5)

  if (!playing) {
    ctx.fillStyle = 'rgba(0,0,0,0.38)'
    ctx.fillRect(0, 0, VW, VH)
    ctx.fillStyle = 'rgba(255,255,255,0.95)'
    ctx.beginPath()
    ctx.moveTo(cx - 16, cy - 20)
    ctx.lineTo(cx - 16, cy + 20)
    ctx.lineTo(cx + 22, cy)
    ctx.closePath()
    ctx.fill()
  }
}

export function Pip({ props }: { props: PipProps }) {
  useTheme()
  const [mode, setMode] = useState<PipProps['mode']>(props.mode)
  const [pip, setPip] = useState(props.autoStart)
  const [playing, setPlaying] = useState(true)
  const [captions, setCaptions] = useState(true)
  const [dragged, setDragged] = useState(false)
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const [realMsg, setRealMsg] = useState('')
  const [tick, setTick] = useState(0)

  const stageRef = useRef<HTMLDivElement>(null)
  const inlineSlotRef = useRef<HTMLDivElement>(null)
  const floatSlotRef = useRef<HTMLDivElement>(null)
  const floatRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const tRef = useRef(0)
  const dragRef = useRef<{ dx: number; dy: number } | null>(null)
  const enteredAtRef = useRef<number>(Date.now())

  useEffect(() => setMode(props.mode), [props.mode])
  useEffect(() => setPip(props.autoStart), [props.autoStart])

  // Create the single canvas once and park it in whichever slot is active.
  // This mirrors what the real Document PiP API does: you move an existing
  // element into the PiP window's document rather than recreating it.
  useEffect(() => {
    if (!canvasRef.current) {
      const c = document.createElement('canvas')
      c.style.width = '100%'
      c.style.display = 'block'
      c.style.aspectRatio = `${VW} / ${VH}`
      c.style.touchAction = 'none'
      canvasRef.current = c
    }
    const slot = (pip ? floatSlotRef.current : inlineSlotRef.current) ?? null
    const c = canvasRef.current
    if (slot && c && c.parentElement !== slot) slot.appendChild(c)
  }, [pip])

  useEffect(() => () => canvasRef.current?.remove(), [])

  useEffect(() => {
    if (pip) enteredAtRef.current = Date.now()
  }, [pip])

  useEffect(() => {
    const id = window.setInterval(() => setTick((n) => (n + 1) % 1_000_000), 1000)
    return () => window.clearInterval(id)
  }, [])

  useAnimationFrame((dt) => {
    if (playing) tRef.current += dt
    const c = canvasRef.current
    if (!c) return
    const ctx = prepareCanvas(c, VW, VH)
    if (!ctx) return
    const P = palette()
    const progress = playing ? (tRef.current % DURATION) / DURATION : 0.15
    drawScene(ctx, tRef.current, playing, P.accent, progress)
  })

  const onHeaderDown = (e: React.PointerEvent) => {
    const stage = stageRef.current
    const f = floatRef.current
    if (!stage || !f) return
    const sr = stage.getBoundingClientRect()
    const fr = f.getBoundingClientRect()
    dragRef.current = { dx: e.clientX - fr.left, dy: e.clientY - fr.top }
    setPos({ x: Math.max(0, fr.left - sr.left), y: Math.max(0, fr.top - sr.top) })
    setDragged(true)
    ;(e.target as Element).setPointerCapture(e.pointerId)
  }
  const onHeaderMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return
    const stage = stageRef.current
    const f = floatRef.current
    if (!stage || !f) return
    const sr = stage.getBoundingClientRect()
    const w = f.offsetWidth
    const h = f.offsetHeight
    const { dx, dy } = dragRef.current
    const x = Math.max(0, Math.min(sr.width - w, e.clientX - sr.left - dx))
    const y = Math.max(0, Math.min(sr.height - h, e.clientY - sr.top - dy))
    setPos({ x, y })
  }
  const onHeaderUp = (e: React.PointerEvent) => {
    dragRef.current = null
    try {
      ;(e.target as Element).releasePointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
  }

  const openRealPip = async () => {
    const api = (window as unknown as { documentPictureInPicture?: { requestWindow: (o?: { width?: number; height?: number }) => Promise<Window> } })
      .documentPictureInPicture
    if (!api) {
      setRealMsg('当前浏览器不支持文档画中画 API（需要 Chrome/Edge 116+）。')
      return
    }
    setRealMsg('正在请求真实的置顶窗口……')
    try {
      const pipWin = await api.requestWindow({ width: 380, height: 290 })
      const doc = pipWin.document
      doc.body.style.margin = '0'
      doc.body.style.background = '#0b1622'
      doc.body.style.fontFamily =
        '-apple-system, "PingFang SC", "Microsoft YaHei", sans-serif'
      // Copy stylesheets so theme tokens / fonts carry into the PiP document.
      document.querySelectorAll('style, link[rel="stylesheet"]').forEach((el) => {
        doc.head.appendChild(el.cloneNode(true))
      })

      const wrap = doc.createElement('div')
      wrap.style.display = 'flex'
      wrap.style.flexDirection = 'column'
      wrap.style.height = '100vh'
      wrap.style.color = '#e2e8f0'
      const head = doc.createElement('div')
      head.style.padding = '6px 10px'
      head.style.fontSize = '12px'
      head.style.background = 'rgba(255,255,255,0.06)'
      head.style.display = 'flex'
      head.style.justifyContent = 'space-between'
      head.style.alignItems = 'center'
      head.innerHTML = '<span>📺 真实画中画窗口</span><span style="opacity:.6">可拖动 · 可缩放</span>'
      const cv = doc.createElement('canvas')
      cv.width = VW * (pipWin.devicePixelRatio || 1)
      cv.height = VH * (pipWin.devicePixelRatio || 1)
      cv.style.width = '100%'
      cv.style.aspectRatio = `${VW} / ${VH}`
      cv.style.display = 'block'
      const ctx = cv.getContext('2d')!
      ctx.scale(pipWin.devicePixelRatio || 1, pipWin.devicePixelRatio || 1)
      const bar = doc.createElement('div')
      bar.style.display = 'flex'
      bar.style.gap = '8px'
      bar.style.padding = '8px 10px'
      bar.style.alignItems = 'center'
      const playBtn = doc.createElement('button')
      playBtn.textContent = '⏸'
      playBtn.style.cssText =
        'cursor:pointer;border:none;border-radius:6px;background:rgba(255,255,255,0.12);color:#fff;width:30px;height:28px;font-size:13px'
      const cap = doc.createElement('span')
      cap.style.fontSize = '12px'
      cap.style.opacity = '0.8'
      cap.textContent = '这个窗口浮在所有应用之上。'
      bar.append(playBtn, cap)
      wrap.append(head, cv, bar)
      doc.body.append(wrap)

      let playing = true
      let t = 0
      let raf = 0
      const accent = palette().accent
      const loop = () => {
        if (playing) t += 1 / 60
        drawScene(ctx, t, playing, accent, (t % DURATION) / DURATION)
        raf = pipWin.requestAnimationFrame(loop)
      }
      loop()
      playBtn.onclick = () => {
        playing = !playing
        playBtn.textContent = playing ? '⏸' : '▶'
      }
      pipWin.addEventListener('pagehide', () => pipWin.cancelAnimationFrame(raf))
      setRealMsg('已打开——切到其他窗口看看，它始终浮在最上面。')
    } catch (e) {
      setRealMsg(`打开失败：${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const elapsed = Math.max(0, Math.floor((Date.now() - enteredAtRef.current) / 1000))
  const caption = CAPTIONS[Math.floor(tick / 3) % CAPTIONS.length]
  const supported =
    typeof window !== 'undefined' &&
    !!(window as unknown as { documentPictureInPicture?: unknown }).documentPictureInPicture

  const code =
    mode === 'video'
      ? `const video = document.querySelector('video')\nawait video.requestPictureInPicture()\n// 只能是一个 <video>，控件是浏览器给的`
      : `const pip = await documentPictureInPicture\n  .requestWindow({ width: 380, height: 270 })\n// 把任意 DOM 搬进这个窗口：\npip.document.body.append(playerElement)`

  return (
    <div className="lb-surface">
      <div
        ref={stageRef}
        className="relative overflow-hidden rounded-xl border"
        style={{ height: 384, borderColor: 'var(--lb-border-soft)', background: 'var(--lb-bg-2)' }}
      >
        {/* mock browser chrome */}
        <div
          className="flex h-9 items-center gap-1.5 border-b px-3"
          style={{ borderColor: 'var(--lb-border-soft)', background: 'var(--lb-panel)' }}
        >
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: '#ff5f57' }} />
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: '#febc2e' }} />
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: '#28c840' }} />
          <span
            className="t-faint ml-3 rounded px-2 py-0.5 font-mono text-[11px]"
            style={{ background: 'var(--lb-surface-bg)' }}
          >
            https://live.blog/pip
          </span>
        </div>

        {/* scrollable page */}
        <div className="overflow-y-auto" style={{ height: 'calc(100% - 36px)' }}>
          <div className="p-4">
            <h3 className="text-[17px] font-semibold" style={{ color: 'var(--lb-text-heading)' }}>
              一篇正在看的文章
            </h3>
            <p className="t-muted mt-2 text-[13px] leading-relaxed">
              画中画最迷人的地方在于：你不需要在「看视频」和「干别的」之间二选一。视频被收进一个小窗口，
              钉在屏幕一角，而你照常滚动、打字、查资料。这一页就是你「干别的」的地方——试着往下滚。
            </p>

            <div
              className="mt-3 overflow-hidden rounded-lg border"
              style={{ borderColor: 'var(--lb-border-soft)', background: '#0b1622' }}
            >
              <div ref={inlineSlotRef} />
              <div
                className="flex items-center gap-2 px-2.5 py-2"
                style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}
              >
                <button
                  onClick={() => setPlaying((v) => !v)}
                  className="rounded-md px-2 py-1 text-[12px] text-white/90"
                  style={{ background: 'rgba(255,255,255,0.12)' }}
                >
                  {playing ? '⏸ 暂停' : '▶ 播放'}
                </button>
                <button
                  onClick={() => setPip((v) => !v)}
                  className="t-btn-primary rounded-md px-2.5 py-1 text-[12px] font-medium"
                >
                  {pip ? '↙ 放回页面' : '📐 开启画中画'}
                </button>
                <span className="ml-auto font-mono text-[11px] text-white/55">
                  {pip ? '视频已脱离到小窗' : '内嵌在文章中'}
                </span>
              </div>
            </div>

            <p className="t-muted mt-3 text-[13px] leading-relaxed">
              注意看：当你开启画中画，视频卡片并没有「复制」一份——原来的那块画布被整个搬进了右下角的小窗，
              动画一秒都没断。真实的文档画中画也是这么做的：把一个已存在的 DOM 元素，追加到新窗口的 body 里。
            </p>
            <p className="t-muted mt-2 text-[13px] leading-relaxed">
              你可以拖着小窗的标题栏在这个区域里移动，它始终浮在文章上方。现实里，它浮在所有应用窗口之上——
              那是操作系统给的特权，z-index 再大也跨不出浏览器这一页。
            </p>
            <p className="t-muted mt-2 text-[13px] leading-relaxed">
              继续滚，继续读。这才是画中画的意义：它不打断你，只是赖在视野的角落里。
            </p>
            <div style={{ height: 40 }} />
          </div>
        </div>

        {/* floating mini-window */}
        {pip && (
          <div
            ref={floatRef}
            className="absolute select-none overflow-hidden rounded-lg border shadow-2xl"
            style={
              dragged
                ? { left: pos.x, top: pos.y, right: 'auto', bottom: 'auto', width: 248, borderColor: 'var(--lb-border)', background: '#0b1622' }
                : { right: 10, bottom: 10, width: 248, borderColor: 'var(--lb-border)', background: '#0b1622' }
            }
          >
            <div
              onPointerDown={onHeaderDown}
              onPointerMove={onHeaderMove}
              onPointerUp={onHeaderUp}
              onPointerCancel={onHeaderUp}
              className="flex cursor-grab items-center gap-1.5 px-2 py-1.5 active:cursor-grabbing"
              style={{ background: 'rgba(255,255,255,0.06)', touchAction: 'none' }}
            >
              <span className="text-[10px]">📌</span>
              <span className="text-[11px] font-medium text-white/85">画中画</span>
              <span className="ml-auto text-[10px] text-white/40">拖动</span>
              <button
                onClick={() => setPip(false)}
                className="flex h-4 w-4 items-center justify-center rounded text-white/70 hover:bg-white/15"
                title="关闭（这个按钮页面无法移除）"
              >
                ✕
              </button>
            </div>
            <div ref={floatSlotRef} />
            <div className="flex items-center gap-1.5 px-2 py-1.5">
              <button
                onClick={() => setPlaying((v) => !v)}
                className="rounded-md px-1.5 py-0.5 text-[11px] text-white/90"
                style={{ background: 'rgba(255,255,255,0.12)' }}
              >
                {playing ? '⏸' : '▶'}
              </button>
              <span className="font-mono text-[10px] text-white/55">
                {fmtTime((playing ? tRef.current % DURATION : 0.15 * DURATION))} / 03:40
              </span>
              {mode === 'document' && (
                <span className="ml-auto rounded px-1.5 py-0.5 text-[10px] text-white/70"
                  style={{ background: 'rgba(0,113,227,0.35)' }}>
                  {fmtTime(elapsed)}
                </span>
              )}
            </div>
            {mode === 'document' && (
              <div className="border-t border-white/10 px-2 py-1.5">
                {captions && (
                  <p className="text-[11px] leading-snug text-white/80">
                    <span className="text-white/40">字幕 </span>
                    {caption}
                  </p>
                )}
                <div className="mt-1 flex items-center gap-2 text-[10px] text-white/50">
                  <span>🎙 你</span>
                  <span>·</span>
                  <span>12 人在线</span>
                  <button
                    onClick={() => setCaptions((v) => !v)}
                    className="ml-auto rounded px-1.5 py-0.5 text-white/60 hover:bg-white/10"
                  >
                    {captions ? '隐藏字幕' : '显示字幕'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* controls */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <div className="t-panel inline-flex rounded-lg p-0.5">
          {(['video', 'document'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`rounded-[6px] px-3 py-1 text-xs font-medium transition ${
                mode === m ? 't-btn-primary' : 't-muted'
              }`}
            >
              {m === 'video' ? '视频画中画' : '文档画中画'}
            </button>
          ))}
        </div>
        <button
          onClick={() => setPip((v) => !v)}
          className="t-btn-primary rounded-md px-3 py-1.5 text-sm"
        >
          {pip ? '退出画中画' : '进入画中画'}
        </button>
        {pip && dragged && (
          <button
            onClick={() => setDragged(false)}
            className="t-btn rounded-md px-3 py-1.5 text-xs"
          >
            ↺ 归位右下角
          </button>
        )}
        <button
          onClick={openRealPip}
          className="t-btn rounded-md px-3 py-1.5 text-xs"
          title={supported ? '调用 documentPictureInPicture 打开真实置顶窗口' : '需要 Chromium 浏览器'}
        >
          🪟 真实窗口{supported ? '' : '（不支持）'}
        </button>
      </div>

      <pre
        className="mt-3 overflow-x-auto rounded-lg p-3 font-mono text-[11.5px] leading-relaxed"
        style={{ background: 'var(--lb-code-bg)', color: '#c9d1d9', border: '1px solid var(--lb-code-border)' }}
      >
        {code}
      </pre>

      {realMsg && <p className="t-muted mt-2 text-xs">{realMsg}</p>}

      <p className="t-muted mt-2 text-xs leading-relaxed">
        {mode === 'video'
          ? '视频画中画只能装一个 <video>，播放控件由浏览器提供，页面改不了——它最省事，也最不自由。'
          : '文档画中画能装任意 HTML：自定义控件、字幕、参与人列表、计时器……这个小窗里除了视频，全是你自己写的 DOM。'}
      </p>
    </div>
  )
}

export const PipWidget: WidgetDefinition<PipProps> = {
  type: 'pip',
  label: '画中画',
  description:
    '模拟一个可拖拽的置顶小窗，对比视频画中画与文档画中画两套 API；支持的浏览器可直接打开真实置顶窗口。',
  icon: '📺',
  defaultProps: {
    mode: 'document',
    autoStart: true,
  },
  configSchema: [
    {
      key: 'mode',
      label: '画中画类型',
      type: 'select',
      options: [
        { value: 'video', label: '视频画中画' },
        { value: 'document', label: '文档画中画' },
      ],
    },
    { key: 'autoStart', label: '加载后自动进入画中画', type: 'checkbox' },
  ],
  Component: Pip,
}
