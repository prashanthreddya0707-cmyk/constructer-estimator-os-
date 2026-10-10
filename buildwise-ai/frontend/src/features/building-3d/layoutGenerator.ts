/**
 * Procedural floor-plan generator: building details in -> editable room layout out (no uploaded plan needed).
 *
 * Strategy ("zoned bands"): on every floor the footprint is cut into a public band (living, dining, kitchen) and a private
 * band (bedrooms, bathrooms) joined by a passage that runs the whole length; multi-storey buildings get a staircase at the
 * end of the passage on every floor. Rooms in a band share the band depth and their widths follow their target areas.
 * Rooms tile the footprint exactly. Dimensions are centreline-to-centreline; the clear area is smaller by half a wall.
 * If the rooms cannot fit, no layout is produced: the result lists what is wrong and how to fix it.
 */
import type { RoomInput } from '@/types'

export type RoomKind = 'bedroom' | 'living' | 'kitchen' | 'dining' | 'bathroom' | 'study' | 'store'
export type BuildingKind = 'residential' | 'commercial'

export interface GeneratorConfig {
  buildingType: BuildingKind
  length: number
  width: number
  floors: number
  wallHeight: number
  wallThickness: number
  counts: Record<RoomKind, number>
  windows: 'few' | 'standard' | 'many'
  /** 0..3: alternative arrangements (mirror / swap public & private zones) used by "Regenerate layout" */
  variant: number
  /** optional per-kind area targets in m² */
  areas?: Partial<Record<RoomKind, number>>
  furnish: boolean
}

export interface GeneratorResult {
  rooms: RoomInput[]
  errors: string[]
  suggestions: string[]
  /** things the generator did on its own (e.g. extra rooms added to use leftover space) */
  notes: string[]
  stats: { footprint: number; roomArea: number; passageArea: number; usableArea: number }
}

export const DEFAULT_CONFIG: GeneratorConfig = {
  buildingType: 'residential', length: 10, width: 8, floors: 1, wallHeight: 3, wallThickness: 0.23,
  counts: { bedroom: 2, living: 1, kitchen: 1, dining: 1, bathroom: 2, study: 0, store: 0 },
  windows: 'standard', variant: 0, furnish: true,
}

export const COMMERCIAL_COUNTS: Record<RoomKind, number> = { bedroom: 0, living: 1, kitchen: 1, dining: 1, bathroom: 2, study: 4, store: 1 }

export const KIND_LABEL: Record<BuildingKind, Record<RoomKind, string>> = {
  residential: { bedroom: 'Bedroom', living: 'Living room', kitchen: 'Kitchen', dining: 'Dining room', bathroom: 'Bathroom', study: 'Study', store: 'Store' },
  commercial: { bedroom: 'Cabin', living: 'Reception', kitchen: 'Pantry', dining: 'Meeting room', bathroom: 'Washroom', study: 'Office', store: 'Store' },
}

const TYPE_OF: Record<RoomKind, string> = { bedroom: 'bedroom', living: 'living', kitchen: 'kitchen', dining: 'dining', bathroom: 'bathroom', study: 'study', store: 'store' }
interface KindSpec { target: number; minSide: number; minArea: number; zone: 'public' | 'private' }
const SPEC: Record<RoomKind, KindSpec> = {
  living: { target: 20, minSide: 3.2, minArea: 12, zone: 'public' },
  dining: { target: 11, minSide: 2.4, minArea: 7, zone: 'public' },
  kitchen: { target: 10, minSide: 2.0, minArea: 6, zone: 'public' },
  store: { target: 5, minSide: 1.5, minArea: 2.5, zone: 'public' },
  bedroom: { target: 13, minSide: 2.7, minArea: 9, zone: 'private' },
  bathroom: { target: 4.5, minSide: 1.5, minArea: 2.8, zone: 'private' },
  study: { target: 9, minSide: 2.2, minArea: 6, zone: 'private' },
}
const PASSAGE = 1.2
const STAIR_W = 2.4
const r05 = (v: number) => Math.round(v / 0.05) * 0.05
const r3 = (v: number) => Math.round(v * 1000) / 1000

interface Item { kind: RoomKind; name: string; target: number; minSide: number; minArea: number }

function windowCount(kind: RoomKind, mode: GeneratorConfig['windows']): number {
  const base: Record<RoomKind, number> = { living: 2, dining: 1, kitchen: 1, bedroom: 2, bathroom: 1, study: 1, store: 0 }
  if (kind === 'store') return 0
  const b = base[kind]
  return mode === 'few' ? Math.max(1, Math.ceil(b / 2)) : mode === 'many' ? b + 1 : b
}

