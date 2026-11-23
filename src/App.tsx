import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent,
} from 'react'
import { flushSync } from 'react-dom'
import { Moon, Sun, Settings, PanelLeftOpen, X } from 'lucide-react'
import { api } from './api/client'
import {
  defaults,
  enabled,
  moduleFor,
  newEntity,
  newProject,
  routes,
  shortcutOf,
  themes,
  type Preferences,
} from './state/catalog'
import type {
  Project,
  ProjectStats,
  ActivityLog,
  Json,
  Entity,
  TimeEntry,
} from './types'
import Home, { type CardAction } from './modules/home/Home'
import ProjectPage from './modules/ProjectPage'
import { Sidebar } from './components/Sidebar'
import { Palette } from './components/Palette'
import { native } from './api/ai'
import {
  ExportModal,
  RestoreModal,
  ImportModal,
} from './modules/settings/ImportExportModal'
import type { AssistPrompt } from './components/AiPanel'
import { RecycleBin } from './components/Records'
import { Brand, Empty, IconButton, Modal } from './components/ui'
import { Settings as SettingsDialog } from './modules/settings/Settings'
import { ProjectForm, ModulesDialog } from './modules/settings/ProjectForm'

import { bugClosed, clockText, elapsed, stopTimer } from './state/planning'
import { useNow } from './state/workspace'

const AiPanel = lazy(() =>
  import('./components/AiPanel').then((m) => ({ default: m.AiPanel })),
)

function TimerPill({
  entry,
  title,
  stop,
}: {
  entry: TimeEntry
  title: string
  stop: () => void
}) {
  const now = useNow()
  return (
    <div className="timer-pill">
      <i className="timer-dot" />
      <span title={title}>{title}</span>
      <b>{clockText(elapsed(entry, now))}</b>
      <button onClick={stop}>停止</button>
    </div>
  )
}

type Dialog =
  | { type: 'create' | 'edit' | 'delete' | 'modules'; project: Project }
  | {
      type:
        | 'settings'
        | 'recycle'
        | 'search'
        | 'import'
        | 'ai-settings'
        | 'smart-design'
        | 'smart-bugs'
    }
  | { type: 'export'; projectId?: string }
  | null
