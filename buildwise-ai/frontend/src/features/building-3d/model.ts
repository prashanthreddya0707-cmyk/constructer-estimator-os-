/**
 * Converts the saved plan (project dimensions + room rectangles) into renderable 3D geometry.
 * The saved rooms are the single source of truth: nothing here invents a layout.
 *
 * Coordinate system: 1 Three.js world unit = 1 metre. X = building length, Z = building width, Y = up.
 * The footprint is centred on the origin: x ∈ [-L/2, L/2], z ∈ [-W/2, W/2]; the ground-floor slab top is y = 0.
 * Room positions (pos_x, pos_y) are metres from the footprint's top-left (-X, -Z) corner. Rooms without a
 * stored position are placed by an explicitly *schematic* shelf-packing layout (flagged in the model).
 *
 * Pipeline per floor:
 *   1. room rectangles  ->  2. wall graph (shared edges merged, exterior perimeter)
 *   3. junction trimming (walls meet face-to-face, never overlap)
 *   4. door / window placement from the room edges (doors on shared walls, windows on exterior walls)
 *   5. wall solids with real openings  ->  6. optional furniture
 */
import type { ProjectDetail, Room } from '@/types'
import { buildFurniture, type FurniturePart } from './furniture'

export interface Box { cx: number; cy: number; cz: number; sx: number; sy: number; sz: number }
export type Side = 'N' | 'S' | 'E' | 'W' // N = -Z, S = +Z, W = -X, E = +X

export interface Opening {
  id: string
  kind: 'door' | 'window'
  wallId: string
  /** 'x' wall runs along X (its `line` is a Z coordinate); 'z' wall runs along Z (its `line` is an X coordinate) */
  orientation: 'x' | 'z'
  /** centre along the wall axis (world coordinate) */
  center: number
  /** world coordinate of the wall centreline across the axis */
  line: number
  width: number
  sill: number
  height: number
  /** room that owns the opening */
  roomId: string
  /** direction (+1 / -1) along the perpendicular axis that points into the owning room */
  into: 1 | -1
  thickness: number
}

export interface WallSolid {
  id: string
  orientation: 'x' | 'z'
  line: number
  /** extents along the axis after junction trimming (what is actually built) */
  a0: number
  a1: number
  /** original centreline extents (used for junction logic / lookups) */
  ra0: number
  ra1: number
  t: number
  h: number
  y: number
  exterior: boolean
  side: Side | null
  openings: Opening[]
  blocked: [number, number][]
  /** solid boxes of the full-height wall with openings cut out */
  pieces: Box[]
  /** low "cutaway" version used by the dollhouse view (exterior walls only; interior = same as pieces) */
  cutPieces: Box[]
}

export interface RoomBox {
  id: string
  name: string
  type: string
  floor: number
  /** world-space centre */
  cx: number
  cz: number
  /** world-space rectangle */
  x0: number
  x1: number
  z0: number
  z1: number
  /** footprint size along X / Z */
  sx: number
  sz: number
  h: number
  /** y of the floor surface */
  y: number
  doors: number
  windows: number
  area: number
  schematic: boolean
  overflow: boolean
  /** top-left corner in building-local metres (what gets stored when a layout is locked) */
  lx: number
  lz: number
  boundary: Record<Side, boolean>
  /** clear distance from the room rectangle to the finished wall face, per side */
  inset: Record<Side, number>
}

export interface FloorModel {
  index: number
  y: number
  slabY: number
  rooms: RoomBox[]
  walls: WallSolid[]
  openings: Opening[]
  furniture: FurniturePart[]
  schematic: boolean
}

export interface Model3D {
  ok: boolean
  errors: string[]
  notes: string[]
  length: number
  width: number
  height: number
  slab: number
  wallT: number
  floors: FloorModel[]
  totalHeight: number
  roofY: number
  schematic: boolean
  /** world height of text labels, scaled with the building so they stay readable */
  labelSize: number
  roof: { ridge: 'x' | 'z'; height: number; overhang: number }
}

