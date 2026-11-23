import { useEffect, useRef, useState, type RefObject } from 'react'
import { api } from '../../api/client'
import {
  bounds,
  dotGrid,
  historyKey,
  inside,
  intersects,
  useCanvas,
  useImages,
  useKeys,
  type Point,
  type Rect,
  type Surface,
} from '../../components/CanvasKit'
import { useEntityCommands } from '../../components/entityCommands'
import { EntityLinkPanel } from '../../components/EntityLinkPanel'
import { Modal } from '../../components/ui'
import { newEntity } from '../../state/catalog'
import { useWorkspace } from '../../state/workspace'
import type { Entity } from '../../types'
import { EntitySelect, Heading, SearchField } from './WorldUI'
import { list, numeric, scalar, strings, value } from './worldUtils'
const isGroup = (e: Entity) => e.data?.kind === 'group'
function geometry(e: Entity): Rect {
  const legacy = list(e.data?.boardPosition)
  return {
    x: numeric(e.data?.x ?? legacy[0]) ?? 0,
    y: numeric(e.data?.y ?? legacy[1]) ?? 0,
    width: Math.max(40, numeric(e.data?.width) ?? 250),
    height: Math.max(36, numeric(e.data?.height) ?? 166),
  }
}
function artUrl(e: Entity) {
  const asset = value(e, 'asset')
  return asset
    ? api.assetUrl(asset)
    : e.data?.coverPreset
      ? '/covers/' + encodeURIComponent(value(e, 'coverPreset')) + '.jpg'
      : ''
}
function frame(e: Entity, rows: Entity[], rect: (e: Entity) => Rect) {
  const members = rows.filter((a) => a.data?.groupId === e.id)
  if (!members.length) return rect(e)
  const r = bounds(members.map(rect))
  return {
    x: r.x - 16,
    y: r.y - 40,
    width: r.width + 32,
    height: r.height + 56,
  }
}
type BoardProps = {
  rows: Entity[]
  selected: string[]
  setSelected: (ids: string[]) => void
  change: (items: Entity[]) => void
  open: (id: string) => void
  upload: (files: File[], p?: Point) => void
  surface: RefObject<Surface | null>
}
function Board({
  rows,
  selected,
  setSelected,
  change,
  open,
  upload,
  surface,
}: BoardProps) {
  const getImage = useImages(),
    photos = rows.filter((e) => !isGroup(e)),
    groups = rows.filter(isGroup)
  const drag = useRef<{
    type: 'move' | 'resize' | 'marquee'
    start: Point
    end: Point
    ids: string[]
    base: string[]
  } | null>(null)
  function rect(e: Entity) {
    const r = geometry(e),
      d = drag.current
    if (!d || !d.ids.includes(e.id)) return r
    const dx = d.end.x - d.start.x,
      dy = d.end.y - d.start.y
    return d.type === 'resize'
      ? {
          ...r,
          width: Math.max(40, r.width + dx),
          height: Math.max(36, r.height + dy),
        }
      : { ...r, x: r.x + dx, y: r.y + dy }
  }
  const box = (a: Point, b: Point) => ({
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  })
  function hit(p: Point) {
    return (
      [...photos].reverse().find((e) => inside(p, rect(e), 3)) ??
      [...groups].reverse().find((e) => {
        const r = frame(e, photos, rect)
        return (
          inside(p, r, 4) &&
          !inside(p, {
            x: r.x + 8,
            y: r.y + 30,
            width: r.width - 16,
            height: r.height - 38,
          })
        )
      })
    )
  }
  const { canvas, api: board } = useCanvas({
    extent: () =>
      bounds([
        ...photos.map(geometry),
        ...groups.map((g) => frame(g, photos, geometry)),
      ]),
    draw(ctx, s) {
      dotGrid(ctx, s)
      for (const e of groups) {
        const r = frame(e, photos, rect)
        if (!intersects(s.view, r)) continue
        const color = value(e, 'color', '#548f92')
        ctx.fillStyle = color + '20'
        ctx.strokeStyle = selected.includes(e.id) ? s.colors.accent : color
        ctx.lineWidth = selected.includes(e.id) ? 3 : 2
        ctx.beginPath()
        ctx.roundRect(r.x, r.y, r.width, r.height, 9)
        ctx.fill()
        ctx.stroke()
        ctx.fillStyle = color
        ctx.font = 'bold 14px system-ui'
        ctx.fillText(e.title, r.x + 10, r.y + 22, r.width - 16)
      }
      for (const e of photos) {
        const r = rect(e)
        if (!intersects(s.view, r)) continue
        const img = getImage(artUrl(e), s.redraw)
        ctx.fillStyle = s.colors.paper
        ctx.fillRect(r.x, r.y, r.width, r.height)
        if (img) ctx.drawImage(img, r.x, r.y, r.width, r.height)
        ctx.fillStyle = '#101d2cc9'
        ctx.fillRect(r.x, r.y + r.height - 25, r.width, 25)
        ctx.fillStyle = '#fff'
        ctx.font = '12px system-ui'
        ctx.fillText(e.title, r.x + 8, r.y + r.height - 8, r.width - 14)
        if (selected.includes(e.id)) {
          ctx.strokeStyle = s.colors.accent
          ctx.lineWidth = 2.5 / s.camera.zoom
          ctx.strokeRect(r.x, r.y, r.width, r.height)
          ctx.fillStyle = s.colors.accent
          ctx.fillRect(r.x + r.width - 6, r.y + r.height - 6, 10, 10)
        }
      }
      const d = drag.current
      if (d?.type === 'marquee') {
        const r = box(d.start, d.end)
        ctx.fillStyle = s.colors.accent + '25'
        ctx.fillRect(r.x, r.y, r.width, r.height)
        ctx.strokeStyle = s.colors.accent
        ctx.strokeRect(r.x, r.y, r.width, r.height)
      }
    },
    down(p, ev, s) {
      const e = hit(p)
      if (!e) {
        drag.current = {
          type: 'marquee',
          start: p,
          end: p,
          ids: [],
          base: ev.shiftKey ? selected : [],
        }
        return
      }
      const selection = ev.shiftKey
        ? selected.includes(e.id)
          ? selected.filter((id) => id !== e.id)
          : [...selected, e.id]
        : selected.includes(e.id)
          ? selected
          : [e.id]
      const r = rect(e),
        resize =
          !isGroup(e) &&
          selected.includes(e.id) &&
          Math.hypot(p.x - r.x - r.width, p.y - r.y - r.height) <
            12 / s.camera.zoom
      setSelected(selection)
      const ids = resize
        ? [e.id]
        : [
            ...new Set([
              ...selection,
              ...photos
                .filter((a) => selection.includes(value(a, 'groupId')))
                .map((a) => a.id),
            ]),
          ]
      drag.current = {
        type: resize ? 'resize' : 'move',
        start: p,
        end: p,
        ids,
        base: selection,
      }
    },
    move(p) {
      if (drag.current) drag.current.end = p
    },
    up(p) {
      const d = drag.current
      if (!d) return
      d.end = p
      if (d.type === 'marquee') {
        const r = box(d.start, p)
        setSelected([
          ...new Set([
            ...d.base,
            ...photos
              .filter((e) => intersects(r, geometry(e)))
              .map((e) => e.id),
          ]),
        ])
      } else if (Math.hypot(p.x - d.start.x, p.y - d.start.y) > 1)
        change(
          rows
            .filter((e) => d.ids.includes(e.id))
            .map((e) => ({ ...e, data: { ...e.data, ...rect(e) } })),
        )
      drag.current = null
    },
    cancel() {
      drag.current = null
    },
    double(p) {
      const e = hit(p)
      if (e) open(e.id)
    },
  })
  useEffect(() => {
    surface.current = board.current
    return () => {
      surface.current = null
    }
  }, [surface, board])
  return (
    <canvas
      className="editor-canvas"
      tabIndex={0}
      aria-label="概念图画板"
      ref={canvas}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault()
        upload(
          [...Array.from(e.dataTransfer.files)],
          board.current?.point(e.clientX, e.clientY),
        )
      }}
    />
  )
}
export default function ConceptArtView() {
  const w = useWorkspace(),
    history = useEntityCommands(),
    file = useRef<HTMLInputElement>(null),
    surface = useRef<Surface | null>(null)
  const [tab, setTab] = useState('画板'),
    [selected, setSelected] = useState<string[]>([]),
    [action, setAction] = useState(''),
    [query, setQuery] = useState(''),
    [filter, setFilter] = useState('')
  const rows = w.entities
      .filter((e) => e.entityType === 'concept_art')
      .sort(
        (a, b) =>
          (numeric(a.data?.zIndex) ?? a.sortOrder) -
          (numeric(b.data?.zIndex) ?? b.sortOrder),
      ),
    photos = rows.filter((e) => !isGroup(e)),
    groups = rows.filter(isGroup)
  const chosen = photos.filter((e) => selected.includes(e.id)),
    preview = rows.find((e) => e.id === w.selected),
    maxZ = Math.max(
      0,
      ...rows.map((e) => numeric(e.data?.zIndex) ?? e.sortOrder),
    )
  function front() {
    if (chosen.length)
      void history.change(
        chosen.map((e, i) => ({
          ...e,
          data: { ...e.data, zIndex: maxZ + i + 1 },
        })),
      )
  }
  function remove() {
    const removed = rows.filter((e) => selected.includes(e.id)),
      remaining = photos.filter(
        (e) =>
          !selected.includes(e.id) && selected.includes(value(e, 'groupId')),
      )
    if (removed.length)
      void history.change(
        remaining.map((e) => ({ ...e, data: { ...e.data, groupId: null } })),
        removed,
      )
    setSelected([])
  }
  async function upload(files: File[], position?: Point) {
    const view = surface.current?.view,
      p =
        position ??
        (view
          ? { x: view.x + view.width * 0.35, y: view.y + view.height * 0.35 }
          : { x: 0, y: 0 })
    const entries: Entity[] = []
    for (const image of files.filter((f) => f.type.startsWith('image/'))) {
      try {
        const info = await api.saveAsset(image),
          img = new Image()
        img.src = api.assetUrl(info.filename)
        await img.decode()
        const w0 = Math.min(320, img.naturalWidth),
          e = newEntity(
            w.project.id,
            'concept_art',
            image.name.replace(/\.[^.]+$/, '') || '概念图',
          )
        const i = entries.length
        e.data = {
          asset: info.filename,
          x: p.x + i * 30,
          y: p.y + i * 30,
          width: w0,
          height: Math.max(36, (w0 * img.naturalHeight) / img.naturalWidth),
          zIndex: maxZ + i + 1,
          tags: [],
        }
        entries.push(e)
      } catch (error) {
        w.notify(String(error))
      }
    }
    if (entries.length) {
      await history.change(entries)
      setSelected(entries.map((e) => e.id))
    }
  }
  const latest = useRef(upload)
  latest.current = upload
  useEffect(() => {
    function paste(e: ClipboardEvent) {
      const files = Array.from(e.clipboardData?.files ?? [])
      if (
        files.some((f) => f.type.startsWith('image/')) &&
        !document.querySelector('dialog[open]')
      ) {
        e.preventDefault()
        void latest.current(files)
      }
    }
    window.addEventListener('paste', paste)
    return () => window.removeEventListener('paste', paste)
  }, [])
  useKeys((e) => {
    if (historyKey(e, history)) return true
    if (e.ctrlKey || e.metaKey) return
    switch (e.key.toLowerCase()) {
      case 'u':
        file.current?.click()
        return true
      case 'c':
        if (chosen.length) setAction('group')
        return true
      case ']':
        front()
        return true
      case 'f':
        surface.current?.fit()
        return true
      case 'delete':
        remove()
        return true
    }
  })
  const related = (e: Entity, id: string) =>
    strings(e.data?.tags).includes(id) ||
    w.links.some(
      (l) =>
        (l.sourceId === e.id && l.targetId === id) ||
        (l.targetId === e.id && l.sourceId === id),
    )
  return (
    <section className="world visual-editor">
      <Heading
        title="概念图"
        tabs={['画板', '图库']}
        active={tab}
        choose={setTab}
      >
        <button className="primary" onClick={() => file.current?.click()}>
          上传图片 (U)
        </button>
      </Heading>
      <input
        type="file"
        hidden
        multiple
        ref={file}
        accept="image/*"
        onChange={(e) => {
          void upload(Array.from(e.target.files ?? []))
          e.target.value = ''
        }}
      />
      <div className="visual-tools">
        <small>
          {photos.length} 张图 · {groups.length} 条注释
        </small>
        <button disabled={!chosen.length} onClick={() => setAction('group')}>
          新建分组注释 (C)
        </button>
        <button disabled={!chosen.length} onClick={front}>
          置顶 (])
        </button>
        {tab === '画板' && (
          <button onClick={() => surface.current?.fit()}>适配视野 (F)</button>
        )}
        <button disabled={!history.canUndo} onClick={history.undo}>
          撤销
        </button>
        <button disabled={!history.canRedo} onClick={history.redo}>
          重做
        </button>
      </div>
      {tab === '画板' ? (
        <div className="canvas-stage">
          <Board
            {...{ rows, selected, setSelected, upload, surface }}
            open={w.inspect}
            change={history.change}
          />
          {selected.length > 0 && (
            <div className="selection-pill">
              <span>已选 {selected.length}</span>
              {chosen.length > 0 && (
                <>
                  <button onClick={() => setAction('group')}>
                    写分组注释 (C)
                  </button>
                  <button onClick={() => setAction('tag')}>关联实体</button>
                  <button onClick={front}>置顶 (])</button>
                </>
              )}
              <button onClick={remove}>删除</button>
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="visual-tools">
            <SearchField label="搜索概念图" query={query} set={setQuery} />
            <EntitySelect
              label="关联实体筛选"
              rows={w.entities.filter((e) => e.entityType !== 'concept_art')}
              current={filter}
              change={setFilter}
              empty="全部关联实体"
            />
          </div>
          <div className="art-gallery">
            {photos
              .filter(
                (e) =>
                  (e.title + e.summary)
                    .toLowerCase()
                    .includes(query.trim().toLowerCase()) &&
                  (!filter || related(e, filter)),
              )
              .map((e) => (
                <button key={e.id} onClick={() => w.inspect(e.id)}>
                  <img src={artUrl(e)} alt={e.title} />
                  <strong>{e.title}</strong>
                </button>
              ))}
          </div>
        </>
      )}
      {action && (
        <Modal
          title={action === 'group' ? '分组注释' : '关联实体'}
          onClose={() => setAction('')}
        >
          <form
            className="form-body stack"
            onSubmit={(ev) => {
              ev.preventDefault()
              const f = new FormData(ev.currentTarget)
              if (action === 'group') {
                const e = newEntity(
                  w.project.id,
                  'concept_art',
                  String(f.get('title')).trim() || '分组注释',
                )
                e.data = {
                  kind: 'group',
                  color: String(f.get('color')),
                  ...bounds(chosen.map(geometry)),
                }
                void history.change([
                  e,
                  ...chosen.map((a) => ({
                    ...a,
                    data: { ...a.data, groupId: e.id },
                  })),
                ])
                setSelected([e.id])
              } else {
                const id = String(f.get('entity'))
                void history.change(
                  chosen.map((e) => ({
                    ...e,
                    data: {
                      ...e.data,
                      tags: [...new Set([...strings(e.data?.tags), id])],
                    },
                  })),
                )
              }
              setAction('')
            }}
          >
            {action === 'group' ? (
              <>
                <label className="field">
                  注释标题
                  <input name="title" required autoFocus />
                </label>
                <label>
                  边框颜色{' '}
                  <input type="color" name="color" defaultValue="#498a89" />
                </label>
              </>
            ) : (
              <select name="entity" aria-label="关联实体" required>
                {w.entities
                  .filter((e) => e.entityType !== 'concept_art')
                  .map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.title}
                    </option>
                  ))}
              </select>
            )}
            <button className="primary">保存</button>
          </form>
        </Modal>
      )}
      {preview && (
        <Modal title={preview.title} onClose={w.close} wide>
          <div className="form-body stack">
            {!isGroup(preview) && (
              <img
                className="art-preview"
                src={artUrl(preview)}
                alt={preview.title}
              />
            )}
            <label className="field">
              标题
              <input
                key={preview.id}
                defaultValue={preview.title}
                onBlur={(ev) => {
                  const title = ev.target.value.trim()
                  if (title && title !== preview.title)
                    void history.change([{ ...preview, title }])
                }}
              />
            </label>
            {isGroup(preview) && (
              <label>
                边框颜色{' '}
                <input
                  type="color"
                  value={value(preview, 'color', '#498a89')}
                  onChange={(ev) =>
                    void history.change([
                      {
                        ...preview,
                        data: { ...preview.data, color: ev.target.value },
                      },
                    ])
                  }
                />
              </label>
            )}
            {strings(preview.data?.tags).map((id) => (
              <div className="split" key={id}>
                <button
                  onClick={() => {
                    const e = w.entities.find((e) => e.id === id)
                    if (e) w.openEntity(e)
                  }}
                >
                  {w.entities.find((e) => e.id === id)?.title ?? scalar(id)}
                </button>
                <button
                  onClick={() =>
                    void history.change([
                      {
                        ...preview,
                        data: {
                          ...preview.data,
                          tags: strings(preview.data?.tags).filter(
                            (s) => s !== id,
                          ),
                        },
                      },
                    ])
                  }
                >
                  移除标签
                </button>
              </div>
            ))}
            <EntityLinkPanel entity={preview} />
          </div>
        </Modal>
      )}
    </section>
  )
}
