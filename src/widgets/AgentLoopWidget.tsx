import { useEffect, useMemo, useRef, useState } from 'react'
import { prepareCanvas, palette, type CanvasPalette } from '../lib/canvas'
import { useTheme } from '../lib/theme'
import type { WidgetDefinition } from './registry'

/** 教学账本的固定长度。不是任何一家公布的提示词。 */
const SYSTEM = 8_000
const USER = 120
const PARENT_PREFIX = SYSTEM + USER
const TOOL_ASSISTANT = 80
const FINAL_ASSISTANT = 200
const PLAN_ASSISTANT = 600
const EDIT_RESULT = 150
const PASS_RESULT = 80
const SUMMARY_RESULT = 400
const CHILD_FAIL_RESULT = 80
const CHILD_SYSTEM = 2_000
const CHILD_TASK = 200
const CHILD_PREFIX = CHILD_SYSTEM + CHILD_TASK
const COMPACT_SUMMARY = 1_200
const COMPACT_RATIO = 0.8
const MAX_TURNS = 16

const W = 640
const H = 408

export type AgentShape = 'loop' | 'plan' | 'subagent'
export type AgentWindow = '200k' | '1m'
type StepName = 'grep' | 'read' | 'edit' | 'test' | 'reply' | 'plan' | 'delegate' | 'summarize'
type Stop = 'ran' | 'window' | 'budget' | 'skipped'

interface AgentLoopProps {
  shape: AgentShape
  /** 搜索、读文件、失败测试输出的长度，单位：千 token */
  resultK: number
  maxTurns: number
  compact: boolean
  window: AgentWindow
}

interface Step {
  name: StepName
  assistant: number
  result: number
}

interface TurnRecord {
  name: StepName
  assistant: number
  result: number
}

interface CallSnap {
  who: 'parent' | 'child'
  index: number
  name: StepName
  input: number
  assistant: number
  result: number
  stop: Stop
  /** 这次调用发出之前新收掉的轮次 */
  folded: StepName[]
  summaryOn: boolean
}

interface ActorState {
  kept: TurnRecord[]
  summary: boolean
}

interface ActorResult {
  snaps: CallSnap[]
  nextInput: number
  state: ActorState
}

type Outcome =
  | { kind: 'done' }
  | { kind: 'window'; who: 'parent' | 'child'; index: number; input: number }
  | { kind: 'budget'; who: 'parent' | 'child'; index: number; input: number }
  | { kind: 'child'; index: number; input: number }

export interface AgentSim {
  parent: CallSnap[]
  child: CallSnap[]
  parentNext: number
  childNext: number
  parentReads: number
  childReads: number
  prefixReads: number
  outcome: Outcome
  window: number
  resultTokens: number
}

const LABEL: Record<StepName, string> = {
  grep: '搜索',
  read: '读文件',
  edit: '改文件',
  test: '跑测试',
  reply: '回答',
  plan: '写计划',
  delegate: '委托',
  summarize: '交摘要',
}

const SHORT: Record<StepName, string> = {
  grep: '搜',
  read: '读',
  edit: '改',
  test: '测',
  reply: '答',
  plan: '计',
  delegate: '委',
  summarize: '摘',
}

const SHAPES: { id: AgentShape; label: string }[] = [
  { id: 'loop', label: '单循环' },
  { id: 'plan', label: '先写计划' },
  { id: 'subagent', label: '子代理' },
]

function windowTokens(id: AgentWindow): number {
  return id === '1m' ? 1_000_000 : 200_000
}

function sumTurns(turns: TurnRecord[]): number {
  let n = 0
  for (const t of turns) n += t.assistant + t.result
  return n
}

function inputOf(prefix: number, summary: boolean, kept: TurnRecord[]): number {
  return prefix + (summary ? COMPACT_SUMMARY : 0) + sumTurns(kept)
}

