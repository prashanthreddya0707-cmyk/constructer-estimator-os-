/**
 * Furniture catalogue: item types, default sizes and limits, and the 3D geometry of each piece.
 * An item is {type, cx, cz, w, d, facing}: its footprint is centred on (cx, cz); `w` runs along the wall it stands
 * against, `d` is the depth away from that wall, `facing` is the wall the item's BACK is against (N=-Z, S=+Z, W=-X, E=+X).
 * Rotating an item = changing `facing`. All geometry is made of lightweight boxes (no flat 2D icons).
 */
import type { Facing, SavedFurniture } from './layoutStore'

/** In the model, coordinates are world coordinates (footprint centred on the origin). Saved items are building-local. */
export type FurnitureItem = SavedFurniture
export interface Rect { x0: number; x1: number; z0: number; z1: number }

export interface FurniturePart {
  cx: number; cy: number; cz: number; sx: number; sy: number; sz: number
  color: string
  roomId: string
  kind: string
  itemId: string
}

export interface FurnitureSpec {
  label: string
  w: number; d: number; h: number
  minW: number; maxW: number; minD: number; maxD: number
  rooms: string[]
  /** tall pieces must not stand in front of windows */
  tall?: boolean
  /** floor covering: may overlap other items */
  overlay?: boolean
  /** sits on / against another item (sink on a counter, mirror above a basin) */
  mounted?: boolean
}

