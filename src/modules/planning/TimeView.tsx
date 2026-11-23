import { useState } from 'react'
import { ChevronLeft, ChevronRight, Play, Square, Trash2 } from 'lucide-react'
import { api } from '../../api/client'
import {
  asDay,
  clockText,
  dayKey,
  elapsed,
  hours,
  monday,
  secondsIn,
  shift,
  stopTimer,
  timeRecord,
} from '../../state/planning'
import { useNow, useWorkspace } from '../../state/workspace'
import { BarChart, Field } from '../../components/PlanningUI'

export default function TimeView() {
  const { project, entities, times, active, run } = useWorkspace(),
    now = useNow(!!active)
  const [task, setTask] = useState(''),
    [note, setNote] = useState(''),
    [offset, setOffset] = useState(0)
  const [manualTask, setManualTask] = useState(''),
    [date, setDate] = useState(dayKey()),
    [amount, setAmount] = useState('1.5'),
    [memo, setMemo] = useState('')
  const tasks = entities.filter((e) => e.entityType === 'task')
  const options = (
    <>
      <option value="">不关联任务</option>
      {tasks.map((t) => (
        <option key={t.id} value={t.id}>
          {t.title}
        </option>
      ))}
    </>
  )
  const today = asDay(dayKey(new Date(now))),
    week = monday(today),
    start = shift(week, offset * 7),
    end = shift(start, 7)
  const seconds = (from: Date, to: Date) =>
    times.reduce((n, t) => n + secondsIn(t, from, to, now), 0)
  const logs = times
    .filter(
      (t) =>
        secondsIn(t, start, end, now) > 0 ||
        (Date.parse(t.startedAt) >= +start && Date.parse(t.startedAt) < +end),
    )
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
  const breakdown = new Map<string, number>()
  logs.forEach((t) => {
    const key = t.taskId || ''
    breakdown.set(
      key,
      (breakdown.get(key) ?? 0) + secondsIn(t, start, end, now),
    )
  })
  const ranked = [...breakdown].sort((a, b) => b[1] - a[1]),
    title = (id: string | null) =>
      tasks.find((t) => t.id === id)?.title ||
      (id ? '已归档任务' : '不关联任务')
  const running = active?.projectId === project.id ? active : undefined
  return (
    <div className="stack roomy">
      <div className="module-title">
        <h1>工时</h1>
      </div>
      <section className="panel timer-card">
        <div>
          <small>项目计时器</small>
          <strong className="clock">
            {clockText(running ? elapsed(running, now) : 0)}
          </strong>
        </div>
        <div className="stack">
          <Field label="关联任务">
            <select
              disabled={!!running}
              value={running ? running.taskId || '' : task}
              onChange={(e) => setTask(e.target.value)}
            >
              {options}
            </select>
          </Field>
          <input
            aria-label="计时备注"
            placeholder="本次工作备注"
            disabled={!!running}
            value={running ? running.note : note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
        <button
          className="primary"
          disabled={!!active && !running}
          onClick={() =>
            void run(() =>
              running
                ? stopTimer(running)
                : api.saveTimeEntry(timeRecord(project.id, task, note)),
            )
          }
        >
          {running ? <Square size={16} /> : <Play size={16} />}{' '}
          {running ? '停止并保存' : '开始计时'}
        </button>
      </section>
      <div className="kpis">
        {[
          ['今日工时', seconds(today, shift(today, 1))],
          ['本周工时', seconds(week, shift(week, 7))],
          ['累计工时', times.reduce((s, t) => s + elapsed(t, now), 0)],
        ].map(([label, n]) => (
          <div className="panel metric" key={label}>
            <small>{label}</small>
            <strong>
              {hours(Number(n))}
              <em>h</em>
            </strong>
          </div>
        ))}
      </div>
      <form
        className="panel stack"
        onSubmit={(ev) => {
          ev.preventDefault()
          void run(async () => {
            const value = Math.round(Number(amount) * 3600)
            if (!Number.isFinite(value) || value <= 0)
              throw Error('请输入有效工时')
            await api.saveTimeEntry(
              timeRecord(
                project.id,
                manualTask,
                memo,
                asDay(date).toISOString(),
                value,
              ),
            )
            setMemo('')
          })
        }}
      >
        <h2>补记一笔</h2>
        <div className="manual-fields">
          <Field label="任务">
            <select
              value={manualTask}
              onChange={(e) => setManualTask(e.target.value)}
            >
              {options}
            </select>
          </Field>
          <Field label="日期">
            <input
              type="date"
              required
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </Field>
          <Field label="小时">
            <input
              type="number"
              step="any"
              min="0.001"
              required
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </Field>
          <Field label="备注">
            <input value={memo} onChange={(e) => setMemo(e.target.value)} />
          </Field>
          <button className="secondary">保存工时</button>
        </div>
      </form>
      <div className="split">
        <h2>
          {dayKey(start)} — {dayKey(shift(end, -1))}
        </h2>
        <div className="actions">
          <button
            className="secondary"
            aria-label="上周"
            onClick={() => setOffset(offset - 1)}
          >
            <ChevronLeft size={15} />
          </button>
          <button className="secondary" onClick={() => setOffset(0)}>
            本周
          </button>
          <button
            className="secondary"
            aria-label="下周"
            onClick={() => setOffset(offset + 1)}
          >
            <ChevronRight size={15} />
          </button>
        </div>
      </div>
      <div className="chart-grid">
        <section className="panel">
          <h2>每日工时</h2>
          <BarChart
            unit="h"
            labels={['周一', '周二', '周三', '周四', '周五', '周六', '周日']}
            values={Array.from({ length: 7 }, (_, i) =>
              hours(seconds(shift(start, i), shift(start, i + 1))),
            )}
          />
        </section>
        <section className="panel stack">
          <h2>时间花在哪</h2>
          {ranked.map(([id, s]) => (
            <div key={id}>
              <div className="split">
                <span>{title(id)}</span>
                <b>{hours(s)} h</b>
              </div>
              <progress value={s} max={ranked[0][1] || 1} />
            </div>
          ))}
          {!logs.length && <small>本周暂无记录</small>}
        </section>
      </div>
      <section className="panel stack">
        <h2>工时记录</h2>
        {logs.map((t) => (
          <div className="log-row" key={t.id}>
            <time>{new Date(t.startedAt).toLocaleString('zh-CN')}</time>
            <strong>{title(t.taskId)}</strong>
            <span>{t.note}</span>
            <b>{hours(elapsed(t, now))} h</b>
            <button
              title="删除记录"
              onClick={() => void run(() => api.deleteTimeEntry(t.id))}
            >
              <Trash2 size={15} />
            </button>
          </div>
        ))}
        {!logs.length && <small>所选周暂无记录</small>}
      </section>
    </div>
  )
}