/** Widths along a band of length L for items of given depth; area-proportional, respecting minimum widths. null = does not fit. */
function distribute(L: number, items: Item[], depth: number): number[] | null {
  if (!items.length) return []
  const wmin = items.map((i) => Math.max(i.minSide, i.minArea / depth))
  let w = items.map((i, k) => Math.max(wmin[k], i.target / depth))
  const total = w.reduce((a, b) => a + b, 0)
  if (total <= L) w = w.map((x) => (x * L) / total)
  else {
    const flex = w.reduce((a, x, k) => a + (x - wmin[k]), 0)
    const deficit = total - L
    if (deficit > flex + 1e-9) return null
    w = w.map((x, k) => wmin[k] + (x - wmin[k]) * (1 - deficit / flex))
  }
  // tidy numbers: multiples of 5 cm, the last room absorbs the rounding so the band is filled exactly
  const out = w.map(r05)
  const used = out.slice(0, -1).reduce((a, b) => a + b, 0)
  out[out.length - 1] = r3(L - used)
  return out.every((x, k) => x >= wmin[k] - 0.051) ? out : null
}

function itemsFor(cfg: GeneratorConfig): Record<RoomKind, Item[]> {
  const labels = KIND_LABEL[cfg.buildingType]
  const out = {} as Record<RoomKind, Item[]>
  ;(Object.keys(SPEC) as RoomKind[]).forEach((kind) => {
    const n = Math.max(0, Math.floor(cfg.counts[kind] || 0))
    const s = SPEC[kind]
    out[kind] = Array.from({ length: n }, (_, i) => ({
      kind, name: n > 1 ? `${labels[kind]} ${i + 1}` : labels[kind],
      target: (cfg.areas?.[kind] ?? s.target) * (kind === 'bedroom' && i === 0 && n > 1 ? 1.15 : 1), minSide: s.minSide, minArea: s.minArea,
    }))
  })
  return out
}

/** Which rooms go on which floor. Ground floor: public rooms (+ one bathroom); upper floors: bedrooms and the rest. */
function assignFloors(cfg: GeneratorConfig, all: Record<RoomKind, Item[]>): Item[][] {
  const F = cfg.floors
  if (F === 1) return [(Object.keys(all) as RoomKind[]).flatMap((k) => all[k])]
  const floors: Item[][] = Array.from({ length: F }, () => [])
  ;(['living', 'dining', 'kitchen', 'store'] as RoomKind[]).forEach((k) => floors[0].push(...all[k]))
  const baths = [...all.bathroom]
  if (baths.length) floors[0].push(baths.shift() as Item)
  const upper = F - 1
  const spread = (list: Item[]) => list.forEach((it, i) => floors[1 + (i % upper)].push(it))
  spread([...all.bedroom, ...all.study])
  baths.forEach((b, i) => floors[1 + (i % upper)].push(b))
  return floors
}

