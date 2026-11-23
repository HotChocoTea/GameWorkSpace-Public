import { useEffect, useState } from 'react'
import { Link2, Plus, Unlink2 } from 'lucide-react'
import { api } from '../api/client'
import { moduleFor } from '../state/catalog'
import { link } from '../state/planning'
import { useWorkspace } from '../state/workspace'
import type { Entity, EntityLink } from '../types'

export function EntityLinkPanel({ entity }: { entity: Entity }) {
  const { entities, revision, openEntity, run, notify } = useWorkspace()
  const [out, setOut] = useState<EntityLink[]>([]),
    [incoming, setIn] = useState<EntityLink[]>([])
  const [picker, setPicker] = useState(false),
    [query, search] = useState(''),
    [relation, setRelation] = useState('关联'),
    [version, reload] = useState(0)
  useEffect(() => {
    let live = true
    Promise.all([
      api.listLinks(entity.projectId),
      api.backlinks(entity.projectId, entity.id),
    ])
      .then(([all, back]) => {
        if (live) {
          setOut(all.filter((l) => l.sourceId === entity.id))
          setIn(back)
        }
      })
      .catch((e) => {
        if (live) notify(String(e))
      })
    return () => {
      live = false
    }
  }, [entity.id, entity.projectId, revision, version, notify])
  function rows(links: EntityLink[], back: boolean) {
    const items = links.flatMap((l) => {
      const other = entities.find(
        (e) => e.id === (back ? l.sourceId : l.targetId),
      )
      return other
        ? [
            <div className="link-row" key={l.id}>
              <span className="badge">
                {moduleFor(other.entityType)?.label}
              </span>
              <button onClick={() => openEntity(other)}>{other.title}</button>
              <small>{l.relationLabel}</small>
              {!back && (
                <button
                  title="移除关联"
                  onClick={() =>
                    void run(async () => {
                      await api.deleteLink(l.id)
                      reload((n) => n + 1)
                    })
                  }
                >
                  <Unlink2 size={14} />
                </button>
              )}
            </div>,
          ]
        : []
    })
    return items.length ? items : <small>暂无关联</small>
  }
  return (
    <section className="links stack">
      <header className="split">
        <h3>
          <Link2 size={15} /> 关联
        </h3>
        <button className="text-action" onClick={() => setPicker(!picker)}>
          <Plus size={14} />
          添加关联
        </button>
      </header>
      {rows(out, false)}
      {picker && (
        <div className="picker stack">
          <input
            autoFocus
            placeholder="搜索项目条目"
            value={query}
            onChange={(e) => search(e.target.value)}
          />
          <label>
            关系名称
            <input
              list="link-relations"
              value={relation}
              onChange={(e) => setRelation(e.target.value)}
            />
          </label>
          <datalist id="link-relations">
            {['关联', '前置', '阻塞', '提及'].map((r) => (
              <option key={r}>{r}</option>
            ))}
          </datalist>
          <div className="picker-list">
            {entities
              .filter(
                (e) =>
                  e.id !== entity.id &&
                  (e.title + e.summary + e.tags.join(' '))
                    .toLowerCase()
                    .includes(query.trim().toLowerCase()),
              )
              .map((e) => (
                <button
                  key={e.id}
                  disabled={out.some(
                    (l) =>
                      l.targetId === e.id &&
                      l.relationLabel === (relation.trim() || '关联'),
                  )}
                  onClick={() =>
                    void run(async () => {
                      await api.saveLink(
                        link(
                          entity.projectId,
                          entity.id,
                          e.id,
                          relation.trim() || '关联',
                        ),
                      )
                      reload((n) => n + 1)
                      setPicker(false)
                    })
                  }
                >
                  <small>{moduleFor(e.entityType)?.label}</small>
                  {e.title}
                </button>
              ))}
          </div>
        </div>
      )}
      <h3>被这些内容引用</h3>
      {rows(incoming, true)}
    </section>
  )
}
