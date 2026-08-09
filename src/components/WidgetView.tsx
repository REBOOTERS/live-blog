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
      <div
        className="my-6 rounded-xl border border-dashed p-4 text-sm"
        style={{ borderColor: 'rgba(248,113,113,0.45)', background: 'rgba(248,113,113,0.08)', color: '#e5484d' }}
      >
        未知的交互组件：{type}
      </div>
    )
  }
  const Comp = def.Component as React.ComponentType<{ props: Record<string, unknown> }>
  return (
    <figure className="my-10">
      <div className="mb-3 flex items-center gap-2 text-[12px]">
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'var(--lb-accent)' }} />
        <span className="t-strong font-medium tracking-tight">{def.label}</span>
        <span className="t-faint">· 可交互</span>
      </div>
      <Comp props={props} />
      <figcaption className="t-muted mt-3 text-center text-[13.5px] leading-relaxed">{def.description}</figcaption>
    </figure>
  )
}
