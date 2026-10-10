/**
 * Automatic furnishing. For every room: read its rectangle, doors and windows, pick pieces for the room type, try
 * positions and orientations, reject anything that touches a wall, a door-swing zone, a window (tall pieces) or another
 * piece, then verify with a grid search that people can still walk from every door through the room.
 * Rooms that are too small simply get fewer / smaller pieces. Furniture is decorative: it never changes the plan.
 */
import { FURNITURE_SPECS, clampSize, itemRect, specOf, type FurnitureItem, type Rect } from './furnitureCatalog'
import type { Facing } from './layoutStore'
import type { Opening, RoomBox } from './model'

export { partsFor, itemRect, typesForRoom, specOf, FURNITURE_SPECS, clampSize, rotateFacing } from './furnitureCatalog'
export type { FurnitureItem, FurniturePart } from './furnitureCatalog'

const overlaps = (a: Rect, b: Rect, pad = 0) => a.x0 < b.x1 + pad && a.x1 > b.x0 - pad && a.z0 < b.z1 + pad && a.z1 > b.z0 - pad
const inside = (a: Rect, b: Rect) => a.x0 >= b.x0 - 1e-6 && a.x1 <= b.x1 + 1e-6 && a.z0 >= b.z0 - 1e-6 && a.z1 <= b.z1 + 1e-6

/** Clear floor area of a room (inside the finished wall faces). */
export function interiorOf(room: RoomBox): Rect {
  return { x0: room.x0 + room.inset.W, x1: room.x1 - room.inset.E, z0: room.z0 + room.inset.N, z1: room.z1 - room.inset.S }
}

export interface Zones { doors: Rect[]; windows: Rect[] }

/** Door swing + approach zones and window zones that fall on this room's walls. */
export function zonesFor(room: RoomBox, openings: Opening[]): Zones {
  const doors: Rect[] = [], windows: Rect[] = []
  for (const o of openings) {
    const half = o.width / 2 + 0.15
    const reach = o.kind === 'door' ? Math.max(o.width, 0.9) + 0.1 : 0.45
    let r: Rect | null = null
    if (o.orientation === 'x') {
      if (o.center < room.x0 - 0.05 || o.center > room.x1 + 0.05) continue
      if (Math.abs(o.line - room.z0) <= 0.1) r = { x0: o.center - half, x1: o.center + half, z0: room.z0, z1: room.z0 + reach }
      else if (Math.abs(o.line - room.z1) <= 0.1) r = { x0: o.center - half, x1: o.center + half, z0: room.z1 - reach, z1: room.z1 }
    } else {
      if (o.center < room.z0 - 0.05 || o.center > room.z1 + 0.05) continue
      if (Math.abs(o.line - room.x0) <= 0.1) r = { x0: room.x0, x1: room.x0 + reach, z0: o.center - half, z1: o.center + half }
      else if (Math.abs(o.line - room.x1) <= 0.1) r = { x0: room.x1 - reach, x1: room.x1, z0: o.center - half, z1: o.center + half }
    }
    if (r) (o.kind === 'door' ? doors : windows).push(r)
  }
  return { doors, windows }
}

/** Why an item can't stand here (null = fine). `others` are the other items of the same room. */
export function placementProblem(item: FurnitureItem, room: RoomBox, openings: Opening[], others: FurnitureItem[]): string | null {
  const spec = specOf(item.type)
  if (!spec) return 'Unknown furniture type.'
  const I = interiorOf(room)
  const r = itemRect(item)
  if (!inside(r, I)) return 'Outside the room or touching a wall.'
  const z = zonesFor(room, openings)
  if (z.doors.some((d) => overlaps(r, d))) return 'Blocks a doorway or its door swing.'
  if (spec.tall && z.windows.some((w) => overlaps(r, w))) return 'Stands in front of a window.'
  if (!spec.overlay) {
    for (const o of others) {
      if (o.id === item.id) continue
      const os = specOf(o.type)
      if (!os || os.overlay) continue
      if ((spec.mounted || os.mounted) && (spec.mounted !== os.mounted)) continue // sink on a counter, mirror above a basin
      if (spec.mounted && os.mounted) { if (overlaps(r, itemRect(o), -0.02)) return 'Overlaps another item.'; continue }
      if (overlaps(r, itemRect(o), 0.03)) return 'Overlaps another item.'
    }
  }
  return null
}

