import { useImperativeHandle, useRef, type Ref } from 'react'
import {
  bounds,
  dotGrid,
  inside,
  intersects,
  useCanvas,
  useImages,
  type Point,
  type Rect,
  type Surface,
} from './CanvasKit'

export interface BoardNode extends Rect {
  id: string
  title: string
  subtitle?: string
  badge?: string
  color: string
  image?: string
  icon?: string
  circle?: boolean
  visited?: boolean
}
export interface BoardEdge {
  id: string
  from: string
  to: string
  label?: string
  dashed?: boolean
  active?: boolean
  editable?: boolean
}
export interface BoardControls {
  fit: () => void
  zoom: (factor: number) => void
  focus: (id: string) => void
  center: () => Point
}
interface Props {
  label: string
  nodes: BoardNode[]
  edges: BoardEdge[]
  selected?: string
  selectedEdge?: string
  controls?: Ref<BoardControls>
  extent?: Rect
  background?: (ctx: CanvasRenderingContext2D, s: Surface) => void
  step?: (nodes: BoardNode[], held?: string) => boolean
  select?: (id: string) => void
  open?: (id: string) => void
  move?: (id: string, p: Point) => void
  lockColumn?: boolean
  connect?: (
    from: string,
    to: string | undefined,
    p: Point,
    alt: boolean,
  ) => void
  edge?: (id: string) => void
  drop?: (type: string, p: Point) => void
  neighborhood?: boolean
}
const middle = (n: Rect) => ({ x: n.x + n.width / 2, y: n.y + n.height / 2 })
const port = (n: Rect, right = true) => ({
  x: n.x + (right ? n.width : 0),
  y: n.y + n.height / 2,
})
const near = (a: Point, b: Point, r: number) =>
  Math.hypot(a.x - b.x, a.y - b.y) <= r
