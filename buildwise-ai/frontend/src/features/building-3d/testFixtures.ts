import type { ProjectDetail, Room } from '@/types'
import { generateLayout, DEFAULT_CONFIG, type GeneratorConfig } from './layoutGenerator'

export const room = (o: Partial<Room>): Room => ({
  id: 'r' + Math.random().toString(36).slice(2, 8), project_id: 'p', name: 'R', room_type: 'bedroom', length: 4, width: 3, height: 3,
  floor_number: 1, wall_thickness: null, doors: 1, windows: 1, area_override: null, pos_x: null, pos_y: null, area: 12, ...o,
})

export const project = (o: Partial<ProjectDetail> = {}): ProjectDetail => ({
  id: 'p', name: 'P', description: '', owner_name: '', building_type: 'residential', location: '', floors: 1, currency: 'INR', budget: null,
  length: 10, width: 8, height: 3, wall_thickness: 0.23, slab_thickness: 0.15, built_up_area: null, is_demo: false, created_at: '', updated_at: '',
  assumptions: {}, wastage: {}, material_selections: {}, extra_costs: {}, purchase_quantities: {}, layout: null, room_count: 0, floor_area: 80,
  total_built_up_area: 80, latest_total_cost: null, has_estimate: false, rooms: [], floorplans: [], ...o,
})

/** Project built from the procedural generator (ids are stable: r0, r1, ...). */
export function generatedProject(cfg: Partial<GeneratorConfig> = {}, over: Partial<ProjectDetail> = {}) {
  const c = { ...DEFAULT_CONFIG, ...cfg, counts: { ...DEFAULT_CONFIG.counts, ...(cfg.counts ?? {}) } }
  const g = generateLayout(c)
  const rooms: Room[] = g.rooms.map((r, i) => ({ ...r, id: `r${i}`, project_id: 'p', area: r.length * r.width }))
  const p = project({ length: c.length, width: c.width, floors: c.floors, height: c.wallHeight, wall_thickness: c.wallThickness, rooms, ...over })
  return { p, g, rooms }
}

export interface B3 { cx: number; cy: number; cz: number; sx: number; sy: number; sz: number }
export const overlapVolume = (a: B3, b: B3) => {
  const ox = Math.min(a.cx + a.sx / 2, b.cx + b.sx / 2) - Math.max(a.cx - a.sx / 2, b.cx - b.sx / 2)
  const oy = Math.min(a.cy + a.sy / 2, b.cy + b.sy / 2) - Math.max(a.cy - a.sy / 2, b.cy - b.sy / 2)
  const oz = Math.min(a.cz + a.sz / 2, b.cz + b.sz / 2) - Math.max(a.cz - a.sz / 2, b.cz - b.sz / 2)
  return ox > 1e-6 && oy > 1e-6 && oz > 1e-6 ? ox * oy * oz : 0
}