const CELL = 0.1
const AGENT = 0.25 // half the width of a walking person plus a little margin

/** Can people walk from every doorway through the room? (grid search around furniture, inflated by body width). */
export function circulationOk(room: RoomBox, items: FurnitureItem[], openings: Opening[]): boolean {
  const I = interiorOf(room)
  const nx = Math.max(1, Math.round((I.x1 - I.x0) / CELL)), nz = Math.max(1, Math.round((I.z1 - I.z0) / CELL))
  const obst = items.filter((i) => { const s = specOf(i.type); return s && !s.overlay && !s.mounted && s.h > 0.3 }).map((i) => itemRect(i))
  const blocked = new Uint8Array(nx * nz)
  let freeBase = 0
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
    const x = I.x0 + (i + 0.5) * CELL, z = I.z0 + (j + 0.5) * CELL
    if (obst.some((r) => x > r.x0 - AGENT && x < r.x1 + AGENT && z > r.z0 - AGENT && z < r.z1 + AGENT)) blocked[i * nz + j] = 1
    else freeBase++
  }
  const starts: [number, number][] = []
  for (const o of openings) {
    if (o.kind !== 'door') continue
    let px: number, pz: number
    if (o.orientation === 'x') {
      if (o.center < room.x0 - 0.05 || o.center > room.x1 + 0.05) continue
      if (Math.abs(o.line - room.z0) <= 0.1) { px = o.center; pz = room.z0 + 0.5 }
      else if (Math.abs(o.line - room.z1) <= 0.1) { px = o.center; pz = room.z1 - 0.5 }
      else continue
    } else {
      if (o.center < room.z0 - 0.05 || o.center > room.z1 + 0.05) continue
      if (Math.abs(o.line - room.x0) <= 0.1) { px = room.x0 + 0.5; pz = o.center }
      else if (Math.abs(o.line - room.x1) <= 0.1) { px = room.x1 - 0.5; pz = o.center }
      else continue
    }
    const ci = Math.min(nx - 1, Math.max(0, Math.floor((px - I.x0) / CELL))), cj = Math.min(nz - 1, Math.max(0, Math.floor((pz - I.z0) / CELL)))
    starts.push([ci, cj])
  }
  if (!starts.length) return true
  const seen = new Uint8Array(nx * nz)
  const [si, sj] = starts[0]
  if (blocked[si * nz + sj]) return false
  const q: number[] = [si * nz + sj]
  seen[si * nz + sj] = 1
  let reach = 0
  while (q.length) {
    const c = q.pop() as number
    reach++
    const i = Math.floor(c / nz), j = c % nz
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ni = i + di, nj = j + dj
      if (ni < 0 || nj < 0 || ni >= nx || nj >= nz) continue
      const k = ni * nz + nj
      if (!seen[k] && !blocked[k]) { seen[k] = 1; q.push(k) }
    }
  }
  if (starts.some(([i, j]) => !seen[i * nz + j])) return false // two doors must stay connected
  return freeBase === 0 ? true : reach >= 0.45 * freeBase
}

/** Deterministic ids (room:type:n) so selection and saved edits survive re-generation. */
function uniqueId(roomId: string, type: string, taken: Iterable<string>): string {
  const t = new Set(taken)
  let n = 1
  while (t.has(`${roomId}:${type}:${n}`)) n++
  return `${roomId}:${type}:${n}`
}

