import { toCanvas } from 'html-to-image'

/** MediaRecorder 候选格式：优先 MP4（H.264），浏览器不支持时回退 WebM。 */
export const RECORDER_MIME_CANDIDATES = [
  'video/mp4;codecs=avc1.42E01E',
  'video/mp4;codecs=avc1',
  'video/mp4',
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
]

export function pickRecorderMime(): string | null {
  if (typeof MediaRecorder === 'undefined') return null
  for (const mime of RECORDER_MIME_CANDIDATES) {
    if (MediaRecorder.isTypeSupported(mime)) return mime
  }
  return null
}

let supportedCache: boolean | null = null

export function isCanvasRecordingSupported(): boolean {
  if (supportedCache == null) {
    supportedCache =
      typeof MediaRecorder !== 'undefined' &&
      typeof HTMLCanvasElement !== 'undefined' &&
      typeof HTMLCanvasElement.prototype.captureStream === 'function' &&
      pickRecorderMime() !== null
  }
  return supportedCache
}

export interface RecordResult {
  blob: Blob
  mime: string
  ext: 'mp4' | 'webm'
}

export interface RecordHandle {
  result: Promise<RecordResult>
  stop(): void
}

/** 共享录制骨架：MediaRecorder 从 stream 收集分片，返回可提前停止的句柄。 */
function startRecorder(stream: MediaStream, mime: string, bitsPerSecond: number): RecordHandle {
  const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: bitsPerSecond })
  const chunks: Blob[] = []
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data)
  }

  let stopped = false
  const stop = () => {
    if (stopped) return
    stopped = true
    if (recorder.state !== 'inactive') recorder.stop()
  }

  const result = new Promise<RecordResult>((resolve, reject) => {
    recorder.onerror = () => reject(new Error('Recording failed'))
    recorder.onstop = () => {
      try {
        resolve({ blob: new Blob(chunks, { type: mime }), mime, ext: mime.includes('mp4') ? 'mp4' : 'webm' })
      } finally {
        stream.getTracks().forEach((t) => t.stop())
      }
    }
    recorder.start(250)
  })

  return { result, stop }
}

export function recordCanvas(
  canvas: HTMLCanvasElement,
  opts: { durationSec: number; fps?: number; bitsPerSecond?: number },
): RecordHandle {
  const mime = pickRecorderMime()
  if (!mime) throw new Error('MediaRecorder is not supported')
  const handle = startRecorder(canvas.captureStream(opts.fps ?? 30), mime, opts.bitsPerSecond ?? 8_000_000)
  // 用 setTimeout 而非 rAF 驱动结束：标签页隐藏时 rAF 会暂停，录制必须仍能正常收尾
  window.setTimeout(handle.stop, opts.durationSec * 1000)
  return handle
}

/**
 * 逐帧把 DOM 子树（SVG 或 HTML Widget）光栅化到离屏 canvas 再录制，
 * 录屏语义：录制期间用户对 Widget 的操作会如实进入视频。
 */
export function recordElement(
  node: HTMLElement,
  opts: { durationSec: number; fps?: number; bitsPerSecond?: number },
): RecordHandle {
  const mime = pickRecorderMime()
  if (!mime) throw new Error('MediaRecorder is not supported')
  const rect = node.getBoundingClientRect()
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(rect.width * pixelRatio))
  canvas.height = Math.max(1, Math.round(rect.height * pixelRatio))
  const ctx = canvas.getContext('2d')

  // skipFonts：Widget 全用系统字体，跳过每帧扫描样式表嵌字体的开销
  const rasterize = () =>
    toCanvas(node, { pixelRatio, skipFonts: true, cacheBust: false })

  let stopped = false
  let stream: MediaStream | null = null
  let handle: RecordHandle | null = null

  const result = new Promise<RecordResult>((resolve, reject) => {
    void (async () => {
      if (!ctx) {
        reject(new Error('Canvas 2D context unavailable'))
        return
      }
      // 先画第一帧再启动录制，避免视频开头出现黑帧
      let first: HTMLCanvasElement
      try {
        first = await rasterize()
      } catch (e) {
        reject(e instanceof Error ? e : new Error('Rasterization failed'))
        return
      }
      ctx.drawImage(first, 0, 0, canvas.width, canvas.height)

      stream = canvas.captureStream(opts.fps ?? 30)
      handle = startRecorder(stream, mime, opts.bitsPerSecond ?? 8_000_000)
      handle.result.then(resolve, reject)
      // stop() 可能在首帧光栅化期间就已触发，此处补一次确保录制立刻收尾
      if (stopped) handle.stop()

      // toCanvas 慢于帧间隔时自然降帧；视频时长由 MediaRecorder 时间戳保证
      while (!stopped) {
        try {
          const frame = await rasterize()
          if (stopped) break
          ctx.clearRect(0, 0, canvas.width, canvas.height)
          ctx.drawImage(frame, 0, 0, canvas.width, canvas.height)
        } catch {
          // 单帧失败（如节点瞬时不可见）跳过，继续下一帧
        }
        await new Promise<void>((r) => requestAnimationFrame(() => r()))
      }
    })()
  })

  const stop = () => {
    if (stopped) return
    stopped = true
    handle?.stop()
    // 首帧尚未完成时（无 handle），流还没建立，靠 draw 循环退出
  }

  // 用 setTimeout 而非 rAF 驱动结束：标签页隐藏时 rAF 会暂停，录制必须仍能正常收尾
  window.setTimeout(stop, opts.durationSec * 1000)

  return { result, stop }
}

/** 文件名分段安全化：剔除路径/通配等非法字符，空白折叠为连字符并限长（中文原样保留）。 */
export function sanitizeFilePart(part: string): string {
  return part
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ')
    .replace(/\s+/g, '-')
    .replace(/^-+/, '')
    .slice(0, 60)
    .replace(/-+$/, '')
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  // 立即 revoke 会与浏览器下载竞争，延迟到下载启动之后
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
