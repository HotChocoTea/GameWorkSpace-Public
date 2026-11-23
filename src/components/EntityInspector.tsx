import { useEffect, useRef, useState } from 'react'
import { Trash2, X, ListPlus } from 'lucide-react'
import type { Entity, Json } from '../types'
import { api } from '../api/client'
import { newEntity, moduleFor } from '../state/catalog'
import {
  bugStates,
  bugStatus,
  changeStatus,
  columns,
  dayKey,
  field,
  link,
  priorities,
  taskPriority,
  severities,
  withData,
} from '../state/planning'
import { useWorkspace } from '../state/workspace'
import {
  Checklist,
  Field,
  ImagesField,
  Options,
  TimerButton,
} from './PlanningUI'
import { EntityLinkPanel } from './EntityLinkPanel'
import { DevlogEditor } from '../modules/testing/DevlogView'

export function EntityInspector({
  entity,
  close,
}: {
  entity: Entity
  close: () => void
}) {
  const { project, entities, save, run, notify } = useWorkspace()
  const [row, set] = useState(entity),
    [busy, setBusy] = useState(false),
    [converted, setConverted] = useState(false)
  const dirty = useRef(false)
  useEffect(() => {
    if (!dirty.current) set(entity)
  }, [entity])
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.querySelector('dialog[open]')) close()
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [close])
  const update = (e: Entity) => {
    dirty.current = true
    set(e)
  }
  const data = (key: string, value: Json) => update(withData(row, key, value))
  const kind = row.entityType,
    task = kind === 'task',
    bug = kind === 'bug',
    phase = kind === 'phase',
    mile = kind === 'milestone',
    event = kind === 'calendar_event'
  const editable = task || bug || phase || mile || event
  const tasks = entities.filter((e) => e.entityType === 'task')
  const input = (key: string, label: string, type = 'text', fallback = '') => (
    <Field label={label}>
      <input
        type={type}
        min={type === 'number' ? 0 : undefined}
        step={type === 'number' ? 0.25 : undefined}
        value={field(row, key, fallback)}
        onChange={(e) =>
          data(
            key,
            type === 'number' && e.target.value
              ? Number(e.target.value)
              : e.target.value,
          )
        }
      />
    </Field>
  )
  const area = (key: string, label: string) => (
    <Field label={label}>
      <textarea
        rows={2}
        value={field(row, key)}
        onChange={(e) => data(key, e.target.value)}
      />
    </Field>
  )
  const relation = (key: string, label: string, type: string) => (
    <Field label={label}>
      <select
        value={field(row, key)}
        onChange={(e) => data(key, e.target.value)}
      >
        <option value="">未关联</option>
        {entities
          .filter((e) => e.entityType === type)
          .map((e) => (
            <option key={e.id} value={e.id}>
              {e.title}
            </option>
          ))}
      </select>
    </Field>
  )
  const assets = (key: string) => {
    const v = row.data?.[key]
    return Array.isArray(v)
      ? v.filter((s): s is string => typeof s === 'string')
      : []
  }
  const persist = async () => {
    if (!row.title.trim()) throw Error('请输入标题')
    if (phase && field(row, 'endDate') < field(row, 'startDate'))
      throw Error('结束日期早于开始日期')
    await save({ ...row, title: row.title.trim() })
    dirty.current = false
  }
  async function convert() {
    setBusy(true)
    try {
      const prior = (await api.listLinks(project.id)).find(
        (l) =>
          l.sourceId === row.id &&
          l.relationLabel === '转为任务' &&
          tasks.some((t) => t.id === l.targetId),
      )
      if (!prior) {
        const target = newEntity(project.id, 'task', row.title)
        const details = [
          row.summary,
          row.body,
          ...[
            ['reproSteps', '复现步骤'],
            ['expected', '预期结果'],
            ['actual', '实际结果'],
          ].map(([k, label]) =>
            field(row, k) ? label + '\n' + field(row, k) : '',
          ),
        ].filter(Boolean)
        target.body = details.join('\n\n')
        target.tags = [...new Set([...row.tags, 'Bug'])]
        target.status = columns(project, tasks)[0]?.id ?? '待办'
        target.data = {
          images: assets('screenshots'),
          priority: ['致命', '严重'].includes(field(row, 'severity'))
            ? '高'
            : '中',
          version: field(row, 'version'),
          foundDate: field(row, 'foundDate'),
        }
        await api.saveBatch(
          [row, target],
          [link(project.id, row.id, target.id, '转为任务')],
        )
        dirty.current = false
      }
      setConverted(true)
      notify('已转为任务')
    } catch (e) {
      notify(String(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <aside
      className="inspector"
      role="dialog"
      aria-label={(moduleFor(kind)?.label ?? '条目') + '详情'}
    >
      <header className="inspector-head">
        <span>{moduleFor(kind)?.label} / 条目详情</span>
        <button aria-label="关闭详情" onClick={close}>
          <X size={19} />
        </button>
      </header>
      {kind === 'devlog' ? (
        <DevlogEditor entity={entity} onDelete={close} />
      ) : (
        <div className="inspector-body stack">
          <div className="actions">
            {task && <TimerButton task={row} />}{' '}
            {bug && (
              <button
                className="secondary"
                disabled={busy || converted}
                onClick={() => void convert()}
              >
                <ListPlus size={15} />
                {converted ? '已转为任务' : '转为任务'}
              </button>
            )}
            <button
              className="danger-text"
              onClick={() =>
                void run(async () => {
                  await api.deleteEntity(row.id)
                  close()
                })
              }
            >
              <Trash2 size={14} />
              删除
            </button>
          </div>
          {editable ? (
            <>
              <Field label="标题">
                <input
                  value={row.title}
                  onChange={(e) => update({ ...row, title: e.target.value })}
                />
              </Field>
              {task && (
                <>
                  <div className="fields-two">
                    <Field label="状态">
                      <select
                        value={row.status}
                        onChange={(e) =>
                          update(changeStatus(row, e.target.value))
                        }
                      >
                        {columns(project, tasks).map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.label}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="优先级">
                      <select
                        value={taskPriority(row)}
                        onChange={(e) => data('priority', e.target.value)}
                      >
                        <Options values={priorities} />
                      </select>
                    </Field>
                    {input('dueDate', '截止日期', 'date')}
                    {input('estimateHours', '预计工时（小时）', 'number')}
                  </div>
                  {relation('milestoneId', '里程碑', 'milestone')}
                  <Field label="标签（用逗号分隔）">
                    <input
                      key={row.id}
                      defaultValue={row.tags.join('，')}
                      onChange={(e) =>
                        update({
                          ...row,
                          tags: [
                            ...new Set(
                              e.target.value
                                .split(/[,，]/)
                                .map((t) => t.trim())
                                .filter(Boolean),
                            ),
                          ],
                        })
                      }
                    />
                  </Field>
                  <Checklist entity={row} name="subtasks" change={update} />
                </>
              )}
              {bug && (
                <>
                  <div className="fields-two">
                    <Field label="严重程度">
                      <select
                        value={field(row, 'severity', '一般')}
                        onChange={(e) => data('severity', e.target.value)}
                      >
                        <Options values={severities} />
                      </select>
                    </Field>
                    <Field label="状态">
                      <select
                        value={bugStatus(row)}
                        onChange={(e) =>
                          update({ ...row, status: e.target.value })
                        }
                      >
                        <Options values={bugStates} />
                      </select>
                    </Field>
                    {input('version', '版本')}
                    {input(
                      'foundDate',
                      '发现日期',
                      'date',
                      dayKey(new Date(row.createdAt)),
                    )}
                  </div>
                  {area('reproSteps', '复现步骤')}
                  {area('expected', '预期结果')}
                  {area('actual', '实际结果')}
                </>
              )}
              {(phase || mile) && (
                <Field label="状态">
                  <select
                    value={row.status}
                    onChange={(e) => update({ ...row, status: e.target.value })}
                  >
                    <Options values={['待开始', '进行中', '已完成']} />
                  </select>
                </Field>
              )}
              {phase && (
                <>
                  <div className="fields-two">
                    {input('startDate', '开始日期', 'date')}
                    {input('endDate', '结束日期', 'date')}
                  </div>
                  <Checklist entity={row} name="deliverables" change={update} />
                </>
              )}
              {mile && (
                <>
                  {input('dueDate', '里程碑日期', 'date')}
                  {relation('phaseId', '关联阶段', 'phase')}
                </>
              )}
              {event && (
                <>
                  {input('date', '日期', 'date')}
                  <div className="fields-two">
                    {input('startTime', '开始时间', 'time')}
                    {input('endTime', '结束时间', 'time')}
                  </div>
                </>
              )}
              <Field label={phase ? '阶段目标问题' : '摘要'}>
                <textarea
                  rows={2}
                  value={row.summary}
                  onChange={(e) => update({ ...row, summary: e.target.value })}
                />
              </Field>
              <Field label="描述">
                <textarea
                  rows={3}
                  value={row.body}
                  onChange={(e) => update({ ...row, body: e.target.value })}
                />
              </Field>
              {(task || bug) && (
                <ImagesField
                  names={assets(task ? 'images' : 'screenshots')}
                  label={task ? '图片附件' : '截图'}
                  paste={bug}
                  change={(v) => data(task ? 'images' : 'screenshots', v)}
                />
              )}
              <button
                className="primary"
                disabled={busy || !row.title.trim()}
                onClick={() =>
                  void run(async () => {
                    await persist()
                    notify('已保存')
                  })
                }
              >
                保存更改
              </button>
            </>
          ) : (
            <>
              <h2>{row.title}</h2>
              <div className="chips">
                {[row.status, ...row.tags].filter(Boolean).map((t, i) => (
                  <span key={i}>{t}</span>
                ))}
              </div>
              <p>{row.summary}</p>
              <p className="body-copy">{row.body}</p>
              {field(row, 'secretTruth') && (
                <details>
                  <summary>隐藏真相</summary>
                  {field(row, 'secretTruth')}
                </details>
              )}
            </>
          )}
          <EntityLinkPanel entity={row} />
        </div>
      )}
    </aside>
  )
}
