import { useEffect, useRef } from 'react'
import type { Block } from '../types'
import { renderMarkdown } from '../lib/markdown'
import { WidgetView } from './WidgetView'

interface Props {
  block: Block
}

export function BlockRenderer({ block }: Props) {
  const rootRef = useRef<HTMLDivElement>(null)

  // One delegated click listener handles every code-block "copy" button inside
  // this prose block (the buttons live in dangerouslySetInnerHTML HTML, so they
  // can't have React handlers). Scoped to our own ref, cleaned up on unmount.
  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const onClick = async (e: MouseEvent) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-copy]')
      if (!btn) return
      const code = btn.closest('.code-card')?.querySelector('code')
      if (!code) return
      try {
        await navigator.clipboard.writeText(code.textContent ?? '')
        const prev = btn.textContent
        btn.textContent = '已复制'
        window.setTimeout(() => {
          btn.textContent = prev
        }, 1200)
      } catch {
        /* clipboard unavailable (non-secure context) — silently ignore */
      }
    }
    root.addEventListener('click', onClick)
    return () => root.removeEventListener('click', onClick)
  }, [])

  if (block.kind === 'text') {
    return (
      <div
        ref={rootRef}
        className="prose-lb max-w-none"
        // content is escaped inside renderMarkdown
        dangerouslySetInnerHTML={{ __html: renderMarkdown(block.content) }}
      />
    )
  }
  return <WidgetView type={block.type} props={block.props} />
}
