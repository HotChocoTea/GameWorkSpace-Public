import { useState } from 'react'
import { useEntityCommands } from '../../components/entityCommands'
import CraftingTreeCanvas from './CraftingTreeCanvas'
import { api } from '../../api/client'
import { Empty } from '../../components/ui'
import { withData } from '../../state/planning'
import { useWorkspace } from '../../state/workspace'
import type { CraftingRecipe, Entity, Json } from '../../types'
import {
  Add,
  Card,
  DataField,
  Detail,
  EntryField,
  Filter,
  Heading,
  Pairs,
  Photo,
  SearchField,
  Select,
} from './WorldUI'
import { CraftingSummary, newRecipe, RecipeForm, useRecipes } from './Recipes'
import {
  matches,
  numeric,
  rarities,
  rarity,
  rowsOf,
  scalar,
  useWorld,
  value,
} from './worldUtils'

const categories = [
  '材料',
  '消耗品',
  '武器',
  '防具',
  '工具',
  '关键物品',
  '部件',
  '其他',
]
const tabs = ['图鉴', '数据表', '合成树']
const rarityColors = ['#899299', '#548d74', '#4a85ac', '#8f68aa', '#b58a36']
const stackLimit = (e: Entity) =>
  numeric(
    e.data?.stackLimit === undefined ? e.data?.stack : e.data.stackLimit,
  ) ?? 1
const attributes = (e: Entity) =>
  rowsOf(e, 'attributes')
    .map((r) => scalar(r.key) + ' ' + scalar(r.value))
    .join(' / ')
const category = (e: Entity) => value(e, 'category', '其他')

