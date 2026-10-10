import { Box as BoxIcon, DoorClosed, DoorOpen, Eye, EyeOff, FilePlus2, Home, LayoutGrid, Lock, Map as MapIcon, PanelTop, Pencil, RotateCcw, Ruler, Save, Sofa, Square, Tag, Undo2, Upload, Wand2, Blocks, AppWindow } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { ProjectScope } from '@/components/ProjectScope'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { ConfirmDialog } from '@/components/ui/dialog'
import { Alert, Badge, ErrorState, Spinner } from '@/components/ui/feedback'
import { Field, Input, Select } from '@/components/ui/form'
import { BuildingViewer, type ViewMode } from '@/features/building-3d/BuildingViewer'
import { FloorPlanImportDialog } from '@/features/building-3d/FloorPlanImportDialog'
import { configFromProject, LayoutGeneratorDialog } from '@/features/building-3d/LayoutGeneratorDialog'
import { DEFAULT_CONFIG, generateLayout, type GeneratorConfig } from '@/features/building-3d/layoutGenerator'
import { PlanView, type PlanMode } from '@/features/building-3d/PlanView'
import { FurniturePanel, IssuesPanel, OpeningPanel } from '@/features/building-3d/StudioPanels'
import { useStudioLayout } from '@/features/building-3d/useStudioLayout'
import { BuildingDialog } from '@/features/projects/BuildingDialog'
import { useFloorplanUrl } from '@/features/projects/FloorPlanPanel'
import { useAsync } from '@/hooks/useApi'
import { api } from '@/lib/api'
import { useToast } from '@/lib/toast'
import { useUnits } from '@/lib/units'
import { cn } from '@/lib/utils'
import type { ProjectDetail, RoomInput } from '@/types'

type StudioView = ViewMode | 'plan'