/** Working state for one room while placing furniture. */
class Planner {
  items: FurnitureItem[] = []
  /** ids of items that exist elsewhere (kept by the user) and must not be reused */
  reserved: string[] = []
  readonly I: Rect
  readonly zones: Zones
  readonly room: RoomBox
  readonly openings: Opening[]
  readonly seed: number
  constructor(room: RoomBox, openings: Opening[], seed = 0) {
    this.seed = seed
    this.room = room
    this.openings = openings
    this.I = interiorOf(room)
    this.zones = zonesFor(room, openings)
  }
  newId(type: string) { return uniqueId(this.room.id, type, [...this.items.map((i) => i.id), ...this.reserved]) }
  get iw() { return this.I.x1 - this.I.x0 }
  get id() { return this.I.z1 - this.I.z0 }
  mk(type: string, cx: number, cz: number, facing: Facing, w?: number, d?: number): FurnitureItem {
    const s = FURNITURE_SPECS[type]
    const sz = clampSize(type, w ?? s.w, d ?? s.d)
    return { id: this.newId(type), room_id: this.room.id, type, cx, cz, w: sz.w, d: sz.d, facing }
  }
  ok(it: FurnitureItem) { return placementProblem(it, this.room, this.openings, this.items) === null }
  add(it: FurnitureItem | null): FurnitureItem | null {
    if (it && this.ok(it)) { this.items.push(it); return it }
    return null
  }
  /** Stand `type` against `side`, sliding along the wall; `align` = preferred centre along the wall. */
  against(type: string, side: Facing, prefer: 'center' | 'start' | 'end' | number = 'center', w?: number, d?: number, gap = 0.04): FurnitureItem | null {
    const s = FURNITURE_SPECS[type]
    const sz = clampSize(type, w ?? s.w, d ?? s.d)
    const horiz = side === 'N' || side === 'S'
    const lo = (horiz ? this.I.x0 : this.I.z0) + gap, hi = (horiz ? this.I.x1 : this.I.z1) - gap - sz.w
    if (hi < lo - 1e-9 || sz.d > (horiz ? this.id : this.iw) + 1e-9) return null
    const offs: number[] = []
    for (let o = lo; o <= hi + 1e-9; o += 0.05) offs.push(o)
    if (offs[offs.length - 1] < hi - 1e-9) offs.push(hi)
    const target = typeof prefer === 'number' ? prefer - sz.w / 2 : prefer === 'center' ? (lo + hi) / 2 : prefer === 'start' ? lo : hi
    offs.sort((a, b) => Math.abs(a - target) - Math.abs(b - target))
    for (const o of offs) {
      const along = o + sz.w / 2
      const cx = horiz ? along : side === 'W' ? this.I.x0 + sz.d / 2 : this.I.x1 - sz.d / 2
      const cz = horiz ? (side === 'N' ? this.I.z0 + sz.d / 2 : this.I.z1 - sz.d / 2) : along
      const it = { id: this.newId(type), room_id: this.room.id, type, cx, cz, w: sz.w, d: sz.d, facing: side }
      if (this.ok(it)) { this.items.push(it); return it }
    }
    return null
  }
  /** Walls sorted by how far their middle is from the first door (far walls first). */
  wallsFarFromDoor(): Facing[] {
    const door = this.openings.find((o) => {
      if (o.kind !== 'door') return false
      return zonesFor(this.room, [o]).doors.length > 0
    })
    const mid = { N: [(this.I.x0 + this.I.x1) / 2, this.I.z0], S: [(this.I.x0 + this.I.x1) / 2, this.I.z1], W: [this.I.x0, (this.I.z0 + this.I.z1) / 2], E: [this.I.x1, (this.I.z0 + this.I.z1) / 2] } as Record<Facing, number[]>
    const sides: Facing[] = this.iw >= this.id ? ['N', 'S', 'W', 'E'] : ['W', 'E', 'N', 'S']
    const rot = (list: Facing[]) => { const k = this.seed % list.length; return [...list.slice(k), ...list.slice(0, k)] }
    if (!door) return rot(sides)
    const dp = door.orientation === 'x' ? [door.center, door.line] : [door.line, door.center]
    return rot([...sides].sort((a, b) => Math.hypot(mid[b][0] - dp[0], mid[b][1] - dp[1]) - Math.hypot(mid[a][0] - dp[0], mid[a][1] - dp[1])))
  }
  along(side: Facing) { return side === 'N' || side === 'S' ? this.iw : this.id }
  depth(side: Facing) { return side === 'N' || side === 'S' ? this.id : this.iw }
}

