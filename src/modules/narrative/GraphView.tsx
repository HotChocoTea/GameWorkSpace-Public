import { useRef, useState } from 'react'
import { api } from '../../api/client'
import { historyKey, useKeys, type Point } from '../../components/CanvasKit'
import { useEntityCommands } from '../../components/entityCommands'
import {
  NodeCanvas,
  type BoardControls,
  type BoardEdge,
  type BoardNode,
} from '../../components/NodeCanvas'
import { newEntity } from '../../state/catalog'
import { link } from '../../state/planning'
import { useWorkspace } from '../../state/workspace'
import type { Entity, EntityLink } from '../../types'
import { Heading, SearchField } from '../world/WorldUI'
import { list, numeric, record, scalar, value } from '../world/worldUtils'

const kinds: Record<string, [string, string]> = {
  character: ['角色', '#447f94'],
  faction: ['阵营', '#9670a3'],
  location: ['地点', '#448b70'],
  lore: ['设定', '#a67b47'],
  quest: ['任务', '#477eae'],
  scene: ['场景', '#b56c80'],
  vehicle: ['载具', '#688391'],
  item: ['物品', '#9c843e'],
  doc: ['文档', '#7267a1'],
}
const kindOf = (e: Entity) =>
  e.entityType === 'collectible' ? 'item' : e.entityType
