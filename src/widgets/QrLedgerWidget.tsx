import { useEffect, useMemo, useRef, useState } from 'react'
import { prepareCanvas, palette, type CanvasPalette } from '../lib/canvas'
import { useTheme } from '../lib/theme'
import type { WidgetDefinition } from './registry'

/**
 * 教学二维码账本，不是完整 ISO/IEC 18004 编码器。
 * 边长：modules = 21 + 4×(version − 1)。
 * 版本 1 总码字 26。L/M/Q/H 的数据码字 19/16/13/9，纠错码字 7/10/13/17。
 * 字节模式容量取标准表：17/14/11/7。纠错大约能扛 7%/15%/25%/30% 的损坏。
 * 画布只画寻像、定位、时序和教学用的数据区涂黑，不实现掩模与真实 Reed-Solomon。
 */

const W = 640
const H = 440

export type QrMode = 'frame' | 'bytes' | 'damage'
export type EcLevel = 'L' | 'M' | 'Q' | 'H'

interface QrLedgerProps {
  mode: QrMode
  version: number
  ec: EcLevel
  /** 要装进二维码的字节数（字节模式） */
  bytes: number
  /** 损坏的数据模块百分比 */
  damagePct: number
}

const MODES: { id: QrMode; label: string }[] = [
  { id: 'frame', label: '三个角' },
  { id: 'bytes', label: '能写多少' },
  { id: 'damage', label: '弄脏' },
]

const ECS: { id: EcLevel; label: string }[] = [
  { id: 'L', label: 'L · 7%' },
  { id: 'M', label: 'M · 15%' },
  { id: 'Q', label: 'Q · 25%' },
  { id: 'H', label: 'H · 30%' },
]

/** 版本 1 的码字账。更大版本只用于边长演示。 */
export const V1_TOTAL = 26
export const V1_DATA: Record<EcLevel, number> = { L: 19, M: 16, Q: 13, H: 9 }
export const V1_EC: Record<EcLevel, number> = { L: 7, M: 10, Q: 13, H: 17 }
export const V1_BYTE_CAP: Record<EcLevel, number> = { L: 17, M: 14, Q: 11, H: 7 }
export const EC_PCT: Record<EcLevel, number> = { L: 7, M: 15, Q: 25, H: 30 }

export function clampMode(mode: string): QrMode {
  if (mode === 'bytes' || mode === 'damage' || mode === 'frame') return mode
  return 'frame'
}

export function clampEc(ec: string): EcLevel {
  if (ec === 'M' || ec === 'Q' || ec === 'H' || ec === 'L') return ec
  return 'L'
}

export function clampVersion(n: number): number {
  const x = Math.round(Number(n))
  if (!Number.isFinite(x)) return 1
  return Math.max(1, Math.min(6, x))
}

export function clampBytes(n: number): number {
  const x = Math.round(Number(n))
  if (!Number.isFinite(x)) return 5
  return Math.max(0, Math.min(20, x))
}

export function clampDamage(n: number): number {
  const x = Math.round(Number(n))
  if (!Number.isFinite(x)) return 0
  return Math.max(0, Math.min(40, x))
}

export function modulesFor(version: number): number {
  return 21 + 4 * (clampVersion(version) - 1)
}

export function ecCorrectable(ec: EcLevel): number {
  return Math.floor(V1_EC[ec] / 2)
}

export function canFit(bytes: number, ec: EcLevel): boolean {
  return clampBytes(bytes) <= V1_BYTE_CAP[ec]
}

export function canRecover(damagePct: number, ec: EcLevel): boolean {
  return clampDamage(damagePct) <= EC_PCT[ec]
}

export function frameHeadline(version: number): string {
  const m = modulesFor(version)
  return `${clampVersion(version)} 号图是 ${m}×${m} 格。三个角上的大方框先告诉手机哪边朝上。`
}

