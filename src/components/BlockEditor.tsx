import { useState } from 'react'
import type { Block } from '../types'
import { getWidget, listWidgets } from '../widgets/registry'
import { renderMarkdown } from '../lib/markdown'
import { ConfigPanel } from './ConfigPanel'

interface Props {
  block: Block
  index: number
  total: number
  onChange: (block: Block) => void
  onDelete: () => void
  onMove: (dir: -1 | 1) => void
}

export function BlockEditor({ block, index, total, onChange, onDelete, onMove }: Props) {
  return (
    <div className="group rounded-xl border p-3 shadow-lg" style={{ borderColor: 'var(--lb-border-soft)', background: 'var(--lb-surface-bg)' }}>
      <div className="mb-2 flex items-center gap-1">
        <span
          className="rounded px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wider"
          style={{ border: '1px solid var(--lb-border)', background: 'rgba(99,102,241,0.1)', color: 'var(--lb-accent-2)' }}
        >
          {block.kind === 'text' ? '文字' : '交互组件'}
        </span>
        <div className="ml-auto flex items-center gap-1 opacity-60 transition group-hover:opacity-100">
          <IconBtn label="上移" disabled={index === 0} onClick={() => onMove(-1)}>
            ↑
          </IconBtn>
          <IconBtn label="下移" disabled={index === total - 1} onClick={() => onMove(1)}>
            ↓
          </IconBtn>
          <IconBtn label="删除" onClick={onDelete} danger>
            ✕
          </IconBtn>
        </div>
      </div>

      {block.kind === 'text' ? (
        <TextEditor value={block.content} onChange={(content) => onChange({ ...block, content })} />
      ) : (
        <WidgetEditor
          type={block.type}
          props={block.props}
          onChange={(type, props) => onChange({ ...block, type, props })}
        />
      )}
    </div>
  )
}

function IconBtn({
  children,
  onClick,
  disabled,
  label,
  danger,
}: {
  children: React.ReactNode
  onClick: () => void
  disabled?: boolean
  label: string
  danger?: boolean
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={`flex h-7 w-7 items-center justify-center rounded text-sm ${
        danger ? 'text-rose-400 hover:bg-rose-500/10' : 't-muted hover:bg-[var(--lb-hover)] hover:t-strong'
      } disabled:cursor-not-allowed disabled:opacity-30`}
    >
      {children}
    </button>
  )
}

function TextEditor({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [tab, setTab] = useState<'edit' | 'preview'>('edit')
  return (
    <div>
      <div className="mb-2 flex gap-1 text-xs">
        <button
          type="button"
          onClick={() => setTab('edit')}
          className={`rounded px-2.5 py-1 font-medium transition ${tab === 'edit' ? 't-btn-primary' : 't-btn t-muted'}`}
        >
          编辑
        </button>
        <button
          type="button"
          onClick={() => setTab('preview')}
          className={`rounded px-2.5 py-1 font-medium transition ${tab === 'preview' ? 't-btn-primary' : 't-btn t-muted'}`}
        >
          预览
        </button>
        <span className="t-faint ml-auto self-center font-mono">支持 Markdown · KaTeX 公式</span>
      </div>
      {tab === 'edit' ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={Math.max(4, value.split('\n').length + 1)}
          placeholder="在这里写下你的文字……（支持 Markdown）"
          className="t-input w-full resize-y rounded-lg p-3 font-mono text-sm leading-relaxed outline-none transition placeholder:text-[var(--lb-faint)]"
        />
      ) : (
        <div
          className="prose-lb t-panel min-h-[80px] rounded-lg p-4"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(value || '_（空）_') }}
        />
      )}
    </div>
  )
}

function WidgetEditor({
  type,
  props,
  onChange,
}: {
  type: string
  props: Record<string, unknown>
  onChange: (type: string, props: Record<string, unknown>) => void
}) {
  const def = getWidget(type)
  const all = listWidgets()

  return (
    <div className="grid gap-3 md:grid-cols-[1fr_240px]">
      <div>
        {def ? (
          <def.Component props={props} />
        ) : (
          <div className="rounded-xl border border-dashed border-red-300 bg-red-50 p-6 text-center text-sm text-red-700">
            未知组件类型：{type}
          </div>
        )}
      </div>
      <div className="t-panel rounded-lg p-3">
        <label className="t-faint mb-1 block font-mono text-[10px] font-medium uppercase tracking-wider">组件类型</label>
        <select
          value={type}
          onChange={(e) => {
            const next = getWidget(e.target.value)!
            onChange(next.type, next.defaultProps)
          }}
          className="t-input mb-3 w-full rounded px-2 py-1.5 text-sm outline-none"
        >
          {all.map((w) => (
            <option key={w.type} value={w.type}>
              {w.icon} {w.label}
            </option>
          ))}
        </select>
        {def && (
          <>
            <div className="t-faint mb-2 font-mono text-[10px] font-medium uppercase tracking-wider">参数</div>
            <ConfigPanel def={def} value={props} onChange={(next) => onChange(type, next)} />
          </>
        )}
      </div>
    </div>
  )
}