export const FURNITURE_SPECS: Record<string, FurnitureSpec> = {
  bed_double: { label: 'Double bed', w: 1.55, d: 2.0, h: 1.0, minW: 1.35, maxW: 1.9, minD: 1.9, maxD: 2.2, rooms: ['bedroom'] },
  bed_single: { label: 'Single bed', w: 0.95, d: 1.95, h: 0.9, minW: 0.8, maxW: 1.1, minD: 1.8, maxD: 2.1, rooms: ['bedroom'] },
  nightstand: { label: 'Bedside table', w: 0.4, d: 0.4, h: 0.5, minW: 0.3, maxW: 0.6, minD: 0.3, maxD: 0.5, rooms: ['bedroom'] },
  wardrobe: { label: 'Wardrobe', w: 1.2, d: 0.55, h: 2.0, minW: 0.6, maxW: 2.4, minD: 0.45, maxD: 0.7, rooms: ['bedroom', 'study', 'store', 'other'], tall: true },
  dresser: { label: 'Dresser', w: 1.0, d: 0.45, h: 0.85, minW: 0.6, maxW: 1.6, minD: 0.4, maxD: 0.6, rooms: ['bedroom', 'living', 'other'] },
  desk: { label: 'Desk', w: 1.3, d: 0.6, h: 0.76, minW: 0.9, maxW: 2.0, minD: 0.5, maxD: 0.8, rooms: ['bedroom', 'study', 'office', 'living'] },
  office_chair: { label: 'Desk chair', w: 0.48, d: 0.48, h: 0.95, minW: 0.4, maxW: 0.6, minD: 0.4, maxD: 0.6, rooms: ['bedroom', 'study', 'office', 'living'] },
  bookshelf: { label: 'Bookshelf', w: 0.9, d: 0.3, h: 1.8, minW: 0.5, maxW: 2.0, minD: 0.25, maxD: 0.45, rooms: ['bedroom', 'study', 'office', 'living', 'store'], tall: true },
  sofa: { label: 'Sofa', w: 2.1, d: 0.9, h: 0.88, minW: 1.4, maxW: 3.0, minD: 0.8, maxD: 1.1, rooms: ['living', 'study', 'office'] },
  sofa_l: { label: 'L-shaped sofa', w: 2.6, d: 1.6, h: 0.88, minW: 2.2, maxW: 3.4, minD: 1.4, maxD: 2.0, rooms: ['living'] },
  coffee_table: { label: 'Coffee table', w: 1.0, d: 0.5, h: 0.4, minW: 0.6, maxW: 1.4, minD: 0.4, maxD: 0.8, rooms: ['living', 'study'] },
  side_table: { label: 'Side table', w: 0.45, d: 0.45, h: 0.5, minW: 0.3, maxW: 0.7, minD: 0.3, maxD: 0.7, rooms: ['living', 'bedroom', 'study'] },
  tv_unit: { label: 'TV unit', w: 1.5, d: 0.4, h: 1.05, minW: 0.9, maxW: 2.4, minD: 0.3, maxD: 0.6, rooms: ['living', 'bedroom'] },
  rug: { label: 'Rug', w: 2.2, d: 1.5, h: 0.02, minW: 1.0, maxW: 4.0, minD: 0.8, maxD: 3.0, rooms: ['living', 'bedroom', 'dining', 'study'], overlay: true },
  dining_table: { label: 'Dining table', w: 1.6, d: 0.9, h: 0.76, minW: 1.0, maxW: 2.4, minD: 0.7, maxD: 1.1, rooms: ['dining', 'kitchen', 'living'] },
  dining_chair: { label: 'Dining chair', w: 0.44, d: 0.44, h: 0.9, minW: 0.38, maxW: 0.55, minD: 0.38, maxD: 0.55, rooms: ['dining', 'kitchen', 'living'] },
  counter: { label: 'Kitchen counter', w: 3.0, d: 0.6, h: 0.92, minW: 0.8, maxW: 5.0, minD: 0.55, maxD: 0.7, rooms: ['kitchen'] },
  sink: { label: 'Sink', w: 0.6, d: 0.5, h: 1.1, minW: 0.5, maxW: 1.0, minD: 0.4, maxD: 0.6, rooms: ['kitchen'], mounted: true },
  stove: { label: 'Stove / cooktop', w: 0.6, d: 0.55, h: 0.96, minW: 0.5, maxW: 0.9, minD: 0.45, maxD: 0.65, rooms: ['kitchen'], mounted: true },
  fridge: { label: 'Refrigerator', w: 0.7, d: 0.7, h: 1.8, minW: 0.55, maxW: 0.95, minD: 0.55, maxD: 0.8, rooms: ['kitchen'], tall: true },
  island: { label: 'Island / dining counter', w: 1.6, d: 0.8, h: 0.92, minW: 1.0, maxW: 3.0, minD: 0.6, maxD: 1.1, rooms: ['kitchen'] },
  toilet: { label: 'Toilet', w: 0.4, d: 0.65, h: 0.8, minW: 0.35, maxW: 0.5, minD: 0.55, maxD: 0.75, rooms: ['bathroom'] },
  basin: { label: 'Washbasin', w: 0.55, d: 0.42, h: 0.86, minW: 0.4, maxW: 0.9, minD: 0.35, maxD: 0.55, rooms: ['bathroom'] },
  mirror: { label: 'Mirror', w: 0.6, d: 0.04, h: 1.8, minW: 0.4, maxW: 1.2, minD: 0.03, maxD: 0.06, rooms: ['bathroom'], mounted: true },
  shower: { label: 'Shower', w: 0.9, d: 0.9, h: 1.9, minW: 0.8, maxW: 1.2, minD: 0.8, maxD: 1.2, rooms: ['bathroom'] },
  bathtub: { label: 'Bathtub', w: 1.6, d: 0.75, h: 0.57, minW: 1.4, maxW: 1.9, minD: 0.7, maxD: 0.85, rooms: ['bathroom'] },
}

export function specOf(type: string): FurnitureSpec | undefined {
  return FURNITURE_SPECS[type]
}

export function typesForRoom(roomType: string): string[] {
  return Object.entries(FURNITURE_SPECS).filter(([, s]) => s.rooms.includes(roomType)).map(([t]) => t)
}

