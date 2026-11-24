import { native } from './ai'
import { api, desktop } from './client'
import type { Entity, Json, Snapshot } from '../types'

export const categories = {
  outgoingLinks: '指向其他条目的关联',
  incomingLinks: '来自其他条目的关联',
  craftingRecipes: '合成配方',
  mapPins: '地图图钉',
  sceneReferences: '场景与对白',
  questReferences: '任务线',
  fieldReferences: '世界与资产',
  mentionsInText: '正文提及',
}
type Category = keyof typeof categories
export type Reference = Pick<Entity, 'id' | 'title' | 'entityType'> & {
  detail: string
}
export type ImpactReport = Record<Category, Reference[]> & {
  totalReferences: number
}
export function mentionedTitles(e: Entity) {
  const titles = new Set<string>()
  function visit(v: Json | undefined) {
    if (typeof v === 'string') {
      for (const m of v.matchAll(/\[\[([^\[\]\n\r]+)\]\]/g))
        titles.add(m[1].trim())
    } else if (v && typeof v === 'object') Object.values(v).forEach(visit)
  }
  ;[e.title, e.subtitle, e.summary, e.body, e.status, e.tags, e.data].forEach(
    visit,
  )
  return titles
}
export function previewImpact(s: Snapshot, id: string): ImpactReport {
  const report: ImpactReport = {
    outgoingLinks: [],
    incomingLinks: [],
    craftingRecipes: [],
    mapPins: [],
    sceneReferences: [],
    questReferences: [],
    fieldReferences: [],
    mentionsInText: [],
    totalReferences: 0,
  }
  const active = s.entities.filter((e) => !e.deletedAt),
    target = active.find((e) => e.id === id)
  if (!target) throw Error('条目不存在')
  function add(
    group: Category,
    e: Pick<Entity, 'id' | 'title' | 'entityType'> | undefined,
    detail: string,
  ) {
    if (e) {
      report[group].push({
        id: e.id,
        title: e.title,
        entityType: e.entityType,
        detail,
      })
      report.totalReferences++
    }
  }
  for (const l of s.links) {
    if (l.sourceId === id)
      add(
        'outgoingLinks',
        active.find((e) => e.id === l.targetId),
        l.relationLabel,
      )
    if (l.targetId === id)
      add(
        'incomingLinks',
        active.find((e) => e.id === l.sourceId),
        l.relationLabel,
      )
  }
  const arr = (v: Json | undefined) => (Array.isArray(v) ? v : [])
  const field = (v: Json, k: string) =>
    v && typeof v === 'object' && !Array.isArray(v) ? v[k] : undefined
  for (const r of s.recipes)
    if (
      r.outputItemId === id ||
      arr(r.ingredients).some((x) => field(x, 'itemId') === id) ||
      arr(r.tools).includes(id)
    )
      add(
        'craftingRecipes',
        active.find((e) => e.id === r.outputItemId),
        '合成配方 · ' + r.id,
      )
  for (const m of s.maps)
    for (const p of arr(m.pins))
      if (field(p, 'entityId') === id)
        add(
          'mapPins',
          { id: m.id, title: m.name, entityType: 'map' },
          String(field(p, 'label') ?? '图钉'),
        )
  const fields: Record<string, string[]> = {
    scene: [
      'locationId',
      'questId',
      'castIds',
      'lines.speakerId',
      'dialogues.speakerId',
    ],
    quest: ['giverId', 'locationId', 'prerequisites'],
    faction: ['hqLocationId', 'members.characterId'],
    vehicle: ['ownerCharacterId', 'ownerFactionId', 'partItemIds'],
    location: ['parentId'],
    collectible: ['locationId', 'questId'],
    asset_item: ['linkedEntityIds'],
  }
  for (const e of active) {
    if (e.id === id) continue
    for (const path of fields[e.entityType] ?? []) {
      const [k, sub] = path.split('.'),
        v = e.data?.[k],
        group =
          e.entityType === 'scene'
            ? 'sceneReferences'
            : e.entityType === 'quest'
              ? 'questReferences'
              : 'fieldReferences'
      if (sub) {
        arr(v).forEach((x, i) => {
          if (field(x, sub) === id) add(group, e, path + ' #' + (i + 1))
        })
      } else if (v === id || arr(v).includes(id)) add(group, e, path)
    }
    if (mentionedTitles(e).has(target.title.trim()))
      add('mentionsInText', e, '[[' + target.title + ']]')
  }
  return report
}
export async function analyze(projectId: string, entityId: string) {
  return desktop
    ? native<ImpactReport>('analyze_entity_impact', { projectId, entityId })
    : previewImpact(await api.exportProject(projectId), entityId)
}
