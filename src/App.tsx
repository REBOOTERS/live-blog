import { useEffect, useMemo, useRef, useState } from 'react'
import type { Article, Block } from './types'
import { loadArticles, upsertArticle, loadFavorites, toggleFavorite } from './storage'
import { uid } from './lib/id'
import { useTheme, toggleTheme } from './lib/theme'
import { BlockRenderer } from './components/BlockRenderer'
import { BlockEditor } from './components/BlockEditor'
import { getWidget, listWidgets } from './widgets/registry'
import { extractHeadings, type TocItem } from './lib/toc'

type Mode = 'read' | 'edit'

export default function App() {
  const [articles, setArticles] = useState<Article[]>(() => loadArticles())
  const [currentId, setCurrentId] = useState<string>('')
  const [mode, setMode] = useState<Mode>('read')
  const [draft, setDraft] = useState<Article | null>(null)
  // 目录在桌面端默认展开；窄屏默认收起、以抽屉方式打开
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth >= 1024)
  const [query, setQuery] = useState('')
  const [activeHeadingId, setActiveHeadingId] = useState<string>('')
  const [favorites, setFavorites] = useState<string[]>(() => loadFavorites())
  const [favMenuOpen, setFavMenuOpen] = useState(false)
  const favSet = useMemo(() => new Set(favorites), [favorites])
  const favMenuRef = useRef<HTMLDivElement>(null)
  const theme = useTheme()

  const onToggleFavorite = (id: string) => {
    setFavorites(toggleFavorite(id))
  }

  // Close the favorites menu on outside click / Escape
  useEffect(() => {
    if (!favMenuOpen) return
    const onDown = (e: MouseEvent) => {
      if (favMenuRef.current && !favMenuRef.current.contains(e.target as Node)) {
        setFavMenuOpen(false)
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFavMenuOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [favMenuOpen])

  // close the drawer on Escape
  useEffect(() => {
    if (!sidebarOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSidebarOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [sidebarOpen])

  // sort by publication date, newest first; id is a stable tiebreaker
  const sorted = useMemo(
    () =>
      [...articles].sort(
        (a, b) =>
          (b.publishedAt || b.updatedAt).localeCompare(a.publishedAt || a.updatedAt) ||
          a.id.localeCompare(b.id),
      ),
    [articles],
  )

  const currentIndex = Math.max(0, sorted.findIndex((a) => a.id === currentId))
  const current = sorted[currentIndex]
  // older = published earlier (one row down in the desc-sorted list)
  const older = currentIndex < sorted.length - 1 ? sorted[currentIndex + 1] : undefined
  // newer = published later (one row up)
  const newer = currentIndex > 0 ? sorted[currentIndex - 1] : undefined

  // Heading outline for the current article (only meaningful in read mode).
  // useMemo gives a stable reference so the scroll-spy effect below doesn't
  // re-subscribe on every render (extractHeadings returns a fresh array each
  // call, which would otherwise thrash the listener).
  const currentHeadings: TocItem[] = useMemo(
    () => (mode === 'read' && current ? extractHeadings(current) : []),
    [mode, current],
  )

  // Reset active heading when switching articles — otherwise the previous
  // article's active id would briefly highlight before the new effect runs.
  useEffect(() => {
    setActiveHeadingId('')
  }, [current?.id, mode])

  // Scroll-spy: pick the last heading whose top has crossed a trigger line
  // just below the sticky header. Simpler and more reliable than
  // IntersectionObserver for a long article — the listener only needs the
  // heading positions on each scroll tick.
  useEffect(() => {
    if (mode !== 'read' || currentHeadings.length === 0) return
    // Trigger line sits 96px below the viewport top: 56px sticky header +
    // ~40px breathing room so the active heading lines up with the section
    // the reader is actually looking at.
    const TRIGGER_Y = 96
    const compute = () => {
      let active = currentHeadings[0].id
      for (const h of currentHeadings) {
        const el = document.getElementById(h.id)
        if (!el) continue
        if (el.getBoundingClientRect().top <= TRIGGER_Y) {
          active = h.id
        } else {
          break
        }
      }
      setActiveHeadingId((prev) => (prev === active ? prev : active))
    }
    // Wrap in rAF so we don't fight the scroll event's already-throttled
    // cadence. `passive: true` keeps scrolling smooth even if the handler
    // is occasionally slow.
    let raf = 0
    const onScroll = () => {
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        compute()
      })
    }
    compute() // initial
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll, { passive: true })
    return () => {
      if (raf) cancelAnimationFrame(raf)
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
    }
  }, [currentHeadings, mode, current?.id])

  // sidebar search: match title / description / text-block content
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return sorted
    return sorted.filter(
      (a) =>
        a.title.toLowerCase().includes(q) ||
        a.description.toLowerCase().includes(q) ||
        a.blocks.some((b) => b.kind === 'text' && b.content.toLowerCase().includes(q)),
    )
  }, [sorted, query])

  const favoriteArticles = useMemo(
    () => sorted.filter((a) => favSet.has(a.id)),
    [sorted, favSet],
  )

  // sync draft when switching into edit mode / changing article
  useEffect(() => {
    setDraft(structuredClone(current))
  }, [current?.id, mode === 'edit'])

  const save = () => {
    if (!draft) return
    const updated: Article = { ...draft, updatedAt: new Date().toISOString() }
    const next = upsertArticle(updated)
    setArticles(next)
    setCurrentId(updated.id)
    setMode('read')
  }

  const createArticle = () => {
    const a: Article = {
      id: uid('art'),
      title: '无标题文章',
      description: '',
      publishedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      blocks: [
        { id: uid('blk'), kind: 'text', content: '## 开始写作\n\n在这里写下你的内容……' },
      ],
    }
    setArticles(upsertArticle(a))
    setCurrentId(a.id)
    setMode('edit')
  }

  // draft block operations
  const updateBlock = (id: string, block: Block) =>
    setDraft((d) => (d ? { ...d, blocks: d.blocks.map((b) => (b.id === id ? block : b)) } : d))
  const deleteBlock = (id: string) =>
    setDraft((d) => (d ? { ...d, blocks: d.blocks.filter((b) => b.id !== id) } : d))
  const moveBlock = (id: string, dir: -1 | 1) =>
    setDraft((d) => {
      if (!d) return d
      const i = d.blocks.findIndex((b) => b.id === id)
      const j = i + dir
      if (i < 0 || j < 0 || j >= d.blocks.length) return d
      const blocks = d.blocks.slice()
      ;[blocks[i], blocks[j]] = [blocks[j], blocks[i]]
      return { ...d, blocks }
    })
  const addBlock = (kind: 'text' | 'widget', type?: string) => {
    const block: Block =
      kind === 'text'
        ? { id: uid('blk'), kind: 'text', content: '' }
        : { id: uid('blk'), kind: 'widget', type: type!, props: { ...getWidget(type!)!.defaultProps } }
    setDraft((d) => (d ? { ...d, blocks: [...d.blocks, block] } : d))
  }

  // 桌面端目录常驻展开，只有窄屏抽屉需要在操作后收起
  const collapseDrawer = () => {
    if (window.innerWidth < 1024) setSidebarOpen(false)
  }

  const navigate = (id: string) => {
    setCurrentId(id)
    setMode('read')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  // Smooth-scroll the article body to a heading rendered by BlockRenderer.
  // `scroll-margin-top` on the heading (set in index.css) keeps it clear of
  // the sticky 56px header. On narrow screens the drawer also closes so the
  // scroll target isn't hidden behind it. We set the active id immediately
  // so the TOC highlights the target even when the target is already on
  // screen and scrollIntoView doesn't fire any scroll events.
  const jumpToHeading = (id: string) => {
    const el = document.getElementById(id)
    if (!el) return
    setActiveHeadingId(id)
    el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    if (window.location.hash !== `#${id}`) {
      history.replaceState(null, '', `#${id}`)
    }
    collapseDrawer()
  }

  return (
    <div className="min-h-full lg:flex">
      {/* 窄屏抽屉的遮罩；桌面端目录常驻，不需要 */}
      <div
        className={`fixed inset-0 z-30 bg-black/40 backdrop-blur-sm transition-opacity duration-300 lg:hidden ${
          sidebarOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
        onClick={() => setSidebarOpen(false)}
        aria-hidden={!sidebarOpen}
      />
      {/* 目录：桌面端常驻左栏（可收起），窄屏为滑出抽屉 */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 shrink-0 overflow-hidden transition-transform duration-300 ease-out lg:sticky lg:top-0 lg:bottom-auto lg:left-auto lg:z-auto lg:h-screen lg:translate-x-0 lg:transition-[width] ${
          sidebarOpen ? 'translate-x-0 lg:w-[300px]' : '-translate-x-full lg:w-0'
        }`}
        aria-label="文章目录"
        aria-hidden={!sidebarOpen}
      >
        {/* 内层固定宽度，收起时只裁切不重排 */}
        <div
          className="flex h-full w-[300px] max-w-[85vw] flex-col border-r lg:max-w-none"
          style={{ background: 'var(--lb-surface-bg)', borderColor: 'var(--lb-border-soft)' }}
        >
          <div
            className="flex h-14 shrink-0 items-center border-b px-5"
            style={{ borderColor: 'var(--lb-border-soft)' }}
          >
            <span className="t-heading text-[15px] font-semibold tracking-tight">文章目录</span>
            <button
              onClick={() => setSidebarOpen(false)}
              aria-label="收起目录"
              className="t-muted ml-auto flex h-8 w-8 items-center justify-center rounded-full hover:bg-[var(--lb-hover)] lg:hidden"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            <div className="relative mb-3">
              <svg
                className="t-faint pointer-events-none absolute left-3 top-1/2 -translate-y-1/2"
                width="15" height="15" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              >
                <circle cx="11" cy="11" r="7" />
                <path d="m21 21-4.3-4.3" />
              </svg>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜索文章"
                className="t-input w-full rounded-full py-2 pl-9 pr-3 text-sm outline-none placeholder:text-[var(--lb-faint)]"
              />
            </div>
            <button
              onClick={() => {
                createArticle()
                collapseDrawer()
              }}
              className="t-btn mb-4 flex w-full items-center justify-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M12 5v14M5 12h14" />
              </svg>
              写文章
            </button>

            <div className="t-faint mb-2 px-2 text-[11px] font-medium uppercase tracking-[0.14em]">
              {query.trim() ? (filtered.length ? `${filtered.length} 篇匹配` : '无匹配') : '全部文章'}
            </div>
            <div className="space-y-0.5">
              {filtered.map((a) => {
                const active = a.id === currentId
                return (
                  <div
                    key={a.id}
                    className={`group flex cursor-pointer items-start gap-1 rounded-xl px-3 py-2.5 transition-colors ${
                      active ? '' : 'hover:bg-[var(--lb-hover)]'
                    }`}
                    style={active ? { background: 'var(--lb-hover)' } : undefined}
                    onClick={() => {
                      setCurrentId(a.id)
                      setMode('read')
                      collapseDrawer()
                    }}
                  >
                    <div className="min-w-0 flex-1">
                      <div
                        className={`line-clamp-2 text-[14.5px] leading-snug ${
                          active ? 't-strong font-semibold' : 't-text font-medium'
                        }`}
                      >
                        {a.title || '无标题'}
                      </div>
                      <div className="t-faint mt-1 flex items-center gap-2 text-[11.5px]">
                        <span>{new Date(a.publishedAt || a.updatedAt).toLocaleDateString()}</span>
                        <span className="h-[3px] w-[3px] rounded-full" style={{ background: 'var(--lb-faint)' }} />
                        <span>{readingTime(a)} 分钟阅读</span>
                      </div>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        onToggleFavorite(a.id)
                      }}
                      title={favSet.has(a.id) ? '取消收藏' : '收藏'}
                      aria-label={favSet.has(a.id) ? '取消收藏' : '收藏'}
                      className={`-mr-1 -mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-[var(--lb-bg-2)] ${
                        favSet.has(a.id) ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                      }`}
                    >
                      <HeartIcon filled={favSet.has(a.id)} className="h-[15px] w-[15px]" />
                    </button>
                  </div>
                )
              })}
              {query.trim() && filtered.length === 0 && (
                <div className="t-faint px-3 py-8 text-center text-xs">
                  没有匹配「{query.trim()}」的文章
                </div>
              )}
            </div>
          </div>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <header
          className="sticky top-0 z-20 border-b backdrop-blur-xl"
          style={{
            borderColor: 'var(--lb-border-soft)',
            background: 'color-mix(in srgb, var(--lb-bg-1) 72%, transparent)',
          }}
        >
          <div className="mx-auto flex h-14 max-w-[1080px] items-center gap-3 px-6">
            <button
              onClick={() => setSidebarOpen((v) => !v)}
              title={sidebarOpen ? '收起目录' : '展开目录'}
              aria-label={sidebarOpen ? '收起目录' : '展开目录'}
              className="t-btn flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
            >
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="16" rx="3" />
                <path d="M9.5 4.5v15" />
              </svg>
            </button>
            <div className="flex items-center gap-2.5 select-none">
              <div
                className="flex h-7 w-7 items-center justify-center rounded-lg"
                style={{ background: 'var(--lb-accent-grad)' }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 20 L12 4 L20 20" />
                </svg>
              </div>
              <div
                className="t-heading text-[17px] font-semibold tracking-tight"
                style={{ fontFamily: 'var(--lb-font-display)' }}
              >
                LiveBlog
              </div>
            </div>

            <div className="ml-auto flex items-center gap-2">
              <div className="relative" ref={favMenuRef}>
                <button
                  onClick={() => setFavMenuOpen((v) => !v)}
                  title="我的收藏"
                  aria-label="我的收藏"
                  aria-expanded={favMenuOpen}
                  className="t-btn relative flex h-9 w-9 items-center justify-center rounded-full"
                >
                  <BookmarkIcon filled={favMenuOpen || favorites.length > 0} className="h-[18px] w-[18px]" />
                </button>
                {favMenuOpen && (
                  <div
                    className="t-panel absolute right-0 top-11 z-50 w-[24rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl shadow-2xl"
                    style={{
                      background: 'var(--lb-surface-bg)',
                      border: '1px solid var(--lb-border-soft)',
                    }}
                  >
                    <div
                      className="t-heading flex items-center gap-2 border-b px-5 py-3.5 text-[15px] font-semibold"
                      style={{ borderColor: 'var(--lb-border-soft)' }}
                    >
                      <BookmarkIcon filled className="h-[15px] w-[15px]" />
                      我的收藏
                    </div>
                    <div className="max-h-[28rem] overflow-y-auto p-2">
                      {favoriteArticles.length === 0 ? (
                        <div className="t-faint px-3 py-14 text-center text-xs leading-relaxed">
                          还没有收藏的文章。
                          <br />
                          打开一篇文章，点击标题旁的心形即可收藏。
                        </div>
                      ) : (
                        favoriteArticles.map((a) => {
                          const active = a.id === currentId
                          const hasWidget = a.blocks.some((b) => b.kind === 'widget')
                          return (
                            <div
                              key={a.id}
                              className={`group flex cursor-pointer items-start gap-3 rounded-xl px-3 py-3 transition-colors ${
                                active ? '' : 'hover:bg-[var(--lb-hover)]'
                              }`}
                              style={active ? { background: 'var(--lb-hover)' } : undefined}
                              onClick={() => {
                                setCurrentId(a.id)
                                setMode('read')
                                setFavMenuOpen(false)
                                collapseDrawer()
                                window.scrollTo({ top: 0, behavior: 'smooth' })
                              }}
                            >
                              <div className="min-w-0 flex-1">
                                <div className="t-strong line-clamp-2 text-[14px] font-semibold leading-snug">
                                  {a.title || '无标题'}
                                </div>
                                {a.description && (
                                  <div className="t-muted mt-1 line-clamp-2 text-[12.5px] leading-relaxed">
                                    {a.description}
                                  </div>
                                )}
                                <div className="t-faint mt-2 flex flex-wrap items-center gap-x-2 text-[11px]">
                                  <span>{new Date(a.publishedAt || a.updatedAt).toLocaleDateString()}</span>
                                  <span className="h-[3px] w-[3px] rounded-full" style={{ background: 'var(--lb-faint)' }} />
                                  <span>{readingTime(a)} 分钟阅读</span>
                                  <span className="h-[3px] w-[3px] rounded-full" style={{ background: 'var(--lb-faint)' }} />
                                  <span>{a.blocks.length} 个段落</span>
                                  {hasWidget && (
                                    <>
                                      <span className="h-[3px] w-[3px] rounded-full" style={{ background: 'var(--lb-faint)' }} />
                                      <span>含交互</span>
                                    </>
                                  )}
                                </div>
                              </div>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  onToggleFavorite(a.id)
                                }}
                                title="取消收藏"
                                aria-label="取消收藏"
                                className="-mr-1 mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[var(--lb-faint)] opacity-0 transition-colors hover:bg-[var(--lb-bg-2)] hover:text-[var(--lb-text-strong)] group-hover:opacity-100"
                              >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                                  <path d="M18 6L6 18M6 6l12 12" />
                                </svg>
                              </button>
                            </div>
                          )
                        })
                      )}
                    </div>
                  </div>
                )}
              </div>
              <a
                href="https://github.com/REBOOTERS/live-blog"
                target="_blank"
                rel="noopener noreferrer"
                title="GitHub 仓库"
                aria-label="GitHub 仓库"
                className="t-btn flex h-9 w-9 items-center justify-center rounded-full"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M12 .5C5.73.5.5 5.73.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.56 0-.28-.01-1.02-.02-2-3.2.7-3.88-1.54-3.88-1.54-.52-1.33-1.28-1.69-1.28-1.69-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.71 1.26 3.37.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11.1 11.1 0 0 1 5.79 0c2.21-1.49 3.18-1.18 3.18-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.84 1.19 3.1 0 4.42-2.69 5.39-5.25 5.68.41.36.78 1.06.78 2.14 0 1.55-.01 2.8-.01 3.18 0 .31.21.68.8.56A11.51 11.51 0 0 0 23.5 12C23.5 5.73 18.27.5 12 .5z" />
                </svg>
              </a>
              <button
                onClick={toggleTheme}
                title={theme === 'dark' ? '切换到日间模式' : '切换到夜间模式'}
                aria-label="切换主题"
                className="t-btn flex h-9 w-9 items-center justify-center rounded-full"
              >
                {theme === 'dark' ? (
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="4" />
                    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
                  </svg>
                ) : (
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
                  </svg>
                )}
              </button>
              {mode === 'edit' ? (
                <>
                  <button onClick={() => setMode('read')} className="t-btn rounded-full px-4 py-1.5 text-sm">
                    取消
                  </button>
                  <button onClick={save} className="t-btn-primary rounded-full px-4 py-1.5 text-sm">
                    保存
                  </button>
                </>
              ) : (
                <button
                  onClick={() => setMode('edit')}
                  title="编辑文章"
                  aria-label="编辑文章"
                  className="t-btn hidden h-9 w-9 items-center justify-center rounded-full sm:flex"
                >
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 20h9" />
                    <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4z" />
                  </svg>
                </button>
              )}
            </div>
          </div>
        </header>

        <main
          className={`mx-auto px-6 pb-28 pt-12 sm:pt-16 ${
            mode === 'edit'
              ? 'max-w-[50rem]'
              : 'max-w-[42rem] xl:max-w-[64rem]'
          }`}
        >
          {mode === 'read' ? (
            <div className="xl:grid xl:grid-cols-[minmax(0,42rem)_200px] xl:gap-10">
              <ReadView
                article={current}
                older={older}
                newer={newer}
                onNavigate={navigate}
                isFavorite={favSet.has(current.id)}
                onToggleFavorite={() => onToggleFavorite(current.id)}
              />
              {/* In-article TOC: standard markdown outline on the right of
                  the article. Sticky to the viewport so it stays in view as
                  you scroll. Only renders on xl+ screens (the layout needs
                  ~64rem of room: 42rem article + 200px TOC + gap) and only
                  when the current article actually has headings.

                  The right column deliberately stretches to the full article
                  height (default grid `align-items: stretch` — the previous
                  `items-start` capped the column at the TOC's own height and
                  killed the sticky range after a few screens). */}
              {currentHeadings.length > 0 && (
                <aside aria-label="本节目录" className="hidden xl:block">
                  <nav className="sticky top-20 max-h-[calc(100vh-6rem)] overflow-y-auto pr-1">
                    <ul className="space-y-px">
                      {currentHeadings.map((h) => {
                        const isActive = h.id === activeHeadingId
                        return (
                          <li key={h.id}>
                            <a
                              href={`#${h.id}`}
                              onClick={(e) => {
                                e.preventDefault()
                                jumpToHeading(h.id)
                              }}
                              aria-current={isActive ? 'location' : undefined}
                              className={`lb-toc-item block truncate py-1 text-[12.5px] leading-snug transition-colors ${
                                h.level === 3 ? 'pl-4' : 'pl-2'
                              } ${
                                isActive
                                  ? 'lb-toc-active t-strong font-medium'
                                  : 't-muted hover:t-text'
                              }`}
                            >
                              {h.text}
                            </a>
                          </li>
                        )
                      })}
                    </ul>
                  </nav>
                </aside>
              )}
            </div>
          ) : draft ? (
            <EditView
              draft={draft}
              onChange={setDraft}
              onUpdateBlock={updateBlock}
              onDeleteBlock={deleteBlock}
              onMoveBlock={moveBlock}
              onAddBlock={addBlock}
            />
          ) : null}
        </main>
      </div>
    </div>
  )
}

