import { useRef, useState } from 'react'
import { historyKey, useKeys, type Point } from '../../components/CanvasKit'
import { useEntityCommands } from '../../components/entityCommands'
import { graphTiers } from '../../components/graphLayout'
import { NodeCanvas, type BoardControls } from '../../components/NodeCanvas'
import type { Entity } from '../../types'
import { list, record, rowsOf, scalar, type Data } from '../world/worldUtils'
export const flowTypes = [
  '目标',
  '对话',
  '抉择',
  '探索',
  '战斗',
  '解谜',
  '过场',
  '奖励',
  '结局',
  '失败',
]
const legacy: Record<string, string> = {
  start: '目标',
  action: '目标',
  collect: '探索',
  dialogue: '对话',
  condition: '抉择',
  choice: '抉择',
  reward: '奖励',
  end: '结局',
  failure: '失败',
}
const colors = [
  '#518698',
  '#8569a5',
  '#ad8239',
  '#528d71',
  '#b36057',
  '#537aa3',
  '#8f779b',
  '#a48142',
  '#39836e',
  '#b65d68',
]
type FlowNode = Data & {
  id: string
  type: string
  label: string
  x: number
  y: number
}
type Edge = Data & { id: string; from: string; to: string; label: string }
const typeName = (n: FlowNode) => legacy[n.type] ?? n.type
const terminal = (n: FlowNode) => ['结局', '失败'].includes(typeName(n))
export function analyzeFlow(nodes: FlowNode[], edges: Edge[]) {
  const ids = new Set(nodes.map((n) => n.id)),
    ends = nodes.filter(terminal)
  const outgoing = new Map(nodes.map((n) => [n.id, [] as Edge[]])),
    incoming = new Map(nodes.map((n) => [n.id, [] as string[]]))
  const stops = new Set(ends.map((n) => n.id))
  for (const e of edges)
    if (ids.has(e.from) && ids.has(e.to) && !stops.has(e.from)) {
      outgoing.get(e.from)!.push(e)
      incoming.get(e.to)!.push(e.from)
    }
  const start =
    nodes.find((n) => n.type === 'start') ??
    nodes.find((n) => !incoming.get(n.id)?.length) ??
    nodes[0]
  function visit(seeds: string[], next: (id: string) => string[]) {
    const stack = [...seeds],
      seen = new Set<string>()
    while (stack.length) {
      const id = stack.pop()!
      if (seen.has(id)) continue
      seen.add(id)
      for (const child of next(id)) stack.push(child)
    }
    return seen
  }
  const reached = visit(start ? [start.id] : [], (id) =>
      outgoing.get(id)!.map((e) => e.to),
    ),
    productive = visit([...stops], (id) => incoming.get(id)!)
  return {
    start,
    outgoing,
    ends,
    dead: nodes.filter((n) => !productive.has(n.id)),
    unreachable: nodes.filter((n) => !reached.has(n.id)),
  }
}
export default function QuestFlowEditor({
  quest,
  back,
}: {
  quest: Entity
  back: () => void
}) {
  const history = useEntityCommands(),
    board = useRef<BoardControls>(null)
  const [selection, select] = useState(''),
    [edgeId, setEdge] = useState(''),
    [walk, setWalk] = useState<string[] | null>(null)
  const nodes: FlowNode[] = rowsOf(quest, 'nodes').map((n, i) => ({
    ...n,
    type: scalar(n.type, '目标'),
    label: scalar(n.label, '目标'),
    x: Number(n.x) || 0,
    y: Number(n.y ?? i * 80) || 0,
  }))
  const edges: Edge[] = list(quest.data?.edges).map((v, i) => {
    const e = record(v)
    return {
      ...e,
      id: scalar(e.id, 'edge-' + i),
      from: scalar(e.from),
      to: scalar(e.to),
      label: scalar(e.label),
    }
  })
  const analysis = analyzeFlow(nodes, edges),
    active = walk && nodes.find((n) => n.id === walk.at(-1))
  const node = nodes.find((n) => n.id === selection),
    edge = edges.find((e) => e.id === edgeId)
  function save(ns: FlowNode[], es: Edge[]) {
    void history.change([
      { ...quest, data: { ...quest.data, nodes: ns, edges: es } },
    ])
  }
  function add(type: string, p = board.current?.center() ?? { x: 0, y: 0 }) {
    if (!flowTypes.includes(type)) return
    const n = {
      id: crypto.randomUUID(),
      type,
      label: type,
      x: p.x,
      y: p.y,
      description: '',
    }
    save([...nodes, n], edges)
    select(n.id)
    setEdge('')
  }
  function move(id: string, p: Point) {
    save(
      nodes.map((n) => (n.id === id ? { ...n, ...p } : n)),
      edges,
    )
  }
  function remove() {
    if (node)
      save(
        nodes.filter((n) => n !== node),
        edges.filter((e) => e.from !== node.id && e.to !== node.id),
      )
    else if (edge)
      save(
        nodes,
        edges.filter((e) => e !== edge),
      )
    select('')
    setEdge('')
  }
  function layout() {
    const tiers = graphTiers(
        nodes.map((n) => n.id),
        edges,
      ),
      rows = new Map<number, number>()
    save(
      nodes.map((n) => {
        const col = tiers.get(n.id)!,
          row = rows.get(col) ?? 0
        rows.set(col, row + 1)
        return { ...n, x: col * 200, y: row * 100 }
      }),
      edges,
    )
    requestAnimationFrame(() => board.current?.fit())
  }
  function start() {
    if (analysis.start) {
      setWalk([analysis.start.id])
      board.current?.focus(analysis.start.id)
    }
  }
  function step(ids: string[]) {
    setWalk(ids)
    board.current?.focus(ids[ids.length - 1])
  }
  useKeys((e) => {
    if (historyKey(e, history)) return true
    if (e.ctrlKey || e.metaKey) return
    switch (e.key.toLowerCase()) {
      case 'w':
        if (walk) setWalk(null)
        else start()
        return true
      case 'a':
        if (e.shiftKey) {
          layout()
          return true
        }
        break
      case 'f':
        board.current?.fit()
        return true
      case 'delete':
        remove()
        return true
      case 'escape':
        setWalk(null)
        return true
    }
  })
  const complete =
    analysis.ends.length > 0 &&
    !analysis.dead.length &&
    !analysis.unreachable.length
  return (
    <section className="world visual-editor">
      <div className="visual-tools">
        <button onClick={back}>← 任务地图</button>
        <h2>{quest.title}</h2>
        <button
          disabled={!nodes.length}
          onClick={() => (walk ? setWalk(null) : start())}
        >
          {walk ? '退出走查' : '走查 (W)'}
        </button>
        <button onClick={layout}>自动排列 (Shift+A)</button>
        <button onClick={() => board.current?.fit()}>适配视野 (F)</button>
        <button disabled={!history.canUndo} onClick={history.undo}>
          撤销
        </button>
        <button disabled={!history.canRedo} onClick={history.redo}>
          重做
        </button>
      </div>
      <div
        className={'flow-validation ' + (complete ? 'valid' : '')}
        role="status"
      >
        {complete ? (
          '流程完整：每条路线都能走到结局'
        ) : (
          <>
            {!analysis.ends.length && (
              <button
                onClick={() =>
                  analysis.start && board.current?.focus(analysis.start.id)
                }
              >
                缺少结局节点
              </button>
            )}
            {(
              [
                [analysis.dead, '死胡同节点'],
                [analysis.unreachable, '不可达节点'],
              ] as const
            ).map(
              ([issues, label]) =>
                issues.length > 0 && (
                  <span key={label}>
                    发现 {issues.length} 个{label}{' '}
                    {issues.map((n) => (
                      <button
                        key={n.id}
                        onClick={() => {
                          select(n.id)
                          setEdge('')
                          board.current?.focus(n.id)
                        }}
                      >
                        {n.label}
                      </button>
                    ))}
                  </span>
                ),
            )}
          </>
        )}
      </div>
      <div className="canvas-stage">
        <NodeCanvas
          label="任务流程图"
          controls={board}
          nodes={nodes.map((n) => ({
            ...n,
            width: 154,
            height: 57,
            title: n.label,
            subtitle: typeName(n),
            visited: walk?.includes(n.id),
            color: colors[flowTypes.indexOf(typeName(n))] ?? colors[0],
          }))}
          edges={edges.map((e) => ({
            ...e,
            active: walk?.some(
              (id, i) => i > 0 && walk[i - 1] === e.from && id === e.to,
            ),
          }))}
          selected={active?.id || selection}
          selectedEdge={edgeId}
          move={move}
          select={(id) => {
            select(id)
            setEdge('')
          }}
          drop={add}
          connect={(from, to) => {
            if (to)
              save(nodes, [
                ...edges,
                { id: crypto.randomUUID(), from, to, label: '' },
              ])
          }}
          edge={(id) => {
            setEdge(id)
            select('')
          }}
        />
        {active && walk ? (
          <aside className="canvas-pop stack">
            <small>走查 · {typeName(active)}</small>
            <h3>{active.label}</h3>
            <p>{scalar(active.description)}</p>
            {analysis.outgoing.get(active.id)?.map((e) => (
              <button key={e.id} onClick={() => step([...walk, e.to])}>
                {e.label || nodes.find((n) => n.id === e.to)?.label}
              </button>
            ))}
            {!analysis.outgoing.get(active.id)?.length && (
              <small>
                {terminal(active) ? '走查结束' : '此处没有后续节点'}
              </small>
            )}
            <div>
              <button
                disabled={walk.length < 2}
                onClick={() => step(walk.slice(0, -1))}
              >
                上一步
              </button>
              <button onClick={start}>重新走查</button>
            </div>
          </aside>
        ) : (
          (node || edge) && (
            <aside className="canvas-pop stack" key={node?.id ?? edge?.id}>
              <div className="split">
                <b>{node ? '节点内容' : '分支条件'}</b>
                <button
                  onClick={() => {
                    select('')
                    setEdge('')
                  }}
                >
                  ×
                </button>
              </div>
              {node ? (
                <>
                  <input
                    aria-label="节点标题"
                    defaultValue={node.label}
                    onBlur={(e) => {
                      if (e.target.value !== node.label)
                        save(
                          nodes.map((n) =>
                            n === node ? { ...n, label: e.target.value } : n,
                          ),
                          edges,
                        )
                    }}
                  />
                  <textarea
                    aria-label="节点描述"
                    placeholder="节点描述"
                    defaultValue={scalar(node.description)}
                    onBlur={(e) => {
                      if (e.target.value !== scalar(node.description))
                        save(
                          nodes.map((n) =>
                            n === node
                              ? { ...n, description: e.target.value }
                              : n,
                          ),
                          edges,
                        )
                    }}
                  />
                </>
              ) : (
                <input
                  aria-label="分支名称"
                  defaultValue={edge?.label}
                  onBlur={(e) => {
                    if (e.target.value !== edge?.label)
                      save(
                        nodes,
                        edges.map((v) =>
                          v === edge ? { ...v, label: e.target.value } : v,
                        ),
                      )
                  }}
                />
              )}
              <button onClick={remove}>删除{node ? '节点' : '分支'}</button>
            </aside>
          )
        )}
      </div>
      <div className="visual-tools node-palette">
        {flowTypes.map((t, i) => (
          <button
            key={t}
            style={{ borderBottomColor: colors[i] }}
            draggable
            onDragStart={(e) => e.dataTransfer.setData('text/plain', t)}
            onClick={() => add(t)}
          >
            {t}
          </button>
        ))}
      </div>
    </section>
  )
}
