import { useState } from 'react'
import { Empty } from '../../components/ui'
import { useWorkspace } from '../../state/workspace'
import type { Entity } from '../../types'
import {
  Add,
  Card,
  DataField,
  Detail,
  EntryField,
  Filter,
  Heading,
  Photo,
  Reference,
  SearchField,
  Tree,
} from './WorldUI'
import {
  list,
  matches,
  parentsFor,
  record,
  strings,
  useWorld,
  value,
} from './worldUtils'

const types = [
  '城镇',
  '村庄',
  '遗迹',
  '地下城',
  '建筑',
  '自然地貌',
  '海域',
  '据点',
  '秘境',
  '其他',
]
const tabs = ['卡片', '层级']
const kinds = [
  ['quest', '任务线'],
  ['faction', '阵营'],
  ['collectible', '收集品'],
  ['scene', '场景'],
]
function Hierarchy({
  rows,
  open,
}: {
  rows: Entity[]
  open: (e: Entity) => void
}) {
  const { entities, links, maps, selected } = useWorkspace()
  const locations = new Map(rows.map((e) => [e.id, e]))
  const references = new Map<string, Set<string>>()
  function add(loc: string, id: string) {
    if (!locations.has(loc)) return
    if (!references.has(loc)) references.set(loc, new Set())
    references.get(loc)!.add(id)
  }
  for (const l of links) {
    add(l.sourceId, l.targetId)
    add(l.targetId, l.sourceId)
  }
  for (const e of entities) {
    add(value(e, 'locationId'), e.id)
    add(value(e, 'hqLocationId'), e.id)
    for (const loc of strings(e.data?.locationIds)) add(loc, e.id)
  }
  for (const e of rows)
    for (const [type] of kinds) {
      const one = value(e, type + 'Id')
      if (one) add(e.id, one)
      for (const id of strings(e.data?.[type + 'Ids'])) add(e.id, id)
    }
  const pins = new Map<string, number>()
  for (const m of maps)
    for (const p of list(m.pins)) {
      const pin = record(p),
        id = String(pin.entityId ?? pin.locationId ?? '')
      pins.set(id, (pins.get(id) ?? 0) + 1)
    }
  return (
    <div className="panel">
      <Tree
        rows={rows}
        selected={selected}
        render={(e) => (
          <>
            <button className="tree-name" onClick={() => open(e)}>
              {e.title}
            </button>
            <div className="world-counts">
              {kinds.map(([type, label]) => (
                <small key={type}>
                  {label}{' '}
                  {
                    entities.filter(
                      (other) =>
                        other.entityType === type &&
                        references.get(e.id)?.has(other.id),
                    ).length
                  }
                </small>
              ))}
              <small>地图图钉 {pins.get(e.id) ?? 0}</small>
            </div>
          </>
        )}
      />
    </div>
  )
}
export default function LocationsView() {
  const w = useWorld('location', tabs[0]),
    [query, setQuery] = useState(''),
    [kind, setKind] = useState('')
  const cards = w.rows.filter(
    (e) =>
      matches(e, query) && (!kind || kind === value(e, 'locationType', '其他')),
  )
  return (
    <div className="world">
      <Heading title="地点" tabs={tabs} active={w.tab} choose={w.switchTab}>
        <Add
          label="新建地点"
          click={() =>
            void w.create('新地点', { locationType: kind || '其他' })
          }
        />
      </Heading>
      {w.tab === tabs[0] ? (
        <>
          <div className="world-filters">
            <SearchField query={query} set={setQuery} label="搜索地点" />
            <Filter
              label="地点类型"
              current={kind}
              options={types}
              change={setKind}
            />
          </div>
          <div className="world-grid">
            {cards.map((e) => (
              <Card
                key={e.id}
                kind="landscape"
                entity={e}
                asset="coverAsset"
                open={w.open}
                badge={value(e, 'locationType', '其他')}
              />
            ))}
          </div>
          {!cards.length && <Empty>暂无匹配地点</Empty>}
        </>
      ) : (
        <Hierarchy rows={w.rows} open={w.open} />
      )}
      {w.selected && (
        <Detail key={w.selected.id} entity={w.selected} label="地点详情">
          {(ed) => (
            <>
              <Photo editor={ed} name="coverAsset" label="地点封面" />
              <EntryField editor={ed} name="title" label="名称" />
              <div className="fields-two">
                <DataField
                  editor={ed}
                  name="locationType"
                  label="类型"
                  options={types}
                  fallback="其他"
                />
                <Reference
                  editor={ed}
                  name="parentId"
                  label="上级地点"
                  rows={parentsFor(ed.e, w.rows)}
                  empty="根目录"
                />
              </div>
              <EntryField editor={ed} name="summary" label="一句话简介" />
              <EntryField editor={ed} name="body" label="地点描述" />
              <DataField
                editor={ed}
                name="features"
                label="玩法特色"
                multiline
              />
              <DataField
                editor={ed}
                name="inhabitants"
                label="居民与生物"
                multiline
              />
            </>
          )}
        </Detail>
      )}
    </div>
  )
}
