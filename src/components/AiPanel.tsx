import { useEffect, useRef, useState } from 'react'
import { listen } from '@tauri-apps/api/event'
import { Sparkles, PanelRightClose, Paperclip, Send } from 'lucide-react'
import { IconButton } from './ui'
import {
  aiHistory,
  native,
  preferences,
  readAttachment,
  tiers,
  type Attachment,
  type Provider,
} from '../api/ai'
import type { AiMessage, AiProposal, Json } from '../types'

export interface AssistPrompt {
  text: string
  focusedId?: string
  projectId: string
}
type Action = 'apply' | 'reject' | 'rollback'
const suggestions: Record<string, string[]> = {
  overview: ['概括当前项目进度', '下一阶段有哪些风险？'],
  docs: ['为当前章节拟提纲', '续写此设计文档'],
  lore: ['检查设定中的矛盾', '梳理开发者真相'],
  characters: ['补全角色动机', '检查角色时间线'],
  quests: ['检查任务前置条件', '设计一条支线任务'],
  scenes: ['续写当前场景对白', '检查角色语气'],
  testing: ['分析严重问题的共同原因', '补全复现步骤'],
  tasks: ['拆分当前开发任务', '检查任务优先级'],
}
const operations: Record<string, string> = {
  create_entity: '新增',
  update_entity: '改写',
  delete_entity: '删除',
  create_link: '关联',
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
  const obj = (v: Json) =>
    v && typeof v === 'object' && !Array.isArray(v) ? v : {}
  const old = obj(before),
    next = obj(after)
  return Object.entries(fields).flatMap(([k, label]) => {
    if (k === 'data') {
      const a = obj(old[k]),
        b = obj(next[k])
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
function Diff({
  p,
  act,
  busy,
}: {
  p: AiProposal
  act: (a: Action, ids: string[]) => void
  busy: boolean
}) {
  return (
    <article className="proposal">
      <header>
        <span className="badge">{operations[p.operation]}</span>
        <strong>{p.summary}</strong>
      </header>
      {fieldDiff(p.before, p.operation === 'delete_entity' ? {} : p.after).map(
        (d) =>
          (display(d.a) || display(d.b)) && (
            <div className="diff-field" key={d.label}>
              <small>{d.label}</small>
              {display(d.a) && <del>{display(d.a)}</del>}
              {display(d.b) && <ins>{display(d.b)}</ins>}
            </div>
          ),
      )}
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
  prompt,
  close,
  settings,
  revision,
}: {
  projectId?: string
  module: string
  selected?: string
  prompt?: AssistPrompt
  close: () => void
  settings: () => void
  revision: number
}) {
  const [draft, setDraft] = useState(''),
    [mode, setMode] = useState<'ask' | 'review' | 'auto'>('review')
  const [attachments, setAttachments] = useState<Attachment[]>([]),
    [config, setConfig] = useState<Provider>(),
    [ready, setReady] = useState(false)
  const [messages, setMessages] = useState<AiMessage[]>([]),
    [proposals, setProposals] = useState<AiProposal[]>([]),
    [sending, setSending] = useState(false),
    [working, setWorking] = useState(false),
    [stream, setStream] = useState(''),
    [error, setError] = useState('')
  const [reload, refresh] = useState(0),
    [focus, setFocus] = useState<string>()
  const tail = useRef<HTMLDivElement>(null),
    request = useRef(''),
    alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])
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
    if (!config || !ready || !projectId || !draft.trim() || sending) return
    setSending(true)
    setError('')
    setStream('')
    const requestId = crypto.randomUUID()
    request.current = requestId
    let off: (() => void) | undefined
    try {
      off = await listen<{
        projectId: string
        requestId: string
        delta: string
      }>('gws://ai-stream', ({ payload }) => {
        if (
          alive.current &&
          payload.projectId === projectId &&
          payload.requestId === request.current
        )
          setStream((s) => s + payload.delta)
      })
      await native(prompt ? 'ai_assist_action' : 'ai_chat_send', {
        requestId,
        input: {
          projectId,
          module,
          focusedId: focus,
          prompt: draft.trim(),
          mode,
          config,
          attachments,
        },
      })
      if (alive.current) {
        setDraft('')
        setAttachments([])
        refresh((n) => n + 1)
      }
    } catch (e) {
      if (alive.current) setError(String(e))
    } finally {
      off?.()
      if (alive.current) {
        setStream('')
        setSending(false)
      }
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
      setError(String(e))
    } finally {
      setWorking(false)
      refresh((n) => n + 1)
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
  return (
    <aside className="ai-panel ai-dock">
      <header>
        <Sparkles size={17} />
        <h2>AI 助手</h2>
        <IconButton label="收起 AI 助手" onClick={close}>
          <PanelRightClose size={16} />
        </IconButton>
      </header>
      <div className="ai-toolbar">
        <button className="chip" onClick={settings}>
          {config
            ? config.name +
              ' · ' +
              config.model +
              ' · ' +
              tiers[config.reasoningTier]
            : 'AI API Key 设置'}
        </button>
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
                <button className="chip" key={s} onClick={() => setDraft(s)}>
                  {s}
                </button>
              ))}
          </div>
        )}
        {!!archived.length && (
          <details>
            <summary>先前的项目变更 ({archived.length})</summary>
            {archived.map((p) => (
              <Diff key={p.id} p={p} busy={working} act={action} />
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
                  p && <Diff key={p.id} p={p} busy={working} act={action} />
                )
              })}
          </section>
        ))}
        {sending && (
          <section className="ai-message" aria-live="polite">
            {stream || '正在生成…'}
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
        <select
          aria-label="AI 权限模式"
          value={mode}
          disabled={sending}
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