export function clampSize(type: string, w: number, d: number): { w: number; d: number } {
  const s = FURNITURE_SPECS[type]
  if (!s) return { w, d }
  return { w: Math.min(s.maxW, Math.max(s.minW, w)), d: Math.min(s.maxD, Math.max(s.minD, d)) }
}

export function itemRect(it: Pick<FurnitureItem, 'cx' | 'cz' | 'w' | 'd' | 'facing'>): Rect {
  const horiz = it.facing === 'N' || it.facing === 'S'
  const sx = horiz ? it.w : it.d, sz = horiz ? it.d : it.w
  return { x0: it.cx - sx / 2, x1: it.cx + sx / 2, z0: it.cz - sz / 2, z1: it.cz + sz / 2 }
}

export function rotateFacing(f: Facing): Facing {
  return f === 'N' ? 'E' : f === 'E' ? 'S' : f === 'S' ? 'W' : 'N'
}

/** Rect of an item described by its back wall: local (u along wall, v away from it) -> world rectangle. */
export function sub(r: Rect, back: Facing, u0: number, u1: number, v0: number, v1: number): Rect {
  let a: [number, number], b: [number, number]
  switch (back) {
    case 'N': a = [r.x0 + u0, r.z0 + v0]; b = [r.x0 + u1, r.z0 + v1]; break
    case 'S': a = [r.x0 + u0, r.z1 - v0]; b = [r.x0 + u1, r.z1 - v1]; break
    case 'W': a = [r.x0 + v0, r.z0 + u0]; b = [r.x0 + v1, r.z0 + u1]; break
    default: a = [r.x1 - v0, r.z0 + u0]; b = [r.x1 - v1, r.z0 + u1]; break
  }
  return { x0: Math.min(a[0], b[0]), x1: Math.max(a[0], b[0]), z0: Math.min(a[1], b[1]), z1: Math.max(a[1], b[1]) }
}

const C = {
  wood: '#8b6b4a', woodDark: '#5e4630', woodLight: '#b08a62', linen: '#f2efe9', white: '#fafaf7', fabric: '#5f7186', fabricLight: '#7488a0',
  cabinet: '#e4dfd5', worktop: '#3d4247', steel: '#aeb7bf', black: '#1f2227', porcelain: '#f5f5f2', water: '#d7e6ee', blanket: '#7f97ab',
  wardrobe: '#d8d1c4', wardrobeDoor: '#cdc5b6', chair: '#c8b59a', fridge: '#d3d8dc', rug: '#cdbfae', rugEdge: '#a99884', glass: '#cfe6f2', mirror: '#c6dbe7',
  burner: '#3a3d42',
}

