import type { Article } from './types'
import { seedArticles } from './seed'

const KEY = 'liveblog:articles:v2'

export function loadArticles(): Article[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) {
      const seed = seedArticles()
      saveArticles(seed)
      return seed
    }
    const parsed = JSON.parse(raw) as Article[]
    if (!Array.isArray(parsed) || parsed.length === 0) {
      const seed = seedArticles()
      saveArticles(seed)
      return seed
    }
    return parsed
  } catch {
    return seedArticles()
  }
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
