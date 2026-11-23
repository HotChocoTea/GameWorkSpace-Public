import {
  AppWindow,
  Compass,
  Layers3,
  ListTodo,
  PanelsTopLeft,
  Plus,
  ShieldCheck,
} from 'lucide-react'
import { groups, enabled } from '../state/catalog'
import type { Project } from '../types'
const icons = [PanelsTopLeft, ListTodo, Layers3, Compass, ShieldCheck]
export function Sidebar({
  project,
  route,
  open,
  add,
  home,
}: {
  project?: Project
  route: string
  open: (p: Project, mod: string) => void
  add: () => void
  home: () => void
}) {
  return (
    <nav className="activity-rail" aria-label="工作区导航">
      {project ? (
        groups.map((g, i) => {
          const Icon = icons[i],
            first = g.items.find((m) => enabled(project, m.id)),
            active = g.items.some((m) => m.id === route)
          return (
            <button
              key={g.name}
              className={active ? 'active' : ''}
              disabled={!first}
              onClick={() => first && open(project, first.id)}
            >
              <Icon size={20} />
              <span>{g.name}</span>
            </button>
          )
        })
      ) : (
        <button className="active" onClick={home}>
          <AppWindow size={20} />
          工作台
        </button>
      )}
      {project && (
        <button className="rail-bottom" onClick={add}>
          <Plus size={20} />
          功能
        </button>
      )}
    </nav>
  )
}