function readingTime(a: Article): number {
  let cjk = 0
  let words = 0
  for (const b of a.blocks) {
    if (b.kind !== 'text') continue
    const cjkMatches = b.content.match(/[一-鿿]/g)
    cjk += cjkMatches ? cjkMatches.length : 0
    const w = b.content.replace(/[一-鿿]/g, ' ').match(/[A-Za-z0-9]+/g)
    words += w ? w.length : 0
  }
  return Math.max(1, Math.round(cjk / 400 + words / 250))
}

function ReadView({
  article,
  older,
  newer,
  onNavigate,
  isFavorite,
  onToggleFavorite,
}: {
  article: Article
  older?: Article
  newer?: Article
  onNavigate: (id: string) => void
  isFavorite: boolean
  onToggleFavorite: () => void
}) {
  const hasWidget = article.blocks.some((b) => b.kind === 'widget')
  return (
    <article>
      <div className="mb-4 flex items-center justify-between">
        <div className="t-faint text-[12px] font-medium uppercase tracking-[0.18em]">
          {hasWidget ? '交互式文章' : '文章'}
        </div>
        <button
          onClick={onToggleFavorite}
          title={isFavorite ? '取消收藏' : '收藏文章'}
          aria-label={isFavorite ? '取消收藏' : '收藏文章'}
          aria-pressed={isFavorite}
          className="t-btn flex h-9 w-9 items-center justify-center rounded-full"
        >
          <HeartIcon filled={isFavorite} className="h-[18px] w-[18px]" />
        </button>
      </div>
      <h1
        className="t-heading text-[1.875rem] font-semibold leading-[1.15] tracking-[-0.022em] sm:text-[2.125rem] md:text-[2.25rem]"
        style={{ fontFamily: 'var(--lb-font-display)' }}
      >
        {article.title}
      </h1>
      {article.description && (
        <p className="t-muted mt-5 text-[1.22rem] leading-[1.55] tracking-[-0.01em]">
          {article.description}
        </p>
      )}
      <div className="t-faint mt-6 flex flex-wrap items-center gap-x-3 text-[13px]">
        <span className="t-muted">{new Date(article.publishedAt || article.updatedAt).toLocaleDateString()}</span>
        <span className="h-[3px] w-[3px] rounded-full" style={{ background: 'var(--lb-faint)' }} />
        <span>{article.blocks.length} 个段落</span>
        <span className="h-[3px] w-[3px] rounded-full" style={{ background: 'var(--lb-faint)' }} />
        <span>{readingTime(article)} 分钟阅读</span>
      </div>
      <div className="my-10 h-px" style={{ background: 'var(--lb-border-soft)' }} />
      <div>
        {article.blocks.map((b) => (
          <BlockRenderer key={b.id} block={b} />
        ))}
      </div>

      {(older || newer) && (
        <nav
          className="mt-14 grid grid-cols-1 gap-3 border-t pt-8 sm:grid-cols-2"
          style={{ borderColor: 'var(--lb-border-soft)' }}
        >
          {older ? (
            <button
              onClick={() => onNavigate(older.id)}
              className="group flex flex-col items-start gap-1 rounded-2xl border p-4 text-left transition-colors hover:bg-[var(--lb-hover)]"
              style={{ borderColor: 'var(--lb-border-soft)' }}
            >
              <span className="t-faint text-xs">← 上一篇</span>
              <span className="t-strong line-clamp-1 text-sm font-medium">
                {older.title || '无标题'}
              </span>
            </button>
          ) : (
            <span className="hidden sm:block" />
          )}
          {newer ? (
            <button
              onClick={() => onNavigate(newer.id)}
              className="group flex flex-col items-end gap-1 rounded-2xl border p-4 text-right transition-colors hover:bg-[var(--lb-hover)]"
              style={{ borderColor: 'var(--lb-border-soft)' }}
            >
              <span className="t-faint text-xs">下一篇 →</span>
              <span className="t-strong line-clamp-1 text-sm font-medium">
                {newer.title || '无标题'}
              </span>
            </button>
          ) : (
            <span className="hidden sm:block" />
          )}
        </nav>
      )}
    </article>
  )
}

