import { RefreshCw, Wand2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Alert } from '@/components/ui/feedback'
import { Field, Input, Select } from '@/components/ui/form'
import type { ProjectDetail, RoomInput } from '@/types'
import { COMMERCIAL_COUNTS, DEFAULT_CONFIG, generateLayout, KIND_LABEL, type BuildingKind, type GeneratorConfig, type RoomKind } from './layoutGenerator'
import { buildModel } from './model'
import { PlanView } from './PlanView'

const KINDS: RoomKind[] = ['bedroom', 'living', 'kitchen', 'dining', 'bathroom', 'study', 'store']

/** Project-shaped object used only to preview a generated layout with the real geometry pipeline. */
function previewProject(cfg: GeneratorConfig, rooms: RoomInput[]): ProjectDetail {
  return {
    id: 'preview', name: 'Preview', description: '', owner_name: '', building_type: cfg.buildingType, location: '', floors: cfg.floors, currency: 'INR', budget: null,
    length: cfg.length, width: cfg.width, height: cfg.wallHeight, wall_thickness: cfg.wallThickness, slab_thickness: 0.15, built_up_area: null, is_demo: false,
    created_at: '', updated_at: '', assumptions: {}, wastage: {}, material_selections: {}, extra_costs: {}, purchase_quantities: {}, layout: null,
    room_count: rooms.length, floor_area: cfg.length * cfg.width, total_built_up_area: cfg.length * cfg.width * cfg.floors, latest_total_cost: null, has_estimate: false,
    floorplans: [], rooms: rooms.map((r, i) => ({ ...r, id: `pv${i}`, project_id: 'preview', area: r.length * r.width })),
  }
}

export function configFromProject(p: ProjectDetail | null): GeneratorConfig {
  if (!p) return { ...DEFAULT_CONFIG, counts: { ...DEFAULT_CONFIG.counts } }
  return { ...DEFAULT_CONFIG, counts: { ...DEFAULT_CONFIG.counts }, length: p.length, width: p.width, floors: p.floors, wallHeight: p.height, wallThickness: p.wall_thickness }
}

