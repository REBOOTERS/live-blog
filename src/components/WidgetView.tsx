import { useRef } from 'react'
import { getWidget } from '../widgets/registry'
import { WidgetExportButton } from './WidgetExportButton'

interface Props {
  type: string
  props: Record<string, unknown>
  /** 1-based exhibit number within the article; absent in editor previews. */
  figNo?: number
  /** Exported-video filename prefix (文章名-章节名); absent when unknown. */
  exportPrefix?: string
}

/** Renders a widget instance in read/play mode. */
export function WidgetView({ type, props, figNo, exportPrefix }: Props) {
  const def = getWidget(type)
  const figRef = useRef<HTMLElement>(null)
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
    <figure className="my-10" ref={figRef}>
      <div className="lb-fig-head">
        {figNo != null ? (
          <>
            <span className="lb-fig-no">图 {String(figNo).padStart(2, '0')}</span>
            <span className="lb-fig-rule" aria-hidden="true" />
          </>
        ) : (
          <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: 'var(--lb-accent)' }} />
        )}
        <span className="lb-fig-label">{def.label}</span>
        {def.exportable && (
          <WidgetExportButton
            widgetType={type}
            namePrefix={exportPrefix}
            getTarget={() => {
              const fig = figRef.current
              if (!fig) return null
              const canvas = fig.querySelector('canvas')
              if (canvas) return { kind: 'canvas', canvas }
              const node = fig.querySelector('.lb-surface') as HTMLElement | null
              return node ? { kind: 'dom', node } : null
            }}
          />
        )}
      </div>
      <Comp props={props} />
      <figcaption className="t-muted mt-3 text-center text-[13.5px] leading-relaxed">{def.description}</figcaption>
    </figure>
  )
}
