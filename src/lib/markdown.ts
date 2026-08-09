// Tiny markdown renderer. Supports: headings, bold, italic, inline code, fenced
// code blocks (with syntax highlighting), links, lists (ul/ol), blockquotes, hr,
// GFM tables. Math ($...$ inline, $$...$$ block) is rendered with KaTeX.
//
// Safety: prose is escaped before inline formatting. Code spans and math are
// extracted from the RAW string into placeholder slots first, so KaTeX receives
// real TeX (not pre-escaped entities) and code formatting is skipped. The slots
// are spliced back after escaping — NUL-delimited placeholders pass through
// escapeHtml and the inline regexes untouched, and never collide with prose.

import katex from 'katex'
import { highlight } from './highlight'

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function renderTex(tex: string, displayMode: boolean): string {
  try {
    return katex.renderToString(tex, { displayMode, throwOnError: false, output: 'html' })
  } catch {
    return `<span class="math-error">${escapeHtml(tex)}</span>`
  }
}

function blockMath(tex: string): string {
  return `<div class="math-block">${renderTex(tex, true)}</div>`
}

const NUL = String.fromCharCode(0)
const SLOT_RE = new RegExp(NUL + '(\\d+)' + NUL, 'g')

function inline(s: string): string {
  // Stash code spans + inline math (rendered to HTML) in slots, escape the
  // surrounding prose, then splice the slots back.
  const slots: string[] = []
  const stash = (html: string): string => {
    slots.push(html)
    return NUL + (slots.length - 1) + NUL
  }

  let work = s.replace(/`([^`]+)`/g, (_m, code: string) => stash(`<code>${escapeHtml(code)}</code>`))
  work = work.replace(/\$([^$\n]+)\$/g, (_m, tex: string) => stash(renderTex(tex, false)))

  work = escapeHtml(work)
  work = work.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  work = work.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
  work = work.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')

  return work.replace(SLOT_RE, (_m, i: string) => slots[Number(i)] ?? '')
}

function codeCard(lang: string, code: string): string {
  const body = lang ? highlight(code, lang) : escapeHtml(code)
  const label = lang || 'text'
  return (
    '<div class="code-card"><div class="code-head">' +
    `<span class="code-lang">${escapeHtml(label)}</span>` +
    '<button type="button" class="code-copy" data-copy aria-label="复制代码">复制</button>' +
    `</div><pre><code data-lang="${escapeHtml(lang)}">${body}</code></pre></div>`
  )
}

// GFM table: a header row containing `|`, followed by a separator line
// (---|:---|---:|) that defines the column count, then 0+ data rows. Leading
// and trailing pipes on every line are optional.
const TABLE_SEP_RE = /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/

function isTableSeparator(line: string): boolean {
  return TABLE_SEP_RE.test(line)
}

function splitTableCells(line: string): string[] {
  let t = line.trim()
  if (t.startsWith('|')) t = t.slice(1)
  if (t.endsWith('|')) t = t.slice(0, -1)
  return t.split('|').map(c => c.trim())
}

function renderTable(headerCells: string[], rows: string[][]): string {
  const cols = headerCells.length
  const ths = headerCells.map(h => `<th>${inline(h)}</th>`).join('')
  const body = rows
    .map(r => {
      // pad / trim so every row has exactly `cols` cells
      const padded = r.slice(0, cols)
      while (padded.length < cols) padded.push('')
      return '<tr>' + padded.map(c => `<td>${inline(c)}</td>`).join('') + '</tr>'
    })
    .join('')
  // The wrapper carries the card surface + horizontal scroll. Keeping the
  // inner <table> at its default `display: table` is critical — only then does
  // the table layout algorithm distribute cell widths across the wrapper, so
  // the table fills the available width instead of shrinking to content with a
  // huge blank area on the right.
  return `<div class="lb-table-wrap"><table><thead><tr>${ths}</tr></thead><tbody>${body}</tbody></table></div>`
}

export function renderMarkdown(src: string): string {
  const lines = src.replace(/\r\n/g, '\n').split('\n')
  const html: string[] = []
  let i = 0
  let inCode = false
  let codeLang = ''
  let codeBuf: string[] = []
  let inMath = false
  let mathBuf: string[] = []
  let listType: null | 'ul' | 'ol' = null

  const closeList = () => {
    if (listType) {
      html.push(`</${listType}>`)
      listType = null
    }
  }

  while (i < lines.length) {
    const line = lines[i]

    if (line.startsWith('```')) {
      if (inCode) {
        html.push(codeCard(codeLang, codeBuf.join('\n')))
        codeBuf = []
        codeLang = ''
        inCode = false
      } else {
        closeList()
        inCode = true
        codeLang = line.slice(3).trim()
      }
      i++
      continue
    }
    if (inCode) {
      codeBuf.push(line)
      i++
      continue
    }

    if (line.trim().startsWith('$$')) {
      if (inMath) {
        html.push(blockMath(mathBuf.join('\n')))
        mathBuf = []
        inMath = false
      } else {
        closeList()
        inMath = true
        // support inline $$ on same line: $$...$$
        const rest = line.trim().slice(2)
        if (rest.endsWith('$$') && rest.length > 2) {
          html.push(blockMath(rest.slice(0, -2)))
          inMath = false
        } else if (rest) {
          mathBuf.push(rest)
        }
      }
      i++
      continue
    }
    if (inMath) {
      mathBuf.push(line)
      i++
      continue
    }

    if (!line.trim()) {
      closeList()
      i++
      continue
    }

    const h = /^(#{1,3})\s+(.*)$/.exec(line)
    if (h) {
      closeList()
      const level = h[1].length
      html.push(`<h${level}>${inline(h[2])}</h${level}>`)
      i++
      continue
    }

    if (/^---+\s*$/.test(line)) {
      closeList()
      html.push('<hr/>')
      i++
      continue
    }

    if (/^>\s?/.test(line)) {
      closeList()
      const buf: string[] = []
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^>\s?/, ''))
        i++
      }
      html.push(`<blockquote>${inline(buf.join(' '))}</blockquote>`)
      continue
    }

    const ul = /^\s*[-*]\s+(.*)$/.exec(line)
    const ol = /^\s*\d+\.\s+(.*)$/.exec(line)
    if (ul || ol) {
      const type = ul ? 'ul' : 'ol'
      if (listType !== type) {
        closeList()
        listType = type
        html.push(`<${type}>`)
      }
      html.push(`<li>${inline((ul || ol)![1])}</li>`)
      i++
      continue
    }

    // GFM table: a `|`-bearing header line followed by a separator. Must run
    // BEFORE paragraph collection so header + body rows don't get concatenated
    // into a single <p>.
    if (line.includes('|') && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      closeList()
      const headers = splitTableCells(line)
      i += 2
      const rows: string[][] = []
      while (
        i < lines.length &&
        lines[i].trim() &&
        lines[i].includes('|') &&
        !isTableSeparator(lines[i])
      ) {
        rows.push(splitTableCells(lines[i]))
        i++
      }
      html.push(renderTable(headers, rows))
      continue
    }

    closeList()
    // paragraph: gather consecutive non-empty, non-special lines
    const buf: string[] = []
    while (
      i < lines.length &&
      lines[i].trim() &&
      !lines[i].startsWith('```') &&
      !/^(#{1,3})\s+/.test(lines[i]) &&
      !/^---+\s*$/.test(lines[i]) &&
      !/^>\s?/.test(lines[i]) &&
      !/^\s*[-*]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i]) &&
      !isTableSeparator(lines[i])
    ) {
      buf.push(lines[i])
      i++
    }
    html.push(`<p>${inline(buf.join(' '))}</p>`)
  }

  closeList()
  if (inCode) {
    html.push(codeCard(codeLang, codeBuf.join('\n')))
  }
  if (inMath) {
    html.push(blockMath(mathBuf.join('\n')))
  }
  return html.join('\n')
}
