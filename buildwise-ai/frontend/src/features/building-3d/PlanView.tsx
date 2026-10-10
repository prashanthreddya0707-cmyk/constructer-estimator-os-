import { useMemo, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { itemRect } from './furniture'
import type { FloorModel, Model3D } from './model'
import { buildPlanShapes, type PlanShapes } from './plan2d'

const ROOM_FILL: Record<string, string> = {
  living: '#e0ecfb', bedroom: '#ece6fa', kitchen: '#fdf1d2', bathroom: '#d9f3ef', dining: '#fde4e7', study: '#dcf4e8', store: '#e8ecf1',
  balcony: '#eaf6d4', corridor: '#f1f4f8', staircase: '#fbe3ef', office: '#dcf0fb', other: '#edf0f4',
}
const FURN_FILL: Record<string, string> = {
  rug: '#d9cdbd', sofa: '#7d8fa5', sofa_l: '#7d8fa5', bed_double: '#f0ece4', bed_single: '#f0ece4', counter: '#8a8f94', island: '#8a8f94', fridge: '#cfd5da',
  toilet: '#ffffff', basin: '#ffffff', bathtub: '#ffffff', shower: '#d7e6ee', mirror: '#c6dbe7', sink: '#b9c2ca', stove: '#4a4d52',
}

export type PlanMode = 'select' | 'add-door' | 'add-window'

interface Props {
  model: Model3D
  floorIndex: number
  selectedRoomId: string | null
  selectedFurnitureId: string | null
  selectedOpeningId: string | null
  onSelectRoom: (id: string | null) => void
  onSelectFurniture: (id: string | null) => void
  onSelectOpening: (id: string | null) => void
  showFurniture: boolean
  showLabels: boolean
  mode: PlanMode
  /** returns a reason string when the furniture cannot stand there, null when fine */
  canPlaceFurniture: (id: string, cx: number, cz: number) => string | null
  onMoveFurniture: (id: string, cx: number, cz: number) => void
  /** returns true when the opening can sit at this centre */
  canMoveOpening: (id: string, center: number) => boolean
  onMoveOpening: (id: string, center: number) => void
  onAddOpening: (kind: 'door' | 'window', wallId: string, along: number) => void
  onMessage: (message: string) => void
}

const snap = (v: number, s = 0.05) => Math.round(v / s) * s

export function PlanView(props: Props) {
  const { model, floorIndex, mode } = props
  const floor: FloorModel | undefined = model.floors.find((f) => f.index === floorIndex) ?? model.floors[0]
  const shapes: PlanShapes | null = useMemo(() => (floor ? buildPlanShapes(floor, model) : null), [floor, model])
  const svgRef = useRef<SVGSVGElement>(null)
  const [drag, setDrag] = useState<{ kind: 'furniture' | 'opening'; id: string; cx: number; cz: number; ok: boolean; dx: number; dz: number } | null>(null)

  if (!floor || !shapes) return null
  const { view, fontSize: fs } = shapes
  const lw = Math.max(0.03, fs * 0.12)

  const toPlan = (e: React.PointerEvent | React.MouseEvent) => {
    const svg = svgRef.current!
    const pt = svg.createSVGPoint()
    pt.x = e.clientX; pt.y = e.clientY
    const m = svg.getScreenCTM()!.inverse()
    const p = pt.matrixTransform(m)
    return { x: p.x, z: p.y }
  }

  const startFurnitureDrag = (e: React.PointerEvent, id: string) => {
    if (mode !== 'select') return
    e.stopPropagation()
    props.onSelectFurniture(id)
    const it = floor.furnitureItems.find((i) => i.id === id)!
    const p = toPlan(e)
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    setDrag({ kind: 'furniture', id, cx: it.cx, cz: it.cz, ok: true, dx: it.cx - p.x, dz: it.cz - p.z })
  }
  const startOpeningDrag = (e: React.PointerEvent, id: string) => {
    if (mode !== 'select') return
    e.stopPropagation()
    props.onSelectOpening(id)
    const o = floor.openings.find((x) => x.id === id)!
    const p = toPlan(e)
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    setDrag({ kind: 'opening', id, cx: o.center, cz: 0, ok: true, dx: o.center - (o.orientation === 'x' ? p.x : p.z), dz: 0 })
  }
  const onMove = (e: React.PointerEvent) => {
    if (!drag) return
    const p = toPlan(e)
    if (drag.kind === 'furniture') {
      const cx = snap(p.x + drag.dx), cz = snap(p.z + drag.dz)
      setDrag({ ...drag, cx, cz, ok: props.canPlaceFurniture(drag.id, cx, cz) === null })
    } else {
      const o = floor.openings.find((x) => x.id === drag.id)!
      const c = snap((o.orientation === 'x' ? p.x : p.z) + drag.dx)
      setDrag({ ...drag, cx: c, ok: props.canMoveOpening(drag.id, c) })
    }
  }
  const onUp = () => {
    if (!drag) return
    if (drag.kind === 'furniture') {
      const it = floor.furnitureItems.find((i) => i.id === drag.id)!
      if (Math.abs(drag.cx - it.cx) > 1e-6 || Math.abs(drag.cz - it.cz) > 1e-6) {
        const why = props.canPlaceFurniture(drag.id, drag.cx, drag.cz)
        if (why) props.onMessage(`Can't place it there: ${why}`)
        else props.onMoveFurniture(drag.id, drag.cx, drag.cz)
      }
    } else {
      const o = floor.openings.find((x) => x.id === drag.id)!
      if (Math.abs(drag.cx - o.center) > 1e-6) {
        if (props.canMoveOpening(drag.id, drag.cx)) props.onMoveOpening(drag.id, drag.cx)
        else props.onMessage('Not enough free wall space there (walls, corners and other openings must stay clear).')
      }
    }
    setDrag(null)
  }

  const wallClick = (e: React.MouseEvent, wallId: string) => {
    if (mode === 'select') return
    e.stopPropagation()
    const p = toPlan(e)
    const w = floor.walls.find((x) => x.id === wallId)!
    props.onAddOpening(mode === 'add-door' ? 'door' : 'window', wallId, snap(w.orientation === 'x' ? p.x : p.z))
  }

  const L = model.length, W = model.width
  const dimY = view.y + view.h - fs * 2.2, dimX = view.x + view.w - fs * 2.2
  const tick = fs * 0.5

  return (
    <svg ref={svgRef} viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`} className={cn('h-full w-full touch-none select-none bg-white', mode !== 'select' && 'cursor-crosshair')}
      role="img" aria-label={`2D floor plan of floor ${floor.index}`} onPointerMove={onMove} onPointerUp={onUp}
      onClick={() => { props.onSelectRoom(null); props.onSelectFurniture(null); props.onSelectOpening(null) }}>
      <defs>
        <pattern id="plan-grid" width="1" height="1" patternUnits="userSpaceOnUse"><path d="M 1 0 L 0 0 0 1" fill="none" stroke="#eef1f5" strokeWidth={lw * 0.4} /></pattern>
      </defs>
      <rect x={view.x} y={view.y} width={view.w} height={view.h} fill="url(#plan-grid)" />
      <rect {...shapes.footprint} fill="#fff" />

      {shapes.rooms.map((r) => (
        <g key={r.id} onClick={(e) => { if (mode !== 'select') return; e.stopPropagation(); props.onSelectRoom(r.id === props.selectedRoomId ? null : r.id) }} className={mode === 'select' ? 'cursor-pointer' : ''}>
          <rect {...r.rect} fill={ROOM_FILL[r.type] ?? ROOM_FILL.other} />
          {r.id === props.selectedRoomId && <rect {...r.rect} fill="#f97316" fillOpacity={0.22} stroke="#ea580c" strokeWidth={lw * 1.5} />}
        </g>
      ))}

      {props.showFurniture && shapes.furniture.map((f) => {
        const moving = drag?.kind === 'furniture' && drag.id === f.id
        const it = floor.furnitureItems.find((i) => i.id === f.id)!
        const r = moving ? itemRect({ ...it, cx: drag.cx, cz: drag.cz }) : null
        const x = r ? r.x0 : f.rect.x, y = r ? r.z0 : f.rect.y
        const sel = f.id === props.selectedFurnitureId
        return (
          <g key={f.id} onPointerDown={(e) => startFurnitureDrag(e, f.id)} className={mode === 'select' ? 'cursor-grab' : ''} onClick={(e) => e.stopPropagation()}>
            <rect x={x} y={y} width={f.rect.w} height={f.rect.h} rx={Math.min(f.rect.w, f.rect.h) * 0.08} fill={FURN_FILL[f.type] ?? '#c9b79c'} fillOpacity={f.type === 'rug' ? 0.7 : 0.95}
              stroke={moving ? (drag.ok ? '#16a34a' : '#dc2626') : sel ? '#ea580c' : '#64748b'} strokeWidth={sel || moving ? lw * 1.6 : lw * 0.6} />
          </g>
        )
      })}

      {shapes.walls.map((w, i) => (
        <rect key={i} x={w.x} y={w.y} width={w.w} height={w.h} fill={w.exterior ? '#1e293b' : '#334155'} onClick={(e) => wallClick(e, w.wallId)}
          className={mode !== 'select' ? 'cursor-crosshair' : ''} />
      ))}
      {mode !== 'select' && shapes.walls.map((w, i) => ( // fat invisible hit area so thin walls are easy to click
        <rect key={`h${i}`} x={w.x - 0.15} y={w.y - 0.15} width={w.w + 0.3} height={w.h + 0.3} fill="transparent" onClick={(e) => wallClick(e, w.wallId)} className="cursor-crosshair" />
      ))}

      {shapes.windows.map((wd) => {
        const sel = wd.id === props.selectedOpeningId, moving = drag?.kind === 'opening' && drag.id === wd.id
        const o = wd.opening
        const shift = moving ? drag.cx - o.center : 0
        const tr = o.orientation === 'x' ? `translate(${shift} 0)` : `translate(0 ${shift})`
        return (
          <g key={wd.id} transform={tr} onPointerDown={(e) => startOpeningDrag(e, wd.id)} onClick={(e) => e.stopPropagation()} className={mode === 'select' ? 'cursor-grab' : ''}>
            <rect {...wd.rect} fill="#fff" stroke={moving ? (drag.ok ? '#16a34a' : '#dc2626') : sel ? '#ea580c' : '#38bdf8'} strokeWidth={sel || moving ? lw * 1.8 : lw * 0.8} />
            {wd.glass.map((g, k) => <line key={k} x1={g[0]} y1={g[1]} x2={g[2]} y2={g[3]} stroke="#38bdf8" strokeWidth={lw * 0.7} />)}
          </g>
        )
      })}

      {shapes.doors.map((d) => {
        const sel = d.id === props.selectedOpeningId, moving = drag?.kind === 'opening' && drag.id === d.id
        const o = d.opening
        const shift = moving ? drag.cx - o.center : 0
        const tr = o.orientation === 'x' ? `translate(${shift} 0)` : `translate(0 ${shift})`
        const col = moving ? (drag.ok ? '#16a34a' : '#dc2626') : sel ? '#ea580c' : d.entrance ? '#b45309' : '#92613a'
        const t = o.thickness
        const gap = o.orientation === 'x'
          ? { x: o.center - o.width / 2, y: o.line - t / 2, width: o.width, height: t }
          : { x: o.line - t / 2, y: o.center - o.width / 2, width: t, height: o.width }
        return (
          <g key={d.id} transform={tr} onPointerDown={(e) => startOpeningDrag(e, d.id)} onClick={(e) => e.stopPropagation()} className={mode === 'select' ? 'cursor-grab' : ''}>
            <rect {...gap} fill="#fff" fillOpacity={0.9} />
            <path d={d.arc} fill="none" stroke={col} strokeWidth={lw * 0.7} strokeDasharray={`${lw * 2} ${lw * 2}`} />
            <line x1={d.hinge[0]} y1={d.hinge[1]} x2={d.openEnd[0]} y2={d.openEnd[1]} stroke={col} strokeWidth={lw * 1.6} strokeLinecap="round" />
            {/* wide invisible grab area */}
            <rect x={gap.x - 0.1} y={gap.y - 0.1} width={gap.width + 0.2} height={gap.height + 0.2} fill="transparent" />
          </g>
        )
      })}

      {shapes.rooms.map((r) => {
        const small = r.rect.w < fs * 7 || r.rect.h < fs * 3.2
        return (
          <g key={`t${r.id}`} pointerEvents="none" textAnchor="middle">
            <text x={r.rect.x + r.rect.w / 2} y={r.rect.y + r.rect.h / 2 - (small ? 0 : fs * 0.2)} fontSize={fs * (small ? 0.8 : 1)} fontWeight={700} fill="#0b1f3a" dominantBaseline="middle">{r.name}</text>
            {!small && <text x={r.rect.x + r.rect.w / 2} y={r.rect.y + r.rect.h / 2 + fs * 0.95} fontSize={fs * 0.78} fill="#475569" dominantBaseline="middle">{r.dims} · {r.area.toFixed(1)} m²</text>}
          </g>
        )
      })}

      {/* overall dimensions */}
      <g pointerEvents="none" stroke="#0b1f3a" strokeWidth={lw * 0.7} fill="#0b1f3a" fontSize={fs * 0.95}>
        <line x1={-L / 2} y1={dimY} x2={L / 2} y2={dimY} />
        <line x1={-L / 2} y1={dimY - tick} x2={-L / 2} y2={dimY + tick} /><line x1={L / 2} y1={dimY - tick} x2={L / 2} y2={dimY + tick} />
        <text x={0} y={dimY - fs * 0.5} textAnchor="middle" stroke="none">{L.toFixed(2)} m</text>
        <line x1={dimX} y1={-W / 2} x2={dimX} y2={W / 2} />
        <line x1={dimX - tick} y1={-W / 2} x2={dimX + tick} y2={-W / 2} /><line x1={dimX - tick} y1={W / 2} x2={dimX + tick} y2={W / 2} />
        <text x={dimX - fs * 0.5} y={0} textAnchor="middle" stroke="none" transform={`rotate(-90 ${dimX - fs * 0.5} 0)`}>{W.toFixed(2)} m</text>
      </g>
      <text x={view.x + fs * 0.6} y={view.y + fs * 1.4} fontSize={fs * 0.9} fill="#64748b" pointerEvents="none">Floor {floor.index} · N ↑</text>
    </svg>
  )
}
