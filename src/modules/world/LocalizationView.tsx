import { useEffect, useRef, useState } from 'react'
import { api, desktop } from '../../api/client'
import { downloadFile, native, preferences } from '../../api/ai'
import { downloadCsv } from '../../api/table'
import { useWorkspace } from '../../state/workspace'
import { newEntity } from '../../state/catalog'
import { Heading, SearchField } from './WorldUI'
import { record, scalar, strings, value } from './worldUtils'
import type { Entity } from '../../types'

const categories: Record<string, string> = {
  scene: '场景对白',
  item: '物品',
  quest: '任务',
  character: '角色',
  location: '地点',
  collectible: '收集品',
  ui: 'UI',
}
const source = (e: Entity) => value(e, 'source', e.body)
const keyOf = (e: Entity) => value(e, 'key', e.title)
const category = (e: Entity) => value(e, 'category', 'ui')
const translation = (e: Entity, locale: string) =>
  scalar(record(e.data?.translations)[locale])
type Draft = { id: string; locale: string; text: string }
type Report = {
  translatedCount: number
  skippedCount: number
  errors: string[]
}

export default function LocalizationView() {
  const w = useWorkspace(),
    projectId = w.project.id,
    setting = 'localization.locales.' + projectId
  const entries = w.entities
    .filter((e) => e.entityType === 'locale_entry')
    .sort((a, b) => keyOf(a).localeCompare(keyOf(b)))
  const [locale, select] = useState('en-US'),
    [custom, setCustom] = useState<string[]>([]),
    [newLocale, setNewLocale] = useState('')
  const [search, setSearch] = useState(''),
    [filter, setFilter] = useState(''),
    [missing, setMissing] = useState(false)
  const [editing, setEditing] = useState('')
  const [adding, setAdding] = useState(false),
    [key, setKey] = useState(''),
    [original, setOriginal] = useState('')
  const [busy, setBusy] = useState(false),
    [hint, setHint] = useState(false),
    [message, setMessage] = useState('')
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const pending = useRef(new Map<string, Draft>()),
    queue = useRef(Promise.resolve()),
    timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const latest = useRef(w)
  latest.current = w
  const slot = (id: string, l: string) => JSON.stringify([id, l])
  const read = (e: Entity, l: string) =>
    drafts[slot(e.id, l)]?.text ?? translation(e, l)
  const locales = [
    ...new Set([
      'en-US',
      'ja-JP',
      ...custom,
      ...entries.flatMap((e) => Object.keys(record(e.data?.translations))),
    ]),
  ]
  useEffect(() => {
    let live = true
    void api
      .getSetting(setting)
      .then((s) => {
        if (live) setCustom(strings(s?.value))
      })
      .catch((e) => latest.current.notify(String(e)))
    return () => {
      live = false
    }
  }, [setting])
  function flush() {
    clearTimeout(timer.current)
    const op = queue.current.then(async () => {
      const batch = [...pending.current.entries()]
      for (const [key, d] of batch) {
        if (pending.current.get(key) !== d) continue
        if (desktop)
          await native('save_locale_translation', { projectId, ...d })
        else {
          const row = await api.getEntity(d.id)
          await api.saveEntity({
            ...row,
            data: {
              ...row.data,
              translations: {
                ...record(row.data?.translations),
                [d.locale]: d.text,
              },
            },
          })
        }
        if (pending.current.get(key) === d) pending.current.delete(key)
      }
      if (batch.length) latest.current.refresh()
    })
    queue.current = op.catch(() => {})
    return op
  }
  const commit = () =>
    void flush().catch((e) => latest.current.notify(String(e)))
  useEffect(
    () => () => {
      commit()
    },
    [],
  )
  useEffect(() => {
    setDrafts((prev) => {
      const next = { ...prev }
      for (const [k, d] of Object.entries(prev)) {
        const row = w.entities.find((e) => e.id === d.id)
        if (
          row &&
          translation(row, d.locale) === d.text &&
          !pending.current.has(k)
        )
          delete next[k]
      }
      return Object.keys(next).length === Object.keys(prev).length ? prev : next
    })
  }, [w.entities])
  function edit(e: Entity, text: string) {
    const k = slot(e.id, locale),
      d = { id: e.id, locale, text }
    pending.current.set(k, d)
    setDrafts((prev) => ({ ...prev, [k]: d }))
    clearTimeout(timer.current)
    timer.current = setTimeout(commit, 500)
  }
  async function action(fn: () => Promise<void>) {
    setBusy(true)
    setMessage('')
    setHint(false)
    try {
      await flush()
      await fn()
    } catch (e) {
      setMessage(String(e))
    } finally {
      setBusy(false)
    }
  }
  async function translate(id?: string) {
    if (!desktop) {
      setMessage('请在桌面端配置服务后翻译。')
      setHint(true)
      return
    }
    const { active, status } = await preferences()
    if (
      active.requiresKey &&
      !status.some((s) => s.providerId === active.id && s.configured)
    ) {
      setHint(true)
      return
    }
    const r = await native<Report>('ai_translate_localization', {
      projectId,
      entryIds: id ? [id] : [],
      targetLocale: locale,
      providerId: active.id,
      model: active.model,
      reasoningTier: active.reasoningTier,
    })
    setMessage(
      [
        '已翻译 ' + r.translatedCount + ' 条，跳过 ' + r.skippedCount + ' 条',
        ...r.errors,
      ].join(' · '),
    )
    if (!r.errors.length) setDrafts({})
    w.refresh()
  }
  async function addLocale() {
    const [l] = Intl.getCanonicalLocales(newLocale.trim())
    if (!l || l === 'zh-CN') throw Error('请输入目标语言代码，例如 ko-KR')
    const next = [...new Set([...custom, l])]
    await api.saveSetting(setting, next)
    setCustom(next)
    select(l)
    setNewLocale('')
  }
  async function addEntry() {
    const k = key.trim()
    if (!k || !original.trim() || entries.some((e) => keyOf(e) === k))
      throw Error('请输入唯一的 Key 和源文本')
    const row = newEntity(projectId, 'locale_entry', k)
    await w.save({
      ...row,
      data: {
        key: k,
        source: original.trim(),
        category: 'ui',
        translations: {},
      },
    })
    setAdding(false)
    setKey('')
    setOriginal('')
  }
  const query = search.trim().toLocaleLowerCase()
  const speakers = new Map(
    w.entities
      .filter((e) => e.entityType === 'character')
      .map((e) => [e.id, e]),
  )
  const visible = entries.filter(
    (e) =>
      (!filter || filter === category(e)) &&
      (editing === e.id ||
        ((!missing || !read(e, locale).trim()) &&
          [keyOf(e), source(e), read(e, locale)].some((s) =>
            s.toLocaleLowerCase().includes(query),
          ))),
  )
  function exportRows(json: boolean) {
    const rows = entries.map((e) => ({
      key: keyOf(e),
      source: source(e),
      translations: Object.fromEntries(locales.map((l) => [l, read(e, l)])),
    }))
    if (json)
      downloadFile(
        JSON.stringify(rows, null, 2),
        'localization.json',
        'application/json',
      )
    else
      downloadCsv(
        'localization',
        ['key', 'source_zh', ...locales],
        rows.map((r) => [
          r.key,
          r.source,
          ...locales.map((l) => r.translations[l]),
        ]),
      )
  }
  return (
    <section className="world stack locale-manager">
      <Heading title="本地化">
        <button
          className="primary"
          disabled={busy}
          onClick={() =>
            void action(async () => {
              const r = await native<{
                total: number
                added: number
                updated: number
              }>('extract_project_localization', { projectId })
              setMessage(
                '新增 ' +
                  r.added +
                  ' 条，更新 ' +
                  r.updated +
                  ' 条，共 ' +
                  r.total +
                  ' 条',
              )
              w.refresh()
            })
          }
        >
          提取项目文本
        </button>
      </Heading>
      <div className="locale-languages">
        {locales.map((l) => {
          const count = entries.filter((e) => read(e, l).trim()).length,
            pct = entries.length
              ? Math.round((count / entries.length) * 100)
              : 0
          return (
            <button
              key={l}
              disabled={busy}
              aria-pressed={locale === l}
              onClick={() => select(l)}
            >
              <b>{l}</b>
              <small>
                {count} / {entries.length} · {pct}%
              </small>
              <progress max={100} value={pct} />
            </button>
          )
        })}
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void action(addLocale)
          }}
        >
          <input
            aria-label="新语种"
            placeholder="ko-KR"
            value={newLocale}
            onChange={(e) => setNewLocale(e.target.value)}
          />
          <button disabled={busy || !newLocale.trim()}>＋ 添加语种</button>
        </form>
      </div>
      <div className="lab-tools">
        <SearchField
          label="搜索 Key、源文本或译文"
          query={search}
          set={setSearch}
        />
        <select
          aria-label="分类"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        >
          <option value="">全部分类</option>
          {Object.entries(categories).map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </select>
        <label>
          <input
            type="checkbox"
            checked={missing}
            onChange={(e) => setMissing(e.target.checked)}
          />
          仅看未翻译
        </label>
        <button onClick={() => setAdding(!adding)}>＋ 自定义词条</button>
        <button
          disabled={busy || entries.every((e) => read(e, locale).trim())}
          onClick={() => void action(() => translate())}
        >
          ✦ AI 批量翻译缺失项
        </button>
        <button onClick={() => exportRows(false)}>导出 CSV</button>
        <button onClick={() => exportRows(true)}>导出 JSON</button>
      </div>
      {adding && (
        <form
          className="lab-tools"
          onSubmit={(e) => {
            e.preventDefault()
            void action(addEntry)
          }}
        >
          <input
            aria-label="自定义 Key"
            placeholder="ui.start"
            value={key}
            onChange={(e) => setKey(e.target.value)}
          />
          <input
            aria-label="自定义源文本"
            placeholder="源文本 (zh-CN)"
            value={original}
            onChange={(e) => setOriginal(e.target.value)}
          />
          <button disabled={busy}>保存词条</button>
        </form>
      )}
      {hint && (
        <p role="status">
          配置当前服务的密钥后即可翻译。{' '}
          <button onClick={w.aiSettings}>去配置 AI API Key</button>
        </p>
      )}
      {(busy || message) && <p role="status">{busy ? '正在处理…' : message}</p>}
      <div className="lab-table-scroll locale-scroll">
        <table className="lab-table">
          <thead>
            <tr>
              <th>Key &amp; 分类</th>
              <th>源文本 (zh-CN)</th>
              <th>目标译文 ({locale})</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {visible.map((e) => {
              const speaker = speakers.get(value(e, 'speakerId'))
              return (
                <tr key={e.id} id={'locale-' + e.id}>
                  <th>
                    <code>{keyOf(e)}</code>
                    <small>{categories[category(e)] ?? category(e)}</small>
                  </th>
                  <td>
                    {source(e)}
                    {speaker && (
                      <small
                        className="speaker-hint"
                        title={[
                          value(speaker, 'personality'),
                          value(speaker, 'speechStyle') ||
                            value(speaker, 'speech'),
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      >
                        {speaker.title} ·{' '}
                        {value(speaker, 'speechStyle') ||
                          value(speaker, 'speech') ||
                          value(speaker, 'role')}
                      </small>
                    )}
                  </td>
                  <td>
                    <textarea
                      rows={2}
                      disabled={busy}
                      aria-label={keyOf(e) + ' ' + locale}
                      value={read(e, locale)}
                      onFocus={() => setEditing(e.id)}
                      onBlur={() => {
                        setEditing('')
                        commit()
                      }}
                      onChange={(ev) => edit(e, ev.target.value)}
                    />
                  </td>
                  <td>
                    <button
                      disabled={busy}
                      onClick={() => void action(() => translate(e.id))}
                    >
                      ✦ AI 翻译
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {!visible.length && (
          <p className="empty">
            {entries.length
              ? '没有符合筛选条件的词条。'
              : '提取项目文本或添加自定义词条。'}
          </p>
        )}
      </div>
    </section>
  )
}
