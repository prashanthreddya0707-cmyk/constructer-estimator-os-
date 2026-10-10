import { AlertTriangle, ArrowDown, ArrowLeft, ArrowRight, ArrowUp, CheckCircle2, DoorOpen, Info, Plus, RefreshCw, RotateCw, Trash2, Undo2, XCircle } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/feedback'
import { Field, Input, Select } from '@/components/ui/form'
import { cn } from '@/lib/utils'
import { FURNITURE_SPECS, typesForRoom, type FurnitureItem } from './furniture'
import type { Issue, Opening, RoomBox } from './model'

export function IssuesPanel({ issues, onSelectRoom }: { issues: Issue[]; onSelectRoom: (id: string) => void }) {
  const errors = issues.filter((i) => i.severity === 'error'), warnings = issues.filter((i) => i.severity === 'warning'), infos = issues.filter((i) => i.severity === 'info')
  return (
    <Card>
      <CardHeader title="Layout validation" action={errors.length ? <Badge tone="red">{errors.length} error{errors.length > 1 ? 's' : ''}</Badge> : warnings.length ? <Badge tone="amber">{warnings.length} warning{warnings.length > 1 ? 's' : ''}</Badge> : <Badge tone="green">Valid</Badge>} />
      <CardBody className="space-y-2 p-3">
        {issues.length === 0 && <p className="flex items-center gap-2 p-2 text-sm text-emerald-700"><CheckCircle2 className="h-4 w-4" /> Every room is reachable from the entrance, nothing overlaps and furniture leaves walkways clear.</p>}
        {[...errors, ...warnings, ...infos].map((i, k) => {
          const Icon = i.severity === 'error' ? XCircle : i.severity === 'warning' ? AlertTriangle : Info
          return (
            <button key={k} disabled={!i.roomId} onClick={() => i.roomId && onSelectRoom(i.roomId)}
              className={cn('flex w-full items-start gap-2 rounded-md p-2 text-left text-xs', i.severity === 'error' ? 'bg-red-50 text-red-800' : i.severity === 'warning' ? 'bg-amber-50 text-amber-900' : 'bg-slate-50 text-slate-700', i.roomId && 'hover:brightness-95')}>
              <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" /><span>{i.message}</span>
            </button>
          )
        })}
      </CardBody>
    </Card>
  )
}

