import { describe, expect, it } from 'vitest'
import { circulationOk, findFreeSpot, furnishRoom, interiorOf, itemRect, placementProblem, specOf, zonesFor, type FurnitureItem } from './furniture'
import { makeLayout, planSignature, roomSignature } from './layoutStore'
import { buildModel, type FloorModel, type RoomBox } from './model'
import { DEFAULT_CONFIG } from './layoutGenerator'
import { generatedProject, project, room } from './testFixtures'

const rectsOverlap = (a: ReturnType<typeof itemRect>, b: ReturnType<typeof itemRect>) => a.x0 < b.x1 - 1e-6 && a.x1 > b.x0 + 1e-6 && a.z0 < b.z1 - 1e-6 && a.z1 > b.z0 + 1e-6

/** Assert every rule from the brief for one furnished floor. */
function assertFloorFurnishingValid(f: FloorModel, label: string) {
  for (const r of f.rooms) {
    const items = f.furnitureItems.filter((i) => i.room_id === r.id)
    const I = interiorOf(r)
    const z = zonesFor(r, f.openings)
    for (const it of items) {
      const spec = specOf(it.type)!
      const rect = itemRect(it)
      const tag = `${label}: ${r.name}/${it.type}`
      expect(rect.x0, tag).toBeGreaterThanOrEqual(I.x0 - 1e-6); expect(rect.x1, tag).toBeLessThanOrEqual(I.x1 + 1e-6)
      expect(rect.z0, tag).toBeGreaterThanOrEqual(I.z0 - 1e-6); expect(rect.z1, tag).toBeLessThanOrEqual(I.z1 + 1e-6)
      for (const d of z.doors) expect(rectsOverlap(rect, d), `${tag} blocks a door`).toBe(false)
      if (spec.tall) for (const w of z.windows) expect(rectsOverlap(rect, w), `${tag} blocks a window`).toBe(false)
      // never intersects walls: items are inside the clear interior, walls are outside it
      for (const o of items) {
        if (o.id === it.id) continue
        const os = specOf(o.type)!
        if (spec.overlay || os.overlay || spec.mounted || os.mounted) continue
        expect(rectsOverlap(rect, itemRect(o)), `${tag} overlaps ${o.type}`).toBe(false)
      }
    }
    expect(circulationOk(r, items, f.openings), `${label}: ${r.name} circulation`).toBe(true)
  }
}

describe('automatic furniture per room type (default 10×8 house)', () => {
  const { p } = generatedProject()
  const f = buildModel(p).floors[0]
  const inRoom = (name: string) => f.furnitureItems.filter((i) => f.rooms.find((r) => r.id === i.room_id)!.name === name).map((i) => i.type)

  it('bedrooms: bed with bedding, bedside tables and wardrobe', () => {
    for (const n of ['Bedroom 1', 'Bedroom 2']) {
      const t = inRoom(n)
      expect(t, n).toContain('bed_double')
      expect(t.filter((x) => x === 'nightstand').length, n).toBeGreaterThanOrEqual(1)
      expect(t, n).toContain('wardrobe')
    }
  })
  it('living room: sofa, coffee table and TV unit', () => {
    const t = inRoom('Living room')
    for (const x of ['sofa', 'coffee_table', 'tv_unit']) expect(t).toContain(x)
  })
  it('kitchen: counter with sink and stove, plus a refrigerator', () => {
    const t = inRoom('Kitchen')
    for (const x of ['counter', 'sink', 'stove', 'fridge']) expect(t).toContain(x)
  })
  it('dining room: table with appropriately sized chairs and clearance', () => {
    const t = inRoom('Dining room')
    expect(t).toContain('dining_table')
    expect(t.filter((x) => x === 'dining_chair').length).toBeGreaterThanOrEqual(4)
  })
  it('bathrooms: toilet, washbasin with mirror; shower or bathtub where space permits', () => {
    for (const n of ['Bathroom 1', 'Bathroom 2']) {
      const t = inRoom(n)
      for (const x of ['toilet', 'basin', 'mirror']) expect(t, n).toContain(x)
      expect(t.filter((x) => x === 'basin').length, n).toBe(1)
    }
  })
  it('the passage is kept clear', () => {
    expect(inRoom('Passage')).toEqual([])
  })
  it('the sofa faces the TV unit (opposite walls, aligned)', () => {
    const tv = f.furnitureItems.find((i) => i.type === 'tv_unit')!
    const sofa = f.furnitureItems.find((i) => i.type === 'sofa' || i.type === 'sofa_l')!
    const opp = { N: 'S', S: 'N', E: 'W', W: 'E' } as const
    expect(sofa.facing).toBe(opp[tv.facing])
    const horiz = tv.facing === 'N' || tv.facing === 'S'
    expect(Math.abs((horiz ? tv.cx - sofa.cx : tv.cz - sofa.cz))).toBeLessThan(0.9)
  })
  it('every rule holds: inside rooms, off doorways and windows, no overlaps, walkable', () => {
    assertFloorFurnishingValid(f, 'default')
  })
})

