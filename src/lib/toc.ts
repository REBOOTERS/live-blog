import type { Article } from '../types'

export interface TocItem {
  id: string
  level: 1 | 2 | 3
  text: string
}

// Walk text blocks and pull out h1/h2/h3 headings. Mirrors the heading-id
// scheme used by renderMarkdown() (src/lib/markdown.ts) so sidebar TOC
// entries and rendered DOM nodes line up 1:1.
//
// IMPORTANT: the heading counter resets per text block (matching
// renderMarkdown, which is called once per block). Using a single global
// counter across the whole article would misalign every heading past the
// first block.
//
// Fenced code blocks (``` … ```) and block math ($$ … $$) are tracked so
// stray `#` characters inside them don't get mistaken for headings.
export function extractHeadings(article: Article): TocItem[] {
  const items: TocItem[] = []
  for (const block of article.blocks) {
    if (block.kind !== 'text') continue
    let index = 0
    const lines = block.content.replace(/\r\n/g, '\n').split('\n')
    let inCode = false
    let inMath = false
    for (const line of lines) {
      if (line.startsWith('```')) {
        inCode = !inCode
        continue
      }
      if (!inCode) {
        const trimmed = line.trim()
        if (trimmed.startsWith('$$')) {
          inMath = !inMath
          continue
        }
        if (inMath) continue
      } else {
        continue
      }
      const m = /^(#{1,3})\s+(.+)$/.exec(line)
      if (!m) continue
      const level = m[1].length as 1 | 2 | 3
      // Strip inline markdown markers for a clean sidebar label.
      const text = m[2]
        .replace(/`([^`]+)`/g, '$1')
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/(^|[^*])\*([^*]+)\*/g, '$1$2')
        .trim()
      items.push({ id: `${block.id}-h${index++}`, level, text })
    }
  }
  return items
}
