import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { listen } from '@tauri-apps/api/event'
import { Sparkles, PanelLeftClose, Paperclip, Send } from 'lucide-react'
import {
  aiHistory,
  native,
  preferences,
  readAttachment,
  tiers,
  type Attachment,
  type Provider,
} from '../api/ai'
import { list, record, scalar } from '../modules/world/worldUtils'
import { moduleFor, modules } from '../state/catalog'
import type { AiMessage, AiProposal, Entity, Json } from '../types'

export interface AssistPrompt {
  text: string
  focusedId?: string
  projectId: string
}
type Action = 'apply' | 'reject' | 'rollback'
type Mode = 'ask' | 'review' | 'auto'
type Scope = 'module' | 'project'
type Navigate = (mod: string, targetId?: string) => void
const suggestions: Record<string, string[]> = {
  overview: ['概括当前项目进度', '下一阶段有哪些风险？'],
  docs: ['为当前章节拟提纲', '续写此设计文档'],
  lore: ['检查设定中的矛盾', '梳理开发者真相'],
  characters: ['补全角色动机', '检查角色时间线'],
  quests: ['检查任务前置条件', '设计一条支线任务'],
  scenes: ['新建 2 个带分支选项的示例场景对白', '续写当前场景对白'],
  testing: ['分析严重问题的共同原因', '补全复现步骤'],
  tasks: ['拆分当前开发任务', '检查任务优先级'],
  roadmap: ['为下一阶段拟定里程碑', '梳理当前阶段的交付目标'],
  calendar: ['总结当前项目里程碑排期风险', '本周有哪些截止事项？'],
  time: ['分析近期工时分布与瓶颈', '哪些任务占用了最多工时？'],
  assets_pipeline: ['新建 3 条灰盒占位美术或音频资产清单条目', '梳理当前资产管线缺口'],
  balance: ['新建一张角色成长曲线示例表', '设计一个宝箱掉落模拟表'],
  localization: ['给出当前本地化条目的润色建议', '新建 3 条 UI 本地化示例词条'],
  art: ['为当前场景拟定概念图描述', '整理概念图的视觉参考'],
  locations: ['设计两个相邻地点并说明往来方式', '补全当前地点的地标与历史'],
  factions: ['设计两个利益冲突的阵营', '梳理当前阵营的盟友与对手'],
  vehicles: ['设计一艘适合沿海航行的载具', '补全当前载具的用途与限制'],
  inventory: ['新建 3 个示例物品并配置 1 条合成配方', '补全当前物品的效果与获取方式'],
  collectibles: ['设计一组港口探索收集品', '补全当前收集品的发现线索'],
  graph: ['梳理当前核心角色与地点的关系连线', '找出关系网中的孤立条目'],
  mapmaker: ['设计一张 12×8 的海岛港口示例地图', '给当前地图补充图钉和关键地标'],
  devlog: ['根据本周项目变更起草开发日志', '提炼当前日志中的后续任务'],
}
const operations: Record<string, string> = {
  create_entity: '新增',
  update_entity: '改写',
  delete_entity: '删除',
  create_link: '关联',
  delete_link: '取消关联',
  create_map: '新建地图',
  update_map: '修改地图',
  delete_map: '删除地图',
  upsert_recipe: '合成配方',
  delete_recipe: '删除配方',
}
function proposalModule(p: AiProposal): { mod: string; label: string; targetId?: string } {
  const targetId = p.targetEntityId ?? undefined
  if (p.entityType === 'map') return { mod: 'mapmaker', label: '地图设计', targetId }
  if (p.entityType === 'recipe') return { mod: 'inventory', label: '合成配方' }
  if (p.entityType === 'link') return { mod: 'graph', label: '关系网' }
  const m = moduleFor(p.entityType)
  return { mod: m?.id ?? 'overview', label: m?.label ?? p.entityType, targetId }
}
const fields: Record<string, string> = {
  title: '标题',
  subtitle: '副标题',
  summary: '简介',
  body: '正文',
  status: '状态',
  tags: '标签',
  data: '属性',
  sourceId: '来源',
  targetId: '目标',
  relationLabel: '关系',
}
function fieldDiff(before: Json, after: Json) {
  const old = record(before),
    next = record(after)
  return Object.entries(fields).flatMap(([k, label]) => {
    if (k === 'data') {
      const a = record(old[k]),
        b = record(next[k])
      return [...new Set([...Object.keys(a), ...Object.keys(b)])]
        .filter((n) => JSON.stringify(a[n]) !== JSON.stringify(b[n]))
        .map((n) => ({ label: n, a: a[n], b: b[n] }))
    }
    return JSON.stringify(old[k]) !== JSON.stringify(next[k])
      ? [{ label, a: old[k], b: next[k] }]
      : []
  })
}
function display(v: Json | undefined) {
  return typeof v === 'string' ? v : v == null ? '' : JSON.stringify(v, null, 2)
}

