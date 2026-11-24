import { useEffect, useRef, useState, type ReactNode } from 'react'
import { native, saveExportFile } from '../../api/ai'
import { api, desktop } from '../../api/client'
import {
  clamp,
  dotGrid,
  historyKey,
  useCanvas,
  useCommands,
  useKeys,
  type Point,
} from '../../components/CanvasKit'
import { Modal } from '../../components/ui'
import { useWorkspace } from '../../state/workspace'
import type { MapRecord } from '../../types'
import { Add, EntitySelect, Heading } from '../world/WorldUI'
import {
  cloneLayer,
  dirty,
  drawMap,
  fillCells,
  icons,
  readMap,
  releaseLayer,
  segment,
  terrains,
  type Layer,
  type Pin,
  type TileMap,
} from './mapTiles'
const tools = [
  ['B', '画笔'],
  ['L', '直线'],
  ['R', '矩形'],
  ['O', '房间'],
  ['F', '填充'],
  ['E', '橡皮'],
  ['I', '吸取'],
  ['P', '图钉'],
  ['H', '平移'],
]
const emptyLayer = (name: string, size: number): Layer => ({
  name,
  visible: true,
  tiles: Array(size).fill(0),
  icons: [],
})
const pending = new Map<string, TileMap>(),
  saved = new Map<string, TileMap>(),
  queues = new Map<string, Promise<void>>()
