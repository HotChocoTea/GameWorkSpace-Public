import { useEffect, useRef, useState } from 'react'
import type { Entity, Json } from '../../types'
import { newEntity } from '../../state/catalog'
import { useWorkspace } from '../../state/workspace'

export type Data = Record<string, Json>
export const record = (v: Json | undefined): Data =>
  v && typeof v === 'object' && !Array.isArray(v) ? v : {}
export const list = (v: Json | undefined): Json[] => (Array.isArray(v) ? v : [])
export const strings = (v: Json | undefined) =>
  list(v).filter((s): s is string => typeof s === 'string')
export const scalar = (v: Json | undefined, fallback = '') =>
  typeof v === 'string' || typeof v === 'number' ? String(v) : fallback
export const numeric = (v: Json | undefined) => {
  if (
    (typeof v !== 'number' && typeof v !== 'string') ||
    String(v).trim() === ''
  )
    return undefined
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}
export const value = (e: Entity, key: string, fallback = '') =>
  scalar(e.data?.[key], fallback)
export const matches = (e: Entity, query: string) =>
  [e.title, e.summary, e.body, ...e.tags]
    .join(' ')
    .toLocaleLowerCase()
    .includes(query.trim().toLocaleLowerCase())
export const tiers = ['公开常识', '鲜为人知', '禁忌秘密', '未设定']
export const rarities = ['普通', '精良', '稀有', '史诗', '传说']
export const rarity = (e: Entity) => {
  const s = value(e, 'rarity', '普通')
  return s === '常见' ? '普通' : s === '精制' ? '精良' : s
}
export const secrecy = (e: Entity) => {
  const tier = value(e, 'secrecy', tiers[numeric(e.data?.revealStage) ?? 3])
  return tiers.includes(tier) ? tier : '未设定'
}
export const yearLabel = (n: number) =>
  n < 0 ? '纪元前 ' + Math.abs(n) + ' 年' : n + ' 年'

export function useWorld(type: string, firstTab: string) {
  const ctx = useWorkspace()
  const [tab, setTab] = useState(firstTab)
  const rows = ctx.entities
    .filter((e) => e.entityType === type)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title))
  const selected = rows.find((e) => e.id === ctx.selected)
  useEffect(() => {
    if (ctx.selected) setTab(firstTab)
  }, [ctx.selected, firstTab])
  function switchTab(next: string) {
    if (next !== tab) {
      if (ctx.selected) ctx.close()
      setTab(next)
    }
  }
  async function create(title: string, data: Data = {}, body = '') {
    const e = { ...newEntity(ctx.project.id, type, title), data, body }
    try {
      await ctx.save(e)
      setTab(firstTab)
      ctx.inspect(e.id)
    } catch (error) {
      ctx.notify(String(error))
    }
  }
  function open(e: Entity) {
    setTab(firstTab)
    ctx.openEntity(e)
  }
  return { ...ctx, rows, selected, create, open, tab, switchTab }
}

// Keep only locally changed fields in the draft so live updates to unrelated fields survive.
type Patch = Partial<Pick<Entity, 'title' | 'summary' | 'body' | 'status'>> & {
  data?: Data
}
function apply(e: Entity, patch: Patch): Entity {
  return { ...e, ...patch, data: { ...e.data, ...patch.data } }
}
export function useEditor(entity: Entity) {
  const { save, notify, selected } = useWorkspace()
  const panel = useRef<HTMLElement>(null)
  useEffect(() => {
    if (selected === entity.id && panel.current) {
      panel.current.focus({ preventScroll: true })
      if (panel.current.getBoundingClientRect().top < 0)
        panel.current.scrollIntoView({ block: 'start' })
    }
  }, [selected, entity.id])
  const latest = useRef({ entity, save, notify })
  latest.current = { entity, save, notify }
  const pending = useRef<Patch>({})
  const version = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const inFlight = useRef(Promise.resolve())
  const [status, setStatus] = useState('已自动保存')
  const [, render] = useState(0)
  async function flush() {
    clearTimeout(timer.current)
    const patch = pending.current
    if (!Object.keys(patch).length) return inFlight.current
    const ticket = version.current
    pending.current = {}
    try {
      const item = apply(latest.current.entity, patch)
      item.title = item.title.trim() || '未命名'
      inFlight.current = latest.current.save(item)
      await inFlight.current
      if (ticket === version.current) setStatus('已自动保存')
    } catch (error) {
      const newer = pending.current
      pending.current = {
        ...patch,
        ...newer,
        data: { ...patch.data, ...newer.data },
      }
      setStatus('保存失败，重试')
      latest.current.notify(String(error))
    }
  }
  useEffect(() => {
    const leave = () => {
      void flush()
    }
    window.addEventListener('pagehide', leave)
    return () => {
      window.removeEventListener('pagehide', leave)
      leave()
    }
  }, [])
  function edit(changes: Patch) {
    pending.current = {
      ...pending.current,
      ...changes,
      data: { ...pending.current.data, ...changes.data },
    }
    version.current++
    setStatus('保存中…')
    render((n) => n + 1)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => void flush(), 600)
  }
  return {
    e: apply(entity, pending.current),
    edit,
    data: (key: string, v: Json) => edit({ data: { [key]: v } }),
    status,
    flush,
    panel,
  }
}
export type Editor = ReturnType<typeof useEditor>

export function ancestors(e: Entity, rows: Entity[]) {
  const result: Entity[] = []
  const seen = new Set([e.id])
  let id = value(e, 'parentId')
  while (id && !seen.has(id)) {
    const parent = rows.find((item) => item.id === id)
    if (!parent) break
    result.unshift(parent)
    seen.add(id)
    id = value(parent, 'parentId')
  }
  return result
}
export const parentsFor = (e: Entity, rows: Entity[]) =>
  rows.filter(
    (row) =>
      row.id !== e.id &&
      !ancestors(row, rows).some((parent) => parent.id === e.id),
  )

// Imported hierarchies can contain orphans and cycles. Break one edge per cycle for display.
export function forest(rows: Entity[]) {
  const known = new Set(rows.map((e) => e.id))
  const parent = new Map(rows.map((e) => [e.id, value(e, 'parentId')]))
  const checked = new Set<string>()
  for (const e of rows) {
    const path = new Set<string>()
    let id = e.id
    while (known.has(id) && !checked.has(id)) {
      if (path.has(id)) {
        parent.delete(id)
        break
      }
      path.add(id)
      id = parent.get(id) ?? ''
    }
    path.forEach((key) => checked.add(key))
  }
  const groups = new Map<string, Entity[]>()
  for (const e of rows) {
    const key = parent.get(e.id) ?? ''
    const group = known.has(key) ? key : ''
    if (!groups.has(group)) groups.set(group, [])
    groups.get(group)!.push(e)
  }
  return groups
}
export function rowsOf(e: Entity, key: string): (Data & { id: string })[] {
  return list(e.data?.[key]).map((v, i) => {
    const row = record(v)
    return { ...row, id: scalar(row.id, key + '-' + i) }
  })
}