export function generateLayout(input: GeneratorConfig): GeneratorResult {
  const cfg = { ...DEFAULT_CONFIG, ...input, counts: { ...DEFAULT_CONFIG.counts, ...input.counts } }
  const { length: L, width: W } = cfg
  const errors: string[] = [], suggestions: string[] = [], notes: string[] = []
  const stats = { footprint: L * W, roomArea: 0, passageArea: 0, usableArea: 0 }
  const fail = (msg: string, ...sug: string[]): GeneratorResult => ({ rooms: [], errors: [...errors, msg], suggestions: [...suggestions, ...sug], notes, stats })

  if (!(L >= 3 && L <= 100) || !(W >= 3 && W <= 100)) return fail('Length and width must be between 3 m and 100 m.')
  if (!Number.isInteger(cfg.floors) || cfg.floors < 1 || cfg.floors > 10) return fail('The number of floors must be a whole number from 1 to 10.')
  if (!(cfg.wallHeight >= 2 && cfg.wallHeight <= 6)) return fail('Wall height must be between 2 m and 6 m.')
  const all = itemsFor(cfg)
  const total = (Object.keys(all) as RoomKind[]).reduce((a, k) => a + all[k].length, 0)
  if (total === 0) return fail('Add at least one room.', 'Increase one of the room counts.')

  const floorItems = assignFloors(cfg, all)
  const rooms: RoomInput[] = []
  const mirror = (cfg.variant & 1) === 1, flip = (cfg.variant & 2) === 2

  for (let f = 0; f < cfg.floors; f++) {
    const items = floorItems[f]
    const fl = f + 1
    if (!items.length) { suggestions.push(`Floor ${fl} has no rooms assigned. Add more bedrooms/studies or reduce the number of floors.`); continue }
    const stairs = cfg.floors > 1
    const usePassage = (items.length >= 3 || stairs) && W >= 5.5
    const minAreaSum = items.reduce((a, i) => a + i.minArea, 0) + (usePassage ? PASSAGE * L * 0.6 : 0)
    if (minAreaSum > L * W) {
      return fail(
        `Floor ${fl}: the rooms need at least ${minAreaSum.toFixed(0)} m² but the ${L} × ${W} m footprint is only ${(L * W).toFixed(0)} m².`,
        'Reduce the number of rooms on this floor.', 'Increase the building length or width.', 'Increase the number of floors to spread the rooms.',
      )
    }

    // split into zones
    let pub = items.filter((i) => SPEC[i.kind].zone === 'public')
    let prv = items.filter((i) => SPEC[i.kind].zone === 'private')
    if (!pub.length || !prv.length) { // all rooms of one zone (e.g. upper floors): balance the two bands by area
      const sorted = [...items].sort((a, b) => b.target - a.target)
      pub = []; prv = []
      let ap = 0, ar = 0
      for (const it of sorted) { if (ap <= ar) { pub.push(it); ap += it.target } else { prv.push(it); ar += it.target } }
      if (!prv.length && pub.length > 1) prv.push(pub.pop() as Item)
    }
    // Balance the zones by area so no band is left with one tiny room stretched along the whole length
    // (e.g. a ground-floor bathroom alone in the back band). The living room stays at the front with the entrance.
    const area = (list: Item[]) => list.reduce((a, i) => a + i.target, 0)
    const bands2 = (a: Item[], b: Item[]) => a.length + b.length >= 2
    for (let guard = 0; guard < items.length; guard++) {
      const [big, small] = area(pub) >= area(prv) ? [pub, prv] : [prv, pub]
      if (big.length < 2 || area(small) >= 0.55 * area(big)) break
      const movable = big.filter((i) => i.kind !== 'living')
      if (!movable.length) break
      const gap = (area(big) - area(small)) / 2
      const pick = movable.reduce((b, i) => (Math.abs(i.target - gap) < Math.abs(b.target - gap) ? i : b))
      if (area(small) + pick.target > area(big) - pick.target + 1e-9 && Math.abs(area(big) - area(small)) <= pick.target) break // moving would only flip the imbalance
      big.splice(big.indexOf(pick), 1)
      small.push(pick)
    }
    // A band whose rooms would have to stretch far beyond their target size gets a filler room instead, so no room becomes
    // absurdly large: a family lounge upstairs, a utility room on the ground floor.
    if (bands2(pub, prv)) {
      const passageGuess = usePassage && pub.length && prv.length ? PASSAGE : 0
      const tot = area(pub) + area(prv)
      for (const band of [pub, prv]) {
        if (!band.length) continue
        const depth = Math.max(2.4, ((W - passageGuess) * area(band)) / tot)
        const needW = band.reduce((a, i) => a + Math.max(i.minSide, i.minArea / depth, i.target / depth), 0)
        if (L / needW > 1.55) {
          const lounge = f > 0
          const filler: Item = lounge
            ? { kind: 'living', name: cfg.buildingType === 'commercial' ? 'Waiting area' : 'Family lounge', target: 14, minSide: 3.0, minArea: 10 }
            : { kind: 'store', name: 'Utility', target: 7, minSide: 1.8, minArea: 3 }
          band.push(filler)
          notes.push(`Floor ${fl}: added a ${filler.name.toLowerCase()} to use leftover space.`)
        }
      }
    }
    interface Plan { bands: Item[][]; passage: number; depths: number[]; widths: number[][] }
    type Attempt = { plan: Plan } | { failBand: Item[]; message: string; suggestions: string[] }
    const attempt = (pubI: Item[], prvI: Item[], withPassage = usePassage): Attempt => {
      const bands = [pubI, prvI].filter((b) => b.length)
      const passage = withPassage && bands.length === 2 ? PASSAGE : 0
      const depthTotal = W - passage
      // band depths follow the area each band needs, but never less than its rooms' minimum side
      const need = bands.map((b) => Math.max(2.4, ...b.map((i) => i.minSide)))
      if (need.reduce((a, b) => a + b, 0) > depthTotal + 1e-9) {
        return { failBand: bands[0], message: `Floor ${fl}: the building is only ${W} m wide, which is too narrow for ${bands.length} rows of rooms${passage ? ' and a passage' : ''}.`, suggestions: ['Increase the building width.', 'Reduce the number of rooms on this floor.'] }
      }
      const areas = bands.map((b) => b.reduce((a, i) => a + i.target, 0))
      let depths = bands.map((_, k) => (depthTotal * areas[k]) / areas.reduce((a, b) => a + b, 0))
      depths = depths.map((d, k) => Math.max(d, need[k]))
      const excess = depths.reduce((a, b) => a + b, 0) - depthTotal
      if (excess > 1e-9) { const k = depths.indexOf(Math.max(...depths)); depths[k] -= excess }
      depths = depths.map(r05)
      depths[depths.length - 1] = r3(depthTotal - depths.slice(0, -1).reduce((a, b) => a + b, 0))
      const widths = bands.map((b, k) => distribute(L, b, depths[k]))
      const bad = widths.findIndex((w) => w === null)
      if (bad >= 0) {
        return {
          failBand: bands[bad],
          message: `Floor ${fl}: these rooms cannot fit side by side across the ${L} m length at a depth of ${depths[bad].toFixed(1)} m: ${bands[bad].map((i) => i.name).join(', ')}.`,
          suggestions: ['Reduce the number of rooms in this zone (e.g. bedrooms, bathrooms or offices).', 'Increase the building length.', 'Increase the number of floors to spread the rooms.'],
        }
      }
      return { plan: { bands, passage, depths, widths: widths as number[][] } }
    }
    // If a zone is too crowded, move rooms (bathrooms first) into the other zone before giving up.
    const MOVE_ORDER: RoomKind[] = ['bathroom', 'store', 'study', 'dining', 'kitchen', 'bedroom']
    let res = attempt(pub, prv)
    if (!('plan' in res) && usePassage) { const noPassage = attempt(pub, prv, false); if ('plan' in noPassage) res = noPassage } // narrow plan: rooms open onto each other
    for (let guard = 0; guard < items.length && !('plan' in res); guard++) {
      const from = res.failBand === pub ? pub : prv
      const to = from === pub ? prv : pub
      const mv = MOVE_ORDER.map((k) => from.find((i) => i.kind === k)).find(Boolean)
      if (!mv || from.length <= 1) break
      from.splice(from.indexOf(mv), 1)
      to.push(mv)
      res = attempt(pub, prv)
      if (!('plan' in res) && usePassage) { const noPassage = attempt(pub, prv, false); if ('plan' in noPassage) res = noPassage }
    }
    if (!('plan' in res)) return fail(res.message, ...res.suggestions)
    const { bands, passage, depths, widths } = res.plan

    // z positions: public band at the front (+Z), private band at the back; `flip` swaps them
    const order = bands.length === 2 ? (flip ? [0, 1] : [1, 0]) : [0] // indices into `bands` from z=0 (back/north) to the front
    const bandZ: number[] = []
    let z = 0
    order.forEach((bi, pos) => { bandZ[bi] = z; z += depths[bi]; if (pos === 0 && passage) z += passage })
    const passageZ = passage ? bandZ[order[0]] + depths[order[0]] : 0
    const H = cfg.wallHeight
    const mk = (name: string, type: string, x: number, zz: number, w: number, d: number, doors: number, windows: number): RoomInput => ({
      name, room_type: type, length: r3(w), width: r3(d), height: H, floor_number: fl, wall_thickness: null, doors, windows,
      area_override: null, pos_x: r3(mirror ? L - x - w : x), pos_y: r3(zz),
    })
    bands.forEach((b, bi) => {
      let x = 0
      b.forEach((it, k) => {
        const w = widths[bi][k]
        rooms.push(mk(it.name, TYPE_OF[it.kind], x, bandZ[bi], w, depths[bi], 1, windowCount(it.kind, cfg.windows)))
        x += w
      })
    })
    if (passage) {
      const stairW = stairs ? Math.min(STAIR_W, L * 0.3) : 0
      if (stairs) rooms.push(mk('Staircase', 'staircase', 0, passageZ, stairW, passage, 0, 0))
      if (L - stairW >= 1.0) rooms.push(mk('Passage', 'corridor', stairW, passageZ, L - stairW, passage, 0, 0))
    }
  }

  const t = 0.115
  rooms.forEach((r) => {
    const a = r.length * r.width
    stats.roomArea += a
    if (r.room_type === 'corridor' || r.room_type === 'staircase') stats.passageArea += a
    stats.usableArea += Math.max(0, (r.length - t) * (r.width - t))
  })
  return { rooms, errors, suggestions, notes, stats }
}
