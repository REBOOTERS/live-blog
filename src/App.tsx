import { useEffect, useMemo, useState } from 'react'
import type { Article, Block } from './types'
import { loadArticles, upsertArticle, deleteArticle } from './storage'
import { uid } from './lib/id'
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

  const current = useMemo(
    () => articles.find((a) => a.id === currentId) ?? articles[0],
    [articles, currentId],
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
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3">
          <button
            className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 md:hidden"
            onClick={() => setSidebarOpen((o) => !o)}
            aria-label="菜单"
          >
            ☰
          </button>
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-500 text-white">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 20 L12 4 L20 20" />
                <circle cx="12" cy="20" r="1.6" fill="currentColor" />
              </svg>
            </div>
            <div>
              <div className="text-sm font-semibold leading-tight tracking-tight">
                <span className="font-mono text-indigo-500">❯</span> LiveBlog
              </div>
              <div className="font-mono text-[11px] leading-tight text-slate-400">interactive · writing</div>
            </div>
          </div>

          <div className="ml-auto flex items-center gap-2">
            {mode === 'edit' ? (
              <>
                <button
                  onClick={() => setMode('read')}
                  className="rounded-md px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
                >
                  取消
                </button>
                <button
                  onClick={save}
                  className="rounded-md bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
                >
                  保存
                </button>
              </>
            ) : (
              <button
                onClick={() => setMode('edit')}
                className="rounded-md bg-slate-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-slate-700"
              >
                ✎ 编辑
              </button>
            )}
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-5xl gap-6 px-4 py-6">
        {/* Sidebar */}
        <aside
          className={`${
            sidebarOpen ? 'block' : 'hidden'
          } w-60 shrink-0 md:block`}
        >
          <div className="sticky top-20 space-y-3">
            <button
              onClick={createArticle}
              className="w-full rounded-md border border-dashed border-slate-300 px-3 py-2 text-sm text-slate-600 hover:border-indigo-400 hover:text-indigo-600"
            >
              + 新建文章
            </button>
            <div className="space-y-1">
              {articles.map((a) => (
                <div
                  key={a.id}
                  className={`group cursor-pointer rounded-lg border-l-2 px-3 py-2 text-sm transition-colors ${
                    a.id === currentId
                      ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                      : 'border-transparent text-slate-700 hover:bg-slate-50'
                  }`}
                  onClick={() => {
                    setCurrentId(a.id)
                    setMode('read')
                    setSidebarOpen(false)
                  }}
                >
                  <div className="line-clamp-2 font-medium leading-snug">{a.title || '无标题'}</div>
                  <div className="mt-0.5 flex items-center justify-between text-[11px] text-slate-400">
                    <span>{new Date(a.updatedAt).toLocaleDateString()}</span>
                    <button
                      className="opacity-0 group-hover:opacity-100 hover:text-red-500"
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
      <h1 className="text-3xl font-bold leading-tight tracking-tight text-slate-900 md:text-4xl">{article.title}</h1>
      {article.description && (
        <p className="mt-3 text-lg text-slate-500">{article.description}</p>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-2 font-mono text-xs text-slate-400">
        <span>{new Date(article.updatedAt).toLocaleDateString()}</span>
        <span>·</span>
        <span>{article.blocks.length} 个段落</span>
        <span>·</span>
        <span>⏱ 约 {readingTime(article)} 分钟</span>
      </div>
      <div className="my-8 h-px bg-slate-200" />
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
        className="w-full bg-transparent text-3xl font-bold leading-tight text-slate-900 outline-none placeholder:text-slate-300"
      />
      <input
        value={draft.description}
        onChange={(e) => onChange({ ...draft, description: e.target.value })}
        placeholder="一句话简介（可选）"
        className="w-full bg-transparent text-base text-slate-500 outline-none placeholder:text-slate-300"
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
          className="w-full rounded-xl border-2 border-dashed border-slate-200 py-3 text-sm text-slate-500 hover:border-indigo-400 hover:text-indigo-600"
        >
          + 添加段落
        </button>
        {adding && (
          <div className="mt-2 rounded-xl border border-slate-200 bg-white p-3 shadow-lg">
            <button
              onClick={() => {
                onAddBlock('text')
                setAdding(false)
              }}
              className="mb-2 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-slate-50"
            >
              <span className="text-xl">📝</span>
              <span>
                <span className="block text-sm font-medium">文字段落</span>
                <span className="block text-xs text-slate-400">Markdown 文字、标题、列表、代码</span>
              </span>
            </button>
            <div className="mb-1 px-3 text-xs font-medium uppercase tracking-wide text-slate-400">
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
                  className="flex items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-slate-50"
                >
                  <span className="text-xl">{w.icon}</span>
                  <span>
                    <span className="block text-sm font-medium">{w.label}</span>
                    <span className="block text-xs text-slate-400">{w.description}</span>
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
