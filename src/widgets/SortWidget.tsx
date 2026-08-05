import { useEffect, useMemo, useState } from 'react'
import type { WidgetDefinition } from './registry'

interface SortProps {
  count: number
  algorithm: 'bubble' | 'selection' | 'insertion' | 'quick'
  speed: number // steps per second
}

type Step = {
  array: number[]
  compare?: [number, number]
  swap?: [number, number]
  pivot?: number
  sorted: number[]
  done?: boolean
}

const ALGOS: { value: SortProps['algorithm']; label: string; complex: string }[] = [
  { value: 'bubble', label: '冒泡', complex: 'O(n²)' },
  { value: 'selection', label: '选择', complex: 'O(n²)' },
  { value: 'insertion', label: '插入', complex: 'O(n²)' },
  { value: 'quick', label: '快排', complex: 'O(n log n)' },
]

function generateSteps(algo: SortProps['algorithm'], input: number[]): Step[] {
  const a = input.slice()
  const steps: Step[] = []
  const sorted: number[] = []
  const push = (extra: Partial<Step> = {}) => steps.push({ array: a.slice(), sorted: sorted.slice(), ...extra })
  push()

  if (algo === 'bubble') {
    for (let i = 0; i < a.length - 1; i++) {
      for (let j = 0; j < a.length - 1 - i; j++) {
        push({ compare: [j, j + 1] })
        if (a[j] > a[j + 1]) {
          ;[a[j], a[j + 1]] = [a[j + 1], a[j]]
          push({ swap: [j, j + 1] })
        }
      }
      sorted.push(a.length - 1 - i)
    }
    for (let k = 0; k < a.length; k++) if (!sorted.includes(k)) sorted.push(k)
  } else if (algo === 'selection') {
    for (let i = 0; i < a.length; i++) {
      let min = i
      for (let j = i + 1; j < a.length; j++) {
        push({ compare: [min, j], pivot: i })
        if (a[j] < a[min]) min = j
      }
      if (min !== i) {
        ;[a[i], a[min]] = [a[min], a[i]]
        push({ swap: [i, min] })
      }
      sorted.push(i)
    }
  } else if (algo === 'insertion') {
    sorted.push(0)
    for (let i = 1; i < a.length; i++) {
      let j = i
      while (j > 0) {
        push({ compare: [j - 1, j] })
        if (a[j - 1] > a[j]) {
          ;[a[j - 1], a[j]] = [a[j], a[j - 1]]
          push({ swap: [j - 1, j] })
          j--
        } else break
      }
      sorted.push(i)
    }
  } else if (algo === 'quick') {
    const qs = (lo: number, hi: number) => {
      if (lo >= hi) {
        if (lo === hi) sorted.push(lo)
        return
      }
      const pivot = a[hi]
      push({ pivot: hi })
      let i = lo
      for (let j = lo; j < hi; j++) {
        push({ compare: [j, hi], pivot: hi })
        if (a[j] < pivot) {
          if (i !== j) {
            ;[a[i], a[j]] = [a[j], a[i]]
            push({ swap: [i, j], pivot: hi })
          }
          i++
        }
      }
      ;[a[i], a[hi]] = [a[hi], a[i]]
      push({ swap: [i, hi], pivot: i })
      sorted.push(i)
      qs(lo, i - 1)
      qs(i + 1, hi)
    }
    qs(0, a.length - 1)
  }

  for (let k = 0; k < a.length; k++) if (!sorted.includes(k)) sorted.push(k)
  push({ done: true })
  return steps
}

const BAR_AREA = 204 // px reserved for bars (leaves headroom for value labels)

