import { useEffect, useMemo, useRef, useState } from 'react'
import { prepareCanvas, palette, type CanvasPalette } from '../lib/canvas'
import { useTheme } from '../lib/theme'
import type { WidgetDefinition } from './registry'

/**
 * 教学账本：边缘路由器的映射表、UDP 打洞、打不通时的中继隧道。
 * 不是某一台家用路由或 Tailscale / WebRTC 的抓包。
 *
 * 门口固定（endpoint-independent mapping）：同一内网套接字对外只占一个公网端口。
 * 对称（address-and-port-dependent）：每换一个目的地址:端口，就新开一行公网端口。
 * STUN 只能看见「我对 STUN 说话时」那一行。对称 NAT 上，这一行不是打给对端的那一行。
 */

export const ALICE_LAN = '10.0.0.2'
export const ALICE_WAN = '198.51.100.8'
export const BOB_LAN = '10.8.0.2'
export const BOB_WAN = '203.0.113.50'
export const STUN = '192.0.2.99'
export const RELAY = '192.0.2.33'
export const LOCAL_PORT = 41641
export const STUN_PORT = 3478
export const EASY_PORT = 41641
export const SYM_TO_STUN = 52001
export const SYM_TO_PEER = 52002
export const RELAY_PORT = 443

const W = 640
const H = 440

export type EdgeMode = 'edge' | 'punch' | 'relay'
export type NatKind = 'easy' | 'sym'
export type EdgeSide = 'none' | 'out' | 'in'

interface EdgePunchProps {
  mode: EdgeMode
  nat: NatKind
  peerNat: NatKind
  side: EdgeSide
}

const MODES: { id: EdgeMode; label: string }[] = [
  { id: 'edge', label: '门口' },
  { id: 'punch', label: '打洞' },
  { id: 'relay', label: '中继' },
]

const NATS: { id: NatKind; label: string }[] = [
  { id: 'easy', label: '门口固定' },
  { id: 'sym', label: '对称' },
]

const SIDES: { id: EdgeSide; label: string }[] = [
  { id: 'none', label: '空表' },
  { id: 'out', label: '先出门' },
  { id: 'in', label: '陌生闯入' },
]

export function clampMode(mode: string): EdgeMode {
  if (mode === 'punch' || mode === 'relay' || mode === 'edge') return mode
  return 'edge'
}

export function clampNat(nat: string): NatKind {
  return nat === 'sym' ? 'sym' : 'easy'
}

export function clampSide(side: string): EdgeSide {
  if (side === 'out' || side === 'in' || side === 'none') return side
  return 'none'
}

export function publicPort(nat: NatKind, dest: 'stun' | 'peer'): number {
  if (nat === 'easy') return EASY_PORT
  return dest === 'stun' ? SYM_TO_STUN : SYM_TO_PEER
}

export function endpoint(wan: string, nat: NatKind, dest: 'stun' | 'peer'): string {
  return `${wan}:${publicPort(nat, dest)}`
}

export function punchWorks(nat: NatKind, peerNat: NatKind): boolean {
  return nat === 'easy' && peerNat === 'easy'
}

export function edgeHeadline(side: EdgeSide): string {
  if (side === 'none') {
    return `空表。外面发给 ${ALICE_WAN}:${LOCAL_PORT} 的包，门口直接丢掉。`
  }
  if (side === 'out') {
    return `甲先出门。表上写下 ${ALICE_LAN}:${LOCAL_PORT} → ${ALICE_WAN}:${EASY_PORT}。回程能进门。`
  }
  return `没有这一行时，陌生包进不来。门口不是交换机，是带表的门。`
}

export function punchHeadline(nat: NatKind, peerNat: NatKind): string {
  if (punchWorks(nat, peerNat)) {
    return `两边都是门口固定。打洞成功，直连 ${endpoint(ALICE_WAN, 'easy', 'peer')} ↔ ${endpoint(BOB_WAN, 'easy', 'peer')}。`
  }
  if (nat === 'sym' && peerNat === 'sym') {
    return `两边都是对称。STUN 看见的端口不是打给对端的端口。直连失败。`
  }
  if (nat === 'sym') {
    return `甲是对称。乙按 STUN 打来的 ${ALICE_WAN}:${SYM_TO_STUN}，打错门。直连失败。`
  }
  return `乙是对称。甲按 STUN 打来的 ${BOB_WAN}:${SYM_TO_STUN}，打错门。直连失败。`
}