function parentScript(shape: AgentShape, resultTokens: number): Step[] {
  const work: Step[] = [
    { name: 'grep', assistant: TOOL_ASSISTANT, result: resultTokens },
    { name: 'read', assistant: TOOL_ASSISTANT, result: resultTokens },
    { name: 'edit', assistant: TOOL_ASSISTANT, result: EDIT_RESULT },
    { name: 'test', assistant: TOOL_ASSISTANT, result: resultTokens },
    { name: 'read', assistant: TOOL_ASSISTANT, result: resultTokens },
    { name: 'edit', assistant: TOOL_ASSISTANT, result: EDIT_RESULT },
    { name: 'test', assistant: TOOL_ASSISTANT, result: PASS_RESULT },
    { name: 'reply', assistant: FINAL_ASSISTANT, result: 0 },
  ]
  if (shape === 'plan') {
    return [{ name: 'plan', assistant: PLAN_ASSISTANT, result: 0 }, ...work]
  }
  return work
}

function childScript(resultTokens: number): Step[] {
  return [
    { name: 'grep', assistant: TOOL_ASSISTANT, result: resultTokens },
    { name: 'read', assistant: TOOL_ASSISTANT, result: resultTokens },
    { name: 'read', assistant: TOOL_ASSISTANT, result: resultTokens },
    { name: 'summarize', assistant: SUMMARY_RESULT, result: 0 },
  ]
}

function parentSubScript(resultTokens: number): Step[] {
  return [
    { name: 'delegate', assistant: TOOL_ASSISTANT, result: SUMMARY_RESULT },
    { name: 'edit', assistant: TOOL_ASSISTANT, result: EDIT_RESULT },
    { name: 'test', assistant: TOOL_ASSISTANT, result: resultTokens },
    { name: 'edit', assistant: TOOL_ASSISTANT, result: EDIT_RESULT },
    { name: 'test', assistant: TOOL_ASSISTANT, result: PASS_RESULT },
    { name: 'reply', assistant: FINAL_ASSISTANT, result: 0 },
  ]
}

function skipped(who: 'parent' | 'child', steps: Step[], from: number): CallSnap[] {
  return steps.slice(from).map((step, offset) => ({
    who,
    index: from + offset + 1,
    name: step.name,
    input: 0,
    assistant: step.assistant,
    result: step.result,
    stop: 'skipped' as const,
    folded: [],
    summaryOn: false,
  }))
}

/**
 * 先看调用次数，再压缩，再看窗口。压缩从最旧的一轮收起，收成固定 1,200 token，至少留最近一轮。
 * 系统提示不收。
 */
function runActor(
  steps: Step[],
  prefix: number,
  who: 'parent' | 'child',
  maxTurns: number,
  window: number,
  compact: boolean,
  initial?: ActorState,
): ActorResult {
  const snaps: CallSnap[] = []
  const kept = initial ? initial.kept.map((t) => ({ ...t })) : []
  let summary = initial?.summary ?? false
  const compactAt = Math.floor(window * COMPACT_RATIO)
  let ran = 0

  const finish = (from: number): ActorResult => {
    snaps.push(...skipped(who, steps, from))
    return { snaps, nextInput: inputOf(prefix, summary, kept), state: { kept, summary } }
  }

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]
    if (ran >= maxTurns) {
      snaps.push({
        who,
        index: i + 1,
        name: step.name,
        input: inputOf(prefix, summary, kept),
        assistant: step.assistant,
        result: step.result,
        stop: 'budget',
        folded: [],
        summaryOn: summary,
      })
      return finish(i + 1)
    }

    const folded: StepName[] = []
    if (compact) {
      while (kept.length > 1 && inputOf(prefix, summary, kept) >= compactAt) {
        const removed = kept.shift()
        if (!removed) break
        folded.push(removed.name)
        summary = true
      }
    }

    const input = inputOf(prefix, summary, kept)
    if (input >= window) {
      snaps.push({
        who,
        index: i + 1,
        name: step.name,
        input,
        assistant: step.assistant,
        result: step.result,
        stop: 'window',
        folded,
        summaryOn: summary,
      })
      return { snaps: snaps.concat(skipped(who, steps, i + 1)), nextInput: input, state: { kept, summary } }
    }

    snaps.push({
      who,
      index: i + 1,
      name: step.name,
      input,
      assistant: step.assistant,
      result: step.result,
      stop: 'ran',
      folded,
      summaryOn: summary,
    })
    kept.push({ name: step.name, assistant: step.assistant, result: step.result })
    ran += 1
  }

  return { snaps, nextInput: inputOf(prefix, summary, kept), state: { kept, summary } }
}

