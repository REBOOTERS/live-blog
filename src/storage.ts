import type { Article } from './types'
import { seedArticles } from './seed'

const KEY = 'liveblog:articles:v5'
const LEGACY_KEY = 'liveblog:articles:v4'

export function loadArticles(): Article[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Article[]
      if (Array.isArray(parsed) && parsed.length) return parsed
    }
    // First launch on v3 (or v3 empty/corrupt): migrate any v2 data, then seed.
    return migrate()
  } catch {
    return seedArticles()
  }
}

/**
 * v4 → v5 migration. The built-in demo articles (stable ids art-*) carry text
 * and default props that must match the current widget code — when that code
 * changes (e.g. the projectile interaction), the stored copies go stale and the
 * article instructions no longer match the widget. This refreshes those demo
 * articles from the latest seed while preserving any user-created articles and
 * their ordering.
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
    return a
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
