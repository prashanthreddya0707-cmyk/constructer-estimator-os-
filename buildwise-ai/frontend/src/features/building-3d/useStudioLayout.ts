import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '@/lib/api'
import type { ProjectDetail } from '@/types'
import {
  circulationOk, clampSize, findFreeSpot, FURNITURE_SPECS, placementProblem, rotateFacing, type FurnitureItem,
} from './furniture'
import { makeLayout, parseLayout, planSignature, type SavedFurniture, type SavedLayout, type SavedOpening } from './layoutStore'
import { buildModel, DOOR_SIZES, roomEdges, searchSlot, slotFree, type FloorModel, type Model3D, type Opening, type RoomBox } from './model'

interface Notify { success: (m: string) => void; error: (m: string) => void; info: (m: string) => void }

/** Working copy of the saved layout (custom openings / furniture) plus every edit operation, all validated by the geometry core. */
export function useStudioLayout(p: ProjectDetail | undefined, reload: () => Promise<void>, notify: Notify) {
  const [layout, setLayout] = useState<SavedLayout | null>(null)
  const [dirty, setDirty] = useState(false)
  const [autoFurnish, setAuto] = useState(true)
  const [saving, setSaving] = useState(false)
  const initFor = useRef<string | undefined>(undefined)
  const synced = useRef('')

  // initialise from the project; unsaved edits survive a plain reload of the same project
  useEffect(() => {
    if (!p) return
    if (dirty && initFor.current === p.id) return
    initFor.current = p.id
    const l = parseLayout(p.layout)
    setLayout(l); setAuto(l?.settings.autoFurnish !== false); setDirty(false)
  }, [p?.id, p?.layout]) // eslint-disable-line react-hooks/exhaustive-deps

  const model: Model3D = useMemo(() => buildModel(p, { layout, autoFurnish }), [p, layout, autoFurnish])
  const L = model.length, W = model.width

  const base = useCallback((): SavedLayout => layout ?? makeLayout({
    signature: p ? planSignature(p, p.rooms) : '', settings: { autoFurnish }, openings: null, furniture: null, summary: model.resolved.summary,
  }), [layout, p, autoFurnish, model])
  const commit = (next: SavedLayout) => { setLayout(next); setDirty(true) }

  const floorOf = (pred: (f: FloorModel) => boolean) => model.floors.find(pred)
  const roomAt = (f: FloorModel, x: number, z: number) => f.rooms.find((r) => x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1)

  // ---- furniture -----------------------------------------------------------------------------------------------
  const toLocal = (it: FurnitureItem): SavedFurniture => ({ ...it, cx: it.cx + L / 2, cz: it.cz + W / 2 })
  const editFurniture = (fn: (items: SavedFurniture[]) => SavedFurniture[]) => {
    commit({ ...base(), furniture: { items: fn(model.resolved.furniture.map((i) => ({ ...i }))), room_sigs: model.resolved.roomSigs } })
  }
  /** Checks a candidate (world coordinates) against its target room; returns a reason or null. */
  const furnitureProblem = (candidate: FurnitureItem): string | null => {
    const f = floorOf((fl) => fl.rooms.some((r) => r.id === candidate.room_id))
    const room = f?.rooms.find((r) => r.id === candidate.room_id)
    if (!f || !room) return 'Unknown room.'
    const others = f.furnitureItems.filter((i) => i.room_id === room.id && i.id !== candidate.id)
    const why = placementProblem(candidate, room, f.openings, others)
    if (why) return why
    return circulationOk(room, [...others, candidate], f.openings) ? null : 'It would block the walking path to a door.'
  }
  const itemById = (id: string): { item: FurnitureItem; floor: FloorModel } | null => {
    for (const f of model.floors) { const item = f.furnitureItems.find((i) => i.id === id); if (item) return { item, floor: f } }
    return null
  }
  const canPlaceFurniture = (id: string, cx: number, cz: number): string | null => {
    const hit = itemById(id)
    if (!hit) return 'Unknown item.'
    const target = roomAt(hit.floor, cx, cz) ?? hit.floor.rooms.find((r) => r.id === hit.item.room_id)
    return furnitureProblem({ ...hit.item, cx, cz, room_id: target?.id ?? hit.item.room_id })
  }
  const moveFurniture = (id: string, cx: number, cz: number) => {
    const hit = itemById(id)
    if (!hit) return
    const target = roomAt(hit.floor, cx, cz)
    editFurniture((items) => items.map((i) => (i.id === id ? { ...i, cx: cx + L / 2, cz: cz + W / 2, room_id: target?.id ?? i.room_id } : i)))
  }
  const tryChange = (id: string, patch: Partial<FurnitureItem>, what: string) => {
    const hit = itemById(id)
    if (!hit) return
    const next = { ...hit.item, ...patch }
    const why = furnitureProblem(next)
    if (why) { notify.error(`Cannot ${what}: ${why}`); return }
    editFurniture((items) => items.map((i) => (i.id === id ? toLocal(next) : i)))
  }
  const rotateFurniture = (id: string) => { const h = itemById(id); if (h) tryChange(id, { facing: rotateFacing(h.item.facing) }, 'rotate it') }
  const resizeFurniture = (id: string, w: number, d: number) => {
    const h = itemById(id)
    if (!h || !(w > 0) || !(d > 0)) return
    const c = clampSize(h.item.type, w, d)
    tryChange(id, c, 'resize it')
  }
  const nudgeFurniture = (id: string, dx: number, dz: number) => { const h = itemById(id); if (h) tryChange(id, { cx: h.item.cx + dx, cz: h.item.cz + dz }, 'move it') }
  const replaceFurniture = (id: string, type: string) => {
    const s = FURNITURE_SPECS[type]
    if (s) tryChange(id, { type, w: s.w, d: s.d }, `replace it with ${s.label.toLowerCase()}`)
  }
  const deleteFurniture = (id: string) => editFurniture((items) => items.filter((i) => i.id !== id))
  const addFurniture = (roomId: string, type: string) => {
    const f = floorOf((fl) => fl.rooms.some((r) => r.id === roomId))
    const room = f?.rooms.find((r) => r.id === roomId)
    if (!f || !room) return null
    const spot = findFreeSpot(room, f.openings, f.furnitureItems.filter((i) => i.room_id === roomId), type)
    if (!spot) { notify.error(`There is no free space for a ${FURNITURE_SPECS[type].label.toLowerCase()} in ${room.name} without blocking doors or walkways.`); return null }
    editFurniture((items) => [...items, toLocal(spot)])
    return spot.id
  }
  const regenerateRoom = (roomId: string) => {
    const cur = base()
    if (!cur.furniture) { notify.info('This room already uses the automatic arrangement. Use “Regenerate all” for another arrangement.'); return }
    const { [roomId]: _gone, ...sigs } = cur.furniture.room_sigs
    void _gone
    commit({ ...cur, furniture: { items: cur.furniture.items.filter((i) => i.room_id !== roomId), room_sigs: sigs } })
  }
  const regenerateAll = () => {
    const cur = base()
    commit({ ...cur, furniture: null, settings: { ...cur.settings, furnishSeed: Number(cur.settings.furnishSeed ?? 0) + 1 } })
  }
  const restoreAutomatic = () => { const cur = base(); commit({ ...cur, furniture: null, settings: { ...cur.settings, furnishSeed: 0 } }) }
  const setAutoFurnish = (v: boolean) => { setAuto(v); const cur = base(); commit({ ...cur, settings: { ...cur.settings, autoFurnish: v } }) }

  // ---- openings -----------------------------------------------------------------------------------------------
  const editOpenings = (fn: (ops: SavedOpening[]) => SavedOpening[]) => commit({ ...base(), openings: fn(model.resolved.openings.map((o) => ({ ...o }))) })
  const openingById = (id: string): { o: Opening; floor: FloorModel } | null => {
    for (const f of model.floors) { const o = f.openings.find((x) => x.id === id); if (o) return { o, floor: f } }
    return null
  }
  const wallOf = (f: FloorModel, o: Opening) => f.walls.find((w) => w.id === o.wallId)!
  const off = (o: { orientation: 'x' | 'z' }) => (o.orientation === 'x' ? L / 2 : W / 2) // along-axis offset world -> local
  const canMoveOpening = (id: string, center: number) => { const h = openingById(id); return !!h && slotFree(wallOf(h.floor, h.o), center, h.o.width, id) }
  const moveOpening = (id: string, center: number) => { const h = openingById(id); if (h) editOpenings((ops) => ops.map((o) => (o.id === id ? { ...o, center: center + off(h.o) } : o))) }
  const nudgeOpening = (id: string, d: number) => {
    const h = openingById(id)
    if (!h) return
    const c = +(h.o.center + d).toFixed(3)
    if (!canMoveOpening(id, c)) { notify.error('Not enough free wall space there.'); return }
    moveOpening(id, c)
  }
  const changeOpening = (id: string, patch: { width?: number; height?: number; sill?: number }) => {
    const h = openingById(id)
    if (!h) return
    const H = model.height
    const width = patch.width ?? h.o.width, height = patch.height ?? h.o.height, sill = h.o.kind === 'door' ? 0 : patch.sill ?? h.o.sill
    if (!(width >= 0.4 && width <= 4) || !(height >= 0.5) || sill < 0 || sill + height > H - 0.1) { notify.error(`Size out of range (width 0.4–4 m; the opening must stay ${(H - 0.1).toFixed(1)} m or lower).`); return }
    if (!slotFree(wallOf(h.floor, h.o), h.o.center, width, id)) { notify.error('That width would hit a corner, a wall junction or another opening.'); return }
    editOpenings((ops) => ops.map((o) => (o.id === id ? { ...o, width, height, sill } : o)))
  }
  const doorCountFor = (f: FloorModel, room: RoomBox, ignore: string) => f.openings.filter((o) => o.kind === 'door' && !o.entrance && o.id !== ignore && roomEdges(room).some((e) => e.orient === o.orientation && Math.abs(e.line - o.line) <= 0.05 && o.center >= e.lo - 0.04 && o.center <= e.hi + 0.04)).length
  const deleteOpening = (id: string) => {
    const h = openingById(id)
    if (!h) return
    if (h.o.entrance) { notify.error('The building needs a main entrance. Move it instead of deleting it.'); return }
    const room = h.floor.rooms.find((r) => r.id === h.o.roomId)
    if (h.o.kind === 'door' && room && room.type !== 'corridor' && room.type !== 'staircase' && doorCountFor(h.floor, room, id) === 0) {
      notify.error(`${room.name} would have no doorway. Every room needs at least one door.`); return
    }
    editOpenings((ops) => ops.filter((o) => o.id !== id))
  }
  const flipOpening = (id: string) => {
    const h = openingById(id)
    if (!h) return
    const o = h.o
    const probe = o.orientation === 'x' ? { x: o.center, z: o.line + o.into * 0.4 } : { x: o.line + o.into * 0.4, z: o.center }
    const other = roomAt(h.floor, probe.x, probe.z)
    if (!other) { notify.error('This door opens to the outside; it can only swing into its own room.'); return }
    editOpenings((ops) => ops.map((x) => (x.id === id ? { ...x, into: (x.into * -1) as 1 | -1, room_id: other.id } : x)))
  }
  const addOpening = (kind: 'door' | 'window', wallId: string, along: number, preferredRoomId: string | null) => {
    const f = floorOf((fl) => fl.walls.some((w) => w.id === wallId))
    const wall = f?.walls.find((w) => w.id === wallId)
    if (!f || !wall) return null
    if (kind === 'window' && !wall.exterior) { notify.error('Windows can only be placed on exterior walls.'); return null }
    const sideRooms = ([1, -1] as const).map((into) => {
      const probe = wall.orientation === 'x' ? { x: along, z: wall.line - into * 0.35 } : { x: wall.line - into * 0.35, z: along }
      const r = roomAt(f, probe.x, probe.z)
      return r ? { room: r, into } : null
    }).filter(Boolean) as { room: RoomBox; into: 1 | -1 }[]
    const owner = sideRooms.find((s) => s.room.id === preferredRoomId) ?? sideRooms[0]
    if (!owner) { notify.error('That wall does not belong to a room.'); return null }
    const H = model.height
    const size = kind === 'door' ? (owner.room.type === 'bathroom' || sideRooms.some((s) => s.room.type === 'bathroom') ? DOOR_SIZES.bathroom : DOOR_SIZES.internal) : { w: 1.2, h: Math.min(1.2, H - Math.min(0.9, H * 0.3) - 0.3) }
    const sill = kind === 'door' ? 0 : Math.min(0.9, H * 0.3)
    const height = kind === 'door' ? Math.min(size.h, H - 0.3) : size.h
    const c = searchSlot(wall, wall.a0, wall.a1, size.w, along)
    if (c == null) { notify.error(`No free space for a ${kind} there: keep clear of corners, wall junctions and other openings.`); return null }
    const id = `n${Math.random().toString(36).slice(2, 9)}`
    editOpenings((ops) => [...ops, {
      id, kind, floor: f.index, orientation: wall.orientation, line: wall.line + (wall.orientation === 'x' ? W / 2 : L / 2), center: c + off(wall), width: size.w,
      height, sill, room_id: owner.room.id, into: owner.into,
    }])
    return id
  }

  // ---- persistence --------------------------------------------------------------------------------------------
  const payload = useCallback((m: Model3D, l: SavedLayout | null, auto: boolean): SavedLayout => makeLayout({
    signature: planSignature(p!, p!.rooms), settings: { ...(l?.settings ?? {}), autoFurnish: auto }, openings: l?.openings ?? null, furniture: l?.furniture ?? null, summary: m.resolved.summary,
  }), [p])

  const save = async () => {
    if (!p) return
    setSaving(true)
    try {
      await api.saveLayout(p.id, payload(model, layout, autoFurnish))
      synced.current = ''
      await reload()
      setDirty(false)
      api.runEstimate(p.id).catch(() => undefined) // keep the stored estimate in step with the saved openings
      notify.success('Layout saved with the project. Material estimates now use these doors and windows.')
    } catch (e) { notify.error(e instanceof Error ? e.message : 'Could not save the layout.') } finally { setSaving(false) }
  }
  const reset = async () => {
    if (!p) return
    try { await api.resetLayout(p.id); setLayout(null); setAuto(true); setDirty(false); synced.current = ''; await reload(); notify.success('Back to the fully automatic layout.') }
    catch (e) { notify.error(e instanceof Error ? e.message : 'Could not reset the layout.') }
  }
  /** Discard unsaved edits (go back to what is stored). */
  const discard = () => { const l = parseLayout(p?.layout); setLayout(l); setAuto(l?.settings.autoFurnish !== false); setDirty(false) }

  // The estimator reads a summary of the real openings. Keep it in step automatically (never while there are unsaved edits).
  useEffect(() => {
    if (!p || !model.ok || dirty || saving || !p.rooms.length) return
    const sig = planSignature(p, p.rooms)
    const summary = JSON.stringify(model.resolved.summary)
    if (layout && layout.signature === sig && JSON.stringify(layout.summary) === summary) return
    const key = sig + summary
    if (synced.current === key) return
    synced.current = key
    const t = setTimeout(() => {
      api.saveLayout(p.id, payload(model, layout, autoFurnish)).then(() => reload()).then(() => api.runEstimate(p.id)).catch(() => { synced.current = '' })
    }, 800)
    return () => clearTimeout(t)
  }, [p, model, layout, dirty, saving, autoFurnish, payload, reload])

  return {
    model, layout, dirty, saving, autoFurnish, hasCustomFurniture: !!layout?.furniture, hasCustomOpenings: !!layout?.openings,
    canPlaceFurniture, moveFurniture, rotateFurniture, resizeFurniture, nudgeFurniture, replaceFurniture, deleteFurniture, addFurniture,
    regenerateRoom, regenerateAll, restoreAutomatic, setAutoFurnish,
    canMoveOpening, moveOpening, nudgeOpening, changeOpening, deleteOpening, flipOpening, addOpening,
    save, reset, discard,
  }
}
