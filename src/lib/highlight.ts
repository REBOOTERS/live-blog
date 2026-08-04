// Best-effort, dependency-free syntax highlighter for fenced code blocks.
// Tokenizes a C-like subset (comments, strings, numbers, keywords, function
// calls) into escaped HTML wrapped in <span class="tok-*">. It is intentionally
// lenient: any unmatched gap between tokens is escaped and emitted as-is, so it
// never breaks on unfamiliar input. Good enough for JS/TS/Go/Rust/Python-ish
// snippets in a tech blog; not a real parser.

const KEYWORDS = new Set([
  'const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'do',
  'switch', 'case', 'break', 'continue', 'new', 'class', 'extends', 'super', 'this',
  'import', 'export', 'from', 'default', 'try', 'catch', 'finally', 'throw',
  'typeof', 'instanceof', 'in', 'of', 'void', 'delete', 'yield', 'async', 'await',
  'public', 'private', 'protected', 'static', 'readonly', 'enum', 'interface',
  'type', 'namespace', 'implements', 'true', 'false', 'null', 'undefined',
  'def', 'elif', 'lambda', 'pass', 'None', 'and', 'or', 'not', 'print',
  'int', 'float', 'str', 'bool', 'fn', 'struct', 'match', 'where', 'let', 'mut',
])

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// 1 comment | 2 string | 3 number | 4 identifier | 5 whitespace | 6 other punct
const TOKEN_RE =
  /(\/\/[^\n]*|#[^\n]*|\/\*[\s\S]*?\*\/)|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_$][\w$]*)|(\s+)|([^\w\s])/g

export function highlight(code: string, lang: string): string {
  if (!lang || lang === 'plaintext' || lang === 'text') return escapeHtml(code)

  let out = ''
  let last = 0
  for (const m of code.matchAll(TOKEN_RE)) {
    const idx = m.index ?? 0
    if (idx > last) out += escapeHtml(code.slice(last, idx)) // gap safety net
    if (m[1]) out += `<span class="tok-comment">${escapeHtml(m[1])}</span>`
    else if (m[2]) out += `<span class="tok-string">${escapeHtml(m[2])}</span>`
    else if (m[3]) out += `<span class="tok-number">${escapeHtml(m[3])}</span>`
    else if (m[4]) {
      const id = m[4]
      const after = code[idx + id.length]
      const cls = KEYWORDS.has(id) ? 'tok-keyword' : after === '(' ? 'tok-function' : ''
      // identifiers are [A-Za-z_$][\w$]* — safe to emit unescaped
      out += cls ? `<span class="${cls}">${id}</span>` : id
    } else if (m[5]) {
      out += m[5] // whitespace — no escaping needed
    } else if (m[6]) {
      out += `<span class="tok-punct">${escapeHtml(m[6])}</span>`
    }
    last = idx + m[0].length
  }
  out += escapeHtml(code.slice(last)) // trailing gap safety net
  return out
}
