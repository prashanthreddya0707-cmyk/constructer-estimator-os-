import { describe, expect, it } from 'vitest'
import type { ProjectDetail, Room } from '@/types'
import { buildModel, schematicLayout, validateProject, type Box, type FloorModel } from './model'

const room = (o: Partial<Room>): Room => ({
  id: 'r' + Math.random().toString(36).slice(2), project_id: 'p', name: 'R', room_type: 'bedroom', length: 4, width: 3, height: 3,
  floor_number: 1, wall_thickness: null, doors: 1, windows: 1, area_override: null, pos_x: null, pos_y: null, area: 12, ...o,
})
const project = (o: Partial<ProjectDetail> = {}): ProjectDetail => ({
  id: 'p', name: 'P', description: '', owner_name: '', building_type: 'residential', location: '', floors: 2, currency: 'INR', budget: null,
  length: 10, width: 8, height: 3, wall_thickness: 0.23, slab_thickness: 0.15, built_up_area: null, is_demo: false, created_at: '', updated_at: '',
  assumptions: {}, wastage: {}, material_selections: {}, extra_costs: {}, purchase_quantities: {}, room_count: 0, floor_area: 80,
  total_built_up_area: 160, latest_total_cost: null, has_estimate: false, rooms: [], floorplans: [], ...o,
})

/** A realistic, fully tiled 10 × 8 m floor: living + kitchen on top, two bedrooms and a bathroom below. */
const plan = (): Room[] => [
  room({ id: 'liv', name: 'Living', room_type: 'living', length: 6, width: 4, pos_x: 0, pos_y: 0, doors: 1, windows: 2, area: 24 }),
  room({ id: 'kit', name: 'Kitchen', room_type: 'kitchen', length: 4, width: 4, pos_x: 6, pos_y: 0, doors: 1, windows: 1, area: 16 }),
  room({ id: 'bed', name: 'Bedroom', room_type: 'bedroom', length: 4, width: 4, pos_x: 0, pos_y: 4, doors: 1, windows: 2, area: 16 }),
  room({ id: 'bth', name: 'Bath', room_type: 'bathroom', length: 2.5, width: 4, pos_x: 4, pos_y: 4, doors: 1, windows: 0, area: 10 }),
  room({ id: 'bd2', name: 'Bedroom 2', room_type: 'bedroom', length: 3.5, width: 4, pos_x: 6.5, pos_y: 4, doors: 1, windows: 1, area: 14 }),
]

const overlapVolume = (a: Box, b: Box) => {
  const ox = Math.min(a.cx + a.sx / 2, b.cx + b.sx / 2) - Math.max(a.cx - a.sx / 2, b.cx - b.sx / 2)
  const oy = Math.min(a.cy + a.sy / 2, b.cy + b.sy / 2) - Math.max(a.cy - a.sy / 2, b.cy - b.sy / 2)
  const oz = Math.min(a.cz + a.sz / 2, b.cz + b.sz / 2) - Math.max(a.cz - a.sz / 2, b.cz - b.sz / 2)
  return ox > 1e-6 && oy > 1e-6 && oz > 1e-6 ? ox * oy * oz : 0
}
const wallBoxes = (f: FloorModel) => f.walls.flatMap((w) => w.pieces)

describe('buildModel: validation', () => {
  it('returns errors instead of throwing for invalid dimensions', () => {
    for (const bad of [{ length: 0 }, { width: -1 }, { height: NaN }, { floors: 0 }, { slab_thickness: 0 }]) {
      const m = buildModel(project(bad))
      expect(m.ok).toBe(false)
      expect(m.errors.length).toBeGreaterThan(0)
    }
    expect(buildModel(null).ok).toBe(false)
  })
  it('accepts valid input', () => expect(validateProject(project())).toEqual([]))
})