function readsOf(snaps: CallSnap[]): number {
  let n = 0
  for (const s of snaps) if (s.stop === 'ran') n += s.input
  return n
}

function ranCount(snaps: CallSnap[]): number {
  return snaps.filter((s) => s.stop === 'ran').length
}

function firstStop(snaps: CallSnap[], kind: 'window' | 'budget'): CallSnap | undefined {
  return snaps.find((s) => s.stop === kind)
}

export function simulateAgent(
  shape: AgentShape,
  resultTokens: number,
  maxTurns: number,
  compact: boolean,
  windowId: AgentWindow,
): AgentSim {
  const window = windowTokens(windowId)
  const turns = Math.max(1, Math.min(MAX_TURNS, Math.round(maxTurns)))
  const result = Math.max(0, Math.round(resultTokens))

  if (shape !== 'subagent') {
    const actor = runActor(parentScript(shape, result), PARENT_PREFIX, 'parent', turns, window, compact)
    const windowStop = firstStop(actor.snaps, 'window')
    const budgetStop = firstStop(actor.snaps, 'budget')
    const done = actor.snaps.some((s) => s.name === 'reply' && s.stop === 'ran')
    const outcome: Outcome = done
      ? { kind: 'done' }
      : windowStop
        ? { kind: 'window', who: 'parent', index: windowStop.index, input: windowStop.input }
        : budgetStop
          ? { kind: 'budget', who: 'parent', index: budgetStop.index, input: budgetStop.input }
          : { kind: 'budget', who: 'parent', index: 1, input: PARENT_PREFIX }
    return {
      parent: actor.snaps,
      child: [],
      parentNext: actor.nextInput,
      childNext: 0,
      parentReads: readsOf(actor.snaps),
      childReads: 0,
      prefixReads: ranCount(actor.snaps) * PARENT_PREFIX,
      outcome,
      window,
      resultTokens: result,
    }
  }

  const child = runActor(childScript(result), CHILD_PREFIX, 'child', turns, window, compact)
  const childDone = child.snaps.some((s) => s.name === 'summarize' && s.stop === 'ran')
  const script = parentSubScript(result)
  const delegate: Step = childDone
    ? script[0]
    : { name: 'delegate', assistant: TOOL_ASSISTANT, result: CHILD_FAIL_RESULT }
  const first = runActor([delegate], PARENT_PREFIX, 'parent', turns, window, compact)
  const delegateRan = first.snaps[0]?.stop === 'ran'

  let parentSnaps = first.snaps
  let parentNext = first.nextInput
  let outcome: Outcome

  if (!delegateRan) {
    parentSnaps = first.snaps.concat(skipped('parent', script, 1))
    const stop = first.snaps[0]
    outcome =
      stop?.stop === 'window'
        ? { kind: 'window', who: 'parent', index: 1, input: stop.input }
        : { kind: 'budget', who: 'parent', index: 1, input: stop?.input ?? PARENT_PREFIX }
    return pack(parentSnaps, [], parentNext, 0, outcome, window, result)
  }

  if (!childDone) {
    parentSnaps = first.snaps.concat(skipped('parent', script, 1))
    const blocked = child.snaps.find((s) => s.stop === 'window' || s.stop === 'budget')
    outcome =
      blocked?.stop === 'window'
        ? { kind: 'window', who: 'child', index: blocked.index, input: blocked.input }
        : { kind: 'child', index: blocked?.index ?? child.snaps.length, input: child.nextInput }
    return pack(parentSnaps, child.snaps, parentNext, child.nextInput, outcome, window, result)
  }

  const rest = runActor(script.slice(1), PARENT_PREFIX, 'parent', turns - 1, window, compact, first.state)
  parentSnaps = shiftRest(first.snaps, rest.snaps)
  parentNext = rest.nextInput
  const windowStop = firstStop(parentSnaps, 'window')
  const budgetStop = firstStop(parentSnaps, 'budget')
  const done = parentSnaps.some((s) => s.name === 'reply' && s.stop === 'ran')
  outcome = done
    ? { kind: 'done' }
    : windowStop
      ? { kind: 'window', who: 'parent', index: windowStop.index, input: windowStop.input }
      : budgetStop
        ? { kind: 'budget', who: 'parent', index: budgetStop.index, input: budgetStop.input }
        : { kind: 'child', index: 1, input: parentNext }
  return pack(parentSnaps, child.snaps, parentNext, child.nextInput, outcome, window, result)
}

