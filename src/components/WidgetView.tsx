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
      <div className="rounded-xl border border-dashed border-red-300 bg-red-50 p-4 text-sm text-red-700">
        未知的交互组件：{type}
      </div>
    )
  }
  const Comp = def.Component as React.ComponentType<{ props: Record<string, unknown> }>
  return (
    <figure className="my-6">
      <Comp props={props} />
      <figcaption className="mt-2.5 flex flex-wrap items-center gap-2 text-xs text-slate-500">
        <span className="rounded bg-indigo-50 px-1.5 py-0.5 font-medium text-indigo-600">
          {def.icon} {def.label}
        </span>
        <span className="rounded bg-amber-50 px-1.5 py-0.5 font-medium text-amber-600">交互</span>
        <span>{def.description}</span>
      </figcaption>
    </figure>
  )
}
