/**
 * Decorative furniture. Generated from a room's rectangle and its openings; it never changes plan geometry.
 * Items are placed against walls (or room centre), must lie inside the clear room area and must not overlap the
 * door-swing zones, windows (for tall pieces) or each other. Rooms that are too small simply get fewer items.
 */
import type { Opening, RoomBox, Side } from './model'

export interface FurniturePart {
  cx: number; cy: number; cz: number; sx: number; sy: number; sz: number
  color: string
  roomId: string
  kind: string
}

interface Rect { x0: number; x1: number; z0: number; z1: number }
const overlaps = (a: Rect, b: Rect, pad = 0) => a.x0 < b.x1 + pad && a.x1 > b.x0 - pad && a.z0 < b.z1 + pad && a.z1 > b.z0 - pad
const inside = (a: Rect, b: Rect) => a.x0 >= b.x0 - 1e-6 && a.x1 <= b.x1 + 1e-6 && a.z0 >= b.z0 - 1e-6 && a.z1 <= b.z1 + 1e-6

const C = {
  wood: '#8b6b4a', woodDark: '#5e4630', woodLight: '#b08a62', linen: '#f2efe9', white: '#fafaf7', fabric: '#5f7186', fabricLight: '#73869b',
  cabinet: '#e4dfd5', worktop: '#3d4247', steel: '#aeb7bf', black: '#1f2227', porcelain: '#f5f5f2', water: '#d7e6ee', blanket: '#7f97ab',
  wardrobe: '#d8d1c4', chair: '#c8b59a', fridge: '#d3d8dc',
}

type Facing = Side // the wall the item's back is against

/** Maps local (u along the wall, v away from it) coordinates of an item rect into a world-space rect. */
function sub(r: Rect, back: Facing, u0: number, u1: number, v0: number, v1: number): Rect {
  let a: [number, number], b: [number, number]
  switch (back) {
    case 'N': a = [r.x0 + u0, r.z0 + v0]; b = [r.x0 + u1, r.z0 + v1]; break
    case 'S': a = [r.x0 + u0, r.z1 - v0]; b = [r.x0 + u1, r.z1 - v1]; break
    case 'W': a = [r.x0 + v0, r.z0 + u0]; b = [r.x0 + v1, r.z0 + u1]; break
    default: a = [r.x1 - v0, r.z0 + u0]; b = [r.x1 - v1, r.z0 + u1]; break
  }
  return { x0: Math.min(a[0], b[0]), x1: Math.max(a[0], b[0]), z0: Math.min(a[1], b[1]), z1: Math.max(a[1], b[1]) }
}

class Builder {
  parts: FurniturePart[] = []
  private y: number
  private roomId: string
  constructor(y: number, roomId: string) { this.y = y; this.roomId = roomId }
  box(r: Rect, y0: number, y1: number, color: string, kind: string) {
    if (r.x1 - r.x0 < 1e-3 || r.z1 - r.z0 < 1e-3 || y1 - y0 < 1e-3) return
    this.parts.push({ cx: (r.x0 + r.x1) / 2, cz: (r.z0 + r.z1) / 2, cy: this.y + (y0 + y1) / 2, sx: r.x1 - r.x0, sz: r.z1 - r.z0, sy: y1 - y0, color, roomId: this.roomId, kind })
  }
}

function placeAlong(I: Rect, side: Facing, w: number, d: number, blockers: Rect[], prefer: 'center' | 'start' | 'end', margin = 0.05): Rect | null {
  const horizontal = side === 'N' || side === 'S'
  const lo = (horizontal ? I.x0 : I.z0) + margin, hi = (horizontal ? I.x1 : I.z1) - margin - w
  if (hi < lo - 1e-9 || d > (horizontal ? I.z1 - I.z0 : I.x1 - I.x0) + 1e-9) return null
  const offs: number[] = []
  for (let o = lo; o <= hi + 1e-9; o += 0.1) offs.push(o)
  if (offs[offs.length - 1] < hi - 1e-9) offs.push(hi)
  const mid = (lo + hi) / 2
  if (prefer === 'center') offs.sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid))
  else if (prefer === 'end') offs.reverse()
  for (const o of offs) {
    let r: Rect
    switch (side) {
      case 'N': r = { x0: o, x1: o + w, z0: I.z0, z1: I.z0 + d }; break
      case 'S': r = { x0: o, x1: o + w, z0: I.z1 - d, z1: I.z1 }; break
      case 'W': r = { x0: I.x0, x1: I.x0 + d, z0: o, z1: o + w }; break
      default: r = { x0: I.x1 - d, x1: I.x1, z0: o, z1: o + w }
    }
    if (inside(r, I) && !blockers.some((b) => overlaps(r, b, 0.05))) return r
  }
  return null
}

