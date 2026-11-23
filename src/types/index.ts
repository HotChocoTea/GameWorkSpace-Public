export type Json =
  string | number | boolean | null | Json[] | { [key: string]: Json }

export interface Project {
  id: string
  name: string
  pitch: string
  genres: string[]
  engine: string
  platforms: string[]
  logoAsset: string | null
  coverPreset: string
  coverAsset: string | null
  enabledModules: string[]
  taskColumns?: { id: string; label: string }[] | null
  currentPhaseId: string | null
  createdAt: string
  updatedAt: string
}

export interface Entity {
  id: string
  projectId: string
  entityType: string
  title: string
  subtitle: string
  summary: string
  status: string
  tags: string[]
  body: string
  data: Record<string, Json> | null
  sortOrder: number
  deletedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface EntityLink {
  id: string
  projectId: string
  sourceId: string
  targetId: string
  relationLabel: string
  linkKind: string
  createdAt: string
}

export interface TimeEntry {
  id: string
  projectId: string
  taskId: string | null
  startedAt: string
  endedAt: string | null
  durationSecs: number
  note: string
  isRunning: boolean
  createdAt: string
}

export interface ActivityLog {
  id: string
  projectId: string
  entityId: string | null
  entityType: string
  action: string
  summary: string
  createdAt: string
}

export interface MapRecord {
  id: string
  projectId: string
  name: string
  width: number
  height: number
  tileSize: number
  layers: Json
  pins: Json
  customTiles: Json
  createdAt: string
  updatedAt: string
}

export interface CraftingRecipe {
  id: string
  projectId: string
  outputItemId: string
  outputQty: number
  ingredients: Json
  tools: Json
  note: string
  createdAt: string
  updatedAt: string
}

export interface AiProposal {
  id: string
  projectId: string
  sessionId: string
  targetEntityId: string | null
  entityType: string
  operation: string
  summary: string
  before: Json
  after: Json
  status: string
  createdAt: string
}

export interface AiMessage {
  id: string
  projectId: string
  sessionId: string
  role: string
  content: string
  attachments: Json
  proposals: Json
  createdAt: string
}

export interface Snapshot {
  project: Project
  entities: Entity[]
  links: EntityLink[]
  timeEntries: TimeEntry[]
  activity: ActivityLog[]
  maps: MapRecord[]
  recipes: CraftingRecipe[]
  aiMessages: AiMessage[]
  aiProposals: AiProposal[]
}
export interface ProjectStats {
  projectId: string
  entities: number
  tasks: number
  completed: number
  seconds: number
  milestone: string | null
  dueDate: string | null
}
export type SearchResult = Pick<
  Entity,
  'id' | 'entityType' | 'title' | 'summary'
>
export interface AppSettings {
  key: string
  value: Json
  updatedAt: string
}
export interface AssetInfo {
  filename: string
  size: number
}
