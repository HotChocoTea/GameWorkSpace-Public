import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Play, Square, Trash2, Upload, X } from 'lucide-react'
import { api } from '../api/client'
import type { Entity } from '../types'
import { checklist, stopTimer, timeRecord, withData } from '../state/planning'
import { useWorkspace } from '../state/workspace'

export function Field({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  )
}
export function Options({ values }: { values: string[] }) {
  return (
    <>
      {values.map((s) => (
        <option key={s}>{s}</option>
      ))}
    </>
  )
}
export function Meter({ done, total }: { done: number; total: number }) {
  return (
    <progress value={done} max={total || 1} aria-label={done + ' / ' + total} />
  )
}
export function Checklist({
  entity,
  name,
  change,
}: {
  entity: Entity
  name: 'deliverables' | 'subtasks'
  change: (e: Entity) => void
}) {
  const rows = checklist(entity, name),
    [input, set] = useState('')
  function update(next: typeof rows) {
    change(
      withData(
        entity,
        name,
        next.map((r) => ({
          id: r.id,
          [name === 'subtasks' ? 'title' : 'text']: r.title,
          done: r.done,
        })),
      ),
    )
  }
  function add() {
    if (input.trim()) {
      update([
        ...rows,
        { id: crypto.randomUUID(), title: input.trim(), done: false },
      ])
      set('')
    }
  }
  return (
    <section className="stack">
      <div className="split">
        <h3>{name === 'subtasks' ? '子任务' : '交付清单'}</h3>
        <small>
          {rows.filter((r) => r.done).length} / {rows.length}
        </small>
      </div>
      <Meter done={rows.filter((r) => r.done).length} total={rows.length} />
      {rows.map((r) => (
        <div className="check-row" key={r.id}>
          <label>
            <input
              type="checkbox"
              checked={r.done}
              onChange={() =>
                update(
                  rows.map((item) =>
                    item.id === r.id ? { ...item, done: !r.done } : item,
                  ),
                )
              }
            />
            {r.title}
          </label>
          <button
            title="删除此项"
            onClick={() => update(rows.filter((item) => item.id !== r.id))}
          >
            <X size={13} />
          </button>
        </div>
      ))}
      <div className="inline">
        <input
          placeholder={name === 'subtasks' ? '添加子任务' : '添加交付项'}
          value={input}
          onChange={(e) => set(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
              e.preventDefault()
              add()
            }
          }}
        />
        <button className="secondary" disabled={!input.trim()} onClick={add}>
          添加
        </button>
      </div>
    </section>
  )
}
export function TimerButton({
  task,
  small = false,
}: {
  task: Entity
  small?: boolean
}) {
  const { active, run } = useWorkspace(),
    on = active?.taskId === task.id
  const label = on ? '停止计时' : '开始计时'
  return (
    <button
      className={small ? 'icon-button' : 'secondary'}
      title={label}
      aria-label={label}
      disabled={!!active && !on}
      onClick={() =>
        void run(() =>
          active
            ? stopTimer(active)
            : api.saveTimeEntry(timeRecord(task.projectId, task.id, '')),
        )
      }
    >
      {on ? <Square size={14} /> : <Play size={14} />} {!small && label}
    </button>
  )
}
export function ImagesField({
  names,
  change,
  label,
  paste = false,
}: {
  names: string[]
  change: (names: string[]) => void
  label: string
  paste?: boolean
}) {
  const { notify } = useWorkspace(),
    [busy, setBusy] = useState(false)
  const latest = useRef({ names, change })
  latest.current = { names, change }
  async function upload(files: File[]) {
    if (!files.length) return
    setBusy(true)
    try {
      const items = await Promise.all(files.map((f) => api.saveAsset(f)))
      latest.current.change([
        ...latest.current.names,
        ...items.map((a) => a.filename),
      ])
    } catch (e) {
      notify(String(e))
    } finally {
      setBusy(false)
    }
  }
  useEffect(() => {
    if (!paste) return
    const onPaste = (e: ClipboardEvent) => {
      if (document.querySelector('dialog[open]')) return
      const files = Array.from(e.clipboardData?.files ?? []).filter((f) =>
        f.type.startsWith('image/'),
      )
      if (files.length) {
        e.preventDefault()
        void upload(files)
      }
    }
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  }, [paste])
  return (
    <section className="stack">
      <div className="split">
        <h3>{label}</h3>
        <label className="file-button">
          <Upload size={14} />
          {busy ? '上传中…' : '上传图片'}
          <input
            disabled={busy}
            type="file"
            multiple
            accept="image/*"
            onChange={(e) => {
              void upload(Array.from(e.target.files ?? []))
              e.target.value = ''
            }}
          />
        </label>
      </div>
      {paste && <small>按 Ctrl+V 粘贴截图</small>}
      <div className="thumbs">
        {names.map((n, i) => (
          <div key={n + i}>
            <img src={api.assetUrl(n)} alt={label} />
            <button
              title="移除图片"
              onClick={() => change(names.filter((_, idx) => idx !== i))}
            >
              <Trash2 size={13} />
            </button>
          </div>
        ))}
      </div>
    </section>
  )
}
export function BarChart({
  labels,
  values,
  unit,
}: {
  labels: string[]
  values: number[]
  unit: string
}) {
  const max = Math.max(1, ...values),
    width = 420,
    height = 128,
    step = width / values.length
  return (
    <svg
      viewBox={'0 0 ' + width + ' 162'}
      role="img"
      aria-label={labels.map((l, i) => l + ' ' + values[i] + unit).join('，')}
      className="bar-chart"
    >
      {[0, 0.5, 1].map((n) => (
        <line
          key={n}
          x1="0"
          y1={height - n * 95}
          x2={width}
          y2={height - n * 95}
          stroke="var(--line)"
          strokeDasharray="3 3"
        />
      ))}
      {values.map((v, i) => {
        const h = (95 * v) / max,
          x = (i + 0.5) * step
        return (
          <g key={i}>
            <title>
              {labels[i]} · {v} {unit}
            </title>
            <rect
              x={x - step * 0.24}
              y={height - h}
              width={step * 0.48}
              height={Math.max(1, h)}
              rx="3"
              fill="var(--accent)"
            />
            <text x={x} y={height - h - 7}>
              {v}
            </text>
            <text x={x} y="149">
              {labels[i]}
            </text>
          </g>
        )
      })}
    </svg>
  )
}
