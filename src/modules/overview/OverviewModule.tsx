import { useMemo, useState } from 'react'
import {
  ArrowRight,
  Bug,
  Check,
  SquareCheck,
  Timer,
  LayoutDashboard,
  ChartColumn,
  Sparkles,
} from 'lucide-react'
import { api } from '../../api/client'
import {
  asDay,
  bugClosed,
  bugStatus,
  columns,
  dayKey,
  elapsed,
  field,
  hours,
  monday,
  secondsIn,
  shift,
} from '../../state/planning'
import { useWorkspace } from '../../state/workspace'
import { BarChart } from '../../components/PlanningUI'
import { ProjectLogo } from '../../components/ProjectLogo'
import { stampDate, countdown } from '../../state/catalog'
import type { Entity } from '../../types'

function Distribution({ rows }: { rows: string[] }) {
  const count = new Map<string, number>()
  rows.forEach((s) => count.set(s, (count.get(s) ?? 0) + 1))
  let position = 0
  const colors = [
    '#5276cf',
    '#16a383',
    '#e7a741',
    '#956fc0',
    '#ea6c72',
    '#6d839a',
  ]
  return (
    <div className="stack">
      <svg
        className="distribution"
        viewBox="0 0 100 10"
        preserveAspectRatio="none"
        role="img"
        aria-label={[...count].map(([s, n]) => s + ' ' + n).join('，')}
      >
        {[...count].map(([s, n], i) => {
          const x = position,
            width = (100 * n) / rows.length
          position += width
          return (
            <rect
              key={s}
              x={x}
              width={width}
              height="10"
              fill={colors[i % colors.length]}
            >
              <title>
                {s} · {n}
              </title>
            </rect>
          )
        })}
      </svg>
      <div className="legend">
        {[...count].map(([s, n], i) => (
          <span key={s}>
            <i style={{ background: colors[i % colors.length] }} />
            {s} · {n}
          </span>
        ))}
        {!rows.length && <small>暂无记录</small>}
      </div>
    </div>
  )
}
export default function OverviewModule() {
  const { project, entities, times, activity, inspect, navigate, assistant } =
    useWorkspace()
  const [analytics, tab] = useState(false),
    [allActivity, expand] = useState(false)
  const today = dayKey(),
    now = Date.now(),
    week = monday(asDay(today))
  const tasks = entities.filter((t) => t.entityType === 'task'),
    done = tasks.filter((t) => t.status === '已完成'),
    bugs = entities.filter((e) => e.entityType === 'bug'),
    openBugs = bugs.filter((b) => !bugClosed(b))
  const placeholders = entities.filter(
    (e) =>
      e.entityType === 'asset_item' &&
      (e.data?.stage ?? e.status) === '灰盒占位',
  )
  const statusLabels = new Map(
    columns(project, tasks).map((c) => [c.id, c.label]),
  )
  const counts = useMemo(() => {
    const days = new Map<string, number>()
    const completions: { id: string; time: number }[] = []
    const tracked = new Set<string>()
    for (const entry of activity) {
      const date = dayKey(new Date(entry.createdAt))
      days.set(date, (days.get(date) ?? 0) + 1)
      if (
        entry.action === 'complete' &&
        entry.entityId &&
        entry.entityType === 'task'
      ) {
        tracked.add(entry.entityId)
        completions.push({
          id: entry.entityId,
          time: Date.parse(entry.createdAt),
        })
      }
    }
    return { days, tracked, completions }
  }, [activity])
  const finished = [
    ...counts.completions,
    ...done
      .filter((t) => !counts.tracked.has(t.id))
      .map((t) => ({
        id: t.id,
        time: Date.parse(field(t, 'completedAt', t.updatedAt)),
      })),
  ]
  const completedIn = (start: Date, end: Date) =>
    new Set(
      finished
        .filter((t) => t.time >= +start && t.time < +end)
        .map((t) => t.id),
    ).size
  const weeks = Array.from({ length: 8 }, (_, i) => shift(week, (i - 7) * 7))
  const completed = weeks.map((w) => completedIn(w, shift(w, 7)))
  const work = weeks.map((w) =>
    hours(times.reduce((s, t) => s + secondsIn(t, w, shift(w, 7), now), 0)),
  )
  const velocity = completedIn(shift(asDay(today), -27), new Date(now + 1)) / 4
  const remaining = tasks.length - done.length,
    weeksLeft = velocity ? remaining / velocity : 0
  const phase = entities.find((e) => e.id === project.currentPhaseId),
    milestone = entities
      .filter(
        (e) =>
          e.entityType === 'milestone' &&
          e.status !== '已完成' &&
          field(e, 'dueDate'),
      )
      .sort((a, b) => field(a, 'dueDate').localeCompare(field(b, 'dueDate')))[0]
  const linked = milestone
      ? tasks.filter((t) => field(t, 'milestoneId') === milestone.id)
      : [],
    linkedDone = linked.filter((t) => t.status === '已完成').length
  const until = milestone
    ? Math.round(
        (+asDay(field(milestone, 'dueDate')) - +asDay(today)) / 86400000,
      )
    : 0
  const latestLog = entities
    .filter((e) => e.entityType === 'devlog')
    .sort((a, b) =>
      field(b, 'date', b.createdAt).localeCompare(
        field(a, 'date', a.createdAt),
      ),
    )[0]
  const icons = [SquareCheck, Check, Bug, Timer]
  function list(title: string, mod: string, rows: Entity[]) {
    return (
      <section className="panel stack">
        <header className="split">
          <h2>
            {title}
            {title === '正在进行' && ' · ' + rows.length}
          </h2>
          <button className="text-action" onClick={() => navigate(mod)}>
            查看全部 →
          </button>
        </header>
        {rows.slice(0, 4).map((e) => (
          <button
            className="overview-row"
            key={e.id}
            onClick={() => inspect(e.id)}
          >
            <span>
              {e.entityType !== 'bug' && <i className="row-dot" />}
              {e.title}
            </span>
            {e.entityType === 'bug' ? (
              <small
                className="severity-pill"
                data-level={field(e, 'severity')}
              >
                {field(e, 'severity', '一般')}
              </small>
            ) : (
              <small>
                {field(e, 'dueDate') &&
                  stampDate(field(e, 'dueDate') + 'T00:00:00')}
              </small>
            )}
          </button>
        ))}
        {!rows.length && <small>暂无条目</small>}
      </section>
    )
  }
  const charts = ['每周完成任务', '每周工时']
  const metrics = analytics
    ? [
        [
          '任务完成率',
          tasks.length
            ? Math.round((done.length / tasks.length) * 100) + '%'
            : '0%',
          '',
        ],
        ['近 4 周平均每周完成', velocity + ' 项', ''],
        [
          '按当前速度预计完工',
          remaining === 0
            ? '已完成'
            : velocity
              ? dayKey(shift(asDay(today), Math.ceil(weeksLeft * 7)))
              : '暂无估算',
          remaining && velocity ? '约 ' + weeksLeft.toFixed(1) + ' 周' : '',
        ],
        [
          '累计工时',
          hours(times.reduce((n, t) => n + elapsed(t, now), 0)) + ' h',
          '',
        ],
      ]
    : [
        ['未完成任务', remaining, 'tasks'],
        ['本周完成', completed[7], 'tasks'],
        ['未解决 Bug', openBugs.length, 'testing'],
        ['本周工时', work[7] + ' h', 'time'],
      ]
  return (
    <div className="stack roomy overview">
      <div className="module-title">
        <div className="overview-identity">
          <ProjectLogo project={project} />
          <div>
            <h1>{project.name}</h1>
            <p>
              {[
                project.genres.join(' / '),
                project.engine,
                project.platforms.join(' / '),
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </div>
        </div>
        <div className="segments">
          {['概览', '数据统计'].map((s, i) => (
            <button
              key={s}
              className={analytics === !!i ? 'active' : ''}
              onClick={() => tab(!!i)}
            >
              {i ? <ChartColumn size={14} /> : <LayoutDashboard size={14} />}
              {s}
            </button>
          ))}
        </div>
      </div>
      <div className="overview-body stack" key={String(analytics)}>
        {placeholders.length > 0 && (
          <button
            className="chip placeholder-pill"
            onClick={() =>
              project.enabledModules.includes('assets_pipeline')
                ? navigate('assets_pipeline', placeholders[0].id)
                : inspect(placeholders[0].id)
            }
          >
            灰盒占位资源 · {placeholders.length} <ArrowRight size={14} />
          </button>
        )}
        {!analytics && (
          <div className="overview-lead">
            <button
              className="panel phase-hero"
              onClick={() => navigate('roadmap')}
            >
              <small>当前阶段 · {phase?.title ?? '尚未设置阶段'}</small>
              <h2>{project.pitch || project.name}</h2>
              {phase?.summary && <p>{phase.summary}</p>}
            </button>
            <button
              className="panel milestone-ring"
              onClick={() =>
                milestone ? inspect(milestone.id) : navigate('roadmap')
              }
            >
              <svg viewBox="0 0 90 90">
                <circle
                  cx="45"
                  cy="45"
                  r="38"
                  fill="none"
                  stroke="var(--line)"
                  strokeWidth="7"
                />
                <circle
                  cx="45"
                  cy="45"
                  r="38"
                  pathLength="100"
                  fill="none"
                  stroke="var(--accent)"
                  strokeWidth="7"
                  className="ring-arc"
                  strokeDasharray="100"
                  strokeLinecap="round"
                  strokeDashoffset={
                    100 -
                    (linked.length ? (100 * linkedDone) / linked.length : 0)
                  }
                  transform="rotate(-90 45 45)"
                />
                <text x="45" y="48">
                  {milestone ? Math.abs(until) : '—'}
                </text>
                <text className="ring-label" x="45" y="63">
                  天
                </text>
              </svg>
              <div>
                <small className="milestone-label">下个里程碑</small>
                <h2>{milestone?.title ?? '尚未安排'}</h2>
                {milestone && (
                  <small>
                    {stampDate(field(milestone, 'dueDate') + 'T00:00:00')} ·{' '}
                    {countdown(field(milestone, 'dueDate'))} · 已完成{' '}
                    {linkedDone}/{linked.length}
                  </small>
                )}
              </div>
            </button>
          </div>
        )}
        <div className="kpis">
          {metrics.map(([label, value, extra], index) => {
            const Icon = icons[index]
            return analytics ? (
              <div className="panel metric" key={label}>
                <small>{label}</small>
                <strong>{value}</strong>
                <small>{extra}</small>
              </div>
            ) : (
              <button
                key={label}
                className="panel metric"
                onClick={() => navigate(String(extra))}
              >
                <i className="kpi-icon">
                  <Icon size={19} />
                </i>
                <strong>{value}</strong>
                <small>{label}</small>
              </button>
            )
          })}
        </div>
        {analytics ? (
          <>
            <div className="chart-grid">
              {charts.map((name, i) => (
                <section className="panel" key={name}>
                  <h2>{name}</h2>
                  <BarChart
                    values={i ? work : completed}
                    labels={weeks.map((w) => dayKey(w).slice(5))}
                    unit={i ? 'h' : '项'}
                  />
                </section>
              ))}
              <section className="panel stack">
                <h2>任务状态分布</h2>
                <Distribution
                  rows={tasks.map(
                    (t) => statusLabels.get(t.status) ?? t.status,
                  )}
                />
              </section>
              <section className="panel stack">
                <h2>Bug 处理状态</h2>
                <Distribution rows={bugs.map(bugStatus)} />
              </section>
            </div>
            <section className="panel stack">
              <h2>近 20 周活跃度</h2>
              <div className="heatmap">
                {Array.from({ length: 140 }, (_, i) => {
                  const d = dayKey(shift(asDay(today), i - 139)),
                    n = counts.days.get(d) ?? 0
                  return (
                    <button
                      key={d}
                      aria-label={d + ' · ' + n + ' 次更新'}
                      title={d + ' · ' + n + ' 次更新'}
                      data-count={Math.min(n, 4)}
                    >
                      <span>
                        {d} · {n} 次更新
                      </span>
                    </button>
                  )
                })}
              </div>
            </section>
          </>
        ) : (
          <div className="bento-grid">
            <div className="bento-column">
              {list(
                '正在进行',
                'tasks',
                tasks.filter((t) => t.status === '进行中'),
              )}
              {list(
                '7 天内到期',
                'calendar',
                entities
                  .filter(
                    (t) =>
                      ['task', 'milestone'].includes(t.entityType) &&
                      t.status !== '已完成' &&
                      field(t, 'dueDate') >= today &&
                      field(t, 'dueDate') <= dayKey(shift(asDay(today), 7)),
                  )
                  .sort((a, b) =>
                    field(a, 'dueDate').localeCompare(field(b, 'dueDate')),
                  ),
              )}
            </div>
            <div className="bento-column">
              {list('待处理 Bug', 'testing', openBugs)}
              <section className="panel stack">
                <header className="split">
                  <h2>最新开发日志</h2>
                  <button
                    className="text-action"
                    onClick={() => navigate('devlog')}
                  >
                    查看全部 →
                  </button>
                </header>
                {latestLog ? (
                  <button
                    className="log-preview"
                    onClick={() => navigate('devlog', latestLog.id)}
                  >
                    <strong>{latestLog.title}</strong>
                    <small>
                      {stampDate(field(latestLog, 'date', latestLog.createdAt))}
                    </small>
                    {latestLog.summary && <b>{latestLog.summary}</b>}
                    <p>{latestLog.body}</p>
                  </button>
                ) : (
                  <small>暂无开发日志</small>
                )}
              </section>
              <section className="panel stack">
                <header className="split">
                  <h2>角色</h2>
                  <button
                    className="text-action"
                    onClick={() => navigate('characters')}
                  >
                    查看全部 →
                  </button>
                </header>
                <div className="avatars">
                  {entities
                    .filter((e) => e.entityType === 'character')
                    .slice(0, 6)
                    .map((e) => (
                      <button key={e.id} onClick={() => inspect(e.id)}>
                        <b>
                          {field(e, 'avatarAsset') ? (
                            <img
                              src={api.assetUrl(field(e, 'avatarAsset'))}
                              alt=""
                            />
                          ) : (
                            e.title[0]
                          )}
                        </b>
                        {e.title}
                      </button>
                    ))}
                </div>
              </section>
              <section className="panel stack">
                <header className="split">
                  <h2>最近更新</h2>
                  <button
                    className="text-action"
                    onClick={() => expand(!allActivity)}
                  >
                    {allActivity ? '收起' : '查看全部 →'}
                  </button>
                </header>
                {activity.slice(0, allActivity ? undefined : 4).map((a) => (
                  <div className="split" key={a.id}>
                    {a.summary}
                    <small>{dayKey(new Date(a.createdAt))}</small>
                  </div>
                ))}
              </section>
              <section className="panel stack">
                <header className="split">
                  <h2>
                    <Sparkles size={16} /> AI 快捷助手
                  </h2>
                  <button className="text-action" onClick={() => assistant('')}>
                    查看全部 →
                  </button>
                </header>
                {['根据当前阶段梳理下一步工作', '总结本周项目进展'].map((s) => (
                  <button
                    className="overview-row"
                    key={s}
                    onClick={() => assistant(s)}
                  >
                    {s}
                    <ArrowRight size={14} />
                  </button>
                ))}
              </section>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
