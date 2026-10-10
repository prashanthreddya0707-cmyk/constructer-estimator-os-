/**
 * 2D plan shapes, derived from exactly the same FloorModel as the 3D view (walls, openings, rooms, furniture).
 * Nothing here is stored or computed separately, so the plan and the 3D model cannot contradict each other.
 * Plan coordinates = world X / Z in metres; the SVG maps X -> x and Z -> y (north is up).
 */
import { itemRect } from './furniture'
import type { FloorModel, Model3D, Opening, RoomBox } from './model'

export interface PRect { x: number; y: number; w: number; h: number }
export interface PlanWall extends PRect { wallId: string; exterior: boolean }
export interface PlanDoor { id: string; opening: Opening; hinge: [number, number]; closedEnd: [number, number]; openEnd: [number, number]; radius: number; arc: string; entrance: boolean; sweepOpen: boolean }
export interface PlanWindow { id: string; opening: Opening; rect: PRect; glass: [number, number, number, number][] }
export interface PlanRoom { id: string; name: string; type: string; rect: PRect; area: number; dims: string; box: RoomBox }
export interface PlanFurniture { id: string; type: string; roomId: string; rect: PRect; facing: string }
export interface PlanShapes {
  /** drawing extent including margins for dimension lines */
  view: PRect
  footprint: PRect
  rooms: PlanRoom[]
  walls: PlanWall[]
  doors: PlanDoor[]
  windows: PlanWindow[]
  furniture: PlanFurniture[]
  fontSize: number
}

const rect = (x0: number, z0: number, x1: number, z1: number): PRect => ({ x: Math.min(x0, x1), y: Math.min(z0, z1), w: Math.abs(x1 - x0), h: Math.abs(z1 - z0) })

/** Wall footprint split around its openings, so doors and windows show as real gaps in the plan. */
function wallRects(f: FloorModel): PlanWall[] {
  const out: PlanWall[] = []
  for (const w of f.walls) {
    const spans: [number, number][] = []
    let cursor = w.a0
    for (const o of [...w.openings].sort((a, b) => a.center - b.center)) {
      const s = o.center - o.width / 2, e = o.center + o.width / 2
      if (s > cursor + 1e-6) spans.push([cursor, s])
      cursor = e
    }
    if (w.a1 > cursor + 1e-6) spans.push([cursor, w.a1])
    for (const [a, b] of spans) {
      out.push({ wallId: w.id, exterior: w.exterior, ...(w.orientation === 'x' ? rect(a, w.line - w.t / 2, b, w.line + w.t / 2) : rect(w.line - w.t / 2, a, w.line + w.t / 2, b)) })
    }
  }
  return out
}

function doorShape(o: Opening): PlanDoor {
  const lo = o.center - o.width / 2, hi = o.center + o.width / 2
  // hinge at the low end; the leaf swings into the owning room
  const pt = (along: number, across: number): [number, number] => (o.orientation === 'x' ? [along, across] : [across, along])
  const hinge = pt(lo, o.line)
  const closedEnd = pt(hi, o.line)
  const openEnd = pt(lo, o.line + o.into * o.width)
  const cross = (closedEnd[0] - hinge[0]) * (openEnd[1] - hinge[1]) - (closedEnd[1] - hinge[1]) * (openEnd[0] - hinge[0])
  const sweep = cross > 0 ? 1 : 0
  return {
    id: o.id, opening: o, hinge, closedEnd, openEnd, radius: o.width, entrance: o.entrance, sweepOpen: true,
    arc: `M ${closedEnd[0]} ${closedEnd[1]} A ${o.width} ${o.width} 0 0 ${sweep} ${openEnd[0]} ${openEnd[1]}`,
  }
}

export function buildPlanShapes(floor: FloorModel, model: Model3D): PlanShapes {
  const L = model.length, W = model.width
  const fontSize = Math.min(0.5, Math.max(0.22, Math.max(L, W) * 0.028))
  const margin = fontSize * 7
  const rooms: PlanRoom[] = floor.rooms.map((b) => ({
    id: b.id, name: b.name, type: b.type, rect: rect(b.x0, b.z0, b.x1, b.z1), area: b.area, dims: `${b.sx.toFixed(2)} × ${b.sz.toFixed(2)} m`, box: b,
  }))
  const doors: PlanDoor[] = [], windows: PlanWindow[] = []
  for (const o of floor.openings) {
    if (o.kind === 'door') doors.push(doorShape(o))
    else {
      const lo = o.center - o.width / 2, hi = o.center + o.width / 2, t = o.thickness
      const r = o.orientation === 'x' ? rect(lo, o.line - t / 2, hi, o.line + t / 2) : rect(o.line - t / 2, lo, o.line + t / 2, hi)
      const lines: [number, number, number, number][] = o.orientation === 'x'
        ? [[lo, o.line - t / 4, hi, o.line - t / 4], [lo, o.line + t / 4, hi, o.line + t / 4]]
        : [[o.line - t / 4, lo, o.line - t / 4, hi], [o.line + t / 4, lo, o.line + t / 4, hi]]
      windows.push({ id: o.id, opening: o, rect: r, glass: lines })
    }
  }
  const furniture: PlanFurniture[] = floor.furnitureItems.map((it) => {
    const r = itemRect(it)
    return { id: it.id, type: it.type, roomId: it.room_id, rect: rect(r.x0, r.z0, r.x1, r.z1), facing: it.facing }
  })
  return {
    view: { x: -L / 2 - margin, y: -W / 2 - margin, w: L + 2 * margin, h: W + 2 * margin },
    footprint: { x: -L / 2, y: -W / 2, w: L, h: W },
    rooms, walls: wallRects(floor), doors, windows, furniture, fontSize,
  }
}