export function bytesHeadline(bytes: number, ec: EcLevel): string {
  const n = clampBytes(bytes)
  const cap = V1_BYTE_CAP[ec]
  if (n === 0) return `1 号图的 ${ec} 档最多大约 ${cap} 个字节。现在还没写字。`
  if (n <= cap) {
    return `${n} 个字节放进 1 号图的 ${ec} 档。写字段 ${V1_DATA[ec]}，补丁段 ${V1_EC[ec]}，还空 ${cap - n} 个字节。`
  }
  return `${n} 个字节放不进 1 号图的 ${ec} 档。这一档最多 ${cap} 个字节，多出来的要换更大号，或改用补丁更少的档。`
}

export function damageHeadline(damagePct: number, ec: EcLevel): string {
  const d = clampDamage(damagePct)
  const limit = EC_PCT[ec]
  if (d === 0) return `还没弄脏。${ec} 档名义上大约能扛 ${limit}% 的损伤。`
  if (d <= limit) return `弄脏 ${d}%。${ec} 档上限大约 ${limit}%，账本记作还能读。`
  return `弄脏 ${d}%。超过 ${ec} 档大约 ${limit}% 的上限，账本记作扫不出来。`
}

function headline(props: QrLedgerProps): string {
  if (props.mode === 'bytes') return bytesHeadline(props.bytes, props.ec)
  if (props.mode === 'damage') return damageHeadline(props.damagePct, props.ec)
  return frameHeadline(props.version)
}

function detail(props: QrLedgerProps): string {
  if (props.mode === 'bytes') {
    const data = V1_DATA[props.ec]
    const ecw = V1_EC[props.ec]
    return `1 号图一共 ${V1_TOTAL} 小段 = 写字 ${data} + 补丁 ${ecw}。开头还要占一点地方说明模式和长度，所以正文上限是 ${V1_BYTE_CAP[props.ec]} 个字节，不是 ${data}。`
  }
  if (props.mode === 'damage') {
    const t = ecCorrectable(props.ec)
    return `补丁段 ${V1_EC[props.ec]} 个，大约能修好 t = ⌊${V1_EC[props.ec]}/2⌋ = ${t} 段。外面说的 ${EC_PCT[props.ec]}% 是圆整宣传值，不是拿尺子量画面面积。`
  }
  const m = modulesFor(props.version)
  return `一边格数 = 21 + 4 × (号 − 1) = ${m}。角上每个大方框是 7×7。最外面留白，免得旁边的印刷挤进来。`
}

