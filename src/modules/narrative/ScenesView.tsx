import { useEffect, useRef, useState } from 'react'
import { Clapperboard, Sparkles } from 'lucide-react'
import { api } from '../../api/client'
import { EntityLinkPanel } from '../../components/EntityLinkPanel'
import { historyKey, useCommands, useKeys } from '../../components/CanvasKit'
import { newEntity } from '../../state/catalog'
import { useWorkspace } from '../../state/workspace'
import type { Entity } from '../../types'
import {
  Add,
  TrashEntry,
  Reference,
  SaveStatus,
  SearchField,
} from '../world/WorldUI'
import {
  list,
  matches,
  record,
  scalar,
  strings,
  useEditor,
  value,
} from '../world/worldUtils'
const modes = ['编写', '对话预览', '播放']
function Scene({ scene }: { scene: Entity }) {
  const w = useWorkspace(),
    ed = useEditor(scene),
    e = ed.e
  const [mode, setMode] = useState('对话预览'),
    [index, setIndex] = useState(0)
  const stage = useRef<HTMLDivElement>(null),
    lineFocus = useRef('')
  const characters = w.entities.filter((e) => e.entityType === 'character'),
    byId = new Map(w.entities.map((e) => [e.id, e]))
  const lines = list(e.data?.lines ?? e.data?.dialogues).map((v, i) => {
    const l = record(v),
      speakerId = scalar(l.speakerId) || 'narrator'
    return {
      ...l,
      id: scalar(l.id, 'line-' + i),
      speakerId,
      speakerName:
        speakerId === 'narrator'
          ? '旁白'
          : (byId.get(speakerId)?.title ?? scalar(l.speakerName, '未知角色')),
      mood: scalar(l.mood),
      text: scalar(l.text),
    }
  })
  const firstSpeaker = lines.find((l) => l.speakerId !== 'narrator')?.speakerId
  const cast = Array.isArray(e.data?.castIds)
    ? strings(e.data?.castIds)
    : [...new Set(lines.map((l) => l.speakerId).filter((id) => byId.has(id)))]
  const speakers = [...characters].sort(
    (a, b) => Number(cast.includes(b.id)) - Number(cast.includes(a.id)),
  )
  const location = byId.get(value(e, 'locationId')),
    quest = byId.get(value(e, 'questId'))
  const pins = w.maps.flatMap((m) =>
    list(m.pins)
      .map(record)
      .filter((p) => p.entityId === e.id)
      .map((p) => m.name + ' · ' + scalar(p.label)),
  )
  const safeIndex = Math.min(index, Math.max(0, lines.length - 1)),
    current = lines[safeIndex],
    speaker = current && byId.get(current.speakerId)
  function next(delta: number) {
    setIndex((i) => Math.max(0, Math.min(lines.length - 1, i + delta)))
  }
  useEffect(() => {
    if (mode !== '播放') return
    stage.current?.focus()
    function key(ev: KeyboardEvent) {
      if (
        document.querySelector('dialog[open]') ||
        !stage.current?.contains(document.activeElement)
      )
        return
      if (
        [' ', 'Enter', 'ArrowRight', 'ArrowLeft', 'Escape'].includes(ev.key)
      ) {
        ev.preventDefault()
        ev.stopPropagation()
        if (ev.key === 'Escape') setMode('编写')
        else next(ev.key === 'ArrowLeft' ? -1 : 1)
      }
    }
    window.addEventListener('keydown', key, true)
    return () => window.removeEventListener('keydown', key, true)
  }, [mode, lines.length])
  useEffect(() => {
    if (lineFocus.current) {
      document.getElementById(lineFocus.current)?.focus()
      lineFocus.current = ''
    }
  }, [lines.length])
  const history = useCommands(w.notify)
  const editor = useRef(ed)
  editor.current = ed
  function changeLines(next: typeof lines) {
    editor.current.data('lines', next)
    history.record(
      () => editor.current.data('lines', next),
      () => editor.current.data('lines', lines),
    )
  }
  useKeys((ev) => mode === '编写' && historyKey(ev, history))
  function add(at: number) {
    const id = crypto.randomUUID(),
      prev = lines[at - 1],
      copy = [...lines]
    copy.splice(at, 0, {
      id,
      speakerId: prev?.speakerId ?? 'narrator',
      speakerName: prev?.speakerName ?? '旁白',
      mood: '',
      text: '',
    })
    lineFocus.current = id
    changeLines(copy)
  }
  function swap(i: number, j: number) {
    const copy = [...lines]
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
    changeLines(copy)
  }
  return (
    <>
      <section className="scene-meta stack" aria-label="场景信息">
        <header className="split">
          {ed.status === '已自动保存' ? (
            <small>修改会自动保存</small>
          ) : (
            <SaveStatus editor={ed} />
          )}
          <button
            className="ai-fill"
            onClick={() =>
              w.assistant(
                '根据场景目的与现有角色补全当前场景资料和对白。',
                e.id,
              )
            }
          >
            <Sparkles size={14} /> AI 填写
          </button>
        </header>
        <input
          className="scene-title"
          aria-label="场景标题"
          value={e.title}
          onChange={(ev) => ed.edit({ title: ev.target.value })}
        />
        <div className="scene-fields">
          <Reference
            editor={ed}
            label="地点"
            name="locationId"
            type="location"
          />
          <Reference
            editor={ed}
            label="所属任务线"
            name="questId"
            type="quest"
          />
        </div>
        <fieldset className="scene-cast">
          <legend>出场角色</legend>
          {characters.map((c) => (
            <span key={c.id}>
              <button
                aria-pressed={cast.includes(c.id)}
                onClick={() =>
                  ed.data(
                    'castIds',
                    cast.includes(c.id)
                      ? cast.filter((id) => id !== c.id)
                      : [...cast, c.id],
                  )
                }
              >
                {c.title}
              </button>
              {cast.includes(c.id) && (
                <button
                  className="cast-open"
                  title={'打开' + c.title}
                  onClick={() => w.openEntity(c)}
                >
                  ↗
                </button>
              )}
            </span>
          ))}
        </fieldset>
        <label className="field">
          <span>这场戏的目的</span>
          <textarea
            rows={3}
            value={e.summary}
            onChange={(ev) => ed.edit({ summary: ev.target.value })}
          />
        </label>
        <EntityLinkPanel entity={e} />
        {quest && (
          <button className="text-action" onClick={() => w.openEntity(quest)}>
            {quest.title} ↗
          </button>
        )}
        {pins.map((pin, i) => (
          <p key={i}>图钉 · {pin}</p>
        ))}
        <div className="scene-meta-foot">
          <TrashEntry editor={ed} />
        </div>
      </section>
      <section className="scene-work stack" aria-label="场景对白">
        <div className="split scene-mode">
          <strong>对白 {lines.length} 句</strong>
          <div className="segments">
            {modes.map((m) => (
              <button
                key={m}
                className={mode === m ? 'active' : ''}
                onClick={() => {
                  setMode(m)
                  if (m === '播放') setIndex(0)
                }}
              >
                {m}
              </button>
            ))}
          </div>
        </div>
        <div className="world-actions">
          {mode === '编写' && (
            <>
              <button disabled={!history.canUndo} onClick={history.undo}>
                撤销
              </button>
              <button disabled={!history.canRedo} onClick={history.redo}>
                重做
              </button>
            </>
          )}
          {mode === '编写' && (
            <button
              onClick={() =>
                w.assistant('按现有出场角色与语气续写当前场景对白。', e.id)
              }
            >
              AI 续写
            </button>
          )}
        </div>
        {mode === '编写' ? (
          <>
            <div className="scene-lines">
              {lines.map((l, i) => {
                const change = (patch: Partial<typeof l>) =>
                  changeLines(
                    lines.map((a, j) => (j === i ? { ...a, ...patch } : a)),
                  )
                return (
                  <article key={l.id} className="scene-line">
                    <div className="visual-tools">
                      <select
                        aria-label="说话人"
                        value={l.speakerId}
                        onChange={(ev) =>
                          change({
                            speakerId: ev.target.value,
                            speakerName:
                              byId.get(ev.target.value)?.title ?? '旁白',
                          })
                        }
                      >
                        <option value="narrator">旁白</option>
                        {!byId.has(l.speakerId) &&
                          l.speakerId !== 'narrator' && (
                            <option value={l.speakerId}>{l.speakerName}</option>
                          )}
                        {speakers.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.title}
                          </option>
                        ))}
                      </select>
                      <input
                        aria-label="情绪或舞台指示"
                        placeholder="情绪 / 动作"
                        value={l.mood}
                        onChange={(ev) => change({ mood: ev.target.value })}
                      />
                      <button
                        aria-label="上移台词"
                        disabled={!i}
                        onClick={() => swap(i, i - 1)}
                      >
                        ↑
                      </button>
                      <button
                        aria-label="下移台词"
                        disabled={i === lines.length - 1}
                        onClick={() => swap(i, i + 1)}
                      >
                        ↓
                      </button>
                      <button
                        aria-label="删除台词"
                        onClick={() =>
                          changeLines(lines.filter((_, j) => j !== i))
                        }
                      >
                        ×
                      </button>
                    </div>
                    <textarea
                      id={l.id}
                      aria-label={'台词 ' + (i + 1)}
                      value={l.text}
                      onChange={(ev) => change({ text: ev.target.value })}
                      onKeyDown={(ev) => {
                        if (
                          ev.key === 'Enter' &&
                          !ev.shiftKey &&
                          !ev.nativeEvent.isComposing
                        ) {
                          ev.preventDefault()
                          add(i + 1)
                        }
                      }}
                    />
                  </article>
                )
              })}
            </div>
            <button onClick={() => add(lines.length)}>
              ＋ 添加台词 (Enter)
            </button>
          </>
        ) : mode === '对话预览' ? (
          <div className="scene-chat">
            {lines.map((l) => {
              if (l.speakerId === 'narrator')
                return (
                  <p className="scene-narrator" key={l.id}>
                    {l.text}
                  </p>
                )
              const c = byId.get(l.speakerId),
                avatar = c && value(c, 'avatarAsset')
              return (
                <article
                  key={l.id}
                  className={
                    'chat-line ' +
                    (l.speakerId === firstSpeaker ? 'reverse' : '')
                  }
                >
                  <b className="chat-avatar">
                    {avatar ? (
                      <img src={api.assetUrl(avatar)} alt="" />
                    ) : (
                      l.speakerName.slice(0, 1)
                    )}
                  </b>
                  <div>
                    <strong>{l.speakerName}</strong> <small>{l.mood}</small>
                    <p>{l.text}</p>
                  </div>
                </article>
              )
            })}
          </div>
        ) : (
          <div
            ref={stage}
            className="vn-stage"
            tabIndex={-1}
            style={
              location && value(location, 'coverAsset')
                ? {
                    backgroundImage:
                      'linear-gradient(0deg,#101727cc,transparent),url("' +
                      api.assetUrl(value(location, 'coverAsset')) +
                      '")',
                  }
                : undefined
            }
          >
            {speaker && value(speaker, 'avatarAsset') && (
              <img
                className="vn-portrait"
                src={api.assetUrl(value(speaker, 'avatarAsset'))}
                alt={speaker.title}
              />
            )}
            <section className="vn-dialog" key={current?.id}>
              <small>
                {location?.title} · {current ? safeIndex + 1 : 0} /{' '}
                {lines.length}
              </small>
              <h2>{current?.speakerName ?? '旁白'}</h2>
              <i>{current?.mood}</i>
              <p>{current?.text || '暂无台词'}</p>
              <progress
                value={current ? safeIndex + 1 : 0}
                max={lines.length || 1}
              />
              <div className="visual-tools">
                <button disabled={!safeIndex} onClick={() => next(-1)}>
                  ← 上一句
                </button>
                <button
                  disabled={safeIndex + 1 >= lines.length}
                  onClick={() => next(1)}
                >
                  下一句 →
                </button>
                <button onClick={() => setMode('编写')}>退出 (Esc)</button>
              </div>
            </section>
          </div>
        )}
      </section>
    </>
  )
}
export default function ScenesView() {
  const w = useWorkspace(),
    [query, setQuery] = useState('')
  const rows = w.entities.filter((e) => e.entityType === 'scene'),
    active = rows.find((e) => e.id === w.selected) ?? rows[0]
  return (
    <section className="world scene-layout">
      <aside className="scene-list stack">
        <h1>
          <i>
            <Clapperboard size={18} />
          </i>
          场景对白 <small>{rows.length}</small>
        </h1>
        <SearchField label="搜索场景" query={query} set={setQuery} />
        <div className="scene-entries">
          {rows
            .filter((e) => matches(e, query))
            .map((e) => (
              <button
                className={
                  'world-entry ' + (active?.id === e.id ? 'active' : '')
                }
                key={e.id}
                onClick={() => w.inspect(e.id)}
              >
                <strong>{e.title}</strong>
              </button>
            ))}
        </div>
        <Add
          label="新建场景"
          click={() =>
            void w.run(async () => {
              const e = newEntity(w.project.id, 'scene', '新场景')
              await w.save({ ...e, data: { lines: [], castIds: [] } })
              w.inspect(e.id)
            })
          }
        />
      </aside>
      {active ? (
        <Scene key={active.id} scene={active} />
      ) : (
        <p>新建场景以编写第一句对白。</p>
      )}
    </section>
  )
}
