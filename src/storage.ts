import type { Article, Block } from './types'
import { seedArticles } from './seed'

const PREFIX = 'liveblog:articles:'

let cachedSeed: Article[] | null = null

function currentSeed(): Article[] {
  if (!cachedSeed) cachedSeed = seedArticles()
  return cachedSeed
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>
    return `{${Object.keys(obj)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stable(obj[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

function blockBody(block: Block): string {
  if (block.kind === 'text') return `t\n${block.content}`
  return `w\n${block.type}\n${stable(block.props)}`
}

/** 按内置文章的正文指纹当 key。改 seed 或新增文章文件都会变，不用手写 v28。 */
function seedStorageKey(articles: Article[]): string {
  const body = articles
    .map((article) =>
      [article.id, article.publishedAt, article.title, article.description, ...article.blocks.map(blockBody)].join('\n'),
    )
    .join('\n---\n')
  return `${PREFIX}${fnv1a(body)}`
}

function fnv1a(text: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

const KEY = seedStorageKey(currentSeed())

export function loadArticles(): Article[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Article[]
      if (Array.isArray(parsed) && parsed.length) return parsed
    }
    // First launch on this version (or storage empty/corrupt): migrate any
    // previous-version data, then seed.
    return migrate()
  } catch {
    return currentSeed()
  }
}

function versionOf(key: string): number | null {
  const matched = key.match(/:v(\d+)$/)
  return matched ? Number(matched[1]) : null
}

function readSnapshots(): { version: number | null; articles: Article[] }[] {
  const out: { version: number | null; articles: Article[] }[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (!key || !key.startsWith(PREFIX) || key === KEY) continue
    try {
      const parsed = JSON.parse(localStorage.getItem(key) || '') as Article[]
      if (!Array.isArray(parsed) || parsed.length === 0) continue
      out.push({ version: versionOf(key), articles: parsed })
    } catch {
      /* corrupt legacy data — skip this key */
    }
  }
  return out
}

/**
 * 以前每次加文章都把 key 写成同一个下一版，两篇稿会撞车，而且只读上一版。
 * 现在扫全部 liveblog:articles:*。已经有指纹 key 时用它（那是更新的一次迁移），
 * 否则用最大的 vN。内置文章刷新为当前 seed，用户自己的文章从每一本旧账里补回来。
 */
function migrate(): Article[] {
  const seed = currentSeed()
  const seedById = new Map(seed.map((a) => [a.id, a]))
  const rows = readSnapshots()
  const hashed = rows.filter((row) => row.version === null)
  const pool = hashed.length ? hashed : rows
  const ranked = [...pool].sort((a, b) => {
    const byVersion = (b.version ?? -1) - (a.version ?? -1)
    if (byVersion !== 0) return byVersion
    return b.articles.length - a.articles.length
  })
  const existing = ranked[0]?.articles ?? []

  if (existing.length === 0) {
    saveArticles(seed)
    return seed
  }

  const refreshed = new Set<string>()
  const merged = existing.map((a) => {
    const fresh = seedById.get(a.id)
    if (fresh) {
      refreshed.add(a.id)
      return fresh
    }
    // user-created article: backfill publishedAt from its existing timestamp
    return { ...a, publishedAt: a.publishedAt ?? a.updatedAt }
  })
  // Append any demo article that wasn't present before.
  for (const s of seed) {
    if (!refreshed.has(s.id)) merged.push(s)
  }
  const have = new Set(merged.map((a) => a.id))
  for (const row of rows) {
    for (const article of row.articles) {
      if (seedById.has(article.id) || have.has(article.id)) continue
      have.add(article.id)
      merged.push({ ...article, publishedAt: article.publishedAt ?? article.updatedAt })
    }
  }

  saveArticles(merged)
  return merged
}

export function saveArticles(articles: Article[]) {
  localStorage.setItem(KEY, JSON.stringify(articles))
}

export function upsertArticle(article: Article): Article[] {
  const all = loadArticles()
  const idx = all.findIndex((a) => a.id === article.id)
  if (idx >= 0) all[idx] = article
  else all.unshift(article)
  saveArticles(all)
  return all
}

export function deleteArticle(id: string): Article[] {
  const all = loadArticles().filter((a) => a.id !== id)
  if (all.length === 0) {
    all.push(...currentSeed())
  }
  saveArticles(all)
  return all
}

const FAV_KEY = 'liveblog:favorites:v1'

export function loadFavorites(): string[] {
  try {
    const raw = localStorage.getItem(FAV_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((x): x is string => typeof x === 'string')
  } catch {
    return []
  }
}

export function saveFavorites(ids: string[]): void {
  localStorage.setItem(FAV_KEY, JSON.stringify(ids))
}

export function toggleFavorite(id: string): string[] {
  const next = loadFavorites()
  const i = next.indexOf(id)
  if (i >= 0) next.splice(i, 1)
  else next.push(id)
  saveFavorites(next)
  return next
}