function readRoute() {
  const parts = location.hash.replace(/^#\/?/, '').split('/')
  return {
    id: parts[0] === 'project' ? parts[1] : undefined,
    mod: parts[2] || 'overview',
    selected: parts[3],
  }
}
const home = () => {
  location.hash = '/'
}
function go(p: Project, mod?: string, selected?: string) {
  location.hash =
    '/project/' +
    p.id +
    '/' +
    (mod && enabled(p, mod)
      ? mod
      : (routes.find((m) => enabled(p, m.id))?.id ?? 'overview')) +
    (selected ? '/' + selected : '')
}
function readPreferences(raw: Json | undefined): Preferences {
  if (!raw || Array.isArray(raw) || typeof raw !== 'object') return defaults
  const stored = raw as unknown as Partial<Preferences>
  return {
    ...defaults,
    ...stored,
    theme:
      String(stored.theme) === 'nebula-glass'
        ? 'liquid-glass'
        : stored.theme && Object.hasOwn(themes, stored.theme)
          ? stored.theme
          : defaults.theme,
    shortcuts: { ...defaults.shortcuts, ...stored.shortcuts },
  }
}

function isDark(brightness: Preferences['brightness'], systemDark: boolean) {
  return brightness === 'dark' || (brightness === 'system' && systemDark)
}

export default function App() {
  const [route, setRoute] = useState(readRoute),
    [revision, refresh] = useState(0),
    [loaded, setLoaded] = useState(false)
  const [workspace, setWorkspace] = useState<{
    projects: Project[]
    stats: ProjectStats[]
    entities: Entity[]
    scope?: string
    times: TimeEntry[]
    timerTitle: string
    activity: ActivityLog[]
  }>({
    projects: [],
    stats: [],
    entities: [],
    times: [],
    timerTitle: '',
    activity: [],
  })
  const { projects, stats, activity } = workspace
  const [dialog, setDialog] = useState<Dialog>(null),
    [prompt, setPrompt] = useState<AssistPrompt>(),
    [undoIds, setUndoIds] = useState<string[]>([]),
    [ai, setAi] = useState(false),
    [aiLoaded, setAiLoaded] = useState(false),
    [collapsed, setCollapsed] = useState(() => window.innerWidth < 760),
    [notice, notify] = useState(''),
    [loadError, setLoadError] = useState('')
  const [prefs, setPrefs] = useState(defaults),
    prefRef = useRef(prefs),
    queue = useRef(Promise.resolve()),
    writes = useRef(0)
  const [systemDark, setSystemDark] = useState(
    () => matchMedia('(prefers-color-scheme: dark)').matches,
  )
  const dark = isDark(prefs.brightness, systemDark)
  const p = projects.find((p) => p.id === route.id),
    mod =
      p && enabled(p, route.mod)
        ? route.mod
        : (routes.find((m) => p && enabled(p, m.id))?.id ?? 'overview')
  const scrollArea = useRef<HTMLDivElement>(null)
  useEffect(() => {
    scrollArea.current?.scrollTo(0, 0)
  }, [p?.id, mod])
  const close = () => setDialog(null)
  const bump = useCallback(() => refresh((n) => n + 1), [])
  useEffect(() => {
    const fn = () => setRoute(readRoute())
    window.addEventListener('hashchange', fn)
    if (!location.hash) home()
    const media = matchMedia('(prefers-color-scheme: dark)'),
      change = () => setSystemDark(media.matches)
    media.addEventListener('change', change)
    let dead = false,
      stop: (() => void) | undefined
    api
      .subscribe((change) => {
        bump()
        if (change?.externalMcpCount)
          notify(
            `MCP Agent 同步了 ${change.externalMcpCount} 项改动 · 界面已实时刷新`,
          )
      })
      .then((off) => {
        if (dead) off()
        else stop = off
      })
      .catch((e) => notify(String(e)))
    return () => {
      dead = true
      stop?.()
      window.removeEventListener('hashchange', fn)
      media.removeEventListener('change', change)
    }
  }, [bump])
  useEffect(() => {
    let live = true
    async function load() {
      const [ps, s, settings] = await Promise.all([
        api.listProjects(),
        api.stats(),
        api.getSetting('appearance'),
      ])
      const [logs, entries, entities] = await Promise.all([
        Promise.all(ps.map((x) => api.listActivity(x.id))),
        Promise.all(ps.map((x) => api.listTimeEntries(x.id))),
        route.id ? api.listEntities(route.id) : Promise.resolve([] as Entity[]),
      ])
      const times = entries.flat(),
        running = times.find((t) => t.isRunning)
      let timerTitle = '不关联任务'
      if (running?.taskId)
        timerTitle = (
          entities.find((e) => e.id === running.taskId) ??
          (await api.getEntity(running.taskId))
        ).title
      if (live) {
        setWorkspace({
          projects: ps,
          stats: s,
          activity: logs
            .flat()
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
          entities,
          scope: route.id,
          times,
          timerTitle,
        })
        setLoadError('')
        setLoaded(true)
        if (!writes.current) {
          const stored = readPreferences(settings?.value)
          prefRef.current = stored
          setPrefs(stored)
        }
      }
    }
    load().catch((e) => {
      if (live) setLoadError(String(e))
    })
    return () => {
      live = false
    }
  }, [revision, route.id])
  useLayoutEffect(() => {
    const el = document.documentElement
    el.dataset.theme = prefs.theme
    el.dataset.brightness = dark ? 'dark' : 'light'
    el.style.colorScheme = dark ? 'dark' : 'light'
  }, [prefs.theme, dark])
  useEffect(() => {
    if (!notice || (undoIds.length && notice.startsWith('已导入 '))) return
    const timer = setTimeout(() => notify(''), 5000)
    return () => clearTimeout(timer)
  }, [notice, undoIds])
  function updatePrefs(
    patch: Partial<Preferences>,
    event?: MouseEvent<HTMLButtonElement>,
  ) {
    const previous = prefRef.current
    const value = { ...previous, ...patch }
    prefRef.current = value
    if (
      event &&
      isDark(previous.brightness, systemDark) !==
        isDark(value.brightness, systemDark) &&
      typeof document.startViewTransition === 'function' &&
      matchMedia('(prefers-reduced-motion: no-preference)').matches
    ) {
      const rect = event.currentTarget.getBoundingClientRect()
      const x = event.detail ? event.clientX : rect.left + rect.width / 2
      const y = event.detail ? event.clientY : rect.top + rect.height / 2
      const radius = Math.hypot(
        Math.max(x, innerWidth - x),
        Math.max(y, innerHeight - y),
      )
      const style = document.documentElement.style
      style.setProperty('--vt-x', x + 'px')
      style.setProperty('--vt-y', y + 'px')
      style.setProperty('--vt-radius', Math.ceil(radius) + 'px')
      // Commit the latest preference before WebView captures the new root.
      const transition = document.startViewTransition(() => {
        flushSync(() => setPrefs(prefRef.current))
      })
      // A second toggle or a hidden window can skip an in-flight animation.
      void transition.ready.catch(() => {})
    } else {
      setPrefs(value)
    }
    writes.current++
    queue.current = queue.current
      .then(() => api.saveSetting('appearance', value as unknown as Json))
      .catch((e) => notify(String(e)))
      .finally(() => {
        writes.current--
      })
  }
  useEffect(() => {
    function key(e: KeyboardEvent) {
      if (e.defaultPrevented || e.isComposing || e.repeat) return
      const chord = shortcutOf(e)
      if (dialog && dialog.type !== 'search') return
      if (chord === prefs.shortcuts.search) {
        e.preventDefault()
        setDialog((d) => (d?.type === 'search' ? null : { type: 'search' }))
      }
      if (!dialog && chord === prefs.shortcuts.ai) {
        e.preventDefault()
        setAi((a) => !a)
      }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [prefs.shortcuts, p, dialog])
  useEffect(() => {
    if (ai) setAiLoaded(true)
  }, [ai])
  const toggleBrightness = (event: MouseEvent<HTMLButtonElement>) =>
    updatePrefs(
      {
        brightness: isDark(prefRef.current.brightness, systemDark)
          ? 'light'
          : 'dark',
      },
      event,
    )
  function backup() {
    setDialog({ type: 'export' })
  }
  async function act(action: CardAction, project: Project) {
    if (action === 'export') {
      setDialog({ type: 'export', projectId: project.id })
    } else if (action === 'duplicate') {
      try {
        await api.duplicateProject(project.id)
        bump()
        notify('已复制项目')
      } catch (e) {
        notify(String(e))
      }
    } else setDialog({ type: action, project })
  }
  const save = async (project: Project) => {
    await api.saveProject(project)
    bump()
  }
  const edit = () => {
      if (p) setDialog({ type: 'edit', project: p })
    },
    add = () => {
      if (p) setDialog({ type: 'modules', project: p })
    },
    settings = () => setDialog({ type: 'settings' })
  const active = workspace.times.find((t) => t.isRunning)
  async function run(fn: () => Promise<unknown>) {
    try {
      await fn()
      bump()
    } catch (e) {
      notify(String(e))
    }
  }
  return (
    <div
      className={'studio ide ' + (p ? 'project-shell' : 'home-shell')}
      data-collapsed={collapsed}
    >
      {prefs.wallpaper && (
        <div
          className="wallpaper"
          style={{
            backgroundImage: 'url("' + api.assetUrl(prefs.wallpaper) + '")',
            filter: 'blur(' + prefs.blur + 'px)',
            opacity: 1 - prefs.fade / 100,
          }}
        />
      )}
      {!p && (
        <header className="home-header">
          <Brand />
          <div>
            <IconButton label="明暗切换" onClick={toggleBrightness}>
              {dark ? <Sun size={16} /> : <Moon size={16} />}
            </IconButton>
            <button onClick={settings}>
              <Settings size={15} />
              设置
            </button>
          </div>
        </header>
      )}
      {p && (
        <>
          <Sidebar
            project={p}
            projects={projects}
            route={mod}
            open={go}
            add={add}
            home={home}
            search={() => setDialog({ type: 'search' })}
            settings={settings}
            edit={edit}
            backup={backup}
            importFile={() =>
              setDialog({
                type: mod === 'testing' ? 'smart-bugs' : 'smart-design',
              })
            }
            recycle={() => setDialog({ type: 'recycle' })}
            assistant={() => setAi(!ai)}
            collapsed={collapsed}
            collapse={() => setCollapsed(true)}
            brightness={toggleBrightness}
            dark={dark}
            shortcuts={prefs.shortcuts}
            counts={{
              tasks: workspace.entities.filter(
                (e) => e.entityType === 'task' && e.status !== '已完成',
              ).length,
              testing: workspace.entities.filter(
                (e) => e.entityType === 'bug' && !bugClosed(e),
              ).length,
            }}
            timer={
              active && (
                <TimerPill
                  entry={active}
                  title={workspace.timerTitle}
                  stop={() => void run(() => stopTimer(active))}
                />
              )
            }
          />
          {collapsed && (
            <button
              className="expand-side"
              title="展开侧栏"
              aria-label="展开侧栏"
              onClick={() => setCollapsed(false)}
            >
              <PanelLeftOpen size={17} />
            </button>
          )}
        </>
      )}
      <div className="ai-slot" data-open={ai} inert={!ai}>
        {(ai || aiLoaded) && (
          <Suspense
            fallback={<aside className="ai-panel">正在打开 AI 助手…</aside>}
          >
            <AiPanel
              key={p?.id ?? 'home'}
              projectId={p?.id}
              shortcut={prefs.shortcuts.ai}
              module={mod}
              selected={route.selected}
              revision={revision}
              prompt={prompt}
              close={() => {
                setAi(false)
                setPrompt(undefined)
              }}
              settings={() => setDialog({ type: 'ai-settings' })}
            />
          </Suspense>
        )}
      </div>
      <main className="main">
        <div className="scroll-area" ref={scrollArea}>
          {loadError ? (
            <div className="page" role="alert">
              <h1>工作区读取失败</h1>
              <p>{loadError}</p>
              <button className="secondary" onClick={bump}>
                重试
              </button>
            </div>
          ) : !loaded ? (
            <Empty>正在打开工作区…</Empty>
          ) : p ? (
            workspace.scope === p.id ? (
              <ProjectPage
                key={p.id}
                p={p}
                mod={mod}
                revision={revision}
                entities={workspace.entities}
                times={workspace.times.filter((t) => t.projectId === p.id)}
                active={active}
                activity={activity.filter((a) => a.projectId === p.id)}
                selected={route.selected}
                inspect={(id) => go(p, mod, id)}
                close={() => go(p, mod)}
                navigate={(m, id) => go(p, m, id)}
                refresh={bump}
                run={run}
                notify={notify}
                smartImport={(mode) =>
                  setDialog({
                    type: mode === 'bugs' ? 'smart-bugs' : 'smart-design',
                  })
                }
                assistant={(value, focusedId) => {
                  setPrompt({ text: value, focusedId, projectId: p.id })
                  setAi(true)
                }}
                modules={add}
              />
            ) : (
              <Empty>正在打开项目…</Empty>
            )
          ) : (
            <Home
              projects={projects}
              stats={stats}
              open={go}
              action={(a, p) => void act(a, p)}
              create={() =>
                setDialog({ type: 'create', project: newProject() })
              }
              importFile={() => setDialog({ type: 'import' })}
            />
          )}
        </div>
      </main>
      {(dialog?.type === 'create' || dialog?.type === 'edit') && (
        <ProjectForm
          key={dialog.project.id}
          initial={dialog.project}
          isNew={dialog.type === 'create'}
          onClose={close}
          onSave={save}
          onDelete={() =>
            setDialog({ type: 'delete', project: dialog.project })
          }
        />
      )}
      {dialog?.type === 'delete' && (
        <Modal title="删除项目" onClose={close}>
          <div className="form-body">
            <p>永久删除「{dialog.project.name}」及其全部条目、工时和记录？</p>
          </div>
          <footer className="modal-footer">
            <button className="secondary" onClick={close}>
              取消
            </button>
            <button
              className="danger"
              onClick={async () => {
                try {
                  await api.deleteProject(dialog.project.id)
                  if (p?.id === dialog.project.id) home()
                  bump()
                  close()
                } catch (e) {
                  notify(String(e))
                }
              }}
            >
              永久删除
            </button>
          </footer>
        </Modal>
      )}
      {dialog?.type === 'modules' && (
        <ModulesDialog p={dialog.project} onClose={close} onSave={save} />
      )}
      {(dialog?.type === 'settings' || dialog?.type === 'ai-settings') && (
        <SettingsDialog
          initialTab={dialog.type === 'ai-settings' ? 'AI API Key' : '外观'}
          restore={() => setDialog({ type: 'import' })}
          smartImport={
            projects.length
              ? () => setDialog({ type: 'smart-design' })
              : undefined
          }
          prefs={prefs}
          update={updatePrefs}
          stats={stats}
          onClose={close}
          bin={() => setDialog({ type: 'recycle' })}
          backup={backup}
        />
      )}
      {dialog?.type === 'recycle' && (
        <RecycleBin
          projectId={p?.id ?? null}
          revision={revision}
          onClose={close}
        />
      )}
      {dialog?.type === 'search' && (
        <Palette
          projects={projects}
          current={p}
          revision={revision}
          onClose={close}
          open={(r) => {
            const target = projects.find((x) => x.id === r.projectId)
            if (target) go(target, moduleFor(r.entityType)?.id, r.id)
            close()
          }}
          create={async (type, title) => {
            if (type === 'project') {
              setDialog({ type: 'create', project: newProject(title) })
              return
            }
            if (!p) return
            const e = newEntity(
              p.id,
              type,
              title || '新' + (type === 'task' ? '任务' : '文档'),
            )
            await api.saveEntity(e)
            bump()
            go(p, moduleFor(type)?.id, e.id)
            close()
          }}
        />
      )}
      {dialog?.type === 'export' && (
        <ExportModal
          projects={projects}
          initial={dialog.projectId ?? p?.id}
          onClose={close}
          done={notify}
        />
      )}
      {dialog?.type === 'import' && (
        <RestoreModal
          onClose={close}
          onRestore={(ps) => {
            close()
            bump()
            if (ps[0]) go(ps[0])
            notify('已恢复 ' + ps.length + ' 个项目')
          }}
        />
      )}
      {projects.length > 0 &&
        (dialog?.type === 'smart-design' || dialog?.type === 'smart-bugs') && (
          <ImportModal
            projects={projects}
            initialId={p?.id ?? projects[0].id}
            initial={dialog.type === 'smart-bugs' ? 'bugs' : 'design'}
            onClose={close}
            imported={(ids, target) => {
              if (target.id !== p?.id) go(target)
              setUndoIds(ids)
              close()
              bump()
              notify('已导入 ' + ids.length + ' 条内容')
            }}
          />
        )}
      {notice && (
        <div className="toast" role="status">
          {notice}
          {undoIds.length > 0 && notice.startsWith('已导入 ') && (
            <button
              onClick={() =>
                void run(async () => {
                  await native('undo_import_batch', { createdIds: undoIds })
                  setUndoIds([])
                  notify('已撤销导入')
                })
              }
            >
              撤销导入
            </button>
          )}
          <IconButton label="关闭通知" onClick={() => notify('')}>
            <X size={14} />
          </IconButton>
        </div>
      )}
    </div>
  )
}
