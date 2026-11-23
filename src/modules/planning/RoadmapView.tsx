import { useRef, useState } from 'react'
import { Flag, Plus } from 'lucide-react'
import { api } from '../../api/client'
import { newEntity, countdown } from '../../state/catalog'
import { asDay, dayKey, field, shift } from '../../state/planning'
import { useWorkspace } from '../../state/workspace'
import { Checklist, Meter } from '../../components/PlanningUI'
import type { Entity } from '../../types'

const dayNumber = (s: string) => Date.parse(s + 'T00:00:00Z') / 86400000
function Timeline({ phases, miles }: { phases: Entity[]; miles: Entity[] }) {
  const { save, inspect, run } = useWorkspace(),
    today = dayKey()
  const dates = [
    today,
    ...phases.flatMap((p) => [field(p, 'startDate'), field(p, 'endDate')]),
    ...miles.map((m) => field(m, 'dueDate')),
  ]
    .filter((s) => /^\d{4}-\d\d-\d\d$/.test(s))
    .sort()
  const first = asDay(dates[0])
  first.setDate(1)
  const last = asDay(dates[dates.length - 1])
  last.setMonth(last.getMonth() + 1, 1)
  if (
    last.getTime() <=
    new Date(first.getFullYear(), first.getMonth() + 1, 1).getTime()
  )
    last.setMonth(last.getMonth() + 1)
  const days = dayNumber(dayKey(last)) - dayNumber(dayKey(first)),
    unit = 16
  const pos = (s: string) =>
    Math.max(
      0,
      (dayNumber(s || dayKey(first)) - dayNumber(dayKey(first))) * unit,
    )
  const months: Date[] = []
  for (
    let d = new Date(first);
    d < last;
    d = new Date(d.getFullYear(), d.getMonth() + 1, 1)
  )
    months.push(d)
  const drag = useRef<{ id: string; x: number; date: string } | null>(null)
  const [preview, setPreview] = useState<{ id: string; date: string } | null>(
    null,
  )
  return (
    <div className="timeline-scroll panel">
      <div
        className="timeline"
        style={{
          width: days * unit,
          height: 62 + phases.length * 34 + miles.length * 29,
        }}
      >
        {months.map((d) => (
          <div
            className="month-divider"
            key={dayKey(d)}
            style={{ left: pos(dayKey(d)) }}
          >
            <b>
              {d.getFullYear()} 年 {d.getMonth() + 1} 月
            </b>
          </div>
        ))}
        <div className="today-line" style={{ left: pos(today) }}>
          <span>今天</span>
        </div>
        {phases.map((p, i) => (
          <button
            key={p.id}
            className={'phase-bar tone-' + (i % 4)}
            style={{
              top: 46 + i * 34,
              left: pos(field(p, 'startDate')),
              width: Math.max(
                unit,
                pos(field(p, 'endDate')) - pos(field(p, 'startDate')) + unit,
              ),
            }}
            onClick={() => inspect(p.id)}
          >
            {p.title}
          </button>
        ))}
        {miles.map((m, i) => {
          const date =
            preview?.id === m.id ? preview.date : field(m, 'dueDate', today)
          return (
            <button
              key={m.id}
              title={m.title + ' · ' + date}
              className="mile-flag"
              style={{ top: 50 + phases.length * 34 + i * 29, left: pos(date) }}
              onPointerDown={(e) => {
                if (e.button !== 0) return
                e.currentTarget.setPointerCapture(e.pointerId)
                drag.current = { id: m.id, x: e.clientX, date }
              }}
              onPointerMove={(e) => {
                const d = drag.current
                if (d?.id === m.id)
                  setPreview({
                    id: m.id,
                    date: dayKey(
                      shift(
                        asDay(d.date),
                        Math.round((e.clientX - d.x) / unit),
                      ),
                    ),
                  })
              }}
              onPointerCancel={() => {
                drag.current = null
                setPreview(null)
              }}
              onPointerUp={(e) => {
                const d = drag.current
                if (d?.id !== m.id) return
                drag.current = null
                setPreview(null)
                const offset = Math.round((e.clientX - d.x) / unit)
                if (!offset) inspect(m.id)
                else
                  void run(() =>
                    save({
                      ...m,
                      data: {
                        ...m.data,
                        dueDate: dayKey(shift(asDay(d.date), offset)),
                      },
                    }),
                  )
              }}
              onClick={(e) => {
                if (e.detail === 0) inspect(m.id)
              }}
            >
              <Flag size={14} />
              {m.title}
              {preview?.id === m.id ? ' · ' + date : ''}
            </button>
          )
        })}
      </div>
    </div>
  )
}
export default function RoadmapView() {
  const { project, entities, save, inspect, run } = useWorkspace()
  const phases = entities
    .filter((e) => e.entityType === 'phase')
    .sort((a, b) => field(a, 'startDate').localeCompare(field(b, 'startDate')))
  const miles = entities
    .filter((e) => e.entityType === 'milestone')
    .sort((a, b) => field(a, 'dueDate').localeCompare(field(b, 'dueDate')))
  function create(kind: string) {
    const p = newEntity(
      project.id,
      kind,
      kind === 'phase' ? '新阶段' : '新里程碑',
    )
    p.status = '待开始'
    p.data =
      kind === 'phase'
        ? {
            startDate: dayKey(),
            endDate: dayKey(shift(new Date(), 14)),
            deliverables: [],
          }
        : {
            dueDate: dayKey(shift(new Date(), 7)),
            phaseId: project.currentPhaseId,
          }
    void run(async () => {
      await save(p)
      inspect(p.id)
    })
  }
  return (
    <div className="stack roomy">
      <div className="module-title">
        <h1>路线图</h1>
      </div>
      <Timeline phases={phases} miles={miles} />
      <header className="split">
        <h2>开发阶段</h2>
        <button className="secondary" onClick={() => create('phase')}>
          <Plus size={15} />
          添加阶段
        </button>
      </header>
      <div className="phase-grid">
        {phases.map((p) => (
          <article className="panel stack" key={p.id}>
            <div className="split">
              <button className="card-title" onClick={() => inspect(p.id)}>
                {p.title}
              </button>
              <span className="badge">{p.status}</span>
            </div>
            <small>
              {field(p, 'startDate')} — {field(p, 'endDate')}
            </small>
            <button className="left" onClick={() => inspect(p.id)}>
              {p.summary || '填写阶段目标问题'}
            </button>
            <Checklist
              entity={p}
              name="deliverables"
              change={(e) => void run(() => save(e))}
            />
            <button
              className="secondary"
              disabled={project.currentPhaseId === p.id}
              onClick={() =>
                void run(() =>
                  api.saveProject({ ...project, currentPhaseId: p.id }),
                )
              }
            >
              {project.currentPhaseId === p.id ? '当前阶段' : '设为当前阶段'}
            </button>
          </article>
        ))}
      </div>
      <header className="split">
        <h2>里程碑</h2>
        <button className="secondary" onClick={() => create('milestone')}>
          <Plus size={15} />
          添加里程碑
        </button>
      </header>
      <div className="phase-grid">
        {miles.map((m) => {
          const linked = entities.filter(
              (t) =>
                t.entityType === 'task' && field(t, 'milestoneId') === m.id,
            ),
            done = linked.filter((t) => t.status === '已完成').length
          return (
            <article className="panel stack" key={m.id}>
              <div className="split">
                <Flag size={16} />
                <span className="badge">
                  {field(m, 'dueDate')
                    ? countdown(field(m, 'dueDate'))
                    : '待排期'}
                </span>
              </div>
              <button className="card-title" onClick={() => inspect(m.id)}>
                {m.title}
              </button>
              <small>
                {field(m, 'dueDate')} ·{' '}
                {phases.find((p) => p.id === field(m, 'phaseId'))?.title ||
                  '未关联阶段'}
              </small>
              <Meter done={done} total={linked.length} />
              <small>
                {done} / {linked.length} 已完成
              </small>
            </article>
          )
        })}
      </div>
    </div>
  )
}
