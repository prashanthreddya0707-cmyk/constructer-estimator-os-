/**
 * The single geometry source for the 2D plan, the 3D model and the estimator summary.
 * Saved rooms (+ optional saved openings / furniture) in -> walls, openings, floors, furniture, validation out.
 *
 * Coordinate system: 1 Three.js world unit = 1 metre. X = building length, Z = building width, Y = up.
 * World coordinates are centred on the footprint: x ∈ [-L/2, L/2], z ∈ [-W/2, W/2]; the ground-floor slab top is y = 0.
 * Saved data (room positions, openings, furniture) uses building-local metres: origin = top-left (-X, -Z) corner.
 * Rooms without a stored position get an explicitly *schematic* shelf-packing layout (flagged in the model).
 *
 * Pipeline per floor:
 *   rooms -> wall graph (shared edges merged, exterior perimeter, open circulation edges) -> junction trimming
 *   -> openings (saved ones first, then main entrance, doors for every room, windows) -> wall solids with real gaps
 *   -> furniture (saved per room, otherwise automatic) -> validation (access, overlaps, blocked circulation).
 */
import type { ProjectDetail, Room } from '@/types'
import { circulationOk, furnishRoom, partsFor, placementProblem, type FurnitureItem, type FurniturePart } from './furniture'
import { roomSignature, type LayoutSummary, type SavedLayout, type SavedFurniture, type SavedOpening } from './layoutStore'

export type { FurnitureItem, FurniturePart } from './furniture'

export interface Box { cx: number; cy: number; cz: number; sx: number; sy: number; sz: number }
export type Side = 'N' | 'S' | 'E' | 'W' // N = -Z, S = +Z, W = -X, E = +X

export interface Issue {
  severity: 'error' | 'warning' | 'info'
  code: string
  message: string
  roomId?: string
  floor?: number
}

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
  entrance: boolean
  floor: number
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
  furnitureItems: FurnitureItem[]
  furniture: FurniturePart[]
  schematic: boolean
}

/** Everything needed to save the current arrangement back to the project. */
export interface ResolvedLayout {
  openings: SavedOpening[]
  furniture: SavedFurniture[]
  roomSigs: Record<string, string>
  summary: LayoutSummary
}

export interface Model3D {
  ok: boolean
  errors: string[]
  notes: string[]
  issues: Issue[]
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
  resolved: ResolvedLayout
}

export interface BuildOptions {
  /** saved openings / furniture / settings (null = fully automatic) */
  layout?: SavedLayout | null
  /** automatic furnishing for rooms without a saved arrangement (default true) */
  autoFurnish?: boolean
}

export const DOOR_SIZES = {
  entrance: { w: 1.0, h: 2.1 },
  internal: { w: 0.9, h: 2.1 },
  bathroom: { w: 0.75, h: 2.0 },
}
export const CIRCULATION = new Set(['corridor', 'staircase'])

const EPS = 1e-6
const TOL = 0.04
const CUT_H = 0.45
const INT_T = 0.115
const good = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0

