import { useState } from 'react'
import {
  Plus,
  Import,
  ArrowUpRight,
  MoreHorizontal,
  FolderOpen,
  ListChecks,
  Clock3,
  LibraryBig,
  FlagTriangleRight,
  SlidersHorizontal,
  Copy,
  Trash2,
  ArrowRight,
  CheckCheck,
  CalendarDays,
} from 'lucide-react'
import { coverUrl } from '../../api/client'
import { countdown, stampDate } from '../../state/catalog'
import type { Project, ProjectStats, ActivityLog } from '../../types'
import { Menu, SectionTitle, Empty } from '../../components/ui'

export type CardAction = 'edit' | 'duplicate' | 'delete'
export interface HomeProps {
  projects: Project[]
  stats: ProjectStats[]
  activity: ActivityLog[]
  open: (p: Project) => void
  create: () => void
  importFile: () => void
  action: (a: CardAction, p: Project) => void
}
export function Stats({
  projects,
  stats,
}: {
  projects: number
  stats: ProjectStats[]
}) {
  const total = (key: 'entities' | 'tasks' | 'completed' | 'seconds') =>
    stats.reduce((sum, s) => sum + s[key], 0)
  const tiles = [
    {
      label: '创作项目',
      value: projects,
      unit: '个',
      icon: FolderOpen,
      color: 'clay',
    },
    {
      label: '创作条目',
      value: total('entities'),
      unit: '条',
      icon: LibraryBig,
      color: 'blue',
    },
    {
      label: '已完成任务',
      value: total('completed'),
      unit: '/ ' + total('tasks'),
      icon: ListChecks,
      color: 'green',
    },
    {
      label: '累计工时',
      value: Math.round(total('seconds') / 360) / 10,
      unit: '小时',
      icon: Clock3,
      color: 'gold',
    },
  ]
  return (
    <div className="stats-grid">
      {tiles.map(({ label, value, unit, icon: Icon, color }) => (
        <div className="stat" key={label}>
          <span className={'stat-icon ' + color}>
            <Icon size={19} />
          </span>
          <div>
            <span className="stat-label">{label}</span>
            <div className="stat-value">
              {value}
              <small>{unit}</small>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
export function ActivityList({
  rows,
  projects,
}: {
  rows: ActivityLog[]
  projects: Project[]
}) {
  return (
    <div className="panel activity-panel">
      <SectionTitle>最近动态</SectionTitle>
      {rows.length ? (
        rows.slice(0, 4).map((r) => (
          <div key={r.id} className="activity-line">
            <span className="activity-icon">
              {r.action === 'create' ? (
                <Plus size={14} />
              ) : (
                <CheckCheck size={14} />
              )}
            </span>
            <div>
              <strong>{r.summary}</strong>
              <small>{projects.find((p) => p.id === r.projectId)?.name}</small>
            </div>
            <time>{stampDate(r.createdAt)}</time>
          </div>
        ))
      ) : (
        <Empty>还没有项目动态</Empty>
      )}
    </div>
  )
}
export default function Home({
  projects,
  stats,
  activity,
  open,
  create,
  importFile,
  action,
}: HomeProps) {
  const [sort, setSort] = useState('updated')
  const list = [...projects].sort((a, b) =>
    sort === 'name'
      ? a.name.localeCompare(b.name, 'zh-CN')
      : b.updatedAt.localeCompare(a.updatedAt),
  )
  return (
    <div className="page home">
      <div className="page-heading">
        <div>
          <div className="date-line">
            <CalendarDays size={14} />
            {new Date().toLocaleDateString('zh-CN', {
              year: 'numeric',
              month: 'long',
              day: 'numeric',
              weekday: 'long',
            })}
          </div>
          <h1>GameWorkSpace · 创作工作台</h1>
        </div>
        <div className="actions">
          <button className="secondary" onClick={importFile}>
            <Import size={16} />
            导入备份
          </button>
          <button className="primary" onClick={create}>
            <Plus size={17} />
            新建项目
          </button>
        </div>
      </div>
      <Stats projects={projects.length} stats={stats} />
      <div className="home-content">
        <section className="project-collection">
          <div className="section-head">
            <SectionTitle count={projects.length}>我的项目</SectionTitle>
            <select
              aria-label="项目排序"
              className="sort"
              value={sort}
              onChange={(e) => setSort(e.target.value)}
            >
              <option value="updated">最近更新</option>
              <option value="name">名称排序</option>
            </select>
          </div>
          <div className="projects">
            {list.map((p) => {
              const s = stats.find((s) => s.projectId === p.id),
                percent = s?.tasks
                  ? Math.round((s.completed / s.tasks) * 100)
                  : 0
              return (
                <article className="project-card" key={p.id}>
                  <button
                    className="project-art"
                    onClick={() => open(p)}
                    aria-label={'打开 ' + p.name}
                  >
                    <img src={coverUrl(p)} alt={'项目封面 · ' + p.name} />
                    <span className="art-enter">
                      <ArrowUpRight size={18} />
                    </span>
                  </button>
                  <div className="card-content">
                    <div className="card-meta">
                      <span className="engine">
                        <i />
                        {p.engine || '自定义引擎'}
                      </span>
                      <Menu
                        label={p.name + '的操作'}
                        trigger={<MoreHorizontal size={19} />}
                      >
                        {(close) => (
                          <>
                            {(
                              [
                                ['edit', '项目设置', SlidersHorizontal],
                                ['duplicate', '复制项目', Copy],
                                ['delete', '删除项目', Trash2],
                              ] as const
                            ).map(([key, label, Icon]) => (
                              <button
                                key={key}
                                className={
                                  key === 'delete' ? 'danger-text' : ''
                                }
                                onClick={() => {
                                  close()
                                  action(key, p)
                                }}
                              >
                                <Icon size={15} />
                                {label}
                              </button>
                            ))}
                          </>
                        )}
                      </Menu>
                    </div>
                    <button className="project-name" onClick={() => open(p)}>
                      {p.name}
                    </button>
                    <p className="pitch">{p.pitch || '尚未填写项目简介'}</p>
                    <div className="chips">
                      {[...p.genres, ...p.platforms].slice(0, 4).map((g) => (
                        <span key={g}>{g}</span>
                      ))}
                    </div>
                    <div className="progress-label">
                      <span>任务进度</span>
                      <b>{percent}%</b>
                    </div>
                    <progress value={percent} max={100} aria-label="任务进度" />
                    <div className="card-foot">
                      <span>
                        <FlagTriangleRight size={14} />
                        {s?.dueDate ? countdown(s.dueDate) : '尚无里程碑'}
                      </span>
                      <button className="text-action" onClick={() => open(p)}>
                        进入项目
                        <ArrowRight size={15} />
                      </button>
                    </div>
                  </div>
                </article>
              )
            })}
            {!list.length && (
              <button className="empty-project" onClick={create}>
                <Plus /> 创建第一个项目
              </button>
            )}
          </div>
        </section>
        <div className="overview-grid">
          <div className="panel">
            <SectionTitle>即将到来的里程碑</SectionTitle>
            {stats.filter((s) => s.dueDate).length ? (
              stats
                .filter((s) => s.dueDate)
                .sort((a, b) => a.dueDate!.localeCompare(b.dueDate!))
                .slice(0, 4)
                .map((s) => (
                  <button
                    key={s.projectId}
                    className="milestone-line"
                    onClick={() =>
                      open(projects.find((p) => p.id === s.projectId)!)
                    }
                  >
                    <span className="date-tile">
                      <small>{Number(s.dueDate!.slice(5, 7))} 月</small>
                      <b>{s.dueDate!.slice(-2)}</b>
                    </span>
                    <span>
                      <strong>{s.milestone}</strong>
                      <small>
                        {projects.find((p) => p.id === s.projectId)?.name}
                      </small>
                    </span>
                    <span className="days">{countdown(s.dueDate!)}</span>
                  </button>
                ))
            ) : (
              <Empty>还没有安排里程碑</Empty>
            )}
          </div>
          <ActivityList rows={activity} projects={projects} />
        </div>
      </div>
    </div>
  )
}