function curve(a: Point, b: Point, bend = 0) {
  const d = Math.max(36, Math.abs(b.x - a.x) * 0.44)
  return [a, { x: a.x + d, y: a.y + bend }, { x: b.x - d, y: b.y + bend }, b]
}
function onCurve([a, b, c, d]: Point[], t: number) {
  const u = 1 - t
  return {
    x: u ** 3 * a.x + 3 * u * u * t * b.x + 3 * u * t * t * c.x + t ** 3 * d.x,
    y: u ** 3 * a.y + 3 * u * u * t * b.y + 3 * u * t * t * c.y + t ** 3 * d.y,
  }
}
function path(ctx: CanvasRenderingContext2D, [a, b, c, d]: Point[]) {
  ctx.beginPath()
  ctx.moveTo(a.x, a.y)
  ctx.bezierCurveTo(b.x, b.y, c.x, c.y, d.x, d.y)
  ctx.stroke()
}
function pill(
  ctx: CanvasRenderingContext2D,
  p: Point,
  text: string,
  s: Surface,
) {
  ctx.font = '11px system-ui'
  const w = ctx.measureText(text).width + 12
  ctx.fillStyle = s.colors.paper
  ctx.beginPath()
  ctx.roundRect(p.x - w / 2, p.y - 9, w, 18, 7)
  ctx.fill()
  ctx.fillStyle = s.colors.muted
  ctx.textAlign = 'center'
  ctx.fillText(text, p.x, p.y + 4)
  ctx.textAlign = 'left'
}
export function NodeCanvas(p: Props) {
  const image = useImages()
  const hover = useRef(''),
    drag = useRef<{
      node: BoardNode
      start: Point
      end: Point
      link: boolean
      moved: boolean
    } | null>(null)
  const topFirst = [...p.nodes].reverse()
  const nodeAt = (pt: Point) =>
    topFirst.find((n) =>
      n.circle ? near(pt, middle(n), n.width / 2 + 5) : inside(pt, n, 5),
    )
  const keyMap = new Map(p.nodes.map((n) => [n.id, n]))
  const pairs = new Map<string, BoardEdge[]>()
  for (const edge of p.edges) {
    const pair =
      edge.from < edge.to ? [edge.from, edge.to] : [edge.to, edge.from]
    const key = JSON.stringify(pair)
    const siblings = pairs.get(key)
    if (siblings) siblings.push(edge)
    else pairs.set(key, [edge])
  }
  const offsets = new Map<string, number>()
  for (const siblings of pairs.values())
    siblings.forEach((edge, i) => {
      offsets.set(edge.id, (i - (siblings.length - 1) / 2) * 34)
    })
  function line(e: BoardEdge) {
    const a = keyMap.get(e.from),
      b = keyMap.get(e.to)
    if (!a || !b) return
    if (a.circle && b.circle) {
      const u = middle(a),
        v = middle(b)
      const offset = (offsets.get(e.id) ?? 0) * (e.from < e.to ? 1 : -1)
      if (!offset) return [u, u, v, v]
      const dx = v.x - u.x,
        dy = v.y - u.y,
        length = Math.hypot(dx, dy) || 1
      const control = (t: number) => ({
        x: u.x + dx * t - (dy / length) * offset,
        y: u.y + dy * t + (dx / length) * offset,
      })
      return [u, control(1 / 3), control(2 / 3), v]
    }
    const start = port(a),
      end = port(b, false)
    // Route long dependencies around the intervening cards. Horizontal recipes
    // can otherwise share an entire segment and prevent selection of a material.
    const detour = Math.min(
      110,
      Math.max(0, Math.abs(end.x - start.x) - 170) * 0.24,
    )
    return curve(start, end, (offsets.get(e.id) ?? 0) - detour)
  }
  const { canvas, api } = useCanvas({
    extent: () => p.extent ?? bounds(p.nodes),
    draw(ctx, s) {
      if (p.step?.(p.nodes, drag.current?.node.id)) s.redraw()
      dotGrid(ctx, s)
      p.background?.(ctx, s)
      const d = drag.current,
        n = d && keyMap.get(d.node.id)
      const original = n && { x: n.x, y: n.y }
      if (n && d && !d.link && p.move) {
        if (!p.lockColumn) n.x += d.end.x - d.start.x
        n.y += d.end.y - d.start.y
      }
      const focused = p.neighborhood && hover.current
      const neighbors = new Set([focused])
      for (const e of p.edges) {
        const points = line(e)
        if (!points) continue
        const lit = !focused || e.from === focused || e.to === focused
        if (focused && lit) {
          neighbors.add(e.from)
          neighbors.add(e.to)
        }
        if (
          !intersects(
            bounds(points.map((pt) => ({ ...pt, width: 1, height: 1 }))),
            s.view,
          )
        )
          continue
        ctx.globalAlpha = lit ? 1 : 0.15
        ctx.strokeStyle =
          e.active || e.id === p.selectedEdge ? s.colors.accent : s.colors.muted
        ctx.lineWidth = e.active || e.id === p.selectedEdge ? 3 : 1.5
        ctx.setLineDash(e.dashed ? [6, 5] : [])
        path(ctx, points)
        ctx.setLineDash([])
        if (!keyMap.get(e.to)?.circle) {
          const end = points[3]
          ctx.fillStyle = ctx.strokeStyle
          ctx.beginPath()
          ctx.moveTo(end.x - 4, end.y)
          ctx.lineTo(end.x - 12, end.y - 4)
          ctx.lineTo(end.x - 12, end.y + 4)
          ctx.closePath()
          ctx.fill()
        }
        if (e.label) pill(ctx, onCurve(points, 0.5), e.label, s)
      }
      for (const node of p.nodes) {
        if (
          !intersects(
            {
              ...node,
              x: node.x - 45,
              width: node.width + 90,
              height: node.height + 30,
            },
            s.view,
          )
        )
          continue
        ctx.globalAlpha = focused && !neighbors.has(node.id) ? 0.25 : 1
        const selected = node.id === p.selected || node.id === hover.current
        ctx.strokeStyle = selected
          ? s.colors.accent
          : node.visited
            ? node.color
            : s.colors.line
        ctx.lineWidth = selected ? 3 : node.visited ? 2.5 : 1.4
        ctx.fillStyle = s.colors.paper
        ctx.beginPath()
        const mid = middle(node),
          img = image(node.image ?? '', s.redraw)
        if (node.circle) ctx.arc(mid.x, mid.y, node.width / 2, 0, 2 * Math.PI)
        else ctx.roundRect(node.x, node.y, node.width, node.height, 9)
        ctx.fill()
        ctx.stroke()
        if (node.circle) {
          ctx.save()
          ctx.clip()
          ctx.fillStyle = node.color
          ctx.fillRect(node.x, node.y, node.width, node.height)
          if (img) ctx.drawImage(img, node.x, node.y, node.width, node.height)
          else {
            ctx.fillStyle = '#fff'
            ctx.textAlign = 'center'
            ctx.font = 'bold 20px system-ui'
            ctx.fillText(node.icon || node.title.slice(0, 1), mid.x, mid.y + 7)
          }
          ctx.restore()
          ctx.fillStyle = s.colors.ink
          ctx.font =
            Math.max(12, Math.min(22, 10.5 / s.camera.zoom)) + 'px system-ui'
          ctx.textAlign = 'center'
          ctx.fillText(node.title, mid.x, node.y + node.height + 16, 125)
          ctx.textAlign = 'left'
        } else {
          ctx.fillStyle = node.color
          ctx.fillRect(node.x + 1, node.y + 9, 4, node.height - 18)
          if (img) ctx.drawImage(img, node.x + 11, node.y + 10, 24, 24)
          ctx.fillStyle = s.colors.ink
          ctx.font = '600 14px system-ui'
          const x = node.x + (img ? 42 : 13)
          ctx.fillText(
            (!img && node.icon ? node.icon + '  ' : '') + node.title,
            x,
            node.y + 22,
            node.x + node.width - x - 10,
          )
          ctx.font = '12px system-ui'
          ctx.fillStyle = s.colors.muted
          ctx.fillText(
            node.subtitle ?? '',
            node.x + 13,
            node.y + 43,
            node.width - 24,
          )
          if (node.badge) {
            ctx.fillStyle = node.color + '20'
            ctx.beginPath()
            ctx.roundRect(
              node.x + 8,
              node.y + node.height - 24,
              ctx.measureText(node.badge).width + 12,
              20,
              7,
            )
            ctx.fill()
            ctx.fillStyle = node.color
            ctx.fillText(
              node.badge,
              node.x + 13,
              node.y + node.height - 9,
              node.width - 22,
            )
          }
        }
        if (p.connect && (!node.circle || selected)) {
          const out = port(node)
          ctx.fillStyle = node.color
          ctx.beginPath()
          ctx.arc(out.x, out.y, node.circle ? 9 : 5, 0, Math.PI * 2)
          ctx.fill()
          if (node.circle) {
            ctx.textAlign = 'center'
            ctx.font = 'bold 13px system-ui'
            ctx.fillStyle = '#fff'
            ctx.fillText('+', out.x, out.y + 4)
            ctx.textAlign = 'left'
          } else {
            ctx.strokeStyle = node.color
            ctx.lineWidth = 1
            ctx.beginPath()
            ctx.arc(node.x, out.y, 3, 0, Math.PI * 2)
            ctx.stroke()
          }
        }
      }
      ctx.globalAlpha = 1
      if (d?.link && n) {
        ctx.strokeStyle = s.colors.accent
        ctx.lineWidth = 2
        ctx.setLineDash([5, 4])
        path(ctx, curve(port(n), d.end))
        ctx.setLineDash([])
      }
      if (original && n) Object.assign(n, original)
    },
    down(pt, e, s) {
      const handle =
        p.connect &&
        topFirst.find(
          (n) =>
            (!n.circle || [hover.current, p.selected].includes(n.id)) &&
            near(pt, port(n), Math.max(9, 7 / s.camera.zoom)),
        )
      const node = handle || nodeAt(pt)
      if (node) {
        drag.current = {
          node,
          start: pt,
          end: pt,
          link: !!p.connect && (!!handle || e.shiftKey),
          moved: false,
        }
        return
      }
      if (p.edge) {
        let closest: BoardEdge | undefined
        let distance = Math.max(6, 6 / s.camera.zoom)
        for (const edge of [...p.edges].reverse()) {
          if (edge.editable === false) continue
          const pts = line(edge)
          if (!pts) continue
          const label = onCurve(pts, 0.5)
          if (
            edge.label &&
            Math.abs(pt.y - label.y) <= 9 &&
            Math.abs(pt.x - label.x) <= edge.label.length * 3 + 6
          ) {
            p.edge(edge.id)
            return
          }
          let last = pts[0]
          for (let i = 1; i <= 32; i++) {
            const next = onCurve(pts, i / 32),
              dx = next.x - last.x,
              dy = next.y - last.y
            const t = Math.max(
              0,
              Math.min(
                1,
                ((pt.x - last.x) * dx + (pt.y - last.y) * dy) /
                  (dx * dx + dy * dy || 1),
              ),
            )
            const gap = Math.hypot(
              pt.x - last.x - dx * t,
              pt.y - last.y - dy * t,
            )
            if (gap < distance) {
              closest = edge
              distance = gap
            }
            last = next
          }
        }
        if (closest) {
          p.edge(closest.id)
          return
        }
      }
      return false
    },
    move(pt, _e, s) {
      const d = drag.current
      if (d) {
        d.end = pt
        if (!near(pt, d.start, 3 / s.camera.zoom)) d.moved = true
      } else hover.current = nodeAt(pt)?.id ?? ''
    },
    up(pt, e) {
      const d = drag.current
      drag.current = null
      if (!d) return
      if (d.link && d.moved) {
        const target = nodeAt(pt)
        if (target?.id !== d.node.id)
          p.connect?.(d.node.id, target?.id, pt, e.altKey)
      } else if (d.moved && p.move)
        p.move(d.node.id, {
          x: d.node.x + pt.x - d.start.x,
          y: d.node.y + pt.y - d.start.y,
        })
      else if (!d.moved) p.select?.(d.node.id)
    },
    cancel() {
      drag.current = null
    },
    leave() {
      hover.current = ''
    },
    double(pt) {
      const n = nodeAt(pt)
      if (n) p.open?.(n.id)
    },
  })
  useImperativeHandle(p.controls, () => ({
    fit: () => api.current?.fit(),
    zoom: (f) => api.current?.zoom(f),
    focus: (id) => {
      const n = keyMap.get(id)
      if (n) api.current?.center(middle(n), 1.15)
    },
    center: () => (api.current ? middle(api.current.view) : { x: 80, y: 80 }),
  }))
  return (
    <canvas
      className="editor-canvas"
      tabIndex={0}
      aria-label={p.label}
      ref={canvas}
      onDragOver={(e) => {
        if (p.drop) e.preventDefault()
      }}
      onDrop={(e) => {
        e.preventDefault()
        const s = api.current
        if (s)
          p.drop?.(
            e.dataTransfer.getData('text/plain'),
            s.point(e.clientX, e.clientY),
          )
      }}
    />
  )
}
