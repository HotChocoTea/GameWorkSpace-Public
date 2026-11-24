import { useEffect, useRef, useState } from 'react'
import { Radar } from 'lucide-react'
import { analyze, categories, type ImpactReport } from '../api/impact'
import { useWorkspace } from '../state/workspace'
import { Modal } from './ui'

type Review = {
  report: ImpactReport
  entityId: string
  deleting: boolean
  resolve: (yes: boolean) => void
}
export function useImpactReview(projectId: string) {
  const [review, set] = useState<Review>(),
    current = useRef<Review | undefined>(undefined)
  const generation = useRef(0)
  useEffect(
    () => () => {
      generation.current++
      current.current?.resolve(false)
      current.current = undefined
    },
    [projectId],
  )
  async function inspect(entityId: string, deleting = false) {
    const ticket = generation.current,
      report = await analyze(projectId, entityId)
    if (ticket !== generation.current) return false
    if (deleting && !report.totalReferences) return true
    current.current?.resolve(false)
    return new Promise<boolean>((resolve) => {
      current.current = { entityId, deleting, report, resolve }
      set(current.current)
    })
  }
  function finish(yes: boolean) {
    current.current?.resolve(yes)
    current.current = undefined
    set(undefined)
  }
  return { inspect, review, finish }
}
export function ImpactButton({ id }: { id: string }) {
  const w = useWorkspace()
  return (
    <button
      type="button"
      className="text-action"
      onClick={() => void w.run(() => w.impact(id))}
    >
      <Radar size={15} />
      影响检查
    </button>
  )
}
export function ImpactModal({
  review,
  finish,
}: {
  review: Review
  finish: (yes: boolean) => void
}) {
  const w = useWorkspace(),
    title = w.entities.find((e) => e.id === review.entityId)?.title ?? ''
  return (
    <Modal
      title={review.deleting ? '删除前的影响检查' : '影响检查'}
      onClose={() => finish(false)}
    >
      <div className="form-body stack">
        <p>
          「{title}」共有 {review.report.totalReferences} 处关联或引用。
          {review.deleting && '移入回收站后，这些引用可能失效。'}
        </p>
        <div className="impact-list">
          {(Object.keys(categories) as (keyof typeof categories)[]).map(
            (k) =>
              review.report[k].length > 0 && (
                <section key={k}>
                  <h3>
                    {categories[k]} · {review.report[k].length}
                  </h3>
                  {review.report[k].map((r, i) => (
                    <button
                      className="setting-row"
                      key={r.id + i}
                      onClick={() => {
                        finish(false)
                        if (r.entityType === 'map') w.navigate('mapmaker', r.id)
                        else {
                          const e = w.entities.find((e) => e.id === r.id)
                          if (e) w.openEntity(e)
                        }
                      }}
                    >
                      <strong>{r.title}</strong>
                      <small>{r.detail} ↗</small>
                    </button>
                  ))}
                </section>
              ),
          )}
        </div>
        <div className="actions">
          <button className="secondary" onClick={() => finish(false)}>
            {review.deleting ? '取消' : '关闭'}
          </button>
          {review.deleting && (
            <button className="danger-text" onClick={() => finish(true)}>
              仍然移入回收站
            </button>
          )}
        </div>
      </div>
    </Modal>
  )
}
