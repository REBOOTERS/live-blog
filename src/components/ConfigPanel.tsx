import type { ConfigField, WidgetDefinition } from '../widgets/registry'

interface Props {
  def: WidgetDefinition
  value: Record<string, unknown>
  onChange: (next: Record<string, unknown>) => void
}

export function ConfigPanel({ def, value, onChange }: Props) {
  const set = (key: string, v: unknown) => onChange({ ...value, [key]: v })

  return (
    <div className="space-y-3">
      {def.configSchema.map((field) => (
        <FieldEditor key={field.key} field={field} raw={value[field.key]} onSet={(v) => set(field.key, v)} />
      ))}
    </div>
  )
}

const inputCls =
  'w-full rounded border border-white/10 bg-slate-900 px-2 py-1.5 text-sm text-slate-200 outline-none transition focus:border-indigo-400/60 focus:ring-2 focus:ring-indigo-500/20'

function FieldEditor({
  field,
  raw,
  onSet,
}: {
  field: ConfigField
  raw: unknown
  onSet: (v: unknown) => void
}) {
  const unit =
    'unit' in field && field.unit ? <span className="text-slate-500">{field.unit}</span> : null
  const label = (
    <label className="mb-1 flex items-center justify-between text-xs font-medium text-slate-400">
      <span>{field.label}</span>
      {unit}
    </label>
  )

  if (field.type === 'checkbox') {
    return (
      <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-300">
        <input
          type="checkbox"
          checked={Boolean(raw)}
          onChange={(e) => onSet(e.target.checked)}
          className="h-4 w-4 rounded accent-indigo-500"
        />
        <span>{field.label}</span>
      </label>
    )
  }

  if (field.type === 'range' || field.type === 'number') {
    const n = typeof raw === 'number' ? raw : 0
    return (
      <div>
        {label}
        <div className="flex items-center gap-2">
          <input
            type="range"
            min={field.min}
            max={field.max}
            step={field.step}
            value={n}
            onChange={(e) => onSet(Number(e.target.value))}
            className="flex-1"
          />
          <input
            type="number"
            min={field.min}
            max={field.max}
            step={field.step}
            value={n}
            onChange={(e) => onSet(Number(e.target.value))}
            className="w-20 rounded border border-white/10 bg-slate-900 px-2 py-1 text-right text-xs tabular-nums text-slate-200 outline-none focus:border-indigo-400/60"
          />
        </div>
      </div>
    )
  }

  if (field.type === 'select') {
    return (
      <div>
        {label}
        <select
          value={String(raw ?? '')}
          onChange={(e) => onSet(e.target.value)}
          className={inputCls}
        >
          {field.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
    )
  }

  if (field.type === 'color') {
    return (
      <div>
        {label}
        <input
          type="color"
          value={String(raw ?? '#000000')}
          onChange={(e) => onSet(e.target.value)}
          className="h-9 w-full cursor-pointer rounded border border-white/10 bg-slate-900"
        />
      </div>
    )
  }

  if (field.type === 'textarea') {
    return (
      <div>
        {label}
        <textarea
          value={String(raw ?? '')}
          onChange={(e) => onSet(e.target.value)}
          rows={3}
          className={inputCls}
        />
      </div>
    )
  }

  return (
    <div>
      {label}
      <input
        type="text"
        value={String(raw ?? '')}
        onChange={(e) => onSet(e.target.value)}
        className={inputCls}
      />
    </div>
  )
}