function shiftRest(first: CallSnap[], rest: CallSnap[]): CallSnap[] {
  return first.concat(rest.map((s) => ({ ...s, index: s.index + 1 })))
}

function pack(
  parent: CallSnap[],
  child: CallSnap[],
  parentNext: number,
  childNext: number,
  outcome: Outcome,
  window: number,
  resultTokens: number,
): AgentSim {
  return {
    parent,
    child,
    parentNext,
    childNext,
    parentReads: readsOf(parent),
    childReads: readsOf(child),
    prefixReads: ranCount(parent) * PARENT_PREFIX + ranCount(child) * CHILD_PREFIX,
    outcome,
    window,
    resultTokens,
  }
}

function formatToken(n: number): string {
  return Math.round(n).toLocaleString('en-US')
}

function headline(sim: AgentSim): string {
  const o = sim.outcome
  if (o.kind === 'done') {
    const calls = ranCount(sim.parent)
    return `做完了。父代理 ${calls} 次调用都发出去了。记录停在 ${formatToken(sim.parentNext)}。`
  }
  if (o.kind === 'window') {
    const who = o.who === 'child' ? '子代理' : '父代理'
    return `没做完。${who}第 ${o.index} 次要读 ${formatToken(o.input)}，窗口是 ${formatToken(sim.window)}。`
  }
  if (o.kind === 'budget') {
    const who = o.who === 'child' ? '子代理' : '父代理'
    return `没做完。${who}到第 ${o.index} 次时，外壳的调用次数用完了。`
  }
  return `没做完。子代理第 ${o.index} 次没有交回摘要，父代理停在委托之后。`
}

function callText(snap: CallSnap, window: number): string {
  const name = LABEL[snap.name]
  if (snap.stop === 'skipped') {
    return `第 ${snap.index} 次 · ${name}。前面已经停了，这次没有排上。`
  }
  if (snap.stop === 'window') {
    const folded = foldText(snap)
    return `第 ${snap.index} 次 · ${name}。没有发出。要读的是 ${formatToken(snap.input)}，窗口是 ${formatToken(window)}。${folded}`
  }
  if (snap.stop === 'budget') {
    return `第 ${snap.index} 次 · ${name}。没有发出。外壳的调用次数用完了。当时记录是 ${formatToken(snap.input)}。`
  }
  const back = snap.result === 0 ? '没有工具结果贴回来。' : `外壳贴回 ${formatToken(snap.result)}。`
  return `第 ${snap.index} 次 · ${name}。读进 ${formatToken(snap.input)}，模型写下 ${formatToken(snap.assistant)}。${back}${foldText(snap)}`
}

function foldText(snap: CallSnap): string {
  if (!snap.folded.length) return snap.summaryOn ? ' 这一轮的输入里已经有 1,200 token 的摘要。' : ''
  const names = snap.folded.map((n) => LABEL[n]).join('、')
  return ` 发出前把${names}收成 1,200 token 摘要，那些原文不在了。`
}

