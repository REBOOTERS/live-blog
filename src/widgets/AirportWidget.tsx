import { useEffect, useMemo, useRef, useState } from 'react'
import { prepareCanvas, palette, type CanvasPalette } from '../lib/canvas'
import { useTheme } from '../lib/theme'
import type { WidgetDefinition } from './registry'

/**
 * 教学账本，不是某台 AirPort 的抓包。
 * QoS 数据帧：明文 N+38 = MAC 26 + LLC 8 + IP N + FCS 4。
 * WPA2-CCMP 再加头 8 和 MIC 8，共 N+54。IP 在密文里。
 * 11b 文件速度：长前导码 192 µs，DIFS 50，时隙 20，CWmin 31，
 * 平均退避 15.5 个时隙。确认 14 字节也按 11 Mbps。一次 TCP 来回
 * 29740/11 µs，1460 字节载荷得到 128480/29740 Mbps。
 * 多台只是把这个速度平分，不模拟碰撞。
 */

export const SITE = '192.0.2.20'
export const LAN_CLIENT = '10.0.1.4'
export const LAN_GW = '10.0.1.1'
export const WAN = '203.0.113.10'
export const BRIDGE_CLIENT = '198.51.100.8'
export const SPEAKER = '10.0.1.8'
export const CLIENT_MAC = '02:00:00:00:00:14'
export const BSSID = '02:00:00:00:00:01'
export const SRC_PORT = 49152
export const DST_PORT = 443

export const MAC_QOS = 26
export const LLC = 8
export const FCS = 4
export const CCMP_HDR = 8
export const CCMP_MIC = 8
export const PHY_MBPS = 11
export const PREAMBLE_US = 192
export const DIFS_US = 50
export const SIFS_US = 10
export const SLOT_US = 20
export const CW_MIN = 31
export const MEAN_BACKOFF_US = (CW_MIN / 2) * SLOT_US
export const ACK_BYTES = 14
export const TCP_IP = 1500
export const TCP_PAYLOAD = 1460
export const TCP_ACK_IP = 40

const W = 640
const H = 460

export type AirportMode = 'hear' | 'turns' | 'door'
export type DoorMode = 'nat' | 'bridge' | 'speaker'

interface AirportProps {
  mode: AirportMode
  secure: boolean
  bytes: number
  stations: number
  door: DoorMode
}

const MODES: { id: AirportMode; label: string }[] = [
  { id: 'hear', label: '听见' },
  { id: 'turns', label: '轮流' },
  { id: 'door', label: '门口' },
]

const DOORS: { id: DoorMode; label: string }[] = [
  { id: 'nat', label: '地址翻译' },
  { id: 'bridge', label: '桥接' },
  { id: 'speaker', label: '音响' },
]

export function clampMode(mode: string): AirportMode {
  return MODES.some((item) => item.id === mode) ? (mode as AirportMode) : 'hear'
}

export function clampDoor(door: string): DoorMode {
  return DOORS.some((item) => item.id === door) ? (door as DoorMode) : 'nat'
}

export function clampBytes(n: number): number {
  const stepped = Math.round(Number(n) / 10) * 10
  if (!Number.isFinite(stepped)) return 200
  return Math.max(40, Math.min(1500, stepped))
}

export function clampStations(n: number): number {
  const stepped = Math.round(Number(n))
  if (!Number.isFinite(stepped)) return 1
  return Math.max(1, Math.min(10, stepped))
}

export function airBytes(secure: boolean, ipBytes: number): number {
  return MAC_QOS + LLC + ipBytes + FCS + (secure ? CCMP_HDR + CCMP_MIC : 0)
}

export function airUs(mpdu: number): number {
  return PREAMBLE_US + (mpdu * 8) / PHY_MBPS
}

export function exchangeUs(mpdu: number): number {
  return DIFS_US + MEAN_BACKOFF_US + airUs(mpdu) + SIFS_US + airUs(ACK_BYTES)
}

export function tcpTransactionUs(): number {
  return exchangeUs(airBytes(false, TCP_IP)) + exchangeUs(airBytes(false, TCP_ACK_IP))
}

export function tcpMbps(): number {
  return (TCP_PAYLOAD * 8) / (tcpTransactionUs() * 1e-6) / 1e6
}

export function fmtMbps(n: number): string {
  return (Math.round(n * 100) / 100).toFixed(2)
}

export function fmtUs(n: number): string {
  const rounded = Math.round(n * 10) / 10
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
}