export default function Studio() {
  return (
    <ProjectScope basePath="/studio" title="3D Building Studio" description="Generate a building from details or a floor plan, edit it in 2D, and inspect it in 3D. Plan, model, furniture and estimate share one geometry.">
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

const projectBase = (p: ProjectDetail) => ({
  name: p.name, description: p.description, owner_name: p.owner_name, building_type: p.building_type, location: p.location, floors: p.floors, currency: p.currency,
  budget: p.budget, length: p.length, width: p.width, height: p.height, wall_thickness: p.wall_thickness, slab_thickness: p.slab_thickness, built_up_area: p.built_up_area,
})
const roomInput = (r: ProjectDetail['rooms'][number]): RoomInput => ({
  name: r.name, room_type: r.room_type, length: r.length, width: r.width, height: r.height, floor_number: r.floor_number, wall_thickness: r.wall_thickness,
  doors: r.doors, windows: r.windows, area_override: r.area_override, pos_x: r.pos_x, pos_y: r.pos_y,
})

function StudioBody({ projectId }: { projectId: string }) {
  const toast = useToast()
  const units = useUnits()
  const { data: p, loading, error, reload } = useAsync(() => api.project(projectId), [projectId])
  const [view, setView] = useState<StudioView>('exterior')
  const [floor, setFloor] = useState<'all' | number>('all')
  const [showLabels, setShowLabels] = useState(true)
  const [showRoof, setShowRoof] = useState(false) // roofless dollhouse by default
  const [showFurniture, setShowFurniture] = useState(true)
  const [showWalls, setShowWalls] = useState(true)
  const [showOpenings, setShowOpenings] = useState(true)
  const [doorsOpen, setDoorsOpen] = useState(true)
  const [wireframe, setWireframe] = useState(false)
  const [nonce, setNonce] = useState(0)
  const [selected, setSelected] = useState<string | null>(null)
  const [selFurn, setSelFurn] = useState<string | null>(null)
  const [selOpen, setSelOpen] = useState<string | null>(null)
  const [mode, setMode] = useState<PlanMode>('select')
  const [editBuilding, setEditBuilding] = useState(false)
  const [genOpen, setGenOpen] = useState(false)
  const [genVariant, setGenVariant] = useState(0)
  const [importOpen, setImportOpen] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)
  const [busy, setBusy] = useState(false)

  const S = useStudioLayout(p, reload, toast)
  const { model } = S
  const selectedRoom = p?.rooms.find((r) => r.id === selected) ?? null
  const selectedBox = model.floors.flatMap((f) => f.rooms).find((r) => r.id === selected) ?? null
  const allFurniture = model.floors.flatMap((f) => f.furnitureItems)
  const selFurnItem = allFurniture.find((i) => i.id === selFurn) ?? null
  const selOpening = model.floors.flatMap((f) => f.openings).find((o) => o.id === selOpen) ?? null
  const openingOwner = selOpening ? model.floors.flatMap((f) => f.rooms).find((r) => r.id === selOpening.roomId) ?? null : null
  const fpImage = p?.floorplans.find((f) => f.content_type !== 'application/pdf')
  const { url: fpUrl } = useFloorplanUrl(fpImage?.id)
  const [showPlan, setShowPlan] = useState(true)
  const planFloor = floor === 'all' ? 1 : floor

  useEffect(() => { if (selected && p && !p.rooms.some((r) => r.id === selected)) setSelected(null) }, [p, selected])
  useEffect(() => { if (floor !== 'all' && p && floor > p.floors) setFloor('all') }, [p, floor])
  useEffect(() => { if (selFurn && !allFurniture.some((i) => i.id === selFurn)) setSelFurn(null) }, [allFurniture, selFurn])
  useEffect(() => { if (selOpen && !selOpening) setSelOpen(null) }, [selOpening, selOpen])

  if (loading && !p) return <Spinner />
  if (error || !p) return <ErrorState message={error ?? 'Project not found.'} onRetry={reload} />

  const lockLayout = async () => {
    try {
      const jobs: Promise<unknown>[] = []
      for (const f of model.floors) for (const b of f.rooms) {
        const r = p.rooms.find((x) => x.id === b.id)
        if (!r || !b.schematic) continue
        jobs.push(api.updateRoom(p.id, r.id, { ...roomInput(r), pos_x: +b.lx.toFixed(2), pos_y: +b.lz.toFixed(2) }))
      }
      await Promise.all(jobs)
      toast.success('Layout saved. You can now adjust each room position.')
      await reload()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not save the layout.') }
  }

  /** Replace the project's rooms (and, if needed, its dimensions) with a generated layout. */
  const applyGenerated = async (cfg: GeneratorConfig, rooms: RoomInput[]) => {
    const dimsChanged = cfg.length !== p.length || cfg.width !== p.width || cfg.floors !== p.floors || cfg.wallHeight !== p.height || cfg.wallThickness !== p.wall_thickness
    if (dimsChanged) {
      if (p.rooms.length && cfg.floors !== p.floors) await api.replaceRooms(p.id, []) // avoid floor-number conflicts while the floor count changes
      await api.updateProject(p.id, { ...projectBase(p), length: cfg.length, width: cfg.width, floors: cfg.floors, height: cfg.wallHeight, wall_thickness: cfg.wallThickness, built_up_area: null })
    }
    await api.replaceRooms(p.id, rooms)
    await reload()
    setSelected(null); setSelFurn(null); setSelOpen(null)
    toast.success(`Layout generated: ${rooms.length} rooms, doors, windows${cfg.furnish ? ' and furniture' : ''}.`)
  }
  const generateNow = async () => {
    setBusy(true)
    try {
      const cfg = configFromProject(p)
      const res = generateLayout(cfg)
      if (res.errors.length) { toast.error(`${res.errors[0]} ${res.suggestions[0] ?? ''}`); setGenOpen(true); return }
      await applyGenerated(cfg, res.rooms)
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not generate the layout.') } finally { setBusy(false) }
  }
  /** Re-lay the project's existing room types so they fill the whole footprint (for plans whose rooms cover only part of it). */
  const fitToFootprint = async () => {
    setBusy(true)
    try {
      const cfg = configFromProject(p)
      const counts = { ...cfg.counts, bedroom: 0, living: 0, kitchen: 0, dining: 0, bathroom: 0, study: 0, store: 0 }
      const perFloor = Math.max(1, p.floors)
      for (const r of p.rooms) { const t = r.room_type as keyof typeof counts; if (t in counts) counts[t] += 1 }
      for (const k of Object.keys(counts) as (keyof typeof counts)[]) counts[k] = Math.ceil(counts[k] / perFloor)
      if (!Object.values(counts).some(Boolean)) Object.assign(counts, DEFAULT_CONFIG.counts)
      const next = { ...cfg, counts }
      const res = generateLayout(next)
      if (res.errors.length) { toast.error(`${res.errors[0]} ${res.suggestions[0] ?? ''}`); setGenOpen(true); return }
      await applyGenerated(next, res.rooms)
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not fit the rooms.') } finally { setBusy(false) }
  }
  const applyImport = async (rooms: RoomInput[], dims: { length: number; width: number } | null, fl: number) => {
    if (dims) await api.updateProject(p.id, { ...projectBase(p), length: dims.length, width: dims.width, built_up_area: null })
    await api.replaceRooms(p.id, [...p.rooms.filter((r) => r.floor_number !== fl).map(roomInput), ...rooms])
    await reload()
    setView('exterior'); setNonce((n) => n + 1)
    toast.success(`${rooms.length} confirmed rooms created. Doors and windows were added automatically: adjust them in the 2D plan.`)
  }

  const selectRoom = (id: string | null) => { setSelected(id); if (id && floor !== 'all') { const r = p.rooms.find((x) => x.id === id); if (r) setFloor(r.floor_number) } }
  const hasRooms = p.rooms.length > 0
  const errors = model.issues.filter((i) => i.severity === 'error')

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_23rem]">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <ToggleBtn on={view === 'exterior'} onClick={() => { setView('exterior'); setNonce((n) => n + 1) }} icon={<Home className="h-3.5 w-3.5" />}>Exterior</ToggleBtn>
          <ToggleBtn on={view === 'top'} onClick={() => { setView('top'); setNonce((n) => n + 1) }} icon={<Square className="h-3.5 w-3.5" />}>Top-down plan</ToggleBtn>
          <ToggleBtn on={view === 'plan'} onClick={() => setView('plan')} icon={<MapIcon className="h-3.5 w-3.5" />}>2D plan</ToggleBtn>
          {view !== 'plan' && <Button size="sm" variant="outline" onClick={() => setNonce((n) => n + 1)}><RotateCcw className="h-3.5 w-3.5" /> Reset camera</Button>}
          <Select aria-label="Floor" value={String(floor)} onChange={(e) => setFloor(e.target.value === 'all' ? 'all' : Number(e.target.value))} className="h-8 w-36 text-xs">
            <option value="all">All floors</option>
            {Array.from({ length: p.floors }, (_, i) => <option key={i} value={i + 1}>Floor {i + 1}</option>)}
          </Select>
          <ToggleBtn on={showLabels} onClick={() => setShowLabels((v) => !v)} icon={<Tag className="h-3.5 w-3.5" />}>Labels</ToggleBtn>
          <ToggleBtn on={showRoof} onClick={() => setShowRoof((v) => !v)} icon={showRoof ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}>Roof</ToggleBtn>
          <ToggleBtn on={showWalls} onClick={() => setShowWalls((v) => !v)} icon={<Blocks className="h-3.5 w-3.5" />}>Walls</ToggleBtn>
          <ToggleBtn on={showOpenings} onClick={() => setShowOpenings((v) => !v)} icon={<AppWindow className="h-3.5 w-3.5" />}>Doors & windows</ToggleBtn>
          <ToggleBtn on={doorsOpen} onClick={() => setDoorsOpen((v) => !v)} icon={doorsOpen ? <DoorOpen className="h-3.5 w-3.5" /> : <DoorClosed className="h-3.5 w-3.5" />}>{doorsOpen ? 'Doors open' : 'Doors closed'}</ToggleBtn>
          <ToggleBtn on={showFurniture} onClick={() => setShowFurniture((v) => !v)} icon={<Sofa className="h-3.5 w-3.5" />}>Furniture</ToggleBtn>
          <ToggleBtn on={wireframe} onClick={() => setWireframe((v) => !v)} icon={<LayoutGrid className="h-3.5 w-3.5" />}>Wireframe</ToggleBtn>
        </div>

        <Card className="overflow-hidden">
          <div className="relative h-[28rem] sm:h-[34rem] xl:h-[38rem]" data-testid="viewer">
            {!model.ok ? (
              <div className="flex h-full items-center justify-center p-6"><Alert tone="error" title="The building cannot be generated">{model.errors.join(' ')} <button className="underline" onClick={() => setEditBuilding(true)}>Fix dimensions</button></Alert></div>
            ) : view === 'plan' ? (
              <PlanView model={model} floorIndex={planFloor} selectedRoomId={selected} selectedFurnitureId={selFurn} selectedOpeningId={selOpen} showFurniture={showFurniture} showLabels={showLabels} mode={mode}
                onSelectRoom={selectRoom}
                onSelectFurniture={(id) => { setSelFurn(id); setSelOpen(null); const it = allFurniture.find((i) => i.id === id); if (it) setSelected(it.room_id) }}
                onSelectOpening={(id) => { setSelOpen(id); setSelFurn(null); const o = model.floors.flatMap((f) => f.openings).find((x) => x.id === id); if (o) setSelected(o.roomId) }}
                canPlaceFurniture={S.canPlaceFurniture} onMoveFurniture={S.moveFurniture} canMoveOpening={S.canMoveOpening} onMoveOpening={S.moveOpening}
                onAddOpening={(kind, wallId, along) => { const id = S.addOpening(kind, wallId, along, selected); if (id) { setSelOpen(id); setMode('select') } }} onMessage={(m) => toast.error(m)} />
            ) : (
              <ErrorBoundary label="The 3D viewer" resetKey={model.length + model.width}>
                <BuildingViewer model={model} selectedId={selected} selectedFurnitureId={selFurn} selectedOpeningId={selOpen} onSelect={(id) => { setSelected(id); if (id) { setSelFurn(null); setSelOpen(null) } }}
                  opts={{ view: view as ViewMode, floor, showLabels, showRoof, showFurniture, showWalls, showOpenings, doorsOpen, wireframe, resetNonce: nonce }} />
              </ErrorBoundary>
            )}
            {model.ok && !hasRooms && (
              <div className="absolute inset-0 flex items-center justify-center bg-white/70 p-4 backdrop-blur-[1px]">
                <div className="max-w-md rounded-xl border border-slate-200 bg-white p-6 text-center shadow-lg">
                  <BoxIcon className="mx-auto mb-2 h-8 w-8 text-orange-500" />
                  <h3 className="text-lg font-semibold text-navy-900">No rooms yet</h3>
                  <p className="mt-1 text-sm text-slate-600">You do not need a floor plan. Generate a complete house from the building details (default: a {p.length} × {p.width} m residential house with 2 bedrooms, living room, kitchen, dining room, 2 bathrooms and a passage), or upload a plan.</p>
                  <div className="mt-4 flex flex-wrap justify-center gap-2">
                    <Button variant="accent" loading={busy} onClick={generateNow}><Wand2 className="h-4 w-4" /> Generate now</Button>
                    <Button variant="outline" onClick={() => setGenOpen(true)}>Customise…</Button>
                    <Button variant="outline" onClick={() => setImportOpen(true)}><Upload className="h-4 w-4" /> Upload floor plan</Button>
                  </div>
                </div>
              </div>
            )}
            <div className="pointer-events-none absolute bottom-2 left-2 rounded bg-white/85 px-2 py-1 text-[11px] text-slate-600">
              {view === 'plan'
                ? mode === 'select' ? 'Click a room · drag furniture and doors/windows · use “Add door / window” on the right' : `Click a wall to place a ${mode === 'add-door' ? 'door' : 'window'}`
                : <>Drag to rotate · scroll to zoom · right-drag to pan · click a room to select{view === 'top' && floor === 'all' ? ' · plan shows floor 1 (choose a floor above to change)' : ''}</>}
            </div>
            {model.schematic && <div className="pointer-events-none absolute right-2 top-2"><Badge tone="amber">Schematic room layout</Badge></div>}
          </div>
        </Card>
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
          <CardHeader title="Layout" description="Everything below uses one shared geometry."
            action={S.dirty ? <Badge tone="amber">Unsaved changes</Badge> : S.hasCustomOpenings || S.hasCustomFurniture ? <Badge tone="navy">Custom layout saved</Badge> : <Badge>Automatic</Badge>} />
          <CardBody className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <Button size="sm" variant="outline" onClick={() => setImportOpen(true)}><Upload className="h-3.5 w-3.5" /> Upload 2D plan</Button>
              <Button size="sm" variant="outline" onClick={() => { setGenVariant(0); setGenOpen(true) }}><Wand2 className="h-3.5 w-3.5" /> From building details</Button>
              <Button size="sm" variant="outline" onClick={() => setView('plan')}><PanelTop className="h-3.5 w-3.5" /> Edit floor plan</Button>
              <Button size="sm" variant="outline" onClick={() => { setView('exterior'); setNonce((n) => n + 1) }}><BoxIcon className="h-3.5 w-3.5" /> View 3D model</Button>
              <Button size="sm" variant="outline" disabled={!hasRooms} onClick={() => { setGenVariant((v) => (v + 1) % 4); setGenOpen(true) }}><FilePlus2 className="h-3.5 w-3.5" /> Regenerate layout</Button>
              <Button size="sm" variant="outline" onClick={() => setConfirmReset(true)}><Undo2 className="h-3.5 w-3.5" /> Reset layout</Button>
            </div>
            <div className="flex gap-2">
              <Button variant="accent" size="sm" className="flex-1" loading={S.saving} disabled={!model.ok || !hasRooms} onClick={S.save}><Save className="h-3.5 w-3.5" /> Save layout</Button>
              {S.dirty && <Button variant="outline" size="sm" onClick={S.discard}>Discard</Button>}
            </div>
            <p className="text-xs text-slate-500">Saving stores door/window positions and furniture with the project and feeds the real openings into the material estimate. Rooms: use the room editor below or Edit floor plan.</p>
          </CardBody>
        </Card>

        <IssuesPanel issues={model.issues.filter((i) => i.code !== 'schematic')} onSelectRoom={selectRoom} onFit={fitToFootprint} busy={busy} />
        {errors.length > 0 && <p className="text-xs text-red-700">Fix the errors above, then generate / save again. The model still shows the plan exactly as saved.</p>}

        <Card>
          <CardHeader title="Building" action={<Button size="sm" variant="outline" onClick={() => setEditBuilding(true)}><Pencil className="h-3.5 w-3.5" /> Edit</Button>} />
          <CardBody className="space-y-1 text-sm">
            <Row k="Length × Width" v={`${units.length(p.length)} × ${units.length(p.width)}`} />
            <Row k="Floor height" v={units.length(p.height)} />
            <Row k="Floors" v={String(p.floors)} />
            <Row k="Wall / slab" v={`${units.length(p.wall_thickness)} / ${units.length(p.slab_thickness)}`} />
            <Row k="Floor area" v={units.area(p.floor_area)} />
            <Row k="Total height" v={units.length(model.totalHeight)} />
            <Row k="Doors / windows" v={`${model.resolved.summary.doors.length} / ${model.resolved.summary.windows.length}`} />
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

        <OpeningPanel opening={selOpening} owner={openingOwner} mode={mode} onMode={(m) => { setMode(m); if (m !== 'select') setView('plan') }}
          onChange={(patch) => selOpening && S.changeOpening(selOpening.id, patch)} onNudge={(d) => selOpening && S.nudgeOpening(selOpening.id, d)}
          onFlip={() => selOpening && S.flipOpening(selOpening.id)} onDelete={() => selOpening && S.deleteOpening(selOpening.id)} />

        <FurniturePanel room={selectedBox} items={allFurniture.filter((i) => i.room_id === selected)} selected={selFurnItem} custom={S.hasCustomFurniture} autoFurnish={S.autoFurnish}
          onToggleAuto={S.setAutoFurnish} onSelect={(id) => { setSelFurn(id); setSelOpen(null) }}
          onRotate={() => selFurnItem && S.rotateFurniture(selFurnItem.id)} onNudge={(dx, dz) => selFurnItem && S.nudgeFurniture(selFurnItem.id, dx, dz)}
          onResize={(w, d) => selFurnItem && S.resizeFurniture(selFurnItem.id, w, d)} onReplace={(t) => selFurnItem && S.replaceFurniture(selFurnItem.id, t)}
          onDelete={() => { if (selFurnItem) { S.deleteFurniture(selFurnItem.id); setSelFurn(null) } }}
          onAdd={(t) => { if (selected) { const id = S.addFurniture(selected, t); if (id) setSelFurn(id) } }}
          onRegenerateRoom={() => selected && S.regenerateRoom(selected)} onRegenerateAll={S.regenerateAll} onRestoreAuto={S.restoreAutomatic} />

        <Card>
          <CardHeader title={`Rooms (${p.rooms.length})`} />
          <CardBody className="max-h-64 space-y-1 overflow-y-auto p-2">
            {p.rooms.length === 0 && <p className="p-3 text-sm text-slate-500">No rooms. <Link className="text-orange-600 underline" to={`/projects/${p.id}`}>Add rooms</Link> or generate a layout.</p>}
            {p.rooms.map((r) => (
              <button key={r.id} onClick={() => selectRoom(r.id)}
                className={cn('flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm hover:bg-slate-50', r.id === selected && 'bg-orange-50 text-orange-700')}>
                <span><span className="font-medium">{r.name}</span><span className="ml-2 text-xs text-slate-500">Floor {r.floor_number}</span></span>
                <span className="text-xs text-slate-500">{units.area(r.area)}</span>
              </button>
            ))}
          </CardBody>
        </Card>
      </div>

      <BuildingDialog open={editBuilding} onClose={() => setEditBuilding(false)} project={p} onSaved={reload} dimensionsOnly />
      <LayoutGeneratorDialog open={genOpen} onClose={() => setGenOpen(false)} project={p} startVariant={genVariant} onApply={applyGenerated} />
      <FloorPlanImportDialog open={importOpen} onClose={() => setImportOpen(false)} project={p} onConfirm={applyImport} />
      <ConfirmDialog open={confirmReset} onClose={() => setConfirmReset(false)} confirmLabel="Reset" title="Reset the layout?"
        message="Saved door/window positions and furniture edits are discarded and everything is re-generated automatically from the rooms. Rooms and building dimensions are not changed."
        onConfirm={async () => { setConfirmReset(false); await S.reset() }} />
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
