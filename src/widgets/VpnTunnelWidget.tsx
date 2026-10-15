import { useEffect, useMemo, useRef, useState } from 'react'
import { prepareCanvas, palette, type CanvasPalette } from '../lib/canvas'
import { useTheme } from '../lib/theme'
import type { WidgetDefinition } from './registry'

/**
 * 教学账本，不是某家 VPN 的抓包。
 * 外层开销按 Donenfeld 2017-12-11 的拆法：IPv4 多 60（20+8+32），
 * 保守预留按 IPv6 的 80。32 = 类型 4 + 索引 4 + nonce 8 + Poly1305 16。
 * 全隧道仍把 192.168.1.0/24 留在局域网。「不绕开」表示去服务器的 UDP 下一跳仍是 tun。
 */

export const PATH_MTU = 1500
export const WG_BODY = 32
export const IPV4_EXTRA = 20 + 8 + WG_BODY
export const IPV6_EXTRA = 40 + 8 + WG_BODY
export const HANDSHAKE_INIT = 148
export const HANDSHAKE_RESP = 92
export const IP_UDP = 28
export const KEEPALIVE_UDP = 32

export const CLIENT = '198.51.100.8'
export const TUNNEL_IP = '10.0.0.2'
export const SITE = '192.0.2.20'
export const DNS = '192.0.2.53'
export const PRINTER = '192.168.1.20'
export const VPN = '203.0.113.10'

const WEB_INNER = 200
const DNS_INNER = 72
const PRINTER_INNER = 80

const W = 640
const H = 408

export type VpnMode = 'wrap' | 'route' | 'fit'
export type VpnScope = 'full' | 'split'
type FlowId = 'web' | 'dns' | 'printer'
type PathKind = 'tunnel' | 'direct' | 'lan' | 'loop'

interface VpnTunnelProps {
  mode: VpnMode
  encrypt: boolean
  bytes: number
  scope: VpnScope
  exclude: boolean
}

interface Flow {
  id: FlowId
  label: string
  dst: string
  inner: number
}

interface WanPacket {
  dst: string
  bytes: number
}

const FLOWS: Flow[] = [
  { id: 'web', label: '网页', dst: SITE, inner: WEB_INNER },
  { id: 'dns', label: 'DNS', dst: DNS, inner: DNS_INNER },
  { id: 'printer', label: '打印机', dst: PRINTER, inner: PRINTER_INNER },
]

const MODES: { id: VpnMode; label: string }[] = [
  { id: 'wrap', label: '封装' },
  { id: 'route', label: '路由' },
  { id: 'fit', label: '帧长' },
]

export function clampBytes(n: number): number {
  const stepped = Math.round(Number(n) / 10) * 10
  if (!Number.isFinite(stepped)) return 200
  return Math.max(40, Math.min(PATH_MTU, stepped))
}

export function outerV4(inner: number): number {
  return inner + IPV4_EXTRA
}

export function outerReserved(inner: number): number {
  return inner + IPV6_EXTRA
}

export function flowPath(id: FlowId, scope: VpnScope, exclude: boolean): PathKind {
  if (id === 'printer') return 'lan'
  if (scope === 'split') return 'direct'
  if (!exclude) return 'loop'
  return 'tunnel'
}

export function wanPackets(scope: VpnScope, exclude: boolean): WanPacket[] {
  const out: WanPacket[] = []
  for (const flow of FLOWS) {
    const path = flowPath(flow.id, scope, exclude)
    if (path === 'tunnel') out.push({ dst: VPN, bytes: outerV4(flow.inner) })
    else if (path === 'direct') out.push({ dst: flow.dst, bytes: flow.inner })
  }
  return out
}

function headline(mode: VpnMode, encrypt: boolean, bytes: number, scope: VpnScope, exclude: boolean): string {
  if (mode === 'wrap') {
    return encrypt
      ? `沿途看见的目的地址是 ${VPN}，不是 ${SITE}。`
      : `只封装：沿途读得到内层目的 ${SITE}。`
  }
  if (mode === 'fit') {
    const outer = outerReserved(bytes)
    if (outer === PATH_MTU) return `内层 ${bytes}，外层 ${PATH_MTU}，正好一帧。`
    if (outer < PATH_MTU) return `内层 ${bytes}，按 80 字节算外层 ${outer}，装进 ${PATH_MTU}。`
    return `内层 ${bytes}，按 80 字节算外层 ${outer}，装不进 ${PATH_MTU}。`
  }
  const wan = wanPackets(scope, exclude)
  if (wan.length === 0) return '公网出去 0 包。'
  if (wan.every((p) => p.dst === VPN)) return `公网出去 ${wan.length} 包，目的地都是 ${VPN}。`
  return `公网出去 ${wan.length} 包，目的地是 ${wan.map((p) => p.dst).join(' 和 ')}。`
}