export function hearHeadline(secure: boolean, bytes: number): string {
  const frame = airBytes(secure, clampBytes(bytes))
  if (secure) return `邻居读到电脑和基站，读不到网页。空中这一帧 ${frame} 字节。`
  return `邻居读到网页 ${SITE}。空中这一帧 ${frame} 字节。`
}

export function turnsHeadline(stations: number): string {
  const n = clampStations(stations)
  const each = fmtMbps(tcpMbps() / n)
  if (n === 1) return `一台复制文件，大约 ${each} Mbps，不是 11。`
  return `${n} 台平分，每台大约 ${each} Mbps。碰撞还没算。`
}

export function doorHeadline(door: DoorMode): string {
  if (door === 'bridge') return `桥接不改写。网站看见的还是 ${BRIDGE_CLIENT}。`
  if (door === 'speaker') return `音响在 ${SPEAKER}。这一包留在局域网。`
  return `出去的源地址是 ${WAN}，不是 ${LAN_CLIENT}。`
}

function headline(props: AirportProps): string {
  if (props.mode === 'turns') return turnsHeadline(props.stations)
  if (props.mode === 'door') return doorHeadline(props.door)
  return hearHeadline(props.secure, props.bytes)
}

function detail(props: AirportProps): string {
  if (props.mode === 'turns') {
    const data = airBytes(false, TCP_IP)
    const ack = airBytes(false, TCP_ACK_IP)
    return `数据帧 ${data} 字节，空中 ${fmtUs(airUs(data))} µs。确认 ${ACK_BYTES} 字节，空中 ${fmtUs(airUs(ACK_BYTES))} µs。TCP 确认那一帧 ${ack} 字节，整段来回 ${fmtUs(exchangeUs(ack))} µs。合计 ${fmtUs(tcpTransactionUs())} µs。${props.stations} 台只平分速度，不缩短这一来回。`
  }
  if (props.mode === 'door') {
    if (props.door === 'bridge') {
      return `共享关掉之后，基站不发 10.0.1.0/24，也不改 IP。电脑用上游给的 ${BRIDGE_CLIENT}。网站看见的源就是它。`
    }
    if (props.door === 'speaker') {
      return `Express 是局域网里的 ${SPEAKER}。电脑 ${LAN_CLIENT} 把音频包直接给它。目的地不在公网，地址翻译看不见这一包。`
    }
    return `电脑 ${LAN_CLIENT}:${SRC_PORT} 访问 ${SITE}:${DST_PORT}。基站自己是 ${LAN_GW}，出去时把源换成 ${WAN}:${SRC_PORT}。这一账假定端口没被占用。`
  }
  const n = clampBytes(props.bytes)
  const open = airBytes(false, n)
  const closed = airBytes(true, n)
  return `明文 ${open} = 26 + 8 + ${n} + 4。WPA2 ${closed} = ${open} + 8 + 8。电脑 ${CLIENT_MAC}，基站 ${BSSID}。这两行不加密。`
}

interface Seg {
  name: string
  bytes: number
  color: string
}

function hearSegments(secure: boolean, bytes: number, P: CanvasPalette): Seg[] {
  if (!secure) {
    return [
      { name: 'MAC 头', bytes: MAC_QOS, color: P.accent },
      { name: 'LLC', bytes: LLC, color: P.accent2 },
      { name: 'IP', bytes: bytes, color: P.good },
      { name: 'FCS', bytes: FCS, color: P.faint },
    ]
  }
  return [
    { name: 'MAC 头', bytes: MAC_QOS, color: P.accent },
    { name: 'CCMP 头', bytes: CCMP_HDR, color: P.warn },
    { name: '密文', bytes: LLC + bytes + CCMP_MIC, color: P.good },
    { name: 'FCS', bytes: FCS, color: P.faint },
  ]
}

