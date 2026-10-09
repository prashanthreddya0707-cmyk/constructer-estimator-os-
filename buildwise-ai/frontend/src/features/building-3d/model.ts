/**
 * Converts saved project + room data into renderable 3D geometry.
 *
 * Coordinate system: 1 Three.js world unit = 1 metre. X = building length, Z = building width, Y = up.
 * The footprint is centred on the origin: x ∈ [-L/2, L/2], z ∈ [-W/2, W/2]; the ground-floor slab top is y = 0.
 * Room positions (pos_x, pos_y) are measured in metres from the footprint's top-left corner.
 * Rooms without a stored position are placed by a *schematic* shelf-packing layout - it is NOT a
 * reconstruction of the original floor plan and the UI labels it as such.
 */
import type { ProjectDetail, Room } from '@/types'

export interface RoomBox {
  id: string
  name: string
  type: string
  floor: number
  /** world-space centre */
  cx: number
  cz: number
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
}
export interface WallSeg { x1: number; z1: number; x2: number; z2: number; t: number; h: number; y: number; exterior: boolean }
export interface Opening { kind: 'door' | 'window'; x: number; z: number; alongX: boolean; w: number; h: number; y: number; t: number }
export interface FloorModel { index: number; y: number; slabY: number; rooms: RoomBox[]; walls: WallSeg[]; openings: Opening[]; schematic: boolean }
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
}

const EPS = 1e-6
const INT_WALL_DEFAULT = 0.115
const good = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0