export function relayHeadline(nat: NatKind, peerNat: NatKind): string {
  if (punchWorks(nat, peerNat)) {
    return `直连已经通。中继是备胎，这一跳可以不走 ${RELAY}。`
  }
  return `直连失败。包改走中继 ${RELAY}:${RELAY_PORT}，两跳到对端。`
}

function headline(props: EdgePunchProps): string {
  if (props.mode === 'punch') return punchHeadline(props.nat, props.peerNat)
  if (props.mode === 'relay') return relayHeadline(props.nat, props.peerNat)
  return edgeHeadline(props.side)
}

function detail(props: EdgePunchProps): string {
  if (props.mode === 'edge') {
    if (props.side === 'out') {
      return `甲从 ${ALICE_LAN}:${LOCAL_PORT} 发到公网。边缘路由器把源改成 ${ALICE_WAN}:${EASY_PORT}，并记住这一行。对端回同一行，门口才放行。`
    }
    if (props.side === 'in') {
      return `外面有人直接往 ${ALICE_WAN}:${LOCAL_PORT} 砸。表里没有「谁先出门」的记录，包在门口被丢。这就是家里那台路由默认不做端口映射时的样子。`
    }
    return `边缘路由器对外只出示 ${ALICE_WAN}。内网 ${ALICE_LAN} 出不了门，除非表上有一行。空表时，入站全拒。`
  }
  if (props.mode === 'punch') {
    const aStun = endpoint(ALICE_WAN, props.nat, 'stun')
    const bStun = endpoint(BOB_WAN, props.peerNat, 'stun')
    const aPeer = endpoint(ALICE_WAN, props.nat, 'peer')
    const bPeer = endpoint(BOB_WAN, props.peerNat, 'peer')
    if (punchWorks(props.nat, props.peerNat)) {
      return `STUN 回报 ${aStun} 与 ${bStun}。门口固定时，打给对端仍是这两个端口。两边各发一包，映射互相打开。`
    }
    return `STUN 回报 ${aStun} 与 ${bStun}。真打对端时，对称侧实际是 ${props.nat === 'sym' ? aPeer : aStun} 对 ${props.peerNat === 'sym' ? bPeer : bStun}。通报出去的端口对不上。`
  }
  if (punchWorks(props.nat, props.peerNat)) {
    return `中继路径是甲 → ${RELAY} → 乙，多一跳。直连通的时候，账本仍画出中继，但不走它。`
  }
  return `甲把密文 UDP 发给 ${RELAY}:${RELAY_PORT}，中继再转给乙的会话。沿途看见的是中继，不是对端的家用宽带。延迟多一跳，但洞不用打通。`
}

