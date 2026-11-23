import { useRef, useState } from 'react'
import { Empty } from '../../components/ui'
import { withData } from '../../state/planning'
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
} from './WorldUI'
import {
  matches,
  numeric,
  rarities,
  rarity,
  useWorld,
  value,
} from './worldUtils'

const tabs = ['图鉴', '全部'],
  categories = ['货币', '外观', '关键物品', '奖杯', '收集品']
const numberOf = (e: Entity) => {
  const n = numeric(
    e.data?.seriesIndex === undefined ? e.data?.number : e.data.seriesIndex,
  )
  return n !== undefined && Number.isSafeInteger(n) && n > 0 ? n : 0
}
const label = (n: number) => '#' + String(n).padStart(2, '0')
type World = ReturnType<typeof useWorld>
function Toggle({ e, w }: { e: Entity; w: World }) {
  const on = e.data?.implemented === true
  return (
    <button
      className={'chip ' + (on ? 'active' : '')}
      aria-pressed={on}
      onClick={() => void w.run(() => w.save(withData(e, 'implemented', !on)))}
    >
      {on ? '✓ 已放进游戏' : '＋ 放进游戏'}
    </button>
  )
}
function Series({ name, rows, w }: { name: string; rows: Entity[]; w: World }) {
  const groups = new Map<number, Entity[]>(),
    busy = useRef(new Set<number>()),
    [page, setPage] = useState(0)
  let max = 0
  for (const e of rows) {
    const n = numberOf(e),
      target = numeric(e.data?.seriesSize ?? e.data?.seriesTargetCount) ?? 0
    max = Math.max(max, n, Number.isSafeInteger(target) ? target : 0)
    const list = groups.get(n) ?? []
    list.push(e)
    groups.set(n, list)
  }
  const numbers = [...groups.keys()].filter((n) => n > 0).sort((a, b) => a - b)
  const ranges: string[] = []
  function gap(start: number, end: number) {
    if (start > end) return
    if (end - start > 5) ranges.push(label(start) + '–' + label(end))
    else for (let i = start; i <= end; i++) ranges.push(label(i))
  }
  let previous = 0
  for (const n of numbers) {
    gap(previous + 1, n - 1)
    previous = n
  }
  gap(previous + 1, max)
  const total = max - numbers.length + rows.length,
    implemented = rows.filter((e) => e.data?.implemented === true).length
  const lastPage = Math.max(0, Math.ceil(max / 48) - 1),
    shown = Math.min(lastPage, page),
    start = shown * 48 + 1
  function card(e: Entity) {
    return (
      <Card
        key={e.id}
        entity={e}
        open={w.open}
        kind="collection"
        asset="iconAsset"
        badge={(numberOf(e) ? label(numberOf(e)) + ' · ' : '') + rarity(e)}
      >
        <div className="split">
          <Toggle e={e} w={w} />
          {e.data?.hidden === true && <span className="badge">隐藏</span>}
        </div>
      </Card>
    )
  }
  async function fill(n: number) {
    if (busy.current.has(n)) return
    busy.current.add(n)
    try {
      await w.create((name || '收集品') + ' ' + label(n), {
        series: name,
        seriesIndex: n,
        seriesSize: max,
        category: '收集品',
        rarity: '普通',
        implemented: false,
        hidden: false,
      })
    } finally {
      busy.current.delete(n)
    }
  }
  return (
    <section className="world-series stack">
      <header className="split">
        <div>
          <h2>{name || '未分组'}</h2>
          <small>
            {implemented} / {total} 已实装
          </small>
        </div>
        <progress max={total || 1} value={implemented} />
      </header>
      {!!ranges.length && (
        <div>
          <span className="world-warn">缺 {ranges.join(', ')}</span>
        </div>
      )}
      <div className="world-grid">
        {Array.from(
          { length: Math.min(48, Math.max(0, max - start + 1)) },
          (_, i) => {
            const n = start + i
            return (
              groups.get(n)?.map(card) ?? (
                <button
                  key={'gap' + n}
                  className="world-gap"
                  onClick={() => void fill(n)}
                >
                  <b>{label(n)}</b>
                  <span>＋ 补全 {label(n)}</span>
                </button>
              )
            )
          },
        )}
        {(groups.get(0) ?? []).map(card)}
      </div>
      {lastPage > 0 && (
        <div className="world-row-actions">
          <button disabled={!shown} onClick={() => setPage(shown - 1)}>
            上一页
          </button>
          <small>
            {shown + 1} / {lastPage + 1}
          </small>
          <button
            disabled={shown === lastPage}
            onClick={() => setPage(shown + 1)}
          >
            下一页
          </button>
        </div>
      )}
    </section>
  )
}
export default function CollectiblesView() {
  const w = useWorld('collectible', tabs[0]),
    [query, setQuery] = useState(''),
    [kind, setKind] = useState(''),
    [tier, setTier] = useState(''),
    [state, setState] = useState(''),
    [visibility, setVisibility] = useState('')
  const series = new Map<string, Entity[]>()
  for (const e of w.rows) {
    const name = value(e, 'series').trim(),
      rows = series.get(name) ?? []
    rows.push(e)
    series.set(name, rows)
  }
  const filtered = w.rows.filter(
    (e) =>
      matches(e, query) &&
      (!kind || kind === value(e, 'category', '收集品')) &&
      (!tier || tier === rarity(e)) &&
      (!state || (state === '已实装') === (e.data?.implemented === true)) &&
      (!visibility || (visibility === '隐藏') === (e.data?.hidden === true)),
  )
  return (
    <div className="world">
      <Heading title="收集品" tabs={tabs} active={w.tab} choose={w.switchTab}>
        <Add
          label="新建收集品"
          click={() =>
            void w.create('新收集品', { category: '收集品', rarity: '普通' })
          }
        />
      </Heading>
      {w.tab === tabs[0] ? (
        <div className="stack roomy">
          {[...series].map(([name, rows]) => (
            <Series key={name} name={name} rows={rows} w={w} />
          ))}
          {!series.size && <Empty>暂无收集品</Empty>}
        </div>
      ) : (
        <>
          <div className="world-filters">
            <SearchField label="搜索收集品" query={query} set={setQuery} />
            <Filter
              label="分类"
              options={categories}
              current={kind}
              change={setKind}
            />
            <Filter
              label="稀有度"
              options={rarities}
              current={tier}
              change={setTier}
            />
            <Filter
              label="实装状态"
              options={['已实装', '未实装']}
              current={state}
              change={setState}
            />
            <Filter
              label="隐藏状态"
              options={['隐藏', '可见']}
              current={visibility}
              change={setVisibility}
            />
          </div>
          <div className="world-table-wrap">
            <table className="world-table">
              <thead>
                <tr>
                  {['名称', '系列', '编号', '分类', '稀有度', '状态'].map(
                    (s) => (
                      <th key={s}>{s}</th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {filtered.map((e) => (
                  <tr key={e.id}>
                    <th>
                      <button onClick={() => w.open(e)}>{e.title}</button>{' '}
                      {e.data?.hidden === true && <small>隐藏</small>}
                    </th>
                    <td>{value(e, 'series') || '未分组'}</td>
                    <td>{numberOf(e) ? label(numberOf(e)) : '—'}</td>
                    <td>{value(e, 'category', '收集品')}</td>
                    <td>{rarity(e)}</td>
                    <td>
                      <Toggle e={e} w={w} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!filtered.length && <Empty>暂无匹配收集品</Empty>}
        </>
      )}
      {w.selected && (
        <Detail key={w.selected.id} entity={w.selected} label="收集品详情">
          {(ed) => (
            <>
              <Photo editor={ed} name="iconAsset" label="收集品图标" />
              <EntryField editor={ed} name="title" label="名称" />
              <div className="fields-two">
                <DataField
                  editor={ed}
                  name="category"
                  label="分类"
                  options={categories}
                  fallback="收集品"
                />
                <DataField
                  editor={ed}
                  name="rarity"
                  label="稀有度"
                  options={rarities}
                  fallback={rarity(ed.e)}
                />
                <DataField editor={ed} name="series" label="系列" />
                <DataField
                  editor={ed}
                  name="seriesIndex"
                  label="系列编号"
                  type="number"
                  min={1}
                  fallback={String(numberOf(ed.e) || '')}
                />
              </div>
              <DataField
                editor={ed}
                name="obtainMethod"
                label="获取方式"
                multiline
              />
              <DataField
                editor={ed}
                name="placement"
                label="放置位置"
                multiline
              />
              <Reference
                editor={ed}
                name="locationId"
                label="地点"
                type="location"
              />
              <Reference
                editor={ed}
                name="questId"
                label="关联任务"
                type="quest"
              />
              <div className="world-chips">
                {[
                  ['implemented', '已放进游戏'],
                  ['hidden', '隐藏收集品'],
                ].map(([key, text]) => (
                  <label key={key}>
                    <input
                      type="checkbox"
                      checked={ed.e.data?.[key] === true}
                      onChange={(ev) => ed.data(key, ev.target.checked)}
                    />{' '}
                    {text}
                  </label>
                ))}
              </div>
              <EntryField editor={ed} name="body" label="备注" />
            </>
          )}
        </Detail>
      )}
    </div>
  )
}
