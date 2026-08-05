import { useEffect, useMemo, useRef, useState } from 'react'
import { prepareCanvas } from '../lib/canvas'
import type { WidgetDefinition } from './registry'

interface GraphSearchProps {
  algorithm: 'bfs' | 'dfs'
  speed: number
}

// ---- Maze dimensions (rooms grid; display grid is 2R+1 × 2C+1) ----
// Big enough that BFS wavefronts and DFS snakes look dramatically different.
const R = 10 // room rows
const C = 15 // room cols
const GROWS = 2 * R + 1
const GCOLS = 2 * C + 1
const CELL = 26 // logical px per display-grid cell
const W = GCOLS * CELL
const H = GROWS * CELL
const START = 0 // room id of top-left room
const GOAL = R * C - 1 // room id of bottom-right room

const roomId = (rr: number, cc: number) => rr * C + cc
const roomCenter = (id: number): [number, number] => {
  const rr = Math.floor(id / C)
  const cc = id % C
  return [(2 * cc + 1) * CELL, (2 * rr + 1) * CELL] // [gx, gy]
}

/** Recursive-backtracker maze → perfect maze (a tree of rooms). */
function generateMaze(seed: number): Uint8Array {
  const grid = new Uint8Array(GROWS * GCOLS).fill(1) // 1 = wall
  const at = (r: number, c: number) => r * GCOLS + c
  let s = (seed || 1) >>> 0
  const rnd = () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
  grid[at(1, 1)] = 0
  const visited = new Set<number>([at(1, 1)])
  const stack: [number, number][] = [[1, 1]]
  const dirs = [
    [-2, 0],
    [2, 0],
    [0, -2],
    [0, 2],
  ]
  while (stack.length) {
    const [r, c] = stack[stack.length - 1]
    const order = dirs.slice().sort(() => rnd() - 0.5)
    let moved = false
    for (const [dr, dc] of order) {
      const nr = r + dr
      const nc = c + dc
      if (nr >= 1 && nr <= 2 * R - 1 && nc >= 1 && nc <= 2 * C - 1 && !visited.has(at(nr, nc))) {
        grid[at(nr, nc)] = 0
        grid[at(r + dr / 2, c + dc / 2)] = 0 // carve the wall between
        visited.add(at(nr, nc))
        stack.push([nr, nc])
        moved = true
        break
      }
    }
    if (!moved) stack.pop()
  }
  return grid
}

/** Build room adjacency from the carved maze. */
function roomAdjacency(grid: Uint8Array): number[][] {
  const adj: number[][] = Array.from({ length: R * C }, () => [])
  const at = (r: number, c: number) => r * GCOLS + c
  for (let rr = 0; rr < R; rr++) {
    for (let cc = 0; cc < C; cc++) {
      const id = roomId(rr, cc)
      const gr = 2 * rr + 1
      const gc = 2 * cc + 1
      if (rr > 0 && grid[at(gr - 1, gc)] === 0) adj[id].push(roomId(rr - 1, cc))
      if (rr < R - 1 && grid[at(gr + 1, gc)] === 0) adj[id].push(roomId(rr + 1, cc))
      if (cc > 0 && grid[at(gr, gc - 1)] === 0) adj[id].push(roomId(rr, cc - 1))
      if (cc < C - 1 && grid[at(gr, gc + 1)] === 0) adj[id].push(roomId(rr, cc + 1))
    }
  }
  return adj
}

interface Step {
  visitedOrder: number[]
  frontier: number[]
  current: number | null
  done: boolean
}
interface RunResult {
  steps: Step[]
  parent: Map<number, number>
}

