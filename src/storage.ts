import type { Article } from './types'
import { seedArticles } from './seed'

const KEY = 'liveblog:articles:v10'
const LEGACY_KEY = 'liveblog:articles:v9'

export function loadArticles(): Article[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Article[]
      if (Array.isArray(parsed) && parsed.length) return parsed
    }
    // First launch on v10 (or v10 empty/corrupt): migrate any v9 data, then seed.
    return migrate()
  } catch {
    return seedArticles()
  }
}

/**
 * v9 → v10 migration. Refreshes built-in demo articles from the latest seed
 * (picking up widget fixes/text updates) while preserving user-created
 * articles. User articles backfill publishedAt from their existing timestamp.
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
