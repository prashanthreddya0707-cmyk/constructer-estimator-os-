import { Eye, EyeOff, Home, LayoutGrid, Lock, Pencil, RotateCcw, Ruler, Save, Sofa, Square, Tag } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { ProjectScope } from '@/components/ProjectScope'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Alert, Badge, ErrorState, Spinner } from '@/components/ui/feedback'
import { Field, Input, Select } from '@/components/ui/form'
import { BuildingViewer, type ViewMode } from '@/features/building-3d/BuildingViewer'
import { buildModel } from '@/features/building-3d/model'
import { BuildingDialog } from '@/features/projects/BuildingDialog'
import { useFloorplanUrl } from '@/features/projects/FloorPlanPanel'
import { useAsync } from '@/hooks/useApi'
import { api } from '@/lib/api'
import { useToast } from '@/lib/toast'
import { useUnits } from '@/lib/units'
import { cn } from '@/lib/utils'
import type { ProjectDetail, RoomInput } from '@/types'
import { Link } from 'react-router-dom'

export default function Studio() {
  return (
    <ProjectScope basePath="/studio" title="3D Building Studio" description="An interactive model generated from your saved dimensions and rooms.">
      {(id) => <StudioBody key={id} projectId={id} />}
    </ProjectScope>
  )
}

