import { describe, expect, it } from 'vitest'
import { COMMERCIAL_COUNTS, DEFAULT_CONFIG, generateLayout } from './layoutGenerator'
import { buildModel } from './model'
import { generatedProject } from './testFixtures'

const overlapArea = (a: { pos_x: number | null; pos_y: number | null; length: number; width: number }, b: typeof a) =>
  Math.max(0, Math.min((a.pos_x ?? 0) + a.length, (b.pos_x ?? 0) + b.length) - Math.max(a.pos_x ?? 0, b.pos_x ?? 0)) *
  Math.max(0, Math.min((a.pos_y ?? 0) + a.width, (b.pos_y ?? 0) + b.width) - Math.max(a.pos_y ?? 0, b.pos_y ?? 0))

describe('generation without a floor plan: default 10 m × 8 m house', () => {
  const g = generateLayout(DEFAULT_CONFIG)

  it('produces the requested rooms and a passage, with no errors', () => {
    expect(g.errors).toEqual([])
    const count = (t: string) => g.rooms.filter((r) => r.room_type === t).length
    expect(count('bedroom')).toBe(2)
    expect(count('living')).toBe(1)
    expect(count('kitchen')).toBe(1)
    expect(count('dining')).toBe(1)
    expect(count('bathroom')).toBe(2)
    expect(count('corridor')).toBe(1) // passage allocated automatically
  })

  it('tiles the 80 m² footprint exactly: no overlaps, no gaps, nothing outside', () => {
    expect(g.stats.footprint).toBe(80)
    expect(g.stats.roomArea).toBeCloseTo(80, 6)
    for (const r of g.rooms) {
      expect(r.pos_x).toBeGreaterThanOrEqual(0)
      expect(r.pos_y).toBeGreaterThanOrEqual(0)
      expect((r.pos_x as number) + r.length).toBeLessThanOrEqual(10 + 1e-6)
      expect((r.pos_y as number) + r.width).toBeLessThanOrEqual(8 + 1e-6)
    }
    for (let i = 0; i < g.rooms.length; i++) for (let j = i + 1; j < g.rooms.length; j++) expect(overlapArea(g.rooms[i], g.rooms[j])).toBeLessThan(1e-6)
  })

  it('accounts for walls: usable internal area is less than the footprint', () => {
    expect(g.stats.usableArea).toBeLessThan(g.stats.footprint)
    expect(g.stats.usableArea).toBeGreaterThan(g.stats.footprint * 0.85)
    expect(g.stats.passageArea).toBeGreaterThan(0)
  })

  it('respects minimum room sizes', () => {
    const min: Record<string, number> = { bedroom: 2.7, living: 3.2, kitchen: 2.0, dining: 2.4, bathroom: 1.5 }
    for (const r of g.rooms) if (min[r.room_type]) expect(Math.min(r.length, r.width)).toBeGreaterThanOrEqual(min[r.room_type] - 1e-6)
  })

  it('produces a complete building: entrance, a door in every room, valid access, no validation errors', () => {
    const { p } = generatedProject()
    const m = buildModel(p)
    expect(m.issues.filter((i) => i.severity === 'error')).toEqual([])
    const f = m.floors[0]
    const entrances = f.openings.filter((o) => o.entrance)
    expect(entrances).toHaveLength(1)
    expect(entrances[0].width).toBeCloseTo(1.0)
    expect(entrances[0].height).toBeCloseTo(2.1)
    for (const r of f.rooms.filter((x) => x.type !== 'corridor')) {
      const doors = f.openings.filter((o) => o.kind === 'door' && !o.entrance && o.roomId === r.id)
      expect(doors.length, r.name).toBeGreaterThanOrEqual(1)
    }
  })

  it('uses the specified door sizes (entrance 1.0×2.1, internal 0.9×2.1, bathroom 0.75×2.0)', () => {
    const { p } = generatedProject()
    const f = buildModel(p).floors[0]
    for (const o of f.openings.filter((x) => x.kind === 'door' && !x.entrance)) {
      const owner = f.rooms.find((r) => r.id === o.roomId)!
      const bath = owner.type === 'bathroom'
      expect(o.width).toBeLessThanOrEqual(bath ? 0.75 + 1e-9 : 0.9 + 1e-9)
      if (bath) { expect(o.width).toBeCloseTo(0.75); expect(o.height).toBeCloseTo(2.0) } else expect(o.height).toBeCloseTo(2.1)
    }
  })

  it('furnishes the generated building automatically', () => {
    const { p } = generatedProject()
    const f = buildModel(p).floors[0]
    const kinds = new Set(f.furnitureItems.map((i) => i.type))
    for (const t of ['bed_double', 'nightstand', 'wardrobe', 'sofa', 'tv_unit', 'coffee_table', 'dining_table', 'counter', 'sink', 'stove', 'fridge', 'toilet', 'basin']) expect(kinds.has(t), t).toBe(true)
  })
})

