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
function* scanHeadings(content: string): Generator<{ level: 1 | 2 | 3; text: string }> {
  let inCode = false
  let inMath = false
  for (const line of content.replace(/\r\n/g, '\n').split('\n')) {
    if (line.startsWith('```')) {
      inCode = !inCode
      continue
    }
    if (inCode) continue
    const trimmed = line.trim()
    if (trimmed.startsWith('$$')) {
      inMath = !inMath
      continue
    }
    if (inMath) continue
    const m = /^(#{1,3})\s+(.+)$/.exec(line)
    if (!m) continue
    // Strip inline markdown markers for a clean label.
    const text = m[2]
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/(^|[^*])\*([^*]+)\*/g, '$1$2')
      .trim()
    yield { level: m[1].length as 1 | 2 | 3, text }
  }
}

export function extractHeadings(article: Article): TocItem[] {
  const items: TocItem[] = []
  for (const block of article.blocks) {
    if (block.kind !== 'text') continue
    let index = 0
    for (const h of scanHeadings(block.content)) {
      items.push({ id: `${block.id}-h${index++}`, level: h.level, text: h.text })
    }
  }
  return items
}

// Last heading seen before each widget block — the section the widget sits
// in. Used to prefix exported demo-video filenames with 文章名-章节名.
export function sectionTitleByBlockId(article: Article): Map<string, string> {
  const map = new Map<string, string>()
  let current: string | undefined
  for (const block of article.blocks) {
    if (block.kind === 'text') {
      for (const h of scanHeadings(block.content)) current = h.text
    } else if (current) {
      map.set(block.id, current)
    }
  }
  return map
}
