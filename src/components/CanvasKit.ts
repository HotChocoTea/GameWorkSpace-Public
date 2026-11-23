import { useEffect, useLayoutEffect, useRef, useState } from 'react'

export type Point = { x: number; y: number }
export type Rect = Point & { width: number; height: number }
export type Camera = Point & { zoom: number }
export const clamp = (n: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, n))
export const screenToWorld = (p: Point, c: Camera) => ({
  x: (p.x - c.x) / c.zoom,
  y: (p.y - c.y) / c.zoom,
})
export const worldToScreen = (p: Point, c: Camera) => ({
  x: p.x * c.zoom + c.x,
  y: p.y * c.zoom + c.y,
})
export function zoomAtPoint(c: Camera, p: Point, factor: number): Camera {
  const w = screenToWorld(p, c),
    zoom = clamp(c.zoom * factor, 0.03, 8)
  return { zoom, x: p.x - w.x * zoom, y: p.y - w.y * zoom }
}
export function fitBounds(b: Rect, width: number, height: number): Camera {
  const zoom = clamp(
    Math.min(
      (width - 56) / Math.max(b.width, 1),
      (height - 56) / Math.max(b.height, 1),
    ),
    0.03,
    1.6,
  )
  return {
    zoom,
    x: (width - b.width * zoom) / 2 - b.x * zoom,
    y: (height - b.height * zoom) / 2 - b.y * zoom,
  }
}
export const inside = (p: Point, b: Rect, pad = 0) =>
  p.x >= b.x - pad &&
  p.x <= b.x + b.width + pad &&
  p.y >= b.y - pad &&
  p.y <= b.y + b.height + pad
export const intersects = (a: Rect, b: Rect) =>
  a.x <= b.x + b.width &&
  b.x <= a.x + a.width &&
  a.y <= b.y + b.height &&
  b.y <= a.y + a.height
export function bounds(rects: Rect[]): Rect {
  if (!rects.length) return { x: 0, y: 0, width: 640, height: 360 }
  let x = Infinity,
    y = Infinity,
    right = -Infinity,
    bottom = -Infinity
  for (const r of rects) {
    x = Math.min(x, r.x)
    y = Math.min(y, r.y)
    right = Math.max(right, r.x + r.width)
    bottom = Math.max(bottom, r.y + r.height)
  }
  return { x, y, width: right - x, height: bottom - y }
}

