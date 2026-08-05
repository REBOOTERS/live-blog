import { getWidget } from '../widgets/registry'

interface Props {
  type: string
  props: Record<string, unknown>
}

/** Renders a widget instance in read/play mode. */
export function WidgetView({ type, props }: Props) {
  const def = getWidget(type)
  if (!def) {
    return (
      <div className="my-6 rounded-xl border border-dashed border-rose-400/40 bg-rose-500/10 p-4 text-sm text-rose-300">
        未知的交互组件：{type}
      </div>
    )
  }
  const Comp = def.Component as React.ComponentType<{ props: Record<string, unknown> }>
  return (
    <figure className="my-8">
      <div className="mb-2 flex items-center gap-2 font-mono text-[11px]">
        <span className="inline-flex items-center gap-1.5 rounded-md border border-indigo-400/30 bg-indigo-500/10 px-2 py-0.5 font-semibold uppercase tracking-wider text-indigo-300">
          <span className="h-1.5 w-1.5 rounded-full bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.9)]" />
          {def.label}
        </span>
        <span className="rounded-md border border-cyan-400/30 bg-cyan-500/10 px-2 py-0.5 font-semibold uppercase tracking-wider text-cyan-300">
          可交互
        </span>
      </div>
      <Comp props={props} />
      <figcaption className="mt-2.5 text-sm text-slate-400">{def.description}</figcaption>
    </figure>
  )
}