function runSearch(algo: 'bfs' | 'dfs', adj: number[][], start: number, goal: number): RunResult {
  const visited: number[] = []
  const visitedSet = new Set<number>()
  const inFrontier = new Set<number>()
  const parent = new Map<number, number>()
  const frontier: number[] = [start]
  const steps: Step[] = []
  inFrontier.add(start)
  steps.push({ visitedOrder: [], frontier: [start], current: null, done: false })

  while (frontier.length) {
    const cur = algo === 'bfs' ? frontier.shift()! : frontier.pop()!
    inFrontier.delete(cur)
    if (visitedSet.has(cur)) continue
    visitedSet.add(cur)
    visited.push(cur)

    const ns = adj[cur].slice().sort((a, b) => a - b)
    const order = algo === 'dfs' ? ns.slice().reverse() : ns
    for (const n of order) {
      if (!visitedSet.has(n) && !inFrontier.has(n)) {
        frontier.push(n)
        inFrontier.add(n)
        parent.set(n, cur)
      }
    }
    const done = cur === goal
    steps.push({ visitedOrder: visited.slice(), frontier: frontier.slice(), current: cur, done })
    if (done) break
  }
  return { steps, parent }
}

export function GraphSearch({ props }: { props: GraphSearchProps }) {
  const [algo, setAlgo] = useState(props.algorithm)
  const [speed, setSpeed] = useState(props.speed)
  useEffect(() => setAlgo(props.algorithm), [props.algorithm])
  useEffect(() => setSpeed(props.speed), [props.speed])

  const [seed, setSeed] = useState(1)
  const [idx, setIdx] = useState(0)
  const [playing, setPlaying] = useState(false)

  const { grid, steps, parent } = useMemo(() => {
    const g = generateMaze(seed)
    const a = roomAdjacency(g)
    const { steps: st, parent: pt } = runSearch(algo, a, START, GOAL)
    return { grid: g, steps: st, parent: pt }
  }, [algo, seed])

  useEffect(() => {
    setIdx(0)
    setPlaying(false)
  }, [algo, seed])

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

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const step = steps[Math.min(idx, steps.length - 1)]

  // reconstruct path to goal once done
  const pathSet = useMemo(() => {
    const ps = new Set<number>()
    if (!step.done) return ps
    let cur: number | undefined = GOAL
    while (cur !== undefined) {
      ps.add(cur)
      cur = parent.get(cur)
    }
    return ps
  }, [step.done, parent])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = prepareCanvas(canvas, W, H)
    if (!ctx) return
    const frontierSet = new Set(step.frontier)
    const orderMap = new Map<number, number>()
    step.visitedOrder.forEach((id, i) => orderMap.set(id, i))
    const total = R * C

    // walls + open rooms
    for (let r = 0; r < GROWS; r++) {
      for (let c = 0; c < GCOLS; c++) {
        const wall = grid[r * GCOLS + c] === 1
        const x = c * CELL
        const y = r * CELL
        if (wall) {
          ctx.fillStyle = '#070b16'
        } else {
          // open room cell
          const rr = (r - 1) / 2
          const cc = (c - 1) / 2
          const id = roomId(rr, cc)
          if (orderMap.has(id)) {
            const hue = (orderMap.get(id)! / total) * 280 // red→yellow→green→blue
            ctx.fillStyle = `hsl(${hue}, 78%, 55%)`
          } else if (frontierSet.has(id)) {
            ctx.fillStyle = 'rgba(251,191,36,0.85)'
          } else if (step.done && pathSet.has(id)) {
            ctx.fillStyle = '#fde68a'
          } else {
            ctx.fillStyle = '#141d33'
          }
        }
        ctx.fillRect(x, y, CELL, CELL)
      }
    }

    // current cell glow
    if (step.current !== null) {
      const [gx, gy] = roomCenter(step.current)
      ctx.fillStyle = '#ffffff'
      ctx.shadowColor = 'rgba(255,255,255,0.9)'
      ctx.shadowBlur = 16
      ctx.fillRect(gx - CELL / 2 + 3, gy - CELL / 2 + 3, CELL - 6, CELL - 6)
      ctx.shadowBlur = 0
    }

    // start (green) + goal (pink) markers
    const [sx, sy] = roomCenter(START)
    const [gx, gy] = roomCenter(GOAL)
    ctx.fillStyle = '#34d399'
    ctx.fillRect(sx - CELL / 2 + 4, sy - CELL / 2 + 4, CELL - 8, CELL - 8)
    ctx.fillStyle = '#fb7185'
    ctx.fillRect(gx - CELL / 2 + 4, gy - CELL / 2 + 4, CELL - 8, CELL - 8)

    // start/goal labels
    ctx.fillStyle = '#0a0f1e'
    ctx.font = `bold ${CELL * 0.42}px ui-monospace, monospace`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('S', sx, sy + 1)
    ctx.fillText('G', gx, gy + 1)
  }, [grid, step, pathSet])

  const frontier = step.frontier
  const frontierPreview =
    algo === 'bfs'
      ? frontier.slice(0, 14)
      : frontier.slice(-14).reverse() // stack: show top (next to pop) first

  return (
    <div className="lb-surface">
      <canvas ref={canvasRef} style={{ width: '100%', aspectRatio: `${W} / ${H}`, borderRadius: 8 }} />

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
        <button
          onClick={() => setSeed((s) => (s % 9999) + 1)}
          className="rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-300 hover:bg-white/10"
        >
          🎲 新迷宫
        </button>
        <span className="ml-auto font-mono text-[10px] text-slate-500">
          {C}×{R} 房间 · S=起点（绿）· G=终点（粉）· 颜色=访问顺序（红→蓝）
        </span>
      </div>

      {/* frontier visualization */}
      <div className="mt-2 rounded-lg border border-white/10 bg-slate-950/60 p-2.5">
        <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-indigo-300/80">
          {algo === 'bfs' ? '队列（先进先出 ← 下一個从左出）' : '栈（后进先出 ← 下一個从右出）'} · 共 {frontier.length} 个
        </div>
        <div className="flex min-h-[24px] flex-wrap items-center gap-1">
          {frontier.length === 0 && step.done ? (
            <span className="font-mono text-xs text-emerald-400">✓ 到达终点 G，搜索结束</span>
          ) : frontier.length === 0 ? (
            <span className="font-mono text-xs text-slate-500">前沿为空</span>
          ) : (
            <>
              {frontierPreview.map((id, i) => {
                const isNext = i === 0
                return (
                  <span
                    key={`${id}-${i}`}
                    className={`h-3 w-3 rounded-sm ${isNext ? 'ring-2 ring-cyan-300' : ''}`}
                    style={{ background: isNext ? '#22d3ee' : '#fbbf24' }}
                  />
                )
              })}
              {frontier.length > 14 && <span className="font-mono text-[10px] text-slate-500">…还有 {frontier.length - 14}</span>}
              <span className="ml-2 font-mono text-[10px] text-slate-500">{algo === 'bfs' ? '队首→' : '←栈顶'}</span>
            </>
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
          ◀
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
          ▶
        </button>
        <label className="ml-auto flex items-center gap-2 text-xs text-slate-400">
          <span className="w-10 shrink-0">速度</span>
          <input
            type="range"
            min={1}
            max={40}
            step={1}
            value={speed}
            onChange={(e) => setSpeed(Number(e.target.value))}
            className="w-28"
          />
        </label>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs text-slate-500">
        <span className="tabular-nums text-slate-400">步 {idx}/{steps.length - 1}</span>
        <span className="text-slate-600">·</span>
        <span className="tabular-nums text-slate-400">已访问 {step.visitedOrder.length}</span>
        {step.done && (
          <span className="text-cyan-300">
            · 到 G 路径长度 {pathSet.size} 步{algo === 'bfs' ? '（最短）' : '（非最短）'}
          </span>
        )}
      </div>

      <p className="mt-2 text-xs text-slate-400">
        {algo === 'bfs'
          ? 'BFS 用队列，一层层向外扩散——按访问顺序上色后形成一圈圈彩虹波纹。到达 G 时即为最短路径（金色）。'
          : 'DFS 用栈，沿一条路扎到底再回退——按访问顺序上色后像一条蜿蜒的长蛇。它快但到 G 的路通常更长。'}
      </p>
    </div>
  )
}

export const GraphSearchWidget: WidgetDefinition<GraphSearchProps> = {
  type: 'graph-search',
  label: 'BFS / DFS 迷宫遍历',
  description: '在随机迷宫上对比 BFS（彩虹波纹）与 DFS（蜿蜒长蛇），看访问顺序、前沿与最短路径。',
  icon: '🌐',
  defaultProps: {
    algorithm: 'bfs',
    speed: 20,
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
    { key: 'speed', label: '速度', type: 'range', min: 1, max: 40, step: 1, unit: '步/秒' },
  ],
  Component: GraphSearch,
}
