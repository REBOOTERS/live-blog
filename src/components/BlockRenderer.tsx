import type { Block } from '../types'
import { renderMarkdown } from '../lib/markdown'
import { WidgetView } from './WidgetView'

interface Props {
  block: Block
}

export function BlockRenderer({ block }: Props) {
  if (block.kind === 'text') {
    return (
      <div
        className="prose-lb max-w-none text-slate-800"
        // content is escaped inside renderMarkdown
        dangerouslySetInnerHTML={{ __html: renderMarkdown(block.content) }}
      />
    )
  }
  return <WidgetView type={block.type} props={block.props} />
}