function detail(mode: VpnMode, encrypt: boolean, bytes: number, scope: VpnScope, exclude: boolean): string {
  if (mode === 'wrap') {
    const wire = `外层 ${outerV4(bytes)} = ${bytes} + 20 + 8 + 32。握手线上是 ${HANDSHAKE_INIT + IP_UDP} 和 ${HANDSHAKE_RESP + IP_UDP}，keepalive 整包 ${KEEPALIVE_UDP + IP_UDP}，都不在这帧里。`
    if (encrypt) return `${wire} 前 16 字节头是明文，后 16 字节是标签。被加密的是内层那 ${bytes}。`
    return `${wire} 字节没变。内层目的现在躺在载荷里，沿途读得到。`
  }
  if (mode === 'fit') {
    const by80 = outerReserved(bytes)
    const by60 = outerV4(bytes)
    const spare80 = PATH_MTU - by80
    const spare60 = PATH_MTU - by60
    return `按 80 字节预留，外层 ${by80}，${fitPhrase(spare80)}。只算 IPv4 的 60 字节，外层 ${by60}，${fitPhrase(spare60)}。`
  }
  const web = flowPath('web', scope, exclude)
  const dns = flowPath('dns', scope, exclude)
  if (web === 'tunnel' && dns === 'tunnel') {
    return `网页 ${WEB_INNER} 上线变成 ${outerV4(WEB_INNER)}，DNS ${DNS_INNER} 变成 ${outerV4(DNS_INNER)}，外层目的都是 ${VPN}。打印机 ${PRINTER_INNER} 留在 192.168.1.0/24。`
  }
  if (web === 'loop') {
    return `网页和 DNS 封装出来的下一跳还是 tun，公网包数是 0。打印机仍在局域网。`
  }
  return `网页 ${WEB_INNER} 和 DNS ${DNS_INNER} 从物理网卡直接出去。明文 DNS 的名字在载荷里。打印机仍是 ${PRINTER_INNER}。`
}

function fitPhrase(spare: number): string {
  if (spare === 0) return '正好一帧'
  if (spare > 0) return `还空 ${spare}`
  return `超出 ${-spare}`
}

function VpnTunnel({ props }: { props: VpnTunnelProps }) {
  const theme = useTheme()
  const [mode, setMode] = useState<VpnMode>(props.mode)
  const [encrypt, setEncrypt] = useState(props.encrypt)
  const [bytes, setBytes] = useState(clampBytes(props.bytes))
  const [scope, setScope] = useState<VpnScope>(props.scope)
  const [exclude, setExclude] = useState(props.exclude)

  useEffect(() => setMode(props.mode), [props.mode])
  useEffect(() => setEncrypt(props.encrypt), [props.encrypt])
  useEffect(() => setBytes(clampBytes(props.bytes)), [props.bytes])
  useEffect(() => setScope(props.scope), [props.scope])
  useEffect(() => setExclude(props.exclude), [props.exclude])

  const view = useMemo(() => ({ mode, encrypt, bytes, scope, exclude }), [mode, encrypt, bytes, scope, exclude])

  return (
    <div className="lb-surface">
      <p className="t-strong text-sm">{headline(view.mode, view.encrypt, view.bytes, view.scope, view.exclude)}</p>
      <TunnelCanvas theme={theme} view={view} />
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
        {mode === 'wrap' && (
          <div className="t-panel inline-flex rounded-lg p-0.5">
            <Seg label="加密" on={encrypt} onClick={() => setEncrypt(true)} />
            <Seg label="只封装" on={!encrypt} onClick={() => setEncrypt(false)} />
          </div>
        )}
        {mode === 'route' && (
          <>
            <div className="t-panel inline-flex rounded-lg p-0.5">
              <Seg label="全隧道" on={scope === 'full'} onClick={() => setScope('full')} />
              <Seg label="分流" on={scope === 'split'} onClick={() => setScope('split')} />
            </div>
            <div className="t-panel inline-flex rounded-lg p-0.5">
              <Seg label="绕开服务器" on={exclude} onClick={() => setExclude(true)} />
              <Seg label="不绕开" on={!exclude} onClick={() => setExclude(false)} />
            </div>
          </>
        )}
      </div>
      {mode !== 'route' && (
        <div className="mt-3">
          <label className="t-muted flex items-center gap-2 text-xs">
            <span className="w-10 shrink-0">内层</span>
            <input
              type="range"
              min={40}
              max={PATH_MTU}
              step={10}
              value={bytes}
              onChange={(e) => setBytes(clampBytes(Number(e.target.value)))}
              className="flex-1"
            />
            <span className="t-strong w-10 text-right font-mono tabular-nums">{bytes}</span>
          </label>
        </div>
      )}
      <Chips mode={mode} encrypt={encrypt} bytes={bytes} scope={scope} exclude={exclude} />
      <p className="t-faint mt-2 text-xs leading-5">{detail(mode, encrypt, bytes, scope, exclude)}</p>
    </div>
  )
}