function draw(
  ctx: CanvasRenderingContext2D,
  P: CanvasPalette,
  sim: AgentSim,
  focusKey: string,
  compactAt: number,
) {
  ctx.clearRect(0, 0, W, H)
  ctx.fillStyle = P.bg
  ctx.fillRect(0, 0, W, H)

  ctx.fillStyle = P.text
  ctx.font = '13px ui-sans-serif, system-ui, sans-serif'
  ctx.textAlign = 'left'
  ctx.fillText('模型每次读到的上下文', 16, 26)

  ctx.fillStyle = P.muted
  ctx.font = '11px ui-sans-serif, system-ui, sans-serif'
  ctx.textAlign = 'right'
  const total = sim.parentReads + sim.childReads
  ctx.fillText(`累计读取 ${formatToken(total)}`, W - 16, 26)

  const childOn = sim.child.length > 0
  drawChart(ctx, P, sim.parent, sim.window, compactAt, focusKey, 'parent', 48, childOn ? 150 : 250)
  if (childOn) {
    ctx.fillStyle = P.muted
    ctx.font = '11px ui-sans-serif, system-ui, sans-serif'
    ctx.textAlign = 'left'
    ctx.fillText('子代理自己的上下文，不进父记录', 16, 236)
    drawChart(ctx, P, sim.child, sim.window, compactAt, focusKey, 'child', 248, 112)
  } else {
    ctx.fillStyle = P.faint
    ctx.font = '12px ui-sans-serif, system-ui, sans-serif'
    ctx.textAlign = 'left'
    const times = ranCount(sim.parent)
    ctx.fillText(
      `前缀 ${formatToken(PARENT_PREFIX)} 被读了 ${times} 次，合计 ${formatToken(times * PARENT_PREFIX)}。`,
      16,
      336,
    )
    ctx.fillText('子代理打开后，另一本账画在这里。它的大结果不会进父记录。', 16, 358)
  }
}

function drawChart(
  ctx: CanvasRenderingContext2D,
  P: CanvasPalette,
  snaps: CallSnap[],
  window: number,
  compactAt: number,
  focusKey: string,
  who: 'parent' | 'child',
  top: number,
  height: number,
) {
  const x = 54
  const width = W - 70
  ctx.fillStyle = P.bg2
  ctx.fillRect(x, top, width, height)

  ctx.strokeStyle = P.grid
  ctx.lineWidth = 1
  ctx.fillStyle = P.faint
  ctx.font = '10px ui-sans-serif, system-ui, sans-serif'
  ctx.textAlign = 'right'
  for (const frac of [0, 0.5, 1]) {
    const y = top + height - frac * height
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.lineTo(x + width, y)
    ctx.stroke()
    ctx.fillText(frac === 0 ? '0' : formatWan(window * frac), x - 4, y + 3)
  }

  if (compactAt > 0 && compactAt < window) {
    const y = top + height - (compactAt / window) * height
    ctx.strokeStyle = P.warn
    ctx.setLineDash([3, 3])
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.lineTo(x + width, y)
    ctx.stroke()
    ctx.setLineDash([])
  }

  const n = Math.max(snaps.length, 1)
  const gap = 6
  const barW = Math.min(36, (width - gap * (n + 1)) / n)
  snaps.forEach((snap, i) => {
    const bx = x + gap + i * ((width - gap) / n)
    const ratio = snap.stop === 'skipped' || window === 0 ? 0 : Math.min(1, snap.input / window)
    const bh = ratio * (height - 18)
    const by = top + height - bh
    const key = `${who}-${snap.index}`
    ctx.fillStyle =
      snap.stop === 'ran'
        ? who === 'child'
          ? P.good
          : P.accent
        : snap.stop === 'window'
          ? P.danger
          : snap.stop === 'budget'
            ? P.warn
            : P.grid
    ctx.fillRect(bx, by, barW, bh)
    if (key === focusKey) {
      ctx.strokeStyle = P.text
      ctx.lineWidth = 1.5
      ctx.strokeRect(bx - 1, by - 1, barW + 2, Math.max(bh, 1) + 2)
    }
    ctx.fillStyle = P.muted
    ctx.font = '10px ui-sans-serif, system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText(SHORT[snap.name], bx + barW / 2, top + height + 14)
  })
}

function formatWan(n: number): string {
  const w = n / 10_000
  const text = Number.isInteger(w) ? w.toFixed(0) : w.toFixed(1)
  return `${text}万`
}