const EPS = 1e-6
const TOL = 0.04
const CUT_H = 0.45
const INT_T = 0.115
const DOOR_W = 0.9
const good = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0

const empty = (errors: string[]): Model3D => ({
  ok: false, errors, notes: [], length: 0, width: 0, height: 0, slab: 0, wallT: 0, floors: [], totalHeight: 0, roofY: 0,
  schematic: false, labelSize: 0.5, roof: { ridge: 'x', height: 0, overhang: 0 },
})

export function validateProject(p: Pick<ProjectDetail, 'length' | 'width' | 'height' | 'floors' | 'slab_thickness' | 'wall_thickness'>): string[] {
  const errors: string[] = []
  if (!good(p.length)) errors.push('Building length must be a positive number.')
  if (!good(p.width)) errors.push('Building width must be a positive number.')
  if (!good(p.height)) errors.push('Floor height must be a positive number.')
  if (!good(p.slab_thickness)) errors.push('Slab thickness must be a positive number.')
  if (!good(p.wall_thickness)) errors.push('Wall thickness must be a positive number.')
  if (!Number.isInteger(p.floors) || p.floors < 1) errors.push('Number of floors must be at least 1.')
  return errors
}

/** Shelf-pack rooms left-to-right inside the footprint. Returns top-left corners in building-local metres. */
export function schematicLayout(rooms: Pick<Room, 'id' | 'length' | 'width'>[], L: number): Map<string, { x: number; z: number }> {
  const out = new Map<string, { x: number; z: number }>()
  let x = 0, z = 0, rowD = 0
  for (const r of rooms) {
    if (x > EPS && x + r.length > L + EPS) { x = 0; z += rowD; rowD = 0 }
    out.set(r.id, { x, z })
    x += r.length
    rowD = Math.max(rowD, r.width)
  }
  return out
}

// ---------------------------------------------------------------------------------------------------------------
// wall pieces (solid boxes around the openings)

function axisBox(w: Pick<WallSolid, 'orientation' | 'line' | 't' | 'y'>, a0: number, a1: number, yLo: number, yHi: number): Box | null {
  if (a1 - a0 < 1e-3 || yHi - yLo < 1e-3) return null
  const along = (a0 + a1) / 2, len = a1 - a0, cy = w.y + (yLo + yHi) / 2, sy = yHi - yLo
  return w.orientation === 'x'
    ? { cx: along, cy, cz: w.line, sx: len, sy, sz: w.t }
    : { cx: w.line, cy, cz: along, sx: w.t, sy, sz: len }
}

export function wallPieces(w: Pick<WallSolid, 'orientation' | 'line' | 't' | 'y' | 'h' | 'a0' | 'a1' | 'openings'>): Box[] {
  const out: Box[] = []
  const push = (b: Box | null) => { if (b) out.push(b) }
  const opens = [...w.openings].sort((a, b) => a.center - b.center)
  let cursor = w.a0
  for (const o of opens) {
    const s = o.center - o.width / 2, e = o.center + o.width / 2
    push(axisBox(w, cursor, s, 0, w.h))
    push(axisBox(w, s, e, o.sill + o.height, w.h)) // lintel above the opening
    if (o.sill > 0) push(axisBox(w, s, e, 0, o.sill)) // sill below a window
    cursor = e
  }
  push(axisBox(w, cursor, w.a1, 0, w.h))
  return out
}

// ---------------------------------------------------------------------------------------------------------------

interface Iv { lo: number; hi: number; t: number }

function unionIntervals(list: Iv[]): Iv[] {
  const s = [...list].sort((a, b) => a.lo - b.lo)
  const out: Iv[] = []
  for (const iv of s) {
    const last = out[out.length - 1]
    if (last && iv.lo <= last.hi + 0.02) { last.hi = Math.max(last.hi, iv.hi); last.t = Math.max(last.t, iv.t) }
    else out.push({ ...iv })
  }
  return out
}

