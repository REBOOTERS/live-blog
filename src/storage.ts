import type { Article } from './types'
import { seedArticles } from './seed'

const KEY = 'liveblog:articles:v7'
const LEGACY_KEY = 'liveblog:articles:v6'

export function loadArticles(): Article[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Article[]
      if (Array.isArray(parsed) && parsed.length) return parsed
    }
    // First launch on v7 (or v7 empty/corrupt): migrate any v6 data, then seed.
    return migrate()
  } catch {
    return seedArticles()
  }
}

/**
 * v6 → v7 migration. Introduces the stable `publishedAt` field (the sort key).
 * Built-in demo articles (stable ids art-*) are refreshed from the latest seed,
 * which carries fixed RELEASE_DATES; user-created articles keep their place by
 * adopting their existing `updatedAt` as `publishedAt` (best-effort). Also
 * keeps prior behavior: demo text/props are refreshed, user articles preserved.
 */
function migrate(): Article[] {
  const seed = seedArticles()
  const seedById = new Map(seed.map((a) => [a.id, a]))

  let existing: Article[] = []
  const legacy = localStorage.getItem(LEGACY_KEY)
  if (legacy) {
    try {
      const parsed = JSON.parse(legacy) as Article[]
      if (Array.isArray(parsed)) existing = parsed
    } catch {
      /* corrupt legacy data — fall through to fresh seed */
    }
  }

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
    all.push(...seedArticles())
  }
  saveArticles(all)
  return all
}