function AgentLoop({ props }: { props: AgentLoopProps }) {
  const theme = useTheme()
  const [shape, setShape] = useState<AgentShape>(props.shape)
  const [resultTokens, setResultTokens] = useState(Math.round(props.resultK * 1000))
  const [maxTurns, setMaxTurns] = useState(props.maxTurns)
  const [compact, setCompact] = useState(props.compact)
  const [windowId, setWindowId] = useState<AgentWindow>(props.window)
  const [focus, setFocus] = useState<string | null>(null)

  useEffect(() => setShape(props.shape), [props.shape])
  useEffect(() => setResultTokens(Math.round(props.resultK * 1000)), [props.resultK])
  useEffect(() => setMaxTurns(props.maxTurns), [props.maxTurns])
  useEffect(() => setCompact(props.compact), [props.compact])
  useEffect(() => setWindowId(props.window), [props.window])
  useEffect(() => setFocus(null), [props.shape, props.resultK, props.maxTurns, props.compact, props.window])

  const sim = useMemo(
    () => simulateAgent(shape, resultTokens, maxTurns, compact, windowId),
    [shape, resultTokens, maxTurns, compact, windowId],
  )

  const focusKey = focus ?? defaultFocus(sim)
  const focusSnap = findSnap(sim, focusKey)

  return (
    <AgentLoopView
      theme={theme}
      sim={sim}
      compactAt={compact ? Math.floor(sim.window * COMPACT_RATIO) : 0}
      shape={shape}
      resultTokens={resultTokens}
      maxTurns={maxTurns}
      compact={compact}
      windowId={windowId}
      focusKey={focusKey}
      focusSnap={focusSnap}
      onShape={setShape}
      onResult={setResultTokens}
      onTurns={setMaxTurns}
      onCompact={setCompact}
      onWindow={setWindowId}
      onFocus={setFocus}
    />
  )
}

function defaultFocus(sim: AgentSim): string {
  const interesting = [...sim.parent].reverse().find((s) => s.stop !== 'skipped')
  if (!interesting) return 'parent-1'
  return `parent-${interesting.index}`
}

function findSnap(sim: AgentSim, key: string): CallSnap | undefined {
  const [who, indexText] = key.split('-')
  const index = Number(indexText)
  const list = who === 'child' ? sim.child : sim.parent
  return list.find((s) => s.index === index)
}