function mapSummary(map: Record<string, Json>) {
  const layers = list(map.layers).map(record)
  const pins = list(map.pins).map((value) => {
    const pin = record(value)
    return `${scalar(pin.label, '图钉')} (${scalar(pin.x)}, ${scalar(pin.y)})`
  })
  const customCount = list(map.customTiles).length
  return [
    `${scalar(map.name)} · ${scalar(map.width)} × ${scalar(map.height)} 格（每格 ${scalar(map.tileSize)}px）`,
    ...layers.map((layer, i) => {
      const count = list(layer.tiles).reduce<number>(
        (total, tile) => total + (typeof tile === 'number' && tile !== 0 ? 1 : 0),
        0,
      )
      return `${scalar(layer.name, '图层 ' + (i + 1))}：${count} 格 · ${list(layer.icons).length} 图标`
    }),
    `图钉（${pins.length}）：${pins.join('、') || '无'}`,
    ...(customCount ? [`自定义图块：${customCount} 种`] : []),
  ]
}

function recordSummary(
  kind: string,
  data: Record<string, Json>,
  titles: ReadonlyMap<string, string>,
) {
  const name = (id: Json | undefined) =>
    titles.get(scalar(id)) ?? scalar(id, '未知条目')
  if (kind === 'map') return mapSummary(data)
  if (kind === 'link') {
    return [
      `${name(data.sourceId)} → ${name(data.targetId)}`,
      `关系：${scalar(data.relationLabel)}`,
    ]
  }
  const parts = list(data.ingredients).map((value) => {
    const part = record(value)
    return `${name(part.itemId)} × ${scalar(part.qty ?? part.quantity, '1')}`
  })
  const tools = list(data.tools).map(name)
  return [
    `产出：${name(data.outputItemId)} × ${scalar(data.outputQty, '1')}`,
    `材料（${parts.length}）：${parts.join('、') || '无'}`,
    `工具（${tools.length}）：${tools.join('、') || '无'}`,
    `备注：${scalar(data.note) || '无'}`,
  ]
}

const ProposalPreview = memo(function ProposalPreview({ p, titles }: {
  p: AiProposal
  titles: ReadonlyMap<string, string>
}) {
  if (['map', 'recipe', 'link'].includes(p.entityType)) {
    return [p.before, p.after].map((value, i) => {
      const data = record(value)
      if (!Object.keys(data).length) return null
      return (
        <div className="proposal-snapshot" key={i}>
          <strong>{i === 0 ? '变更前' : '变更后'}</strong>
          <ul className="proposal-summary-list">
            {recordSummary(p.entityType, data, titles).map((line, index) => (
              <li key={index}>{line}</li>
            ))}
          </ul>
        </div>
      )
    })
  }
  if (p.operation === 'delete_entity') {
    const before = record(p.before)
    const description = [before.title, before.status, before.summary]
      .map((v) => scalar(v))
      .filter(Boolean)
      .join(' · ') || p.summary
    return (
      <div className="diff-field">
        <del>{description.length > 180 ? description.slice(0, 179) + '…' : description}</del>
      </div>
    )
  }
  return fieldDiff(p.before, p.after).map((d) => {
    const from = display(d.a)
    const to = display(d.b)
    return (from || to) && (
      <div className="diff-field" key={d.label}>
        <small>{d.label}</small>
        {from && <del>{from}</del>}
        {to && <ins>{to}</ins>}
      </div>
    )
  })
})