export function OpeningPanel({ opening, owner, mode, onMode, onChange, onNudge, onFlip, onDelete }: {
  opening: Opening | null
  owner: RoomBox | null
  mode: 'select' | 'add-door' | 'add-window'
  onMode: (m: 'select' | 'add-door' | 'add-window') => void
  onChange: (patch: { width?: number; height?: number; sill?: number }) => void
  onNudge: (d: number) => void
  onFlip: () => void
  onDelete: () => void
}) {
  return (
    <Card>
      <CardHeader title="Doors & windows" description="Drag in the 2D plan, or use the controls." />
      <CardBody className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant={mode === 'add-door' ? 'accent' : 'outline'} onClick={() => onMode(mode === 'add-door' ? 'select' : 'add-door')}><DoorOpen className="h-3.5 w-3.5" /> Add door</Button>
          <Button size="sm" variant={mode === 'add-window' ? 'accent' : 'outline'} onClick={() => onMode(mode === 'add-window' ? 'select' : 'add-window')}><Plus className="h-3.5 w-3.5" /> Add window</Button>
        </div>
        {mode !== 'select' && <p className="rounded bg-orange-50 p-2 text-xs text-orange-800">Switch to <strong>2D Plan</strong> and click a wall to place a {mode === 'add-door' ? 'door' : 'window'}. Click the button again to cancel.</p>}
        {!opening ? <p className="text-sm text-slate-500">Select a door or window in the 2D plan to edit it.</p> : (
          <div className="space-y-3">
            <div className="flex items-center gap-2"><span className="font-semibold capitalize text-navy-900">{opening.entrance ? 'Main entrance' : opening.kind}</span>{owner && <Badge>{owner.name}</Badge>}</div>
            <div className="grid grid-cols-3 gap-2">
              <Field label="Width (m)"><Input type="number" step="0.05" value={+opening.width.toFixed(3)} onChange={(e) => onChange({ width: Number(e.target.value) })} /></Field>
              <Field label="Height (m)"><Input type="number" step="0.05" value={+opening.height.toFixed(3)} onChange={(e) => onChange({ height: Number(e.target.value) })} /></Field>
              {opening.kind === 'window' && <Field label="Sill (m)"><Input type="number" step="0.05" value={+opening.sill.toFixed(3)} onChange={(e) => onChange({ sill: Number(e.target.value) })} /></Field>}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => onNudge(-0.1)} aria-label="Move left / up"><ArrowLeft className="h-3.5 w-3.5" /> 10 cm</Button>
              <Button size="sm" variant="outline" onClick={() => onNudge(0.1)} aria-label="Move right / down">10 cm <ArrowRight className="h-3.5 w-3.5" /></Button>
              {opening.kind === 'door' && <Button size="sm" variant="outline" onClick={onFlip}><RefreshCw className="h-3.5 w-3.5" /> Flip swing</Button>}
              <Button size="sm" variant="danger-outline" onClick={onDelete}><Trash2 className="h-3.5 w-3.5" /> Delete</Button>
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  )
}

export function FurniturePanel({ room, items, selected, custom, autoFurnish, onToggleAuto, onSelect, onRotate, onNudge, onResize, onReplace, onDelete, onAdd, onRegenerateRoom, onRegenerateAll, onRestoreAuto }: {
  room: RoomBox | null
  items: FurnitureItem[]
  selected: FurnitureItem | null
  custom: boolean
  autoFurnish: boolean
  onToggleAuto: (v: boolean) => void
  onSelect: (id: string | null) => void
  onRotate: () => void
  onNudge: (dx: number, dz: number) => void
  onResize: (w: number, d: number) => void
  onReplace: (type: string) => void
  onDelete: () => void
  onAdd: (type: string) => void
  onRegenerateRoom: () => void
  onRegenerateAll: () => void
  onRestoreAuto: () => void
}) {
  const [addType, setAddType] = useState('')
  const allowed = room ? typesForRoom(room.type) : []
  const spec = selected ? FURNITURE_SPECS[selected.type] : null
  return (
    <Card>
      <CardHeader title="Furniture" description="Decorative only: never part of the plan or the material estimate." />
      <CardBody className="space-y-3">
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-orange-500" checked={autoFurnish} onChange={(e) => onToggleAuto(e.target.checked)} /> Automatic furnishing</label>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={onRegenerateAll}><RefreshCw className="h-3.5 w-3.5" /> Regenerate all</Button>
          <Button size="sm" variant="outline" disabled={!custom} onClick={onRestoreAuto}><Undo2 className="h-3.5 w-3.5" /> Restore automatic</Button>
        </div>
        {custom && <p className="rounded bg-sky-50 p-2 text-xs text-sky-800">Custom arrangement: your edits are kept (rooms you resize are re-arranged automatically).</p>}
        {!room ? <p className="text-sm text-slate-500">Select a room to see and edit its furniture.</p> : (
          <>
            <div className="flex items-center justify-between"><span className="text-sm font-medium">{room.name}</span><Button size="sm" variant="ghost" onClick={onRegenerateRoom}><RefreshCw className="h-3.5 w-3.5" /> Regenerate room</Button></div>
            <div className="max-h-36 space-y-1 overflow-y-auto">
              {items.length === 0 && <p className="text-sm text-slate-500">No furniture in this room{['corridor', 'staircase'].includes(room.type) ? ' (circulation space is kept clear)' : ''}.</p>}
              {items.map((it) => (
                <button key={it.id} onClick={() => onSelect(it.id === selected?.id ? null : it.id)} className={cn('flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm hover:bg-slate-50', it.id === selected?.id && 'bg-orange-50 text-orange-700')}>
                  <span>{FURNITURE_SPECS[it.type]?.label ?? it.type}</span><span className="text-xs text-slate-500">{it.w.toFixed(2)} × {it.d.toFixed(2)} m</span>
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <Select aria-label="Furniture to add" value={addType} onChange={(e) => setAddType(e.target.value)} className="h-8 text-xs"><option value="">Add furniture…</option>{allowed.map((t) => <option key={t} value={t}>{FURNITURE_SPECS[t].label}</option>)}</Select>
              <Button size="sm" variant="accent" disabled={!addType} onClick={() => { onAdd(addType); setAddType('') }}><Plus className="h-3.5 w-3.5" /> Add</Button>
            </div>
            {selected && spec && (
              <div className="space-y-2 border-t border-slate-100 pt-3">
                <p className="text-sm font-semibold text-navy-900">{spec.label}</p>
                <div className="grid grid-cols-2 gap-2">
                  <Field label={`Width (${spec.minW}–${spec.maxW} m)`}><Input type="number" step="0.05" value={+selected.w.toFixed(2)} onChange={(e) => onResize(Number(e.target.value), selected.d)} /></Field>
                  <Field label={`Depth (${spec.minD}–${spec.maxD} m)`}><Input type="number" step="0.05" value={+selected.d.toFixed(2)} onChange={(e) => onResize(selected.w, Number(e.target.value))} /></Field>
                </div>
                <div className="flex flex-wrap items-center gap-1">
                  <Button size="icon" variant="outline" aria-label="Move up" onClick={() => onNudge(0, -0.1)}><ArrowUp className="h-3.5 w-3.5" /></Button>
                  <Button size="icon" variant="outline" aria-label="Move down" onClick={() => onNudge(0, 0.1)}><ArrowDown className="h-3.5 w-3.5" /></Button>
                  <Button size="icon" variant="outline" aria-label="Move left" onClick={() => onNudge(-0.1, 0)}><ArrowLeft className="h-3.5 w-3.5" /></Button>
                  <Button size="icon" variant="outline" aria-label="Move right" onClick={() => onNudge(0.1, 0)}><ArrowRight className="h-3.5 w-3.5" /></Button>
                  <Button size="sm" variant="outline" onClick={onRotate}><RotateCw className="h-3.5 w-3.5" /> Rotate 90°</Button>
                  <Button size="sm" variant="danger-outline" onClick={onDelete}><Trash2 className="h-3.5 w-3.5" /> Remove</Button>
                </div>
                <Select aria-label="Replace with" value="" onChange={(e) => e.target.value && onReplace(e.target.value)} className="h-8 text-xs"><option value="">Replace with…</option>{allowed.filter((t) => t !== selected.type).map((t) => <option key={t} value={t}>{FURNITURE_SPECS[t].label}</option>)}</Select>
                <p className="text-xs text-slate-500">Tip: drag it in the 2D plan. Invalid spots (walls, doorways, other furniture) are rejected with a reason.</p>
              </div>
            )}
          </>
        )}
      </CardBody>
    </Card>
  )
}