function AgentLoopView({
  theme,
  sim,
  compactAt,
  shape,
  resultTokens,
  maxTurns,
  compact,
  windowId,
  focusKey,
  focusSnap,
  onShape,
  onResult,
  onTurns,
  onCompact,
  onWindow,
  onFocus,
}: {
  theme: string
  sim: AgentSim
  compactAt: number
  shape: AgentShape
  resultTokens: number
  maxTurns: number
  compact: boolean
  windowId: AgentWindow
  focusKey: string
  focusSnap: CallSnap | undefined
  onShape: (s: AgentShape) => void
  onResult: (n: number) => void
  onTurns: (n: number) => void
  onCompact: (b: boolean) => void
  onWindow: (w: AgentWindow) => void
  onFocus: (k: string) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = prepareCanvas(canvas, W, H)
    if (!ctx) return
    draw(ctx, palette(), sim, focusKey, compactAt)
  }, [theme, sim, focusKey, compactAt])

  const total = sim.parentReads + sim.childReads

  return (
    <div className="lb-surface">
      <p className="t-strong text-sm">{headline(sim)}</p>
      <canvas
        ref={canvasRef}
        className="mt-3 touch-none"
        style={{ width: '100%', aspectRatio: `${W} / ${H}`, borderRadius: 8, touchAction: 'none' }}
      />

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <div className="t-panel inline-flex rounded-lg p-0.5">
          {SHAPES.map((item) => (
            <button
              key={item.id}
              onClick={() => onShape(item.id)}
              className={`rounded-[6px] px-2.5 py-1 text-xs font-medium transition-colors ${
                shape === item.id ? 't-btn-primary' : 't-muted'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="t-panel inline-flex rounded-lg p-0.5">
          {(['200k', '1m'] as AgentWindow[]).map((id) => (
            <button
              key={id}
              onClick={() => onWindow(id)}
              className={`rounded-[6px] px-2.5 py-1 text-xs font-medium ${windowId === id ? 't-btn-primary' : 't-muted'}`}
            >
              {id === '200k' ? '窗口 20 万' : '窗口 100 万'}
            </button>
          ))}
        </div>
        <button
          onClick={() => onCompact(!compact)}
          className={`rounded-full px-3 py-1 text-xs font-medium ${compact ? 't-btn-primary' : 't-btn'}`}
        >
          {compact ? '快满就压缩' : '不压缩'}
        </button>
      </div>

      <div className="mt-3 grid gap-x-4 gap-y-2 sm:grid-cols-2">
        <Slider label="工具结果" value={resultTokens} min={0} max={80000} step={1000} onChange={onResult} />
        <Slider label="最多调用" value={maxTurns} min={1} max={MAX_TURNS} step={1} onChange={onTurns} />
      </div>

      <TurnRow label="父" snaps={sim.parent} who="parent" focusKey={focusKey} onFocus={onFocus} />
      {sim.child.length > 0 && (
        <TurnRow label="子" snaps={sim.child} who="child" focusKey={focusKey} onFocus={onFocus} />
      )}

      <p className="t-muted mt-3 text-xs leading-5">{focusSnap ? callText(focusSnap, sim.window) : ''}</p>

      <div className="mt-3 flex flex-wrap gap-2 font-mono text-[11px] tabular-nums">
        <span className="t-panel rounded-full px-3 py-1">父上下文 {formatToken(sim.parentNext)}</span>
        <span className="t-panel rounded-full px-3 py-1">累计读取 {formatToken(total)}</span>
        <span className="t-panel rounded-full px-3 py-1">前缀重读 {formatToken(sim.prefixReads)}</span>
        {sim.child.length > 0 && (
          <span className="t-panel rounded-full px-3 py-1">子代理读取 {formatToken(sim.childReads)}</span>
        )}
      </div>
      <p className="t-faint mt-2 text-xs leading-5">
        虚线是窗口的 80%。压到这条线以下才会发出下一轮。系统提示 {formatToken(SYSTEM)} 加用户的话 {formatToken(USER)}{' '}
        是前缀，不参与压缩。滑块是搜索、读文件和失败测试的长度；改文件回执 {EDIT_RESULT}，测试通过 {PASS_RESULT}，计划{' '}
        {PLAN_ASSISTANT}，子代理交回 {SUMMARY_RESULT}。调用上限分别套在父和子身上。
      </p>
    </div>
  )
}

function TurnRow({
  label,
  snaps,
  who,
  focusKey,
  onFocus,
}: {
  label: string
  snaps: CallSnap[]
  who: 'parent' | 'child'
  focusKey: string
  onFocus: (k: string) => void
}) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-1.5">
      <span className="t-faint w-6 text-xs">{label}</span>
      {snaps.map((snap) => {
        const key = `${who}-${snap.index}`
        const on = key === focusKey
        return (
          <button
            key={key}
            onClick={() => onFocus(key)}
            className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${on ? 't-btn-primary' : 't-btn'} ${
              snap.stop === 'skipped' ? 'opacity-50' : ''
            }`}
          >
            {snap.index} {SHORT[snap.name]}
          </button>
        )
      })}
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
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
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
      <span className="t-strong w-16 text-right font-mono tabular-nums">{value.toLocaleString('en-US')}</span>
    </label>
  )
}

const SHAPE_OPTIONS = SHAPES.map((s) => ({ value: s.id, label: s.label }))

export const AgentLoopWidget: WidgetDefinition<AgentLoopProps> = {
  type: 'agent-loop',
  label: '代理循环',
  description: '拖一轮修测试：单循环、计划和子代理如何把工具结果留在上下文里，以及 20 万窗口什么时候装不下。',
  icon: '🔁',
  defaultProps: { shape: 'loop', resultK: 2, maxTurns: 12, compact: false, window: '200k' },
  configSchema: [
    { key: 'shape', label: '形状', type: 'select', options: SHAPE_OPTIONS },
    {
      key: 'window',
      label: '窗口',
      type: 'select',
      options: [
        { value: '200k', label: '20 万' },
        { value: '1m', label: '100 万' },
      ],
    },
    { key: 'compact', label: '快满就压缩', type: 'checkbox' },
    { key: 'resultK', label: '工具结果（千 token）', type: 'range', min: 0, max: 80, step: 1 },
    { key: 'maxTurns', label: '最多调用', type: 'range', min: 1, max: MAX_TURNS, step: 1 },
  ],
  Component: AgentLoop,
}
