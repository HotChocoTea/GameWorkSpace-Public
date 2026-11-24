import { invoke, convertFileSrc, isTauri } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
type Preview = typeof import('./mock')
import type {
  Project,
  Entity,
  ProjectStats,
  Snapshot,
  SearchResult,
  AppSettings,
  Json,
  EntityLink,
  TimeEntry,
  ActivityLog,
  MapRecord,
  CraftingRecipe,
  AssetInfo,
} from '../types'

export const desktop = isTauri()
let previewModule: Preview | undefined
let previewRequest: Promise<Preview> | undefined
function preview() {
  return (previewRequest ??= import('./mock').then(
    (module) => (previewModule = module),
  ))
}
function call<T>(
  command: string,
  args: Record<string, unknown>,
  fallback: (module: Preview) => Promise<T>,
): Promise<T> {
  return desktop ? invoke<T>(command, args) : preview().then(fallback)
}
async function saveAsset(file: File): Promise<AssetInfo> {
  const ext: Record<string, string> = {
    'audio/mpeg': 'mp3',
    'audio/wav': 'wav',
    'audio/x-wav': 'wav',
    'audio/vnd.wave': 'wav',
    'audio/ogg': 'ogg',
    'audio/flac': 'flac',
    'audio/x-flac': 'flac',
    'audio/mp4': 'm4a',
    'audio/x-m4a': 'm4a',
    'audio/webm': 'webm',
    'video/webm': 'webm',
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/avif': 'avif',
    'image/bmp': 'bmp',
  }
  const suffix = file.name.split('.').pop()?.toLowerCase() ?? ''
  const extension =
    ext[file.type] ??
    (['mp3', 'wav', 'ogg', 'flac', 'm4a', 'webm'].includes(suffix)
      ? suffix
      : '')
  if (!extension) throw Error('请选择受支持的图片或音频文件')
  if (!desktop) return (await preview()).mock.upload(file, extension)
  return invoke('save_asset', await file.arrayBuffer(), {
    headers: { 'x-gws-extension': extension },
  })
}
export const api = {
  saveAsset,
  upload: saveAsset,
  async parseTabularFile(file: File) {
    if (desktop)
      return invoke<import('./table').ParsedTable>('parse_tabular_file', {
        bytes: Array.from(new Uint8Array(await file.arrayBuffer())),
        filename: file.name,
      })
    if (!/\.csv$/i.test(file.name))
      throw Error('请在桌面端导入 Excel 文件，或选择 CSV 文件')
    return (await import('./table')).parseCsv(await file.text())
  },
  saveBatch: (
    entities: Entity[],
    links: EntityLink[] = [],
    restore: string[] = [],
    trash: string[] = [],
  ) =>
    call<void>(
      'save_entity_batch',
      { entities, links, restore, trash },
      (module) => module.mock.saveBatch(entities, links, restore, trash),
    ),
  listProjects: () =>
    call<Project[]>('list_projects', {}, (module) =>
      module.mock.listProjects(),
    ),
  getProject: (id: string) =>
    call<Project>('get_project', { id }, (module) =>
      module.mock.getProject(id),
    ),
  saveProject: (project: Project) =>
    call<void>('save_project', { project }, (module) =>
      module.mock.saveProject(project),
    ),
  deleteProject: (id: string) =>
    call<void>('delete_project', { id }, (module) =>
      module.mock.deleteProject(id),
    ),
  duplicateProject: (id: string) =>
    call<Project>('duplicate_project', { id }, (module) =>
      module.mock.duplicateProject(id),
    ),
  exportProject: (id: string) =>
    call<Snapshot>('export_project', { id }, (module) =>
      module.mock.exportProject(id),
    ),
  stats: () =>
    call<ProjectStats[]>('workspace_stats', {}, (module) =>
      module.mock.stats(),
    ),
  listEntities: (projectId: string) =>
    call<Entity[]>('list_entities', { projectId }, (module) =>
      module.mock.listEntities(projectId),
    ),
  getEntity: (id: string) =>
    call<Entity>('get_entity', { id }, (module) => module.mock.getEntity(id)),
  saveEntity: (entity: Entity) =>
    call<void>('save_entity', { entity }, (module) =>
      module.mock.saveEntity(entity),
    ),
  deleteEntity: (id: string) =>
    call<void>('delete_entity', { id }, (module) =>
      module.mock.deleteEntity(id),
    ),
  restoreEntity: (id: string) =>
    call<void>('restore_entity', { id }, (module) =>
      module.mock.restoreEntity(id),
    ),
  recycleBin: (projectId: string | null) =>
    call<Entity[]>('recycle_bin', { projectId }, (module) =>
      module.mock.recycleBin(projectId),
    ),
  search: (projectId: string, query: string, limit = 30) =>
    call<SearchResult[]>(
      'search_entities',
      { projectId, query, limit },
      (module) => module.mock.search(projectId, query, limit),
    ),
  getSetting: (key: string) =>
    call<AppSettings | null>('get_setting', { key }, (module) =>
      module.mock.getSetting(key),
    ),
  saveSetting: (key: string, value: Json) =>
    call<void>('save_setting', { key, value }, (module) =>
      module.mock.saveSetting(key, value),
    ),
  deleteSetting: (key: string) =>
    call<void>('delete_setting', { key }, (module) =>
      module.mock.deleteSetting(key),
    ),
  backlinks: (projectId: string, target: string) =>
    call<EntityLink[]>('backlinks', { projectId, target }, (module) =>
      module.mockLinks
        .list(projectId)
        .then((rows) => rows.filter((l) => l.targetId === target)),
    ),
  listLinks: (projectId: string) =>
    call<EntityLink[]>('list_links', { projectId }, (module) =>
      module.mockLinks.list(projectId),
    ),
  saveLink: (link: EntityLink) =>
    call<void>('save_link', { link }, (module) => module.mockLinks.save(link)),
  deleteLink: (id: string) =>
    call<void>('delete_link', { id }, (module) => module.mockLinks.remove(id)),
  listTimeEntries: (projectId: string) =>
    call<TimeEntry[]>('list_time_entries', { projectId }, (module) =>
      module.mockTime.list(projectId),
    ),
  saveTimeEntry: (record: TimeEntry) =>
    call<void>('save_time_entry', { record }, (module) =>
      module.mockTime.save(record),
    ),
  deleteTimeEntry: (id: string) =>
    call<void>('delete_time_entry', { id }, (module) =>
      module.mockTime.remove(id),
    ),
  listActivity: (projectId: string) =>
    call<ActivityLog[]>('list_activity', { projectId }, (module) =>
      module.mockActivity.list(projectId),
    ),
  saveActivity: (record: ActivityLog) =>
    call<void>('save_activity', { record }, (module) =>
      module.mockActivity.save(record),
    ),
  deleteActivity: (id: string) =>
    call<void>('delete_activity', { id }, (module) =>
      module.mockActivity.remove(id),
    ),
  listMaps: (projectId: string) =>
    call<MapRecord[]>('list_maps', { projectId }, (module) =>
      module.mockMaps.list(projectId),
    ),
  saveMap: (record: MapRecord) =>
    call<void>('save_map', { record }, (module) =>
      module.mockMaps.save(record),
    ),
  deleteMap: (id: string) =>
    call<void>('delete_map', { id }, (module) => module.mockMaps.remove(id)),
  listRecipes: (projectId: string) =>
    call<CraftingRecipe[]>('list_recipes', { projectId }, (module) =>
      module.mockRecipes.list(projectId),
    ),
  saveRecipe: (record: CraftingRecipe) =>
    call<void>('save_recipe', { record }, (module) =>
      module.mockRecipes.save(record),
    ),
  deleteRecipe: (id: string) =>
    call<void>('delete_recipe', { id }, (module) =>
      module.mockRecipes.remove(id),
    ),
  subscribe: (
    fn: (change?: {
      seq: number
      externalMcpCount: number
      latestSummary: string
      syncErrors?: string[]
    }) => void,
  ) =>
    desktop
      ? listen<{
          seq: number
          externalMcpCount: number
          latestSummary: string
          syncErrors?: string[]
        }>('gws://db-changed', ({ payload }) => fn(payload))
      : preview().then((m) => m.mock.subscribe(fn)),
  assetUrl: (name: string) =>
    desktop
      ? convertFileSrc(name, 'gws-asset')
      : (previewModule?.mock.assetUrl(name) ?? ''),
}
export const coverUrl = (p: Project) =>
  p.coverAsset
    ? api.assetUrl(p.coverAsset)
    : '/covers/' + p.coverPreset + '.jpg'
