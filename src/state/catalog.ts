import {
  LayoutDashboard,
  Columns3,
  Milestone,
  CalendarDays,
  Timer,
  BookOpen,
  LibraryBig,
  Images,
  Users,
  MapPin,
  Flag,
  Ship,
  Package,
  Gem,
  Route,
  MessagesSquare,
  Network,
  Map,
  Bug,
  NotebookPen,
  type LucideIcon,
} from 'lucide-react'
import type { Project, Entity } from '../types'

interface Module {
  id: string
  label: string
  icon: LucideIcon
  types: string[]
}
const entry = (
  id: string,
  label: string,
  icon: LucideIcon,
  ...types: string[]
): Module => ({ id, label, icon, types })
export const groups = [
  {
    name: '总览',
    items: [entry('overview', '概览', LayoutDashboard)],
  },
  {
    name: '规划与制作',
    items: [
      entry('tasks', '任务', Columns3, 'task'),
      entry('roadmap', '路线图', Milestone, 'phase', 'milestone'),
      entry('calendar', '日历', CalendarDays, 'calendar_event'),
      entry('time', '工时', Timer),
    ],
  },
  {
    name: '文档与世界',
    items: [
      entry('docs', '文档', BookOpen, 'doc'),
      entry('lore', '设定集', LibraryBig, 'lore'),
      entry('art', '概念图', Images, 'concept_art'),
      entry('characters', '角色', Users, 'character'),
      entry('locations', '地点', MapPin, 'location'),
      entry('factions', '阵营', Flag, 'faction'),
      entry('vehicles', '载具', Ship, 'vehicle'),
      entry('inventory', '物品', Package, 'item'),
      entry('collectibles', '收集品', Gem, 'collectible'),
    ],
  },
  {
    name: '剧情与地图',
    items: [
      entry('quests', '任务线', Route, 'quest'),
      entry('scenes', '场景对白', MessagesSquare, 'scene'),
      entry('graph', '关系网', Network),
      entry('mapmaker', '地图设计', Map),
    ],
  },
  {
    name: '测试与记录',
    items: [
      entry('testing', 'Bug 追踪', Bug, 'bug'),
      entry('devlog', '开发日志', NotebookPen, 'devlog'),
    ],
  },
]
export const modules = groups.flatMap((g) => g.items)
export const routes = modules
export const moduleFor = (type: string) =>
  routes.find((m) => m.types.includes(type))
export const enabled = (p: Project, mod: string) =>
  p.enabledModules.includes(mod)
export const presets: Record<string, string> = {
  'lighthouse-v2': '星海灯塔',
  lighthouse: '星空灯塔',
  castle: '雾中古堡',
  city: '霓虹之城',
  nebula: '金色星云',
}
export const themes = {
  'warm-paper': '暖纸',
  'liquid-glass': '液态玻璃',
  'deep-sea': '深海',
  'ink-white': '墨白',
}
export type Theme = keyof typeof themes
export interface Preferences {
  theme: Theme
  brightness: 'system' | 'light' | 'dark'
  wallpaper: string | null
  wallpapers: string[]
  blur: number
  fade: number
  shortcuts: { search: string; ai: string }
}
export const defaults: Preferences = {
  theme: 'warm-paper',
  brightness: 'system',
  wallpaper: null,
  wallpapers: [],
  blur: 3,
  fade: 80,
  shortcuts: { search: 'Ctrl+K', ai: 'F2' },
}
export function newProject(name = ''): Project {
  const stamp = new Date().toISOString()
  return {
    id: crypto.randomUUID(),
    name,
    pitch: '',
    genres: [],
    engine: 'Unity',
    platforms: ['PC'],
    coverPreset: 'lighthouse-v2',
    coverAsset: null,
    logoAsset: null,
    enabledModules: modules.map((m) => m.id),
    currentPhaseId: null,
    createdAt: stamp,
    updatedAt: stamp,
  }
}
export function newEntity(
  projectId: string,
  entityType: string,
  title: string,
): Entity {
  const stamp = new Date().toISOString()
  return {
    id: crypto.randomUUID(),
    projectId,
    entityType,
    title,
    subtitle: '',
    summary: '',
    status: entityType === 'task' ? '待办' : '',
    tags: [],
    body: '',
    data: {},
    sortOrder: Date.now(),
    deletedAt: null,
    createdAt: stamp,
    updatedAt: stamp,
  }
}
export const stampDate = (d: string) =>
  new Date(d).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
export function countdown(d: string) {
  const now = new Date()
  now.setHours(0, 0, 0, 0)
  const days = Math.round(
    (new Date(d + 'T00:00:00').getTime() - now.getTime()) / 86400000,
  )
  return days === 0 ? '今天' : days > 0 ? `还有 ${days} 天` : `逾期 ${-days} 天`
}
export function shortcutOf(e: KeyboardEvent | React.KeyboardEvent) {
  return [
    ...(e.ctrlKey || e.metaKey ? ['Ctrl'] : []),
    ...(e.altKey ? ['Alt'] : []),
    ...(e.shiftKey ? ['Shift'] : []),
    e.key.length === 1 ? e.key.toUpperCase() : e.key,
  ].join('+')
}
