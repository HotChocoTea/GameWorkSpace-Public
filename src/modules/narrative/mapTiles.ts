import type { MapRecord } from '../../types'
import { list, record, scalar } from '../world/worldUtils'
import type { Point, Rect } from '../../components/CanvasKit'
export const terrains = [
  ['地面', '#b2a384'],
  ['墙体', '#697986'],
  ['道路', '#bf9d72'],
  ['草地', '#69976a'],
  ['水域', '#49899e'],
  ['门', '#9d7954'],
  ['危险', '#ac6562'],
  ['特殊', '#9681ae'],
  ['沙滩', '#d7c797'],
  ['浅滩', '#88bcb9'],
  ['深海', '#3a627c'],
  ['林地', '#437864'],
  ['岩石', '#8d9090'],
  ['石板', '#a7a49a'],
  ['木栈道', '#ae8059'],
  ['田地', '#8a7154'],
  ['麦田', '#c9ad60'],
  ['雾', '#b6bdc2'],
  ['浅草/装饰', '#98b38a'],
]
export const icons: Record<string, string[][]> = {
  自然: [
    ['tree', '🌳', '树'],
    ['pine', '🌲', '松树'],
    ['rock', '🪨', '石头'],
  ],
  建筑: [
    ['house', '🏠', '民居'],
    ['beacon', '🗼', '灯塔'],
    ['tavern', '🏨', '旅店'],
  ],
  物件: [
    ['fire', '🔥', '营火'],
    ['chest', '📦', '宝箱'],
  ],
  交通: [
    ['anchor', '⚓', '码头'],
    ['boat', '⛵', '帆船'],
    ['ship', '🚢', '轮船'],
  ],
  生物: [
    ['monster', '🐉', '怪物'],
    ['npc', '🧑', '角色'],
  ],
  标记: [
    ['star', '⭐', '星标'],
    ['flag', '🚩', '旗帜'],
    ['warn', '⚠️', '警告'],
  ],
}
const glyphs = new Map(
  Object.values(icons)
    .flat()
    .map(([id, g]) => [id, g]),
)
export type MapIcon = Point & { iconId: string }
export type Layer = {
  name: string
  visible: boolean
  tiles: number[]
  icons: MapIcon[]
}
export type Pin = Point & {
  id: string
  label: string
  color: string
  entityId: string
}
export type Tile = { id: number; name: string; color: string }
export type TileMap = Omit<MapRecord, 'layers' | 'pins' | 'customTiles'> & {
  layers: Layer[]
  pins: Pin[]
  customTiles: Tile[]
}
export function readMap(m: MapRecord): TileMap {
  const layers = list(m.layers).map((v, i) => {
    const l = record(v)
    return {
      ...l,
      name: scalar(l.name, '图层 ' + (i + 1)),
      visible: l.visible !== false,
      tiles: list(l.tiles).map(Number),
      icons: list(l.icons).map((v) => {
        const a = record(v)
        return {
          ...a,
          x: Number(a.x),
          y: Number(a.y),
          iconId: scalar(a.iconId),
        }
      }),
    }
  })
  if (!layers.length)
    layers.push({ name: '底图', visible: true, tiles: [], icons: [] })
  return {
    ...m,
    layers,
    pins: list(m.pins).map((v, i) => {
      const p = record(v)
      return {
        ...p,
        id: scalar(p.id, 'pin-' + i),
        label: scalar(p.label, '图钉'),
        x: Number(p.x),
        y: Number(p.y),
        color: scalar(p.color, '#a65345'),
        entityId: scalar(p.entityId),
      }
    }),
    customTiles: list(m.customTiles).map((v, i) => {
      const t = record(v)
      return {
        ...t,
        id: Number(t.id ?? 20 + i),
        name: scalar(t.name, '图块'),
        color: scalar(t.color, '#728e81'),
      }
    }),
  }
}
export function segment(a: Point, b: Point) {
  const points: Point[] = [],
    dx = Math.abs(b.x - a.x),
    dy = -Math.abs(b.y - a.y),
    sx = a.x < b.x ? 1 : -1,
    sy = a.y < b.y ? 1 : -1
  let { x, y } = a,
    err = dx + dy
  while (true) {
    points.push({ x, y })
    if (x === b.x && y === b.y) break
    const twice = 2 * err
    if (twice >= dy) {
      err += dy
      x += sx
    }
    if (twice <= dx) {
      err += dx
      y += sy
    }
  }
  return points
}
export function fillCells(
  layer: Layer,
  width: number,
  height: number,
  p: Point,
) {
  const start = p.y * width + p.x,
    old = layer.tiles[start] || 0,
    seen = new Uint8Array(width * height),
    queue = [start]
  seen[start] = 1
  for (let i = 0; i < queue.length; i++) {
    const k = queue[i],
      x = k % width,
      y = Math.floor(k / width)
    for (const n of [
      x ? k - 1 : -1,
      x < width - 1 ? k + 1 : -1,
      y ? k - width : -1,
      y < height - 1 ? k + width : -1,
    ]) {
      if (n >= 0 && !seen[n] && (layer.tiles[n] || 0) === old) {
        seen[n] = 1
        queue.push(n)
      }
    }
  }
  return queue.map((k) => ({ x: k % width, y: Math.floor(k / width) }))
}
const chunkSize = 16,
  texel = 24