const empty = (errors: string[]): Model3D => ({
  ok: false, errors, notes: [], length: 0, width: 0, height: 0, slab: 0, wallT: 0, floors: [], totalHeight: 0, roofY: 0, schematic: false, labelSize: 0.5,
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

function segKey(x1: number, z1: number, x2: number, z2: number): string {
  const r = (n: number) => Math.round(n * 100) / 100
  const a = [r(x1), r(z1)], b = [r(x2), r(z2)]
  const [p, q] = a[0] < b[0] || (a[0] === b[0] && a[1] <= b[1]) ? [a, b] : [b, a]
  return `${p[0]},${p[1]}|${q[0]},${q[1]}`
}

export function buildModel(p: ProjectDetail | null | undefined): Model3D {
  if (!p) return empty(['No project loaded.'])
  const errors = validateProject(p)
  if (errors.length) return empty(errors)

  const L = p.length, W = p.width, H = p.height, T = p.slab_thickness, WT = p.wall_thickness
  const notes: string[] = []
  const floors: FloorModel[] = []
  let anySchematic = false

  const validRooms = p.rooms.filter((r) => good(r.length) && good(r.width) && good(r.height) && r.floor_number >= 1 && r.floor_number <= p.floors)
  if (validRooms.length < p.rooms.length) notes.push(`${p.rooms.length - validRooms.length} room(s) with invalid dimensions or floor were skipped.`)

  for (let fl = 1; fl <= p.floors; fl++) {
    const y = (fl - 1) * (H + T)
    const rooms = validRooms.filter((r) => r.floor_number === fl)
    const allPositioned = rooms.length > 0 && rooms.every((r) => r.pos_x != null && r.pos_y != null)
    const packed = allPositioned ? null : schematicLayout(rooms, L)
    const schematic = rooms.length > 0 && !allPositioned
    if (schematic) anySchematic = true

    const boxes: RoomBox[] = rooms.map((r) => {
      const pos = allPositioned ? { x: r.pos_x as number, z: r.pos_y as number } : packed!.get(r.id)!
      const overflow = pos.x + r.length > L + 0.01 || pos.z + r.width > W + 0.01
      return {
        id: r.id, name: r.name, type: r.room_type, floor: fl, cx: pos.x + r.length / 2 - L / 2, cz: pos.z + r.width / 2 - W / 2,
        sx: r.length, sz: r.width, h: Math.min(r.height, H), y, doors: r.doors, windows: r.windows, area: r.area,
        schematic, overflow, lx: pos.x, lz: pos.z,
      }
    })

    // Exterior walls (centred on the footprint boundary)
    const walls: WallSeg[] = [
      { x1: -L / 2, z1: -W / 2, x2: L / 2, z2: -W / 2, t: WT, h: H, y, exterior: true },
      { x1: -L / 2, z1: W / 2, x2: L / 2, z2: W / 2, t: WT, h: H, y, exterior: true },
      { x1: -L / 2, z1: -W / 2, x2: -L / 2, z2: W / 2, t: WT, h: H, y, exterior: true },
      { x1: L / 2, z1: -W / 2, x2: L / 2, z2: W / 2, t: WT, h: H, y, exterior: true },
    ]
    // Interior partitions: room edges, shared edges drawn once, boundary edges skipped
    const seen = new Set<string>()
    const onBoundary = (x1: number, z1: number, z2: number) => {
      const horiz = Math.abs(z1 - z2) < EPS
      if (horiz) return Math.abs(z1 + W / 2) < 0.05 || Math.abs(z1 - W / 2) < 0.05
      return Math.abs(x1 + L / 2) < 0.05 || Math.abs(x1 - L / 2) < 0.05
    }
    const roomEdges = new Map<string, { x1: number; z1: number; x2: number; z2: number; ext: boolean }[]>()
    boxes.forEach((b, i) => {
      const x0 = b.cx - b.sx / 2, x1 = b.cx + b.sx / 2, z0 = b.cz - b.sz / 2, z1 = b.cz + b.sz / 2
      const edges = [[x0, z0, x1, z0], [x0, z1, x1, z1], [x0, z0, x0, z1], [x1, z0, x1, z1]]
      const list = edges.map(([a, bb, c, d]) => ({ x1: a, z1: bb, x2: c, z2: d, ext: onBoundary(a, bb, d) }))
      roomEdges.set(b.id, list)
      const thick = rooms[i].wall_thickness ?? INT_WALL_DEFAULT
      for (const e of list) {
        if (e.ext) continue
        const k = segKey(e.x1, e.z1, e.x2, e.z2)
        if (seen.has(k)) continue
        seen.add(k)
        walls.push({ ...e, t: thick, h: H, y, exterior: false })
      }
    })

    // Doors (interior edges first) and windows (exterior edges) - markers over the walls
    const openings: Opening[] = []
    for (const b of boxes) {
      const edges = roomEdges.get(b.id) ?? []
      const ext = edges.filter((e) => e.ext)
      const inn = edges.filter((e) => !e.ext)
      const place = (kind: 'door' | 'window', count: number, pool: typeof edges) => {
        if (!count || !pool.length) return
        const perEdge: number[] = pool.map(() => 0)
        for (let i = 0; i < count; i++) perEdge[i % pool.length]++
        pool.forEach((e, ei) => {
          const k = perEdge[ei]
          const alongX = Math.abs(e.z1 - e.z2) < EPS
          const len = alongX ? Math.abs(e.x2 - e.x1) : Math.abs(e.z2 - e.z1)
          const w = kind === 'door' ? Math.min(0.9, len * 0.8) : Math.min(1.2, (len / (k + 1)) * 0.8)
          for (let i = 0; i < k; i++) {
            const f = (i + 1) / (k + 1)
            const x = e.x1 + (e.x2 - e.x1) * f, z = e.z1 + (e.z2 - e.z1) * f
            openings.push({ kind, x, z, alongX, w, h: kind === 'door' ? Math.min(2.1, H * 0.85) : Math.min(1.2, H * 0.4), y: y + (kind === 'door' ? 0 : Math.min(0.9, H * 0.3)), t: kind === 'door' ? INT_WALL_DEFAULT + 0.04 : WT + 0.04 })
          }
        })
      }
      place('window', b.windows, ext)
      place('door', b.doors, inn.length ? inn : edges)
    }

    floors.push({ index: fl, y, slabY: y - T / 2, rooms: boxes, walls, openings, schematic })
  }

  if (anySchematic) notes.push('Some rooms have no stored position: they are arranged in a schematic layout (not the original floor plan).')
  if (floors.some((f) => f.rooms.some((r) => r.overflow))) notes.push('Some rooms extend beyond the building footprint. Check room sizes or building dimensions.')
  const totalHeight = (p.floors - 1) * (H + T) + H
  return { ok: true, errors: [], notes, length: L, width: W, height: H, slab: T, wallT: WT, floors, totalHeight, roofY: totalHeight + T / 2, schematic: anySchematic, labelSize: Math.min(2, Math.max(0.45, Math.max(L, W) * 0.06)) }
}