const fieldLabels: Record<string, string> = {
  homeId: '家乡',
  factionId: '所属阵营',
  parentId: '上级',
  hqLocationId: '总部',
  ownerCharacterId: '所有人',
  ownerFactionId: '所属阵营',
  partItemIds: '部件',
  giverId: '委托人',
  locationId: '地点',
  questId: '任务线',
  castIds: '出场',
  revealQuestId: '揭示任务',
  prerequisites: '前置',
  characterId: '成员',
  targetId: '关系',
}
function fieldEdges(entities: Entity[], manual: EntityLink[]) {
  const pair = (a: string, b: string) => (a < b ? a + '|' + b : b + '|' + a)
  const seen = new Set(manual.map((l) => pair(l.sourceId, l.targetId))),
    ids = new Set(entities.map((e) => e.id)),
    result: BoardEdge[] = []
  for (const e of entities) {
    function add(to: string, label: string) {
      const key = pair(e.id, to)
      if (to === e.id || !ids.has(to) || seen.has(key)) return
      seen.add(key)
      result.push({
        id: 'ref-' + key,
        from: e.id,
        to,
        label,
        dashed: true,
        editable: false,
      })
    }
    for (const [k, label] of Object.entries(fieldLabels)) {
      const v = e.data?.[k]
      if (Array.isArray(v)) v.forEach((id) => add(scalar(id), label))
      else add(scalar(v), label)
    }
    list(e.data?.members).forEach((v) =>
      add(scalar(record(v).characterId ?? v), '成员'),
    )
    Object.entries(record(e.data?.diplomacy)).forEach(([id, v]) =>
      add(id, scalar(v, '外交')),
    )
    list(e.data?.relations).forEach((v) =>
      add(scalar(record(v).targetId), '外交'),
    )
  }
  return result
}
type Particle = Point & { vx: number; vy: number; pin: boolean }
// Run the force model in a wider coordinate space to leave room for names.
const horizontalScale = 2.25
function simulate(
  nodes: BoardNode[],
  edges: BoardEdge[],
  particles: Map<string, Particle>,
  heat: number,
  held?: string,
) {
  const cells = new Map<string, Particle[]>(),
    size = 195
  for (const n of nodes) {
    const p = particles.get(n.id)!,
      key =
        Math.floor(p.x / (size * horizontalScale)) +
        ',' +
        Math.floor(p.y / size)
    if (!cells.has(key)) cells.set(key, [])
    cells.get(key)!.push(p)
  }
  for (const n of nodes) {
    const p = particles.get(n.id)!
    if (p.pin || held === n.id) continue
    const x = Math.floor(p.x / (size * horizontalScale)),
      y = Math.floor(p.y / size)
    for (let i = x - 1; i <= x + 1; i++)
      for (let j = y - 1; j <= y + 1; j++)
        for (const b of cells.get(i + ',' + j) ?? []) {
          if (b === p) continue
          const dx = (p.x - b.x) / horizontalScale,
            dy = p.y - b.y,
            d2 = Math.max(36, dx * dx + dy * dy),
            factor = (heat * 3200) / (d2 * Math.sqrt(d2))
          p.vx += dx * factor * horizontalScale
          p.vy += dy * factor
        }
    p.vx -= p.x * 0.0008 * heat
    p.vy -= p.y * 0.0008 * heat
  }
  for (const e of edges) {
    const a = particles.get(e.from)!,
      b = particles.get(e.to)!,
      dx = (b.x - a.x) / horizontalScale,
      dy = b.y - a.y,
      d = Math.hypot(dx, dy) || 1,
      k = ((d - 146) * 0.005 * heat) / d
    if (!a.pin) {
      a.vx += dx * k * horizontalScale
      a.vy += dy * k
    }
    if (!b.pin) {
      b.vx -= dx * k * horizontalScale
      b.vy -= dy * k
    }
  }
  for (const n of nodes) {
    const p = particles.get(n.id)!
    if (p.pin || held === n.id) {
      p.vx = 0
      p.vy = 0
    } else {
      p.x += p.vx *= 0.78
      p.y += p.vy *= 0.78
    }
    n.x = p.x
    n.y = p.y
  }
}
export default function GraphView() {
  const w = useWorkspace(),
    history = useEntityCommands(),
    board = useRef<BoardControls>(null)
  const [filters, setFilters] = useState(Object.keys(kinds)),
    [manual, setManual] = useState(true),
    [fields, setFields] = useState(true),
    [labels, setLabels] = useState(false)
  const [query, setQuery] = useState(''),
    [selected, select] = useState(''),
    [editing, setEditing] = useState(''),
    [adding, setAdding] = useState(false),
    [title, setTitle] = useState(''),
    [kind, setKind] = useState('character')
  const particles = useRef(new Map<string, Particle>()),
    heat = useRef(1),
    lastShape = useRef('')
  const rows = w.entities.filter((e) => kinds[kindOf(e)]),
    visible = rows.filter((e) => filters.includes(kindOf(e))),
    ids = new Set(visible.map((e) => e.id))
  const nodes = visible.map((e, i) => {
    let p = particles.current.get(e.id)
    const x = numeric(e.data?.graphX),
      y = numeric(e.data?.graphY)
    if (!p) {
      const angle = i * 2.39996,
        r = Math.sqrt(i) * 38
      p = {
        x: Math.cos(angle) * r * horizontalScale,
        y: Math.sin(angle) * r,
        vx: 0,
        vy: 0,
        pin: false,
      }
      particles.current.set(e.id, p)
    }
    p.pin = x !== undefined && y !== undefined
    if (p.pin) {
      p.x = x!
      p.y = y!
    }
    const img =
      value(e, 'avatarAsset') ||
      value(e, 'coverAsset') ||
      value(e, 'imageAsset') ||
      value(e, 'iconAsset')
    return {
      x: p.x,
      y: p.y,
      id: e.id,
      width: 42,
      height: 42,
      circle: true,
      title: e.title,
      icon: value(e, 'icon', e.title.slice(0, 1)),
      image: img ? api.assetUrl(img) : '',
      color: kinds[kindOf(e)][1],
    }
  })
  const edges = [
    ...(manual
      ? w.links.map((l) => ({
          id: l.id,
          from: l.sourceId,
          to: l.targetId,
          label: l.relationLabel,
        }))
      : []),
    ...(fields ? fieldEdges(rows, w.links) : []),
  ]
    .filter((e) => ids.has(e.from) && ids.has(e.to))
    .map((e) => ({ ...e, label: labels ? e.label : '' }))
  const shape =
    nodes.map((n) => n.id).join('|') + edges.map((e) => e.id).join('|')
  if (shape !== lastShape.current) {
    lastShape.current = shape
    heat.current = 1
  }
  const edit = w.links.find((l) => l.id === editing)
  const latest = useRef(w)
  latest.current = w
  function pin(id: string, p?: Point) {
    const e = latest.current.entities.find((e) => e.id === id)
    if (!e) return Promise.resolve()
    const data = { ...e.data }
    if (p) {
      data.graphX = p.x
      data.graphY = p.y
    } else {
      delete data.graphX
      delete data.graphY
    }
    return latest.current.save({ ...e, data })
  }
  function connect(from: string, to?: string) {
    if (!to) return
    const l = link(w.project.id, from, to, '关联')
    void history.commit(
      () => api.saveLink(l),
      () => api.deleteLink(l.id),
    )
    setEditing(l.id)
  }
  useKeys((e) => {
    if (historyKey(e, history)) return true
    if (e.key.toLowerCase() === 'f' && !e.ctrlKey) {
      board.current?.fit()
      return true
    }
  })
  return (
    <section className="world visual-editor">
      <Heading title="关系网">
        <button onClick={() => setAdding(!adding)}>＋ 添加节点</button>
      </Heading>
      <div className="visual-tools">
        <SearchField
          label="找一个名字…"
          query={query}
          set={(q) => {
            setQuery(q)
            const n = nodes.find(
              (n) =>
                q.trim() &&
                n.title.toLowerCase().includes(q.trim().toLowerCase()),
            )
            if (n) {
              select(n.id)
              board.current?.focus(n.id)
            }
          }}
        />
        <button
          onClick={() => {
            heat.current = 1
            board.current?.fit()
          }}
        >
          整理布局
        </button>
        <button onClick={() => board.current?.fit()}>适配视野 (F)</button>
        <button disabled={!history.canUndo} onClick={history.undo}>
          撤销
        </button>
        <button disabled={!history.canRedo} onClick={history.redo}>
          重做
        </button>
      </div>
      <div className="canvas-stage">
        <NodeCanvas
          label="项目关系网"
          controls={board}
          nodes={nodes}
          edges={edges}
          selected={selected}
          selectedEdge={editing}
          neighborhood
          step={(ns, held) => {
            if (heat.current < 0.009) return false
            simulate(ns, edges, particles.current, heat.current, held)
            heat.current *= 0.977
            return true
          }}
          select={(id) => {
            select(id)
            setEditing('')
          }}
          open={(id) => {
            const e = rows.find((e) => e.id === id)
            if (e) w.openEntity(e)
          }}
          move={(id, p) => {
            const e = rows.find((e) => e.id === id)!,
              x = numeric(e.data?.graphX),
              y = numeric(e.data?.graphY)
            void history.commit(
              () => pin(id, p),
              () =>
                pin(
                  id,
                  x !== undefined && y !== undefined ? { x, y } : undefined,
                ),
            )
          }}
          connect={connect}
          edge={(id) => {
            if (w.links.some((l) => l.id === id)) setEditing(id)
          }}
        />
        {adding && (
          <form
            className="canvas-pop stack"
            onSubmit={(ev) => {
              ev.preventDefault()
              const e = newEntity(w.project.id, kind, title.trim() || '未命名'),
                p = board.current?.center()
              e.data = p ? { graphX: p.x, graphY: p.y } : {}
              void history.change([e])
              setAdding(false)
              setTitle('')
              select(e.id)
            }}
          >
            <b>添加节点</b>
            <select
              aria-label="节点类型"
              value={kind}
              onChange={(e) => setKind(e.target.value)}
            >
              <option value="character">角色</option>
              <option value="location">地点</option>
            </select>
            <input
              aria-label="节点名称"
              placeholder="名称"
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            <button className="primary">创建</button>
            <button type="button" onClick={() => setAdding(false)}>
              取消
            </button>
          </form>
        )}
        {edit && (
          <form
            key={edit.id}
            className="canvas-pop stack"
            onSubmit={(ev) => {
              ev.preventDefault()
              const relationLabel =
                String(new FormData(ev.currentTarget).get('name')).trim() ||
                '关联'
              void history.commit(
                () => api.saveLink({ ...edit, relationLabel }),
                () => api.saveLink(edit),
              )
              setEditing('')
            }}
          >
            <label className="field">
              关系名称
              <input name="name" defaultValue={edit.relationLabel} />
            </label>
            <div>
              <button>保存</button>
              <button
                type="button"
                onClick={() => {
                  void history.commit(
                    () => api.deleteLink(edit.id),
                    () => api.saveLink(edit),
                  )
                  setEditing('')
                }}
              >
                删除
              </button>
              <button type="button" onClick={() => setEditing('')}>
                关闭
              </button>
            </div>
          </form>
        )}
      </div>
      <div className="visual-tools graph-filters">
        {Object.entries(kinds).map(([id, [label, color]]) => (
          <button
            key={id}
            aria-pressed={filters.includes(id)}
            style={{ borderBottomColor: color }}
            onClick={() =>
              setFilters(
                filters.includes(id)
                  ? filters.filter((k) => k !== id)
                  : [...filters, id],
              )
            }
          >
            {label}
          </button>
        ))}
        {(
          [
            [manual, setManual, '手动关联'],
            [fields, setFields, '字段引用'],
            [labels, setLabels, '关系名称'],
          ] as const
        ).map(([on, set, label]) => (
          <label key={label}>
            <input
              type="checkbox"
              checked={on}
              onChange={(ev) => set(ev.target.checked)}
            />{' '}
            {label}
          </label>
        ))}
        <small>
          {nodes.length} 个节点 · {edges.length} 条关系
        </small>
      </div>
    </section>
  )
}