function addKeyed(map: Map<number, Iv[]>, v: number, iv: Iv) {
  let key = v
  for (const k of map.keys()) if (Math.abs(k - v) <= 0.03) { key = k; break }
  const arr = map.get(key)
  if (arr) arr.push(iv); else map.set(key, [iv])
}

interface Edge { side: Side; orient: 'x' | 'z'; line: number; lo: number; hi: number; into: 1 | -1; boundary: boolean }
function roomEdges(b: RoomBox): Edge[] {
  return [
    { side: 'N', orient: 'x', line: b.z0, lo: b.x0, hi: b.x1, into: 1, boundary: b.boundary.N },
    { side: 'S', orient: 'x', line: b.z1, lo: b.x0, hi: b.x1, into: -1, boundary: b.boundary.S },
    { side: 'W', orient: 'z', line: b.x0, lo: b.z0, hi: b.z1, into: 1, boundary: b.boundary.W },
    { side: 'E', orient: 'z', line: b.x1, lo: b.z0, hi: b.z1, into: -1, boundary: b.boundary.E },
  ]
}

const NEIGHBOUR_BONUS: Record<string, number> = { corridor: 3, living: 2, dining: 1.5, staircase: 1 }

function buildFloor(p: ProjectDetail, fl: number, rooms: Room[], notes: string[]): { floor: FloorModel; overflow: boolean } {
  const L = p.length, W = p.width, H = p.height, T = p.slab_thickness, WT = p.wall_thickness
  const y = (fl - 1) * (H + T)
  const allPositioned = rooms.length > 0 && rooms.every((r) => r.pos_x != null && r.pos_y != null)
  const packed = allPositioned ? null : schematicLayout(rooms, L)
  const schematic = rooms.length > 0 && !allPositioned

  // 1. room rectangles --------------------------------------------------------------------------------------
  const boxes: RoomBox[] = rooms.map((r) => {
    const pos = allPositioned ? { x: r.pos_x as number, z: r.pos_y as number } : packed!.get(r.id)!
    const x0 = pos.x - L / 2, z0 = pos.z - W / 2, x1 = x0 + r.length, z1 = z0 + r.width
    const boundary: Record<Side, boolean> = {
      N: Math.abs(z0 + W / 2) < 0.05, S: Math.abs(z1 - W / 2) < 0.05, W: Math.abs(x0 + L / 2) < 0.05, E: Math.abs(x1 - L / 2) < 0.05,
    }
    const it = (r.wall_thickness ?? INT_T) / 2 + 0.03, et = WT / 2 + 0.03
    return {
      id: r.id, name: r.name, type: r.room_type, floor: fl, cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, x0, x1, z0, z1, sx: r.length, sz: r.width,
      h: Math.min(r.height, H), y, doors: r.doors, windows: r.windows, area: r.area, schematic,
      overflow: pos.x + r.length > L + 0.01 || pos.z + r.width > W + 0.01 || pos.x < -0.01 || pos.z < -0.01, lx: pos.x, lz: pos.z, boundary,
      inset: { N: boundary.N ? et : it, S: boundary.S ? et : it, W: boundary.W ? et : it, E: boundary.E ? et : it },
    }
  })

  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], c = boxes[j]
    const ow = Math.min(a.x1, c.x1) - Math.max(a.x0, c.x0), od = Math.min(a.z1, c.z1) - Math.max(a.z0, c.z0)
    if (ow > 0.05 && od > 0.05) notes.push(`Floor ${fl}: rooms "${a.name}" and "${c.name}" overlap by ${(ow * od).toFixed(1)} m². Check their positions or sizes.`)
  }

  // 2. wall graph ---------------------------------------------------------------------------------------------
  const walls: WallSolid[] = []
  let n = 0
  const mk = (orientation: 'x' | 'z', line: number, lo: number, hi: number, t: number, exterior: boolean, side: Side | null) => {
    walls.push({ id: `f${fl}-${orientation}${n++}`, orientation, line, a0: lo, a1: hi, ra0: lo, ra1: hi, t, h: H, y, exterior, side, openings: [], blocked: [], pieces: [], cutPieces: [] })
  }
  mk('x', -W / 2, -L / 2, L / 2, WT, true, 'N')
  mk('x', W / 2, -L / 2, L / 2, WT, true, 'S')
  mk('z', -L / 2, -W / 2, W / 2, WT, true, 'W')
  mk('z', L / 2, -W / 2, W / 2, WT, true, 'E')

  const hMap = new Map<number, Iv[]>(), vMap = new Map<number, Iv[]>()
  boxes.forEach((b, i) => {
    const t = rooms[i].wall_thickness ?? INT_T
    if (!b.boundary.N) addKeyed(hMap, b.z0, { lo: b.x0, hi: b.x1, t })
    if (!b.boundary.S) addKeyed(hMap, b.z1, { lo: b.x0, hi: b.x1, t })
    if (!b.boundary.W) addKeyed(vMap, b.x0, { lo: b.z0, hi: b.z1, t })
    if (!b.boundary.E) addKeyed(vMap, b.x1, { lo: b.z0, hi: b.z1, t })
  })
  for (const [z, ivs] of hMap) for (const iv of unionIntervals(ivs)) mk('x', z, iv.lo, iv.hi, iv.t, false, null)
  for (const [x, ivs] of vMap) for (const iv of unionIntervals(ivs)) mk('z', x, iv.lo, iv.hi, iv.t, false, null)

  // 3. junction trimming: walls meet face-to-face, no overlapping volumes ------------------------------------
  const xs = walls.filter((w) => w.orientation === 'x'), zs = walls.filter((w) => w.orientation === 'z')
  for (const w of xs) {
    const ends: ('lo' | 'hi')[] = ['lo', 'hi']
    for (const end of ends) {
      const e = end === 'lo' ? w.ra0 : w.ra1
      let shorten = 0, extend = 0
      for (const v of zs) {
        if (Math.abs(v.line - e) > TOL || w.line < v.ra0 - TOL || w.line > v.ra1 + TOL) continue
        if (w.line > v.ra0 + TOL && w.line < v.ra1 - TOL) shorten = Math.max(shorten, v.t / 2) // a wall passes through: stop at its face
        else extend = Math.max(extend, v.t / 2) // corner: fill the corner square
      }
      const delta = shorten > 0 ? -shorten : extend
      if (end === 'lo') w.a0 = w.ra0 - delta; else w.a1 = w.ra1 + delta
    }
  }
  for (const w of zs) {
    const ends: ('lo' | 'hi')[] = ['lo', 'hi']
    for (const end of ends) {
      const e = end === 'lo' ? w.ra0 : w.ra1
      let trim = 0
      for (const v of xs) {
        if (Math.abs(v.line - e) <= TOL && w.line >= v.ra0 - TOL && w.line <= v.ra1 + TOL) trim = Math.max(trim, v.t / 2)
      }
      if (end === 'lo') w.a0 = w.ra0 + trim; else w.a1 = w.ra1 - trim
    }
  }
  // spans occupied by perpendicular walls (openings must keep clear of them)
  for (const w of walls) {
    for (const v of w.orientation === 'x' ? zs : xs) {
      const touches = Math.abs(v.ra0 - w.line) <= TOL || Math.abs(v.ra1 - w.line) <= TOL || (v.ra0 < w.line && v.ra1 > w.line)
      if (touches && v.line >= w.ra0 - TOL && v.line <= w.ra1 + TOL) w.blocked.push([v.line - v.t / 2 - 0.08, v.line + v.t / 2 + 0.08])
    }
  }

  const wallAt = (orient: 'x' | 'z', line: number, along: number) =>
    walls.find((w) => w.orientation === orient && Math.abs(w.line - line) <= 0.05 && along >= w.ra0 - TOL && along <= w.ra1 + TOL)

  const findSlot = (w: WallSolid, lo: number, hi: number, width: number, pref: number): number | null => {
    const min = Math.max(lo, w.a0 + 0.15) + width / 2, max = Math.min(hi, w.a1 - 0.15) - width / 2
    if (max < min - 1e-9) return null
    const ok = (c: number) =>
      w.openings.every((o) => Math.abs(c - o.center) >= (width + o.width) / 2 + 0.1) &&
      w.blocked.every(([b0, b1]) => c + width / 2 <= b0 || c - width / 2 >= b1)
    const start = Math.min(max, Math.max(min, pref))
    const span = Math.max(max - min, 0)
    for (let d = 0; d <= span + 1e-9; d += 0.05) {
      for (const c of d === 0 ? [start] : [start - d, start + d]) if (c >= min - 1e-9 && c <= max + 1e-9 && ok(c)) return c
    }
    return null
  }

  const openings: Opening[] = []
  let oid = 0
  const addOpening = (w: WallSolid, kind: 'door' | 'window', center: number, width: number, roomId: string, into: 1 | -1) => {
    const sill = kind === 'door' ? 0 : Math.min(0.9, H * 0.3)
    const height = kind === 'door' ? Math.min(2.1, H - 0.3) : Math.min(1.2, H - sill - 0.3)
    if (height < 0.3) return false
    const o: Opening = { id: `f${fl}-o${oid++}`, kind, wallId: w.id, orientation: w.orientation, center, line: w.line, width, sill, height, roomId, into, thickness: w.t }
    w.openings.push(o)
    openings.push(o)
    return true
  }

  // 4a. windows on exterior walls ---------------------------------------------------------------------------
  let skippedWindows = 0, skippedDoors = 0
  for (const b of boxes) {
    if (!b.windows) continue
    const ext = roomEdges(b).filter((e) => e.boundary)
    if (!ext.length) { skippedWindows += b.windows; continue }
    const counts = ext.map(() => 0)
    for (let i = 0; i < b.windows; i++) {
      let best = 0, bestScore = -1
      ext.forEach((e, k) => { const s = (e.hi - e.lo) / (counts[k] + 1); if (s > bestScore) { bestScore = s; best = k } })
      counts[best]++
    }
    ext.forEach((e, k) => {
      const w = walls.find((x) => x.exterior && x.side === e.side)
      if (!w) return
      const cnt = counts[k], seg = e.hi - e.lo
      for (let i = 0; i < cnt; i++) {
        const width = Math.min(1.2, (seg / (cnt + 1)) * 0.8)
        const c = width >= 0.5 ? findSlot(w, e.lo, e.hi, width, e.lo + (seg * (i + 1)) / (cnt + 1)) : null
        if (c == null || !addOpening(w, 'window', c, width, b.id, e.into)) skippedWindows++
      }
    })
  }

  // 4b. doors: preferably on walls shared with a neighbouring room, so doors connect rooms -------------------
  const doorOn = (b: RoomBox) => openings.filter((o) => o.kind === 'door' && roomEdges(b).some((e) =>
    e.orient === o.orientation && Math.abs(e.line - o.line) <= 0.05 && o.center >= e.lo - TOL && o.center <= e.hi + TOL))
  for (const b of boxes) {
    const need = Math.max(0, b.doors - doorOn(b).length)
    if (!need) continue
    interface Seg { e: Edge; lo: number; hi: number; score: number }
    const segs: Seg[] = []
    for (const e of roomEdges(b)) {
      if (e.boundary) { segs.push({ e, lo: e.lo, hi: e.hi, score: (e.hi - e.lo) * 0.05 }); continue }
      let shared = false
      for (const o of boxes) {
        if (o.id === b.id) continue
        const oe = roomEdges(o).find((x) => x.orient === e.orient && x.side !== e.side && Math.abs(x.line - e.line) <= 0.05)
        if (!oe) continue
        const lo = Math.max(e.lo, oe.lo), hi = Math.min(e.hi, oe.hi)
        if (hi - lo >= 0.7) { shared = true; segs.push({ e, lo, hi, score: 10 + (hi - lo) + (NEIGHBOUR_BONUS[o.type] ?? 0) }) }
      }
      if (!shared) segs.push({ e, lo: e.lo, hi: e.hi, score: (e.hi - e.lo) * 0.2 })
    }
    segs.sort((a, c) => c.score - a.score)
    for (let k = 0; k < need; k++) {
      let placed = false
      for (const s of segs) {
        const w = wallAt(s.e.orient, s.e.line, (s.lo + s.hi) / 2)
        if (!w) continue
        if (w.openings.some((o) => o.kind === 'door' && o.center >= s.lo - TOL && o.center <= s.hi + TOL)) continue // one door per shared segment
        const width = Math.min(DOOR_W, s.hi - s.lo - 0.3)
        if (width < 0.6) continue
        const c = findSlot(w, s.lo, s.hi, width, (s.lo + s.hi) / 2)
        if (c != null && addOpening(w, 'door', c, width, b.id, s.e.into)) { placed = true; break }
      }
      if (!placed) skippedDoors++
    }
  }
  if (skippedWindows) notes.push(`Floor ${fl}: ${skippedWindows} window(s) could not be placed (no free exterior wall space).`)
  if (skippedDoors) notes.push(`Floor ${fl}: ${skippedDoors} door(s) could not be placed (no free wall space).`)

  // 5. wall solids with real openings -----------------------------------------------------------------------
  for (const w of walls) {
    w.pieces = wallPieces(w)
    w.cutPieces = w.exterior ? [axisBox(w, w.a0, w.a1, 0, Math.min(CUT_H, H))].filter((x): x is Box => !!x) : w.pieces
  }

  // 6. optional furniture (decorative only: never touches walls / openings) --------------------------------
  const furniture = boxes.flatMap((b) => buildFurniture(b, openings))

  return {
    floor: { index: fl, y, slabY: y - T / 2, rooms: boxes, walls, openings, furniture, schematic },
    overflow: boxes.some((b) => b.overflow),
  }
}