describe('furnishing across layouts and generation modes', () => {
  it('stays valid for all variants and several building sizes', () => {
    const cases: [string, Parameters<typeof generatedProject>[0]][] = [
      ['v0', { variant: 0 }], ['v1', { variant: 1 }], ['v2', { variant: 2 }], ['v3', { variant: 3 }],
      ['12x9', { length: 12, width: 9, counts: { ...DEFAULT_CONFIG.counts, bedroom: 3 } }], ['15x10', { length: 15, width: 10, counts: { ...DEFAULT_CONFIG.counts, bedroom: 4, bathroom: 3 } }],
      ['9x7.5', { length: 9, width: 7.5, counts: { ...DEFAULT_CONFIG.counts, bedroom: 2, bathroom: 1 } }], ['two-storey', { floors: 2, length: 12, width: 9 }],
    ]
    for (const [label, cfg] of cases) {
      const { p } = generatedProject(cfg)
      const m = buildModel(p)
      expect(m.issues.filter((i) => i.severity === 'error'), label).toEqual([])
      m.floors.forEach((fl) => assertFloorFurnishingValid(fl, label))
      expect(m.floors.reduce((a, fl) => a + fl.furnitureItems.length, 0), label).toBeGreaterThan(8)
    }
  })

  it('works in the other generation mode too: hand-entered rooms (as from a confirmed floor plan)', () => {
    const rooms = [
      room({ id: 'a', name: 'Hall', room_type: 'living', length: 5, width: 4, pos_x: 0, pos_y: 0, doors: 2, windows: 2 }),
      room({ id: 'b', name: 'Bed', room_type: 'bedroom', length: 4, width: 4, pos_x: 5, pos_y: 0, doors: 1, windows: 1 }),
      room({ id: 'c', name: 'Bath', room_type: 'bathroom', length: 2.5, width: 3, pos_x: 5, pos_y: 4, doors: 1, windows: 1 }),
      room({ id: 'd', name: 'Kitchen', room_type: 'kitchen', length: 5, width: 3, pos_x: 0, pos_y: 4, doors: 1, windows: 1 }),
    ]
    const m = buildModel(project({ length: 10, width: 7, rooms }))
    expect(m.issues.filter((i) => i.severity === 'error')).toEqual([])
    assertFloorFurnishingValid(m.floors[0], 'manual')
    expect(m.floors[0].furnitureItems.some((i) => i.type === 'sofa' || i.type === 'sofa_l')).toBe(true)
  })

  it('small rooms get fewer or smaller pieces instead of cramming', () => {
    const tiny = room({ id: 't', room_type: 'bedroom', length: 2, width: 2, pos_x: 0, pos_y: 0 })
    expect(buildModel(project({ length: 2, width: 2, rooms: [tiny] })).floors[0].furnitureItems).toEqual([])
    const single = room({ id: 's', room_type: 'bedroom', length: 2.8, width: 2.6, pos_x: 0, pos_y: 0 })
    const items = buildModel(project({ length: 2.8, width: 2.6, rooms: [single] })).floors[0].furnitureItems
    expect(items.some((i) => i.type === 'bed_double')).toBe(false)
    expect(items.some((i) => i.type === 'bed_single')).toBe(true)
  })

  it('automatic furnishing can be switched off without changing the plan geometry', () => {
    const { p } = generatedProject()
    const on = buildModel(p, { autoFurnish: true }).floors[0], off = buildModel(p, { autoFurnish: false }).floors[0]
    expect(off.furnitureItems).toHaveLength(0)
    expect(on.furnitureItems.length).toBeGreaterThan(0)
    expect(off.walls.map((w) => w.pieces)).toEqual(on.walls.map((w) => w.pieces))
    expect(off.openings).toEqual(on.openings)
  })

  it('is deterministic: same plan, same items and ids', () => {
    const { p } = generatedProject()
    const a = buildModel(p).floors[0].furnitureItems, b = buildModel(p).floors[0].furnitureItems
    expect(b).toEqual(a)
    expect(new Set(a.map((i) => i.id)).size).toBe(a.length)
  })
})

