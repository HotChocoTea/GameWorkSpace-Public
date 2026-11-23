import type { Entity, Json, Project, TimeEntry } from '../types'
import { api } from '../api/client'

export const priorities = ['低', '中', '高', '紧急']
export const taskPriority = (e: Entity) =>
  e.data?.priority === '普通' ? '中' : field(e, 'priority', '中')
export const severities = ['致命', '严重', '一般', '轻微']
export const bugStates = ['待处理', '修复中', '已修复', '不修复']
export const bugStatus = (e: Entity) =>
  e.status === '待排查' || !e.status ? '待处理' : e.status
export const bugClosed = (e: Entity) =>
  ['已修复', '不修复', '已关闭'].includes(bugStatus(e))
export const field = (e: Entity, key: string, fallback = '') =>
  String(e.data?.[key] ?? fallback)
export const dayKey = (d = new Date()) =>
  [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('-')
export const asDay = (s: string) => new Date(s.slice(0, 10) + 'T00:00:00')
export function shift(d: Date, n: number) {
  const value = new Date(d)
  value.setDate(value.getDate() + n)
  return value
}
export function monday(d: Date) {
  return shift(asDay(dayKey(d)), -((d.getDay() + 6) % 7))
}
export const standardColumns = ['待办', '进行中', '待测试', '已完成']
export function columns(p: Project, tasks: Entity[]) {
  const result = [
    ...(p.taskColumns ?? standardColumns.map((id) => ({ id, label: id }))),
  ]
  for (const task of tasks) {
    if (!result.some((c) => c.id === task.status))
      result.push({ id: task.status, label: task.status || '未分类' })
  }
  return result
}
export function changeStatus(e: Entity, status: string) {
  const data = { ...e.data }
  if (status === '已完成' && e.status !== status)
    data.completedAt = new Date().toISOString()
  if (status !== '已完成') delete data.completedAt
  return { ...e, status, data }
}
export type CheckItem = { id: string; title: string; done: boolean }
export function checklist(e: Entity, key: string): CheckItem[] {
  const value = e.data?.[key]
  if (!Array.isArray(value)) return []
  return value.flatMap((v) =>
    v && typeof v === 'object' && !Array.isArray(v) && typeof v.id === 'string'
      ? [
          {
            id: v.id,
            title: String(v.title ?? v.text ?? ''),
            done: v.done === true,
          },
        ]
      : [],
  )
}
export const withData = (e: Entity, key: string, value: Json) => ({
  ...e,
  data: { ...e.data, [key]: value },
})
export const elapsed = (t: TimeEntry, now = Date.now()) =>
  t.isRunning
    ? Math.max(0, Math.floor((now - Date.parse(t.startedAt)) / 1000))
    : t.durationSecs
export const clockText = (s: number) =>
  [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60]
    .map((v) => String(v).padStart(2, '0'))
    .join(':')
export const hours = (seconds: number) => Number((seconds / 3600).toFixed(2))
export function secondsIn(
  t: TimeEntry,
  start: Date,
  end: Date,
  now = Date.now(),
) {
  const from = Date.parse(t.startedAt),
    to = t.isRunning
      ? now
      : Date.parse(t.endedAt ?? '') || from + t.durationSecs * 1000
  if (from >= end.getTime() || to <= start.getTime() || to <= from) return 0
  return Math.round(
    (elapsed(t, now) * (Math.min(+end, to) - Math.max(+start, from))) /
      (to - from),
  )
}
export function timeRecord(
  projectId: string,
  taskId: string,
  note: string,
  startedAt = new Date().toISOString(),
  durationSecs = 0,
): TimeEntry {
  return {
    id: crypto.randomUUID(),
    projectId,
    taskId: taskId || null,
    note,
    startedAt,
    createdAt: new Date().toISOString(),
    isRunning: !durationSecs,
    durationSecs,
    endedAt: durationSecs
      ? new Date(Date.parse(startedAt) + durationSecs * 1000).toISOString()
      : null,
  }
}
export async function stopTimer(t: TimeEntry) {
  const now = Date.now()
  await api.saveTimeEntry({
    ...t,
    isRunning: false,
    endedAt: new Date(now).toISOString(),
    durationSecs: elapsed(t, now),
  })
}
export function link(
  projectId: string,
  sourceId: string,
  targetId: string,
  relationLabel: string,
) {
  return {
    id: crypto.randomUUID(),
    projectId,
    sourceId,
    targetId,
    relationLabel,
    linkKind: 'manual',
    createdAt: new Date().toISOString(),
  }
}
