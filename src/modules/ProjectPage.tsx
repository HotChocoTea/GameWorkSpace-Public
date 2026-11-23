import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { api } from '../api/client'
import { enabled, moduleFor } from '../state/catalog'
import QuestsView from './narrative/QuestsView'
import ScenesView from './narrative/ScenesView'
import GraphView from './narrative/GraphView'
import ConceptArtView from './world/ConceptArtView'
import { WorkspaceContext, type Workspace } from '../state/workspace'
import type { Project, Entity, MapRecord, EntityLink } from '../types'
import { EntityInspector } from '../components/EntityInspector'
import OverviewModule from './overview/OverviewModule'
import TasksView from './planning/TasksView'
import RoadmapView from './planning/RoadmapView'
import CalendarView from './planning/CalendarView'
import TimeView from './planning/TimeView'
import BugsView from './testing/BugsView'
import DevlogView from './testing/DevlogView'
import DocsView from './world/DocsView'
import LoreView from './world/LoreView'
import CharactersView from './world/CharactersView'
import LocationsView from './world/LocationsView'
import FactionsView from './world/FactionsView'
import VehiclesView from './world/VehiclesView'
import InventoryView from './world/InventoryView'
import CollectiblesView from './world/CollectiblesView'

const MapMakerView = lazy(() => import('./narrative/MapMakerView'))

interface Props extends Omit<
  Workspace,
  'project' | 'save' | 'saveMany' | 'trash' | 'links' | 'maps' | 'openEntity'
> {
  p: Project
  mod: string
  selected?: string
  close: () => void
  modules: () => void
  refresh: () => void
}
export default function ProjectPage(props: Props) {
  const {
    p,
    mod,
    revision,
    entities,
    selected,
    close,
    inspect,
    navigate,
    notify,
  } = props
  const [optimistic, setOptimistic] = useState(new Map<string, Entity>())
  const [maps, setMaps] = useState<MapRecord[]>([]),
    [links, setLinks] = useState<EntityLink[]>([])
  const queue = useRef(Promise.resolve())
  const writing = useRef(new Map<string, Entity>())
  useEffect(() => {
    let live = true
    Promise.all([api.listMaps(p.id), api.listLinks(p.id)])
      .then(([m, l]) => {
        if (live) {
          setMaps(m)
          setLinks(l)
        }
      })
      .catch((e) => {
        if (live) notify(String(e))
      })
    return () => {
      live = false
    }
  }, [p.id, revision, notify])
  useEffect(() => {
    setOptimistic((prev) => {
      const next = new Map(prev)
      for (const e of entities) {
        const pending = next.get(e.id)
        if (
          pending &&
          !writing.current.has(e.id) &&
          e.updatedAt >= pending.updatedAt
        )
          next.delete(e.id)
      }
      return next.size === prev.size ? prev : next
    })
  }, [entities])
  async function saveMany(
    items: Entity[],
    restore: string[] = [],
    removed: string[] = [],
  ) {
    const updated = items.map((item) => ({
      ...item,
      updatedAt: new Date().toISOString(),
    }))
    updated.forEach((item) => writing.current.set(item.id, item))
    setOptimistic((prev) => {
      const next = new Map(prev)
      updated.forEach((item) => next.set(item.id, item))
      return next
    })
    const op = queue.current.then(() =>
      updated.length === 1 && !restore.length && !removed.length
        ? api.saveEntity(updated[0])
        : api.saveBatch(updated, [], restore, removed),
    )
    queue.current = op.catch(() => {})
    try {
      await op
      if (removed.length)
        setOptimistic((prev) => {
          const next = new Map(prev)
          removed.forEach((id) => next.delete(id))
          return next
        })
      props.refresh()
    } catch (e) {
      setOptimistic((prev) => {
        const next = new Map(prev)
        updated.forEach((item) => {
          if (next.get(item.id) === item) next.delete(item.id)
        })
        return next
      })
      throw e
    } finally {
      for (const item of updated) {
        if (writing.current.get(item.id) === item)
          writing.current.delete(item.id)
      }
    }
  }
  const save = (item: Entity) => saveMany([item])
  async function trash(id: string) {
    const op = queue.current.then(() => api.deleteEntity(id))
    queue.current = op.catch(() => {})
    await op
    setOptimistic((prev) => {
      const next = new Map(prev)
      next.delete(id)
      return next
    })
    props.refresh()
  }
  function openEntity(item: Entity) {
    const target = moduleFor(item.entityType)?.id
    if (target && enabled(p, target)) navigate(target, item.id)
    else inspect(item.id)
  }
  const merged = new Map(entities.map((e) => [e.id, e]))
  for (const [id, e] of optimistic) merged.set(id, e)
  const items = [...merged.values()],
    entity = selected ? merged.get(selected) : undefined
  const graph = links.filter(
    (l) => merged.has(l.sourceId) && merged.has(l.targetId),
  )
  const worldViews: Record<string, React.ReactNode> = {
    art: <ConceptArtView />,
    quests: <QuestsView />,
    scenes: <ScenesView />,
    docs: <DocsView />,
    lore: <LoreView />,
    characters: <CharactersView />,
    locations: <LocationsView />,
    factions: <FactionsView />,
    vehicles: <VehiclesView />,
    inventory: <InventoryView />,
    collectibles: <CollectiblesView />,
  }
  const views: Record<string, React.ReactNode> = {
    ...worldViews,
    graph: <GraphView />,
    mapmaker: (
      <Suspense fallback={<p className="empty">正在打开地图…</p>}>
        <MapMakerView />
      </Suspense>
    ),
    overview: <OverviewModule />,
    tasks: <TasksView />,
    roadmap: <RoadmapView />,
    calendar: <CalendarView />,
    time: <TimeView />,
    testing: <BugsView />,
    devlog: <DevlogView selected={selected} select={inspect} />,
  }
  return (
    <WorkspaceContext.Provider
      value={{
        ...props,
        project: p,
        entities: items,
        save,
        saveMany,
        trash,
        links: graph,
        maps,
        openEntity,
      }}
    >
      <div className="project-canvas" key={mod} data-view={mod}>
        {enabled(p, mod) ? (
          views[mod]
        ) : (
          <button className="primary" onClick={props.modules}>
            添加项目功能
          </button>
        )}
      </div>
      {entity &&
        !(
          (mod === 'devlog' || mod in worldViews) &&
          moduleFor(entity.entityType)?.id === mod
        ) && <EntityInspector key={entity.id} entity={entity} close={close} />}
    </WorkspaceContext.Provider>
  )
}
