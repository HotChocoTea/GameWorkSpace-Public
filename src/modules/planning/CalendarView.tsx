import { useState } from 'react'
import { ChevronLeft, ChevronRight, Plus, Trash2 } from 'lucide-react'
import { newEntity } from '../../state/catalog'
import { asDay, dayKey, field, monday, shift } from '../../state/planning'
import { useWorkspace } from '../../state/workspace'
import { api } from '../../api/client'
import { Field } from '../../components/PlanningUI'
import { Modal } from '../../components/ui'
import type { Entity } from '../../types'
export default function CalendarView() {
  const { project, entities, inspect, save, run } = useWorkspace(),
    today = dayKey()
  const [selected, select] = useState(today),
    [month, setMonth] = useState(asDay(today.slice(0, 7) + '-01'))
  const [draft, setDraft] = useState<{ date: string; title: string } | null>(
    null,
  )
  const items = new Map<string, Entity[]>()
  entities
    .filter((e) =>
      ['calendar_event', 'task', 'milestone'].includes(e.entityType),
    )
    .forEach((e) => {
      const date = field(
        e,
        e.entityType === 'calendar_event' ? 'date' : 'dueDate',
      )
      if (date) items.set(date, [...(items.get(date) || []), e])
    })
  const start = monday(month),
    next = new Date(month.getFullYear(), month.getMonth() + 1, 1)
  const days = Math.ceil(Math.round((+next - +start) / 86400000) / 7) * 7
  const tone = (e: Entity) =>
    e.entityType === 'task' && e.status !== '已完成'
      ? field(e, 'dueDate') < today
        ? 'overdue'
        : field(e, 'dueDate') === today
          ? 'due'
          : e.entityType
      : e.entityType
  const agenda = (items.get(selected) ?? []).sort((a, b) =>
    field(a, 'startTime').localeCompare(field(b, 'startTime')),
  )
  return (
    <>
      <div className="module-title">
        <h1>日历</h1>
        <div className="actions">
          <button
            className="secondary"
            aria-label="上个月"
            onClick={() =>
              setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))
            }
          >
            <ChevronLeft size={16} />
          </button>
          <button
            className="secondary"
            onClick={() => {
              select(today)
              setMonth(asDay(today.slice(0, 7) + '-01'))
            }}
          >
            今天
          </button>
          <button
            className="secondary"
            aria-label="下个月"
            onClick={() => setMonth(next)}
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
      <div className="calendar-layout">
        <section className="panel calendar">
          <header className="split">
            <h2>
              {month.getFullYear()} 年 {month.getMonth() + 1} 月
            </h2>
            <small>任务 · 里程碑 · 日程</small>
          </header>
          <div className="month-grid">
            {['一', '二', '三', '四', '五', '六', '日'].map((d) => (
              <b key={d}>周{d}</b>
            ))}
            {Array.from({ length: days }, (_, i) => {
              const d = shift(start, i),
                key = dayKey(d),
                rows = items.get(key) ?? []
              return (
                <button
                  key={key}
                  aria-label={key}
                  className={
                    'day-cell ' +
                    (selected === key ? 'chosen ' : '') +
                    (d.getMonth() !== month.getMonth() ? 'outside ' : '') +
                    (key === today ? 'today' : '')
                  }
                  onClick={() => select(key)}
                  onDoubleClick={() => {
                    select(key)
                    setDraft({ date: key, title: '' })
                  }}
                >
                  <strong>{d.getDate()}</strong>
                  {rows.slice(0, 3).map((e) => (
                    <span className={'cal-item ' + tone(e)} key={e.id}>
                      {e.title}
                    </span>
                  ))}
                  {rows.length > 3 && <small>＋{rows.length - 3}</small>}
                </button>
              )
            })}
          </div>
        </section>
        <aside className="panel stack agenda">
          <small>{selected}</small>
          <h2>当日日程</h2>
          {agenda.map((e) => (
            <div className="agenda-item" key={e.id}>
              <button
                className={'cal-item ' + tone(e)}
                onClick={() => inspect(e.id)}
              >
                {e.title}
                <small>
                  {field(e, 'startTime') ||
                    {
                      task: '任务截止',
                      milestone: '里程碑',
                      calendar_event: '全天',
                    }[e.entityType]}
                </small>
              </button>
              {e.entityType === 'calendar_event' && (
                <button
                  aria-label={'删除 ' + e.title}
                  onClick={() => void run(() => api.deleteEntity(e.id))}
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          ))}
          {!agenda.length && <small>这一天没有安排</small>}
          <button
            className="secondary"
            onClick={() => setDraft({ date: selected, title: '' })}
          >
            <Plus size={15} />
            添加日程
          </button>
        </aside>
      </div>
      {draft && (
        <Modal title="新建日程" onClose={() => setDraft(null)}>
          <form
            className="form-body"
            onSubmit={(e) => {
              e.preventDefault()
              void run(async () => {
                const item = newEntity(
                  project.id,
                  'calendar_event',
                  draft.title.trim(),
                )
                item.data = { date: draft.date }
                await save(item)
                select(draft.date)
                setMonth(asDay(draft.date.slice(0, 7) + '-01'))
                setDraft(null)
              })
            }}
          >
            <Field label="标题">
              <input
                autoFocus
                required
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              />
            </Field>
            <Field label="日期">
              <input
                required
                type="date"
                value={draft.date}
                onChange={(e) => setDraft({ ...draft, date: e.target.value })}
              />
            </Field>
            <button className="primary" disabled={!draft.title.trim()}>
              保存日程
            </button>
          </form>
        </Modal>
      )}
    </>
  )
}