export function LayoutGeneratorDialog({ open, onClose, project, onApply, startVariant = 0 }: {
  startVariant?: number
  open: boolean
  onClose: () => void
  project: ProjectDetail | null
  onApply: (cfg: GeneratorConfig, rooms: RoomInput[]) => Promise<void>
}) {
  const [cfg, setCfg] = useState<GeneratorConfig>(() => configFromProject(project))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [floor, setFloor] = useState(1)

  useEffect(() => { if (open) { setCfg({ ...configFromProject(project), variant: startVariant }); setError(null); setFloor(1) } }, [open, project, startVariant])

  const result = useMemo(() => generateLayout(cfg), [cfg])
  const preview = useMemo(() => (result.rooms.length ? buildModel(previewProject(cfg, result.rooms), { autoFurnish: cfg.furnish }) : null), [cfg, result])
  const num = (k: 'length' | 'width' | 'floors' | 'wallHeight' | 'wallThickness') => (e: React.ChangeEvent<HTMLInputElement>) => setCfg((c) => ({ ...c, [k]: e.target.value === '' ? NaN : Number(e.target.value) }))
  const count = (k: RoomKind) => (e: React.ChangeEvent<HTMLInputElement>) => setCfg((c) => ({ ...c, counts: { ...c.counts, [k]: Math.max(0, Math.min(12, Math.floor(Number(e.target.value) || 0))) } }))
  const replacing = (project?.rooms.length ?? 0) > 0
  const errs = preview?.issues.filter((i) => i.severity === 'error') ?? []

  return (
    <Dialog open={open} onClose={onClose} title="Generate from building details" description="No floor plan needed: BuildWise AI proposes a room layout inside your footprint. Review it, regenerate for another arrangement, then apply." className="w-[min(70rem,calc(100vw-2rem))]">
      <div className="grid gap-5 lg:grid-cols-[22rem_1fr]">
        <div className="space-y-3">
          <Field label="Building type">
            <Select value={cfg.buildingType} onChange={(e) => { const t = e.target.value as BuildingKind; setCfg((c) => ({ ...c, buildingType: t, counts: t === 'commercial' ? { ...COMMERCIAL_COUNTS } : { ...DEFAULT_CONFIG.counts } })) }}>
              <option value="residential">Residential house</option><option value="commercial">Commercial / office</option>
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Length (m)"><Input type="number" step="any" value={Number.isNaN(cfg.length) ? '' : cfg.length} onChange={num('length')} /></Field>
            <Field label="Width (m)"><Input type="number" step="any" value={Number.isNaN(cfg.width) ? '' : cfg.width} onChange={num('width')} /></Field>
            <Field label="Floors"><Input type="number" step={1} min={1} max={10} value={Number.isNaN(cfg.floors) ? '' : cfg.floors} onChange={num('floors')} /></Field>
            <Field label="Wall height (m)"><Input type="number" step="any" value={Number.isNaN(cfg.wallHeight) ? '' : cfg.wallHeight} onChange={num('wallHeight')} /></Field>
            <Field label="Wall thickness (m)"><Input type="number" step="any" value={Number.isNaN(cfg.wallThickness) ? '' : cfg.wallThickness} onChange={num('wallThickness')} /></Field>
            <Field label="Windows"><Select value={cfg.windows} onChange={(e) => setCfg((c) => ({ ...c, windows: e.target.value as GeneratorConfig['windows'] }))}><option value="few">Few</option><option value="standard">Standard</option><option value="many">Many</option></Select></Field>
          </div>
          <p className="text-sm font-medium text-slate-700">Rooms</p>
          <div className="grid grid-cols-2 gap-2">
            {KINDS.map((k) => (
              <Field key={k} label={KIND_LABEL[cfg.buildingType][k]}><Input type="number" min={0} max={12} step={1} value={cfg.counts[k]} onChange={count(k)} /></Field>
            ))}
          </div>
          <p className="text-xs text-slate-500">A passage is allocated automatically (and a staircase on every floor of multi-storey buildings). Every room gets a door and the building gets a 1.0 × 2.1 m main entrance.</p>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-orange-500" checked={cfg.furnish} onChange={(e) => setCfg((c) => ({ ...c, furnish: e.target.checked }))} /> Furnish automatically</label>
        </div>

        <div className="min-w-0 space-y-3">
          {result.errors.length > 0 ? (
            <Alert tone="error" title="This layout does not fit">
              <ul className="ml-4 list-disc">{result.errors.map((e) => <li key={e}>{e}</li>)}</ul>
              {result.suggestions.length > 0 && <><p className="mt-2 font-semibold">What you can do</p><ul className="ml-4 list-disc">{result.suggestions.map((e) => <li key={e}>{e}</li>)}</ul></>}
            </Alert>
          ) : preview && (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-slate-600">
                  Footprint {result.stats.footprint.toFixed(0)} m²{cfg.floors > 1 ? ` × ${cfg.floors} floors` : ''} · rooms {result.stats.roomArea.toFixed(0)} m² (passage/stairs {result.stats.passageArea.toFixed(0)} m²) · usable after walls ≈ {result.stats.usableArea.toFixed(0)} m²
                </p>
                <div className="flex items-center gap-2">
                  {cfg.floors > 1 && <Select aria-label="Preview floor" value={floor} onChange={(e) => setFloor(Number(e.target.value))} className="h-8 w-28 text-xs">{Array.from({ length: cfg.floors }, (_, i) => <option key={i} value={i + 1}>Floor {i + 1}</option>)}</Select>}
                  <Button size="sm" variant="outline" onClick={() => setCfg((c) => ({ ...c, variant: (c.variant + 1) % 4 }))}><RefreshCw className="h-3.5 w-3.5" /> Regenerate layout</Button>
                </div>
              </div>
              <div className="h-[22rem] overflow-hidden rounded-lg border border-slate-200">
                <PlanView model={preview} floorIndex={floor} selectedRoomId={null} selectedFurnitureId={null} selectedOpeningId={null} onSelectRoom={() => {}} onSelectFurniture={() => {}} onSelectOpening={() => {}}
                  showFurniture={cfg.furnish} showLabels mode="select" canPlaceFurniture={() => 'Preview only.'} onMoveFurniture={() => {}} canMoveOpening={() => false} onMoveOpening={() => {}} onAddOpening={() => {}} onMessage={() => {}} />
              </div>
              {result.notes.length > 0 && <Alert tone="info">{result.notes.join(' ')}</Alert>}
              {errs.length > 0 && <Alert tone="error" title="Validation">{errs.map((e) => e.message).join(' ')}</Alert>}
              {replacing && <Alert tone="warning" title="This replaces the current rooms">Existing rooms, saved door/window positions and furniture edits of this project will be replaced. Building dimensions are updated to the values on the left.</Alert>}
              <p className="text-xs text-slate-500">After applying you can edit every room, move doors and windows, and rearrange furniture in the Studio before saving.</p>
            </>
          )}
          {error && <Alert tone="error">{error}</Alert>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button variant="accent" loading={busy} disabled={result.errors.length > 0 || errs.length > 0} onClick={async () => {
              setBusy(true); setError(null)
              try { await onApply(cfg, result.rooms); onClose() } catch (e) { setError(e instanceof Error ? e.message : 'Could not apply the layout.') } finally { setBusy(false) }
            }}><Wand2 className="h-4 w-4" /> Apply to project</Button>
          </div>
        </div>
      </div>
    </Dialog>
  )
}