const emptyResolved = (): ResolvedLayout => ({ openings: [], furniture: [], roomSigs: {}, summary: { doors: [], windows: [] } })
const empty = (errors: string[]): Model3D => ({
  ok: false, errors, notes: [], issues: errors.map((m) => ({ severity: 'error' as const, code: 'invalid-input', message: m })), length: 0, width: 0, height: 0,
  slab: 0, wallT: 0, floors: [], totalHeight: 0, roofY: 0, schematic: false, labelSize: 0.5, roof: { ridge: 'x', height: 0, overhang: 0 }, resolved: emptyResolved(),
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

/** True when an opening of `width` centred at `c` fits the wall: inside its built span, clear of perpendicular walls and other openings. */
export function slotFree(w: WallSolid, c: number, width: number, ignoreId?: string): boolean {
  return c - width / 2 >= w.a0 + 0.1 - 1e-9 && c + width / 2 <= w.a1 - 0.1 + 1e-9 &&
    w.openings.every((o) => o.id === ignoreId || Math.abs(c - o.center) >= (width + o.width) / 2 + 0.1 - 1e-9) &&
    w.blocked.every(([b0, b1]) => c + width / 2 <= b0 + 1e-9 || c - width / 2 >= b1 - 1e-9)
}

/** Nearest free position to `pref` within [lo, hi] along the wall, or null. */
export function searchSlot(w: WallSolid, lo: number, hi: number, width: number, pref: number, ignoreId?: string): number | null {
  const min = Math.max(lo, w.a0 + 0.15) + width / 2, max = Math.min(hi, w.a1 - 0.15) - width / 2
  if (max < min - 1e-9) return null
  const start = Math.min(max, Math.max(min, pref))
  const span = Math.max(max - min, 0)
  for (let d = 0; d <= span + 1e-9; d += 0.05) {
    for (const c of d === 0 ? [start] : [start - d, start + d]) if (c >= min - 1e-9 && c <= max + 1e-9 && slotFree(w, c, width, ignoreId)) return c
  }
  return null
}

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
export function roomEdges(b: RoomBox): Edge[] {
  return [
    { side: 'N', orient: 'x', line: b.z0, lo: b.x0, hi: b.x1, into: 1, boundary: b.boundary.N },
    { side: 'S', orient: 'x', line: b.z1, lo: b.x0, hi: b.x1, into: -1, boundary: b.boundary.S },
    { side: 'W', orient: 'z', line: b.x0, lo: b.z0, hi: b.z1, into: 1, boundary: b.boundary.W },
    { side: 'E', orient: 'z', line: b.x1, lo: b.z0, hi: b.z1, into: -1, boundary: b.boundary.E },
  ]
}

const NEIGHBOUR_BONUS: Record<string, number> = { corridor: 3, living: 2, dining: 1.5, staircase: 1 }
const ENTRANCE_ROOMS = ['living', 'corridor', 'dining']

interface FloorCtx {
  p: ProjectDetail
  fl: number
  rooms: Room[]
  issues: Issue[]
  opts: BuildOptions
}

function buildFloor(ctx: FloorCtx): { floor: FloorModel; overflow: boolean } {
  const { p, fl, rooms, issues, opts } = ctx
  const L = p.length, W = p.width, H = p.height, T = p.slab_thickness, WT = p.wall_thickness
  const layout = opts.layout ?? null
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
  const byId = new Map(boxes.map((b) => [b.id, b]))

  for (const b of boxes) if (b.overflow) issues.push({ severity: 'error', code: 'outside-footprint', floor: fl, roomId: b.id, message: `Floor ${fl}: "${b.name}" extends beyond the building footprint. Check its size or position.` })
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], c = boxes[j]
    const ow = Math.min(a.x1, c.x1) - Math.max(a.x0, c.x0), od = Math.min(a.z1, c.z1) - Math.max(a.z0, c.z0)
    if (ow > 0.05 && od > 0.05) issues.push({ severity: 'error', code: 'room-overlap', floor: fl, roomId: a.id, message: `Floor ${fl}: rooms "${a.name}" and "${c.name}" overlap by ${(ow * od).toFixed(1)} m². Check their positions or sizes.` })
  }
  const covered = boxes.reduce((s, b) => s + b.sx * b.sz, 0)
  if (boxes.length && covered < L * W * 0.9 - 0.5 && !schematic) issues.push({ severity: 'info', code: 'unassigned-space', floor: fl, message: `Floor ${fl}: ${(L * W - covered).toFixed(1)} m² of the footprint is not part of any room.` })

  // open edges: circulation rooms (passage, stairs) that touch along their whole edge share no wall
  const openEdge = new Set<string>()
  const isOpenPair = (b: RoomBox, e: Edge) => {
    if (e.boundary || !CIRCULATION.has(b.type)) return null
    for (const o of boxes) {
      if (o.id === b.id || !CIRCULATION.has(o.type)) continue
      const oe = roomEdges(o).find((x) => x.orient === e.orient && x.side !== e.side && Math.abs(x.line - e.line) <= 0.05)
      if (oe && Math.abs(oe.lo - e.lo) <= 0.05 && Math.abs(oe.hi - e.hi) <= 0.05) return o
    }
    return null
  }
  for (const b of boxes) for (const e of roomEdges(b)) if (isOpenPair(b, e)) openEdge.add(`${b.id}:${e.side}`)

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
    const wall = (s: Side) => !b.boundary[s] && !openEdge.has(`${b.id}:${s}`)
    if (wall('N')) addKeyed(hMap, b.z0, { lo: b.x0, hi: b.x1, t })
    if (wall('S')) addKeyed(hMap, b.z1, { lo: b.x0, hi: b.x1, t })
    if (wall('W')) addKeyed(vMap, b.x0, { lo: b.z0, hi: b.z1, t })
    if (wall('E')) addKeyed(vMap, b.x1, { lo: b.z0, hi: b.z1, t })
  })
  for (const [z, ivs] of hMap) for (const iv of unionIntervals(ivs)) mk('x', z, iv.lo, iv.hi, iv.t, false, null)
  for (const [x, ivs] of vMap) for (const iv of unionIntervals(ivs)) mk('z', x, iv.lo, iv.hi, iv.t, false, null)

  // 3. junction trimming: walls meet face-to-face, no overlapping volumes ------------------------------------
  const xs = walls.filter((w) => w.orientation === 'x'), zs = walls.filter((w) => w.orientation === 'z')
  for (const w of xs) {
    for (const end of ['lo', 'hi'] as const) {
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
    for (const end of ['lo', 'hi'] as const) {
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

  const slotOk = (w: WallSolid, c: number, width: number) => slotFree(w, c, width)
  const findSlot = (w: WallSolid, lo: number, hi: number, width: number, pref: number) => searchSlot(w, lo, hi, width, pref)

  const openings: Opening[] = []
  let oid = 0
  const addOpening = (w: WallSolid, kind: 'door' | 'window', center: number, width: number, height: number, sill: number, roomId: string, into: 1 | -1, entrance = false, id?: string) => {
    if (height < 0.3) return null
    const o: Opening = { id: id ?? `f${fl}-o${oid++}`, kind, wallId: w.id, orientation: w.orientation, center, line: w.line, width, sill, height, roomId, into, thickness: w.t, entrance, floor: fl }
    w.openings.push(o)
    openings.push(o)
    return o
  }
  const doorH = (h: number) => Math.min(h, H - 0.3)
  const windowSill = Math.min(0.9, H * 0.3)
  const windowH = Math.min(1.2, H - windowSill - 0.3)
  const customMode = layout?.openings != null

  // 4a. saved openings (kept only while they still fit the current walls) -----------------------------------
  if (customMode) {
    let dropped = 0
    for (const so of layout!.openings!.filter((s) => s.floor === fl)) {
      const line = so.orientation === 'x' ? so.line - W / 2 : so.line - L / 2
      const center = so.orientation === 'x' ? so.center - L / 2 : so.center - W / 2
      const w = wallAt(so.orientation, line, center)
      const room = byId.get(so.room_id)
      if (!w || !room || !slotOk(w, center, so.width) || so.height > H - 0.1) { dropped++; continue }
      addOpening(w, so.kind, center, so.width, so.height, so.sill, so.room_id, so.into, !!so.entrance, so.id)
    }
    if (dropped) issues.push({ severity: 'warning', code: 'opening-dropped', floor: fl, message: `Floor ${fl}: ${dropped} saved door/window position(s) no longer fit the walls after the plan changed and were removed.` })
  }

  // 4b. main entrance (ground floor) ------------------------------------------------------------------------
  if (fl === 1 && boxes.length && !openings.some((o) => o.entrance)) {
    const order = [...boxes].sort((a, b) => {
      const ra = ENTRANCE_ROOMS.indexOf(a.type), rb = ENTRANCE_ROOMS.indexOf(b.type)
      return (ra < 0 ? 9 : ra) - (rb < 0 ? 9 : rb)
    })
    const sidePref: Side[] = ['S', 'W', 'E', 'N']
    let placedEntrance = false
    for (const b of order) {
      const ext = roomEdges(b).filter((e) => e.boundary).sort((a, c) => sidePref.indexOf(a.side) - sidePref.indexOf(c.side) || (c.hi - c.lo) - (a.hi - a.lo))
      for (const e of ext) {
        const w = walls.find((x) => x.exterior && x.side === e.side)
        if (!w) continue
        const width = +Math.min(DOOR_SIZES.entrance.w, e.hi - e.lo - 0.3).toFixed(3)
        if (width < 0.7) continue
        const c = findSlot(w, e.lo, e.hi, width, (e.lo + e.hi) / 2)
        if (c != null) { addOpening(w, 'door', c, width, doorH(DOOR_SIZES.entrance.h), 0, b.id, e.into, true); placedEntrance = true; break }
      }
      if (placedEntrance) break
    }
    if (!placedEntrance) issues.push({ severity: 'error', code: 'no-entrance', floor: fl, message: 'No main entrance could be placed: no ground-floor room has a free exterior wall.' })
  }

  // 4c. doors: every enclosed room gets a doorway, preferably on a wall shared with a neighbouring room -------
  const doorOn = (b: RoomBox) => openings.filter((o) => o.kind === 'door' && !o.entrance && roomEdges(b).some((e) =>
    e.orient === o.orientation && Math.abs(e.line - o.line) <= 0.05 && o.center >= e.lo - TOL && o.center <= e.hi + TOL))
  const tryDoor = (b: RoomBox, e: Edge, lo: number, hi: number, neighbour?: RoomBox): boolean => {
    const w = wallAt(e.orient, e.line, (lo + hi) / 2)
    if (!w) return false
    if (w.openings.some((o) => o.kind === 'door' && o.center >= lo - TOL && o.center <= hi + TOL)) return false // one door per shared segment
    const bath = b.type === 'bathroom' || neighbour?.type === 'bathroom'
    const size = bath ? DOOR_SIZES.bathroom : DOOR_SIZES.internal
    const width = +Math.min(size.w, hi - lo - 0.3).toFixed(3)
    if (width < Math.min(0.6, size.w)) return false
    const c = findSlot(w, lo, hi, width, (lo + hi) / 2)
    return c != null && !!addOpening(w, 'door', c, width, doorH(size.h), 0, b.id, e.into)
  }
  let skippedDoors = 0
  for (const b of boxes) {
    const minDoors = CIRCULATION.has(b.type) ? 0 : 1
    const want = customMode ? minDoors : Math.max(minDoors, b.doors)
    const need = Math.max(0, want - doorOn(b).length)
    if (!need) continue
    // A room that already has an entrance (or any door) never needs another door that leads outside.
    const hasAnyDoor = openings.some((o) => o.kind === 'door' && o.roomId === b.id)
    interface Seg { e: Edge; lo: number; hi: number; score: number; neighbour?: RoomBox }
    const segs: Seg[] = []
    for (const e of roomEdges(b)) {
      if (openEdge.has(`${b.id}:${e.side}`)) continue
      if (e.boundary) { if (!hasAnyDoor) segs.push({ e, lo: e.lo, hi: e.hi, score: (e.hi - e.lo) * 0.05 }); continue }
      let shared = false
      for (const o of boxes) {
        if (o.id === b.id) continue
        const oe = roomEdges(o).find((x) => x.orient === e.orient && x.side !== e.side && Math.abs(x.line - e.line) <= 0.05)
        if (!oe) continue
        const lo = Math.max(e.lo, oe.lo), hi = Math.min(e.hi, oe.hi)
        if (hi - lo >= 0.7) { shared = true; segs.push({ e, lo, hi, score: 10 + (hi - lo) + (NEIGHBOUR_BONUS[o.type] ?? 0), neighbour: o }) }
      }
      if (!shared) segs.push({ e, lo: e.lo, hi: e.hi, score: (e.hi - e.lo) * 0.2 })
    }
    segs.sort((a, c) => c.score - a.score)
    for (let k = 0; k < need; k++) if (!segs.some((s) => tryDoor(b, s.e, s.lo, s.hi, s.neighbour))) skippedDoors++
  }

  // 4c'. connectivity repair: sharing doors among neighbours can leave a group of rooms (e.g. the passage) cut off.
  // Add doors, best connection first, until every room can be reached from the entrance / staircase.
  const roots = () => (fl === 1 ? [OUTSIDE] : boxes.filter((b) => b.type === 'staircase').map((b) => b.id))
  if (boxes.length > 1 && roots().length && (fl > 1 || openings.some((o) => o.entrance))) {
    for (let guard = 0; guard < boxes.length + 2; guard++) {
      const seen = reachable(boxes, openings, openEdge, roots())
      const lost = boxes.filter((b) => !seen.has(b.id))
      if (!lost.length) break
      const cands: { owner: RoomBox; e: Edge; lo: number; hi: number; score: number; nb: RoomBox }[] = []
      for (const a of lost) for (const e of roomEdges(a)) {
        if (e.boundary || openEdge.has(`${a.id}:${e.side}`)) continue
        for (const nb of boxes) {
          if (nb.id === a.id || !seen.has(nb.id)) continue
          const oe = roomEdges(nb).find((x) => x.orient === e.orient && x.side !== e.side && Math.abs(x.line - e.line) <= 0.05)
          if (!oe) continue
          const lo = Math.max(e.lo, oe.lo), hi = Math.min(e.hi, oe.hi)
          if (hi - lo >= 0.7) cands.push({ owner: a, e, lo, hi, nb, score: hi - lo + (NEIGHBOUR_BONUS[nb.type] ?? 0) + (CIRCULATION.has(nb.type) ? 4 : 0) })
        }
      }
      cands.sort((a, c) => c.score - a.score)
      if (!cands.some((c) => tryDoor(c.owner, c.e, c.lo, c.hi, c.nb))) break
    }
  }
  if (skippedDoors) issues.push({ severity: 'warning', code: 'door-not-placed', floor: fl, message: `Floor ${fl}: ${skippedDoors} door(s) could not be placed (no free wall space).` })

  // 4d. windows on exterior walls (automatic mode only: saved layouts keep exactly the user's windows) --------
  let skippedWindows = 0
  if (!customMode) for (const b of boxes) {
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
        const width = +Math.min(b.type === 'bathroom' ? 0.6 : 1.2, (seg / (cnt + 1)) * 0.8).toFixed(3)
        const c = width >= 0.5 ? findSlot(w, e.lo, e.hi, width, e.lo + (seg * (i + 1)) / (cnt + 1)) : null
        if (c == null || !addOpening(w, 'window', c, width, windowH, windowSill, b.id, e.into)) skippedWindows++
      }
    })
  }
  if (skippedWindows) issues.push({ severity: 'warning', code: 'window-not-placed', floor: fl, message: `Floor ${fl}: ${skippedWindows} window(s) could not be placed (room has no free exterior wall space).` })

  // 5. wall solids with real openings -----------------------------------------------------------------------
  for (const w of walls) {
    w.pieces = wallPieces(w)
    w.cutPieces = w.exterior ? [axisBox(w, w.a0, w.a1, 0, Math.min(CUT_H, H))].filter((x): x is Box => !!x) : w.pieces
  }

  // 6. connectivity ------------------------------------------------------------------------------------------
  validateAccess(boxes, openings, openEdge, fl, issues)

  // 7. furniture: saved arrangement per room (while the room is unchanged), otherwise automatic ---------------
  const furnitureItems: FurnitureItem[] = []
  const auto = opts.autoFurnish !== false
  for (const [i, b] of boxes.entries()) {
    const sig = roomSignature(rooms[i])
    const saved = layout?.furniture && layout.furniture.room_sigs[b.id] === sig
    let items: FurnitureItem[]
    if (saved) {
      items = []
      for (const s of layout!.furniture!.items.filter((x) => x.room_id === b.id)) {
        const it: FurnitureItem = { ...s, cx: s.cx - L / 2, cz: s.cz - W / 2 }
        const problem = placementProblem(it, b, openings, items)
        if (problem) issues.push({ severity: 'warning', code: 'furniture-invalid', floor: fl, roomId: b.id, message: `"${b.name}": ${it.type.replace(/_/g, ' ')} removed – ${problem}` })
        else items.push(it)
      }
      if (items.length && !circulationOk(b, items, openings)) issues.push({ severity: 'warning', code: 'furniture-blocking', floor: fl, roomId: b.id, message: `"${b.name}": furniture may block access to the doors. Move or remove an item.` })
    } else items = auto ? furnishRoom(b, openings, Number(layout?.settings.furnishSeed ?? 0)) : []
    furnitureItems.push(...items)
  }

  return {
    floor: {
      index: fl, y, slabY: y - T / 2, rooms: boxes, walls, openings, furnitureItems, schematic,
      furniture: furnitureItems.flatMap((it) => partsFor(it, y)),
    },
    overflow: boxes.some((b) => b.overflow),
  }
}