function ToggleBtn({ on, onClick, icon, children }: { on: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <button onClick={onClick} aria-pressed={on} className={cn('inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium', on ? 'border-orange-500 bg-orange-50 text-orange-700' : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50')}>
      {icon}{children}
    </button>
  )
}

function StudioBody({ projectId }: { projectId: string }) {
  const toast = useToast()
  const units = useUnits()
  const { data: p, loading, error, reload } = useAsync(() => api.project(projectId), [projectId])
  const [view, setView] = useState<ViewMode>('exterior')
  const [floor, setFloor] = useState<'all' | number>('all')
  const [showLabels, setShowLabels] = useState(true)
  const [showRoof, setShowRoof] = useState(false) // roofless dollhouse by default
  const [showFurniture, setShowFurniture] = useState(true)
  const [wireframe, setWireframe] = useState(false)
  const [nonce, setNonce] = useState(0)
  const [selected, setSelected] = useState<string | null>(null)
  const [editBuilding, setEditBuilding] = useState(false)

  const model = useMemo(() => buildModel(p), [p])
  const selectedRoom = p?.rooms.find((r) => r.id === selected) ?? null
  const selectedBox = model.floors.flatMap((f) => f.rooms).find((r) => r.id === selected) ?? null
  const fpImage = p?.floorplans.find((f) => f.content_type !== 'application/pdf')
  const { url: fpUrl } = useFloorplanUrl(fpImage?.id)
  const [showPlan, setShowPlan] = useState(true)

  useEffect(() => { if (selected && p && !p.rooms.some((r) => r.id === selected)) setSelected(null) }, [p, selected])
  useEffect(() => { if (floor !== 'all' && p && floor > p.floors) setFloor('all') }, [p, floor])

  if (loading && !p) return <Spinner />
  if (error || !p) return <ErrorState message={error ?? 'Project not found.'} onRetry={reload} />

  const lockLayout = async () => {
    try {
      const jobs: Promise<unknown>[] = []
      for (const f of model.floors) for (const b of f.rooms) {
        const r = p.rooms.find((x) => x.id === b.id)
        if (!r || !b.schematic) continue
        const input: RoomInput = { ...r, pos_x: +b.lx.toFixed(2), pos_y: +b.lz.toFixed(2) }
        jobs.push(api.updateRoom(p.id, r.id, input))
      }
      await Promise.all(jobs)
      toast.success('Layout saved. You can now adjust each room position.')
      await reload()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not save the layout.') }
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <ToggleBtn on={view === 'exterior'} onClick={() => { setView('exterior'); setNonce((n) => n + 1) }} icon={<Home className="h-3.5 w-3.5" />}>Exterior</ToggleBtn>
          <ToggleBtn on={view === 'top'} onClick={() => { setView('top'); setNonce((n) => n + 1) }} icon={<Square className="h-3.5 w-3.5" />}>Top-down plan</ToggleBtn>
          <Button size="sm" variant="outline" onClick={() => setNonce((n) => n + 1)}><RotateCcw className="h-3.5 w-3.5" /> Reset camera</Button>
          <Select aria-label="Floor" value={String(floor)} onChange={(e) => setFloor(e.target.value === 'all' ? 'all' : Number(e.target.value))} className="h-8 w-36 text-xs">
            <option value="all">All floors</option>
            {Array.from({ length: p.floors }, (_, i) => <option key={i} value={i + 1}>Floor {i + 1}</option>)}
          </Select>
          <ToggleBtn on={showLabels} onClick={() => setShowLabels((v) => !v)} icon={<Tag className="h-3.5 w-3.5" />}>Labels</ToggleBtn>
          <ToggleBtn on={showRoof} onClick={() => setShowRoof((v) => !v)} icon={showRoof ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}>Roof</ToggleBtn>
          <ToggleBtn on={showFurniture} onClick={() => setShowFurniture((v) => !v)} icon={<Sofa className="h-3.5 w-3.5" />}>Furniture</ToggleBtn>
          <ToggleBtn on={wireframe} onClick={() => setWireframe((v) => !v)} icon={<LayoutGrid className="h-3.5 w-3.5" />}>Wireframe</ToggleBtn>
        </div>

        <Card className="overflow-hidden">
          <div className="relative h-[28rem] sm:h-[34rem] xl:h-[38rem]" data-testid="viewer">
            {model.ok ? (
              <ErrorBoundary label="The 3D viewer" resetKey={model.length + model.width}>
                <BuildingViewer model={model} selectedId={selected} onSelect={setSelected}
                  opts={{ view, floor, showLabels, showRoof, showFurniture, wireframe, resetNonce: nonce }} />
              </ErrorBoundary>
            ) : (
              <div className="flex h-full items-center justify-center p-6"><Alert tone="error" title="3D model cannot be generated">{model.errors.join(' ')} <button className="underline" onClick={() => setEditBuilding(true)}>Fix dimensions</button></Alert></div>
            )}
            <div className="pointer-events-none absolute bottom-2 left-2 rounded bg-white/85 px-2 py-1 text-[11px] text-slate-600">
              Drag to rotate · scroll to zoom · right-drag to pan · click a room to select
              {view === 'top' && floor === 'all' ? ' · plan shows floor 1 (choose a floor above to change)' : ''}
            </div>
            {model.schematic && <div className="pointer-events-none absolute right-2 top-2"><Badge tone="amber">Schematic room layout</Badge></div>}
          </div>
        </Card>
        {model.notes.map((n) => <Alert key={n} tone="warning">{n}</Alert>)}
        {model.schematic && (
          <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
            <span>Rooms without positions are arranged schematically; this is not a reconstruction of your floor plan.</span>
            <Button size="sm" variant="outline" onClick={lockLayout}><Lock className="h-3.5 w-3.5" /> Save this layout</Button>
          </div>
        )}

        {fpImage && (
          <Card>
            <CardHeader title="Uploaded floor plan" description="Reference image alongside the model. Room dimensions come from the confirmed values, not the image."
              action={<Button size="sm" variant="ghost" onClick={() => setShowPlan((v) => !v)}>{showPlan ? 'Hide' : 'Show'}</Button>} />
            {showPlan && <CardBody>{fpUrl ? <img src={fpUrl} alt="Uploaded floor plan" className="max-h-80 w-full rounded border border-slate-200 object-contain" /> : <Spinner className="py-4" />}</CardBody>}
          </Card>
        )}
      </div>

      <div className="space-y-4">
        <Card>
          <CardHeader title="Building" action={<Button size="sm" variant="outline" onClick={() => setEditBuilding(true)}><Pencil className="h-3.5 w-3.5" /> Edit</Button>} />
          <CardBody className="space-y-1 text-sm">
            <Row k="Length × Width" v={`${units.length(p.length)} × ${units.length(p.width)}`} />
            <Row k="Floor height" v={units.length(p.height)} />
            <Row k="Floors" v={String(p.floors)} />
            <Row k="Wall / slab" v={`${units.length(p.wall_thickness)} / ${units.length(p.slab_thickness)}`} />
            <Row k="Floor area" v={units.area(p.floor_area)} />
            <Row k="Total height" v={units.length(model.totalHeight)} />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Room information" />
          <CardBody>
            {selectedRoom ? (
              <RoomEditor key={selectedRoom.id} project={p} roomId={selectedRoom.id} onSaved={reload} schematic={!!selectedBox?.schematic} />
            ) : <p className="text-sm text-slate-500">Select a room in the model or from the list below to see and edit its properties.</p>}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={`Rooms (${p.rooms.length})`} />
          <CardBody className="max-h-64 space-y-1 overflow-y-auto p-2">
            {p.rooms.length === 0 && <p className="p-3 text-sm text-slate-500">No rooms. <Link className="text-orange-600 underline" to={`/projects/${p.id}`}>Add rooms</Link> to see partitions and labels.</p>}
            {p.rooms.map((r) => (
              <button key={r.id} onClick={() => { setSelected(r.id); if (floor !== 'all') setFloor(r.floor_number) }}
                className={cn('flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm hover:bg-slate-50', r.id === selected && 'bg-orange-50 text-orange-700')}>
                <span><span className="font-medium">{r.name}</span><span className="ml-2 text-xs text-slate-500">Floor {r.floor_number}</span></span>
                <span className="text-xs text-slate-500">{units.area(r.area)}</span>
              </button>
            ))}
          </CardBody>
        </Card>
      </div>

      <BuildingDialog open={editBuilding} onClose={() => setEditBuilding(false)} project={p} onSaved={reload} dimensionsOnly />
    </div>
  )
}

function Row({ k, v }: { k: string; v: string }) {
  return <div className="flex justify-between gap-3"><span className="text-slate-500">{k}</span><span className="font-medium text-slate-800">{v}</span></div>
}

function RoomEditor({ project, roomId, onSaved, schematic }: { project: ProjectDetail; roomId: string; onSaved: () => Promise<void>; schematic: boolean }) {
  const toast = useToast()
  const units = useUnits()
  const room = project.rooms.find((r) => r.id === roomId)!
  const [f, setF] = useState({ length: String(room.length), width: String(room.width), height: String(room.height), doors: String(room.doors), windows: String(room.windows), x: room.pos_x?.toString() ?? '', y: room.pos_y?.toString() ?? '' })
  const [busy, setBusy] = useState(false)
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF((s) => ({ ...s, [k]: e.target.value }))

  const save = async () => {
    const n = (s: string) => Number(s)
    if (!(n(f.length) > 0 && n(f.width) > 0 && n(f.height) >= 2)) { toast.error('Length and width must be positive and height at least 2 m.'); return }
    const input: RoomInput = {
      name: room.name, room_type: room.room_type, floor_number: room.floor_number, wall_thickness: room.wall_thickness, area_override: null,
      length: n(f.length), width: n(f.width), height: n(f.height), doors: Math.max(0, Math.round(n(f.doors) || 0)), windows: Math.max(0, Math.round(n(f.windows) || 0)),
      pos_x: f.x === '' ? null : n(f.x), pos_y: f.y === '' ? null : n(f.y),
    }
    setBusy(true)
    try { await api.updateRoom(project.id, room.id, input); toast.success('Room updated. The model has been regenerated.'); await onSaved() }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Could not update the room.') } finally { setBusy(false) }
  }

  return (
    <div className="space-y-3">
      <div><h4 className="font-semibold text-navy-900">{room.name}</h4><p className="text-xs capitalize text-slate-500">{room.room_type} · Floor {room.floor_number}</p></div>
      <div className="grid grid-cols-2 gap-x-3 text-sm"><span className="text-slate-500">Floor area</span><span className="text-right font-medium">{units.area(room.area)}</span>
        <span className="text-slate-500">Dimensions</span><span className="text-right font-medium">{units.length(room.length)} × {units.length(room.width)}</span>
        <span className="text-slate-500">Height</span><span className="text-right font-medium">{units.length(room.height)}</span></div>
      {schematic && <p className="rounded bg-amber-50 p-2 text-xs text-amber-800">Position is schematic (not stored). Use “Save this layout” to fix it.</p>}
      <div className="grid grid-cols-3 gap-2">
        <Field label="L (m)"><Input type="number" step="any" value={f.length} onChange={set('length')} /></Field>
        <Field label="W (m)"><Input type="number" step="any" value={f.width} onChange={set('width')} /></Field>
        <Field label="H (m)"><Input type="number" step="any" value={f.height} onChange={set('height')} /></Field>
        <Field label="Doors"><Input type="number" step={1} value={f.doors} onChange={set('doors')} /></Field>
        <Field label="Windows"><Input type="number" step={1} value={f.windows} onChange={set('windows')} /></Field>
        <span />
        <Field label="X (m)"><Input type="number" step="any" value={f.x} onChange={set('x')} placeholder="auto" /></Field>
        <Field label="Y (m)"><Input type="number" step="any" value={f.y} onChange={set('y')} placeholder="auto" /></Field>
      </div>
      <Button variant="accent" size="sm" loading={busy} onClick={save}><Save className="h-3.5 w-3.5" /> Save & update model</Button>
      <p className="flex items-center gap-1 text-xs text-slate-500"><Ruler className="h-3 w-3" /> Estimates use these values after recalculation.</p>
    </div>
  )
}
