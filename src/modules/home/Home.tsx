import { useState } from 'react'
import {
  Plus,
  Upload,
  MoreHorizontal,
  ArrowRight,
  LockKeyhole,
  SlidersHorizontal,
  Copy,
  Trash2,
  Download,
  FolderOpen,
  ArrowDownWideNarrow,
} from 'lucide-react'
import { coverUrl } from '../../api/client'
import { countdown } from '../../state/catalog'
import type { Project, ProjectStats } from '../../types'
import { ProjectLogo } from '../../components/ProjectLogo'
import { Menu, SectionTitle } from '../../components/ui'

export type CardAction = 'edit' | 'duplicate' | 'export' | 'delete'
interface HomeProps {
  projects: Project[]
  stats: ProjectStats[]
  open: (p: Project) => void
  create: () => void
  importFile: () => void
  action: (a: CardAction, p: Project) => void
}
const actions = [
  ['open', '打开', FolderOpen],
  ['edit', '项目设置', SlidersHorizontal],
  ['duplicate', '复制项目', Copy],
  ['export', '导出项目', Download],
  ['delete', '删除项目', Trash2],
] as const

export default function Home({
  projects,
  stats,
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
  const openTasks = stats.reduce((sum, s) => sum + s.tasks - s.completed, 0)
  const totalEntities = stats.reduce((sum, s) => sum + s.entities, 0)
  return (
    <div className="page home">
      <header className="home-intro">
        <div className="eyebrow">
          <i />
          工作台
        </div>
        <h1>开始你的创作</h1>
        <p className="home-summary">
          <span>
            <b>{projects.length}</b> 个项目
          </span>{' '}
          ·{' '}
          <span>
            <b>{openTasks}</b> 个待办任务
          </span>{' '}
          ·{' '}
          <span>
            <b>{totalEntities}</b> 条设计内容
          </span>
        </p>
      </header>
      <div className="start-card">
        <button onClick={create}>
          <i>
            <Plus size={23} />
          </i>
          <span>
            <strong>新建项目</strong>
            <small>起个名字就能开始，其余的之后再补</small>
          </span>
          <ArrowRight size={16} />
        </button>
        <button onClick={importFile}>
          <i>
            <Upload size={19} />
          </i>
          <span>
            <strong>导入备份</strong>
            <small>从导出的 .gws.json 备份文件恢复项目</small>
          </span>
          <ArrowRight size={16} />
        </button>
      </div>
      <section className="project-collection">
        <header className="section-head">
          <SectionTitle count={projects.length}>我的项目</SectionTitle>
          {list.length > 1 && (
            <Menu label="项目排序" trigger={<ArrowDownWideNarrow size={16} />}>
              {(close) => (
                <>
                  {[
                    ['updated', '最近更新'],
                    ['name', '名称排序'],
                  ].map(([id, label]) => (
                    <button
                      key={id}
                      aria-pressed={id === sort}
                      onClick={() => {
                        setSort(id)
                        close()
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </>
              )}
            </Menu>
          )}
        </header>
        <div className="projects">
          {list.map((p) => {
            const s = stats.find((s) => s.projectId === p.id)
            const percent = s?.tasks
              ? Math.round((100 * s.completed) / s.tasks)
              : 0
            const milestone = [s?.milestone, s?.dueDate && countdown(s.dueDate)]
              .filter(Boolean)
              .join(' · ')
            return (
              <article className="project-card" key={p.id}>
                <button
                  className="project-art"
                  aria-label={'打开 ' + p.name}
                  onClick={() => open(p)}
                >
                  <img src={coverUrl(p)} alt="" />
                </button>
                <div className="card-content">
                  <ProjectLogo project={p} />
                  <button className="project-name" onClick={() => open(p)}>
                    {p.name}
                  </button>
                  <div className="chips">
                    {[...new Set([...p.genres, p.engine].filter(Boolean))].map(
                      (tag) => (
                        <span key={tag}>{tag}</span>
                      ),
                    )}
                  </div>
                  <p className="pitch">{p.pitch || '尚未填写项目简介'}</p>
                  <div className="project-progress">
                    <progress value={percent} max={100} aria-label="任务进度" />
                    <small>{percent}%</small>
                  </div>
                  <footer className="card-foot">
                    <span title={milestone}>
                      <b>{(s?.tasks ?? 0) - (s?.completed ?? 0)}</b> 个待办 ·{' '}
                      {milestone || '尚无里程碑'}
                    </span>
                    <Menu
                      label={p.name + ' · 更多'}
                      trigger={<MoreHorizontal size={16} />}
                    >
                      {(close) => (
                        <>
                          {actions.map(([key, label, Icon]) => (
                            <button
                              key={key}
                              className={key === 'delete' ? 'danger-text' : ''}
                              onClick={() => {
                                close()
                                if (key === 'open') open(p)
                                else action(key, p)
                              }}
                            >
                              <Icon size={14} />
                              {label}
                            </button>
                          ))}
                        </>
                      )}
                    </Menu>
                  </footer>
                </div>
              </article>
            )
          })}
          {!list.length && (
            <button className="empty-project" onClick={create}>
              <Plus size={17} />
              创建第一个项目
            </button>
          )}
        </div>
      </section>
      <footer className="privacy">
        <LockKeyhole size={14} />
        <span>
          项目保存在本地 SQLite 数据库中，绝不上传至任何服务器；API Key 经
          Windows DPAPI 加密，支持定期导出备份并通过 MCP 与外部 AI Agent
          实时联动。
        </span>
      </footer>
    </div>
  )
}