const cache = new WeakMap<Layer, Map<string, HTMLCanvasElement>>()
export function cloneLayer(l: Layer) {
  const copy = { ...l, tiles: [...l.tiles], icons: [...l.icons] }
  cache.set(copy, new Map(cache.get(l)))
  return copy
}
export function dirty(l: Layer, p: Point) {
  cache
    .get(l)
    ?.delete(Math.floor(p.x / chunkSize) + ',' + Math.floor(p.y / chunkSize))
}
// Undo snapshots retain tile data. Keep raster chunks only for the live layers.
export function releaseLayer(layer: Layer) {
  cache.delete(layer)
}
function chunk(m: TileMap, l: Layer, col: number, row: number) {
  let images = cache.get(l)
  if (!images) {
    images = new Map()
    cache.set(l, images)
  }
  const key = col + ',' + row,
    stored = images.get(key)
  if (stored) return stored
  const tile = document.createElement('canvas')
  tile.width = tile.height = chunkSize * m.tileSize
  const ctx = tile.getContext('2d')!,
    custom = new Map(m.customTiles.map((t) => [t.id, t.color]))
  ctx.scale(m.tileSize / texel, m.tileSize / texel)
  for (let y = 0; y < chunkSize; y++)
    for (let x = 0; x < chunkSize; x++) {
      const mx = col * chunkSize + x,
        my = row * chunkSize + y,
        id = l.tiles[my * m.width + mx]
      if (!id || mx >= m.width || my >= m.height) continue
      ctx.fillStyle = terrains[id - 1]?.[1] ?? custom.get(id) ?? '#aaa'
      const px = x * texel,
        py = y * texel
      ctx.fillRect(px, py, texel, texel)
      ctx.fillStyle = 'rgba(255,255,255,.22)'
      ctx.strokeStyle = 'rgba(35,47,48,.22)'
      ctx.lineWidth = 1.2
      const offset = ((mx * 7 + my * 11) % 9) + 3
      if ([5, 10, 11, 18].includes(id)) {
        ctx.beginPath()
        ctx.moveTo(px + 2, py + offset + 4)
        ctx.quadraticCurveTo(px + 8, py + offset, px + 16, py + offset + 4)
        ctx.stroke()
      } else if ([2, 6, 14, 15, 16, 17].includes(id)) {
        ctx.strokeRect(px + 0.5, py + 0.5, 23, 11)
        ctx.fillRect(px + offset, py + 13, 2, 9)
      } else {
        ctx.fillRect(px + offset, py + 4, 3, 2)
        ctx.fillRect(px + 18, py + offset + 7, 2, id === 4 || id === 12 ? 5 : 2)
      }
    }
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = '19px "Segoe UI Emoji",system-ui'
  for (const p of l.icons)
    if (
      Math.floor(p.x / chunkSize) === col &&
      Math.floor(p.y / chunkSize) === row
    )
      ctx.fillText(
        glyphs.get(p.iconId) ?? '◆',
        ((p.x % chunkSize) + 0.5) * texel,
        ((p.y % chunkSize) + 0.5) * texel,
      )
  images.set(key, tile)
  return tile
}
export function drawMap(
  ctx: CanvasRenderingContext2D,
  m: TileMap,
  view: Rect,
  grid: boolean,
  labels: boolean,
  selected = '',
  zoom = 1,
) {
  const t = m.tileSize,
    c = chunkSize * t,
    width = m.width * t,
    height = m.height * t
  ctx.save()
  ctx.beginPath()
  ctx.rect(0, 0, width, height)
  ctx.clip()
  ctx.fillStyle = '#dfdfd5'
  ctx.fillRect(0, 0, width, height)
  const left = Math.max(0, Math.floor(view.x / c)),
    top = Math.max(0, Math.floor(view.y / c)),
    right = Math.min(
      Math.ceil(m.width / chunkSize),
      Math.ceil((view.x + view.width) / c),
    ),
    bottom = Math.min(
      Math.ceil(m.height / chunkSize),
      Math.ceil((view.y + view.height) / c),
    )
  for (const l of m.layers)
    if (l.visible)
      for (let y = top; y < bottom; y++)
        for (let x = left; x < right; x++)
          ctx.drawImage(chunk(m, l, x, y), x * c, y * c, c, c)
  if (grid && t * zoom >= 7) {
    ctx.beginPath()
    ctx.strokeStyle = 'rgba(42,58,63,.22)'
    ctx.lineWidth = 0.7 / zoom
    for (let x = left * c; x <= right * c; x += t) {
      ctx.moveTo(x, top * c)
      ctx.lineTo(x, bottom * c)
    }
    for (let y = top * c; y <= bottom * c; y += t) {
      ctx.moveTo(left * c, y)
      ctx.lineTo(right * c, y)
    }
    ctx.stroke()
  }
  for (const p of m.pins) {
    const x = (p.x + 0.5) * t,
      y = (p.y + 0.5) * t,
      r = Math.max(4, t * 0.19)
    if (
      x < view.x - 120 ||
      x > view.x + view.width + 120 ||
      y < view.y - t ||
      y > view.y + view.height + t
    )
      continue
    ctx.fillStyle = p.color
    ctx.strokeStyle = p.id === selected ? '#ffcc49' : '#fff'
    ctx.lineWidth = p.id === selected ? 3 : 1.5
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
    if (labels) {
      ctx.font = '600 ' + Math.max(9, t * 0.34) + 'px system-ui'
      const w = ctx.measureText(p.label).width
      ctx.fillStyle = '#1c3036d9'
      ctx.fillRect(x - w / 2 - 3, y + r + 2, w + 6, Math.max(12, t * 0.45))
      ctx.textAlign = 'center'
      ctx.fillStyle = 'white'
      ctx.fillText(p.label, x, y + r + Math.max(12, t * 0.39))
      ctx.textAlign = 'left'
    }
  }
  ctx.restore()
}
