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
    <div className="group rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      <div className="mb-2 flex items-center gap-1">
        <span className="rounded bg-slate-100 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-slate-500">
          {block.kind === 'text' ? '文字' : '交互组件'}
        </span>
        <div className="ml-auto flex items-center gap-1 opacity-70">
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
        danger
          ? 'text-red-500 hover:bg-red-50'
          : 'text-slate-500 hover:bg-slate-100'
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
          className={`rounded px-2 py-1 ${tab === 'edit' ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600'}`}
        >
          编辑
        </button>
        <button
          type="button"
          onClick={() => setTab('preview')}
          className={`rounded px-2 py-1 ${tab === 'preview' ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600'}`}
        >
          预览
        </button>
        <span className="ml-auto self-center text-slate-400">支持 Markdown：# 标题、**粗体**、`code`、- 列表</span>
      </div>
      {tab === 'edit' ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={Math.max(4, value.split('\n').length + 1)}
          placeholder="在这里写下你的文字……（支持 Markdown）"
          className="w-full resize-y rounded-lg border border-slate-200 p-3 font-mono text-sm leading-relaxed focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
        />
      ) : (
        <div
          className="prose-lb min-h-[80px] rounded-lg border border-slate-100 bg-slate-50 p-3"
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
      <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
        <label className="mb-1 block text-xs font-medium text-slate-600">组件类型</label>
        <select
          value={type}
          onChange={(e) => {
            const next = getWidget(e.target.value)!
            onChange(next.type, next.defaultProps)
          }}
          className="mb-3 w-full rounded border border-slate-200 bg-white px-2 py-1.5 text-sm"
        >
          {all.map((w) => (
            <option key={w.type} value={w.type}>
              {w.icon} {w.label}
            </option>
          ))}
        </select>
        {def && (
          <>
            <div className="mb-2 text-xs font-medium text-slate-600">参数</div>
            <ConfigPanel def={def} value={props} onChange={(next) => onChange(type, next)} />
          </>
        )}
      </div>
    </div>
  )
}
