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
        <span
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 font-semibold uppercase tracking-wider"
          style={{ border: '1px solid var(--lb-border)', background: 'rgba(99,102,241,0.1)', color: 'var(--lb-accent-2)' }}
        >
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'var(--lb-accent)', boxShadow: '0 0 8px var(--lb-accent)' }} />
          {def.label}
        </span>
        <span
          className="rounded-md px-2 py-0.5 font-semibold uppercase tracking-wider"
          style={{ border: '1px solid var(--lb-border)', background: 'rgba(34,211,238,0.1)', color: 'var(--lb-accent)' }}
        >
          可交互
        </span>
      </div>
      <Comp props={props} />
      <figcaption className="t-muted mt-2.5 text-sm">{def.description}</figcaption>
    </figure>
  )
}