function Diff({
  p,
  act,
  busy,
  navigate,
  titles,
}: {
  p: AiProposal
  act: (a: Action, ids: string[]) => void
  busy: boolean
  navigate: Navigate
  titles: ReadonlyMap<string, string>
}) {
  const info = proposalModule(p)
  return (
    <article className="proposal">
      <header>
        <span className="badge">{operations[p.operation]}</span>
        <span className="proposal-mod">{info.label}</span>
        <strong>{p.summary}</strong>
      </header>
      <ProposalPreview p={p} titles={titles} />
      <footer>
        {p.status === 'pending' ? (
          <>
            <small>待确认</small>
            <button disabled={busy} onClick={() => act('apply', [p.id])}>
              ✓ 确认
            </button>
            <button disabled={busy} onClick={() => act('reject', [p.id])}>
              ✗ 拒绝
            </button>
          </>
        ) : ['accepted', 'applied'].includes(p.status) ? (
          <>
            <small>{p.status === 'applied' ? '已自动应用' : '已确认'}</small>
            {!p.operation.startsWith('delete_') && (
              <button onClick={() => navigate(info.mod, info.targetId)}>去查看</button>
            )}
            <button disabled={busy} onClick={() => act('rollback', [p.id])}>
              撤销回滚
            </button>
          </>
        ) : (
          <small>{p.status === 'rejected' ? '已拒绝' : '已回滚'}</small>
        )}
      </footer>
    </article>
  )
}
export function AiPanel({
  projectId,
  module,
  selected,
  entities,
  navigate,
  onWorkspaceChanged,
  prompt,
  close,
  settings,
  shortcut,
  revision,
}: {
  projectId?: string
  module: string
  selected?: string
  entities: Entity[]
  navigate: Navigate
  onWorkspaceChanged: () => void
  prompt?: AssistPrompt
  close: () => void
  shortcut: string
  settings: () => void
  revision: number
}) {
  const [draft, setDraft] = useState(''),
    [mode, setMode] = useState<Mode>('review'),
    [scopeMode, setScopeMode] = useState<Scope>('module')
  const [attachments, setAttachments] = useState<Attachment[]>([]),
    [config, setConfig] = useState<Provider>(),
    [ready, setReady] = useState(false)
  const [messages, setMessages] = useState<AiMessage[]>([]),
    [proposals, setProposals] = useState<AiProposal[]>([]),
    [inFlight, setInFlight] = useState<{ scopeLabel: string; permission: Mode }>(),
    [working, setWorking] = useState(false),
    [stream, setStream] = useState(''),
    [error, setError] = useState('')
  const [reload, refresh] = useState(0),
    [focus, setFocus] = useState<string>()
  const tail = useRef<HTMLDivElement>(null),
    request = useRef(''),
    activeProject = useRef(projectId)
  const titles = useMemo(() => new Map(entities.map((e) => [e.id, e.title])), [entities])
  const moduleLabel = modules.find((m) => m.id === module)?.label ?? module
  const effectiveScope = module === 'overview' ? 'project' : scopeMode
  const effectiveReadOnly = effectiveScope === 'module' && (module === 'calendar' || module === 'time')
  const permission = effectiveReadOnly ? 'ask' : mode
  const sending = !!inFlight
  useLayoutEffect(() => {
    activeProject.current = projectId
    return () => {
      activeProject.current = undefined
    }
  }, [projectId])
  useEffect(() => {
    setFocus(selected)
  }, [selected, module])
  useEffect(() => {
    if (prompt && projectId === prompt.projectId) {
      setDraft(prompt.text)
      setFocus(prompt.focusedId ?? selected)
    }
  }, [prompt, projectId])
  useEffect(() => {
    let live = true
    const load = () =>
      preferences()
        .then((p) => {
          if (live) {
            setConfig(p.active)
            setReady(
              !p.active.requiresKey ||
                p.status.some(
                  (s) => s.providerId === p.active.id && s.configured,
                ),
            )
          }
        })
        .catch((e) => {
          if (live) setError(String(e))
        })
    void load()
    window.addEventListener('gws-provider-changed', load)
    return () => {
      live = false
      window.removeEventListener('gws-provider-changed', load)
    }
  }, [])
  useEffect(() => {
    let live = true
    if (projectId)
      aiHistory(projectId)
        .then((h) => {
          if (live) {
            setMessages(h.messages)
            setProposals(h.proposals)
          }
        })
        .catch((e) => {
          if (live) setError(String(e))
        })
    return () => {
      live = false
    }
  }, [projectId, revision, reload])
  useEffect(() => {
    tail.current?.scrollIntoView({ block: 'nearest' })
  }, [messages.length, stream])
  async function attach(files: File[]) {
    try {
      const items = await Promise.all(files.map(readAttachment))
      setAttachments((a) => [...a, ...items])
    } catch (e) {
      setError(String(e))
    }
  }
  async function send() {
    if (!config || !ready || !projectId || !draft.trim() || request.current) return
    const input = {
      projectId,
      module,
      scope: effectiveScope,
      focusedId: focus,
      prompt: draft.trim(),
      mode,
      config,
      attachments,
    }
    const command = prompt?.projectId === projectId ? 'ai_assist_action' : 'ai_chat_send'
    setInFlight({
      scopeLabel: input.scope === 'project' ? '全项目' : moduleLabel,
      permission,
    })
    setError('')
    setStream('')
    const requestId = crypto.randomUUID()
    request.current = requestId
    const isCurrent = () =>
      activeProject.current === input.projectId && request.current === requestId
    let off: (() => void) | undefined
    try {
      off = await listen<{
        projectId: string
        requestId: string
        delta: string
      }>('gws://ai-stream', ({ payload }) => {
        if (
          isCurrent() &&
          payload.projectId === input.projectId &&
          payload.requestId === requestId
        )
          setStream((s) => s + payload.delta)
      })
      const reply = await native<AiMessage>(command, { requestId, input })
      if (isCurrent()) {
        setDraft((current) => current === draft ? '' : current)
        setAttachments((current) => current.filter((a) => !input.attachments.includes(a)))
      }
      const hasProposals = Array.isArray(reply.proposals) && reply.proposals.length > 0
      if (input.mode === 'auto' || hasProposals || !isCurrent())
        onWorkspaceChanged()
    } catch (e) {
      if (isCurrent()) setError(String(e))
    } finally {
      off?.()
      if (isCurrent()) {
        refresh((n) => n + 1)
        setStream('')
        setInFlight(undefined)
      }
      request.current = ''
    }
  }
  async function action(a: Action, ids: string[]) {
    setWorking(true)
    setError('')
    try {
      if (ids.length === 1)
        await native(a + '_ai_proposal', { proposalId: ids[0] })
      else
        await native('review_ai_proposals', {
          proposalIds: ids,
          accept: a === 'apply',
        })
    } catch (e) {
      if (activeProject.current === projectId) setError(String(e))
    } finally {
      if (activeProject.current === projectId) {
        setWorking(false)
        refresh((n) => n + 1)
      }
      if (a !== 'reject' || activeProject.current !== projectId) onWorkspaceChanged()
    }
  }
  const pending = proposals
      .filter((p) => p.status === 'pending')
      .map((p) => p.id),
    byId = new Map(proposals.map((p) => [p.id, p]))
  const visibleIds = new Set(
    messages.flatMap((m) =>
      Array.isArray(m.proposals) ? m.proposals.map(String) : [],
    ),
  )
  const archived = proposals.filter(
    (p) =>
      !visibleIds.has(p.id) &&
      ['applied', 'accepted', 'pending'].includes(p.status),
  )
  let scopeLabel = '作用范围：全项目'
  if (inFlight) scopeLabel = `本次请求目标：${inFlight.scopeLabel}`
  else if (module === 'overview') scopeLabel = '作用范围：全项目（概览）'
  else if (effectiveReadOnly) scopeLabel = `当前模块只读（${moduleLabel}）· 仅问答`
  else if (effectiveScope === 'module') scopeLabel = `目标模块：${moduleLabel}（支持显式跨模块）`
  return (
    <aside className="ai-panel ai-dock">
      <header>
        <Sparkles size={17} />
        <h2>AI 助手</h2>
        <button className="dock-close" onClick={close}>
          <PanelLeftClose size={15} /> 收起 <kbd>{shortcut}</kbd>
        </button>
      </header>
      <div className="ai-toolbar">
        <button className="chip" onClick={settings}>
          {config?.name ?? 'AI API Key 设置'}
        </button>
        {config && (
          <div className="ai-pickers">
            <select
              aria-label="当前会话模型"
              disabled={sending}
              value={config.model}
              onChange={(ev) =>
                setConfig({ ...config, model: ev.target.value })
              }
            >
              {[...new Set([config.model, ...config.models])].map((model) => (
                <option key={model}>{model}</option>
              ))}
            </select>
            <select
              aria-label="当前会话推理深度"
              disabled={sending}
              value={config.reasoningTier}
              onChange={(ev) =>
                setConfig({
                  ...config,
                  reasoningTier: ev.target.value as Provider['reasoningTier'],
                })
              }
            >
              {Object.entries(tiers).map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        )}
        {!!messages.length && (
          <button
            disabled={sending || working}
            onClick={async () => {
              try {
                await native('clear_ai_session', { projectId })
                refresh((n) => n + 1)
              } catch (e) {
                setError(String(e))
              }
            }}
          >
            清空会话
          </button>
        )}
      </div>
      <div className="ai-thread">
        {!messages.length && (
          <div className="ai-suggestions">
            <h3>{projectId ? '从项目资料开始' : '请先打开项目'}</h3>
            {projectId &&
              (suggestions[module] ?? suggestions.overview).map((s) => (
                <button className="chip" key={s} disabled={sending} onClick={() => setDraft(s)}>
                  {s}
                </button>
              ))}
          </div>
        )}
        {!!archived.length && (
          <details>
            <summary>先前的项目变更 ({archived.length})</summary>
            {archived.map((p) => (
              <Diff key={p.id} p={p} busy={working} act={action} navigate={navigate} titles={titles} />
            ))}
          </details>
        )}
        {messages.map((m) => (
          <section className={'ai-message ' + m.role} key={m.id}>
            <small>{m.role === 'user' ? '你' : 'AI 助手'}</small>
            <p>{m.content}</p>
            {Array.isArray(m.attachments) &&
              m.attachments.map((v, i) => (
                <small key={i}>
                  {v && typeof v === 'object' && !Array.isArray(v)
                    ? String(v.name)
                    : ''}{' '}
                </small>
              ))}
            {Array.isArray(m.proposals) &&
              m.proposals.map((id) => {
                const p = byId.get(String(id))
                return (
                  p && <Diff key={p.id} p={p} busy={working} act={action} navigate={navigate} titles={titles} />
                )
              })}
          </section>
        ))}
        {inFlight && (
          <section className="ai-message" aria-live="polite">
            {stream || `正在处理（目标：${inFlight.scopeLabel}）…`}
            <span className="stream-pulse" aria-hidden="true">
              •••
            </span>
          </section>
        )}
        <div ref={tail} />
      </div>
      {pending.length > 1 && (
        <div className="ai-toolbar">
          <button
            disabled={working}
            onClick={() => void action('apply', pending)}
          >
            全部确认 ({pending.length})
          </button>
          <button
            disabled={working}
            onClick={() => void action('reject', pending)}
          >
            全部拒绝
          </button>
        </div>
      )}
      <div className="ai-compose">
        {error && <p role="alert">{error}</p>}
        {config && !ready && (
          <button className="secondary" onClick={settings}>
            配置 {config.name} 密钥
          </button>
        )}
        {projectId && (
          <div className="ai-scope-bar">
            <span>{scopeLabel}</span>
            {!sending && module !== 'overview' && (
              <button onClick={() => setScopeMode(scopeMode === 'module' ? 'project' : 'module')}>
                {effectiveReadOnly ? '改为全项目操作' : scopeMode === 'module'
                  ? '切到全项目' : `跟随当前模块（${moduleLabel}）`}
              </button>
            )}
          </div>
        )}
        <select
          aria-label="AI 权限模式"
          value={inFlight?.permission ?? permission}
          disabled={sending || effectiveReadOnly}
          onChange={(e) => setMode(e.target.value as typeof mode)}
        >
          <option value="ask">仅问答</option>
          <option value="review">人工审核（推荐）</option>
          <option value="auto">完全操作权限</option>
        </select>
        <textarea
          aria-label="消息"
          rows={3}
          value={draft}
          disabled={sending}
          placeholder="输入问题，或粘贴图片…"
          onChange={(e) => setDraft(e.target.value)}
          onPaste={(e) => {
            const files = Array.from(e.clipboardData.files)
            if (files.length) {
              e.preventDefault()
              void attach(files)
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && e.ctrlKey) void send()
          }}
        />
        {attachments.map((a, i) => (
          <button
            disabled={sending}
            key={i}
            onClick={() => setAttachments((s) => s.filter((_, j) => j !== i))}
          >
            {a.name} ×
          </button>
        ))}
        <div className="ai-toolbar">
          <label className="file-button">
            <Paperclip size={15} />
            附件
            <input
              type="file"
              multiple
              disabled={sending}
              accept="image/png,image/jpeg,image/gif,image/webp,.md,.txt"
              onChange={(e) => {
                void attach(Array.from(e.target.files ?? []))
                e.target.value = ''
              }}
            />
          </label>
          <button
            className="primary"
            disabled={!ready || !projectId || !draft.trim() || sending}
            onClick={() => void send()}
          >
            <Send size={14} />
            发送
          </button>
        </div>
      </div>
    </aside>
  )
}
