import { useEffect, useMemo, useRef, useState } from 'react'
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

function Sort({ props }: { props: SortProps }) {
  const { count, algorithm, speed } = props
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
  const idxRef = useRef(0)
  idxRef.current = idx

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

  const stepForward = () => setIdx((i) => Math.min(steps.length - 1, i + 1))
  const stepBack = () => setIdx((i) => Math.max(0, i - 1))
  const reset = () => {
    setIdx(0)
    setPlaying(false)
  }

  const comparisons = steps.slice(0, idx + 1).filter((s) => s.compare).length
  const swaps = steps.slice(0, idx + 1).filter((s) => s.swap).length

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <div className="flex items-end gap-[3px]" style={{ height: 220 }}>
        {step.array.map((v, i) => {
          const isCompare = step.compare?.includes(i)
          const isSwap = step.swap?.includes(i)
          const isPivot = step.pivot === i
          const isSorted = step.sorted.includes(i)
          let bg = '#a5b4fc'
          if (isSorted) bg = '#34d399'
          if (isCompare) bg = '#fbbf24'
          if (isSwap) bg = '#f87171'
          if (isPivot) bg = '#f472b6'
          if (step.done) bg = '#34d399'
          return (
            <div
              key={i}
              className="flex-1 rounded-t transition-[height] duration-100"
              style={{ height: `${(v / max) * 100}%`, background: bg }}
              title={`${v}`}
            />
          )
        })}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          onClick={reset}
          className="rounded-md bg-slate-100 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-200"
        >
          ⏮ 重置
        </button>
        <button
          onClick={stepBack}
          disabled={idx === 0}
          className="rounded-md bg-slate-100 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-200 disabled:opacity-40"
        >
          ◀ 上一步
        </button>
        <button
          onClick={() => setPlaying((p) => !p)}
          className="rounded-md bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
        >
          {playing ? '⏸ 暂停' : '▶ 播放'}
        </button>
        <button
          onClick={stepForward}
          disabled={idx >= steps.length - 1}
          className="rounded-md bg-slate-100 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-200 disabled:opacity-40"
        >
          下一步 ▶
        </button>
        <button
          onClick={() => setSeed((s) => s + 1)}
          className="ml-auto rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
        >
          🎲 新数组
        </button>
      </div>

      <div className="mt-2 flex items-center gap-3 text-xs text-slate-500">
        <span>进度 {idx}/{steps.length - 1}</span>
        <span>·</span>
        <span>比较 {comparisons}</span>
        <span>·</span>
        <span>交换 {swaps}</span>
      </div>
    </div>
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
    speed: 8,
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