const opposite = (f: Facing): Facing => (f === 'N' ? 'S' : f === 'S' ? 'N' : f === 'W' ? 'E' : 'W')
/** Centre coordinate along the wall of `side` for an item. */
const alongOf = (it: FurnitureItem, side: Facing) => (side === 'N' || side === 'S' ? it.cx : it.cz)
/** Place an item in front of another item (distance `gap` from its front face), centred on it. */
function inFront(p: Planner, base: FurnitureItem, type: string, gap: number, w?: number, d?: number): FurnitureItem | null {
  const s = FURNITURE_SPECS[type]
  const sz = clampSize(type, w ?? s.w, d ?? s.d)
  const f = base.facing
  const dist = base.d / 2 + gap + sz.d / 2
  const cx = f === 'N' || f === 'S' ? base.cx : base.cx + (f === 'W' ? dist : -dist)
  const cz = f === 'W' || f === 'E' ? base.cz : base.cz + (f === 'N' ? dist : -dist)
  return p.add({ id: p.newId(type), room_id: p.room.id, type, cx, cz, w: sz.w, d: sz.d, facing: f })
}

function furnishBedroom(p: Planner) {
  const area = p.iw * p.id
  if (area < 5 || Math.min(p.iw, p.id) < 2.2) return
  const double = Math.min(p.iw, p.id) >= 2.9 && area >= 8.5
  let bed: FurnitureItem | null = null
  for (const type of double ? ['bed_double', 'bed_single'] : ['bed_single']) {
    for (const side of p.wallsFarFromDoor()) { bed = p.against(type, side, 'center'); if (bed) break }
    if (bed) break
  }
  if (!bed) return
  const back = bed.facing
  for (const sgn of [-1, 1]) { // bedside tables on both sides of the headboard
    const gapW = 0.04, along = alongOf(bed, back) + sgn * (bed.w / 2 + gapW + 0.2)
    const cx = back === 'N' || back === 'S' ? along : bed.cx + (back === 'W' ? -(bed.d / 2) + 0.2 : bed.d / 2 - 0.2)
    const cz = back === 'W' || back === 'E' ? along : bed.cz + (back === 'N' ? -(bed.d / 2) + 0.2 : bed.d / 2 - 0.2)
    p.add(p.mk('nightstand', cx, cz, back))
  }
  const sides = p.wallsFarFromDoor().filter((s) => s !== back)
  for (const s of sides) if (p.against('wardrobe', s, 'start', p.along(s) >= 3.2 ? 1.5 : 1.0)) break
  if (area >= 12) {
    for (const s of sides) {
      const desk = p.against('desk', s, 'end', 1.2)
      if (desk) { inFront(p, { ...desk }, 'office_chair', -0.1); break }
    }
  }
  if (area >= 15) for (const s of sides) if (p.against('dresser', s, 'center')) break
  if (area >= 11) { // rug under the foot of the bed
    const rug = p.mk('rug', bed.cx + (back === 'W' ? bed.d / 2 : back === 'E' ? -bed.d / 2 : 0), bed.cz + (back === 'N' ? bed.d / 2 : back === 'S' ? -bed.d / 2 : 0), back, bed.w + 0.8, bed.d * 0.7)
    p.add(rug)
  }
}