const OUTSIDE = '__outside__'

/** Room graph: doors link the owner room to the room on the other side (or to the outside); open circulation edges link too. */
function adjacency(boxes: RoomBox[], openings: Opening[], openEdge: Set<string>): { adj: Map<string, Set<string>>; voidDoors: { room: RoomBox }[] } {
  const adj = new Map<string, Set<string>>()
  const link = (a: string, b: string) => { adj.get(a)!.add(b); adj.get(b)!.add(a) }
  boxes.forEach((b) => adj.set(b.id, new Set()))
  adj.set(OUTSIDE, new Set())
  const voidDoors: { room: RoomBox }[] = []
  for (const o of openings) {
    if (o.kind !== 'door') continue
    const owner = boxes.find((b) => b.id === o.roomId)
    if (!owner) continue
    const probe = o.orientation === 'x' ? { x: o.center, z: o.line - o.into * 0.3 } : { x: o.line - o.into * 0.3, z: o.center } // just outside the owner
    const other = boxes.find((b) => b.id !== owner.id && probe.x > b.x0 && probe.x < b.x1 && probe.z > b.z0 && probe.z < b.z1)
    if (other) link(owner.id, other.id)
    else if (roomEdges(owner).some((e) => e.boundary && e.orient === o.orientation && Math.abs(e.line - o.line) <= 0.05)) link(owner.id, OUTSIDE)
    else voidDoors.push({ room: owner })
  }
  for (const b of boxes) for (const e of roomEdges(b)) if (openEdge.has(`${b.id}:${e.side}`)) {
    const o = boxes.find((x) => x.id !== b.id && CIRCULATION.has(x.type) && roomEdges(x).some((xe) => xe.orient === e.orient && xe.side !== e.side && Math.abs(xe.line - e.line) <= 0.05 && Math.abs(xe.lo - e.lo) <= 0.05 && Math.abs(xe.hi - e.hi) <= 0.05))
    if (o) link(b.id, o.id)
  }
  return { adj, voidDoors }
}

