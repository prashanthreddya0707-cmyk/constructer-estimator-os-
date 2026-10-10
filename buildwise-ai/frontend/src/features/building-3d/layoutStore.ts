/**
 * What the Studio persists with a project (`project.layout`) besides the rooms themselves.
 * `openings` / `furniture` set to null mean "fully automatic": they are re-derived from the rooms every time.
 * Coordinates are in building-local metres (origin = top-left corner of the footprint, X along length, Z along width),
 * so they stay valid when the building is re-centred for rendering.
 */
import type { Room } from '@/types'

export interface SavedOpening {
  id: string
  kind: 'door' | 'window'
  floor: number
  orientation: 'x' | 'z'
  /** wall centreline across the axis (local metres) */
  line: number
  /** centre along the wall axis (local metres) */
  center: number
  width: number
  height: number
  sill: number
  room_id: string
  into: 1 | -1
  entrance?: boolean
}

export type Facing = 'N' | 'S' | 'E' | 'W'

export interface SavedFurniture {
  id: string
  room_id: string
  type: string
  /** centre of the footprint (local metres) */
  cx: number
  cz: number
  /** size along the wall / depth away from the wall (metres) */
  w: number
  d: number
  /** the wall the item's back is against */
  facing: Facing
}

export interface LayoutSummary {
  doors: { w: number; h: number; exterior: boolean }[]
  windows: { w: number; h: number }[]
}

export interface SavedLayout {
  version: 1
  signature: string
  settings: { autoFurnish?: boolean; [k: string]: boolean | number | string | undefined }
  openings: SavedOpening[] | null
  furniture: { items: SavedFurniture[]; room_sigs: Record<string, string> } | null
  summary: LayoutSummary
}

/** floor(v*1000 + 0.5): identical arithmetic to the Python side (no banker's rounding). */
export const mm = (v: number) => Math.floor(v * 1000 + 0.5)

type SigProject = { length: number; width: number; floors: number; height: number; wall_thickness: number }
type SigRoom = Pick<Room, 'id' | 'pos_x' | 'pos_y' | 'length' | 'width' | 'floor_number' | 'doors' | 'windows' | 'room_type'>

/** Must stay identical to plan_signature() in backend/app/services/estimation/layout.py. */
export function planSignature(p: SigProject, rooms: SigRoom[]): string {
  const head = [mm(p.length), mm(p.width), p.floors, mm(p.height), mm(p.wall_thickness)].join('|')
  const parts = [...rooms].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).map((r) =>
    [r.id, r.pos_x == null ? 'na' : mm(r.pos_x), r.pos_y == null ? 'na' : mm(r.pos_y), mm(r.length), mm(r.width), r.floor_number, r.doors, r.windows, r.room_type].join(':'))
  return `${head}|${parts.join(';')}`
}

/** Per-room geometry signature: furniture of a room is kept only while this is unchanged. */
export function roomSignature(r: Pick<Room, 'pos_x' | 'pos_y' | 'length' | 'width' | 'floor_number' | 'room_type'>): string {
  return [r.pos_x == null ? 'na' : mm(r.pos_x), r.pos_y == null ? 'na' : mm(r.pos_y), mm(r.length), mm(r.width), r.floor_number, r.room_type].join(':')
}

export function parseLayout(raw: unknown): SavedLayout | null {
  if (!raw || typeof raw !== 'object') return null
  const l = raw as Partial<SavedLayout>
  if (l.version !== 1 || typeof l.signature !== 'string') return null
  return {
    version: 1,
    signature: l.signature,
    settings: (l.settings ?? {}) as SavedLayout['settings'],
    openings: Array.isArray(l.openings) ? l.openings : null,
    furniture: l.furniture && Array.isArray(l.furniture.items) ? { items: l.furniture.items, room_sigs: l.furniture.room_sigs ?? {} } : null,
    summary: { doors: l.summary?.doors ?? [], windows: l.summary?.windows ?? [] },
  }
}

/** Build the object that `PUT /projects/{id}/layout` stores. `keep` says which parts are custom (null = automatic). */
export function makeLayout(args: {
  signature: string
  settings: SavedLayout['settings']
  openings: SavedOpening[] | null
  furniture: { items: SavedFurniture[]; room_sigs: Record<string, string> } | null
  summary: LayoutSummary
}): SavedLayout {
  return { version: 1, signature: args.signature, settings: args.settings, openings: args.openings, furniture: args.furniture, summary: args.summary }
}
