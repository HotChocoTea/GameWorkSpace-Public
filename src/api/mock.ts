import fixture from '../../shared/lightward.json'
import type {
  Snapshot,
  Project,
  Entity,
  EntityLink,
  Json,
  AppSettings,
  ProjectStats,
  TimeEntry,
  ActivityLog,
  MapRecord,
  CraftingRecipe,
} from '../types'
type ProjectRow = { id: string; projectId: string }
const copy = <T>(x: T): T => structuredClone(x)
const stamp = () => new Date().toISOString()
const sample = JSON.parse(JSON.stringify(fixture), (_, v: unknown) => {
  if (typeof v !== 'string') return v
  const match = /^@day:(-?\d+)(T.*)?$/.exec(v)
  if (!match) return v
  const d = new Date()
  d.setDate(d.getDate() + Number(match[1]))
  const local = [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('-')
  return local + (match[2] ?? '')
}) as Snapshot
const projects = new Map<string, Snapshot>([[sample.project.id, sample]])
const settings = new Map<string, AppSettings>()
const assets = new Map<string, string>()
for (const entity of sample.entities) {
  const key = {
    character: 'avatarAsset',
    location: 'coverAsset',
    vehicle: 'imageAsset',
  }[entity.entityType]
  const name = key && entity.data?.[key]
  if (typeof name === 'string') {
    assets.set(
      name,
      new URL(`../assets/lightward/${entity.id}.webp`, import.meta.url).href,
    )
  }
}
const changes = new EventTarget()
const changed = () => changes.dispatchEvent(new Event('change'))
function project(id: string) {
  const s = projects.get(id)
  if (!s) throw Error('项目不存在')
  return s
}
function entity(id: string) {
  for (const s of projects.values()) {
    const e = s.entities.find((x) => x.id === id)
    if (e) return e
  }
  throw Error('条目不存在')
}
function recordActivity(row: Entity, action: string, verb: string) {
  const workspace = project(row.projectId)
  workspace.project.updatedAt = stamp()
  workspace.activity.push({
    id: crypto.randomUUID(),
    projectId: row.projectId,
    entityId: row.id,
    entityType: row.entityType,
    action,
    summary: verb + '「' + row.title + '」',
    createdAt: workspace.project.updatedAt,
  })
}
function remapReferences(
  value: Json,
  key: string,
  ids: Map<string, string>,
): Json {
  if (Array.isArray(value))
    return value.map((item) => remapReferences(item, key, ids))
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([field, child]) => [
        key === 'diplomacy' ? (ids.get(field) ?? field) : field,
        remapReferences(child, field, ids),
      ]),
    )
  if (
    typeof value === 'string' &&
    /^(id|members|tools|from|to|prerequisites)$|Ids?$/.test(key)
  )
    return ids.get(value) ?? value
  return value
}
function collection<T extends ProjectRow>(rows: (s: Snapshot) => T[]) {
  return {
    list: async (projectId: string) => copy(rows(project(projectId))),
    save: async (row: T) => {
      const list = rows(project(row.projectId))
      const i = list.findIndex((x) => x.id === row.id)
      if (i === -1) list.push(copy(row))
      else list[i] = copy(row)
      changed()
    },
    remove: async (id: string) => {
      for (const s of projects.values()) {
        const list = rows(s)
        const i = list.findIndex((x) => x.id === id)
        if (i >= 0) {
          list.splice(i, 1)
          changed()
          return
        }
      }
      throw Error('记录不存在')
    },
  }
}
export const mockLinks = collection<EntityLink>((s) => s.links)
const timeCollection = collection<TimeEntry>((s) => s.timeEntries)
export const mockTime = {
  ...timeCollection,
  async save(t: TimeEntry) {
    if (
      t.isRunning &&
      [...projects.values()].some((p) =>
        p.timeEntries.some((other) => other.isRunning && other.id !== t.id),
      )
    )
      throw Error('请先停止当前计时')
    await timeCollection.save(t)
  },
}
export const mockActivity = collection<ActivityLog>((s) => s.activity)
export const mockMaps = collection<MapRecord>((s) => s.maps)
export const mockRecipes = collection<CraftingRecipe>((s) => s.recipes)
export const mock = {
  subscribe(fn: () => void) {
    changes.addEventListener('change', fn)
    return () => changes.removeEventListener('change', fn)
  },
  async listProjects() {
    return copy(
      [...projects.values()]
        .map((s) => s.project)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    )
  },
  async getProject(id: string) {
    return copy(project(id).project)
  },
  async saveProject(p: Project) {
    if (!p.name.trim()) throw Error('请输入项目名称')
    const old = projects.get(p.id) ?? {
      entities: [],
      links: [],
      timeEntries: [],
      activity: [],
      maps: [],
      recipes: [],
      aiMessages: [],
      aiProposals: [],
    }
    projects.set(p.id, { ...old, project: { ...copy(p), updatedAt: stamp() } })
    changed()
  },
  async deleteProject(id: string) {
    project(id)
    projects.delete(id)
    changed()
  },
  async duplicateProject(id: string) {
    const s = project(id)
    const ids = new Map<string, string>([[id, crypto.randomUUID()]])
    for (const list of [
      s.entities,
      s.links,
      s.timeEntries,
      s.activity,
      s.maps,
      s.recipes,
      s.aiMessages,
      s.aiProposals,
    ])
      for (const row of list) ids.set(row.id, crypto.randomUUID())
    const clone = remapReferences(
      s as unknown as Json,
      '',
      ids,
    ) as unknown as Snapshot
    for (const art of clone.entities.filter(
      (e) => e.entityType === 'concept_art',
    )) {
      if (art.data && Array.isArray(art.data.tags))
        art.data.tags = remapReferences(art.data.tags, 'entityIds', ids)
    }
    for (const timer of clone.timeEntries.filter((t) => t.isRunning)) {
      timer.isRunning = false
      timer.endedAt = stamp()
      timer.durationSecs = Math.max(
        0,
        Math.floor((Date.now() - Date.parse(timer.startedAt)) / 1000),
      )
    }
    clone.project.name += '（副本）'
    clone.project.createdAt = clone.project.updatedAt = stamp()
    projects.set(clone.project.id, clone)
    changed()
    return copy(clone.project)
  },
  async exportProject(id: string) {
    return copy(project(id))
  },
  async stats(): Promise<ProjectStats[]> {
    return [...projects.values()].map((s) => {
      const items = s.entities.filter((e) => !e.deletedAt),
        tasks = items.filter((e) => e.entityType === 'task')
      const next = items
        .filter(
          (e) =>
            e.entityType === 'milestone' &&
            e.status !== '已完成' &&
            typeof e.data?.dueDate === 'string',
        )
        .sort((a, b) =>
          String(a.data?.dueDate).localeCompare(String(b.data?.dueDate)),
        )[0]
      return {
        projectId: s.project.id,
        entities: items.length,
        tasks: tasks.length,
        completed: tasks.filter((e) => e.status === '已完成').length,
        seconds: s.timeEntries.reduce((n, t) => n + t.durationSecs, 0),
        milestone: next?.title ?? null,
        dueDate: next ? String(next.data?.dueDate) : null,
      }
    })
  },
  async listEntities(id: string) {
    return copy(project(id).entities.filter((e) => !e.deletedAt))
  },
  async getEntity(id: string) {
    return copy(entity(id))
  },
  async saveEntity(row: Entity) {
    const list = project(row.projectId).entities
    const existing = list.findIndex((e) => e.id === row.id)
    if (!row.title.trim() || list[existing]?.deletedAt)
      throw Error('条目不可保存')
    const saved = { ...copy(row), updatedAt: stamp() }
    const completed =
      row.entityType === 'task' &&
      row.status === '已完成' &&
      list[existing]?.status !== row.status
    if (existing < 0) list.push(saved)
    else list[existing] = saved
    recordActivity(
      saved,
      completed ? 'complete' : existing < 0 ? 'create' : 'update',
      completed ? '完成了' : existing < 0 ? '创建了' : '更新了',
    )
    changed()
  },
  async saveBatch(
    rows: Entity[],
    links: EntityLink[],
    restore: string[] = [],
    trash: string[] = [],
  ) {
    const revived = new Set(restore)
    if (revived.size !== restore.length || new Set(trash).size !== trash.length)
      throw Error('重复的回收站操作')
    for (const id of restore) {
      const deleted = entity(id).deletedAt
      if (!deleted || Date.parse(deleted) <= Date.now() - 14 * 86400000)
        throw Error('记录不可恢复')
    }
    for (const id of trash)
      if (entity(id).deletedAt && !revived.has(id))
        throw Error('条目已移至回收站')
    for (const row of rows) {
      if (
        !row.title.trim() ||
        project(row.projectId).entities.some(
          (e) => e.id === row.id && e.deletedAt && !revived.has(e.id),
        )
      )
        throw Error('条目不可保存')
    }
    for (const l of links) {
      const available = [
        ...project(l.projectId).entities,
        ...rows.filter((e) => e.projectId === l.projectId),
      ]
      if (
        ![l.sourceId, l.targetId].every((id) =>
          available.some(
            (e) => e.id === id && (!e.deletedAt || revived.has(id)),
          ),
        )
      )
        throw Error('关联目标不存在')
    }
    for (const id of restore) await mock.restoreEntity(id)
    for (const row of rows) await mock.saveEntity(row)
    for (const l of links) await mockLinks.save(l)
    for (const id of trash) await mock.deleteEntity(id)
  },
  async deleteEntity(id: string) {
    const row = entity(id)
    if (row.deletedAt) throw Error('条目已移至回收站')
    row.deletedAt = row.updatedAt = stamp()
    recordActivity(row, 'delete', '移至回收站')
    changed()
  },
  async restoreEntity(id: string) {
    const row = entity(id)
    if (
      !row.deletedAt ||
      Date.parse(row.deletedAt) <= Date.now() - 14 * 86400000
    )
      throw Error('记录不可恢复')
    row.deletedAt = null
    row.updatedAt = stamp()
    recordActivity(row, 'restore', '恢复了')
    changed()
  },
  async recycleBin(id: string | null) {
    const cutoff = Date.now() - 14 * 86400000
    return copy(
      [...projects.values()]
        .filter((s) => !id || s.project.id === id)
        .flatMap((s) =>
          s.entities.filter(
            (e) => e.deletedAt && Date.parse(e.deletedAt) > cutoff,
          ),
        ),
    )
  },
  async search(id: string, q: string, limit: number) {
    const term = q.trim().toLowerCase()
    return term
      ? copy(
          project(id)
            .entities.filter(
              (e) =>
                !e.deletedAt &&
                [e.title, e.subtitle, e.summary, e.body, ...e.tags].some((s) =>
                  s.toLowerCase().includes(term),
                ),
            )
            .slice(0, limit),
        )
      : []
  },
  async getSetting(key: string) {
    return copy(settings.get(key) ?? null)
  },
  async saveSetting(key: string, value: Json) {
    settings.set(key, { key, value: copy(value), updatedAt: stamp() })
    changed()
  },
  async deleteSetting(key: string) {
    settings.delete(key)
    changed()
  },
  async upload(file: File, ext: string) {
    const bytes = await file.arrayBuffer()
    const hash = await crypto.subtle.digest('SHA-256', bytes)
    const filename =
      Array.from(new Uint8Array(hash), (b) =>
        b.toString(16).padStart(2, '0'),
      ).join('') +
      '.' +
      ext
    if (!assets.has(filename)) assets.set(filename, URL.createObjectURL(file))
    return { filename, size: file.size }
  },
  assetUrl(name: string) {
    return assets.get(name) ?? ''
  },
}