function Seg({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-[6px] px-2.5 py-1 text-xs font-medium transition-colors ${on ? 't-btn-primary' : 't-muted'}`}
    >
      {label}
    </button>
  )
}

function Chips({
  mode,
  encrypt,
  bytes,
  scope,
  exclude,
}: {
  mode: VpnMode
  encrypt: boolean
  bytes: number
  scope: VpnScope
  exclude: boolean
}) {
  const items =
    mode === 'wrap'
      ? [`内层 ${bytes}`, `外层 ${outerV4(bytes)}`, `沿途目的 ${encrypt ? VPN : SITE}`]
      : mode === 'fit'
        ? [`按 80：${outerReserved(bytes)}`, `按 60：${outerV4(bytes)}`]
        : routeChips(scope, exclude)
  return (
    <div className="mt-3 flex flex-wrap gap-2 font-mono text-[11px] tabular-nums">
      {items.map((item) => (
        <span key={item} className="t-panel rounded-full px-3 py-1">
          {item}
        </span>
      ))}
    </div>
  )
}

function routeChips(scope: VpnScope, exclude: boolean): string[] {
  const wan = wanPackets(scope, exclude)
  const web = flowPath('web', scope, exclude)
  const dns = flowPath('dns', scope, exclude)
  const webBytes = web === 'tunnel' ? outerV4(WEB_INNER) : web === 'direct' ? WEB_INNER : 0
  const dnsBytes = dns === 'tunnel' ? outerV4(DNS_INNER) : dns === 'direct' ? DNS_INNER : 0
  return [`公网 ${wan.length} 包`, `网页 ${webBytes}`, `DNS ${dnsBytes}`, `打印机 ${PRINTER_INNER}`]
}

function TunnelCanvas({
  theme,
  view,
}: {
  theme: string
  view: { mode: VpnMode; encrypt: boolean; bytes: number; scope: VpnScope; exclude: boolean }
}) {
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
    if (view.mode === 'wrap') drawWrap(ctx, P, view.encrypt, view.bytes)
    else if (view.mode === 'route') drawRoute(ctx, P, view.scope, view.exclude)
    else drawFit(ctx, P, view.bytes)
  }, [theme, view])

  return (
    <canvas
      ref={canvasRef}
      className="mt-3 touch-none"
      style={{ width: '100%', aspectRatio: `${W} / ${H}`, borderRadius: 8, touchAction: 'none' }}
    />
  )
}

function drawWrap(ctx: CanvasRenderingContext2D, P: CanvasPalette, encrypt: boolean, bytes: number) {
  const rows = [
    { name: '外层 IPv4', bytes: 20, sub: `${CLIENT} → ${VPN}`, tag: '明文', tone: 'clear' as const },
    { name: 'UDP', bytes: 8, sub: `载荷 ${bytes + WG_BODY}`, tag: '明文', tone: 'clear' as const },
    { name: 'WireGuard 头', bytes: 16, sub: '类型 · 索引 · 计数器', tag: '明文', tone: 'clear' as const },
    {
      name: '内层 IP 包',
      bytes,
      sub: `${TUNNEL_IP} → ${SITE}`,
      tag: encrypt ? '密文' : '明文',
      tone: encrypt ? ('secret' as const) : ('open' as const),
    },
    { name: 'Poly1305', bytes: 16, sub: '认证标签', tag: '标签', tone: 'tag' as const },
  ]
  const x = 16
  const y0 = 16
  const rowH = 58
  const gap = 8
  const rowW = 360
  rows.forEach((row, i) => {
    const y = y0 + i * (rowH + gap)
    round(ctx, x, y, rowW, rowH, 10)
    ctx.fillStyle = toneFill(P, row.tone)
    ctx.fill()
    ctx.lineWidth = 1
    ctx.strokeStyle = row.tone === 'open' ? P.warn : P.grid
    ctx.stroke()
    ctx.fillStyle = P.faint
    ctx.font = '11px ui-sans-serif, system-ui, sans-serif'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillText(row.tag, x + 14, y + 20)
    ctx.fillStyle = P.text
    ctx.font = '13px ui-sans-serif, system-ui, sans-serif'
    ctx.fillText(row.name, x + 52, y + 20)
    ctx.fillStyle = P.muted
    ctx.font = '11px ui-sans-serif, system-ui, sans-serif'
    ctx.fillText(row.sub, x + 14, y + 40)
    ctx.fillStyle = P.text
    ctx.font = '12px ui-monospace, monospace'
    ctx.textAlign = 'right'
    ctx.fillText(String(row.bytes), x + rowW - 14, y + rowH / 2)
  })

  const cards = [
    {
      title: '沿途',
      lines: encrypt
        ? ['看得见外层目的', VPN, '看得见计数器', '内层目的在密文里']
        : ['看得见外层目的', VPN, '也看得见内层', SITE],
    },
    {
      title: '出口',
      lines: ['解开后的目的', SITE, '发出时源地址换成', VPN],
    },
    {
      title: '网站',
      lines: ['看见的源地址', VPN, '看不见宽带地址', CLIENT],
    },
  ]
  cards.forEach((card, i) => {
    const y = y0 + i * 124
    round(ctx, 392, y, 232, 112, 10)
    ctx.fillStyle = P.bg2
    ctx.fill()
    ctx.fillStyle = P.text
    ctx.font = '13px ui-sans-serif, system-ui, sans-serif'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillText(card.title, 406, y + 18)
    card.lines.forEach((line, li) => {
      ctx.fillStyle = li % 2 === 0 ? P.faint : P.text
      ctx.font = li % 2 === 0 ? '11px ui-sans-serif, system-ui, sans-serif' : '12px ui-monospace, monospace'
      ctx.fillText(line, 406, y + 40 + li * 16)
    })
  })
}

function drawRoute(ctx: CanvasRenderingContext2D, P: CanvasPalette, scope: VpnScope, exclude: boolean) {
  FLOWS.forEach((flow, i) => {
    const path = flowPath(flow.id, scope, exclude)
    const y = 16 + i * 128
    round(ctx, 16, y, 608, 116, 12)
    ctx.fillStyle = P.bg2
    ctx.fill()
    ctx.fillStyle = P.text
    ctx.font = '14px ui-sans-serif, system-ui, sans-serif'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillText(flow.label, 32, y + 28)
    ctx.fillStyle = P.muted
    ctx.font = '12px ui-monospace, monospace'
    ctx.fillText(`${flow.dst}`, 32, y + 50)
    ctx.fillStyle = P.faint
    ctx.font = '11px ui-sans-serif, system-ui, sans-serif'
    ctx.fillText(`内层 ${flow.inner}`, 32, y + 72)

    const note = pathNote(flow, path)
    ctx.fillStyle = pathColor(P, path)
    ctx.font = '13px ui-sans-serif, system-ui, sans-serif'
    ctx.textAlign = 'right'
    ctx.fillText(note.title, 604, y + 36)
    ctx.fillStyle = P.muted
    ctx.font = '12px ui-sans-serif, system-ui, sans-serif'
    ctx.fillText(note.sub, 604, y + 60)
    ctx.font = '12px ui-monospace, monospace'
    ctx.fillStyle = P.text
    ctx.fillText(note.bytes, 604, y + 84)
  })
}

function pathNote(flow: Flow, path: PathKind): { title: string; sub: string; bytes: string } {
  if (path === 'tunnel') {
    return { title: '进隧道', sub: `外层目的 ${VPN}`, bytes: `线上 ${outerV4(flow.inner)}` }
  }
  if (path === 'direct') {
    return { title: '物理网卡直连', sub: '目的地址露在外面', bytes: `线上 ${flow.inner}` }
  }
  if (path === 'loop') {
    return { title: '再进 tun', sub: '下一跳还是隧道', bytes: '线上 0' }
  }
  return { title: '留在局域网', sub: '192.168.1.0/24', bytes: `线上 ${flow.inner}` }
}

function drawFit(ctx: CanvasRenderingContext2D, P: CanvasPalette, bytes: number) {
  ctx.fillStyle = P.muted
  ctx.font = '12px ui-sans-serif, system-ui, sans-serif'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillText('路径 MTU 固定 1500。条的右端超出竖线，这一帧就装不下。', 20, 28)

  drawMeter(ctx, P, 70, '按 80 字节预留', outerReserved(bytes))
  drawMeter(ctx, P, 168, '只算 IPv4 的 60', outerV4(bytes))

  const notes = [
    { inner: 1420, extra: 80, label: 'IPv6 外层时的默认' },
    { inner: 1440, extra: 60, label: '只走 IPv4 时的上限' },
  ]
  notes.forEach((note, i) => {
    const y = 276 + i * 58
    const outer = note.inner + note.extra
    const fit = outer <= PATH_MTU
    round(ctx, 20, y, 600, 48, 10)
    ctx.fillStyle = bytes === note.inner ? P.soft : P.bg2
    ctx.fill()
    ctx.fillStyle = P.text
    ctx.font = '13px ui-sans-serif, system-ui, sans-serif'
    ctx.textAlign = 'left'
    ctx.fillText(`内层 ${note.inner}  →  外层 ${outer}`, 36, y + 24)
    ctx.textAlign = 'right'
    ctx.fillStyle = fit ? P.good : P.danger
    ctx.fillText(fit ? (outer === PATH_MTU ? '正好一帧' : `还空 ${PATH_MTU - outer}`) : `超出 ${outer - PATH_MTU}`, 600, y + 24)
    ctx.textAlign = 'left'
  })
}

function drawMeter(ctx: CanvasRenderingContext2D, P: CanvasPalette, y: number, label: string, outer: number) {
  const x = 20
  const w = 600
  const scale = w / 1600
  const limit = PATH_MTU * scale
  const bw = Math.min(outer, 1600) * scale
  ctx.fillStyle = P.muted
  ctx.font = '12px ui-sans-serif, system-ui, sans-serif'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillText(`${label}  ·  外层 ${outer}`, x, y)

  const barY = y + 16
  round(ctx, x, barY, w, 26, 6)
  ctx.fillStyle = P.bg2
  ctx.fill()
  ctx.save()
  round(ctx, x, barY, w, 26, 6)
  ctx.clip()
  ctx.fillStyle = P.accent
  ctx.fillRect(x, barY, Math.min(bw, limit), 26)
  if (bw > limit) {
    ctx.fillStyle = P.danger
    ctx.fillRect(x + limit, barY, bw - limit, 26)
  }
  ctx.restore()
  ctx.strokeStyle = P.text
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(x + limit, barY - 4)
  ctx.lineTo(x + limit, barY + 30)
  ctx.stroke()
  ctx.fillStyle = P.faint
  ctx.font = '11px ui-monospace, monospace'
  ctx.textAlign = 'center'
  ctx.fillText('1500', x + limit, barY + 44)
}

function toneFill(P: CanvasPalette, tone: 'clear' | 'secret' | 'open' | 'tag'): string {
  if (tone === 'secret') return P.soft
  if (tone === 'open') return P.bg2
  if (tone === 'tag') return P.bg2
  return P.bg2
}

function pathColor(P: CanvasPalette, path: PathKind): string {
  if (path === 'tunnel') return P.accent
  if (path === 'direct') return P.warn
  if (path === 'loop') return P.danger
  return P.good
}

function round(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, r)
}

export const VpnTunnelWidget: WidgetDefinition<VpnTunnelProps> = {
  type: 'vpn-tunnel',
  label: '封包账本',
  description: '看一封内层 IP 包怎么套进 UDP，路由让哪几包进隧道，以及 1500 的帧装得下多大的内层。',
  icon: '📦',
  defaultProps: { mode: 'wrap', encrypt: true, bytes: 200, scope: 'full', exclude: true },
  configSchema: [
    {
      key: 'mode',
      label: '模式',
      type: 'select',
      options: MODES.map((m) => ({ value: m.id, label: m.label })),
    },
    { key: 'encrypt', label: '加密内层', type: 'checkbox' },
    { key: 'bytes', label: '内层字节', type: 'range', min: 40, max: PATH_MTU, step: 10 },
    {
      key: 'scope',
      label: '路由',
      type: 'select',
      options: [
        { value: 'full', label: '全隧道' },
        { value: 'split', label: '分流' },
      ],
    },
    { key: 'exclude', label: '绕开服务器', type: 'checkbox' },
  ],
  Component: VpnTunnel,
}
