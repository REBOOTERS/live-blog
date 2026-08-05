import { useEffect, useMemo, useState } from 'react'
import type { WidgetDefinition } from './registry'

interface GraphSearchProps {
  algorithm: 'bfs' | 'dfs'
  speed: number
}

// ---- The graph: 10 nodes laid out by BFS level so the two algorithms make a
//      vivid contrast (BFS = a wave sweeping left→right, DFS = a deep dive). ---
const NODES = [
  { id: 0, label: 'A', x: 60, y: 170 },
  { id: 1, label: 'B', x: 175, y: 80 },
  { id: 2, label: 'C', x: 175, y: 260 },
  { id: 3, label: 'D', x: 290, y: 45 },
  { id: 4, label: 'E', x: 290, y: 170 },
  { id: 5, label: 'F', x: 290, y: 295 },
  { id: 6, label: 'G', x: 405, y: 90 },
  { id: 7, label: 'H', x: 405, y: 215 },
  { id: 8, label: 'I', x: 405, y: 300 },
  { id: 9, label: 'J', x: 510, y: 170 },
]
// undirected adjacency, each list sorted ascending
const ADJ: number[][] = [
  [1, 2],
  [0, 3, 4],
  [0, 4, 5],
  [1, 6],
  [1, 2, 7],
  [2, 8],
  [3, 7],
  [4, 6, 9],
  [5, 9],
  [7, 8],
]
const EDGES: [number, number][] = []
;(function buildEdges() {
  for (let u = 0; u < ADJ.length; u++) for (const v of ADJ[u]) if (v > u) EDGES.push([u, v])
})()

const W = 560
const H = 350

interface Step {
  visitedOrder: number[]
  frontier: number[]
  current: number | null
  treeEdges: [number, number][]
  done: boolean
}

function generate(algo: 'bfs' | 'dfs', start: number, goal: number): Step[] {
  const steps: Step[] = []
  const visited: number[] = []
  const visitedSet = new Set<number>()
  const inFrontier = new Set<number>()
  const parent = new Map<number, number>()
  const treeEdges: [number, number][] = []
  const frontier: number[] = [start]
  inFrontier.add(start)
  steps.push({ visitedOrder: [], frontier: [start], current: null, treeEdges: [], done: false })

  while (frontier.length) {
    const cur = algo === 'bfs' ? frontier.shift()! : frontier.pop()!
    inFrontier.delete(cur)
    if (visitedSet.has(cur)) continue
    visitedSet.add(cur)
    visited.push(cur)
    if (parent.has(cur)) treeEdges.push([parent.get(cur)!, cur])

    // expand neighbours (sorted; DFS pushes reversed so the smallest is popped first)
    const ns = ADJ[cur].slice().sort((a, b) => a - b)
    const order = algo === 'dfs' ? ns.slice().reverse() : ns
    for (const n of order) {
      if (!visitedSet.has(n) && !inFrontier.has(n)) {
        frontier.push(n)
        inFrontier.add(n)
        parent.set(n, cur)
      }
    }

    const done = cur === goal
    steps.push({
      visitedOrder: visited.slice(),
      frontier: frontier.slice(),
      current: cur,
      treeEdges: treeEdges.slice(),
      done,
    })
    if (done) break
  }
  return steps
}