function furnishLiving(p: Planner) {
  const area = p.iw * p.id
  if (area < 6 || Math.min(p.iw, p.id) < 2.0) return
  // Pick a TV wall and the opposite sofa wall with enough room between them (sofa 0.9 + gap + table 0.5 + gap + TV 0.4 ~ 2.7 m).
  let axes: Facing[][] = p.iw >= p.id ? [['N', 'S'], ['W', 'E']] : [['W', 'E'], ['N', 'S']]
  if (p.seed % 2 === 1) axes = axes.map(([a, b]) => [b, a] as Facing[]) // regenerate: swap which wall carries the TV
  let sofa: FurnitureItem | null = null, tv: FurnitureItem | null = null
  for (const [a, b] of axes) {
    if (p.depth(a) < 2.9) continue
    for (const [tvSide, sofaSide] of [[a, b], [b, a]] as Facing[][]) {
      const t = p.against('tv_unit', tvSide, 'center', Math.min(1.6, p.along(tvSide) - 0.6))
      if (!t) continue
      const wide = area >= 17 && Math.min(p.iw, p.id) >= 3.4
      const s = p.against(wide ? 'sofa_l' : 'sofa', sofaSide, alongOf(t, tvSide), Math.min(wide ? 2.7 : 2.1, p.along(sofaSide) - 0.5))
      if (s) { tv = t; sofa = s; break }
      p.items.pop() // TV could not be matched with a sofa on that wall: take it back
    }
    if (sofa) break
  }
  if (!sofa) { // small / awkward room: sofa on the longest wall, no TV
    for (const s of p.wallsFarFromDoor()) { sofa = p.against('sofa', s, 'center', Math.min(2.1, p.along(s) - 0.4)); if (sofa) break }
  }
  if (!sofa) return
  const table = tv ? inFront(p, sofa, 'coffee_table', 0.45, 1.0, 0.5) : null
  if (table && p.iw * p.id >= 12) {
    const rug = p.mk('rug', table.cx, table.cz, table.facing, Math.min(2.4, p.along(table.facing) - 0.8), 1.6)
    p.add(rug)
  }
  if (area >= 14) { // side tables flank the sofa
    for (const sgn of [-1, 1]) {
      const s = sofa
      const along = alongOf(s, s.facing) + sgn * (s.w / 2 + 0.3)
      const cx = s.facing === 'N' || s.facing === 'S' ? along : s.cx + (s.facing === 'W' ? -s.d / 2 + 0.25 : s.d / 2 - 0.25)
      const cz = s.facing === 'W' || s.facing === 'E' ? along : s.cz + (s.facing === 'N' ? -s.d / 2 + 0.25 : s.d / 2 - 0.25)
      p.add(p.mk('side_table', cx, cz, s.facing))
    }
  }
  if (tv === null && area >= 14) p.against('bookshelf', p.wallsFarFromDoor()[0], 'center')
}

function furnishDining(p: Planner) {
  if (Math.min(p.iw, p.id) < 2.4 || p.iw * p.id < 6) return
  const alongX = p.iw >= p.id
  const cx = (p.I.x0 + p.I.x1) / 2, cz = (p.I.z0 + p.I.z1) / 2
  for (const [tw, td, perSide, ends] of [[1.6, 0.9, 2, 1], [1.2, 0.8, 2, 0]] as [number, number, number, number][]) {
    const need = alongX ? [tw + 1.5, td + 1.5] : [td + 1.5, tw + 1.5]
    if (p.iw < need[0] || p.id < need[1]) continue
    const facing: Facing = alongX ? 'N' : 'W'
    const table = p.mk('dining_table', cx, cz, facing, tw, td)
    if (!p.add(table)) continue
    const chairs: [number, number, Facing][] = []
    for (let i = 0; i < perSide; i++) {
      const u = -tw / 2 + (tw * (i + 0.5)) / perSide // evenly spaced slots, 0.6 m or more apart
      if (alongX) { chairs.push([cx + u, cz - td / 2 - 0.26, 'N'], [cx + u, cz + td / 2 + 0.26, 'S']) } else { chairs.push([cx - td / 2 - 0.26, cz + u, 'W'], [cx + td / 2 + 0.26, cz + u, 'E']) }
    }
    if (ends) { if (alongX) chairs.push([cx - tw / 2 - 0.26, cz, 'W'], [cx + tw / 2 + 0.26, cz, 'E']); else chairs.push([cx, cz - tw / 2 - 0.26, 'N'], [cx, cz + tw / 2 + 0.26, 'S']) }
    for (const [x, z, f] of chairs) p.add(p.mk('dining_chair', x, z, f))
    return
  }
}