// Transactions enter the history only after the corresponding write succeeds.
export class HistoryStack<T> {
  private past: T[] = []
  private future: T[] = []
  constructor(private limit = 50) {}
  push(value: T) {
    this.past.push(value)
    if (this.past.length > this.limit) this.past.shift()
    this.future = []
  }
  get canUndo() {
    return !!this.past.length
  }
  get canRedo() {
    return !!this.future.length
  }
  async travel(redo: boolean, apply: (entry: T) => void | Promise<void>) {
    const source = redo ? this.future : this.past,
      target = redo ? this.past : this.future
    if (!source.length) return
    const entry = source[source.length - 1]
    await apply(entry)
    source.pop()
    target.push(entry)
  }
}
type Action = () => void | Promise<void>
export function useCommands(report: (msg: string) => void) {
  const history = useRef(new HistoryStack<{ undo: Action; redo: Action }>())
  const queue = useRef(Promise.resolve()),
    [, render] = useState(0)
  function enqueue(fn: Action) {
    const op = queue.current.then(fn)
    queue.current = op
      .catch((e) => report(String(e)))
      .finally(() => render((n) => n + 1))
    return op
  }
  const commit = (redo: Action, undo: Action) =>
    enqueue(async () => {
      await redo()
      history.current.push({ redo, undo })
    })
  const undo = () =>
    enqueue(() => history.current.travel(false, (c) => c.undo()))
  const redo = () =>
    enqueue(() => history.current.travel(true, (c) => c.redo()))
  return {
    commit,
    record(redo: Action, undo: Action) {
      history.current.push({ redo, undo })
      render((n) => n + 1)
    },
    undo,
    redo,
    canUndo: history.current.canUndo,
    canRedo: history.current.canRedo,
  }
}
export type Commands = ReturnType<typeof useCommands>
export function useKeys(fn: (event: KeyboardEvent) => boolean | void) {
  const latest = useRef(fn)
  latest.current = fn
  useEffect(() => {
    function key(e: KeyboardEvent) {
      if (
        e.defaultPrevented ||
        e.isComposing ||
        (e.target instanceof Element &&
          e.target.closest(
            'input,textarea,select,[contenteditable="true"],[role="dialog"]',
          )) ||
        document.querySelector('dialog[open],[role="dialog"]')
      )
        return
      if (latest.current(e)) e.preventDefault()
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [])
}
export function historyKey(e: KeyboardEvent, c: Commands) {
  if (!e.ctrlKey && !e.metaKey) return false
  const key = e.key.toLowerCase()
  if (key === 'y' || (key === 'z' && e.shiftKey)) {
    void c.redo()
    return true
  }
  if (key === 'z') {
    void c.undo()
    return true
  }
  return false
}
export interface Surface {
  camera: Camera
  width: number
  height: number
  view: Rect
  colors: {
    paper: string
    ink: string
    muted: string
    line: string
    accent: string
    ground: string
  }
  redraw: () => void
  fit: (rect?: Rect) => void
  center: (p: Point, zoom?: number) => void
  zoom: (factor: number) => void
  point: (clientX: number, clientY: number) => Point
}
type Gesture = (p: Point, e: PointerEvent, s: Surface) => void
export interface CanvasOptions {
  draw: (ctx: CanvasRenderingContext2D, s: Surface) => void
  extent: () => Rect
  down?: (p: Point, e: PointerEvent, s: Surface) => boolean | void
  move?: Gesture
  up?: Gesture
  cancel?: () => void
  double?: (p: Point) => void
  leave?: () => void
}
export function useCanvas(options: CanvasOptions) {
  const canvas = useRef<HTMLCanvasElement>(null),
    api = useRef<Surface | null>(null),
    latest = useRef(options)
  latest.current = options
  useLayoutEffect(() => {
    const el = canvas.current
    if (!el) return
    const ctx = el.getContext('2d')
    if (!ctx) return
    let frame = 0,
      dpr = 1,
      first = true,
      space = false,
      pan: Point | null = null,
      active: number | null = null
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)')
    let motion: { from: Camera; to: Camera; start: number } | undefined
    function glide(to: Camera) {
      if (reducedMotion.matches || first) {
        motion = undefined
        s.camera = to
      } else motion = { from: { ...s.camera }, to, start: performance.now() }
      s.redraw()
    }
    const s: Surface = {
      camera: { x: 0, y: 0, zoom: 1 },
      width: 0,
      height: 0,
      view: bounds([]),
      colors: {
        paper: '',
        ink: '',
        muted: '',
        line: '',
        accent: '',
        ground: '',
      },
      redraw() {
        if (!frame) frame = requestAnimationFrame(paint)
      },
      fit(b) {
        glide(fitBounds(b ?? latest.current.extent(), s.width, s.height))
      },
      center(p, zoom = s.camera.zoom) {
        glide({
          x: s.width / 2 - p.x * zoom,
          y: s.height / 2 - p.y * zoom,
          zoom,
        })
      },
      zoom(f) {
        glide(
          zoomAtPoint(
            motion?.to ?? s.camera,
            { x: s.width / 2, y: s.height / 2 },
            f,
          ),
        )
      },
      point(x, y) {
        const r = el.getBoundingClientRect()
        return screenToWorld({ x: x - r.left, y: y - r.top }, s.camera)
      },
    }
    api.current = s
    function colors() {
      const css = getComputedStyle(el!)
      const get = (v: string) => css.getPropertyValue(v).trim()
      s.colors = {
        paper: get('--surface'),
        ink: get('--ink'),
        muted: get('--muted'),
        line: get('--line'),
        accent: get('--accent'),
        ground: get('--bg') || get('--surface'),
      }
      s.redraw()
    }
    function resize() {
      const r = el!.getBoundingClientRect()
      if (!r.width || !r.height) return
      dpr = window.devicePixelRatio || 1
      s.width = r.width
      s.height = r.height
      el!.width = Math.round(r.width * dpr)
      el!.height = Math.round(r.height * dpr)
      if (first) {
        s.fit()
        first = false
      }
      s.redraw()
    }
    function paint() {
      frame = 0
      if (dpr !== (window.devicePixelRatio || 1)) resize()
      if (motion) {
        const { from, to, start } = motion
        const fraction = clamp((performance.now() - start) / 150, 0, 1)
        const t = 1 - (1 - fraction) ** 3
        s.camera = {
          x: from.x + (to.x - from.x) * t,
          y: from.y + (to.y - from.y) * t,
          zoom: from.zoom + (to.zoom - from.zoom) * t,
        }
        if (fraction < 1) s.redraw()
        else motion = undefined
      }
      const { x, y, zoom } = s.camera
      s.view = {
        ...screenToWorld({ x: 0, y: 0 }, s.camera),
        width: s.width / zoom,
        height: s.height / zoom,
      }
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx!.clearRect(0, 0, s.width, s.height)
      ctx!.save()
      ctx!.transform(zoom, 0, 0, zoom, x, y)
      latest.current.draw(ctx!, s)
      ctx!.restore()
    }
    const pos = (e: MouseEvent) => s.point(e.clientX, e.clientY)
    const down = (e: PointerEvent) => {
      if (active !== null || e.button > 1) return
      motion = undefined
      el.focus({ preventScroll: true })
      el.setPointerCapture(e.pointerId)
      active = e.pointerId
      if (
        e.button === 1 ||
        space ||
        latest.current.down?.(pos(e), e, s) === false
      )
        pan = { x: e.clientX, y: e.clientY }
      s.redraw()
    }
    const move = (e: PointerEvent) => {
      if (active !== null && active !== e.pointerId) return
      if (pan) {
        s.camera.x += e.clientX - pan.x
        s.camera.y += e.clientY - pan.y
        pan = { x: e.clientX, y: e.clientY }
      } else latest.current.move?.(pos(e), e, s)
      s.redraw()
    }
    const up = (e: PointerEvent) => {
      if (e.pointerId !== active) return
      if (!pan) latest.current.up?.(pos(e), e, s)
      active = null
      pan = null
      s.redraw()
    }
    const cancel = () => {
      active = null
      pan = null
      latest.current.cancel?.()
      s.redraw()
    }
    const dbl = (e: MouseEvent) => latest.current.double?.(pos(e))
    const leave = () => {
      if (active === null) {
        latest.current.leave?.()
        s.redraw()
      }
    }
    const wheel = (e: WheelEvent) => {
      e.preventDefault()
      const r = el.getBoundingClientRect()
      glide(
        zoomAtPoint(
          motion?.to ?? s.camera,
          { x: e.clientX - r.left, y: e.clientY - r.top },
          Math.exp(-clamp(e.deltaY, -230, 230) * 0.0018),
        ),
      )
    }
    const key = (e: KeyboardEvent) => {
      if (
        e.code === 'Space' &&
        (document.activeElement === el ||
          (el.matches(':hover') &&
            !(
              e.target instanceof Element &&
              e.target.closest('input,textarea,select')
            )))
      ) {
        space = e.type === 'keydown'
        e.preventDefault()
      } else if (e.type === 'keyup') space = false
    }
    const blur = () => {
      space = false
      if (active !== null) cancel()
    }
    const observer = new ResizeObserver(resize)
    observer.observe(el)
    const theme = new MutationObserver(colors)
    for (let parent: Element | null = el; parent; parent = parent.parentElement)
      theme.observe(parent, {
        attributes: true,
        attributeFilter: ['class', 'style', 'data-theme', 'data-brightness'],
      })
    colors()
    resize()
    const events = {
      pointerdown: down,
      pointermove: move,
      pointerup: up,
      pointercancel: cancel,
      dblclick: dbl,
      pointerleave: leave,
      wheel,
    }
    for (const [k, fn] of Object.entries(events))
      el.addEventListener(k, fn as EventListener, { passive: false })
    window.addEventListener('keydown', key)
    window.addEventListener('keyup', key)
    window.addEventListener('blur', blur)
    window.addEventListener('resize', resize)
    return () => {
      for (const [k, fn] of Object.entries(events))
        el.removeEventListener(k, fn as EventListener)
      observer.disconnect()
      theme.disconnect()
      window.removeEventListener('keydown', key)
      window.removeEventListener('keyup', key)
      window.removeEventListener('blur', blur)
      window.removeEventListener('resize', resize)
      cancelAnimationFrame(frame)
      api.current = null
    }
  }, [])
  useLayoutEffect(() => {
    api.current?.redraw()
  })
  return { canvas, api }
}

export function dotGrid(ctx: CanvasRenderingContext2D, s: Surface) {
  const { view: v, camera, colors } = s,
    step = 24 * Math.max(1, Math.ceil(0.55 / camera.zoom))
  ctx.fillStyle = colors.line
  for (let x = Math.floor(v.x / step) * step; x < v.x + v.width; x += step)
    for (let y = Math.floor(v.y / step) * step; y < v.y + v.height; y += step)
      ctx.fillRect(x, y, 1.4 / camera.zoom, 1.4 / camera.zoom)
}
export function useImages() {
  const cache = useRef(new Map<string, HTMLImageElement>())
  useEffect(
    () => () => {
      for (const img of cache.current.values()) img.onload = null
      cache.current.clear()
    },
    [],
  )
  return (url: string, refresh: () => void) => {
    if (!url) return
    let img = cache.current.get(url)
    if (!img) {
      img = new Image()
      img.onload = refresh
      cache.current.set(url, img)
      img.src = url
    }
    if (img.complete && img.naturalWidth) return img
  }
}
