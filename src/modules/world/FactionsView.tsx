import { useState } from 'react'
import { Empty } from '../../components/ui'
import { withData } from '../../state/planning'
import { useWorkspace } from '../../state/workspace'
import type { Entity } from '../../types'
import {
  Add,
  Card,
  DataField,
  Detail,
  EntitySelect,
  EntryField,
  Filter,
  Heading,
  Pairs,
  Photo,
  Reference,
  SearchField,
} from './WorldUI'
import {
  list,
  matches,
  numeric,
  record,
  scalar,
  useWorld,
  value,
  type Editor,
} from './worldUtils'

const tabs = ['阵营', '关系矩阵', '编制']
const attitudes = ['友善', '中立', '警惕', '敌对', '未知']
const tiers = ['同盟', '盟约', '友好', '中立', '紧张', '敌对', '交战']
const colors = [
  '#238769',
  '#438148',
  '#688538',
  '#707987',
  '#a87928',
  '#b45a31',
  '#ab3f4c',
]
function members(e: Entity) {
  return list(e.data?.members).map((v, i) => {
    const row = record(v)
    return {
      id: scalar(row.id, 'member-' + i),
      rank: scalar(row.rank),
      role: scalar(row.role),
      characterId: typeof v === 'string' ? v : scalar(row.characterId),
      customName: scalar(row.customName),
    }
  })
}
function relation(a: Entity, b: Entity) {
  // Resolve one-sided or inconsistent imported pairs the same way in both cells.
  const [first, second] = a.id <= b.id ? [a, b] : [b, a]
  const direct =
    record(first.data?.diplomacy)[second.id] ??
    record(second.data?.diplomacy)[first.id]
  if (typeof direct === 'string' && tiers.includes(direct)) return direct
  const legacy =
    list(first.data?.relations)
      .map(record)
      .find((r) => r.targetId === second.id) ??
    list(second.data?.relations)
      .map(record)
      .find((r) => r.targetId === first.id)
  const n = numeric(legacy?.level) ?? 0
  return tiers[Math.min(6, Math.max(0, 3 - Math.trunc(n)))]
}
function Matrix({ rows }: { rows: Entity[] }) {
  const { saveMany, run } = useWorkspace()
  const allies = new Map(rows.map((e) => [e.id, new Set<string>()]))
  const conflicts: { a: Entity; b: Entity; tier: string }[] = []
  rows.forEach((a, i) =>
    rows.slice(i + 1).forEach((b) => {
      const tier = relation(a, b),
        level = tiers.indexOf(tier)
      if (level < 3) {
        allies.get(a.id)!.add(b.id)
        allies.get(b.id)!.add(a.id)
      }
      if (level > 3) conflicts.push({ a, b, tier })
    }),
  )
  const visited = new Set<string>(),
    circles: string[][] = []
  for (const e of rows) {
    if (visited.has(e.id)) continue
    const component: string[] = [],
      pending = [e.id]
    while (pending.length) {
      const id = pending.pop()!
      if (visited.has(id)) continue
      visited.add(id)
      component.push(id)
      for (const neighbor of allies.get(id) ?? [])
        if (!visited.has(neighbor)) pending.push(neighbor)
    }
    if (component.length > 1) circles.push(component)
  }
  function setPair(a: Entity, b: Entity, tier: string) {
    const write = (from: Entity, to: Entity) =>
      withData(from, 'diplomacy', {
        ...record(from.data?.diplomacy),
        [to.id]: tier,
      })
    void run(() => saveMany([write(a, b), write(b, a)]))
  }
  return (
    <div className="stack">
      <div className="world-table-wrap">
        <table className="world-table diplomacy">
          <caption>阵营外交关系</caption>
          <thead>
            <tr>
              <th>阵营</th>
              {rows.map((e) => (
                <th key={e.id}>{e.title}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.id}>
                <th>{a.title}</th>
                {rows.map((b) => {
                  const tier = relation(a, b)
                  return (
                    <td key={b.id}>
                      {a.id === b.id ? (
                        '—'
                      ) : (
                        <select
                          aria-label={a.title + '与' + b.title + '的关系'}
                          value={tier}
                          style={{
                            borderLeft:
                              '5px solid ' + colors[tiers.indexOf(tier)],
                          }}
                          onChange={(ev) => setPair(a, b, ev.target.value)}
                        >
                          {tiers.map((t) => (
                            <option key={t}>{t}</option>
                          ))}
                        </select>
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="fields-two">
        <section className="panel stack">
          <h2>联盟圈</h2>
          {circles.map((group) => (
            <p key={group[0]}>
              {group
                .map((id) => rows.find((e) => e.id === id)?.title)
                .join(' · ')}
            </p>
          ))}
          {!circles.length && <small>暂无联盟</small>}
        </section>
        <section className="panel stack">
          <h2>冲突热点</h2>
          {conflicts.map(({ a, b, tier }) => (
            <p key={a.id + b.id}>
              {a.title} / {b.title} <span className="badge">{tier}</span>
            </p>
          ))}
          {!conflicts.length && <small>暂无冲突</small>}
        </section>
      </div>
    </div>
  )
}
function Roster({ ed }: { ed: Editor }) {
  const rows = members(ed.e),
    { entities, openEntity } = useWorkspace(),
    chars = entities.filter((e) => e.entityType === 'character')
  function update(id: string, key: string, s: string) {
    ed.data(
      'members',
      rows.map((r) => (r.id === id ? { ...r, [key]: s } : r)),
    )
  }
  return (
    <section className="stack">
      <div className="split">
        <h3>成员名册</h3>
        <button
          className="text-action"
          onClick={() =>
            ed.data('members', [
              ...rows,
              {
                id: crypto.randomUUID(),
                rank: '成员',
                role: '',
                characterId: '',
                customName: '',
              },
            ])
          }
        >
          ＋ 添加成员
        </button>
      </div>
      {rows.map((r) => {
        const character = chars.find((e) => e.id === r.characterId)
        return (
          <div key={r.id} className="world-subrow stack">
            <EntitySelect
              label="关联角色"
              rows={chars}
              current={r.characterId}
              empty="自定义成员"
              change={(s) => update(r.id, 'characterId', s)}
            />
            {character ? (
              <button
                className="wiki-link"
                onClick={() => openEntity(character)}
              >
                {character.title} ↗
              </button>
            ) : (
              <input
                aria-label="自定义姓名"
                placeholder="自定义姓名"
                value={r.customName}
                onChange={(ev) => update(r.id, 'customName', ev.target.value)}
              />
            )}
            <div className="fields-two">
              <label className="field">
                职级
                <input
                  value={r.rank}
                  onChange={(ev) => update(r.id, 'rank', ev.target.value)}
                />
              </label>
              <label className="field">
                职责
                <input
                  value={r.role}
                  onChange={(ev) => update(r.id, 'role', ev.target.value)}
                />
              </label>
            </div>
            <button
              className="text-action"
              onClick={() =>
                ed.data(
                  'members',
                  rows.filter((x) => x.id !== r.id),
                )
              }
            >
              移除成员
            </button>
          </div>
        )
      })}
    </section>
  )
}
export default function FactionsView() {
  const w = useWorld('faction', tabs[0]),
    [query, setQuery] = useState(''),
    [attitude, setAttitude] = useState('')
  const cards = w.rows.filter(
    (e) =>
      matches(e, query) &&
      (!attitude || value(e, 'attitude', '未知') === attitude),
  )
  return (
    <div className="world">
      <Heading title="阵营" tabs={tabs} active={w.tab} choose={w.switchTab}>
        <Add
          label="新建阵营"
          click={() =>
            void w.create('新阵营', {
              attitude: attitude || '未知',
              color: '#427687',
            })
          }
        />
      </Heading>
      {w.tab === tabs[0] && (
        <>
          <div className="world-filters">
            <SearchField label="搜索阵营" query={query} set={setQuery} />
            <Filter
              label="玩家态度"
              options={attitudes}
              current={attitude}
              change={setAttitude}
            />
          </div>
          <div className="world-grid">
            {cards.map((e) => (
              <Card
                key={e.id}
                entity={e}
                open={w.open}
                asset="emblemAsset"
                kind="emblem"
                color={value(e, 'color', '#427687')}
                badge={value(e, 'attitude', '未知')}
              >
                <b>{value(e, 'motto')}</b>
                <small>
                  总部 ·{' '}
                  {w.entities.find((x) => x.id === value(e, 'hqLocationId'))
                    ?.title || '未设定'}
                  　{members(e).length} 名成员
                </small>
              </Card>
            ))}
          </div>
          {!cards.length && <Empty>暂无匹配阵营</Empty>}
        </>
      )}
      {w.tab === tabs[1] && <Matrix rows={w.rows} />}
      {w.tab === tabs[2] && (
        <div className="world-grid">
          {w.rows.map((e) => {
            const all = members(e),
              ranks = [...new Set(all.map((r) => r.rank || '未分级'))]
            return (
              <section key={e.id} className="panel stack">
                <button className="card-title" onClick={() => w.open(e)}>
                  {e.title}
                </button>
                {ranks.map((rank) => (
                  <div key={rank} className="org-tier">
                    <h3>{rank}</h3>
                    {all
                      .filter((r) => (r.rank || '未分级') === rank)
                      .map((r) => {
                        const c = w.entities.find((c) => c.id === r.characterId)
                        return (
                          <div key={r.id}>
                            {c ? (
                              <button
                                className="wiki-link"
                                onClick={() => w.openEntity(c)}
                              >
                                {c.title}
                              </button>
                            ) : (
                              r.customName || '未命名成员'
                            )}{' '}
                            <small>{r.role}</small>
                          </div>
                        )
                      })}
                  </div>
                ))}
                {!all.length && <small>暂无成员</small>}
              </section>
            )
          })}
        </div>
      )}
      {w.selected && (
        <Detail key={w.selected.id} label="阵营详情" entity={w.selected}>
          {(ed) => (
            <>
              <Photo editor={ed} name="emblemAsset" label="阵营徽记" />
              <EntryField editor={ed} name="title" label="名称" />
              <div className="fields-two">
                <DataField
                  editor={ed}
                  name="color"
                  type="color"
                  label="旗帜颜色"
                  fallback="#427687"
                />
                <DataField editor={ed} name="factionType" label="类型" />
                <DataField
                  editor={ed}
                  name="attitude"
                  label="玩家态度"
                  options={attitudes}
                  fallback="未知"
                />
                <Reference
                  editor={ed}
                  name="hqLocationId"
                  label="总部"
                  type="location"
                />
              </div>
              <DataField editor={ed} name="motto" label="格言" />
              <DataField editor={ed} name="territory" label="势力范围" />
              <Pairs editor={ed} name="ratings" label="实力评分" score />
              <DataField editor={ed} name="goals" label="阵营目标" multiline />
              <EntryField editor={ed} name="body" label="历史与现状" />
              <Roster ed={ed} />
            </>
          )}
        </Detail>
      )}
    </div>
  )
}