/** Boxes (world coordinates, y relative to the floor) that make up one item. */
export function partsFor(it: FurnitureItem, floorY: number): FurniturePart[] {
  const spec = FURNITURE_SPECS[it.type]
  if (!spec) return []
  const R = itemRect(it)
  const back = it.facing
  const U = it.w, V = it.d
  const out: FurniturePart[] = []
  const box = (r: Rect, y0: number, y1: number, color: string) => {
    if (r.x1 - r.x0 < 1e-3 || r.z1 - r.z0 < 1e-3 || y1 - y0 < 1e-3) return
    out.push({ cx: (r.x0 + r.x1) / 2, cz: (r.z0 + r.z1) / 2, cy: floorY + (y0 + y1) / 2, sx: r.x1 - r.x0, sz: r.z1 - r.z0, sy: y1 - y0, color, roomId: it.room_id, kind: it.type, itemId: it.id })
  }
  const S = (u0: number, u1: number, v0: number, v1: number) => sub(R, back, u0, u1, v0, v1)
  const legs = (r: Rect, h: number, color: string, t = 0.05) => {
    for (const [x, z] of [[r.x0, r.z0], [r.x1 - t, r.z0], [r.x0, r.z1 - t], [r.x1 - t, r.z1 - t]]) box({ x0: x, x1: x + t, z0: z, z1: z + t }, 0, h, color)
  }

  switch (it.type) {
    case 'bed_double':
    case 'bed_single': {
      box(S(0, U, 0, V), 0, 0.28, C.wood)
      box(S(0.03, U - 0.03, 0.03, V - 0.03), 0.28, 0.5, C.linen)
      box(S(0, U, 0, 0.08), 0.28, 1.0, C.woodDark)
      box(S(0.03, U - 0.03, V * 0.45, V - 0.03), 0.5, 0.53, C.blanket)
      const n = U > 1.3 ? 2 : 1, pw = (U - 0.3 - 0.1 * (n - 1)) / n
      for (let i = 0; i < n; i++) box(S(0.15 + i * (pw + 0.1), 0.15 + i * (pw + 0.1) + pw, 0.14, 0.5), 0.5, 0.6, C.white)
      break
    }
    case 'nightstand':
      box(S(0, U, 0, V), 0, 0.5, C.wood); box(S(0.03, U - 0.03, 0.03, V - 0.03), 0.5, 0.52, C.woodDark); break
    case 'wardrobe': {
      box(S(0, U, 0, V), 0, 2.0, C.wardrobe)
      const half = (U - 0.02) / 2
      box(S(0.02, half, V - 0.02, V), 0.05, 1.95, C.wardrobeDoor); box(S(half + 0.02, U - 0.02, V - 0.02, V), 0.05, 1.95, C.wardrobeDoor)
      break
    }
    case 'dresser':
      box(S(0, U, 0, V), 0, 0.82, C.wood); box(S(-0.01, U + 0.01, -0.01, V + 0.01), 0.82, 0.85, C.woodDark); break
    case 'desk': {
      box(S(0, U, 0, V), 0.72, 0.76, C.woodLight)
      box(S(0, 0.04, 0, V), 0, 0.72, C.wood); box(S(U - 0.04, U, 0, V), 0, 0.72, C.wood); box(S(0.04, U - 0.04, 0, 0.03), 0.3, 0.72, C.wood)
      break
    }
    case 'office_chair':
      box(S(0, U, 0, V), 0.42, 0.47, C.fabric); box(S(0, U, 0, 0.05), 0.47, 0.95, C.fabric); box(S(U * 0.4, U * 0.6, V * 0.4, V * 0.6), 0, 0.42, C.black); break
    case 'bookshelf':
      box(S(0, U, 0, V), 0, 1.8, C.wood); for (const y of [0.45, 0.9, 1.35]) box(S(0.03, U - 0.03, V - 0.01, V), y, y + 0.03, C.woodDark); break
    case 'sofa': {
      const arm = 0.2
      box(S(0, U, 0, V), 0, 0.4, C.fabric); box(S(0, U, 0, 0.22), 0.4, 0.88, C.fabric)
      box(S(0, arm, 0.22, V), 0.4, 0.62, C.fabric); box(S(U - arm, U, 0.22, V), 0.4, 0.62, C.fabric)
      box(S(arm, U - arm, 0.22, V), 0.4, 0.5, C.fabricLight)
      break
    }
    case 'sofa_l': {
      const sd = 0.9, arm = 0.2
      box(S(0, U, 0, sd), 0, 0.4, C.fabric); box(S(0, U, 0, 0.22), 0.4, 0.88, C.fabric)
      box(S(0, arm, 0.22, sd), 0.4, 0.62, C.fabric)
      box(S(U - sd, U, sd, V), 0, 0.4, C.fabric); box(S(U - arm, U, sd, V), 0.4, 0.62, C.fabric)
      box(S(arm, U - sd, 0.22, sd), 0.4, 0.5, C.fabricLight); box(S(U - sd, U - arm, 0.22, V), 0.4, 0.5, C.fabricLight)
      break
    }
    case 'coffee_table':
      box(S(0, U, 0, V), 0.36, 0.4, C.woodLight); legs(R, 0.36, C.woodDark, 0.04); break
    case 'side_table':
      box(S(0, U, 0, V), 0.46, 0.5, C.woodLight); legs(R, 0.46, C.woodDark, 0.04); break
    case 'tv_unit':
      box(S(0, U, 0, V), 0, 0.45, C.woodDark); box(S(U * 0.15, U * 0.85, V * 0.3, V * 0.45), 0.5, 1.05, C.black); break
    case 'rug':
      box(S(0, U, 0, V), 0, 0.02, C.rugEdge); box(S(0.08, U - 0.08, 0.08, V - 0.08), 0.02, 0.025, C.rug); break
    case 'dining_table':
      box(S(0, U, 0, V), 0.72, 0.76, C.woodLight); legs(R, 0.72, C.woodDark); break
    case 'dining_chair':
      box(S(0, U, 0, V), 0.42, 0.46, C.chair); box(S(0, U, 0, 0.04), 0.46, 0.9, C.chair); legs(R, 0.42, C.woodDark, 0.035); break
    case 'counter':
      box(S(0, U, 0, V), 0, 0.88, C.cabinet); box(S(0, U, 0, V + 0.02), 0.88, 0.92, C.worktop)
      for (let u = 0.6; u < U - 0.1; u += 0.6) box(S(u - 0.005, u + 0.005, V - 0.01, V), 0.05, 0.85, C.steel)
      break
    case 'sink':
      box(S(0.04, U - 0.04, 0.05, V - 0.05), 0.92, 0.95, C.steel); box(S(U / 2 - 0.02, U / 2 + 0.02, 0.02, 0.08), 0.92, 1.1, C.steel); break
    case 'stove':
      box(S(0, U, 0, V), 0.92, 0.94, C.black)
      for (const [a, b] of [[0.28, 0.3], [0.72, 0.3], [0.28, 0.72], [0.72, 0.72]]) box(S(U * a - 0.07, U * a + 0.07, V * b - 0.07, V * b + 0.07), 0.94, 0.96, C.burner)
      break
    case 'fridge':
      box(S(0, U, 0, V), 0, 1.8, C.fridge); box(S(U - 0.08, U - 0.05, V - 0.02, V), 0.9, 1.5, C.steel); box(S(0.02, U - 0.02, V - 0.01, V), 1.18, 1.2, C.steel); break
    case 'island':
      box(S(0, U, 0, V), 0, 0.88, C.cabinet); box(S(-0.03, U + 0.03, -0.03, V + 0.03), 0.88, 0.92, C.worktop); break
    case 'toilet':
      box(S(0.02, U - 0.02, V * 0.3, V), 0, 0.4, C.porcelain); box(S(0, U, 0, V * 0.3), 0, 0.8, C.porcelain); box(S(0.04, U - 0.04, V * 0.3, V - 0.03), 0.4, 0.43, C.white); break
    case 'basin':
      box(S(0, U, 0, V), 0, 0.8, C.cabinet); box(S(0.03, U - 0.03, 0.03, V - 0.03), 0.8, 0.86, C.porcelain); box(S(U / 2 - 0.015, U / 2 + 0.015, 0.02, 0.07), 0.86, 1.0, C.steel); break
    case 'mirror':
      box(S(0, U, 0, V), 1.0, 1.8, C.mirror); break
    case 'shower':
      box(S(0, U, 0, V), 0, 0.05, C.water); box(S(0, U, V - 0.02, V), 0.05, 1.9, C.glass); box(S(U - 0.02, U, 0, V), 0.05, 1.9, C.glass); break
    case 'bathtub':
      box(S(0, U, 0, V), 0, 0.57, C.porcelain); box(S(0.07, U - 0.07, 0.07, V - 0.07), 0.56, 0.58, C.water); break
    default:
      box(S(0, U, 0, V), 0, spec.h, C.wood)
  }
  return out
}