describe('2D plan -> 3D accuracy', () => {
  const m = buildModel(project({ floors: 1, rooms: plan() }))
  const f = m.floors[0]

  it('uses exactly the saved room positions and sizes', () => {
    expect(m.schematic).toBe(false)
    for (const r of plan()) {
      const b = f.rooms.find((x) => x.id === r.id)!
      expect(b.x1 - b.x0).toBeCloseTo(r.length, 6)
      expect(b.z1 - b.z0).toBeCloseTo(r.width, 6)
      expect(b.x0).toBeCloseTo((r.pos_x as number) - 5, 6) // footprint is centred on the origin
      expect(b.z0).toBeCloseTo((r.pos_y as number) - 4, 6)
    }
  })

  it('builds the exterior shell on the building boundary and nothing hardcoded', () => {
    const ext = f.walls.filter((w) => w.exterior)
    expect(ext.map((w) => w.side).sort()).toEqual(['E', 'N', 'S', 'W'])
    const north = ext.find((w) => w.side === 'N')!
    expect(north.line).toBeCloseTo(-4)
    expect(north.ra0).toBeCloseTo(-5)
    expect(north.ra1).toBeCloseTo(5)
  })

  it('creates one shared partition per internal wall (no duplicates)', () => {
    const interior = f.walls.filter((w) => !w.exterior)
    const keys = interior.map((w) => `${w.orientation}:${w.line.toFixed(2)}:${w.ra0.toFixed(2)}:${w.ra1.toFixed(2)}`)
    expect(new Set(keys).size).toBe(keys.length)
    // horizontal partition at z=0 spans the whole width of the building (living|kitchen above, bedrooms below)
    const mid = interior.find((w) => w.orientation === 'x' && Math.abs(w.line) < 0.01)!
    expect(mid.ra0).toBeCloseTo(-5)
    expect(mid.ra1).toBeCloseTo(5)
  })

  it('never produces overlapping wall solids', () => {
    for (const cut of [false, true]) {
      const boxes = f.walls.flatMap((w) => (cut ? w.cutPieces : w.pieces))
      let worst = 0
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) worst = Math.max(worst, overlapVolume(boxes[i], boxes[j]))
      expect(worst).toBeLessThan(1e-6)
    }
  })

  it('fits walls inside the building footprint plus half the exterior wall thickness', () => {
    const lim = 5 + 0.23 / 2 + 1e-6, limz = 4 + 0.23 / 2 + 1e-6
    for (const b of wallBoxes(f)) {
      expect(Math.abs(b.cx) + b.sx / 2).toBeLessThanOrEqual(lim)
      expect(Math.abs(b.cz) + b.sz / 2).toBeLessThanOrEqual(limz)
    }
  })

  it('cuts real openings: wall height is missing where doors/windows are', () => {
    expect(f.openings.length).toBeGreaterThan(0)
    for (const o of f.openings) {
      const w = f.walls.find((x) => x.id === o.wallId)!
      // opening lies inside the built wall span
      expect(o.center - o.width / 2).toBeGreaterThanOrEqual(w.a0 - 1e-6)
      expect(o.center + o.width / 2).toBeLessThanOrEqual(w.a1 + 1e-6)
      // no solid wall volume inside the opening's void
      const mid = (o.sill + o.height / 2)
      const probe: Box = o.orientation === 'x'
        ? { cx: o.center, cy: w.y + mid, cz: o.line, sx: o.width - 0.02, sy: o.height - 0.02, sz: w.t }
        : { cx: o.line, cy: w.y + mid, cz: o.center, sx: w.t, sy: o.height - 0.02, sz: o.width - 0.02 }
      for (const b of w.pieces) expect(overlapVolume(probe, b)).toBeLessThan(1e-9)
    }
  })

  it('places windows on exterior walls only and doors so they connect rooms', () => {
    for (const o of f.openings) {
      const w = f.walls.find((x) => x.id === o.wallId)!
      if (o.kind === 'window') expect(w.exterior).toBe(true)
    }
    const shared = f.openings.filter((o) => o.kind === 'door' && !f.walls.find((x) => x.id === o.wallId)!.exterior)
    expect(shared.length).toBeGreaterThanOrEqual(4)
    // openings on one wall never overlap each other
    for (const w of f.walls) {
      const s = [...w.openings].sort((a, b) => a.center - b.center)
      for (let i = 1; i < s.length; i++) expect(s[i].center - s[i].width / 2).toBeGreaterThan(s[i - 1].center + s[i - 1].width / 2)
    }
  })

  it('keeps openings clear of perpendicular walls', () => {
    for (const w of f.walls) for (const o of w.openings) {
      for (const [b0, b1] of w.blocked) expect(o.center + o.width / 2 <= b0 + 1e-6 || o.center - o.width / 2 >= b1 - 1e-6).toBe(true)
    }
  })
})