function NumberCell({
  n,
  label,
  min,
  save,
  step = 1,
}: {
  n: number
  label: string
  min: number
  save: (n: number) => void
  step?: number | 'any'
}) {
  const [draft, setDraft] = useState<string | null>(null)
  function commit() {
    const next = Number(draft)
    if (
      draft !== null &&
      draft.trim() !== '' &&
      (step === 'any' ? Number.isFinite(next) : Number.isSafeInteger(next)) &&
      next >= min &&
      n !== next
    )
      save(next)
    setDraft(null)
  }
  return (
    <input
      aria-label={label}
      type="number"
      min={min}
      step={step}
      value={draft ?? n}
      onChange={(ev) => setDraft(ev.target.value)}
      onBlur={commit}
      onKeyDown={(ev) => {
        if (ev.key === 'Enter') ev.currentTarget.blur()
      }}
    />
  )
}
function DataTable({
  items,
  recipes,
  open,
}: {
  items: Entity[]
  recipes: CraftingRecipe[]
  open: (e: Entity) => void
}) {
  const { run, save } = useWorkspace(),
    [sort, setSort] = useState({ col: 0, asc: true })
  const counts = new Map<string, number>()
  for (const r of recipes)
    counts.set(r.outputItemId, (counts.get(r.outputItemId) ?? 0) + 1)
  const columns = [
    '名称',
    '分类',
    '稀有度',
    '价格',
    '堆叠上限',
    '主要属性',
    '配方数',
  ]
  function sortKey(e: Entity) {
    return [
      e.title,
      category(e),
      rarities.indexOf(rarity(e)),
      numeric(e.data?.price) ?? 0,
      stackLimit(e),
      attributes(e),
      counts.get(e.id) ?? 0,
    ][sort.col]
  }
  const sorted = [...items].sort((a, b) => {
    const x = sortKey(a),
      y = sortKey(b)
    const cmp =
      typeof x === 'number' && typeof y === 'number'
        ? x - y
        : String(x).localeCompare(String(y), 'zh-CN', { numeric: true })
    return sort.asc ? cmp : -cmp
  })
  function update(e: Entity, k: string, v: Json) {
    void run(() => save(withData(e, k, v)))
  }
  return (
    <div className="world-table-wrap">
      <table className="world-table dense">
        <caption>物品数据表</caption>
        <thead>
          <tr>
            {columns.map((c, i) => (
              <th
                key={c}
                aria-sort={
                  sort.col === i
                    ? sort.asc
                      ? 'ascending'
                      : 'descending'
                    : 'none'
                }
              >
                <button
                  onClick={() =>
                    setSort({ col: i, asc: sort.col === i ? !sort.asc : true })
                  }
                >
                  {c} {sort.col === i ? (sort.asc ? '↑' : '↓') : '↕'}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((e) => (
            <tr key={e.id}>
              <th>
                <button onClick={() => open(e)}>{e.title}</button>
              </th>
              <td>
                <Select
                  label={e.title + '分类'}
                  options={categories}
                  current={category(e)}
                  change={(s) => update(e, 'category', s)}
                />
              </td>
              <td>
                <Select
                  label={e.title + '稀有度'}
                  options={rarities}
                  current={rarity(e)}
                  change={(s) => update(e, 'rarity', s)}
                />
              </td>
              <td>
                <NumberCell
                  n={numeric(e.data?.price) ?? 0}
                  step="any"
                  min={0}
                  label={e.title + '价格'}
                  save={(n) => update(e, 'price', n)}
                />
              </td>
              <td>
                <NumberCell
                  n={stackLimit(e)}
                  min={1}
                  label={e.title + '堆叠上限'}
                  save={(n) => update(e, 'stackLimit', n)}
                />
              </td>
              <td>{attributes(e) || '—'}</td>
              <td>{counts.get(e.id) ?? 0}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
export default function InventoryView() {
  const w = useWorld('item', tabs[0]),
    recipes = useRecipes(),
    [editing, setEditing] = useState<CraftingRecipe>()
  const history = useEntityCommands()
  const [query, setQuery] = useState(''),
    [kind, setKind] = useState(''),
    [tier, setTier] = useState('')
  const cards = w.rows.filter(
    (e) =>
      matches(e, query) &&
      (!kind || category(e) === kind) &&
      (!tier || rarity(e) === tier),
  )
  function createRecipe(id?: string) {
    setEditing(newRecipe(w.project.id, id ?? w.rows[0]?.id ?? ''))
  }
  return (
    <div className="world">
      <Heading title="物品" tabs={tabs} active={w.tab} choose={w.switchTab}>
        <Add
          label="新建物品"
          click={() =>
            void w.create('新物品', {
              category: kind || '材料',
              rarity: tier || '普通',
              price: 0,
              stackLimit: 1,
            })
          }
        />
      </Heading>
      {w.tab !== tabs[2] && (
        <div className="world-filters">
          <SearchField label="搜索物品" query={query} set={setQuery} />
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
        </div>
      )}
      {w.tab === tabs[0] && (
        <div className="world-grid">
          {cards.map((e) => (
            <Card
              key={e.id}
              entity={e}
              open={w.open}
              asset="iconAsset"
              kind="item"
              badge={rarity(e) + ' · ' + category(e)}
              color={rarityColors[rarities.indexOf(rarity(e))]}
            />
          ))}
        </div>
      )}
      {w.tab === tabs[1] && (
        <DataTable items={cards} recipes={recipes} open={w.open} />
      )}
      {w.tab !== tabs[2] && !cards.length && <Empty>暂无匹配物品</Empty>}
      {w.tab === tabs[2] && (
        <CraftingTreeCanvas
          history={history}
          recipes={recipes}
          items={w.rows}
          edit={setEditing}
          create={createRecipe}
        />
      )}
      {w.selected && (
        <Detail key={w.selected.id} entity={w.selected} label="物品详情">
          {(ed) => (
            <>
              <Photo editor={ed} name="iconAsset" label="物品图标" />
              <EntryField editor={ed} name="title" label="名称" />
              <EntryField editor={ed} name="summary" label="一句话简介" />
              <div className="fields-two">
                <DataField
                  editor={ed}
                  name="category"
                  label="分类"
                  options={categories}
                  fallback="其他"
                />
                <DataField
                  editor={ed}
                  name="rarity"
                  label="稀有度"
                  options={rarities}
                  fallback={rarity(ed.e)}
                />
                <DataField
                  editor={ed}
                  name="price"
                  step="any"
                  label="价格"
                  type="number"
                  min={0}
                  fallback="0"
                />
                <DataField
                  editor={ed}
                  name="stackLimit"
                  label="堆叠上限"
                  type="number"
                  min={1}
                  fallback={String(stackLimit(ed.e))}
                />
              </div>
              <Pairs
                editor={ed}
                name="attributes"
                label="自定义属性"
                keyName="key"
              />
              <DataField editor={ed} name="effect" label="使用效果" multiline />
              <DataField
                editor={ed}
                name="obtainMethod"
                label="获取方式"
                multiline
              />
              <EntryField editor={ed} name="body" label="设计笔记" />
              <CraftingSummary
                entity={ed.e}
                recipes={recipes}
                items={w.rows}
                edit={setEditing}
                create={() => createRecipe(ed.e.id)}
              />
            </>
          )}
        </Detail>
      )}
      {editing && (
        <RecipeForm
          key={editing.id}
          initial={editing}
          remove={
            recipes.some((r) => r.id === editing.id)
              ? () =>
                  history.commit(
                    () => api.deleteRecipe(editing.id),
                    () => api.saveRecipe(editing),
                  )
              : undefined
          }
          persist={(next) => {
            const before = recipes.find((r) => r.id === next.id)
            return history.commit(
              () => api.saveRecipe(next),
              () =>
                before ? api.saveRecipe(before) : api.deleteRecipe(next.id),
            )
          }}
          items={w.rows}
          close={() => setEditing(undefined)}
        />
      )}
    </div>
  )
}