export function GraphSearch({ props }: { props: GraphSearchProps }) {
  const [algo, setAlgo] = useState(props.algorithm)
  const [speed, setSpeed] = useState(props.speed)
  useEffect(() => setAlgo(props.algorithm), [props.algorithm])
  useEffect(() => setSpeed(props.speed), [props.speed])

  const [start, setStart] = useState(0)
  const [goal, setGoal] = useState(9)
  const [pickMode, setPickMode] = useState<'start' | 'goal'>('start')
  const [idx, setIdx] = useState(0)
  const [playing, setPlaying] = useState(false)

  const steps = useMemo(() => generate(algo, start, goal), [algo, start, goal])
  useEffect(() => {
    setIdx(0)
    setPlaying(false)
  }, [algo, start, goal])

  useEffect(() => {
    if (!playing) return
    if (idx >= steps.length - 1) {
      setPlaying(false)
      return
    }
    const id = setInterval(() => {
      setIdx((i) => {
        if (i >= steps.length - 1) {
          setPlaying(false)
          return i
        }
        return i + 1
      })
    }, 1000 / speed)
    return () => clearInterval(id)
  }, [playing, speed, steps.length, idx])

  const step = steps[Math.min(idx, steps.length - 1)]
  const visitedSet = new Set(step.visitedOrder)
  const frontierSet = new Set(step.frontier)
  const treeEdgeKeys = new Set(step.treeEdges.map(([a, b]) => (a < b ? `${a}-${b}` : `${b}-${a}`)))
  // order index per node
  const orderOf = new Map<number, number>()
  step.visitedOrder.forEach((n, i) => orderOf.set(n, i + 1))

  const onNodeClick = (id: number) => {
    if (pickMode === 'start') setStart(id)
    else setGoal(id)
  }

  return (
    <div className="lb-surface">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ background: '#0a0f1e', borderRadius: 8 }}>
        {/* edges */}
        {EDGES.map(([u, v]) => {
          const a = NODES[u]
          const b = NODES[v]
          const isTree = treeEdgeKeys.has(`${Math.min(u, v)}-${Math.max(u, v)}`)
          return (
            <line
              key={`${u}-${v}`}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke={isTree ? '#6366f1' : 'rgba(148,163,184,0.18)'}
              strokeWidth={isTree ? 3 : 1.5}
            />
          )
        })}

        {/* nodes */}
        {NODES.map((n) => {
          const isStart = n.id === start
          const isGoal = n.id === goal
          const isCurrent = step.current === n.id
          const isVisited = visitedSet.has(n.id)
          const isFrontier = frontierSet.has(n.id)
          let fill = '#111a2e'
          let stroke = 'rgba(129,140,248,0.45)'
          if (isFrontier) {
            fill = 'rgba(251,191,36,0.25)'
            stroke = '#fbbf24'
          }
          if (isVisited) {
            fill = '#4f46e5'
            stroke = '#818cf8'
          }
          if (isCurrent) {
            fill = '#06b6d4'
            stroke = '#22d3ee'
          }
          return (
            <g key={n.id} onClick={() => onNodeClick(n.id)} style={{ cursor: 'pointer' }}>
              {isCurrent && <circle cx={n.x} cy={n.y} r={26} fill="none" stroke="#22d3ee" strokeWidth={1.5} opacity={0.6} />}
              {isGoal && <circle cx={n.x} cy={n.y} r={24} fill="none" stroke="#fb7185" strokeWidth={2} strokeDasharray="3 3" />}
              {isStart && <circle cx={n.x} cy={n.y} r={24} fill="none" stroke="#34d399" strokeWidth={2} />}
              <circle cx={n.x} cy={n.y} r={18} fill={fill} stroke={stroke} strokeWidth={2} />
              <text x={n.x} y={n.y + 5} textAnchor="middle" fontSize={15} fontWeight={700} fill={isVisited || isCurrent ? '#fff' : '#cbd5e1'}>
                {n.label}
              </text>
              {orderOf.has(n.id) && (
                <text x={n.x + 20} y={n.y - 14} textAnchor="middle" fontSize={11} fontWeight={700} fill="#22d3ee" fontFamily="ui-monospace, monospace">
                  {orderOf.get(n.id)}
                </text>
              )}
            </g>
          )
        })}
      </svg>

      {/* algorithm tabs + legend */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-white/10 bg-slate-950/60 p-0.5">
          {(['bfs', 'dfs'] as const).map((a) => (
            <button
              key={a}
              onClick={() => setAlgo(a)}
              className={`rounded-[6px] px-3 py-1 text-xs font-semibold transition ${
                algo === a
                  ? 'bg-gradient-to-r from-indigo-500 to-cyan-400 text-slate-950'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {a === 'bfs' ? '广度优先 BFS' : '深度优先 DFS'}
            </button>
          ))}
        </div>
        <div className="inline-flex rounded-lg border border-white/10 bg-slate-950/60 p-0.5">
          {(['start', 'goal'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setPickMode(m)}
              className={`rounded-[6px] px-2.5 py-1 text-xs font-medium transition ${
                pickMode === m ? 'bg-white/15 text-cyan-200' : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              设{m === 'start' ? '起点' : '终点'}
            </button>
          ))}
        </div>
        <span className="ml-auto font-mono text-[10px] text-slate-500">
          点击节点设置{pickMode === 'start' ? '起点' : '终点'}（绿环=起点，粉环=终点）
        </span>
      </div>

      {/* frontier visualization */}
      <div className="mt-2 rounded-lg border border-white/10 bg-slate-950/60 p-2.5">
        <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-indigo-300/80">
          {algo === 'bfs' ? '队列（先进先出 ← 从左出）' : '栈（后进先出 ← 从右出）'}
        </div>
        <div className="flex min-h-[28px] flex-wrap items-center gap-1.5">
          {step.frontier.length === 0 && step.done ? (
            <span className="font-mono text-xs text-emerald-400">✓ 到达终点 {NODES[goal].label}，搜索结束</span>
          ) : step.frontier.length === 0 ? (
            <span className="font-mono text-xs text-slate-500">前沿为空，无法继续（终点不可达）</span>
          ) : (
            step.frontier.map((id, i) => {
              const isNext = algo === 'bfs' ? i === 0 : i === step.frontier.length - 1
              return (
                <span
                  key={`${id}-${i}`}
                  className={`rounded px-2 py-0.5 font-mono text-xs ${
                    isNext ? 'bg-cyan-500/30 text-cyan-200 ring-1 ring-cyan-400' : 'bg-amber-400/15 text-amber-200'
                  }`}
                >
                  {NODES[id].label}
                </span>
              )
            })
          )}
        </div>
      </div>

      {/* transport */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          onClick={() => {
            setIdx(0)
            setPlaying(false)
          }}
          className="rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-slate-300 hover:bg-white/10"
        >
          ⏮ 重置
        </button>
        <button
          onClick={() => setIdx((i) => Math.max(0, i - 1))}
          disabled={idx === 0}
          className="rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-slate-300 hover:bg-white/10 disabled:opacity-30"
        >
          ◀ 上一步
        </button>
        <button
          onClick={() => setPlaying((p) => !p)}
          className="rounded-md bg-gradient-to-r from-indigo-500 to-cyan-400 px-4 py-1.5 text-sm font-semibold text-slate-950 shadow-[0_0_16px_-6px_rgba(99,102,241,1)] hover:brightness-110"
        >
          {playing ? '⏸ 暂停' : '▶ 播放'}
        </button>
        <button
          onClick={() => setIdx((i) => Math.min(steps.length - 1, i + 1))}
          disabled={idx >= steps.length - 1}
          className="rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-slate-300 hover:bg-white/10 disabled:opacity-30"
        >
          下一步 ▶
        </button>
        <label className="ml-auto flex items-center gap-2 text-xs text-slate-400">
          <span className="w-10 shrink-0">速度</span>
          <input
            type="range"
            min={1}
            max={12}
            step={1}
            value={speed}
            onChange={(e) => setSpeed(Number(e.target.value))}
            className="flex-1"
          />
        </label>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs text-slate-500">
        <span className="tabular-nums text-slate-400">步 {idx}/{steps.length - 1}</span>
        <span className="text-slate-600">·</span>
        <span className="tabular-nums text-slate-400">已访问 {step.visitedOrder.length}</span>
        <span className="ml-auto hidden items-center gap-3 sm:flex">
          <Legend color="#06b6d4" label="当前" />
          <Legend color="#fbbf24" label="前沿" />
          <Legend color="#4f46e5" label="已访问" />
          <Legend color="#6366f1" label="生成树边" />
        </span>
      </div>

      <p className="mt-2 text-xs text-slate-400">
        {algo === 'bfs'
          ? 'BFS 用队列，一层层向外扩散——像水波。它会先访问离起点「跳数」少的所有节点，因此在无权图里天然给出最短路径。'
          : 'DFS 用栈，沿一条路走到无路可走才回退——像走迷宫贴墙。它深入快、占内存少，常用于连通性、拓扑排序与检测环。'}
      </p>
    </div>
  )
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: color }} />
      {label}
    </span>
  )
}

export const GraphSearchWidget: WidgetDefinition<GraphSearchProps> = {
  type: 'graph-search',
  label: 'BFS / DFS 图遍历',
  description: '在同一张图上对比广度优先与深度优先，看访问顺序、前沿数据结构与生成树。',
  icon: '🌐',
  defaultProps: {
    algorithm: 'bfs',
    speed: 4,
  },
  configSchema: [
    {
      key: 'algorithm',
      label: '算法',
      type: 'select',
      options: [
        { value: 'bfs', label: '广度优先 (BFS)' },
        { value: 'dfs', label: '深度优先 (DFS)' },
      ],
    },
    { key: 'speed', label: '速度', type: 'range', min: 1, max: 12, step: 1, unit: '步/秒' },
  ],
  Component: GraphSearch,
}