describe('furniture is decorative and never blocks anything', () => {
  const m = buildModel(project({ floors: 1, rooms: plan() }))
  const f = m.floors[0]

  it('exists for typical rooms and stays inside its own room', () => {
    expect(f.furniture.length).toBeGreaterThan(10)
    for (const p of f.furniture) {
      const r = f.rooms.find((x) => x.id === p.roomId)!
      expect(p.cx - p.sx / 2).toBeGreaterThanOrEqual(r.x0 - 1e-6)
      expect(p.cx + p.sx / 2).toBeLessThanOrEqual(r.x1 + 1e-6)
      expect(p.cz - p.sz / 2).toBeGreaterThanOrEqual(r.z0 - 1e-6)
      expect(p.cz + p.sz / 2).toBeLessThanOrEqual(r.z1 + 1e-6)
    }
  })

  it('never intersects walls or door openings', () => {
    const walls = wallBoxes(f)
    for (const p of f.furniture) {
      for (const w of walls) expect(overlapVolume(p, w)).toBeLessThan(1e-9)
      for (const o of f.openings.filter((x) => x.kind === 'door')) {
        const zone: Box = o.orientation === 'x'
          ? { cx: o.center, cy: p.cy, cz: o.line, sx: o.width, sy: 1, sz: 0.8 + o.thickness }
          : { cx: o.line, cy: p.cy, cz: o.center, sx: 0.8 + o.thickness, sy: 1, sz: o.width }
        expect(overlapVolume({ ...p, sy: 1 }, zone)).toBeLessThan(1e-9)
      }
    }
  })

  it('does not change plan geometry when furniture is present', () => {
    const none = buildModel(project({ floors: 1, rooms: plan().map((r) => ({ ...r, room_type: 'corridor' })) }))
    expect(none.floors[0].furniture).toHaveLength(0)
    expect(none.floors[0].walls.length).toBe(f.walls.length)
  })
})

