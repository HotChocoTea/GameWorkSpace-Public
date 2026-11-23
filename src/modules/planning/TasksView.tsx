import { useState } from 'react'
import { Plus, X, ListChecks, Clock3, CalendarDays } from 'lucide-react'
import { api } from '../../api/client'
import { newEntity } from '../../state/catalog'
import {
  columns,
  standardColumns,
  priorities,
  taskPriority,
  field,
  dayKey,
  checklist,
  changeStatus,
} from '../../state/planning'
import { useWorkspace } from '../../state/workspace'
import { Options, TimerButton } from '../../components/PlanningUI'
import type { Entity } from '../../types'

export default function TasksView() {
  const { project, entities, inspect, run, save, assistant, selected } =
    useWorkspace()
  const tasks = entities.filter((e) => e.entityType === 'task'),
    cols = columns(project, tasks)
  const [q, search] = useState(''),
    [tag, setTag] = useState(''),
    [priority, setPriority] = useState(''),
    [newCol, setNewCol] = useState(''),
    [adding, setAdding] = useState(false)
  const tags = [
    ...new Set([
      '程序',
      '关卡',
      '美术',
      '音频',
      '设计',
      'UI',
      ...tasks.flatMap((t) => t.tags),
    ]),
  ]
  const saveColumns = (next: typeof cols) =>
    run(() => api.saveProject({ ...project, taskColumns: next }))
  function move(e: Entity, status: string) {
    if (e.status === status) return
    const order =
      Math.max(
        0,
        ...tasks.filter((t) => t.status === status).map((t) => t.sortOrder),
      ) + 1
    void run(() => save({ ...changeStatus(e, status), sortOrder: order }))
  }
  function create(status: string) {
    const e = {
      ...newEntity(project.id, 'task', '新任务'),
      status,
      data: { priority: '中' },
    }
    void run(async () => {
      await save(e)
      inspect(e.id)
    })
  }
  return (
    <>
      <div className="module-title">
        <h1>任务看板</h1>
        <button
          className="secondary"
          onClick={() => assistant('拆解开发任务并填写验收条件。', selected)}
        >
          AI 填写
        </button>
        <button
          className="primary"
          onClick={() => create(cols[0]?.id ?? '待办')}
        >
          <Plus size={16} />
          新建任务
        </button>
      </div>
      <div className="filters">
        <input
          aria-label="搜索任务"
          placeholder="搜索任务…"
          value={q}
          onChange={(e) => search(e.target.value)}
        />
        <select
          aria-label="筛选优先级"
          value={priority}
          onChange={(e) => setPriority(e.target.value)}
        >
          <option value="">全部优先级</option>
          <Options values={priorities} />
        </select>
        {['', ...tags].map((t) => (
          <button
            key={t}
            className={t === tag ? 'chip active' : 'chip'}
            onClick={() => setTag(t)}
          >
            {t || '全部标签'}
          </button>
        ))}
      </div>
      <div className="kanban">
        {cols.map((col, i) => {
          const all = tasks.filter((t) => t.status === col.id),
            rows = all
              .filter(
                (t) =>
                  (!tag || t.tags.includes(tag)) &&
                  (!priority || taskPriority(t) === priority) &&
                  (t.title + t.body + t.tags.join(' '))
                    .toLowerCase()
                    .includes(q.toLowerCase()),
              )
              .sort((a, b) => a.sortOrder - b.sortOrder)
          return (
            <section
              className="lane"
              key={col.id}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(ev) => {
                ev.preventDefault()
                const e = tasks.find(
                  (t) => t.id === ev.dataTransfer.getData('text/plain'),
                )
                if (e) move(e, col.id)
              }}
            >
              <header className="lane-head">
                <i
                  style={{
                    background: ['#8799ac', '#497ce5', '#e4a448', '#19a879'][
                      i % 4
                    ],
                  }}
                />
                <input
                  key={col.label}
                  aria-label="列名称"
                  defaultValue={col.label}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') e.currentTarget.blur()
                  }}
                  onBlur={(e) => {
                    const value = e.target.value.trim()
                    if (value && value !== col.label)
                      void saveColumns(
                        cols.map((c) =>
                          c.id === col.id ? { ...c, label: value } : c,
                        ),
                      )
                    else e.target.value = col.label
                  }}
                />
                <span className="count">{all.length}</span>
                {!all.length && cols.length > 1 && (
                  <button
                    title="删除空列"
                    onClick={() =>
                      void saveColumns(cols.filter((c) => c.id !== col.id))
                    }
                  >
                    <X size={14} />
                  </button>
                )}
              </header>
              {rows.map((t) => {
                const sub = checklist(t, 'subtasks'),
                  due = field(t, 'dueDate'),
                  rank = taskPriority(t)
                return (
                  <article
                    key={t.id}
                    className="task-card"
                    draggable
                    onDragStart={(e) =>
                      e.dataTransfer.setData('text/plain', t.id)
                    }
                  >
                    <div className="split">
                      <span
                        className={
                          'priority priority-' + priorities.indexOf(rank)
                        }
                      >
                        <i />
                        {rank}优先级
                      </span>
                      <TimerButton task={t} small />
                    </div>
                    <button
                      className="card-title"
                      onClick={() => inspect(t.id)}
                    >
                      {t.title}
                    </button>
                    <div className="chips">
                      {t.tags.map((t) => (
                        <span key={t}>{t}</span>
                      ))}
                    </div>
                    <div className="card-bits">
                      {due && (
                        <span
                          className={
                            due < dayKey() && t.status !== '已完成'
                              ? 'danger-text'
                              : ''
                          }
                        >
                          <CalendarDays size={12} />
                          {due.slice(5)}
                        </span>
                      )}
                      {!!sub.length && (
                        <span>
                          <ListChecks size={12} />
                          {sub.filter((s) => s.done).length}/{sub.length}
                        </span>
                      )}
                      {field(t, 'estimateHours') && (
                        <span>
                          <Clock3 size={12} />
                          {field(t, 'estimateHours')}h
                        </span>
                      )}
                    </div>
                    <select
                      className="move-select"
                      aria-label={'移动 ' + t.title}
                      value={t.status}
                      onChange={(e) => move(t, e.target.value)}
                    >
                      {cols.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                  </article>
                )
              })}
              <button className="add-card" onClick={() => create(col.id)}>
                ＋ 添加任务
              </button>
            </section>
          )
        })}
        <section className="new-lane">
          {adding ? (
            <form
              onSubmit={(e) => {
                e.preventDefault()
                if (newCol.trim())
                  void run(async () => {
                    const label = newCol.trim()
                    const id =
                      standardColumns.includes(label) &&
                      !cols.some((c) => c.id === label)
                        ? label
                        : crypto.randomUUID()
                    await api.saveProject({
                      ...project,
                      taskColumns: [...cols, { id, label }],
                    })
                    setAdding(false)
                    setNewCol('')
                  })
              }}
            >
              <input
                autoFocus
                required
                placeholder="列名称"
                value={newCol}
                onChange={(e) => setNewCol(e.target.value)}
              />
              <button className="secondary">添加</button>
            </form>
          ) : (
            <button className="secondary" onClick={() => setAdding(true)}>
              ＋ 添加列
            </button>
          )}
        </section>
      </div>
    </>
  )
}