export function buildModel(p: ProjectDetail | null | undefined): Model3D {
  if (!p) return empty(['No project loaded.'])
  const errors = validateProject(p)
  if (errors.length) return empty(errors)

  const L = p.length, W = p.width, H = p.height, T = p.slab_thickness, WT = p.wall_thickness
  const notes: string[] = []
  const floors: FloorModel[] = []
  let anySchematic = false, anyOverflow = false

  const validRooms = p.rooms.filter((r) => good(r.length) && good(r.width) && good(r.height) && r.floor_number >= 1 && r.floor_number <= p.floors)
  if (validRooms.length < p.rooms.length) notes.push(`${p.rooms.length - validRooms.length} room(s) with invalid dimensions or floor were skipped.`)

  for (let fl = 1; fl <= p.floors; fl++) {
    const { floor, overflow } = buildFloor(p, fl, validRooms.filter((r) => r.floor_number === fl), notes)
    if (floor.schematic) anySchematic = true
    if (overflow) anyOverflow = true
    floors.push(floor)
  }
  if (anySchematic) notes.push('Some rooms have no stored position: they are arranged in a schematic layout (not the original floor plan).')
  if (anyOverflow) notes.push('Some rooms extend beyond the building footprint. Check room sizes or building dimensions.')

  const totalHeight = (p.floors - 1) * (H + T) + H
  const ridge: 'x' | 'z' = L >= W ? 'x' : 'z'
  return {
    ok: true, errors: [], notes, length: L, width: W, height: H, slab: T, wallT: WT, floors, totalHeight, roofY: totalHeight + T / 2,
    schematic: anySchematic, labelSize: Math.min(2, Math.max(0.45, Math.max(L, W) * 0.05)),
    roof: { ridge, height: Math.min(L, W) * 0.2, overhang: 0.35 },
  }
}