function reachable(boxes: RoomBox[], openings: Opening[], openEdge: Set<string>, roots: string[]): Set<string> {
  const { adj } = adjacency(boxes, openings, openEdge)
  const seen = new Set<string>(roots)
  const q = [...roots]
  while (q.length) for (const nb of adj.get(q.pop() as string) ?? []) if (!seen.has(nb)) { seen.add(nb); q.push(nb) }
  return seen
}

/** Every enclosed room must be reachable from the main entrance (upper floors: from the staircase). */
function validateAccess(boxes: RoomBox[], openings: Opening[], openEdge: Set<string>, fl: number, issues: Issue[]) {
  if (!boxes.length) return
  const { adj, voidDoors } = adjacency(boxes, openings, openEdge)
  for (const v of voidDoors) issues.push({ severity: 'warning', code: 'door-to-void', floor: fl, roomId: v.room.id, message: `Floor ${fl}: a door of "${v.room.name}" opens onto space that is not part of any room.` })
  for (const b of boxes) {
    if (!CIRCULATION.has(b.type) && !openings.some((o) => o.kind === 'door' && o.roomId === b.id) && !(adj.get(b.id)?.size)) {
      issues.push({ severity: 'error', code: 'no-door', floor: fl, roomId: b.id, message: `Floor ${fl}: "${b.name}" has no doorway.` })
    }
  }
  const starts: string[] = fl === 1 ? [OUTSIDE] : boxes.filter((b) => b.type === 'staircase').map((b) => b.id)
  if (fl === 1 && !(adj.get(OUTSIDE)?.size)) {
    if (!issues.some((i) => i.code === 'no-entrance' && i.floor === 1)) issues.push({ severity: 'error', code: 'no-entrance', floor: fl, message: 'The building has no main entrance connecting the outside to a room.' })
    return
  }
  if (fl > 1 && !starts.length) { issues.push({ severity: 'warning', code: 'no-stairs', floor: fl, message: `Floor ${fl} has no staircase, so its rooms cannot be reached from the entrance. Add a room of type "Staircase".` }); return }
  const seen = reachable(boxes, openings, openEdge, starts)
  for (const b of boxes) if (!seen.has(b.id) && !issues.some((i) => i.code === 'no-door' && i.roomId === b.id)) {
    issues.push({ severity: 'error', code: 'unreachable', floor: fl, roomId: b.id, message: `Floor ${fl}: "${b.name}" cannot be reached from ${fl === 1 ? 'the main entrance' : 'the staircase'} through doorways.` })
  }
}

