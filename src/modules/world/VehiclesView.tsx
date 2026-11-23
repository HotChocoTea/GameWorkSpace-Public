import { useState } from 'react'
import { Empty } from '../../components/ui'
import type { Entity } from '../../types'
import {
  Add,
  Card,
  DataField,
  Detail,
  EntryField,
  Filter,
  Heading,
  MultiPick,
  Pairs,
  Photo,
  Reference,
  SearchField,
} from './WorldUI'
import {
  matches,
  numeric,
  rowsOf,
  scalar,
  strings,
  useWorld,
  value,
} from './worldUtils'

const tabs = ['车库', '对比'],
  types = ['陆地', '水上', '空中', '太空', '机甲', '坐骑']
const labels = ['速度', '加速', '操控', '耐久', '载重']
function defaultStats(e?: Entity) {
  return labels.map((label, i) => ({
    id: 'stat-' + i,
    label,
    value:
      i === 0 ? Math.min(100, Math.max(0, numeric(e?.data?.speed) ?? 50)) : 50,
  }))
}
function defaultSpecs(e: Entity) {
  return [
    ['crew', '定员'],
    ['range', '续航'],
  ]
    .filter(([key]) => value(e, key) !== '')
    .map(([key, label]) => ({ id: key, label, value: value(e, key) }))
}
function metrics(e: Entity, key: 'stats' | 'specs') {
  return Array.isArray(e.data?.[key])
    ? rowsOf(e, key).map((r) => ({
        label: scalar(r.label),
        value: scalar(r.value),
      }))
    : (key === 'stats' ? defaultStats(e) : defaultSpecs(e)).map((r) => ({
        label: r.label,
        value: String(r.value),
      }))
}
function Compare({
  rows,
  open,
}: {
  rows: Entity[]
  open: (e: Entity) => void
}) {
  const [excluded, setExcluded] = useState<string[]>([])
  const selected = rows.filter((e) => !excluded.includes(e.id))
  return (
    <div className="stack">
      <div className="world-chips">
        {rows.map((e) => (
          <label className="chip" key={e.id}>
            <input
              type="checkbox"
              checked={!excluded.includes(e.id)}
              onChange={(ev) =>
                setExcluded(
                  ev.target.checked
                    ? excluded.filter((id) => id !== e.id)
                    : [...excluded, e.id],
                )
              }
            />{' '}
            {e.title}
          </label>
        ))}
      </div>
      {selected.length ? (
        <div className="world-table-wrap">
          <table className="world-table">
            <caption>载具对比</caption>
            <thead>
              <tr>
                <th>指标</th>
                {selected.map((e) => (
                  <th key={e.id}>
                    <button onClick={() => open(e)}>{e.title}</button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(['stats', 'specs'] as const).map((key) => {
                const entries = selected.map(
                  (e) =>
                    new Map(
                      metrics(e, key)
                        .filter((r) => r.label)
                        .map((r) => [r.label, r.value]),
                    ),
                )
                const keys = [
                  ...new Set(entries.flatMap((map) => [...map.keys()])),
                ]
                return keys.map((label) => {
                  const cells = entries.map((map) => map.get(label))
                  const quantities = cells.map((v) =>
                    v?.trim().match(/^([-+]?\d+(?:\.\d+)?)\s*(.*)$/),
                  )
                  const units = new Set(
                    quantities.filter(Boolean).map((m) => m![2]),
                  )
                  const max =
                    units.size === 1
                      ? Math.max(
                          ...quantities.map((m) =>
                            m ? Number(m[1]) : -Infinity,
                          ),
                        )
                      : Infinity
                  return (
                    <tr key={key + label}>
                      <th>
                        {label}{' '}
                        <small>{key === 'stats' ? '评分' : '规格'}</small>
                      </th>
                      {cells.map((v, i) => (
                        <td
                          key={selected[i].id}
                          className={
                            quantities[i] && Number(quantities[i]![1]) === max
                              ? 'world-best'
                              : ''
                          }
                        >
                          {v ?? '—'}
                        </td>
                      ))}
                    </tr>
                  )
                })
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty>选择载具以比较性能与规格</Empty>
      )}
    </div>
  )
}
export default function VehiclesView() {
  const w = useWorld('vehicle', tabs[0]),
    [query, setQuery] = useState(''),
    [kind, setKind] = useState('')
  const cards = w.rows.filter(
    (e) =>
      matches(e, query) && (!kind || kind === value(e, 'vehicleType', '水上')),
  )
  return (
    <div className="world">
      <Heading title="载具" tabs={tabs} active={w.tab} choose={w.switchTab}>
        <Add
          label="新建载具"
          click={() =>
            void w.create('新载具', {
              vehicleType: kind || '陆地',
              stats: defaultStats(),
            })
          }
        />
      </Heading>
      {w.tab === tabs[0] ? (
        <>
          <div className="world-filters">
            <SearchField label="搜索载具" query={query} set={setQuery} />
            <Filter
              label="载具类型"
              options={types}
              current={kind}
              change={setKind}
            />
          </div>
          <div className="world-grid">
            {cards.map((e) => (
              <Card
                key={e.id}
                entity={e}
                open={w.open}
                kind="vehicle"
                asset="imageAsset"
                badge={value(e, 'vehicleType', '水上')}
              >
                {metrics(e, 'stats')
                  .slice(0, 3)
                  .map((r, i) => (
                    <div className="mini-stat" key={i}>
                      <small>{r.label}</small>
                      <progress max={100} value={numeric(r.value) ?? 0} />
                      <small>{r.value}</small>
                    </div>
                  ))}
              </Card>
            ))}
          </div>
          {!cards.length && <Empty>暂无匹配载具</Empty>}
        </>
      ) : (
        <Compare rows={w.rows} open={w.open} />
      )}
      {w.selected && (
        <Detail key={w.selected.id} entity={w.selected} label="载具详情">
          {(ed) => (
            <>
              <Photo editor={ed} name="imageAsset" label="载具图片" />
              <EntryField editor={ed} name="title" label="名称" />
              <DataField
                editor={ed}
                name="vehicleType"
                label="类型"
                options={types}
                fallback="水上"
              />
              <div className="fields-two">
                <Reference
                  editor={ed}
                  name="ownerCharacterId"
                  label="归属角色"
                  type="character"
                />
                <Reference
                  editor={ed}
                  name="ownerFactionId"
                  label="归属阵营"
                  type="faction"
                />
              </div>
              <EntryField editor={ed} name="summary" label="一句话简介" />
              <DataField editor={ed} name="appearance" label="外观" multiline />
              <Pairs
                editor={ed}
                name="stats"
                label="性能评分"
                score
                defaults={defaultStats(ed.e)}
              />
              <Pairs
                editor={ed}
                name="specs"
                label="规格参数"
                defaults={defaultSpecs(ed.e)}
              />
              <DataField
                editor={ed}
                name="upgrades"
                label="升级路线"
                multiline
              />
              <MultiPick
                label="可装备部件"
                rows={w.entities.filter((e) => e.entityType === 'item')}
                ids={strings(ed.e.data?.partItemIds)}
                change={(ids) => ed.data('partItemIds', ids)}
              />
              <EntryField editor={ed} name="body" label="备注" />
            </>
          )}
        </Detail>
      )}
    </div>
  )
}