function furnishKitchen(p: Planner) {
  const area = p.iw * p.id
  if (area < 4 || Math.min(p.iw, p.id) < 1.5) return
  const sides = (p.iw >= p.id ? ['N', 'S', 'W', 'E'] : ['W', 'E', 'N', 'S']) as Facing[]
  let counter: FurnitureItem | null = null
  for (const side of sides) {
    if (p.depth(side) < 1.5) continue // leave a working aisle
    const run = Math.min(3.6, p.along(side) - 0.9)
    for (let len = run; len >= 1.4 && !counter; len -= 0.2) counter = p.against('counter', side, 'center', len)
    if (counter) break
  }
  if (!counter) return
  const f = counter.facing
  const at = (frac: number) => alongOf(counter as FurnitureItem, f) - counter.w / 2 + counter.w * frac
  const pos = (frac: number, d: number) => {
    const along = at(frac)
    return f === 'N' || f === 'S'
      ? [along, f === 'N' ? counter!.cz - counter!.d / 2 + d / 2 : counter!.cz + counter!.d / 2 - d / 2]
      : [f === 'W' ? counter!.cx - counter!.d / 2 + d / 2 : counter!.cx + counter!.d / 2 - d / 2, along]
  }
  const put = (type: string, frac: number) => {
    const s = FURNITURE_SPECS[type]
    const [x, z] = pos(frac, s.d)
    return p.add(p.mk(type, x, z, f))
  }
  if (counter.w >= 1.9) { put('sink', 0.25); put('stove', 0.68) } else put('sink', 0.5)
  // refrigerator at the end of the counter, or on another wall
  let fridge: FurnitureItem | null = null
  const endAlong = alongOf(counter, f) + counter.w / 2 + 0.35 + 0.02
  const fx = f === 'N' || f === 'S' ? endAlong : counter.cx
  const fz = f === 'N' || f === 'S' ? counter.cz : endAlong
  const probe = p.mk('fridge', fx, f === 'N' || f === 'S' ? (f === 'N' ? p.I.z0 + 0.35 : p.I.z1 - 0.35) : fz, f)
  const probe2 = f === 'N' || f === 'S' ? probe : { ...probe, cx: f === 'W' ? p.I.x0 + 0.35 : p.I.x1 - 0.35, cz: fz }
  fridge = p.add(probe2)
  if (!fridge) for (const s of sides.filter((x) => x !== f)) { fridge = p.against('fridge', s, 'start'); if (fridge) break }
  if (area >= 9 && p.depth(f) >= 3.2 && Math.min(p.iw, p.id) >= 2.8) { // second run keeps the work triangle compact
    for (const s of sides.filter((x) => x !== f && x !== opposite(f))) if (p.against('counter', s, 'start', Math.min(1.8, p.along(s) - 1.4))) break
  }
  if (area >= 14 && Math.min(p.iw, p.id) >= 3.6) { // island / dining counter, 0.9 m clear all round
    p.add(p.mk('island', (p.I.x0 + p.I.x1) / 2, (p.I.z0 + p.I.z1) / 2, p.iw >= p.id ? 'N' : 'W', 1.6, 0.8))
  }
}