export function buildModel(p: ProjectDetail | null | undefined, opts: BuildOptions = {}): Model3D {
  if (!p) return empty(['No project loaded.'])
  const errors = validateProject(p)
  if (errors.length) return empty(errors)

  const L = p.length, W = p.width, H = p.height, T = p.slab_thickness, WT = p.wall_thickness
  const issues: Issue[] = []
  const floors: FloorModel[] = []
  let anySchematic = false

  const validRooms = p.rooms.filter((r) => good(r.length) && good(r.width) && good(r.height) && r.floor_number >= 1 && r.floor_number <= p.floors)
  if (validRooms.length < p.rooms.length) issues.push({ severity: 'warning', code: 'rooms-skipped', message: `${p.rooms.length - validRooms.length} room(s) with invalid dimensions or floor were skipped.` })

  for (let fl = 1; fl <= p.floors; fl++) {
    const { floor } = buildFloor({ p, fl, rooms: validRooms.filter((r) => r.floor_number === fl), issues, opts })
    if (floor.schematic) anySchematic = true
    floors.push(floor)
  }
  if (anySchematic) issues.push({ severity: 'info', code: 'schematic', message: 'Some rooms have no stored position: they are arranged in a schematic layout (not the original floor plan).' })
  if (!validRooms.length) issues.push({ severity: 'info', code: 'no-rooms', message: 'No rooms yet. Generate a layout from the building details or add rooms.' })

  // resolved layout in building-local coordinates (what "Save layout" persists)
  const resolved = emptyResolved()
  for (const f of floors) {
    for (const o of f.openings) {
      const wall = f.walls.find((w) => w.id === o.wallId)
      resolved.openings.push({
        id: o.id, kind: o.kind, floor: f.index, orientation: o.orientation,
        line: o.orientation === 'x' ? o.line + W / 2 : o.line + L / 2, center: o.orientation === 'x' ? o.center + L / 2 : o.center + W / 2,
        width: o.width, height: o.height, sill: o.sill, room_id: o.roomId, into: o.into, entrance: o.entrance,
      })
      if (o.kind === 'door') resolved.summary.doors.push({ w: +o.width.toFixed(3), h: +o.height.toFixed(3), exterior: !!wall?.exterior })
      else resolved.summary.windows.push({ w: +o.width.toFixed(3), h: +o.height.toFixed(3) })
    }
    for (const it of f.furnitureItems) resolved.furniture.push({ ...it, cx: it.cx + L / 2, cz: it.cz + W / 2 })
  }
  for (const r of validRooms) resolved.roomSigs[r.id] = roomSignature(r)

  const totalHeight = (p.floors - 1) * (H + T) + H
  const ridge: 'x' | 'z' = L >= W ? 'x' : 'z'
  return {
    ok: true, errors: [], issues, notes: issues.map((i) => i.message), length: L, width: W, height: H, slab: T, wallT: WT, floors, totalHeight, roofY: totalHeight + T / 2,
    schematic: anySchematic, labelSize: Math.min(2, Math.max(0.45, Math.max(L, W) * 0.05)),
    roof: { ridge, height: Math.min(L, W) * 0.2, overhang: 0.35 }, resolved,
  }
}