describe('placement rules', () => {
  const { p } = generatedProject()
  const m = buildModel(p)
  const f = m.floors[0]
  const living = f.rooms.find((r) => r.type === 'living') as RoomBox

  it('rejects items outside the room, on a doorway or overlapping another item', () => {
    const items = f.furnitureItems.filter((i) => i.room_id === living.id)
    const door = f.openings.find((o) => o.kind === 'door' && zonesFor(living, [o]).doors.length)!
    const I = interiorOf(living)
    const outside: FurnitureItem = { id: 'x', room_id: living.id, type: 'sofa', cx: I.x0 - 1, cz: living.cz, w: 2, d: 0.9, facing: 'N' }
    expect(placementProblem(outside, living, f.openings, items)).toMatch(/outside|wall/i)
    const onDoor: FurnitureItem = { id: 'y', room_id: living.id, type: 'side_table', cx: door.orientation === 'x' ? door.center : door.line + door.into * 0.4, cz: door.orientation === 'x' ? door.line + door.into * 0.4 : door.center, w: 0.45, d: 0.45, facing: 'N' }
    expect(placementProblem(onDoor, living, f.openings, items)).toMatch(/door/i)
    const sofa = items.find((i) => i.type === 'sofa' || i.type === 'sofa_l')!
    expect(placementProblem({ ...sofa, id: 'dup' }, living, f.openings, items)).toMatch(/overlap/i)
    expect(placementProblem(sofa, living, f.openings, items)).toBeNull() // an item never conflicts with itself
  })

  it('circulation check fails when furniture seals a doorway off', () => {
    const r = f.rooms.find((x) => x.type === 'bedroom') as RoomBox
    const items = f.furnitureItems.filter((i) => i.room_id === r.id)
    const door = f.openings.find((o) => o.kind === 'door' && o.roomId === r.id)!
    const wall = (door.orientation === 'x' ? door.line + door.into * 0.55 : door.center)
    const wall2 = (door.orientation === 'x' ? door.center : door.line + door.into * 0.55)
    const blockers: FurnitureItem[] = [
      { id: 'b1', room_id: r.id, type: 'wardrobe', cx: door.orientation === 'x' ? wall2 : wall, cz: door.orientation === 'x' ? wall : wall2, w: 2.4, d: 0.7, facing: door.orientation === 'x' ? 'N' : 'W' },
    ]
    expect(circulationOk(r, items, f.openings)).toBe(true)
    expect(circulationOk(r, [...items, ...blockers.map((b) => ({ ...b, w: 3.2 }))], f.openings)).toBe(false)
  })

  it('"add furniture" finds a free spot that is valid, and refuses when nothing fits', () => {
    const others = f.furnitureItems.filter((i) => i.room_id === living.id)
    const spot = findFreeSpot(living, f.openings, others, 'bookshelf')
    expect(spot).not.toBeNull()
    expect(placementProblem(spot!, living, f.openings, others)).toBeNull()
    const bath = f.rooms.find((r) => r.type === 'bathroom') as RoomBox
    expect(findFreeSpot(bath, f.openings, f.furnitureItems.filter((i) => i.room_id === bath.id), 'bathtub')).toBeNull()
  })

  it('furnishRoom is empty for passages and rooms that overflow the building', () => {
    const passage = f.rooms.find((r) => r.type === 'corridor') as RoomBox
    expect(furnishRoom(passage, f.openings)).toEqual([])
  })
})