function HeartIcon({ filled, className }: { filled: boolean; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill={filled ? 'var(--lb-accent)' : 'none'}
      stroke={filled ? 'var(--lb-accent)' : 'currentColor'}
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
    </svg>
  )
}

function BookmarkIcon({ filled, className }: { filled: boolean; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill={filled ? 'var(--lb-accent)' : 'none'}
      stroke={filled ? 'var(--lb-accent)' : 'currentColor'}
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
    </svg>
  )
}

interface EditProps {
  draft: Article
  onChange: (a: Article) => void
  onUpdateBlock: (id: string, block: Block) => void
  onDeleteBlock: (id: string) => void
  onMoveBlock: (id: string, dir: -1 | 1) => void
  onAddBlock: (kind: 'text' | 'widget', type?: string) => void
}

function EditView({
  draft,
  onChange,
  onUpdateBlock,
  onDeleteBlock,
  onMoveBlock,
  onAddBlock,
}: EditProps) {
  const [adding, setAdding] = useState(false)
  return (
    <div className="space-y-5">
      <input
        value={draft.title}
        onChange={(e) => onChange({ ...draft, title: e.target.value })}
        placeholder="文章标题"
        className="t-heading w-full bg-transparent text-[1.875rem] font-semibold leading-[1.15] tracking-[-0.022em] outline-none placeholder:text-[var(--lb-faint)] sm:text-[2.125rem]"
        style={{ fontFamily: 'var(--lb-font-display)' }}
      />
      <input
        value={draft.description}
        onChange={(e) => onChange({ ...draft, description: e.target.value })}
        placeholder="一句话简介（可选）"
        className="t-muted w-full bg-transparent text-[1.05rem] outline-none placeholder:text-[var(--lb-faint)]"
      />

      <div className="space-y-3 pt-2">
        {draft.blocks.map((b, i) => (
          <BlockEditor
            key={b.id}
            block={b}
            index={i}
            total={draft.blocks.length}
            onChange={(nb) => onUpdateBlock(b.id, nb)}
            onDelete={() => onDeleteBlock(b.id)}
            onMove={(dir) => onMoveBlock(b.id, dir)}
          />
        ))}
      </div>

      <div className="relative">
        <button
          onClick={() => setAdding((v) => !v)}
          className="t-btn flex w-full items-center justify-center gap-1.5 rounded-xl py-3 text-sm font-medium"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
          添加段落
        </button>
        {adding && (
          <div className="t-panel mt-2 rounded-2xl p-3 shadow-xl" style={{ background: 'var(--lb-surface-bg)' }}>
            <button
              onClick={() => {
                onAddBlock('text')
                setAdding(false)
              }}
              className="mb-1 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-[var(--lb-hover)]"
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-lg text-lg" style={{ background: 'var(--lb-panel)' }}>📝</span>
              <span>
                <span className="t-strong block text-sm font-medium">文字段落</span>
                <span className="t-faint block text-xs">Markdown 文字、标题、列表、代码</span>
              </span>
            </button>
            <div className="t-faint mb-1 px-3 pt-2 text-[11px] font-medium uppercase tracking-[0.14em]">
              交互组件
            </div>
            <div className="grid">
              {listWidgets().map((w) => (
                <button
                  key={w.type}
                  onClick={() => {
                    onAddBlock('widget', w.type)
                    setAdding(false)
                  }}
                  className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-[var(--lb-hover)]"
                >
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg text-lg" style={{ background: 'var(--lb-panel)' }}>{w.icon}</span>
                  <span>
                    <span className="t-strong block text-sm font-medium">{w.label}</span>
                    <span className="t-faint block text-xs">{w.description}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
