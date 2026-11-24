import { createContext, useContext, useEffect, useState } from 'react'
import type {
  ActivityLog,
  Entity,
  EntityLink,
  MapRecord,
  Project,
  TimeEntry,
} from '../types'
export interface Workspace {
  project: Project
  entities: Entity[]
  times: TimeEntry[]
  activity: ActivityLog[]
  revision: number
  active?: TimeEntry
  save: (e: Entity) => Promise<void>
  saveMany: (
    items: Entity[],
    restore?: string[],
    trash?: string[],
  ) => Promise<void>
  impact: (id: string) => Promise<boolean>
  trash: (id: string) => Promise<void>
  links: EntityLink[]
  maps: MapRecord[]
  selected?: string
  close: () => void
  openEntity: (entity: Entity) => void
  run: (fn: () => Promise<unknown>) => Promise<void>
  inspect: (id: string) => void
  navigate: (mod: string, selected?: string) => void
  notify: (message: string) => void
  refresh: () => void
  aiSettings: () => void
  assistant: (prompt: string, focusedId?: string) => void
  smartImport: (mode: 'design' | 'bugs') => void
}
export const WorkspaceContext = createContext<Workspace | null>(null)
export function useWorkspace() {
  const ctx = useContext(WorkspaceContext)
  if (!ctx) throw Error('缺少项目上下文')
  return ctx
}
export function useNow(running = true) {
  const [now, set] = useState(Date.now)
  useEffect(() => {
    set(Date.now())
    if (running) {
      const timer = setInterval(() => set(Date.now()), 1000)
      return () => clearInterval(timer)
    }
  }, [running])
  return now
}