function QrLedger({ props }: { props: QrLedgerProps }) {
  const theme = useTheme()
  const [mode, setMode] = useState<QrMode>(clampMode(props.mode))
  const [version, setVersion] = useState(clampVersion(props.version))
  const [ec, setEc] = useState<EcLevel>(clampEc(props.ec))
  const [bytes, setBytes] = useState(clampBytes(props.bytes))
  const [damagePct, setDamagePct] = useState(clampDamage(props.damagePct))

  useEffect(() => setMode(clampMode(props.mode)), [props.mode])
  useEffect(() => setVersion(clampVersion(props.version)), [props.version])
  useEffect(() => setEc(clampEc(props.ec)), [props.ec])
  useEffect(() => setBytes(clampBytes(props.bytes)), [props.bytes])
  useEffect(() => setDamagePct(clampDamage(props.damagePct)), [props.damagePct])

  const view = useMemo<QrLedgerProps>(
    () => ({ mode, version, ec, bytes, damagePct }),
    [mode, version, ec, bytes, damagePct],
  )

  const chips =
    mode === 'bytes'
      ? [
          `写字段 ${V1_DATA[ec]}`,
          `补丁 ${V1_EC[ec]}`,
          canFit(bytes, ec) ? `上限 ${V1_BYTE_CAP[ec]}` : `超出 ${bytes - V1_BYTE_CAP[ec]}`,
        ]
      : mode === 'damage'
        ? [
            `${ec} · ${EC_PCT[ec]}%`,
            `t = ${ecCorrectable(ec)}`,
            canRecover(damagePct, ec) ? '还能读' : '扫失败',
          ]
        : [`${modulesFor(version)}×${modulesFor(version)}`, `${version} 号`, '角标 ×3']

  return (
    <div className="lb-surface">
      <p className="t-strong text-sm">{headline(view)}</p>
      <QrCanvas theme={theme} view={view} />
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <div className="t-panel inline-flex flex-wrap rounded-lg p-0.5">
          {MODES.map((item) => (
            <button
              key={item.id}
              onClick={() => setMode(item.id)}
              className={`rounded-[6px] px-2.5 py-1 text-xs font-medium transition-colors ${
                mode === item.id ? 't-btn-primary' : 't-muted'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
        {mode !== 'frame' ? (
          <div className="t-panel inline-flex flex-wrap rounded-lg p-0.5">
            {ECS.map((item) => (
              <button
                key={item.id}
                onClick={() => setEc(item.id)}
                className={`rounded-[6px] px-2.5 py-1 text-xs font-medium transition-colors ${
                  ec === item.id ? 't-btn-primary' : 't-muted'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <div className="mt-3 space-y-2">
        {mode === 'frame' ? (
          <Slider
            label="几号"
            value={version}
            min={1}
            max={6}
            step={1}
            text={`${version}`}
            onChange={(n) => setVersion(clampVersion(n))}
          />
        ) : null}
        {mode === 'bytes' ? (
          <Slider
            label="字节"
            value={bytes}
            min={0}
            max={20}
            step={1}
            text={`${bytes}`}
            onChange={(n) => setBytes(clampBytes(n))}
          />
        ) : null}
        {mode === 'damage' ? (
          <Slider
            label="弄脏"
            value={damagePct}
            min={0}
            max={40}
            step={1}
            text={`${damagePct}%`}
            onChange={(n) => setDamagePct(clampDamage(n))}
          />
        ) : null}
      </div>
      <div className="mt-3 flex flex-wrap gap-2 font-mono text-[11px] tabular-nums">
        {chips.map((item) => (
          <span key={item} className="t-panel rounded-full px-3 py-1">
            {item}
          </span>
        ))}
      </div>
      <p className="t-faint mt-2 text-xs leading-5">{detail(view)}</p>
    </div>
  )
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  text,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  text: string
  onChange: (n: number) => void
}) {
  return (
    <label className="t-muted flex items-center gap-2 text-xs">
      <span className="w-16 shrink-0">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1"
      />
      <span className="t-strong w-12 text-right font-mono tabular-nums">{text}</span>
    </label>
  )
}

function QrCanvas({ theme, view }: { theme: string; view: QrLedgerProps }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = prepareCanvas(canvas, W, H)
    if (!ctx) return
    const P = palette()
    ctx.clearRect(0, 0, W, H)
    ctx.fillStyle = P.bg
    ctx.fillRect(0, 0, W, H)
    if (view.mode === 'bytes') drawBytes(ctx, P, view.bytes, view.ec)
    else if (view.mode === 'damage') drawDamage(ctx, P, view.damagePct, view.ec)
    else drawFrame(ctx, P, view.version)
  }, [theme, view])

  return (
    <canvas
      ref={canvasRef}
      className="mt-3 touch-none"
      style={{ width: '100%', aspectRatio: `${W} / ${H}`, borderRadius: 8, touchAction: 'none' }}
    />
  )
}

function drawFrame(ctx: CanvasRenderingContext2D, P: CanvasPalette, version: number) {
  const n = modulesFor(version)
  note(ctx, P, '每一小格非黑即白。三个角的大方框，手机先拿它们认方向。')
  const origin = paintMatrix(ctx, P, n, (r, c) => {
    if (inFinder(r, c, n)) return finderColor(r, c, n)
    if (r === 6 || c === 6) return (r + c) % 2 === 0
    // 教学数据区：稳定伪随机，只为填满观感
    if (r > 7 && c > 7) return ((r * 17 + c * 13 + version * 3) % 5) < 2
    return false
  })
  label(ctx, P, `外圈留白`, origin.x - 4, origin.y + origin.size + 22, P.faint)
  legend(ctx, P, [
    { color: P.text, text: '角上大方框 7×7' },
    { color: P.accent, text: '对格细线' },
    { color: P.muted, text: '中间写字区（示意）' },
  ])
  // 标注三个角
  badge(ctx, P, origin.x + 3.5 * origin.cell, origin.y + 3.5 * origin.cell, 'TL')
  badge(ctx, P, origin.x + (n - 3.5) * origin.cell, origin.y + 3.5 * origin.cell, 'TR')
  badge(ctx, P, origin.x + 3.5 * origin.cell, origin.y + (n - 3.5) * origin.cell, 'BL')
}

function drawBytes(ctx: CanvasRenderingContext2D, P: CanvasPalette, bytes: number, ec: EcLevel) {
  note(ctx, P, '左边是 1 号图怎么切段。右边看正文写了多少、还剩多少。')
  const data = V1_DATA[ec]
  const ecw = V1_EC[ec]
  const cap = V1_BYTE_CAP[ec]
  const n = clampBytes(bytes)
  const fit = n <= cap

  const rows = [
    { name: '总共几段', value: `${V1_TOTAL}`, tip: '1 号固定', hot: false },
    { name: '写字段', value: `${data}`, tip: `${ec} 档`, hot: false },
    { name: '补丁段', value: `${ecw}`, tip: `大约修好 t=${ecCorrectable(ec)}`, hot: false },
    {
      name: '正文字节',
      value: `${n} / ${cap}`,
      tip: fit ? `还空 ${cap - n}` : `超出 ${n - cap}`,
      hot: true,
    },
  ]
  rows.forEach((row, i) => {
    const y = 70 + i * 72
    round(ctx, 28, y, 300, 58, 12)
    ctx.fillStyle = row.hot ? P.soft : P.bg2
    ctx.fill()
    ctx.lineWidth = row.hot ? 1.5 : 1
    ctx.strokeStyle = row.hot ? (fit ? P.accent : P.danger) : P.grid
    ctx.stroke()
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = P.text
    ctx.font = '15px ui-sans-serif, system-ui, sans-serif'
    ctx.fillText(row.name, 48, y + 29)
    ctx.fillStyle = P.faint
    ctx.font = '12px ui-sans-serif, system-ui, sans-serif'
    ctx.fillText(row.tip, 150, y + 29)
    ctx.textAlign = 'right'
    ctx.fillStyle = row.hot ? (fit ? P.accent : P.danger) : P.text
    ctx.font = '18px ui-monospace, monospace'
    ctx.fillText(row.value, 308, y + 29)
  })

  // 右侧容量条
  round(ctx, 360, 70, 250, 300, 14)
  ctx.fillStyle = P.bg2
  ctx.fill()
  ctx.strokeStyle = P.grid
  ctx.lineWidth = 1
  ctx.stroke()
  ctx.textAlign = 'left'
  ctx.fillStyle = P.faint
  ctx.font = '13px ui-sans-serif, system-ui, sans-serif'
  ctx.fillText(`1 号图 · ${ec} 档能写多少`, 380, 104)

  const barX = 390
  const barY = 140
  const barH = 180
  const barW = 48
  round(ctx, barX, barY, barW, barH, 8)
  ctx.fillStyle = P.bg
  ctx.fill()
  const used = Math.min(1, n / Math.max(1, cap))
  const fillH = Math.max(n > 0 ? 4 : 0, barH * used)
  round(ctx, barX, barY + barH - fillH, barW, fillH, 8)
  ctx.fillStyle = fit ? P.accent : P.danger
  ctx.fill()

  // EC portion note beside
  ctx.fillStyle = P.text
  ctx.font = '28px ui-monospace, monospace'
  ctx.fillText(`${n}`, 470, 200)
  ctx.fillStyle = P.muted
  ctx.font = '14px ui-sans-serif, system-ui, sans-serif'
  ctx.fillText(`/ ${cap} 字节`, 470, 232)
  ctx.fillStyle = fit ? P.good : P.danger
  ctx.font = '14px ui-sans-serif, system-ui, sans-serif'
  ctx.fillText(fit ? '写得下' : '写不下', 470, 270)
  ctx.fillStyle = P.faint
  ctx.font = '12px ui-sans-serif, system-ui, sans-serif'
  ctx.fillText(`补丁占 ${ecw}/${V1_TOTAL} 段`, 470, 310)
}

function drawDamage(ctx: CanvasRenderingContext2D, P: CanvasPalette, damagePct: number, ec: EcLevel) {
  const d = clampDamage(damagePct)
  const ok = canRecover(d, ec)
  note(
    ctx,
    P,
    ok
      ? `弄脏的格子打了叉。${ec} 档名义上限 ${EC_PCT[ec]}%，这一档还在范围内。`
      : `弄脏超过 ${ec} 档大约 ${EC_PCT[ec]}%。角还在，中间的字已经拼不回来。`,
  )

  const n = 21
  paintMatrix(ctx, P, n, (r, c) => {
    if (inFinder(r, c, n)) return finderColor(r, c, n)
    if (r === 6 || c === 6) return (r + c) % 2 === 0
    const data = ((r * 17 + c * 13) % 5) < 2
    const damaged = isDamaged(r, c, d)
    if (damaged) return !data
    return data
  }, { markDamage: d, ecOk: ok })

  round(ctx, 430, 90, 180, 220, 14)
  ctx.fillStyle = ok ? P.soft : P.bg2
  ctx.fill()
  ctx.lineWidth = 1.5
  ctx.strokeStyle = ok ? P.good : P.danger
  ctx.stroke()
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = P.faint
  ctx.font = '13px ui-sans-serif, system-ui, sans-serif'
  ctx.fillText('弄脏之后', 450, 120)
  ctx.fillStyle = P.text
  ctx.font = '15px ui-sans-serif, system-ui, sans-serif'
  ctx.fillText(`${ec} 档`, 450, 156)
  ctx.font = '28px ui-monospace, monospace'
  ctx.fillStyle = ok ? P.good : P.danger
  ctx.fillText(`${d}%`, 450, 200)
  ctx.fillStyle = P.muted
  ctx.font = '13px ui-sans-serif, system-ui, sans-serif'
  ctx.fillText(`上限约 ${EC_PCT[ec]}%`, 450, 240)
  ctx.fillText(`大约修好 t = ${ecCorrectable(ec)} 段`, 450, 268)
}

function isDamaged(r: number, c: number, damagePct: number): boolean {
  if (damagePct <= 0) return false
  if (inFinder(r, c, 21) || r === 6 || c === 6) return false
  // 稳定的伪随机：把模块哈希到 0..99
  const h = Math.abs((r * 131 + c * 17 + 97) * 2654435761) % 100
  return h < damagePct
}

function inFinder(r: number, c: number, n: number): boolean {
  const inTL = r < 8 && c < 8
  const inTR = r < 8 && c >= n - 8
  const inBL = r >= n - 8 && c < 8
  return inTL || inTR || inBL
}

function finderColor(r: number, c: number, n: number): boolean {
  const local = (rr: number, cc: number) => {
    const in7 = rr >= 0 && rr < 7 && cc >= 0 && cc < 7
    if (!in7) return false
    const ring = rr === 0 || rr === 6 || cc === 0 || cc === 6
    const core = rr >= 2 && rr <= 4 && cc >= 2 && cc <= 4
    return ring || core
  }
  if (r < 8 && c < 8) return local(r, c)
  if (r < 8 && c >= n - 8) return local(r, c - (n - 7))
  if (r >= n - 8 && c < 8) return local(r - (n - 7), c)
  return false
}

function paintMatrix(
  ctx: CanvasRenderingContext2D,
  P: CanvasPalette,
  n: number,
  dark: (r: number, c: number) => boolean,
  opts?: { markDamage?: number; ecOk?: boolean },
): { x: number; y: number; size: number; cell: number } {
  const quiet = 2
  const cells = n + quiet * 2
  const size = 320
  const cell = size / cells
  const x = 36
  const y = 64
  round(ctx, x - 6, y - 6, size + 12, size + 12, 12)
  ctx.fillStyle = P.bg2
  ctx.fill()

  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const px = x + (c + quiet) * cell
      const py = y + (r + quiet) * cell
      const isFinder = inFinder(r, c, n)
      const isTiming = r === 6 || c === 6
      const damaged = opts?.markDamage ? isDamaged(r, c, opts.markDamage) : false
      if (dark(r, c)) {
        ctx.fillStyle = isFinder ? P.text : isTiming ? P.accent : damaged ? P.danger : P.text
        ctx.fillRect(px, py, Math.ceil(cell), Math.ceil(cell))
      } else if (damaged) {
        ctx.strokeStyle = P.danger
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(px + 1, py + 1)
        ctx.lineTo(px + cell - 1, py + cell - 1)
        ctx.moveTo(px + cell - 1, py + 1)
        ctx.lineTo(px + 1, py + cell - 1)
        ctx.stroke()
      }
    }
  }
  void opts?.ecOk
  return { x, y, size, cell }
}

