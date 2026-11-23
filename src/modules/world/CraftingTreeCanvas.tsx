import { useEffect, useRef, useState } from 'react'
import { api } from '../../api/client'
import { historyKey, useKeys } from '../../components/CanvasKit'
import type { useEntityCommands } from '../../components/entityCommands'
import { graphTiers } from '../../components/graphLayout'
import { NodeCanvas, type BoardControls } from '../../components/NodeCanvas'
import { useWorkspace } from '../../state/workspace'
import type { CraftingRecipe, Entity } from '../../types'
import { ingredients, newRecipe, RecipeList } from './Recipes'
import { numeric, rarities, rarity, strings, value } from './worldUtils'
const columns = ['原材料', '一级加工', '二级加工', '最终产物']
export default function CraftingTreeCanvas({
  items,
  recipes,
  edit,
  create,
  history,
}: {
  items: Entity[]
  recipes: CraftingRecipe[]
  edit: (r: CraftingRecipe) => void
  create: (id?: string) => void
  history: ReturnType<typeof useEntityCommands>
}) {
  const w = useWorkspace(),
    controls = useRef<BoardControls>(null),
    [listMode, setList] = useState(false),
    [editing, setEditing] = useState('')
  const edges = recipes.flatMap((r) => [
    ...ingredients(r).map((p, i) => ({
      id: r.id + '-m' + i,
      from: p.itemId,
      to: r.outputItemId,
      qty: p.qty,
      recipe: r,
      index: i,
      dashed: false,
      label: '×' + p.qty,
    })),
    ...strings(r.tools).map((id, i) => ({
      id: r.id + '-t' + i,
      from: id,
      to: r.outputItemId,
      qty: 1,
      recipe: r,
      index: i,
      dashed: true,
      label: '工具',
    })),
  ])
  const tiers = graphTiers(
      items.map((e) => e.id),
      edges,
    ),
    counts = [0, 0, 0, 0],
    colors = ['#70848a', '#478570', '#587da1', '#8d63a0', '#ad8033']
  const nodes = items.map((e) => {
    const col = Math.min(3, tiers.get(e.id) ?? 0),
      r = recipes.find((r) => r.outputItemId === e.id),
      img = value(e, 'iconAsset')
    const row = counts[col]++
    return {
      id: e.id,
      x: col * 242 + 16,
      y: numeric(e.data?.craftY) ?? row * 96 + 40,
      width: 172,
      height: 73,
      title: e.title,
      subtitle: rarity(e),
      icon: value(e, 'icon'),
      image: img ? api.assetUrl(img) : '',
      badge: r ? '产出 ×' + r.outputQty : '',
      color: colors[rarities.indexOf(rarity(e))] ?? colors[0],
    }
  })
  const edge = edges.find((e) => e.id === editing),
    names = new Map(items.map((e) => [e.id, e.title]))
  const height = Math.max(220, ...nodes.map((n) => n.y + n.height + 16))
  const hasRecipes = recipes.length > 0
  useEffect(() => {
    controls.current?.fit()
  }, [hasRecipes])
  async function arrange() {
    const moved = items.filter((e) => numeric(e.data?.craftY) !== undefined)
    if (moved.length)
      await history.change(
        moved.map((e) => ({ ...e, data: { ...e.data, craftY: null } })),
      )
    setEditing('')
    requestAnimationFrame(() => controls.current?.fit())
  }
  function change(before: CraftingRecipe | undefined, after: CraftingRecipe) {
    void history.commit(
      () => api.saveRecipe({ ...after, updatedAt: new Date().toISOString() }),
      () => (before ? api.saveRecipe(before) : api.deleteRecipe(after.id)),
    )
  }
  function connect(from: string, to: string | undefined, tool: boolean) {
    if (!to) return
    const old = recipes.find((r) => r.outputItemId === to),
      r = old ?? newRecipe(w.project.id, to)
    const parts = ingredients(r),
      tools = strings(r.tools)
    if (tool) {
      if (!tools.includes(from)) tools.push(from)
      else return
    } else {
      const found = parts.find((p) => p.itemId === from)
      if (found) found.qty++
      else parts.push({ itemId: from, qty: 1 })
    }
    change(old, { ...r, ingredients: parts, tools })
  }
  function editEdge(qty: number, tool: boolean, remove = false) {
    if (!edge || !Number.isSafeInteger(qty) || qty < 1) return
    const r = edge.recipe,
      parts = ingredients(r),
      tools = strings(r.tools)
    if (edge.dashed) tools.splice(edge.index, 1)
    else parts.splice(edge.index, 1)
    if (!remove) {
      if (tool) {
        if (!tools.includes(edge.from)) tools.push(edge.from)
      } else {
        const existing = parts.find((p) => p.itemId === edge.from)
        if (existing) existing.qty += qty
        else parts.push({ itemId: edge.from, qty })
      }
    }
    change(r, { ...r, ingredients: parts, tools })
    setEditing('')
  }
  function open(id: string) {
    const r = recipes.find((r) => r.outputItemId === id)
    if (r) edit(r)
    else create(id)
  }
  useKeys((e) => {
    if (historyKey(e, history)) return true
    if (e.key.toLowerCase() === 'f' && !e.ctrlKey) {
      controls.current?.fit()
      return true
    }
  })
  return (
    <section className="visual-editor">
      <div className="visual-tools">
        {!listMode && (
          <>
            <button onClick={arrange}>自动排布</button>
            <button onClick={() => controls.current?.fit()}>
              适配视野 (F)
            </button>
            <button disabled={!items.length} onClick={() => create()}>
              ＋ 新建配方
            </button>
          </>
        )}
        <button onClick={() => setList(!listMode)}>
          {listMode ? '切换合成树' : '切换列表视图'}
        </button>
        <button disabled={!history.canUndo} onClick={history.undo}>
          撤销
        </button>
        <button disabled={!history.canRedo} onClick={history.redo}>
          重做
        </button>
      </div>
      {listMode ? (
        <RecipeList {...{ items, recipes, edit, create }} />
      ) : (
        <div className="canvas-stage">
          <NodeCanvas
            label="合成树"
            nodes={nodes}
            edges={edges}
            controls={controls}
            selectedEdge={editing}
            extent={{
              x: 0,
              y: 0,
              width: 968,
              height,
            }}
            select={open}
            lockColumn
            move={(id, p) => {
              const item = items.find((e) => e.id === id)!
              void history.change([
                { ...item, data: { ...item.data, craftY: Math.max(40, p.y) } },
              ])
            }}
            connect={(from, to, _p, alt) => connect(from, to, alt)}
            edge={setEditing}
            background={(ctx, s) =>
              columns.forEach((c, i) => {
                ctx.fillStyle = s.colors.muted
                ctx.font = 'bold 15px system-ui'
                ctx.fillText(c, i * 242 + 16, 17)
                ctx.fillStyle = s.colors.line
                ctx.fillRect(i * 242 - 13, 0, 1, height)
              })
            }
          />
          {edge && (
            <form
              key={edge.id}
              className="canvas-pop stack"
              onSubmit={(ev) => {
                ev.preventDefault()
                const f = new FormData(ev.currentTarget)
                editEdge(Number(f.get('qty')), f.get('tool') === 'on')
              }}
            >
              <b>
                {names.get(edge.from)} → {names.get(edge.to)}
              </b>
              <label className="field">
                数量
                <input
                  type="number"
                  min="1"
                  step="1"
                  required
                  name="qty"
                  defaultValue={edge.qty}
                />
              </label>
              <label>
                <input
                  type="checkbox"
                  name="tool"
                  defaultChecked={edge.dashed}
                />{' '}
                工具（不消耗）
              </label>
              <div>
                <button>保存</button>
                <button type="button" onClick={() => editEdge(1, false, true)}>
                  移除
                </button>
                <button type="button" onClick={() => setEditing('')}>
                  关闭
                </button>
              </div>
            </form>
          )}
        </div>
      )}
    </section>
  )
}