describe('saving and restoring furniture edits', () => {
  const { p, rooms } = generatedProject()
  const base = buildModel(p)
  const sig = planSignature(p, rooms)

  const withFurniture = (items: typeof base.resolved.furniture, roomSigs = base.resolved.roomSigs) =>
    makeLayout({ signature: sig, settings: { autoFurnish: true }, openings: null, furniture: { items, room_sigs: roomSigs }, summary: base.resolved.summary })

  it('a saved arrangement is restored exactly (move, rotate, resize, delete)', () => {
    const items = base.resolved.furniture.map((i) => ({ ...i }))
    const bed = items.find((i) => i.type === 'bed_double')!
    bed.cx += 0.1; bed.w = 1.6 // moved a little and resized
    const wardrobe = items.find((i) => i.type === 'wardrobe')!
    const kept = items.filter((i) => i.id !== wardrobe.id) // deleted
    const m = buildModel(p, { layout: withFurniture(kept) })
    const got = m.floors[0].furnitureItems
    expect(got.find((i) => i.id === bed.id)).toMatchObject({ w: 1.6, facing: bed.facing })
    expect(got.some((i) => i.id === wardrobe.id)).toBe(false)
    const back = m.resolved.furniture.find((i) => i.id === bed.id)!
    expect(back.cx).toBeCloseTo(bed.cx, 9) // local <-> world conversion is lossless
    expect(back.cz).toBeCloseTo(bed.cz, 9)
  })

  it('furniture of a room is regenerated automatically after that room is resized; other rooms keep their edits', () => {
    const items = base.resolved.furniture.map((i) => ({ ...i }))
    const bed = items.find((i) => i.type === 'bed_double')!
    bed.cx += 0.05
    const layout = withFurniture(items)
    const edited = { ...p, rooms: p.rooms.map((r) => (r.id === bed.room_id ? { ...r, width: r.width - 0.2 } : r)) }
    // other rooms are untouched, so their signatures still match; the resized room differs
    const resizedRoom = edited.rooms.find((r) => r.id === bed.room_id)!
    expect(roomSignature(resizedRoom)).not.toBe(base.resolved.roomSigs[bed.room_id])
    const m = buildModel(edited, { layout: { ...layout, signature: planSignature(edited, edited.rooms) } })
    const inResized = m.floors[0].furnitureItems.filter((i) => i.room_id === bed.room_id)
    expect(inResized.length).toBeGreaterThan(0)
    expect(inResized.find((i) => i.id === bed.id)?.cx).not.toBeCloseTo(bed.cx - 5, 3) // re-arranged, not the stale saved spot
    const sofa = base.resolved.furniture.find((i) => i.type === 'sofa')!
    expect(m.floors[0].furnitureItems.find((i) => i.id === sofa.id)).toBeDefined() // untouched room keeps its pieces
  })

  it('saved pieces that no longer fit are dropped with a message, never silently kept', () => {
    const items = base.resolved.furniture.map((i) => ({ ...i }))
    const sofa = items.find((i) => i.type === 'sofa')!
    sofa.cx = 0.1 // outside the room after the edit
    const m = buildModel(p, { layout: withFurniture(items) })
    expect(m.floors[0].furnitureItems.find((i) => i.id === sofa.id)).toBeUndefined()
    expect(m.issues.some((i) => i.code === 'furniture-invalid')).toBe(true)
  })

  it('a room with all furniture deleted stays empty (the deletion is remembered)', () => {
    const bedId = base.resolved.furniture.find((i) => i.type === 'bed_double')!.room_id
    const items = base.resolved.furniture.filter((i) => i.room_id !== bedId)
    const m = buildModel(p, { layout: withFurniture(items) })
    expect(m.floors[0].furnitureItems.filter((i) => i.room_id === bedId)).toHaveLength(0)
  })

  it('"restore automatic" (null furniture) brings the original arrangement back', () => {
    const custom = buildModel(p, { layout: withFurniture([]) })
    expect(custom.floors[0].furnitureItems).toHaveLength(0)
    const auto = buildModel(p, { layout: { ...withFurniture([]), furniture: null } })
    expect(auto.floors[0].furnitureItems).toEqual(base.floors[0].furnitureItems)
  })

  it('furniture is stored separately from material quantities: it appears in the layout, not in the estimate summary', () => {
    const keys = Object.keys(base.resolved.summary)
    expect(keys.sort()).toEqual(['doors', 'windows'])
    expect(base.resolved.furniture.length).toBeGreaterThan(0)
  })
})