function note(ctx: CanvasRenderingContext2D, P: CanvasPalette, text: string) {
  ctx.fillStyle = P.muted
  ctx.font = '13px ui-sans-serif, system-ui, sans-serif'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, 28, 36)
}

function label(
  ctx: CanvasRenderingContext2D,
  P: CanvasPalette,
  text: string,
  x: number,
  y: number,
  color: string,
) {
  ctx.fillStyle = color
  ctx.font = '12px ui-sans-serif, system-ui, sans-serif'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, x, y)
  void P
}

function legend(ctx: CanvasRenderingContext2D, P: CanvasPalette, items: { color: string; text: string }[]) {
  items.forEach((item, i) => {
    const y = 100 + i * 36
    ctx.beginPath()
    ctx.arc(430, y, 6, 0, Math.PI * 2)
    ctx.fillStyle = item.color
    ctx.fill()
    ctx.fillStyle = P.muted
    ctx.font = '13px ui-sans-serif, system-ui, sans-serif'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillText(item.text, 448, y)
  })
}

function badge(ctx: CanvasRenderingContext2D, P: CanvasPalette, x: number, y: number, text: string) {
  ctx.fillStyle = P.accent
  ctx.font = '10px ui-monospace, monospace'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, x, y)
}

function round(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, r)
}

export const QrLedgerWidget: WidgetDefinition<QrLedgerProps> = {
  type: 'qr-ledger',
  label: '二维码账本',
  description: '一边格数随号加 4。1 号图 26 小段拆成写字和补丁。弄脏超过 L/M/Q/H 名义比例就扫不出来。',
  icon: '▦',
  defaultProps: { mode: 'frame', version: 1, ec: 'L', bytes: 5, damagePct: 0 },
  configSchema: [
    {
      key: 'mode',
      label: '模式',
      type: 'select',
      options: MODES.map((m) => ({ value: m.id, label: m.label })),
    },
    { key: 'version', label: '几号', type: 'range', min: 1, max: 6, step: 1 },
    {
      key: 'ec',
      label: '耐脏档',
      type: 'select',
      options: ECS.map((e) => ({ value: e.id, label: e.label })),
    },
    { key: 'bytes', label: '字节', type: 'range', min: 0, max: 20, step: 1 },
    { key: 'damagePct', label: '弄脏 %', type: 'range', min: 0, max: 40, step: 1 },
  ],
  Component: QrLedger,
}