describe('updates follow the data', () => {
  it('moving / resizing / deleting / adding a room changes the model accordingly', () => {
    const base = buildModel(project({ floors: 1, rooms: plan() })).floors[0]
    const resized = plan().map((r) => (r.id === 'kit' ? { ...r, length: 3, width: 3.5 } : r))
    const b = buildModel(project({ floors: 1, rooms: resized })).floors[0].rooms.find((r) => r.id === 'kit')!
    expect(b.x1 - b.x0).toBeCloseTo(3)
    expect(b.z1 - b.z0).toBeCloseTo(3.5)
    const removed = buildModel(project({ floors: 1, rooms: plan().filter((r) => r.id !== 'bth') })).floors[0]
    expect(removed.rooms).toHaveLength(4)
    expect(removed.rooms.some((r) => r.id === 'bth')).toBe(false)
    expect(removed.furniture.some((p) => p.roomId === 'bth')).toBe(false)
    expect(base.furniture.some((p) => p.roomId === 'bth')).toBe(true)
    const added = buildModel(project({ floors: 1, rooms: [...plan(), room({ id: 'x', length: 1.5, width: 1.5, pos_x: 8.5, pos_y: 0 })] })).floors[0]
    expect(added.rooms).toHaveLength(6)
  })

  it('follows building dimensions, floor height, wall thickness and floor count', () => {
    const m = buildModel(project({ floors: 3, length: 12, width: 9, height: 3.2, wall_thickness: 0.3, rooms: [] }))
    expect(m.floors).toHaveLength(3)
    expect(m.floors[2].y).toBeCloseTo(2 * (3.2 + 0.15))
    expect(m.totalHeight).toBeCloseTo(2 * 3.35 + 3.2)
    const north = m.floors[0].walls.find((w) => w.side === 'N')!
    expect(north.t).toBeCloseTo(0.3)
    expect(north.line).toBeCloseTo(-4.5)
  })

  it('respects per-room wall thickness on partitions', () => {
    const rooms = [room({ id: 'a', length: 5, width: 8, pos_x: 0, pos_y: 0, wall_thickness: 0.2 }), room({ id: 'b', length: 5, width: 8, pos_x: 5, pos_y: 0, wall_thickness: 0.115 })]
    const m = buildModel(project({ floors: 1, rooms })).floors[0]
    const part = m.walls.find((w) => !w.exterior && w.orientation === 'z')!
    expect(part.t).toBeCloseTo(0.2) // thicker wall wins on a shared edge
  })
})

describe('layout handling', () => {
  it('flags schematic layouts when positions are missing and packs rooms in rows', () => {
    const rooms = [room({ id: 'a', length: 6, width: 4 }), room({ id: 'b', length: 6, width: 3 }), room({ id: 'c', length: 3, width: 3 })]
    const m = buildModel(project({ floors: 1, rooms }))
    expect(m.schematic).toBe(true)
    const pos = schematicLayout(rooms, 10)
    expect(pos.get('a')).toEqual({ x: 0, z: 0 })
    expect(pos.get('b')).toEqual({ x: 0, z: 4 })
    expect(pos.get('c')).toEqual({ x: 6, z: 4 })
  })

  it('skips rooms with invalid data and reports a note', () => {
    const m = buildModel(project({ floors: 1, rooms: [room({ length: 0 }), room({})] }))
    expect(m.ok).toBe(true)
    expect(m.floors[0].rooms).toHaveLength(1)
    expect(m.notes.some((n) => n.includes('skipped'))).toBe(true)
  })

  it('reports windows that cannot be placed instead of faking them', () => {
    const rooms = [room({ id: 'in', length: 4, width: 4, pos_x: 3, pos_y: 2, windows: 2, doors: 0 })] // interior room, no exterior wall
    const m = buildModel(project({ floors: 1, rooms }))
    expect(m.floors[0].openings.filter((o) => o.kind === 'window')).toHaveLength(0)
    expect(m.notes.some((n) => n.includes('window'))).toBe(true)
  })

  it('works for a different, non-rectangular-grid plan (not hardcoded)', () => {
    const rooms = [
      room({ id: 'a', length: 7, width: 3, pos_x: 0, pos_y: 0, doors: 1, windows: 2 }),
      room({ id: 'b', length: 3, width: 5, pos_x: 0, pos_y: 3, doors: 1, windows: 1 }),
      room({ id: 'c', length: 4, width: 5, pos_x: 3, pos_y: 3, doors: 2, windows: 1 }),
      room({ id: 'd', length: 3, width: 8, pos_x: 7, pos_y: 0, doors: 1, windows: 2 }),
    ]
    const f = buildModel(project({ floors: 1, rooms })).floors[0]
    let worst = 0
    const boxes = wallBoxes(f)
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) worst = Math.max(worst, overlapVolume(boxes[i], boxes[j]))
    expect(worst).toBeLessThan(1e-6)
    expect(f.openings.length).toBeGreaterThanOrEqual(6)
  })
})