describe('other sizes, floors and variants', () => {
  it('works for several dimensions and room counts', () => {
    for (const [L, W, bed, bath] of [[12, 9, 3, 2], [9, 7.5, 2, 1], [15, 10, 4, 3], [8, 6.5, 1, 1]] as const) {
      const { p, g } = generatedProject({ length: L, width: W, counts: { ...DEFAULT_CONFIG.counts, bedroom: bed, bathroom: bath } })
      expect(g.errors, `${L}x${W}`).toEqual([])
      expect(g.stats.roomArea).toBeCloseTo(L * W, 5)
      const errors = buildModel(p).issues.filter((i) => i.severity === 'error')
      expect(errors, `${L}x${W}`).toEqual([])
    }
  })

  it('all four variants are valid and give different arrangements', () => {
    const sigs = new Set<string>()
    for (const variant of [0, 1, 2, 3]) {
      const { p, g } = generatedProject({ variant })
      expect(g.errors).toEqual([])
      expect(buildModel(p).issues.filter((i) => i.severity === 'error')).toEqual([])
      sigs.add(g.rooms.map((r) => `${r.name}@${r.pos_x},${r.pos_y}`).join('|'))
    }
    expect(sigs.size).toBe(4)
  })

  it('multi-storey: stairs on every floor, every floor reachable, rooms spread across floors', () => {
    const { p, g } = generatedProject({ floors: 2, length: 12, width: 9 })
    expect(g.errors).toEqual([])
    expect(g.rooms.filter((r) => r.room_type === 'staircase')).toHaveLength(2)
    expect(g.rooms.some((r) => r.floor_number === 2 && r.room_type === 'bedroom')).toBe(true)
    expect(g.rooms.some((r) => r.floor_number === 1 && r.room_type === 'living')).toBe(true)
    const m = buildModel(p)
    expect(m.issues.filter((i) => i.severity === 'error')).toEqual([])
    expect(m.floors[1].openings.filter((o) => o.entrance)).toHaveLength(0) // the entrance is on the ground floor only
  })

  it('never produces an absurdly large room: zones are balanced by area (ground floor of a 2-storey house)', () => {
    for (const [L, W] of [[12, 9], [14, 10], [10, 8]] as const) {
      const g = generateLayout({ ...DEFAULT_CONFIG, floors: 2, length: L, width: W })
      expect(g.errors).toEqual([])
      for (const r of g.rooms) {
        if (r.room_type === 'bathroom') expect(r.length * r.width, `${L}x${W} ${r.name}`).toBeLessThan(14)
        if (r.room_type === 'bedroom' || r.room_type === 'kitchen' || r.room_type === 'dining') expect(r.length * r.width, `${L}x${W} ${r.name}`).toBeLessThan(45)
        if (r.room_type !== 'corridor' && r.room_type !== 'staircase') expect(Math.max(r.length, r.width) / Math.min(r.length, r.width), `${L}x${W} ${r.name} aspect`).toBeLessThan(5.5)
      }
    }
  })

  it('commercial buildings use office room names', () => {
    const g = generateLayout({ ...DEFAULT_CONFIG, length: 14, buildingType: 'commercial', counts: COMMERCIAL_COUNTS })
    expect(g.errors).toEqual([])
    expect(g.rooms.some((r) => r.name.startsWith('Office'))).toBe(true)
    expect(g.rooms.some((r) => r.name === 'Reception')).toBe(true)
  })
})

describe('layouts that cannot fit', () => {
  it('explains the problem and suggests fixes instead of producing a broken layout', () => {
    const g = generateLayout({ ...DEFAULT_CONFIG, length: 6, width: 4, counts: { ...DEFAULT_CONFIG.counts, bedroom: 4 } })
    expect(g.rooms).toEqual([])
    expect(g.errors.length).toBeGreaterThan(0)
    expect(g.suggestions.join(' ')).toMatch(/reduce|increase/i)
  })
  it('rejects a footprint that is too narrow for the rooms', () => {
    const g = generateLayout({ ...DEFAULT_CONFIG, length: 14, width: 4.5 })
    expect(g.rooms).toEqual([])
    expect(g.errors[0]).toMatch(/narrow|fit/i)
  })
  it('validates numeric input and empty room lists', () => {
    expect(generateLayout({ ...DEFAULT_CONFIG, length: 0 }).errors.length).toBeGreaterThan(0)
    expect(generateLayout({ ...DEFAULT_CONFIG, floors: 0 }).errors.length).toBeGreaterThan(0)
    expect(generateLayout({ ...DEFAULT_CONFIG, wallHeight: 1 }).errors.length).toBeGreaterThan(0)
    const none = generateLayout({ ...DEFAULT_CONFIG, counts: { bedroom: 0, living: 0, kitchen: 0, dining: 0, bathroom: 0, study: 0, store: 0 } })
    expect(none.errors[0]).toMatch(/at least one room/i)
  })
})
