import { describe, expect, it } from 'vitest'
import type { ProjectDetail, Room } from '@/types'
import { buildModel, schematicLayout, validateProject } from './model'

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

describe('buildModel', () => {
  it('returns errors instead of throwing for invalid dimensions', () => {
    for (const bad of [{ length: 0 }, { width: -1 }, { height: NaN }, { floors: 0 }, { slab_thickness: 0 }]) {
      const m = buildModel(project(bad))
      expect(m.ok).toBe(false)
      expect(m.errors.length).toBeGreaterThan(0)
    }
    expect(buildModel(null).ok).toBe(false)
  })

  it('creates one floor model per floor with correct heights (1 unit = 1 m)', () => {
    const m = buildModel(project())
    expect(m.ok).toBe(true)
    expect(m.floors).toHaveLength(2)
    expect(m.floors[1].y).toBeCloseTo(3.15)
    expect(m.totalHeight).toBeCloseTo(6.15)
  })

  it('always builds four exterior walls and no interior walls without rooms', () => {
    const f = buildModel(project({ floors: 1 })).floors[0]
    expect(f.walls.filter((w) => w.exterior)).toHaveLength(4)
    expect(f.walls.filter((w) => !w.exterior)).toHaveLength(0)
  })

  it('shares a partition between two adjacent rooms exactly once', () => {
    const a = room({ id: 'a', length: 5, width: 8, pos_x: 0, pos_y: 0 })
    const b = room({ id: 'b', length: 5, width: 8, pos_x: 5, pos_y: 0 })
    const m = buildModel(project({ floors: 1, rooms: [a, b] }))
    const interior = m.floors[0].walls.filter((w) => !w.exterior)
    expect(interior).toHaveLength(1)
    expect(m.schematic).toBe(false)
  })

  it('flags schematic layouts when positions are missing and packs rooms in rows', () => {
    const rooms = [room({ id: 'a', length: 6, width: 4 }), room({ id: 'b', length: 6, width: 3 }), room({ id: 'c', length: 3, width: 3 })]
    const m = buildModel(project({ floors: 1, rooms }))
    expect(m.schematic).toBe(true)
    const pos = schematicLayout(rooms, 10)
    expect(pos.get('a')).toEqual({ x: 0, z: 0 })
    expect(pos.get('b')).toEqual({ x: 0, z: 4 }) // 6 + 6 > 10 -> wraps to next row
    expect(pos.get('c')).toEqual({ x: 6, z: 4 })
  })

  it('skips rooms with invalid data and reports a note', () => {
    const m = buildModel(project({ floors: 1, rooms: [room({ length: 0 }), room({})] }))
    expect(m.ok).toBe(true)
    expect(m.floors[0].rooms).toHaveLength(1)
    expect(m.notes.some((n) => n.includes('skipped'))).toBe(true)
  })

  it('centres the footprint on the origin', () => {
    const f = buildModel(project({ floors: 1, rooms: [room({ length: 10, width: 8, pos_x: 0, pos_y: 0 })] })).floors[0]
    expect(f.rooms[0].cx).toBeCloseTo(0)
    expect(f.rooms[0].cz).toBeCloseTo(0)
  })

  it('places windows on exterior and doors on interior walls', () => {
    const a = room({ id: 'a', length: 5, width: 8, pos_x: 0, pos_y: 0, windows: 2, doors: 1 })
    const b = room({ id: 'b', length: 5, width: 8, pos_x: 5, pos_y: 0, windows: 0, doors: 0 })
    const f = buildModel(project({ floors: 1, rooms: [a, b] })).floors[0]
    expect(f.openings.filter((o) => o.kind === 'window')).toHaveLength(2)
    expect(f.openings.filter((o) => o.kind === 'door')).toHaveLength(1)
  })
})

describe('validateProject', () => {
  it('accepts valid input', () => expect(validateProject(project())).toEqual([]))
})
