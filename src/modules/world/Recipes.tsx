import { useEffect, useState } from 'react'
import { api } from '../../api/client'
import { Empty, Modal } from '../../components/ui'
import { useWorkspace } from '../../state/workspace'
import type { CraftingRecipe, Entity } from '../../types'
import { EntitySelect } from './WorldUI'
import { list, numeric, record, scalar, strings } from './worldUtils'

export function ingredients(r: CraftingRecipe) {
  return list(r.ingredients).map((v) => {
    const row = record(v)
    return {
      itemId: scalar(row.itemId),
      qty: numeric(row.qty ?? row.quantity) ?? 1,
    }
  })
}
export function useRecipes() {
  const { project, revision, notify } = useWorkspace(),
    [rows, setRows] = useState<CraftingRecipe[]>([])
  useEffect(() => {
    let live = true
    api
      .listRecipes(project.id)
      .then((recipes) => {
        if (live) setRows(recipes)
      })
      .catch((e) => {
        if (live) notify(String(e))
      })
    return () => {
      live = false
    }
  }, [project.id, revision, notify])
  return rows
}
export function newRecipe(
  projectId: string,
  outputItemId: string,
): CraftingRecipe {
  const stamp = new Date().toISOString()
  return {
    id: crypto.randomUUID(),
    projectId,
    outputItemId,
    outputQty: 1,
    ingredients: [],
    tools: [],
    note: '',
    createdAt: stamp,
    updatedAt: stamp,
  }
}
export function RecipeForm({
  initial,
  items,
  close,
  persist = api.saveRecipe,
  remove,
}: {
  initial: CraftingRecipe
  items: Entity[]
  close: () => void
  persist?: (r: CraftingRecipe) => Promise<void>
  remove?: () => Promise<void>
}) {
  const [output, setOutput] = useState(initial.outputItemId),
    [qty, setQty] = useState(String(initial.outputQty))
  const [parts, setParts] = useState(() =>
    ingredients(initial).map((p) => ({
      ...p,
      qty: String(p.qty),
      id: crypto.randomUUID(),
    })),
  )
  const [tools, setTools] = useState(strings(initial.tools)),
    [note, setNote] = useState(initial.note),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const ids = new Set(items.map((e) => e.id))
  const available = [
    ...items.map((e) => ({ id: e.id, title: e.title })),
    ...tools.filter((t) => !ids.has(t)).map((t) => ({ id: t, title: t })),
  ]
  const valid =
    ids.has(output) &&
    Number.isSafeInteger(+qty) &&
    +qty >= 1 &&
    parts.every(
      (p) => ids.has(p.itemId) && Number.isSafeInteger(+p.qty) && +p.qty >= 1,
    )
  async function save() {
    if (!valid || busy) return
    setBusy(true)
    try {
      await persist({
        ...initial,
        outputItemId: output,
        outputQty: +qty,
        ingredients: parts.map((p) => ({ itemId: p.itemId, qty: +p.qty })),
        tools,
        note,
        updatedAt: new Date().toISOString(),
      })
      close()
    } catch (e) {
      setError(String(e))
      setBusy(false)
    }
  }
  return (
    <Modal
      title={
        (items.find((e) => e.id === output)?.title ?? '物品') + ' 的配方设计'
      }
      onClose={() => {
        if (!busy) close()
      }}
    >
      <form
        onSubmit={(ev) => {
          ev.preventDefault()
          void save()
        }}
      >
        <div className="form-body stack">
          <p className="recipe-equation">
            {parts
              .map(
                (p) =>
                  (items.find((e) => e.id === p.itemId)?.title ?? '材料') +
                  ' ×' +
                  p.qty,
              )
              .join(' + ') || '无材料'}{' '}
            → {items.find((e) => e.id === output)?.title ?? '产物'} ×{qty}
          </p>
          <div className="fields-two">
            <label className="field">
              产出物品
              <EntitySelect
                label="产出物品"
                current={output}
                rows={items}
                change={setOutput}
                empty="选择产出物"
              />
            </label>
            <label className="field">
              产出数量
              <input
                type="number"
                min="1"
                step="1"
                required
                value={qty}
                onChange={(ev) => setQty(ev.target.value)}
              />
            </label>
          </div>
          <div className="split">
            <h3>消耗材料</h3>
            <button
              type="button"
              className="text-action"
              onClick={() =>
                setParts([
                  ...parts,
                  { id: crypto.randomUUID(), itemId: '', qty: '1' },
                ])
              }
            >
              ＋ 添加材料
            </button>
          </div>
          {parts.map((p) => (
            <div className="world-pair" key={p.id}>
              <EntitySelect
                label="材料物品"
                current={p.itemId}
                rows={items}
                change={(s) =>
                  setParts(
                    parts.map((x) => (x.id === p.id ? { ...x, itemId: s } : x)),
                  )
                }
                empty="选择材料"
              />
              <input
                type="number"
                min="1"
                step="1"
                required
                aria-label="材料数量"
                value={p.qty}
                onChange={(ev) =>
                  setParts(
                    parts.map((x) =>
                      x.id === p.id ? { ...x, qty: ev.target.value } : x,
                    ),
                  )
                }
              />
              <button
                type="button"
                onClick={() => setParts(parts.filter((x) => x.id !== p.id))}
              >
                移除
              </button>
            </div>
          ))}
          <fieldset className="world-options">
            <legend>工具 / 工位（不消耗）</legend>
            {available.map((o) => (
              <label key={o.id}>
                <input
                  type="checkbox"
                  checked={tools.includes(o.id)}
                  onChange={(ev) =>
                    setTools(
                      ev.target.checked
                        ? [...tools, o.id]
                        : tools.filter((t) => t !== o.id),
                    )
                  }
                />{' '}
                {o.title}
              </label>
            ))}
          </fieldset>
          <label className="field">
            配方备注
            <textarea
              value={note}
              onChange={(ev) => setNote(ev.target.value)}
            />
          </label>
          {error && <p role="alert">{error}</p>}
        </div>
        <footer className="modal-footer">
          {remove && (
            <button
              type="button"
              className="danger"
              disabled={busy}
              onClick={async () => {
                setBusy(true)
                try {
                  await remove()
                  close()
                } catch (e) {
                  setError(String(e))
                  setBusy(false)
                }
              }}
            >
              删除配方
            </button>
          )}
          <button
            type="button"
            className="secondary"
            onClick={close}
            disabled={busy}
          >
            取消
          </button>
          <button type="submit" className="primary" disabled={!valid || busy}>
            保存配方
          </button>
        </footer>
      </form>
    </Modal>
  )
}
export function RecipeList({
  recipes,
  items,
  edit,
  create,
}: {
  recipes: CraftingRecipe[]
  items: Entity[]
  edit: (r: CraftingRecipe) => void
  create: (id?: string) => void
}) {
  const { run, openEntity } = useWorkspace()
  const [remove, setRemove] = useState<CraftingRecipe>()
  const groups = new Map<string, CraftingRecipe[]>()
  for (const r of recipes) {
    const list = groups.get(r.outputItemId) ?? []
    list.push(r)
    groups.set(r.outputItemId, list)
  }
  const names = new Map(items.map((e) => [e.id, e.title]))
  return (
    <div className="stack">
      <div className="world-bar">
        <button
          className="secondary"
          disabled={!items.length}
          onClick={() => create()}
        >
          ＋ 新建配方
        </button>
      </div>
      {[...groups].map(([id, rows]) => (
        <section key={id} className="panel stack">
          <div className="split">
            <h2>{names.get(id) ?? '已移除的产出物'}</h2>
            <button className="text-action" onClick={() => create(id)}>
              ＋ 备选配方
            </button>
          </div>
          {rows.map((r) => (
            <div className="world-recipe" key={r.id}>
              <strong>产出 × {r.outputQty}</strong>
              <div className="world-chips">
                {ingredients(r).map((p, i) => {
                  const e = items.find((e) => e.id === p.itemId)
                  return (
                    <button
                      className="chip"
                      key={i}
                      disabled={!e}
                      onClick={() => e && openEntity(e)}
                    >
                      {e?.title ?? '已移除的材料'} × {p.qty}
                    </button>
                  )
                })}
              </div>
              <small>
                工具 / 工位 ·{' '}
                {strings(r.tools)
                  .map((t) => names.get(t) ?? t)
                  .join('、') || '无'}
              </small>
              {r.note && <p>{r.note}</p>}
              <div className="world-row-actions">
                <button onClick={() => edit(r)}>编辑配方</button>
                <button onClick={() => setRemove(r)}>删除配方</button>
              </div>
            </div>
          ))}
        </section>
      ))}
      {!groups.size && (
        <Empty>
          {items.length ? '暂无合成配方' : '先创建物品，再为它编写配方'}
        </Empty>
      )}
      {remove && (
        <Modal title="删除配方" onClose={() => setRemove(undefined)}>
          <div className="form-body">
            删除「{names.get(remove.outputItemId)}」的这条配方？
          </div>
          <footer className="modal-footer">
            <button className="secondary" onClick={() => setRemove(undefined)}>
              取消
            </button>
            <button
              className="danger"
              onClick={() =>
                void run(async () => {
                  await api.deleteRecipe(remove.id)
                  setRemove(undefined)
                })
              }
            >
              删除
            </button>
          </footer>
        </Modal>
      )}
    </div>
  )
}
export function CraftingSummary({
  entity,
  recipes,
  items,
  edit,
  create,
}: {
  entity: Entity
  recipes: CraftingRecipe[]
  items: Entity[]
  edit: (r: CraftingRecipe) => void
  create: () => void
}) {
  const { openEntity } = useWorkspace()
  const outputs = recipes.filter((r) => r.outputItemId === entity.id)
  const used = recipes.filter(
    (r) =>
      ingredients(r).some((p) => p.itemId === entity.id) ||
      strings(r.tools).includes(entity.id),
  )
  const byId = new Map(items.map((e) => [e.id, e]))
  function chip(id: string, label: string, key: string) {
    const target = byId.get(id)
    return (
      <button
        key={key}
        className="chip"
        disabled={!target}
        onClick={() => target && openEntity(target)}
      >
        {target?.title ?? id} {label}
      </button>
    )
  }
  return (
    <section className="stack">
      <div className="split">
        <h3>在合成体系中</h3>
        <button className="text-action" onClick={create}>
          ＋ 新建配方
        </button>
      </div>
      {outputs.map((r) => (
        <div className="world-subrow stack" key={r.id}>
          <div className="split">
            <b>产出 × {r.outputQty}</b>
            <button onClick={() => edit(r)}>编辑配方</button>
          </div>
          <div className="world-chips">
            {ingredients(r).map((p, i) =>
              chip(p.itemId, '× ' + p.qty, 'p' + i),
            )}
            {strings(r.tools).map((id, i) => chip(id, '（工具）', 't' + i))}
          </div>
        </div>
      ))}
      {!outputs.length && <small>暂无产出配方</small>}
      <h3>用于</h3>
      <div className="world-chips">
        {used.map((r) =>
          chip(
            r.outputItemId,
            strings(r.tools).includes(entity.id) ? '（工具）' : '（材料）',
            r.id,
          ),
        )}
        {!used.length && <small>暂无配方使用此物品</small>}
      </div>
    </section>
  )
}
