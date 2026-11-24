import { MentionEditor } from '../../components/MentionEditor'
import { useEffect, useRef, useState } from 'react'
import { Plus, Trash2, Upload } from 'lucide-react'
import { api } from '../../api/client'
import { newEntity } from '../../state/catalog'
import { dayKey, field, withData } from '../../state/planning'
import { useWorkspace } from '../../state/workspace'
import { Field } from '../../components/PlanningUI'
import { Markdown } from '../../components/Markdown'
import { EntityLinkPanel } from '../../components/EntityLinkPanel'
import type { Entity } from '../../types'

export function DevlogEditor({
  entity,
  onDelete,
}: {
  entity: Entity
  onDelete: () => void
}) {
  const { notify, trash } = useWorkspace()
  const [row, set] = useState(entity),
    [mode, setMode] = useState('分屏'),
    [status, setStatus] = useState('已自动保存')
  const latest = useRef(row),
    dirty = useRef(false),
    timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const queue = useRef(Promise.resolve()),
    live = useRef(true),
    generation = useRef(0),
    deleting = useRef(false)
  useEffect(() => {
    if (
      !dirty.current &&
      status === '已自动保存' &&
      entity.updatedAt > latest.current.updatedAt
    ) {
      latest.current = entity
      set(entity)
    }
  }, [entity, status])
  function flush() {
    clearTimeout(timer.current)
    if (!dirty.current) return queue.current
    const draft = latest.current,
      version = generation.current
    dirty.current = false
    queue.current = queue.current.then(async () => {
      try {
        await api.saveEntity({
          ...draft,
          title: draft.title.trim() || '未命名开发日志',
        })
        if (live.current && version === generation.current)
          setStatus('已自动保存')
      } catch (e) {
        if (version === generation.current) dirty.current = true
        if (live.current) setStatus('保存失败 · 重试')
        notify(String(e))
      }
    })
    return queue.current
  }
  useEffect(() => {
    live.current = true
    return () => {
      live.current = false
      void flush()
    }
  }, [])
  function update(next: Entity) {
    if (deleting.current) return
    latest.current = { ...next, updatedAt: new Date().toISOString() }
    dirty.current = true
    generation.current++
    set(latest.current)
    setStatus('保存中…')
    clearTimeout(timer.current)
    timer.current = setTimeout(flush, 600)
  }
  async function remove() {
    deleting.current = true
    try {
      await flush()
      await trash(row.id)
      onDelete()
    } catch (e) {
      notify(String(e))
    } finally {
      deleting.current = false
    }
  }
  return (
    <section className="dev-editor panel stack">
      <div className="split">
        <button className="save-state" onClick={() => void flush()}>
          {status}
        </button>
        <button className="danger-text" onClick={() => void remove()}>
          <Trash2 size={14} />
          删除
        </button>
      </div>
      <Field label="标题">
        <input
          className="editor-title"
          value={row.title}
          onChange={(e) => update({ ...row, title: e.target.value })}
        />
      </Field>
      <div className="fields-two">
        <Field label="日期">
          <input
            type="date"
            value={field(row, 'date', dayKey(new Date(row.createdAt)))}
            onChange={(e) => update(withData(row, 'date', e.target.value))}
          />
        </Field>
        <Field label="试玩链接">
          <input
            type="url"
            placeholder="https://"
            value={field(row, 'playtestUrl')}
            onChange={(e) =>
              update(withData(row, 'playtestUrl', e.target.value))
            }
          />
        </Field>
      </div>
      <div className="inline">
        <label className="file-button">
          <Upload size={14} />
          上传封面
          <input
            type="file"
            accept="image/*"
            onChange={async (e) => {
              const f = e.target.files?.[0]
              if (f)
                try {
                  const asset = await api.saveAsset(f)
                  if (live.current)
                    update(
                      withData(latest.current, 'coverAsset', asset.filename),
                    )
                } catch (err) {
                  notify(String(err))
                }
            }}
          />
        </label>
        {field(row, 'coverAsset') && (
          <button onClick={() => update(withData(row, 'coverAsset', ''))}>
            移除封面
          </button>
        )}
      </div>
      {field(row, 'coverAsset') && (
        <img
          className="dev-cover"
          src={api.assetUrl(field(row, 'coverAsset'))}
          alt="开发日志封面"
        />
      )}
      <div className="segments">
        {['编辑', '分屏', '预览'].map((m) => (
          <button
            className={mode === m ? 'active' : ''}
            key={m}
            onClick={() => setMode(m)}
          >
            {m}
          </button>
        ))}
      </div>
      <div className={'editor-panes ' + (mode === '分屏' ? 'split-mode' : '')}>
        {mode !== '预览' && (
          <MentionEditor
            aria-label="Markdown 正文"
            placeholder="记录本次迭代…"
            value={row.body}
            onValue={(body) => update({ ...row, body })}
          />
        )}{' '}
        {mode !== '编辑' && <Markdown body={row.body} />}
      </div>
      <EntityLinkPanel entity={row} />
    </section>
  )
}
export default function DevlogView({
  selected,
  select,
}: {
  selected?: string
  select: (id: string) => void
}) {
  const { entities, project, save, run } = useWorkspace(),
    [q, search] = useState('')
  const logs = entities
    .filter((e) => e.entityType === 'devlog')
    .sort(
      (a, b) =>
        field(b, 'date', b.createdAt).localeCompare(
          field(a, 'date', a.createdAt),
        ) || b.createdAt.localeCompare(a.createdAt),
    )
  const filtered = logs.filter((e) =>
    (e.title + e.body).toLowerCase().includes(q.toLowerCase()),
  )
  const [lastId, remember] = useState(logs[0]?.id)
  const row =
    logs.find((e) => e.id === selected) ??
    filtered.find((e) => e.id === lastId) ??
    filtered[0]
  useEffect(() => {
    if (row) remember(row.id)
  }, [row?.id])
  return (
    <>
      <div className="module-title">
        <h1>开发日志</h1>
        <button
          className="primary"
          onClick={() =>
            void run(async () => {
              const e = newEntity(project.id, 'devlog', '新开发日志')
              e.data = { date: dayKey() }
              await save(e)
              select(e.id)
            })
          }
        >
          <Plus size={15} />
          新建开发日志
        </button>
      </div>
      <div className="dev-layout">
        <aside className="panel stack">
          <input
            placeholder="搜索开发日志…"
            value={q}
            onChange={(e) => search(e.target.value)}
          />
          {filtered.map((e) => (
            <button
              className={'dev-item ' + (e.id === row?.id ? 'active' : '')}
              key={e.id}
              onClick={() => select(e.id)}
            >
              <small>{field(e, 'date', e.createdAt.slice(0, 10))}</small>
              <b>{e.title}</b>
            </button>
          ))}
        </aside>
        {row ? (
          <DevlogEditor key={row.id} entity={row} onDelete={() => select('')} />
        ) : (
          <div className="panel empty">暂无开发日志</div>
        )}
      </div>
    </>
  )
}