function Sort({ props }: { props: SortProps }) {
  const { count: countProp, algorithm: algoProp, speed: speedProp } = props
  // Mirror props into local state so readers can switch algorithms / tune size
  // & speed directly; the editor's ConfigPanel still drives the saved default.
  const [algorithm, setAlgorithm] = useState<SortProps['algorithm']>(algoProp)
  const [count, setCount] = useState(countProp)
  const [speed, setSpeed] = useState(speedProp)
  useEffect(() => setAlgorithm(algoProp), [algoProp])
  useEffect(() => setCount(countProp), [countProp])
  useEffect(() => setSpeed(speedProp), [speedProp])

  const [seed, setSeed] = useState(0)
  const steps = useMemo(() => {
    // deterministic-ish random via seed
    let s = seed * 9301 + 49297
    const rng = () => {
      s = (s * 9301 + 49297) % 233280
      return s / 233280
    }
    const arr = Array.from({ length: count }, () => Math.floor(rng() * 90) + 10)
    return generateSteps(algorithm, arr)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count, algorithm, seed])

  const [idx, setIdx] = useState(0)
  const [playing, setPlaying] = useState(false)

  useEffect(() => {
    setIdx(0)
    setPlaying(false)
  }, [count, algorithm, seed])

  useEffect(() => {
    if (!playing) return
    if (idx >= steps.length - 1) {
      setPlaying(false)
      return
    }
    const interval = setInterval(() => {
      setIdx((i) => {
        if (i >= steps.length - 1) {
          setPlaying(false)
          return i
        }
        return i + 1
      })
    }, 1000 / speed)
    return () => clearInterval(interval)
  }, [playing, speed, steps.length, idx])

  const step = steps[Math.min(idx, steps.length - 1)]
  const max = Math.max(...step.array)
  const showLabels = count <= 30
  const activeAlgo = ALGOS.find((a) => a.value === algorithm)!

  const stepForward = () => setIdx((i) => Math.min(steps.length - 1, i + 1))
  const stepBack = () => setIdx((i) => Math.max(0, i - 1))
  const reset = () => {
    setIdx(0)
    setPlaying(false)
  }

  const comparisons = steps.slice(0, idx + 1).filter((s) => s.compare).length
  const swaps = steps.slice(0, idx + 1).filter((s) => s.swap).length

  return (
    <div className="lb-surface">
      {/* algorithm tabs */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-white/10 bg-slate-950/60 p-0.5">
          {ALGOS.map((a) => (
            <button
              key={a.value}
              onClick={() => setAlgorithm(a.value)}
              className={`rounded-[6px] px-3 py-1 text-sm font-medium transition-colors ${
                algorithm === a.value
                  ? 'bg-gradient-to-r from-indigo-500 to-cyan-400 text-slate-950 shadow-[0_0_14px_-4px_rgba(99,102,241,0.9)]'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {a.label}
            </button>
          ))}
        </div>
        <span className="ml-auto rounded-full border border-indigo-400/30 bg-indigo-500/10 px-2.5 py-1 font-mono text-xs text-indigo-300">
          平均 {activeAlgo.complex}
        </span>
      </div>

      {/* chart */}
      <div
        className="flex gap-[3px] rounded-lg border border-white/5 bg-slate-950/60 px-2 pt-2"
        style={{ height: 224 }}
      >
        {step.array.map((v, i) => {
          const isCompare = step.compare?.includes(i)
          const isSwap = step.swap?.includes(i)
          const isPivot = step.pivot === i
          const isSorted = step.sorted.includes(i)
          let bg = '#6366f1'
          if (isSorted) bg = '#34d399'
          if (isCompare) bg = '#fbbf24'
          if (isSwap) bg = '#fb7185'
          if (isPivot) bg = '#f472b6'
          if (step.done) bg = '#34d399'
          return (
            <div key={i} className="flex flex-1 flex-col justify-end">
              <div
                className="relative w-full rounded-t transition-[height] duration-100"
                style={{
                  height: `${(v / max) * BAR_AREA}px`,
                  background: bg,
                  boxShadow: isSwap || isPivot ? `0 0 12px ${bg}` : undefined,
                }}
                title={`${v}`}
              >
                {showLabels && (
                  <span
                    className="pointer-events-none absolute inset-x-0 top-1 text-center text-[10px] font-bold leading-none tabular-nums text-slate-900"
                    style={{ textShadow: '0 1px 0 rgba(255,255,255,0.55)' }}
                  >
                    {v}
                  </span>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* transport */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          onClick={reset}
          className="rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-slate-300 hover:bg-white/10"
        >
          ⏮ 重置
        </button>
        <button
          onClick={stepBack}
          disabled={idx === 0}
          className="rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-slate-300 hover:bg-white/10 disabled:opacity-30"
        >
          ◀ 上一步
        </button>
        <button
          onClick={() => setPlaying((p) => !p)}
          className="rounded-md bg-gradient-to-r from-indigo-500 to-cyan-400 px-4 py-1.5 text-sm font-semibold text-slate-950 shadow-[0_0_16px_-6px_rgba(99,102,241,1)] transition hover:brightness-110"
        >
          {playing ? '⏸ 暂停' : '▶ 播放'}
        </button>
        <button
          onClick={stepForward}
          disabled={idx >= steps.length - 1}
          className="rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-slate-300 hover:bg-white/10 disabled:opacity-30"
        >
          下一步 ▶
        </button>
        <button
          onClick={() => setSeed((s) => s + 1)}
          className="ml-auto rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-slate-300 hover:bg-white/10"
        >
          🎲 新数组
        </button>
      </div>

      {/* size & speed sliders */}
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="flex items-center gap-2 text-xs text-slate-400">
          <span className="w-16 shrink-0">数组长度</span>
          <input
            type="range"
            min={6}
            max={48}
            step={1}
            value={count}
            onChange={(e) => setCount(Number(e.target.value))}
            className="flex-1"
          />
          <span className="w-6 text-right font-mono tabular-nums text-slate-300">{count}</span>
        </label>
        <label className="flex items-center gap-2 text-xs text-slate-400">
          <span className="w-16 shrink-0">速度</span>
          <input
            type="range"
            min={1}
            max={60}
            step={1}
            value={speed}
            onChange={(e) => setSpeed(Number(e.target.value))}
            className="flex-1"
          />
          <span className="w-12 text-right font-mono tabular-nums text-slate-300">{speed}/s</span>
        </label>
      </div>

      {/* stats */}
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs text-slate-500">
        <span className="tabular-nums text-slate-400">
          进度 {idx}/{steps.length - 1}
        </span>
        <span className="text-slate-600">·</span>
        <span className="tabular-nums text-slate-400">比较 {comparisons}</span>
        <span className="text-slate-600">·</span>
        <span className="tabular-nums text-slate-400">交换 {swaps}</span>
        <span className="ml-auto hidden items-center gap-3 sm:flex">
          <Legend color="#fbbf24" label="比较" />
          <Legend color="#fb7185" label="交换" />
          <Legend color="#f472b6" label="基准" />
          <Legend color="#34d399" label="已排序" />
        </span>
      </div>
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

export const SortWidget: WidgetDefinition<SortProps> = {
  type: 'sort',
  label: '排序可视化',
  description: '逐帧观察经典排序算法的比较与交换过程。',
  icon: '📊',
  defaultProps: {
    count: 24,
    algorithm: 'bubble',
    speed: 12,
  },
  configSchema: [
    { key: 'count', label: '数组长度', type: 'range', min: 6, max: 48, step: 1 },
    {
      key: 'algorithm',
      label: '算法',
      type: 'select',
      options: [
        { value: 'bubble', label: '冒泡排序' },
        { value: 'selection', label: '选择排序' },
        { value: 'insertion', label: '插入排序' },
        { value: 'quick', label: '快速排序' },
      ],
    },
    { key: 'speed', label: '速度', type: 'range', min: 1, max: 60, step: 1, unit: '步/秒' },
  ],
  Component: Sort,
}