function Airport({ props }: { props: AirportProps }) {
  const theme = useTheme()
  const [mode, setMode] = useState<AirportMode>(clampMode(props.mode))
  const [secure, setSecure] = useState(props.secure)
  const [bytes, setBytes] = useState(clampBytes(props.bytes))
  const [stations, setStations] = useState(clampStations(props.stations))
  const [door, setDoor] = useState<DoorMode>(clampDoor(props.door))

  useEffect(() => setMode(clampMode(props.mode)), [props.mode])
  useEffect(() => setSecure(props.secure), [props.secure])
  useEffect(() => setBytes(clampBytes(props.bytes)), [props.bytes])
  useEffect(() => setStations(clampStations(props.stations)), [props.stations])
  useEffect(() => setDoor(clampDoor(props.door)), [props.door])

  const view = useMemo<AirportProps>(
    () => ({ mode, secure, bytes, stations, door }),
    [mode, secure, bytes, stations, door],
  )

  const chips =
    mode === 'turns'
      ? [
          `合计 ${fmtUs(tcpTransactionUs())} µs`,
          `载荷 ${TCP_PAYLOAD} 字节`,
          `大约 ${fmtMbps(tcpMbps() / stations)} Mbps`,
        ]
      : mode === 'door'
        ? door === 'bridge'
          ? [`两边 ${BRIDGE_CLIENT}`, `目的 ${SITE}`, '不改写']
          : door === 'speaker'
            ? [LAN_CLIENT, SPEAKER, '不出局域网']
            : [`${LAN_CLIENT}:${SRC_PORT}`, `${WAN}:${SRC_PORT}`, `${SITE}:${DST_PORT}`]
        : [
            `空中 ${airBytes(secure, bytes)} 字节`,
            secure ? '网页在密文里' : `网页 ${SITE}`,
            secure ? `基站 ${BSSID}` : `源 ${LAN_CLIENT}`,
          ]

  return (
    <div className="lb-surface">
      <p className="t-strong text-sm">{headline(view)}</p>
      <AirportCanvas theme={theme} view={view} />
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
        {mode === 'hear' && (
          <div className="t-panel inline-flex rounded-lg p-0.5">
            <SegButton label="WPA2" on={secure} onClick={() => setSecure(true)} />
            <SegButton label="明文" on={!secure} onClick={() => setSecure(false)} />
          </div>
        )}
        {mode === 'door' && (
          <div className="t-panel inline-flex flex-wrap rounded-lg p-0.5">
            {DOORS.map((item) => (
              <SegButton key={item.id} label={item.label} on={door === item.id} onClick={() => setDoor(item.id)} />
            ))}
          </div>
        )}
      </div>
      <div className="mt-3 space-y-2">
        {mode === 'hear' ? (
          <Slider
            label="IP 包"
            value={bytes}
            min={40}
            max={1500}
            step={10}
            text={`${bytes}`}
            onChange={(n) => setBytes(clampBytes(n))}
          />
        ) : null}
        {mode === 'turns' ? (
          <Slider
            label="台数"
            value={stations}
            min={1}
            max={10}
            step={1}
            text={`${stations}`}
            onChange={(n) => setStations(clampStations(n))}
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

function SegButton({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-[6px] px-2.5 py-1 text-xs font-medium transition-colors ${on ? 't-btn-primary' : 't-muted'}`}
    >
      {label}
    </button>
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

function AirportCanvas({ theme, view }: { theme: string; view: AirportProps }) {
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
    if (view.mode === 'turns') drawTurns(ctx, P, clampStations(view.stations))
    else if (view.mode === 'door') drawDoor(ctx, P, view.door)
    else drawHear(ctx, P, view.secure, clampBytes(view.bytes))
  }, [theme, view])

  return (
    <canvas
      ref={canvasRef}
      className="mt-3 touch-none"
      style={{ width: '100%', aspectRatio: `${W} / ${H}`, borderRadius: 8, touchAction: 'none' }}
    />
  )
}

function drawHear(ctx: CanvasRenderingContext2D, P: CanvasPalette, secure: boolean, bytes: number) {
  note(ctx, P, secure ? 'MAC 头仍是明文。IP 整段在密文里。' : '没加密时，邻居连网页地址一起读到。')
  const lines = [
    { label: '电脑', value: CLIENT_MAC, hot: false },
    { label: '基站', value: BSSID, hot: false },
    {
      label: '网页',
      value: secure ? '在密文里' : `${LAN_CLIENT} → ${SITE}`,
      hot: !secure,
    },
  ]
  lines.forEach((line, i) => {
    const y = 58 + i * 52
    round(ctx, 28, y, 584, 44, 12)
    ctx.fillStyle = line.hot ? P.soft : P.bg2
    ctx.fill()
    ctx.lineWidth = line.hot ? 1.5 : 1
    ctx.strokeStyle = line.hot ? P.accent : P.grid
    ctx.stroke()
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = P.faint
    ctx.font = '14px ui-sans-serif, system-ui, sans-serif'
    ctx.fillText(line.label, 48, y + 22)
    ctx.fillStyle = line.hot ? P.accent : P.text
    ctx.font = '16px ui-monospace, monospace'
    ctx.fillText(line.value, 108, y + 22)
  })

  const segs = hearSegments(secure, bytes, P)
  const total = segs.reduce((sum, seg) => sum + seg.bytes, 0)
  const barX = 28
  const barY = 230
  const barW = 584
  const widths = segmentWidths(
    segs.map((seg) => seg.bytes),
    barW,
    10,
  )
  let x = barX
  segs.forEach((seg, i) => {
    round(ctx, x, barY, widths[i] - 3, 36, 8)
    ctx.fillStyle = seg.color
    ctx.globalAlpha = seg.name === 'FCS' ? 0.45 : 0.9
    ctx.fill()
    ctx.globalAlpha = 1
    x += widths[i]
  })

  segs.forEach((seg, i) => {
    const col = i % 4
    const row = Math.floor(i / 4)
    const lx = 28 + col * 150
    const ly = 292 + row * 28
    ctx.beginPath()
    ctx.arc(lx + 6, ly, 5, 0, Math.PI * 2)
    ctx.fillStyle = seg.color
    ctx.fill()
    ctx.fillStyle = P.muted
    ctx.font = '13px ui-sans-serif, system-ui, sans-serif'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillText(`${seg.name} ${seg.bytes}`, lx + 18, ly)
  })

  ctx.fillStyle = P.text
  ctx.font = '15px ui-sans-serif, system-ui, sans-serif'
  ctx.textAlign = 'left'
  const cipher = LLC + bytes + CCMP_MIC
  ctx.fillText(
    secure ? `空中 ${total} 字节。比明文多 16：CCMP 头 8，MIC 8。` : `空中 ${total} 字节。26 + 8 + ${bytes} + 4。`,
    28,
    360,
  )
  ctx.fillStyle = P.faint
  ctx.font = '13px ui-sans-serif, system-ui, sans-serif'
  ctx.fillText(
    secure ? `密文 ${cipher} = LLC ${LLC} + IP ${bytes} + MIC ${CCMP_MIC}。地址不在里面。` : '这一帧没有 CCMP 头，也没有 MIC。网页写在 IP 里。',
    28,
    392,
  )
}

function drawTurns(ctx: CanvasRenderingContext2D, P: CanvasPalette, stations: number) {
  note(ctx, P, '下面是一台独占信道时的一次文件来回。台数只平分最后一行。')
  const data = airBytes(false, TCP_IP)
  const ack = airBytes(false, TCP_ACK_IP)
  const rows: { name: string; value: string; hot?: boolean }[] = [
    { name: 'DIFS', value: `${fmtUs(DIFS_US)} µs` },
    { name: '平均退避', value: `${fmtUs(MEAN_BACKOFF_US)} µs` },
    { name: `数据帧 ${data} 字节`, value: `${fmtUs(airUs(data))} µs` },
    { name: 'SIFS', value: `${fmtUs(SIFS_US)} µs` },
    { name: `确认 ${ACK_BYTES} 字节`, value: `${fmtUs(airUs(ACK_BYTES))} µs` },
    { name: `TCP 确认来回 ${ack} 字节`, value: `${fmtUs(exchangeUs(ack))} µs` },
    { name: '合计', value: `${fmtUs(tcpTransactionUs())} µs` },
    {
      name: stations === 1 ? '文件速度' : `${stations} 台平分`,
      value: `${fmtMbps(tcpMbps() / stations)} Mbps`,
      hot: true,
    },
  ]
  rows.forEach((row, i) => {
    const y = 52 + i * 48
    round(ctx, 28, y, 584, 40, 10)
    ctx.fillStyle = row.hot ? P.soft : P.bg2
    ctx.fill()
    ctx.lineWidth = row.hot ? 1.5 : 1
    ctx.strokeStyle = row.hot ? P.accent : P.grid
    ctx.stroke()
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = P.text
    ctx.font = '14px ui-sans-serif, system-ui, sans-serif'
    ctx.fillText(row.name, 48, y + 20)
    ctx.textAlign = 'right'
    ctx.fillStyle = row.hot ? P.accent : P.text
    ctx.font = '15px ui-monospace, monospace'
    ctx.fillText(row.value, 588, y + 20)
  })
}

function drawDoor(ctx: CanvasRenderingContext2D, P: CanvasPalette, door: DoorMode) {
  if (door === 'speaker') {
    note(ctx, P, '音响是局域网上的另一台主机。包不过地址翻译。')
  } else if (door === 'bridge') {
    note(ctx, P, '桥接把帧递过去。IP 头两边一样。')
  } else {
    note(ctx, P, '局域网里用私有地址。出去时源地址换成基站的公网地址。')
  }

  const left =
    door === 'bridge'
      ? { title: '无线这边', lines: [BRIDGE_CLIENT, `端口 ${SRC_PORT}`, `→ ${SITE}:${DST_PORT}`], hot: false }
      : door === 'speaker'
        ? { title: '电脑', lines: [LAN_CLIENT, '音频', `→ ${SPEAKER}`], hot: false }
        : { title: '局域网', lines: [LAN_CLIENT, `端口 ${SRC_PORT}`, `→ ${SITE}:${DST_PORT}`], hot: false }
  const right =
    door === 'bridge'
      ? { title: '有线那边', lines: [BRIDGE_CLIENT, `端口 ${SRC_PORT}`, `→ ${SITE}:${DST_PORT}`], hot: false }
      : door === 'speaker'
        ? { title: '音响', lines: [SPEAKER, '同一网段', '不改地址'], hot: true }
        : { title: '出去之后', lines: [WAN, `端口 ${SRC_PORT}`, `→ ${SITE}:${DST_PORT}`], hot: true }

  ;[left, right].forEach((card, i) => {
    const x = 28 + i * 306
    round(ctx, x, 78, 286, 250, 16)
    ctx.fillStyle = card.hot ? P.soft : P.bg2
    ctx.fill()
    ctx.lineWidth = card.hot ? 1.5 : 1
    ctx.strokeStyle = card.hot ? P.accent : P.grid
    ctx.stroke()
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = P.faint
    ctx.font = '14px ui-sans-serif, system-ui, sans-serif'
    ctx.fillText(card.title, x + 24, 114)
    ctx.fillStyle = card.hot ? P.accent : P.text
    ctx.font = '22px ui-monospace, monospace'
    ctx.fillText(card.lines[0], x + 24, 168)
    ctx.fillStyle = P.muted
    ctx.font = '15px ui-sans-serif, system-ui, sans-serif'
    ctx.fillText(card.lines[1], x + 24, 214)
    ctx.fillStyle = P.text
    ctx.font = '16px ui-monospace, monospace'
    ctx.fillText(card.lines[2], x + 24, 264)
  })

  ctx.fillStyle = P.faint
  ctx.font = '13px ui-sans-serif, system-ui, sans-serif'
  ctx.textAlign = 'left'
  const footer =
    door === 'nat'
      ? `基站对内是 ${LAN_GW}。网站看见的源是 ${WAN}，看不见 ${LAN_CLIENT}。`
      : door === 'bridge'
        ? '没有 10.0.1.1 这层。上游把地址直接发给电脑。'
        : `目的地 ${SPEAKER} 就在 10.0.1.0/24。公网地址 ${WAN} 用不上。`
  ctx.fillText(footer, 28, 372)
}

function segmentWidths(weights: number[], totalPx: number, minPx: number): number[] {
  const count = weights.length
  if (count === 0) return []
  if (minPx * count >= totalPx) return weights.map(() => totalPx / count)
  const extra = totalPx - minPx * count
  const sum = weights.reduce((acc, n) => acc + n, 0)
  return weights.map((weight) => minPx + (extra * weight) / sum)
}

function note(ctx: CanvasRenderingContext2D, P: CanvasPalette, text: string) {
  ctx.fillStyle = P.muted
  ctx.font = '13px ui-sans-serif, system-ui, sans-serif'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, 28, 28)
}

function round(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, r)
}

export const AirportWidget: WidgetDefinition<AirportProps> = {
  type: 'airport',
  label: 'AirPort 账本',
  description: '邻居听得见谁在说话。一条信道一次一台发射。基站共享连接时会改写源地址。',
  icon: '📡',
  defaultProps: { mode: 'hear', secure: true, bytes: 200, stations: 1, door: 'nat' },
  configSchema: [
    {
      key: 'mode',
      label: '模式',
      type: 'select',
      options: MODES.map((item) => ({ value: item.id, label: item.label })),
    },
    { key: 'secure', label: 'WPA2', type: 'checkbox' },
    { key: 'bytes', label: 'IP 包字节', type: 'range', min: 40, max: 1500, step: 10 },
    { key: 'stations', label: '台数', type: 'range', min: 1, max: 10, step: 1 },
    {
      key: 'door',
      label: '门口',
      type: 'select',
      options: DOORS.map((item) => ({ value: item.id, label: item.label })),
    },
  ],
  Component: Airport,
}
