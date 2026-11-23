import { useState } from 'react'
import { api } from '../../api/client'
import { Empty } from '../../components/ui'
import type { Entity, Json } from '../../types'
import {
  Add,
  Card,
  DataField,
  Detail,
  EntitySelect,
  EntryField,
  Heading,
  Photo,
  SearchField,
} from './WorldUI'
import {
  matches,
  numeric,
  rowsOf,
  scalar,
  useWorld,
  value,
  yearLabel,
  type Editor,
} from './worldUtils'

const roles = [
  '主角',
  '第二主角',
  '队友',
  '导师',
  '反派',
  '关键NPC',
  '商人',
  '神秘人物',
  '其他',
]
const tabs = ['角色卡', '群像时间线']
const sections = [
  ['appearance', '外貌'],
  ['personality', '性格'],
  ['speech', '说话方式'],
  ['motivation', '动机'],
  ['arc', '角色弧光'],
]
function LifeEditor({ ed }: { ed: Editor }) {
  const rows = rowsOf(ed.e, 'timeline')
  function update(id: string, key: string, v: Json) {
    ed.data(
      'timeline',
      rows.map((r) => (r.id === id ? { ...r, [key]: v } : r)),
    )
  }
  function move(i: number, delta: number) {
    const next = [...rows]
    next.splice(i + delta, 0, next.splice(i, 1)[0])
    ed.data('timeline', next)
  }
  return (
    <section className="stack">
      <div className="split">
        <h3>人生时间线</h3>
        <button
          className="text-action"
          onClick={() =>
            ed.data('timeline', [
              ...rows,
              { id: crypto.randomUUID(), when: '', event: '' },
            ])
          }
        >
          ＋ 添加节点
        </button>
      </div>
      {rows.map((r, i) => (
        <div className="world-subrow stack" key={r.id}>
          <div className="fields-two">
            <label className="field">
              时期
              <input
                value={scalar(r.when)}
                placeholder="如：少年时期"
                onChange={(ev) => update(r.id, 'when', ev.target.value)}
              />
            </label>
            <label className="field">
              年份
              <input
                type="number"
                step="1"
                value={scalar(r.year)}
                onChange={(ev) =>
                  update(
                    r.id,
                    'year',
                    ev.target.value === ''
                      ? null
                      : Math.trunc(Number(ev.target.value)),
                  )
                }
              />
            </label>
          </div>
          <label className="field">
            事件
            <textarea
              value={scalar(r.event)}
              onChange={(ev) => update(r.id, 'event', ev.target.value)}
            />
          </label>
          <div className="world-row-actions">
            <button disabled={i === 0} onClick={() => move(i, -1)}>
              上移
            </button>
            <button disabled={i === rows.length - 1} onClick={() => move(i, 1)}>
              下移
            </button>
            <button
              onClick={() =>
                ed.data(
                  'timeline',
                  rows.filter((x) => x.id !== r.id),
                )
              }
            >
              删除节点
            </button>
          </div>
        </div>
      ))}
    </section>
  )
}
function Avatar({ e }: { e: Entity }) {
  const name = value(e, 'avatarAsset')
  return (
    <span className="world-avatar">
      {name ? <img src={api.assetUrl(name)} alt="" /> : e.title.slice(0, 1)}
    </span>
  )
}
export default function CharactersView() {
  const w = useWorld('character', tabs[0]),
    [query, setQuery] = useState(''),
    [role, setRole] = useState(''),
    [person, setPerson] = useState('')
  const cards = w.rows.filter(
    (e) => matches(e, query) && (!role || role === value(e, 'role', '其他')),
  )
  const timeline = w.rows
    .filter((e) => !person || e.id === person)
    .flatMap((e) =>
      rowsOf(e, 'timeline').map((r) => ({ e, r, year: numeric(r.year) })),
    )
    .sort((a, b) => (a.year ?? Infinity) - (b.year ?? Infinity))
  return (
    <div className="world">
      <Heading title="角色" tabs={tabs} active={w.tab} choose={w.switchTab}>
        <button
          className="secondary"
          onClick={() =>
            w.assistant(
              '依据已有资料补全角色背景、动机和成长线。',
              w.selected?.id,
            )
          }
        >
          AI 填写
        </button>
        <Add
          label="新建角色"
          click={() => void w.create('新角色', { role: role || '其他' })}
        />
      </Heading>
      {w.tab === tabs[0] ? (
        <>
          <div className="world-filters">
            <SearchField query={query} set={setQuery} label="搜索角色" />
            {['', ...roles].map((s) => (
              <button
                key={s}
                className={'chip ' + (role === s ? 'active' : '')}
                onClick={() => setRole(s)}
              >
                {s || '全部'}
              </button>
            ))}
          </div>
          <div className="world-grid">
            {cards.map((e) => (
              <Card
                key={e.id}
                kind="portrait"
                entity={e}
                open={w.open}
                asset="avatarAsset"
                badge={value(e, 'role', '其他')}
              />
            ))}
          </div>
          {!cards.length && <Empty>暂无匹配角色</Empty>}
        </>
      ) : (
        <>
          <div className="world-filters">
            <EntitySelect
              label="筛选角色"
              rows={w.rows}
              current={person}
              change={setPerson}
              empty="全部角色"
            />
          </div>
          <div className="world-timeline">
            {timeline.map(({ e, r, year }) => (
              <button key={e.id + r.id} onClick={() => w.open(e)}>
                <small>
                  {year === undefined ? '年份未定' : yearLabel(year)}{' '}
                  {scalar(r.when)}
                </small>
                <strong>{scalar(r.event) || '未命名事件'}</strong>
                <span>
                  <Avatar e={e} /> {e.title}
                </span>
              </button>
            ))}
          </div>
          {!timeline.length && <Empty>暂无人生节点</Empty>}
        </>
      )}
      {w.selected && (
        <Detail key={w.selected.id} entity={w.selected} label="角色详情">
          {(ed) => (
            <>
              <Photo editor={ed} name="avatarAsset" label="角色肖像" />
              <EntryField editor={ed} name="title" label="姓名" />
              <div className="fields-two">
                <DataField
                  editor={ed}
                  name="role"
                  label="角色定位"
                  options={roles}
                  fallback="其他"
                />
                <DataField editor={ed} name="age" label="年龄" />
              </div>
              <DataField editor={ed} name="race" label="种族 / 出身" />
              <EntryField editor={ed} name="summary" label="一句话简介" />
              {sections.map(([name, label]) => (
                <DataField
                  key={name}
                  editor={ed}
                  {...{ name, label }}
                  multiline
                />
              ))}
              <EntryField editor={ed} name="body" label="背景故事" />
              <LifeEditor ed={ed} />
            </>
          )}
        </Detail>
      )}
    </div>
  )
}