function furnishBathroom(p: Planner) {
  const area = p.iw * p.id
  if (area < 1.6 || Math.min(p.iw, p.id) < 1.1) return
  const sides = p.wallsFarFromDoor()
  for (const s of sides) if (p.against('toilet', s, 'end')) break
  let basin: FurnitureItem | null = null
  for (const s of sides) { basin = p.against('basin', s, 'start'); if (basin) break }
  if (basin) {
    const mirror = p.mk('mirror', basin.cx, basin.cz, basin.facing, 0.6, 0.04)
    const f = basin.facing
    if (f === 'N') mirror.cz = p.I.z0 + 0.02; else if (f === 'S') mirror.cz = p.I.z1 - 0.02; else if (f === 'W') mirror.cx = p.I.x0 + 0.02; else mirror.cx = p.I.x1 - 0.02
    p.add(mirror)
  }
  if (area >= 6 && Math.max(p.iw, p.id) >= 2.4) { for (const s of sides) if (p.against('bathtub', s, 'center')) break }
  else if (area >= 2.8 && Math.min(p.iw, p.id) >= 1.6) {
    for (const s of sides) { const sh = p.against('shower', s, 'end', 0.9, 0.9, 0.02); if (sh) break }
  }
}

function furnishStudy(p: Planner) {
  if (p.iw * p.id < 4 || Math.min(p.iw, p.id) < 1.8) return
  const sides = p.wallsFarFromDoor()
  for (const s of sides) {
    const desk = p.against('desk', s, 'center', Math.min(1.5, p.along(s) - 0.4))
    if (desk) { inFront(p, { ...desk }, 'office_chair', -0.1); break }
  }
  for (const s of sides) if (p.against('bookshelf', s, 'center')) break
  if (p.iw * p.id >= 9) for (const s of sides) if (p.against('wardrobe', s, 'start', 0.9)) break
}

/**
 * Automatic arrangement for one room. Returns an empty list for circulation space (passage, stairs) and unknown rooms.
 * The result is always checked: every doorway must stay connected by a walkable path; if not, items are removed.
 */
export function furnishRoom(room: RoomBox, openings: Opening[], seed = 0): FurnitureItem[] {
  const p = new Planner(room, openings, seed)
  if (p.iw < 1.1 || p.id < 1.1 || room.overflow) return []
  switch (room.type) {
    case 'bedroom': furnishBedroom(p); break
    case 'living': furnishLiving(p); break
    case 'dining': furnishDining(p); break
    case 'kitchen': furnishKitchen(p); break
    case 'bathroom': furnishBathroom(p); break
    case 'study': case 'office': furnishStudy(p); break
    default: break
  }
  const removable = () => p.items.map((i, k) => ({ i, k })).reverse().find(({ i }) => !specOf(i.type)?.overlay)
  while (p.items.length && !circulationOk(room, p.items, openings)) {
    const r = removable()
    if (!r) break
    p.items.splice(r.k, 1)
  }
  return p.items
}

/** Position for a newly added piece: scans the room for the first spot where it fits (against walls first). */
export function findFreeSpot(room: RoomBox, openings: Opening[], others: FurnitureItem[], type: string): FurnitureItem | null {
  const spec = specOf(type)
  if (!spec) return null
  const p = new Planner(room, openings)
  p.items = [...others]
  const sides: Facing[] = ['N', 'S', 'W', 'E']
  if (!spec.mounted && !spec.overlay) {
    for (const s of sides) {
      const it = p.against(type, s, 'center')
      if (it && circulationOk(room, p.items, openings)) return it
      if (it) p.items.pop()
    }
  }
  // free-standing: scan the floor
  const I = p.I
  for (let z = I.z0 + spec.d / 2; z <= I.z1 - spec.d / 2 + 1e-9; z += 0.1) for (let x = I.x0 + spec.w / 2; x <= I.x1 - spec.w / 2 + 1e-9; x += 0.1) {
    const it: FurnitureItem = { id: uniqueId(room.id, type, others.map((o) => o.id)), room_id: room.id, type, cx: x, cz: z, w: spec.w, d: spec.d, facing: 'N' }
    if (placementProblem(it, room, openings, others) === null && circulationOk(room, [...others, it], openings)) return it
  }
  return null
}
