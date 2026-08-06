import { useEffect, useMemo, useState } from 'react'
import type { Article, Block } from './types'
import { loadArticles, upsertArticle, deleteArticle } from './storage'
import { uid } from './lib/id'
import { useTheme, toggleTheme } from './lib/theme'
import { BlockRenderer } from './components/BlockRenderer'
import { BlockEditor } from './components/BlockEditor'
import { getWidget, listWidgets } from './widgets/registry'

type Mode = 'read' | 'edit'

export default function App() {
  const [articles, setArticles] = useState<Article[]>(() => loadArticles())
  const [currentId, setCurrentId] = useState<string>(() => loadArticles()[0].id)
  const [mode, setMode] = useState<Mode>('read')
  const [draft, setDraft] = useState<Article | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const [query, setQuery] = useState('')
  const theme = useTheme()

  const current = useMemo(
    () => articles.find((a) => a.id === currentId) ?? articles[0],
    [articles, currentId],
  )

  // sidebar search: match title / description / text-block content
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return articles
    return articles.filter(
      (a) =>
        a.title.toLowerCase().includes(q) ||
        a.description.toLowerCase().includes(q) ||
        a.blocks.some((b) => b.kind === 'text' && b.content.toLowerCase().includes(q)),
    )
  }, [articles, query])

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
      updatedAt: new Date().toISOString(),
      blocks: [
        { id: uid('blk'), kind: 'text', content: '## 开始写作\n\n在这里写下你的内容……' },
      ],
    }
    setArticles(upsertArticle(a))
    setCurrentId(a.id)
    setMode('edit')
  }

  const removeArticle = (id: string) => {
    if (!confirm('确定删除这篇文章吗？')) return
    const next = deleteArticle(id)
    setArticles(next)
    setCurrentId(next[0].id)
    setMode('read')
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

  return (
    <div className="min-h-full">
      <header
        className="sticky top-0 z-20 border-b backdrop-blur-xl"
        style={{ borderColor: 'var(--lb-border-soft)', background: 'color-mix(in srgb, var(--lb-bg-1) 70%, transparent)' }}
      >
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
          <button
            className="t-muted rounded-md p-1.5 hover:bg-[var(--lb-hover)] md:hidden"
            onClick={() => setSidebarOpen((o) => !o)}
            aria-label="菜单"
          >
            ☰
          </button>
          <div className="flex items-center gap-2.5">
            <div className="relative flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-cyan-400 text-slate-950 shadow-[0_0_22px_-4px_rgba(99,102,241,0.8)]">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 20 L12 4 L20 20" />
                <circle cx="12" cy="20" r="1.7" fill="currentColor" />
              </svg>
            </div>
            <div>
              <div className="t-heading text-sm font-semibold leading-tight tracking-tight">
                <span className="font-mono" style={{ color: 'var(--lb-accent)' }}>❯</span> LiveBlog
              </div>
              <div className="t-faint font-mono text-[10px] uppercase leading-tight tracking-[0.18em]">interactive · writing</div>
            </div>
          </div>

          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={toggleTheme}
              title={theme === 'dark' ? '切换到日间模式' : '切换到夜间模式'}
              aria-label="切换主题"
              className="t-btn flex h-9 w-9 items-center justify-center rounded-md"
            >
              {theme === 'dark' ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="4" />
                  <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
                </svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
                </svg>
              )}
            </button>
            {mode === 'edit' ? (
              <>
                <button
                  onClick={() => setMode('read')}
                  className="t-btn rounded-md px-3 py-1.5 text-sm"
                >
                  取消
                </button>
                <button onClick={save} className="t-btn-primary rounded-md px-4 py-1.5 text-sm">
                  保存
                </button>
              </>
            ) : (
              <button
                onClick={() => setMode('edit')}
                className="rounded-md border px-4 py-1.5 text-sm font-medium transition"
                style={{ borderColor: 'var(--lb-border)', background: 'rgba(99,102,241,0.1)', color: 'var(--lb-accent-2)' }}
              >
                ✎ 编辑
              </button>
            )}
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-6xl gap-7 px-4 py-7">
        {/* Desktop expand rail - shown when sidebar is collapsed */}
        {collapsed && (
          <button
            onClick={() => setCollapsed(false)}
            title="展开目录"
            aria-label="展开目录"
            className="t-btn sticky top-7 hidden h-9 w-9 shrink-0 items-center justify-center self-start rounded-md md:flex"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 18l6-6-6-6" />
            </svg>
          </button>
        )}

        {/* Sidebar */}
        <aside
          className={`w-60 shrink-0 ${
            collapsed
              ? sidebarOpen
                ? 'block md:hidden'
                : 'hidden md:hidden'
              : sidebarOpen
                ? 'block md:block'
                : 'hidden md:block'
          }`}
        >
          <div className="sticky top-20 space-y-3">
            {/* search + collapse header */}
            <div className="flex items-center gap-1.5">
              <div className="relative flex-1">
                <span className="t-faint pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-xs">🔍</span>
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="搜索文章…"
                  className="t-input w-full rounded-md py-1.5 pl-7 pr-2 text-sm outline-none transition placeholder:text-[var(--lb-faint)]"
                />
              </div>
              <button
                onClick={() => setCollapsed(true)}
                title="收起目录"
                aria-label="收起目录"
                className="t-btn hidden h-8 w-8 shrink-0 items-center justify-center rounded-md md:flex"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M15 18l-6-6 6-6" />
                </svg>
              </button>
            </div>

            <button
              onClick={createArticle}
              className="w-full rounded-lg border border-dashed px-3 py-2 text-sm font-medium transition"
              style={{ borderColor: 'var(--lb-border)', background: 'rgba(99,102,241,0.06)', color: 'var(--lb-accent-2)' }}
            >
              + 新建文章
            </button>

            {query.trim() && (
              <div className="t-faint px-1 font-mono text-[10px]">
                {filtered.length ? `${filtered.length} 篇匹配` : '无匹配'}
              </div>
            )}

            <div className="space-y-1">
              {filtered.map((a) => (
                <div
                  key={a.id}
                  className={`group cursor-pointer rounded-lg border-l-2 px-3 py-2 text-sm transition-all ${
                    a.id === currentId ? '' : 't-muted hover:bg-[var(--lb-hover)]'
                  }`}
                  style={
                    a.id === currentId
                      ? { borderColor: 'var(--lb-accent)', background: 'linear-gradient(90deg, rgba(99,102,241,0.15), transparent)', color: 'var(--lb-text-strong)' }
                      : { borderColor: 'transparent' }
                  }
                  onClick={() => {
                    setCurrentId(a.id)
                    setMode('read')
                    setSidebarOpen(false)
                  }}
                >
                  <div className="line-clamp-2 font-medium leading-snug">{a.title || '无标题'}</div>
                  {a.description && (
                    <div className="t-faint mt-0.5 line-clamp-1 text-[11px]">{a.description}</div>
                  )}
                  <div className="t-faint mt-1 flex items-center justify-between text-[11px]">
                    <span className="font-mono">{new Date(a.updatedAt).toLocaleDateString()}</span>
                    <button
                      className="opacity-0 transition group-hover:opacity-100 hover:text-rose-400"
                      onClick={(e) => {
                        e.stopPropagation()
                        removeArticle(a.id)
                      }}
                    >
                      删除
                    </button>
                  </div>
                </div>
              ))}
              {query.trim() && filtered.length === 0 && (
                <div className="t-faint px-3 py-6 text-center text-xs">
                  没有匹配「{query.trim()}」的文章
                </div>
              )}
            </div>
          </div>
        </aside>

        {/* Main */}
        <main className="min-w-0 flex-1">
          {mode === 'read' ? (
            <ReadView article={current} />
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

function ReadView({ article }: { article: Article }) {
  return (
    <article>
      <div
        className="mb-2 inline-flex items-center gap-2 rounded-full px-3 py-1 font-mono text-[11px] uppercase tracking-[0.2em]"
        style={{ border: '1px solid var(--lb-border)', background: 'rgba(99,102,241,0.1)', color: 'var(--lb-accent-2)' }}
      >
        <span className="h-1.5 w-1.5 animate-pulse rounded-full" style={{ background: 'var(--lb-accent)' }} />
        Interactive Article
      </div>
      <h1 className="t-heading text-3xl font-bold leading-tight tracking-tight md:text-[2.6rem]">
        {article.title}
      </h1>
      {article.description && (
        <p className="t-muted mt-4 text-lg leading-relaxed">{article.description}</p>
      )}
      <div className="t-faint mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs">
        <span className="t-muted">{new Date(article.updatedAt).toLocaleDateString()}</span>
        <span>/</span>
        <span>{article.blocks.length} 个段落</span>
        <span>/</span>
        <span>约 {readingTime(article)} 分钟阅读</span>
      </div>
      <div className="my-9 h-px" style={{ background: 'linear-gradient(90deg, transparent, var(--lb-accent-2), var(--lb-accent), transparent)' }} />
      <div>
        {article.blocks.map((b) => (
          <BlockRenderer key={b.id} block={b} />
        ))}
      </div>
    </article>
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
    <div className="space-y-4">
      <input
        value={draft.title}
        onChange={(e) => onChange({ ...draft, title: e.target.value })}
        placeholder="文章标题"
        className="t-heading w-full bg-transparent text-3xl font-bold leading-tight outline-none placeholder:text-[var(--lb-faint)]"
      />
      <input
        value={draft.description}
        onChange={(e) => onChange({ ...draft, description: e.target.value })}
        placeholder="一句话简介（可选）"
        className="t-muted w-full bg-transparent text-base outline-none placeholder:text-[var(--lb-faint)]"
      />

      <div className="space-y-3">
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
          className="w-full rounded-xl border-2 border-dashed py-3 text-sm font-medium transition"
          style={{ borderColor: 'var(--lb-border)', background: 'rgba(99,102,241,0.05)', color: 'var(--lb-accent-2)' }}
        >
          + 添加段落
        </button>
        {adding && (
          <div className="t-panel mt-2 rounded-xl p-3 shadow-2xl backdrop-blur" style={{ background: 'var(--lb-surface-bg)' }}>
            <button
              onClick={() => {
                onAddBlock('text')
                setAdding(false)
              }}
              className="t-strong mb-2 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-[var(--lb-hover)]"
            >
              <span className="text-xl">📝</span>
              <span>
                <span className="t-strong block text-sm font-medium">文字段落</span>
                <span className="t-faint block text-xs">Markdown 文字、标题、列表、代码</span>
              </span>
            </button>
            <div className="t-faint mb-1 px-3 font-mono text-[10px] uppercase tracking-[0.18em]">
              交互组件
            </div>
            <div className="grid gap-1">
              {listWidgets().map((w) => (
                <button
                  key={w.type}
                  onClick={() => {
                    onAddBlock('widget', w.type)
                    setAdding(false)
                  }}
                  className="t-strong flex items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-[var(--lb-hover)]"
                >
                  <span className="text-xl">{w.icon}</span>
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