function EdgePunch({ props }: { props: EdgePunchProps }) {
  const theme = useTheme()
  const [mode, setMode] = useState<EdgeMode>(clampMode(props.mode))
  const [nat, setNat] = useState<NatKind>(clampNat(props.nat))
  const [peerNat, setPeerNat] = useState<NatKind>(clampNat(props.peerNat))
  const [side, setSide] = useState<EdgeSide>(clampSide(props.side))

  useEffect(() => setMode(clampMode(props.mode)), [props.mode])
  useEffect(() => setNat(clampNat(props.nat)), [props.nat])
  useEffect(() => setPeerNat(clampNat(props.peerNat)), [props.peerNat])
  useEffect(() => setSide(clampSide(props.side)), [props.side])

  const view = useMemo<EdgePunchProps>(
    () => ({ mode, nat, peerNat, side }),
    [mode, nat, peerNat, side],
  )

  const chips =
    mode === 'edge'
      ? side === 'out'
        ? [`${ALICE_LAN}:${LOCAL_PORT}`, `→ ${ALICE_WAN}:${EASY_PORT}`, '回程放行']
        : side === 'in'
          ? [`入站 ${ALICE_WAN}:${LOCAL_PORT}`, '表中无行', '丢弃']
          : [`WAN ${ALICE_WAN}`, '映射 0 行', '入站全拒']
      : mode === 'punch'
        ? [
            `甲 ${nat === 'easy' ? '固定' : '对称'}`,
            `乙 ${peerNat === 'easy' ? '固定' : '对称'}`,
            punchWorks(nat, peerNat) ? '直连成功' : '直连失败',
          ]
        : [
            punchWorks(nat, peerNat) ? '可直连' : '需中继',
            `中继 ${RELAY}`,
            punchWorks(nat, peerNat) ? '0 跳中继' : '2 跳经中继',
          ]

  return (
    <div className="lb-surface">
      <p className="t-strong text-sm">{headline(view)}</p>
      <PunchCanvas theme={theme} view={view} />
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
        {mode === 'edge' ? (
          <div className="t-panel inline-flex flex-wrap rounded-lg p-0.5">
            {SIDES.map((item) => (
              <button
                key={item.id}
                onClick={() => setSide(item.id)}
                className={`rounded-[6px] px-2.5 py-1 text-xs font-medium transition-colors ${
                  side === item.id ? 't-btn-primary' : 't-muted'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      {mode === 'punch' || mode === 'relay' ? (
        <div className="mt-3 space-y-2">
          <NatRow label="甲的 NAT" value={nat} onChange={setNat} />
          <NatRow label="乙的 NAT" value={peerNat} onChange={setPeerNat} />
        </div>
      ) : null}
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

function NatRow({
  label,
  value,
  onChange,
}: {
  label: string
  value: NatKind
  onChange: (n: NatKind) => void
}) {
  return (
    <div className="t-muted flex flex-wrap items-center gap-2 text-xs">
      <span className="w-16 shrink-0">{label}</span>
      <div className="t-panel inline-flex flex-wrap rounded-lg p-0.5">
        {NATS.map((item) => (
          <button
            key={item.id}
            onClick={() => onChange(item.id)}
            className={`rounded-[6px] px-2.5 py-1 text-xs font-medium transition-colors ${
              value === item.id ? 't-btn-primary' : 't-muted'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>
  )
}

function PunchCanvas({ theme, view }: { theme: string; view: EdgePunchProps }) {
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
    if (view.mode === 'punch') drawPunch(ctx, P, view.nat, view.peerNat)
    else if (view.mode === 'relay') drawRelay(ctx, P, view.nat, view.peerNat)
    else drawEdge(ctx, P, view.side)
  }, [theme, view])

  return (
    <canvas
      ref={canvasRef}
      className="mt-3 touch-none"
      style={{ width: '100%', aspectRatio: `${W} / ${H}`, borderRadius: 8, touchAction: 'none' }}
    />
  )
}

function drawEdge(ctx: CanvasRenderingContext2D, P: CanvasPalette, side: EdgeSide) {
  note(ctx, P, '左边内网，中间门口，右边公网。只有表上有的回程才能进门。')

  round(ctx, 28, 70, 170, 260, 14)
  ctx.fillStyle = P.soft
  ctx.fill()
  ctx.strokeStyle = P.accent
  ctx.lineWidth = 1.5
  ctx.stroke()
  label(ctx, P, '内网', 48, 98, P.faint)
  label(ctx, P, '甲', 48, 140, P.text)
  mono(ctx, P, `${ALICE_LAN}`, 48, 168, P.accent)
  mono(ctx, P, `:${LOCAL_PORT}`, 48, 190, P.muted)

  round(ctx, 230, 70, 180, 260, 14)
  ctx.fillStyle = P.bg2
  ctx.fill()
  ctx.strokeStyle = P.warn
  ctx.lineWidth = 1.5
  ctx.stroke()
  label(ctx, P, '边缘路由器', 250, 98, P.faint)
  label(ctx, P, '映射表', 250, 128, P.text)

  if (side === 'out') {
    round(ctx, 248, 160, 144, 86, 10)
    ctx.fillStyle = P.soft
    ctx.fill()
    ctx.strokeStyle = P.accent
    ctx.lineWidth = 1
    ctx.stroke()
    mono(ctx, P, `${ALICE_LAN}:${LOCAL_PORT}`, 260, 188, P.text)
    mono(ctx, P, `→ ${ALICE_WAN}:${EASY_PORT}`, 260, 214, P.accent)
  } else {
    round(ctx, 248, 160, 144, 86, 10)
    ctx.fillStyle = P.bg
    ctx.fill()
    ctx.strokeStyle = P.grid
    ctx.lineWidth = 1
    ctx.stroke()
    label(ctx, P, side === 'in' ? '没有匹配的行' : '（空）', 260, 202, P.faint)
  }

  round(ctx, 442, 70, 170, 260, 14)
  ctx.fillStyle = P.bg2
  ctx.fill()
  ctx.strokeStyle = P.danger
  ctx.lineWidth = 1.5
  ctx.stroke()
  label(ctx, P, '公网', 462, 98, P.faint)
  mono(ctx, P, ALICE_WAN, 462, 140, P.danger)
  if (side === 'out') {
    label(ctx, P, '回程认这一行', 462, 178, P.good)
    mono(ctx, P, `:${EASY_PORT}`, 462, 206, P.good)
  } else if (side === 'in') {
    label(ctx, P, '陌生包', 462, 178, P.danger)
    mono(ctx, P, `:${LOCAL_PORT}`, 462, 206, P.danger)
    label(ctx, P, '门口丢掉', 462, 240, P.danger)
  } else {
    label(ctx, P, '入站全拒', 462, 178, P.muted)
  }

  ctx.fillStyle = P.faint
  ctx.font = '13px ui-sans-serif, system-ui, sans-serif'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  if (side === 'out') {
    ctx.fillText('出门时改写源地址，并留下一行。回来的包对得上才放行。', 28, 370)
  } else if (side === 'in') {
    ctx.fillText('没有人先从里面推开这扇门时，外面推不开。', 28, 370)
  } else {
    ctx.fillText('边缘路由器 = 对外一个地址 + 一张谁先出门的表。', 28, 370)
  }
}

function drawPunch(ctx: CanvasRenderingContext2D, P: CanvasPalette, nat: NatKind, peerNat: NatKind) {
  const ok = punchWorks(nat, peerNat)
  note(ctx, P, ok ? '两边先问 STUN，再互打。门口固定时，通报的端口就是真端口。' : '对称 NAT 上，STUN 看见的端口只对 STUN 有效。')

  // STUN top
  round(ctx, 220, 64, 200, 56, 12)
  ctx.fillStyle = P.bg2
  ctx.fill()
  ctx.strokeStyle = P.warn
  ctx.lineWidth = 1
  ctx.stroke()
  label(ctx, P, '协调 / STUN', 240, 82, P.faint)
  mono(ctx, P, STUN, 240, 104, P.warn)

  drawPeer(ctx, P, 28, 150, '甲', ALICE_LAN, ALICE_WAN, nat, true)
  drawPeer(ctx, P, 372, 150, '乙', BOB_LAN, BOB_WAN, peerNat, false)

  // arrows to STUN
  strokeArrow(ctx, P.warn, 160, 150, 250, 120)
  strokeArrow(ctx, P.warn, 480, 150, 390, 120)

  // peer attempt
  if (ok) {
    strokeArrow(ctx, P.good, 250, 280, 390, 280)
    strokeArrow(ctx, P.good, 390, 300, 250, 300)
    label(ctx, P, '直连 UDP', 292, 328, P.good)
  } else {
    strokeArrow(ctx, P.danger, 250, 280, 390, 280)
    label(ctx, P, '打错端口 / 被过滤', 268, 328, P.danger)
  }

  const aStun = publicPort(nat, 'stun')
  const bStun = publicPort(peerNat, 'stun')
  const aPeer = publicPort(nat, 'peer')
  const bPeer = publicPort(peerNat, 'peer')
  mono(ctx, P, `STUN 看见 :${aStun} 与 :${bStun}`, 28, 380, P.muted)
  mono(ctx, P, ok ? `对端互打仍是 :${aPeer} ↔ :${bPeer}` : `真打对端变成 :${aPeer} → :${bPeer}`, 28, 404, ok ? P.good : P.danger)
}

function drawRelay(ctx: CanvasRenderingContext2D, P: CanvasPalette, nat: NatKind, peerNat: NatKind) {
  const ok = punchWorks(nat, peerNat)
  note(
    ctx,
    P,
    ok ? '直连已通。中继画在上面，但不需要经过它。' : '打洞失败后，两边都只跟中继保持出门的映射。',
  )

  drawPeer(ctx, P, 28, 110, '甲', ALICE_LAN, ALICE_WAN, nat, true)
  drawPeer(ctx, P, 372, 110, '乙', BOB_LAN, BOB_WAN, peerNat, false)

  round(ctx, 230, 300, 180, 70, 12)
  ctx.fillStyle = ok ? P.bg2 : P.soft
  ctx.fill()
  ctx.strokeStyle = ok ? P.grid : P.accent
  ctx.lineWidth = ok ? 1 : 1.5
  ctx.stroke()
  label(ctx, P, '中继隧道', 250, 324, P.faint)
  mono(ctx, P, `${RELAY}:${RELAY_PORT}`, 250, 348, ok ? P.muted : P.accent)

  if (ok) {
    strokeArrow(ctx, P.good, 250, 200, 390, 200)
    label(ctx, P, '直连优先', 292, 228, P.good)
    label(ctx, P, '中继待命', 292, 390, P.faint)
  } else {
    strokeArrow(ctx, P.accent, 200, 250, 280, 300)
    strokeArrow(ctx, P.accent, 360, 300, 440, 250)
    label(ctx, P, '甲 → 中继 → 乙', 268, 390, P.accent)
  }
}

function drawPeer(
  ctx: CanvasRenderingContext2D,
  P: CanvasPalette,
  x: number,
  y: number,
  name: string,
  lan: string,
  wan: string,
  nat: NatKind,
  left: boolean,
) {
  round(ctx, x, y, 240, 130, 14)
  ctx.fillStyle = P.bg2
  ctx.fill()
  ctx.strokeStyle = nat === 'easy' ? P.accent : P.danger
  ctx.lineWidth = 1.5
  ctx.stroke()
  label(ctx, P, name, x + 18, y + 28, P.text)
  label(ctx, P, nat === 'easy' ? '门口固定' : '对称 NAT', x + 18, y + 52, nat === 'easy' ? P.accent : P.danger)
  mono(ctx, P, `内 ${lan}:${LOCAL_PORT}`, x + 18, y + 82, P.muted)
  mono(ctx, P, `外 ${wan}:${publicPort(nat, 'stun')}（STUN）`, x + 18, y + 106, P.faint)
  void left
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
  ctx.font = '14px ui-sans-serif, system-ui, sans-serif'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, x, y)
  void P
}

function mono(
  ctx: CanvasRenderingContext2D,
  P: CanvasPalette,
  text: string,
  x: number,
  y: number,
  color: string,
) {
  ctx.fillStyle = color
  ctx.font = '13px ui-monospace, monospace'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, x, y)
  void P
}

function round(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, r)
}

function strokeArrow(
  ctx: CanvasRenderingContext2D,
  color: string,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
) {
  ctx.strokeStyle = color
  ctx.fillStyle = color
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(x1, y1)
  ctx.lineTo(x2, y2)
  ctx.stroke()
  const angle = Math.atan2(y2 - y1, x2 - x1)
  ctx.beginPath()
  ctx.moveTo(x2, y2)
  ctx.lineTo(x2 - 10 * Math.cos(angle - 0.4), y2 - 10 * Math.sin(angle - 0.4))
  ctx.lineTo(x2 - 10 * Math.cos(angle + 0.4), y2 - 10 * Math.sin(angle + 0.4))
  ctx.closePath()
  ctx.fill()
}

export const EdgePunchWidget: WidgetDefinition<EdgePunchProps> = {
  type: 'edge-punch',
  label: '打洞账本',
  description: '边缘路由器靠映射表放行回程。UDP 打洞让两边互开一行。对称 NAT 打不通时，改走中继隧道。',
  icon: '🕳️',
  defaultProps: { mode: 'edge', nat: 'easy', peerNat: 'easy', side: 'none' },
  configSchema: [
    {
      key: 'mode',
      label: '模式',
      type: 'select',
      options: MODES.map((m) => ({ value: m.id, label: m.label })),
    },
    {
      key: 'nat',
      label: '甲的 NAT',
      type: 'select',
      options: NATS.map((m) => ({ value: m.id, label: m.label })),
    },
    {
      key: 'peerNat',
      label: '乙的 NAT',
      type: 'select',
      options: NATS.map((m) => ({ value: m.id, label: m.label })),
    },
    {
      key: 'side',
      label: '门口状态',
      type: 'select',
      options: SIDES.map((m) => ({ value: m.id, label: m.label })),
    },
  ],
  Component: EdgePunch,
}
