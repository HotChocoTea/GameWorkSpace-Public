import { useRef, useState } from 'react'
import {
  clamp,
  historyKey,
  useKeys,
  type Point,
} from '../../components/CanvasKit'
import { useEntityCommands } from '../../components/entityCommands'
import { NodeCanvas, type BoardControls } from '../../components/NodeCanvas'
import { newEntity } from '../../state/catalog'
import { useWorkspace } from '../../state/workspace'
import type { Entity } from '../../types'
import {
  Add,
  DataField,
  Detail,
  EntryField,
  Filter,
  Heading,
  MultiPick,
  Reference,
  SearchField,
  Select,
} from '../world/WorldUI'
import {
  list,
  matches,
  record,
  scalar,
  strings,
  value,
  type Editor,
} from '../world/worldUtils'
import QuestFlowEditor from './QuestFlowEditor'
const lanes = ['主线', '支线', '隐藏'],
  statuses = ['构思中', '已写完', '已实装'],
  colors = ['#46878a', '#ad7943', '#8871aa'],
  height = 148
const lane = (e: Entity) => Math.max(0, lanes.indexOf(value(e, 'category')))
const status = (e: Entity) => e.status || value(e, 'status', statuses[0])
function QuestFields({
  ed,
  quests,
  open,
}: {
  ed: Editor
  quests: Entity[]
  open: () => void
}) {
  const e = ed.e,
    objectives = list(e.data?.objectives).map((v) =>
      typeof v === 'string' ? { text: v, done: false } : record(v),
    )
  return (
    <>
      <button
        className="primary"
        onClick={async () => {
          await ed.flush()
          open()
        }}
      >
        编辑流程图
      </button>
      <EntryField editor={ed} name="title" label="任务名称" />
      <div className="fields-two">
        <DataField editor={ed} name="category" label="类别" options={lanes} />
        <label className="field">
          进度
          <Select
            label="进度"
            current={status(e)}
            options={statuses}
            change={(s) => ed.edit({ status: s })}
          />
        </label>
      </div>
      <Reference editor={ed} name="giverId" label="委托人" type="character" />
      <Reference editor={ed} name="locationId" label="地点" type="location" />
      <div className="fields-two">
        <DataField
          editor={ed}
          name="level"
          label="推荐等级"
          type="number"
          min={0}
        />
        <DataField
          editor={ed}
          name="durationMinutes"
          label="预计分钟"
          type="number"
          min={0}
        />
      </div>
      <EntryField editor={ed} name="summary" label="简介" />
      <MultiPick
        label="前置任务"
        rows={quests.filter((q) => q.id !== e.id)}
        ids={strings(e.data?.prerequisites)}
        change={(v) => ed.data('prerequisites', v)}
      />
      <section className="stack">
        <div className="split">
          <b>目标清单</b>
          <button
            onClick={() =>
              ed.data('objectives', [
                ...objectives,
                { text: '新目标', done: false },
              ])
            }
          >
            ＋ 目标
          </button>
        </div>
        {objectives.map((o, i) => (
          <div className="visual-tools" key={i}>
            <input
              type="checkbox"
              aria-label="已完成"
              checked={!!o.done}
              onChange={(ev) =>
                ed.data(
                  'objectives',
                  objectives.map((v, j) =>
                    j === i ? { ...v, done: ev.target.checked } : v,
                  ),
                )
              }
            />
            <input
              aria-label="目标"
              value={scalar(o.text ?? o.label)}
              onChange={(ev) =>
                ed.data(
                  'objectives',
                  objectives.map((v, j) =>
                    j === i ? { ...v, text: ev.target.value } : v,
                  ),
                )
              }
            />
            <button
              onClick={() =>
                ed.data(
                  'objectives',
                  objectives.filter((_, j) => j !== i),
                )
              }
            >
              ×
            </button>
          </div>
        ))}
      </section>
      <DataField editor={ed} name="rewards" label="任务奖励" multiline />
      <EntryField editor={ed} name="body" label="设计笔记" />
    </>
  )
}
export default function QuestsView() {
  const w = useWorkspace(),
    history = useEntityCommands(),
    board = useRef<BoardControls>(null)
  const [tab, setTab] = useState('任务地图'),
    [inner, setInner] = useState(''),
    [query, setQuery] = useState(''),
    [cat, setCat] = useState(''),
    [state, setState] = useState('')
  const rows = w.entities.filter((e) => e.entityType === 'quest'),
    byId = new Map(w.entities.map((e) => [e.id, e])),
    counts = [0, 0, 0]
  const selected = rows.find((e) => e.id === w.selected),
    flow = rows.find((e) => e.id === inner)
  const nodes = rows.map((e) => {
    const index = lane(e),
      column = counts[index]++,
      loc = byId.get(value(e, 'locationId'))
    return {
      id: e.id,
      x: Number(e.data?.mapX ?? 68 + column * 222),
      y: index * height + clamp(Number(e.data?.laneY ?? 46), 30, height - 80),
      width: 187,
      height: 74,
      title: e.title,
      subtitle:
        (loc?.title || '未指定地点') +
        ' · ' +
        value(e, 'durationMinutes', '0') +
        ' 分钟',
      badge: status(e),
      color: colors[index],
    }
  })
  const extent = {
    x: 0,
    y: 0,
    width: Math.max(660, ...nodes.map((n) => n.x + n.width + 40)),
    height: height * 3,
  }
  function create(p?: Point, from?: string) {
    const index = p ? Math.floor(p.y / height) : 0
    if (index < 0 || index >= 3) return
    const e = {
      ...newEntity(w.project.id, 'quest', from ? '后续任务' : '新任务线'),
      status: statuses[0],
      data: {
        category: lanes[index],
        mapX: p ? Math.max(60, p.x) : 68 + counts[index] * 222,
        laneY: p ? clamp(p.y - index * height, 30, height - 80) : 46,
        prerequisites: from ? [from] : [],
        nodes: [],
        edges: [],
      },
    }
    void history.change([e]).then(() => w.inspect(e.id))
  }
  function fit() {
    board.current?.fit()
  }
  useKeys((e) => {
    if (flow) return
    if (historyKey(e, history)) return true
    if (e.key.toLowerCase() === 'f' && !e.ctrlKey) {
      fit()
      return true
    }
  })
  if (flow)
    return (
      <QuestFlowEditor key={flow.id} quest={flow} back={() => setInner('')} />
    )
  return (
    <section className="world visual-editor">
      <Heading
        title="任务线"
        tabs={['任务地图', '列表']}
        active={tab}
        choose={setTab}
      >
        <Add label="新建任务线" click={() => create()} />
      </Heading>
      <div className="visual-tools">
        <strong>
          {counts[0]} 主线 · {rows.length - counts[0]} 其他 ·{' '}
          {Math.round(
            (rows.filter((e) => status(e) === '已实装').length * 100) /
              (rows.length || 1),
          )}
          % 已实装 · 约{' '}
          {
            +(
              rows.reduce(
                (sum, e) => sum + Number(e.data?.durationMinutes || 0),
                0,
              ) / 60
            ).toFixed(1)
          }{' '}
          小时
        </strong>
        {tab === '任务地图' && (
          <>
            <button
              onClick={() => {
                const used = [0, 0, 0]
                void history
                  .change(
                    rows.map((e) => ({
                      ...e,
                      data: {
                        ...e.data,
                        mapX: 68 + used[lane(e)]++ * 222,
                        laneY: 46,
                      },
                    })),
                  )
                  .then(() => board.current?.fit())
              }}
            >
              整理布局
            </button>
            <button onClick={fit}>适配视野 (F)</button>
            <button aria-label="缩小" onClick={() => board.current?.zoom(0.8)}>
              −
            </button>
            <button aria-label="放大" onClick={() => board.current?.zoom(1.25)}>
              ＋
            </button>
          </>
        )}
        <button disabled={!history.canUndo} onClick={history.undo}>
          撤销
        </button>
        <button disabled={!history.canRedo} onClick={history.redo}>
          重做
        </button>
      </div>
      {tab === '任务地图' ? (
        <div className="canvas-stage">
          <NodeCanvas
            controls={board}
            label="任务地图"
            extent={extent}
            nodes={nodes}
            selected={selected?.id}
            edges={rows.flatMap((e) =>
              strings(e.data?.prerequisites).map((id) => ({
                id: id + e.id,
                from: id,
                to: e.id,
              })),
            )}
            background={(ctx, s) => {
              lanes.forEach((l, i) => {
                ctx.fillStyle = colors[i] + '13'
                ctx.fillRect(s.view.x, i * height, s.view.width, height - 2)
                ctx.fillStyle = colors[i]
                ctx.font = 'bold 15px system-ui'
                ctx.fillText(l, Math.max(10, s.view.x + 10), i * height + 23)
              })
            }}
            select={w.inspect}
            open={setInner}
            move={(id, p) => {
              const e = byId.get(id)!,
                i = clamp(Math.floor((p.y + 37) / height), 0, 2)
              void history.change([
                {
                  ...e,
                  data: {
                    ...e.data,
                    mapX: Math.max(58, p.x),
                    category: lanes[i],
                    laneY: clamp(p.y - i * height, 30, height - 80),
                  },
                },
              ])
            }}
            connect={(from, to, p) => {
              if (!to) {
                create(p, from)
                return
              }
              const e = byId.get(to)!,
                ids = strings(e.data?.prerequisites)
              if (!ids.includes(from))
                void history.change([
                  { ...e, data: { ...e.data, prerequisites: [...ids, from] } },
                ])
            }}
          />
        </div>
      ) : (
        <>
          <div className="visual-tools">
            <SearchField label="查找任务线" query={query} set={setQuery} />
            <Filter
              label="类别"
              options={lanes}
              current={cat}
              change={setCat}
            />
            <Filter
              label="进度"
              options={statuses}
              current={state}
              change={setState}
            />
          </div>
          <div className="panel">
            {rows
              .filter(
                (e) =>
                  matches(e, query) &&
                  (!cat || lanes[lane(e)] === cat) &&
                  (!state || state === status(e)),
              )
              .map((e) => (
                <div className="overview-row" key={e.id}>
                  <button onClick={() => w.inspect(e.id)}>
                    <b>{e.title}</b>
                  </button>
                  <small>
                    {lanes[lane(e)]} · {status(e)}
                  </small>
                  <button onClick={() => setInner(e.id)}>编辑流程图</button>
                </div>
              ))}
          </div>
        </>
      )}
      {selected && (
        <Detail key={selected.id} entity={selected} label="任务详情">
          {(ed) => (
            <QuestFields
              ed={ed}
              quests={rows}
              open={() => setInner(selected.id)}
            />
          )}
        </Detail>
      )}
    </section>
  )
}
