import { MentionEditor } from '../../components/MentionEditor'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  ChevronDown,
  ChevronRight,
  FileImage,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react'
import { api } from '../../api/client'
import { EntityLinkPanel } from '../../components/EntityLinkPanel'
import { Field } from '../../components/PlanningUI'
import { IconButton } from '../../components/ui'
import { ImpactButton } from '../../components/ImpactModal'
import { useWorkspace } from '../../state/workspace'
import type { Entity, Json } from '../../types'
import {
  ancestors,
  forest,
  numeric,
  rowsOf,
  scalar,
  useEditor,
  value,
  type Editor,
} from './worldUtils'

export function Heading({
  title,
  tabs,
  active,
  choose,
  children,
}: {
  title: string
  tabs?: string[]
  active?: string
  choose?: (s: string) => void
  children?: ReactNode
}) {
  return (
    <header className="world-heading">
      <h1>{title}</h1>
      {tabs && (
        <div className="segments">
          {tabs.map((s) => (
            <button
              key={s}
              aria-pressed={active === s}
              className={active === s ? 'active' : ''}
              onClick={() => choose?.(s)}
            >
              {s}
            </button>
          ))}
        </div>
      )}
      <div className="world-actions">{children}</div>
    </header>
  )
}
export function Add({ label, click }: { label: string; click: () => void }) {
  return (
    <button className="primary" onClick={click}>
      <Plus size={15} />
      {label}
    </button>
  )
}
export function SearchField({
  query,
  set,
  label,
}: {
  query: string
  set: (s: string) => void
  label: string
}) {
  return (
    <label className="world-search">
      <Search size={15} />
      <input
        aria-label={label}
        placeholder={label}
        type="search"
        value={query}
        onChange={(ev) => set(ev.target.value)}
      />
    </label>
  )
}
export function Select({
  label,
  options,
  current,
  change,
  empty,
}: {
  label: string
  options: string[]
  current: string
  change: (s: string) => void
  empty?: string
}) {
  const choices =
    current && !options.includes(current) ? [current, ...options] : options
  return (
    <select
      aria-label={label}
      value={current}
      onChange={(ev) => change(ev.target.value)}
    >
      {empty !== undefined && <option value="">{empty}</option>}
      {choices.map((s) => (
        <option key={s}>{s}</option>
      ))}
    </select>
  )
}
export function Filter({
  label,
  options,
  current,
  change,
}: Parameters<typeof Select>[0]) {
  return (
    <Select
      label={label}
      options={options}
      current={current}
      change={change}
      empty={'全部' + label}
    />
  )
}
export function TextField({
  label,
  current,
  change,
  multiline = false,
  type = 'text',
  min,
  step = 1,
}: {
  label: string
  current: string
  change: (s: string) => void
  multiline?: boolean
  type?: string
  min?: number
  step?: number | 'any'
}) {
  return (
    <Field label={label}>
      {multiline ? (
        <MentionEditor rows={3} value={current} onValue={change} />
      ) : (
        <input
          type={type}
          step={type === 'number' ? step : undefined}
          min={min}
          value={current}
          onChange={(ev) => change(ev.target.value)}
        />
      )}
    </Field>
  )
}
export function EntryField({
  editor,
  name,
  label,
}: {
  editor: Editor
  name: 'title' | 'summary' | 'body'
  label: string
}) {
  return (
    <TextField
      label={label}
      current={editor.e[name]}
      multiline={name === 'body'}
      change={(s) => editor.edit({ [name]: s })}
    />
  )
}
export function DataField({
  editor,
  name,
  label,
  options,
  multiline,
  fallback = '',
  type = 'text',
  min,
  step = 1,
}: {
  editor: Editor
  name: string
  label: string
  options?: string[]
  multiline?: boolean
  fallback?: string
  type?: string
  min?: number
  step?: number | 'any'
}) {
  const stored = value(editor.e, name, fallback || options?.[0] || '')
  const current =
    name === 'rarity' && (stored === '常见' || stored === '精制')
      ? fallback
      : stored
  if (options)
    return (
      <Field label={label}>
        <Select
          {...{ label, current, options }}
          change={(s) => editor.data(name, s)}
        />
      </Field>
    )
  return (
    <TextField
      {...{ label, current, multiline, type, min, step }}
      change={(s) =>
        editor.data(
          name,
          type === 'number'
            ? s === ''
              ? null
              : Math.max(
                  min ?? -Infinity,
                  step === 'any' ? Number(s) : Math.trunc(Number(s)),
                )
            : s,
        )
      }
    />
  )
}
export function EntitySelect({
  label,
  current,
  rows,
  change,
  empty = '未关联',
}: {
  label: string
  current: string
  rows: Entity[]
  change: (s: string) => void
  empty?: string
}) {
  return (
    <select
      aria-label={label}
      value={current}
      onChange={(ev) => change(ev.target.value)}
    >
      <option value="">{empty}</option>
      {rows.map((e) => (
        <option key={e.id} value={e.id}>
          {e.title}
        </option>
      ))}
    </select>
  )
}
export function Reference({
  editor,
  name,
  label,
  type,
  rows,
  empty,
}: {
  editor: Editor
  name: string
  label: string
  type?: string
  rows?: Entity[]
  empty?: string
}) {
  const { entities, openEntity } = useWorkspace()
  const choices = rows ?? entities.filter((e) => e.entityType === type)
  const current = value(editor.e, name),
    target = choices.find((e) => e.id === current)
  return (
    <div className="field">
      <span>{label}</span>
      <div className="world-ref">
        <EntitySelect
          {...{ label, current, rows: choices, empty }}
          change={(s) => editor.data(name, s || null)}
        />
        {target && (
          <button
            title={'打开' + target.title}
            onClick={() => openEntity(target)}
          >
            打开
          </button>
        )}
      </div>
    </div>
  )
}
export function MultiPick({
  rows,
  ids,
  change,
  label,
}: {
  rows: Entity[]
  ids: string[]
  change: (s: string[]) => void
  label: string
}) {
  const { openEntity } = useWorkspace()
  return (
    <fieldset className="world-options">
      <legend>{label}</legend>
      {rows.map((e) => (
        <div key={e.id}>
          <label>
            <input
              type="checkbox"
              checked={ids.includes(e.id)}
              onChange={(ev) =>
                change(
                  ev.target.checked
                    ? [...ids, e.id]
                    : ids.filter((id) => id !== e.id),
                )
              }
            />
            {e.title}
          </label>
          {ids.includes(e.id) && (
            <button title={'打开' + e.title} onClick={() => openEntity(e)}>
              ↗
            </button>
          )}
        </div>
      ))}
      {!rows.length && <small>暂无可选条目</small>}
    </fieldset>
  )
}
export function AssetInput({
  label,
  saveFile,
  name,
}: {
  label: string
  saveFile: (filename: string) => void
  name?: string
}) {
  const { notify } = useWorkspace()
  const [busy, setBusy] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const latest = useRef(saveFile)
  latest.current = saveFile
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    const editor = box.current?.closest<HTMLElement>(
      '.world-detail,.world-page',
    )
    function paste(ev: ClipboardEvent) {
      const image = Array.from(ev.clipboardData?.files ?? []).find((file) =>
        file.type.startsWith('image/'),
      )
      if (image && !ev.defaultPrevented) {
        ev.preventDefault()
        void upload(image)
      }
    }
    editor?.addEventListener('paste', paste)
    return () => {
      alive.current = false
      editor?.removeEventListener('paste', paste)
    }
  }, [])
  async function upload(file?: File) {
    if (!file) return
    setBusy(true)
    try {
      const asset = await api.saveAsset(file)
      if (alive.current) latest.current(asset.filename)
    } catch (error) {
      notify(String(error))
    } finally {
      if (alive.current) setBusy(false)
    }
  }
  return (
    <div
      className="world-asset"
      ref={box}
      tabIndex={0}
      aria-label={label + '，可粘贴图片'}
    >
      {name && <img src={api.assetUrl(name)} alt={label} />}
      <label className="file-button">
        <FileImage size={15} />
        {busy ? '上传中…' : label}
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif,image/avif,image/bmp"
          disabled={busy}
          onChange={(ev) => {
            void upload(ev.target.files?.[0])
            ev.target.value = ''
          }}
        />
      </label>
      <small>可在此粘贴图片</small>
      {name && (
        <IconButton label="移除图片" onClick={() => saveFile('')}>
          <X size={13} />
        </IconButton>
      )}
    </div>
  )
}
export function Photo({
  editor,
  name,
  label,
}: {
  editor: Editor
  name: string
  label: string
}) {
  return (
    <AssetInput
      label={label}
      name={value(editor.e, name)}
      saveFile={(s) => editor.data(name, s || null)}
    />
  )
}
export function Card({
  entity,
  open,
  asset,
  kind,
  badge,
  children,
  color,
}: {
  entity: Entity
  open: (e: Entity) => void
  asset?: string
  kind?: string
  badge?: string
  children?: ReactNode
  color?: string
}) {
  const name = asset && value(entity, asset)
  return (
    <article
      className={'world-card ' + (kind ?? '')}
      style={color ? { borderTop: '3px solid ' + color } : undefined}
    >
      <button className="world-card-open" onClick={() => open(entity)}>
        <span className="world-art" aria-hidden="true">
          {name ? (
            <img src={api.assetUrl(name)} alt="" />
          ) : (
            <span>{value(entity, 'icon', entity.title.slice(0, 1))}</span>
          )}
        </span>
        <span className="world-card-text">
          <strong>{entity.title || '未命名'}</strong>
          {badge && <small>{badge}</small>}
          {entity.summary && <span>{entity.summary}</span>}
        </span>
      </button>
      {children && <div className="world-card-foot">{children}</div>}
    </article>
  )
}
export function SaveStatus({ editor }: { editor: Editor }) {
  return (
    <button
      className="world-save"
      aria-live="polite"
      disabled={!editor.status.includes('失败')}
      onClick={() => void editor.flush()}
    >
      {editor.status}
    </button>
  )
}
export function TrashEntry({ editor }: { editor: Editor }) {
  const { trash, run, close } = useWorkspace()
  return (
    <IconButton
      label="移入回收站"
      onClick={() =>
        void run(async () => {
          await editor.flush()
          await trash(editor.e.id)
          close()
        })
      }
    >
      <Trash2 size={15} />
    </IconButton>
  )
}
export function Detail({
  entity,
  label,
  children,
}: {
  entity: Entity
  label: string
  children: (editor: Editor) => ReactNode
}) {
  const ed = useEditor(entity),
    { close } = useWorkspace()
  return (
    <aside
      className="world-detail"
      aria-label={label}
      ref={ed.panel}
      tabIndex={-1}
    >
      <header className="split">
        <h2>{label}</h2>
        <ImpactButton id={ed.e.id} />
        <SaveStatus editor={ed} />
        <TrashEntry editor={ed} />
        <IconButton label="关闭详情" onClick={close}>
          <X size={16} />
        </IconButton>
      </header>
      {children(ed)}
      <EntityLinkPanel entity={ed.e} />
    </aside>
  )
}
export function Pairs({
  editor,
  name,
  label,
  score = false,
  keyName = 'label',
  defaults,
}: {
  editor: Editor
  name: string
  label: string
  score?: boolean
  keyName?: string
  defaults?: { id: string; label: string; value: Json }[]
}) {
  const rows = Array.isArray(editor.e.data?.[name])
    ? rowsOf(editor.e, name)
    : (defaults ?? [])
  function change(id: string, key: string, v: Json) {
    editor.data(
      name,
      rows.map((r) => (r.id === id ? { ...r, [key]: v } : r)),
    )
  }
  return (
    <section className="stack">
      <div className="split">
        <h3>{label}</h3>
        <button
          className="text-action"
          onClick={() =>
            editor.data(name, [
              ...rows,
              {
                id: crypto.randomUUID(),
                [keyName]: '',
                value: score ? 50 : '',
              },
            ])
          }
        >
          ＋ 添加
        </button>
      </div>
      {rows.map((r) => (
        <div className="world-pair" key={r.id}>
          <input
            aria-label={label + '名称'}
            placeholder="名称"
            value={scalar((r as Record<string, Json>)[keyName])}
            onChange={(ev) => change(r.id, keyName, ev.target.value)}
          />
          {score ? (
            <>
              <input
                aria-label={label + '评分'}
                type="range"
                min={0}
                max={100}
                value={numeric(r.value) ?? 0}
                onChange={(ev) =>
                  change(r.id, 'value', Number(ev.target.value))
                }
              />
              <output>{scalar(r.value, '0')}</output>
            </>
          ) : (
            <input
              aria-label={label + '值'}
              placeholder="值"
              value={scalar(r.value)}
              onChange={(ev) => change(r.id, 'value', ev.target.value)}
            />
          )}
          <IconButton
            label={'删除' + label + '行'}
            onClick={() =>
              editor.data(
                name,
                rows.filter((x) => x.id !== r.id),
              )
            }
          >
            <Trash2 size={14} />
          </IconButton>
        </div>
      ))}
    </section>
  )
}
export function Tree({
  rows,
  selected,
  query = '',
  render,
  tools,
}: {
  rows: Entity[]
  selected?: string
  query?: string
  render: (e: Entity) => ReactNode
  tools?: (e: Entity) => ReactNode
}) {
  const [folded, setFolded] = useState(new Set<string>())
  const groups = forest(rows)
  const visible = new Set<string>()
  if (query.trim())
    for (const e of rows.filter((e) =>
      (e.title + ' ' + e.body)
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
    )) {
      visible.add(e.id)
      ancestors(e, rows).forEach((p) => visible.add(p.id))
    }
  useEffect(() => {
    const e = rows.find((r) => r.id === selected)
    if (e)
      setFolded((prev) => {
        const next = new Set(prev)
        ancestors(e, rows).forEach((p) => next.delete(p.id))
        return next
      })
  }, [selected])
  function branch(parent: string, depth: number): ReactNode {
    return (groups.get(parent) ?? [])
      .filter((e) => !query.trim() || visible.has(e.id))
      .map((e) => {
        const hasChildren = !!groups.get(e.id)?.length,
          expanded = !!query.trim() || !folded.has(e.id)
        return (
          <div key={e.id}>
            <div
              className={
                'world-tree-row ' + (selected === e.id ? 'active' : '')
              }
              style={{ paddingLeft: Math.min(depth, 16) * 14 }}
            >
              {hasChildren ? (
                <button
                  aria-label={(expanded ? '折叠' : '展开') + e.title}
                  aria-expanded={expanded}
                  onClick={() =>
                    setFolded((prev) => {
                      const next = new Set(prev)
                      if (expanded) next.add(e.id)
                      else next.delete(e.id)
                      return next
                    })
                  }
                >
                  {expanded ? (
                    <ChevronDown size={14} />
                  ) : (
                    <ChevronRight size={14} />
                  )}
                </button>
              ) : (
                <span className="tree-indent" />
              )}
              {render(e)}
              {tools && <span className="tree-tools">{tools(e)}</span>}
            </div>
            {hasChildren && expanded && branch(e.id, depth + 1)}
          </div>
        )
      })
  }
  return (
    <div className="world-tree">
      {branch('', 0)}
      {(!rows.length || (query.trim() && !visible.size)) && (
        <small>暂无匹配条目</small>
      )}
    </div>
  )
}
