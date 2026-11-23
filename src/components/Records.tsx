import { useEffect, useState } from 'react'
import { RotateCcw } from 'lucide-react'
import { api } from '../api/client'
import { moduleFor, stampDate } from '../state/catalog'
import { Empty, Modal } from './ui'
import type { Entity } from '../types'

export function RecycleBin({
  projectId,
  revision,
  onClose,
}: {
  projectId: string | null
  revision: number
  onClose: () => void
}) {
  const [rows, set] = useState<Entity[]>([]),
    [error, fail] = useState('')
  useEffect(() => {
    let live = true
    api
      .recycleBin(projectId)
      .then((r) => {
        if (live) set(r)
      })
      .catch((e) => fail(String(e)))
    return () => {
      live = false
    }
  }, [projectId, revision])
  return (
    <Modal title="回收站" onClose={onClose}>
      <div className="form-body">
        <p className="muted">删除的条目保留 14 天。</p>
        {rows.map((r) => (
          <div className="setting-row" key={r.id}>
            <div>
              <strong>{r.title}</strong>
              <small>
                {moduleFor(r.entityType)?.label} · {stampDate(r.deletedAt!)}
              </small>
            </div>
            <button
              className="secondary"
              onClick={async () => {
                try {
                  await api.restoreEntity(r.id)
                  set(rows.filter((x) => x.id !== r.id))
                } catch (e) {
                  fail(String(e))
                }
              }}
            >
              <RotateCcw size={14} />
              恢复
            </button>
          </div>
        ))}
        {!rows.length && <Empty>回收站是空的</Empty>}
        {error && <p role="alert">{error}</p>}
      </div>
    </Modal>
  )
}