function write(map: TileMap) {
  const op = (queues.get(map.id) ?? Promise.resolve())
    .catch(() => {})
    .then(async () => {
      await api.saveMap(map)
      saved.set(map.id, map)
    })
  queues.set(map.id, op)
  void op
    .finally(() => {
      if (queues.get(map.id) === op) queues.delete(map.id)
    })
    .catch(() => {})
  return op
}
function useMapDraft(record: MapRecord) {
  const { notify } = useWorkspace(),
    [draft, setDraft] = useState(() => pending.get(record.id) ?? readMap(record))
  const current = useRef(draft),
    timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
    [error, setError] = useState('')
  function flush() {
    clearTimeout(timer.current)
    const next = pending.get(record.id)
    if (!next) return
    void write(next)
      .then(() => {
        if (pending.get(next.id) === next) pending.delete(next.id)
        setError('')
      })
      .catch((e) => {
        setError(String(e))
        notify(String(e))
      })
  }
  useEffect(() => {
    function sync(next: MapRecord) {
      if (next.updatedAt === current.current.updatedAt) return
      current.current = readMap(next)
      setDraft(current.current)
    }
    const last = saved.get(record.id)
    if (!last || last.updatedAt <= record.updatedAt) {
      saved.delete(record.id)
      if (!pending.has(record.id)) sync(record)
      return
    }
    if (pending.has(record.id)) return

    // The workspace read may predate our save, or a rollback may have restored
    // an older version before the editor saw that save. Read after the commit.
    let live = true
    api
      .listMaps(record.projectId)
      .then((maps) => {
        if (!live || pending.has(record.id) || saved.get(record.id) !== last)
          return
        const persisted = maps.find((map) => map.id === record.id)
        if (!persisted || persisted.updatedAt < last.updatedAt)
          saved.delete(record.id)
        if (!persisted) return
        sync(persisted)
      })
      .catch((e) => {
        if (live) notify(String(e))
      })
    return () => {
      live = false
    }
  }, [record, notify])
  useEffect(() => {
    window.addEventListener('pagehide', flush)
    return () => {
      window.removeEventListener('pagehide', flush)
      flush()
    }
  }, [])
  function apply(next: TileMap) {
    const stamp = {
      ...next,
      name: current.current.name,
      updatedAt: new Date().toISOString(),
    }
    current.current = stamp
    setDraft(stamp)
    pending.set(stamp.id, stamp)
    clearTimeout(timer.current)
    timer.current = setTimeout(flush, 350)
  }
  return { draft, apply, flush, error }
}
function MapEditor({
  record,
  mapList,
}: {
  record: MapRecord
  mapList: ReactNode
}) {
  const w = useWorkspace(),
    { draft: m, apply, flush, error } = useMapDraft(record),
    history = useCommands(w.notify)
  const rasterLayers = useRef<Layer[]>([])
  useEffect(() => {
    for (const previous of rasterLayers.current)
      if (!m.layers.includes(previous)) releaseLayer(previous)
    rasterLayers.current = m.layers
  }, [m.layers])
  useEffect(() => () => rasterLayers.current.forEach(releaseLayer), [])
  const [tool, setTool] = useState('B'),
    [size, setSize] = useState(1),
    [grid, setGrid] = useState(true),
    [labels, setLabels] = useState(true),
    [exporting, setExporting] = useState(false),
    [palette, setPalette] = useState('图块'),
    [tile, setTile] = useState(1)
  const [cat, setCat] = useState('自然'),
    [icon, setIcon] = useState('tree'),
    [layerIndex, setLayer] = useState(0),
    [pinId, setPin] = useState(''),
    [custom, setCustom] = useState(false)
  const index = clamp(layerIndex, 0, m.layers.length - 1),
    layer = m.layers[index],
    pin = m.pins.find((p) => p.id === pinId)
  const drag = useRef<{
      from: Point
      last: Point
      working: Layer
      changed: boolean
    } | null>(null),
    cursor = useRef<Point | null>(null)
  const extent = () => ({
    x: 0,
    y: 0,
    width: m.width * m.tileSize,
    height: m.height * m.tileSize,
  })
  function change(next: TileMap) {
    void history.commit(
      () => apply(next),
      () => apply(m),
    )
  }
  function layers(ls: Layer[]) {
    change({ ...m, layers: ls })
  }
  function editLayer(next: Layer, i = index) {
    layers(m.layers.map((l, j) => (i === j ? next : l)))
  }
  function editPin(p: Pin) {
    change({ ...m, pins: m.pins.map((row) => (row.id === p.id ? p : row)) })
  }
  const cell = (p: Point) => ({
    x: Math.floor(p.x / m.tileSize),
    y: Math.floor(p.y / m.tileSize),
  })
  const valid = (p: Point) =>
    p.x >= 0 && p.y >= 0 && p.x < m.width && p.y < m.height
  function paint(l: Layer, p: Point, id: number, erase: boolean) {
    if (!valid(p)) return false
    const k = p.y * m.width + p.x
    if (!erase && palette === '图标') {
      const found = l.icons.find((v) => v.x === p.x && v.y === p.y)
      if (found?.iconId === icon) return false
      l.icons = l.icons.filter((v) => v !== found)
      l.icons.push({ ...p, iconId: icon })
    } else {
      let changed = false
      if (erase) {
        const kept = l.icons.filter((v) => v.x !== p.x || v.y !== p.y)
        changed = kept.length !== l.icons.length
        l.icons = kept
      }
      if (!changed && (l.tiles[k] || 0) === id) return false
      l.tiles[k] = id
    }
    dirty(l, p)
    return true
  }
  function brush(l: Layer, p: Point) {
    let changed = false
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++)
        if (
          paint(
            l,
            {
              x: p.x + x - Math.floor(size / 2),
              y: p.y + y - Math.floor(size / 2),
            },
            tool === 'E' ? 0 : tile,
            tool === 'E',
          )
        )
          changed = true
    return changed
  }
  function shape(
    a: Point,
    b: Point,
    visit: (pt: Point, tileId: number) => void,
  ) {
    if (tool === 'L') {
      segment(a, b).forEach((p) => visit(p, tile))
      return
    }
    const left = Math.min(a.x, b.x),
      top = Math.min(a.y, b.y),
      right = Math.max(a.x, b.x),
      bottom = Math.max(a.y, b.y)
    for (let y = top; y <= bottom; y++)
      for (let x = left; x <= right; x++)
        visit(
          { x, y },
          tool === 'O'
            ? x === left || x === right || y === top || y === bottom
              ? 2
              : 1
            : tile,
        )
  }
  const { canvas, api: surface } = useCanvas({
    extent,
    draw(ctx, s) {
      dotGrid(ctx, s)
      const d = drag.current
      drawMap(
        ctx,
        d
          ? {
              ...m,
              layers: m.layers.map((l, i) => (i === index ? d.working : l)),
            }
          : m,
        s.view,
        grid,
        labels,
        pinId,
        s.camera.zoom,
      )
      const c = cursor.current,
        t = m.tileSize
      if (d && ['L', 'O', 'R'].includes(tool)) {
        ctx.globalAlpha = 0.58
        shape(d.from, d.last, (p, id) => {
          ctx.fillStyle =
            terrains[id - 1]?.[1] ??
            m.customTiles.find((t) => t.id === id)?.color ??
            s.colors.accent
          ctx.fillRect(p.x * t, p.y * t, t, t)
        })
        ctx.globalAlpha = 1
      }
      if (c && valid(c) && tool !== 'H') {
        ctx.strokeStyle = '#fff'
        ctx.lineWidth = 2 / s.camera.zoom
        ctx.strokeRect(c.x * t, c.y * t, t, t)
      }
    },
    down(p) {
      if (tool === 'H') return false
      const c = cell(p)
      if (!valid(c)) return false
      if (tool === 'P') {
        const found = m.pins.find((row) => row.x === c.x && row.y === c.y)
        if (found) {
          setPin(found.id)
          return
        }
        const next = {
          ...c,
          id: crypto.randomUUID(),
          label: '新图钉',
          color: '#ad5946',
          entityId: '',
        }
        change({ ...m, pins: [...m.pins, next] })
        setPin(next.id)
        return
      }
      if (tool === 'I') {
        const image = layer.icons.find((row) => row.x === c.x && row.y === c.y)
        if (image) {
          setPalette('图标')
          setIcon(image.iconId)
          setCat(
            Object.keys(icons).find((k) =>
              icons[k].some(([id]) => id === image.iconId),
            ) ?? '自然',
          )
        } else {
          setPalette('图块')
          setTile(layer.tiles[c.y * m.width + c.x] || 0)
        }
        setTool('B')
        return
      }
      if (!layer.visible) return
      const working = cloneLayer(layer)
      if (tool === 'F') {
        let changed = false
        for (const pt of fillCells(layer, m.width, m.height, c))
          if (paint(working, pt, tile, false)) changed = true
        if (changed) editLayer(working)
        return
      }
      const d = { from: c, last: c, working, changed: false }
      drag.current = d
      if (tool === 'B' || tool === 'E') d.changed = brush(working, c)
    },
    move(p) {
      const d = drag.current,
        c = cell(p)
      cursor.current = c
      if (!d) return
      const end = {
        x: clamp(c.x, 0, m.width - 1),
        y: clamp(c.y, 0, m.height - 1),
      }
      if (tool === 'B' || tool === 'E') {
        for (const pt of segment(d.last, end))
          if (brush(d.working, pt)) d.changed = true
      }
      d.last = end
    },
    up(p) {
      const d = drag.current
      if (!d) return
      drag.current = null
      const c = cell(p),
        end = { x: clamp(c.x, 0, m.width - 1), y: clamp(c.y, 0, m.height - 1) }
      if (['L', 'O', 'R'].includes(tool))
        shape(d.from, end, (pt, id) => {
          if (paint(d.working, pt, id, false)) d.changed = true
        })
      else
        for (const pt of segment(d.last, end))
          if (brush(d.working, pt)) d.changed = true
      if (d.changed) editLayer(d.working)
    },
    cancel() {
      drag.current = null
    },
    leave() {
      cursor.current = null
    },
  })
  function chooseTool(next: string) {
    if (['L', 'R', 'O', 'F'].includes(next)) setPalette('图块')
    setTool(next)
  }
  useKeys((e) => {
    if (historyKey(e, history)) return true
    if (e.ctrlKey || e.metaKey) return
    if (tools.some(([k]) => k === e.key.toUpperCase())) {
      chooseTool(e.key.toUpperCase())
      return true
    }
    if (e.key === '[' || e.key === ']') {
      setSize(clamp(size + (e.key === ']' ? 1 : -1), 1, 5))
      return true
    }
  })
  async function runExport(format: string, save: () => Promise<string | null>) {
    if (exporting) return
    setExporting(true)
    try {
      const path = await save()
      if (path) w.notify('已导出 ' + format + '：' + path)
    } catch (e) {
      w.notify(format + ' 导出失败：' + String(e))
    } finally {
      setExporting(false)
    }
  }
  async function exportPng() {
    const image = document.createElement('canvas'),
      rect = extent()
    image.width = rect.width
    image.height = rect.height
    const ctx = image.getContext('2d')
    if (!ctx) throw Error('无法创建绘图画布')
    drawMap(ctx, m, rect, false, labels)
    const blob = await new Promise<Blob | null>((resolve) => {
      image.toBlob(resolve, 'image/png')
    })
    if (!blob) {
      w.notify('PNG 导出失败')
      return null
    }
    return saveExportFile(blob, m.name + '.png', 'PNG 图像', 'png', 'image/png')
  }
  async function exportJson() {
    const payload = {
      format: 'gameworkspace-map',
      version: 1,
      id: m.id,
      projectId: m.projectId,
      name: m.name,
      width: m.width,
      height: m.height,
      tileSize: m.tileSize,
      terrains: terrains.map(([name, color], i) => ({ id: i + 1, name, color })),
      customTiles: m.customTiles,
      layers: m.layers,
      pins: m.pins,
      exportedAt: new Date().toISOString(),
    }
    return saveExportFile(
      JSON.stringify(payload, null, 2),
      m.name + '.json',
      'JSON 地图',
      'json',
      'application/json;charset=utf-8',
    )
  }
  async function exportTiled() {
    if (!desktop) {
      w.notify('请在 GameWorkSpace 桌面端导出 Tiled (.tmj) 地图')
      return null
    }
    return native<string | null>('export_map_tiled_file', { record: m })
  }
  function reorder(delta: number) {
    const next = index + delta
    if (!m.layers[next]) return
    const copy = [...m.layers]
    ;[copy[index], copy[next]] = [copy[next], copy[index]]
    layers(copy)
    setLayer(next)
  }
  return (
    <div className="map-layout">
      <aside className="map-tools">
        {mapList}
        {tools.map(([k, name]) => (
          <button
            key={k}
            aria-pressed={tool === k}
            onClick={() => chooseTool(k)}
          >
            {name} <kbd>{k}</kbd>
          </button>
        ))}
      </aside>
      <main className="visual-editor">
        <div className="visual-tools">
          <label>
            笔刷 {size}{' '}
            <input
              aria-label="笔刷大小"
              type="range"
              min="1"
              max="5"
              value={size}
              onChange={(e) => setSize(+e.target.value)}
            />
          </label>
          <label>
            <input
              type="checkbox"
              checked={grid}
              onChange={(e) => setGrid(e.target.checked)}
            />{' '}
            网格
          </label>
          <button onClick={() => surface.current?.fit()}>适配视野</button>
          <button disabled={!history.canUndo} onClick={history.undo}>
            撤销
          </button>
          <button disabled={!history.canRedo} onClick={history.redo}>
            重做
          </button>
          {error && <button onClick={flush}>保存失败，重试</button>}
        </div>
        <div className="canvas-stage">
          <canvas
            className="editor-canvas"
            aria-label="地图绘制区"
            tabIndex={0}
            ref={canvas}
          />
        </div>
        <div className="visual-tools">
          <div className="segments">
            {['图块', '图标'].map((tab) => (
              <button
                className={palette === tab ? 'active' : ''}
                onClick={() => {
                  setPalette(tab)
                  if (tab === '图标') setTool('B')
                }}
                key={tab}
              >
                {tab}
              </button>
            ))}
          </div>
          {palette === '图块' ? (
            <button onClick={() => setCustom(true)}>＋ 自定义图块</button>
          ) : (
            <select
              aria-label="图标分类"
              value={cat}
              onChange={(e) => {
                setCat(e.target.value)
                setIcon(icons[e.target.value][0][0])
              }}
            >
              {Object.keys(icons).map((k) => (
                <option key={k}>{k}</option>
              ))}
            </select>
          )}
        </div>
        <div className="tile-palette">
          {palette === '图块'
            ? [
                ...terrains.map(([name, color], i) => ({
                  name,
                  color,
                  id: i + 1,
                })),
                ...m.customTiles,
              ].map((t) => (
                <button
                  key={t.id}
                  aria-pressed={tile === t.id}
                  onClick={() => {
                    setTile(t.id)
                    if (!['B', 'L', 'O', 'R', 'F'].includes(tool)) setTool('B')
                  }}
                >
                  <i style={{ background: t.color }} />
                  {t.name}
                </button>
              ))
            : icons[cat].map(([id, g, name]) => (
                <button
                  aria-pressed={icon === id}
                  key={id}
                  onClick={() => {
                    setIcon(id)
                    setTool('B')
                  }}
                >
                  {g} {name}
                </button>
              ))}
        </div>
      </main>
      <aside className="world-sidebar stack map-side">
        <header className="split">
          <h3>图层</h3>
          <button
            onClick={() => {
              layers([
                ...m.layers,
                emptyLayer('图层 ' + (m.layers.length + 1), m.width * m.height),
              ])
              setLayer(m.layers.length)
            }}
          >
            ＋ 图层
          </button>
        </header>
        {m.layers
          .map((l, i) => (
            <div
              className={'layer-row ' + (i === index ? 'chosen' : '')}
              key={i}
            >
              <input
                type="checkbox"
                aria-label={'显示' + l.name}
                checked={l.visible}
                onChange={(e) =>
                  editLayer({ ...l, visible: e.target.checked }, i)
                }
              />
              <button onClick={() => setLayer(i)}>{l.name}</button>
              <small>{l.tiles.filter(Boolean).length} 格</small>
            </div>
          ))
          .reverse()}
        <input
          aria-label="图层名称"
          key={index + '-' + layer.name}
          defaultValue={layer.name}
          onBlur={(e) => {
            if (e.target.value.trim() && e.target.value !== layer.name)
              editLayer({ ...layer, name: e.target.value.trim() })
          }}
        />
        <div className="visual-tools">
          <button
            disabled={index === m.layers.length - 1}
            onClick={() => reorder(1)}
          >
            上移
          </button>
          <button disabled={!index} onClick={() => reorder(-1)}>
            下移
          </button>
          <button
            onClick={() => {
              const ls = [...m.layers]
              ls.splice(index + 1, 0, { ...layer, name: layer.name + ' 副本' })
              layers(ls)
              setLayer(index + 1)
            }}
          >
            复制
          </button>
          <button
            onClick={() =>
              editLayer(emptyLayer(layer.name, m.width * m.height))
            }
          >
            清空
          </button>
          <button
            disabled={m.layers.length <= 1}
            onClick={() => {
              layers(m.layers.filter((_, i) => i !== index))
              setLayer(Math.max(0, index - 1))
            }}
          >
            删除图层
          </button>
        </div>
        <h3>图钉</h3>
        <div className="pin-list">
          {m.pins.map((p) => (
            <button
              key={p.id}
              aria-pressed={pinId === p.id}
              onClick={() => {
                setPin(p.id)
                surface.current?.center({
                  x: (p.x + 0.5) * m.tileSize,
                  y: (p.y + 0.5) * m.tileSize,
                })
              }}
            >
              {p.label}{' '}
              <small>
                ({p.x}, {p.y})
              </small>
            </button>
          ))}
        </div>
        {pin && (
          <section className="stack" key={pin.id}>
            <label className="field">
              标注文字
              <input
                key={pin.label}
                defaultValue={pin.label}
                onBlur={(e) => {
                  if (e.target.value !== pin.label)
                    editPin({ ...pin, label: e.target.value })
                }}
              />
            </label>
            <label>
              颜色{' '}
              <input
                aria-label="图钉颜色"
                type="color"
                value={pin.color}
                onChange={(e) => editPin({ ...pin, color: e.target.value })}
              />
            </label>
            <EntitySelect
              label="关联条目"
              rows={w.entities.filter((e) =>
                [
                  'location',
                  'quest',
                  'scene',
                  'character',
                  'faction',
                  'collectible',
                ].includes(e.entityType),
              )}
              current={pin.entityId}
              change={(id) => editPin({ ...pin, entityId: id })}
            />
            <div>
              <button
                disabled={!w.entities.some((e) => e.id === pin.entityId)}
                onClick={() => {
                  const e = w.entities.find((e) => e.id === pin.entityId)
                  if (e) w.openEntity(e)
                }}
              >
                打开条目
              </button>
              <button
                onClick={() => {
                  change({ ...m, pins: m.pins.filter((p) => p.id !== pin.id) })
                  setPin('')
                }}
              >
                删除图钉
              </button>
            </div>
          </section>
        )}
        <label>
          <input
            type="checkbox"
            checked={labels}
            onChange={(e) => setLabels(e.target.checked)}
          />{' '}
          显示图钉文字
        </label>
        <div className="map-export-actions" aria-busy={exporting}>
          <button disabled={exporting} onClick={() => void runExport('PNG', exportPng)}>
            导出 PNG
          </button>
          <button disabled={exporting} onClick={() => void runExport('JSON', exportJson)}>
            导出 JSON
          </button>
          <button
            disabled={exporting}
            onClick={() => void runExport('Tiled 地图（含 .bmp 图集）', exportTiled)}
          >
            导出 Tiled (.tmj)
          </button>
        </div>
      </aside>
      {custom && (
        <Modal title="自定义图块" onClose={() => setCustom(false)}>
          <form
            className="form-body stack"
            onSubmit={(e) => {
              e.preventDefault()
              const f = new FormData(e.currentTarget),
                id = Math.max(19, ...m.customTiles.map((t) => t.id)) + 1
              change({
                ...m,
                customTiles: [
                  ...m.customTiles,
                  {
                    id,
                    name: String(f.get('name')),
                    color: String(f.get('color')),
                  },
                ],
              })
              setTile(id)
              setCustom(false)
            }}
          >
            <label>
              名称 <input name="name" required autoFocus />
            </label>
            <label>
              颜色 <input name="color" type="color" defaultValue="#65938a" />
            </label>
            <button className="primary">添加图块</button>
          </form>
        </Modal>
      )}
    </div>
  )
}
export default function MapMakerView() {
  const w = useWorkspace(),
    [selected, select] = useState(w.selected ?? ''),
    [modal, setModal] = useState(''),
    [created, setCreated] = useState<MapRecord>()
  const maps =
      created && !w.maps.some((m) => m.id === created.id)
        ? [...w.maps, created]
        : w.maps,
    m = maps.find((m) => m.id === selected) ?? maps[0]
  useEffect(() => {
    if (w.selected) select(w.selected)
  }, [w.selected])
  useEffect(() => {
    if (created && w.maps.some((m) => m.id === created.id))
      setCreated(undefined)
  }, [w.maps, created])
  const mapList = (
    <nav className="visual-tools map-list">
      {maps.map((map) => (
        <button
          className={map.id === m?.id ? 'active' : ''}
          onClick={() => select(map.id)}
          onDoubleClick={() => setModal('rename')}
          key={map.id}
        >
          {map.name}
        </button>
      ))}
      {m && (
        <>
          <small>
            {m.width} × {m.height} 格
          </small>
          <button onClick={() => setModal('rename')}>重命名</button>
          <button onClick={() => setModal('delete')}>删除地图</button>
        </>
      )}
    </nav>
  )
  return (
    <section className="world">
      <Heading title="地图设计">
        <Add label="新建地图" click={() => setModal('new')} />
      </Heading>

      {m ? (
        <MapEditor key={m.id} record={m} mapList={mapList} />
      ) : (
        <p>新建地图以开始绘制。</p>
      )}
      {modal && (
        <Modal
          title={
            modal === 'new'
              ? '新建地图'
              : modal === 'rename'
                ? '重命名地图'
                : '删除地图'
          }
          onClose={() => setModal('')}
        >
          <form
            className="form-body stack"
            onSubmit={(ev) => {
              ev.preventDefault()
              const f = new FormData(ev.currentTarget)
              void w.run(async () => {
                if (modal === 'new') {
                  const now = new Date().toISOString(),
                    width = Number(f.get('width')),
                    height = Number(f.get('height')),
                    map = {
                      id: crypto.randomUUID(),
                      projectId: w.project.id,
                      name: String(f.get('name')).trim() || '地图',
                      width,
                      height,
                      tileSize: Number(f.get('tileSize')),
                      layers: [emptyLayer('底图', width * height)],
                      pins: [],
                      customTiles: [],
                      createdAt: now,
                      updatedAt: now,
                    }
                  await api.saveMap(map)
                  setCreated(map)
                  select(map.id)
                } else if (m) {
                  const draft = pending.get(m.id)
                  if (draft) {
                    await write(draft)
                    pending.delete(m.id)
                  }
                  await queues.get(m.id)
                  if (modal === 'delete') {
                    await api.deleteMap(m.id)
                    saved.delete(m.id)
                    select('')
                    setCreated(undefined)
                  } else {
                    const latest = (await api.listMaps(m.projectId)).find(
                      (map) => map.id === m.id,
                    )
                    if (!latest) throw Error('地图已删除')
                    await api.saveMap({
                      ...latest,
                      name: String(f.get('name')).trim() || m.name,
                      updatedAt: new Date().toISOString(),
                    })
                  }
                }
                setModal('')
              })
            }}
          >
            {modal === 'delete' ? (
              <p>删除「{m?.name}」及其图层和图钉？</p>
            ) : (
              <label className="field">
                名称
                <input
                  autoFocus
                  required
                  name="name"
                  defaultValue={modal === 'rename' ? m?.name : '新地图'}
                />
              </label>
            )}
            {modal === 'new' && (
              <>
                {[
                  ['width', '宽度', 32, 512],
                  ['height', '高度', 24, 512],
                  ['tileSize', '图块像素', 24, 64],
                ].map(([name, label, n, max]) => (
                  <label key={name} className="field">
                    {label}
                    <input
                      type="number"
                      min={1}
                      max={max}
                      step="1"
                      name={String(name)}
                      defaultValue={n}
                      required
                    />
                  </label>
                ))}
              </>
            )}
            <button className="primary">
              {modal === 'delete' ? '确认删除' : '保存地图'}
            </button>
          </form>
        </Modal>
      )}
    </section>
  )
}