export function buildFurniture(room: RoomBox, openings: Opening[]): FurniturePart[] {
  const I: Rect = { x0: room.x0 + room.inset.W, x1: room.x1 - room.inset.E, z0: room.z0 + room.inset.N, z1: room.z1 - room.inset.S }
  const iw = I.x1 - I.x0, id = I.z1 - I.z0
  if (iw < 1.2 || id < 1.2 || room.overflow) return []

  // clear zones: door swings (incl. approach) and windows (for tall pieces)
  const doorZones: Rect[] = [], windowZones: Rect[] = []
  for (const o of openings) {
    const half = o.width / 2 + 0.15, reach = Math.max(o.width, 0.9) + 0.1
    let onEdge = false, r: Rect | null = null
    if (o.orientation === 'x') {
      if (o.center < room.x0 - 0.05 || o.center > room.x1 + 0.05) continue
      if (Math.abs(o.line - room.z0) <= 0.1) { onEdge = true; r = { x0: o.center - half, x1: o.center + half, z0: room.z0, z1: room.z0 + reach } }
      else if (Math.abs(o.line - room.z1) <= 0.1) { onEdge = true; r = { x0: o.center - half, x1: o.center + half, z0: room.z1 - reach, z1: room.z1 } }
    } else {
      if (o.center < room.z0 - 0.05 || o.center > room.z1 + 0.05) continue
      if (Math.abs(o.line - room.x0) <= 0.1) { onEdge = true; r = { x0: room.x0, x1: room.x0 + reach, z0: o.center - half, z1: o.center + half } }
      else if (Math.abs(o.line - room.x1) <= 0.1) { onEdge = true; r = { x0: room.x1 - reach, x1: room.x1, z0: o.center - half, z1: o.center + half } }
    }
    if (!onEdge || !r) continue
    if (o.kind === 'door') doorZones.push(r)
    else windowZones.push(r)
  }

  const b = new Builder(room.y, room.id)
  const placed: Rect[] = []
  const tryPlace = (sides: Facing[], w: number, d: number, prefer: 'center' | 'start' | 'end', tall = false, margin = 0.05): { rect: Rect; back: Facing } | null => {
    const blockers = [...doorZones, ...placed, ...(tall ? windowZones : [])]
    for (const s of sides) {
      const r = placeAlong(I, s, w, d, blockers, prefer, margin)
      if (r) { placed.push(r); return { rect: r, back: s } }
    }
    return null
  }
  const reserve = (r: Rect) => placed.push(r)
  const freeAt = (r: Rect, tall = false) => inside(r, I) && ![...doorZones, ...placed, ...(tall ? windowZones : [])].some((z) => overlaps(r, z, 0.05))

  const wallsByLength: Facing[] = (iw >= id ? ['N', 'S', 'W', 'E'] : ['W', 'E', 'N', 'S'])
  const alongLen = (s: Facing) => (s === 'N' || s === 'S' ? iw : id)
  const depthOf = (s: Facing) => (s === 'N' || s === 'S' ? id : iw)
  const others = (s: Facing): Facing[] => wallsByLength.filter((x) => x !== s)
  const legs = (r: Rect, h: number, color: string, kind: string, t = 0.05) => {
    for (const [x, z] of [[r.x0, r.z0], [r.x1 - t, r.z0], [r.x0, r.z1 - t], [r.x1 - t, r.z1 - t]]) b.box({ x0: x, x1: x + t, z0: z, z1: z + t }, 0, h, color, kind)
  }

  switch (room.type) {
    case 'bedroom': {
      if (iw * id < 5) break
      const double = Math.min(iw, id) >= 2.9 && iw * id >= 8
      const bw = double ? 1.55 : 0.95, bl = 1.95
      const bed = tryPlace(wallsByLength, bw, bl, 'center')
      if (bed) {
        const { rect, back } = bed
        const U = bw, V = bl
        b.box(sub(rect, back, 0, U, 0, V), 0, 0.28, C.wood, 'bed')
        b.box(sub(rect, back, 0.03, U - 0.03, 0.03, V - 0.03), 0.28, 0.5, C.linen, 'mattress')
        b.box(sub(rect, back, 0, U, 0, 0.08), 0.28, 1.0, C.woodDark, 'headboard')
        b.box(sub(rect, back, 0.03, U - 0.03, 0.95, V - 0.03), 0.5, 0.53, C.blanket, 'blanket')
        if (double) { b.box(sub(rect, back, 0.15, 0.7, 0.15, 0.5), 0.5, 0.6, C.white, 'pillow'); b.box(sub(rect, back, U - 0.7, U - 0.15, 0.15, 0.5), 0.5, 0.6, C.white, 'pillow') }
        else b.box(sub(rect, back, 0.2, U - 0.2, 0.15, 0.5), 0.5, 0.6, C.white, 'pillow')
        for (const side of [-1, 1] as const) {
          const u0 = side < 0 ? -0.45 : U + 0.05
          const nr = sub(rect, back, u0, u0 + 0.4, 0, 0.4)
          if (freeAt(nr)) { reserve(nr); b.box(nr, 0, 0.5, C.wood, 'nightstand'); b.box({ x0: nr.x0 + 0.04, x1: nr.x1 - 0.04, z0: nr.z0 + 0.04, z1: nr.z1 - 0.04 }, 0.5, 0.52, C.woodDark, 'nightstand') }
        }
        const wd = tryPlace(others(back), 1.2, 0.55, 'start', true)
        if (wd) b.box(wd.rect, 0, 2.0, C.wardrobe, 'wardrobe')
      }
      break
    }
    case 'living': {
      const sofaSides = wallsByLength.filter((s) => alongLen(s) >= 2.5 && depthOf(s) >= 3.0)
      const sofa = tryPlace(sofaSides.length ? sofaSides : wallsByLength, 2.0, 0.9, 'center')
      if (sofa) {
        const { rect, back } = sofa
        b.box(sub(rect, back, 0, 2.0, 0, 0.9), 0, 0.4, C.fabric, 'sofa')
        b.box(sub(rect, back, 0, 2.0, 0, 0.22), 0.4, 0.88, C.fabric, 'sofa')
        b.box(sub(rect, back, 0, 0.2, 0.22, 0.9), 0.4, 0.62, C.fabric, 'sofa')
        b.box(sub(rect, back, 1.8, 2.0, 0.22, 0.9), 0.4, 0.62, C.fabric, 'sofa')
        b.box(sub(rect, back, 0.2, 1.8, 0.22, 0.9), 0.4, 0.5, C.fabricLight, 'cushion')
        const table = sub(rect, back, 0.5, 1.5, 1.15, 1.65)
        if (freeAt(table)) { reserve(table); b.box(table, 0.36, 0.4, C.woodLight, 'coffee-table'); legs(table, 0.36, C.woodDark, 'coffee-table', 0.04) }
        const opposite: Facing = back === 'N' ? 'S' : back === 'S' ? 'N' : back === 'W' ? 'E' : 'W'
        if (depthOf(back) >= 3.4) {
          const tv = tryPlace([opposite], 1.4, 0.4, 'center')
          if (tv) { b.box(tv.rect, 0, 0.45, C.woodDark, 'tv-unit'); b.box(sub(tv.rect, tv.back, 0.2, 1.2, 0.15, 0.2), 0.55, 1.05, C.black, 'tv') }
        }
      }
      break
    }
    case 'dining': {
      const small = iw < 2.8 || id < 2.8
      const tw = small ? 1.2 : 1.6, td = small ? 0.8 : 0.9
      const alongX = iw >= id
      const cx = (I.x0 + I.x1) / 2, cz = (I.z0 + I.z1) / 2
      const t: Rect = alongX ? { x0: cx - tw / 2, x1: cx + tw / 2, z0: cz - td / 2, z1: cz + td / 2 } : { x0: cx - td / 2, x1: cx + td / 2, z0: cz - tw / 2, z1: cz + tw / 2 }
      if (!freeAt({ x0: t.x0 - 0.5, x1: t.x1 + 0.5, z0: t.z0 - 0.5, z1: t.z1 + 0.5 })) break
      reserve({ x0: t.x0 - 0.5, x1: t.x1 + 0.5, z0: t.z0 - 0.5, z1: t.z1 + 0.5 })
      b.box(t, 0.72, 0.76, C.woodLight, 'dining-table'); legs(t, 0.72, C.woodDark, 'dining-table')
      const n = small ? 1 : 2
      for (let i = 0; i < n; i++) for (const sgn of [-1, 1] as const) {
        const f = (i + 1) / (n + 1)
        const c = 0.21
        if (alongX) {
          const x = t.x0 + (t.x1 - t.x0) * f, z = sgn < 0 ? t.z0 - 0.08 - c : t.z1 + 0.08 + c
          b.box({ x0: x - c, x1: x + c, z0: z - c, z1: z + c }, 0.42, 0.46, C.chair, 'chair')
          b.box({ x0: x - c, x1: x + c, z0: sgn < 0 ? z - c - 0.04 : z + c, z1: sgn < 0 ? z - c : z + c + 0.04 }, 0.46, 0.9, C.chair, 'chair')
        } else {
          const z = t.z0 + (t.z1 - t.z0) * f, x = sgn < 0 ? t.x0 - 0.08 - c : t.x1 + 0.08 + c
          b.box({ x0: x - c, x1: x + c, z0: z - c, z1: z + c }, 0.42, 0.46, C.chair, 'chair')
          b.box({ x0: sgn < 0 ? x - c - 0.04 : x + c, x1: sgn < 0 ? x - c : x + c + 0.04, z0: z - c, z1: z + c }, 0.46, 0.9, C.chair, 'chair')
        }
      }
      break
    }
    case 'kitchen': {
      const sides = wallsByLength.filter((s) => alongLen(s) >= 1.8)
      const run = Math.min(3.0, Math.max(...wallsByLength.map(alongLen)) - 0.1)
      let counter: { rect: Rect; back: Facing } | null = null
      let len = run
      for (; len >= 1.6 && !counter; len -= 0.4) counter = tryPlace(sides.length ? sides : wallsByLength, len, 0.6, 'center')
      len += 0.4
      if (counter) {
        const { rect, back } = counter
        b.box(sub(rect, back, 0, len, 0, 0.6), 0, 0.88, C.cabinet, 'counter')
        b.box(sub(rect, back, 0, len, 0, 0.62), 0.88, 0.92, C.worktop, 'worktop')
        b.box(sub(rect, back, len * 0.2, len * 0.2 + 0.55, 0.08, 0.5), 0.9, 0.93, C.steel, 'sink')
        b.box(sub(rect, back, len * 0.62, len * 0.62 + 0.55, 0.05, 0.55), 0.92, 0.94, C.black, 'hob')
        const fr = tryPlace(others(back), 0.7, 0.7, 'start', true)
        if (fr) b.box(fr.rect, 0, 1.8, C.fridge, 'fridge')
      }
      break
    }
    case 'bathroom': {
      if (iw * id < 2.2) break
      const wc = tryPlace(wallsByLength, 0.4, 0.65, 'end')
      if (wc) {
        b.box(sub(wc.rect, wc.back, 0.02, 0.38, 0.2, 0.65), 0, 0.4, C.porcelain, 'toilet')
        b.box(sub(wc.rect, wc.back, 0.02, 0.38, 0, 0.2), 0, 0.8, C.porcelain, 'toilet')
      }
      const basin = tryPlace(wallsByLength, 0.55, 0.42, 'start')
      if (basin) { b.box(basin.rect, 0, 0.8, C.cabinet, 'vanity'); b.box(sub(basin.rect, basin.back, 0.05, 0.5, 0.04, 0.38), 0.8, 0.86, C.porcelain, 'basin') }
      if (Math.min(iw, id) >= 1.7) {
        const shower = tryPlace(wallsByLength, 0.9, 0.9, 'end', false, 0.02)
        if (shower) b.box(shower.rect, 0, 0.05, C.water, 'shower')
      }
      if (iw * id >= 5 && Math.max(iw, id) >= 2.4) {
        const tub = tryPlace(wallsByLength, 1.6, 0.75, 'start')
        if (tub) { b.box(tub.rect, 0, 0.5, C.porcelain, 'tub'); b.box({ x0: tub.rect.x0 + 0.06, x1: tub.rect.x1 - 0.06, z0: tub.rect.z0 + 0.06, z1: tub.rect.z1 - 0.06 }, 0.5, 0.52, C.water, 'tub') }
      }
      break
    }
    case 'study':
    case 'office': {
      if (iw * id < 4) break
      const desk = tryPlace(wallsByLength, 1.4, 0.65, 'center')
      if (desk) {
        const { rect, back } = desk
        b.box(sub(rect, back, 0, 1.4, 0, 0.65), 0.72, 0.76, C.woodLight, 'desk')
        b.box(sub(rect, back, 0, 0.04, 0, 0.65), 0, 0.72, C.wood, 'desk'); b.box(sub(rect, back, 1.36, 1.4, 0, 0.65), 0, 0.72, C.wood, 'desk')
        const chair = sub(rect, back, 0.5, 0.95, 0.75, 1.2)
        if (freeAt(chair)) { reserve(chair); b.box(chair, 0.42, 0.47, C.fabric, 'chair'); b.box(sub(rect, back, 0.5, 0.95, 1.16, 1.2), 0.47, 0.95, C.fabric, 'chair') }
        const shelf = tryPlace(others(back), 0.9, 0.3, 'center', true)
        if (shelf) b.box(shelf.rect, 0, 1.8, C.wood, 'bookshelf')
      }
      break
    }
    default:
      break
  }
  return b.parts
}
