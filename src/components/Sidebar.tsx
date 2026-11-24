import {
  useLayoutEffect,
  useRef,
  type MouseEventHandler,
  type ReactNode,
} from 'react'
import {
  ChevronsUpDown,
  Moon,
  Sun,
  PanelLeftClose,
  Plus,
  Search,
  Settings,
  Sparkles,
  Trash2,
  Download,
  Upload,
  FolderOpen,
} from 'lucide-react'
import { enabled, groups, type Preferences } from '../state/catalog'
import type { Project } from '../types'
import { ProjectLogo } from './ProjectLogo'
import { IconButton, Menu } from './ui'

interface SidebarProps {
  project: Project
  projects: Project[]
  route: string
  open: (p: Project, route?: string) => void
  home: () => void
  add: () => void
  edit: () => void
  sync: () => void
  backup: () => void
  importFile: () => void
  search: () => void
  assistant: () => void
  settings: () => void
  recycle: () => void
  collapse: () => void
  brightness: MouseEventHandler<HTMLButtonElement>
  dark: boolean
  collapsed: boolean
  shortcuts: Preferences['shortcuts']
  counts: Record<string, number>
  timer: ReactNode
}

export function Sidebar(props: SidebarProps) {
  const { project, projects, open, shortcuts } = props
  const navRef = useRef<HTMLElement>(null)
  const indicatorRef = useRef<HTMLSpanElement>(null)
  const enabledModules = project.enabledModules.join(' ')

  useLayoutEffect(() => {
    const nav = navRef.current
    const indicator = indicatorRef.current
    if (!nav || !indicator) return
    const active = nav.querySelector<HTMLButtonElement>('[aria-current="page"]')
    if (!active) {
      indicator.hidden = true
      return
    }
    const list = active.closest<HTMLElement>('.module-groups')
    // Preserve the pinned overview while bringing deep-linked modules into view.
    if (list) {
      const row = active.getBoundingClientRect()
      const viewport = list.getBoundingClientRect()
      if (row.top < viewport.top) list.scrollTop += row.top - viewport.top
      else if (row.bottom > viewport.bottom)
        list.scrollTop += row.bottom - viewport.bottom
    }
    const position = (glide: boolean) => {
      const row = active.getBoundingClientRect()
      const origin = nav.getBoundingClientRect()
      const viewport = list?.getBoundingClientRect() ?? origin
      const clippedTop = Math.max(0, viewport.top - row.top)
      const clippedBottom = Math.max(0, row.bottom - viewport.bottom)
      const transform = `translate3d(${row.left - origin.left}px, ${row.top - origin.top}px, 0px)`
      // Scroll and resize track the row immediately. Only route changes glide.
      if (
        indicator.style.transform !== transform ||
        indicator.style.height !== row.height + 'px'
      ) {
        indicator.dataset.glide = String(glide && !indicator.hidden)
        indicator.style.transform = transform
        indicator.style.height = row.height + 'px'
      }
      indicator.hidden = clippedTop + clippedBottom >= row.height
      indicator.style.width = row.width + 'px'
      indicator.style.clipPath =
        clippedTop || clippedBottom
          ? `inset(${clippedTop}px 0 ${clippedBottom}px)`
          : ''
    }
    position(true)
    const track = () => position(false)
    const resize = new ResizeObserver(track)
    resize.observe(nav)
    resize.observe(active)
    if (list) resize.observe(list)
    list?.addEventListener('scroll', track, { passive: true })
    return () => {
      resize.disconnect()
      list?.removeEventListener('scroll', track)
    }
  }, [props.route, project.id, enabledModules])

  function navItem(m: (typeof groups)[number]['items'][number]) {
    return (
      <button
        key={m.id}
        className="nav-item"
        data-module={m.id}
        aria-current={props.route === m.id ? 'page' : undefined}
        onClick={() => open(project, m.id)}
      >
        <i className="nav-tile">
          <m.icon size={17} />
        </i>
        {m.label}
        {props.counts[m.id] !== undefined && (
          <small>{props.counts[m.id]}</small>
        )}
      </button>
    )
  }
  const overview = groups[0].items[0]
  return (
    <aside className="project-sidebar" inert={props.collapsed}>
      <div className="side-inner">
        <div className="project-switch">
          <Menu
            label="切换项目"
            trigger={
              <>
                <ProjectLogo project={project} />
                <span>
                  <strong>{project.name}</strong>
                  <small>{project.genres.join(' · ')}</small>
                </span>
                <ChevronsUpDown size={14} />
              </>
            }
          >
            {(close) => {
              const choose = (action: () => void) => () => {
                close()
                action()
              }
              return (
                <>
                  {projects.length > 1 && <small>切换其他项目</small>}
                  {projects
                    .filter((p) => p.id !== project.id)
                    .map((p) => (
                      <button key={p.id} onClick={choose(() => open(p))}>
                        {p.name}
                      </button>
                    ))}
                  <button onClick={choose(props.home)}>
                    <FolderOpen size={15} />
                    所有项目
                  </button>
                  <button onClick={choose(props.edit)}>
                    <Settings size={15} />
                    项目设置
                  </button>
                  <button onClick={choose(props.sync)}>
                    <FolderOpen size={15} />
                    引擎数据同步
                  </button>
                  <button onClick={choose(props.backup)}>
                    <Download size={15} />
                    导出项目
                  </button>
                  <button onClick={choose(props.importFile)}>
                    <Upload size={15} />
                    AI 智能导入
                  </button>
                </>
              )
            }}
          </Menu>
        </div>
        <button className="side-search" onClick={props.search}>
          <Search size={16} />
          搜索<kbd>{shortcuts.search.replace('+', ' ')}</kbd>
        </button>
        {props.timer}
        <nav ref={navRef} className="module-nav" aria-label="项目模块">
          <span
            ref={indicatorRef}
            className="nav-ind"
            aria-hidden="true"
            hidden
          />
          {enabled(project, overview.id) && navItem(overview)}
          <div className="module-groups">
            {groups.slice(1).map((group) => {
              const visible = group.items.filter((m) => enabled(project, m.id))
              if (!visible.length) return null
              return (
                <section key={group.name}>
                  <h2>{group.name}</h2>
                  {visible.map(navItem)}
                </section>
              )
            })}
          </div>
        </nav>
        <footer className="side-utilities">
          <button onClick={props.add}>
            <Plus size={16} />
            添加功能
          </button>
          <button className="side-ai" onClick={props.assistant}>
            <Sparkles size={16} />
            AI 助手<kbd>{shortcuts.ai}</kbd>
          </button>
          <div className="side-tools">
            <IconButton label="收起侧栏" onClick={props.collapse}>
              <PanelLeftClose size={16} />
            </IconButton>
            <IconButton label="设置" onClick={props.settings}>
              <Settings size={16} />
            </IconButton>
            <IconButton label="明暗切换" onClick={props.brightness}>
              {props.dark ? <Sun size={16} /> : <Moon size={16} />}
            </IconButton>
            <IconButton label="回收站" onClick={props.recycle}>
              <Trash2 size={16} />
            </IconButton>
          </div>
        </footer>
      </div>
    </aside>
  )
}
