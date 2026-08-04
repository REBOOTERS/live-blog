// Tiny, dependency-free markdown renderer. Supports: headings, bold, italic,
// inline code, fenced code blocks, links, lists (ul/ol), blockquotes, hr.
// Output is escaped before applying inline formatting — safe by construction.

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function inline(s: string): string {
  let out = escapeHtml(s)
  // inline code first (so its contents aren't formatted)
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>')
  // inline math $...$
  out = out.replace(/\$([^$\n]+)\$/g, '<span class="math-inline">$1</span>')
  // bold
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  // italic
  out = out.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
  // links [text](url)
  out = out.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')
  return out
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
        html.push(`<pre><code data-lang="${codeLang}">${escapeHtml(codeBuf.join('\n'))}</code></pre>`)
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
        html.push(
          `<div class="math-block">${escapeHtml(mathBuf.join('\n'))}</div>`,
        )
        mathBuf = []
        inMath = false
      } else {
        closeList()
        inMath = true
        // support inline $$ on same line: $$...$$
        const rest = line.trim().slice(2)
        if (rest.endsWith('$$') && rest.length > 2) {
          html.push(`<div class="math-block">${escapeHtml(rest.slice(0, -2))}</div>`)
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
      !/^\s*\d+\.\s+/.test(lines[i])
    ) {
      buf.push(lines[i])
      i++
    }
    html.push(`<p>${inline(buf.join(' '))}</p>`)
  }

  closeList()
  if (inCode) {
    html.push(`<pre><code>${escapeHtml(codeBuf.join('\n'))}</code></pre>`)
  }
  if (inMath) {
    html.push(`<div class="math-block">${escapeHtml(mathBuf.join('\n'))}</div>`)
  }
  return html.join('\n')
}
