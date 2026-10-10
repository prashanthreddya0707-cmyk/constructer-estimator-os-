import { ScanLine, Upload } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Alert, Badge, Spinner } from '@/components/ui/feedback'
import { Field, Input, Select } from '@/components/ui/form'
import { validateFile } from '@/features/projects/FloorPlanPanel'
import { api } from '@/lib/api'
import { ROOM_TYPES } from '@/lib/utils'
import type { DetectResult, FloorPlan, ProjectDetail, RoomInput } from '@/types'

interface Row { include: boolean; name: string; type: string; x0: number; z0: number; x1: number; z1: number; doors: number; windows: number; rectangular: boolean }
const snap = (v: number) => Math.round(v / 0.05) * 0.05

/**
 * Method A: floor-plan image -> rooms. Automatic detection is only a *suggestion*: it finds closed, roughly rectangular
 * regions. Names, doors, windows and dimension text are not read from the image. Nothing is created until the user has
 * reviewed/corrected every room and ticked the confirmation box.
 */
export function FloorPlanImportDialog({ open, onClose, project, onConfirm }: {
  open: boolean
  onClose: () => void
  project: ProjectDetail
  onConfirm: (rooms: RoomInput[], dims: { length: number; width: number } | null, floor: number) => Promise<void>
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [plans, setPlans] = useState<FloorPlan[]>(project.floorplans)
  const [planId, setPlanId] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<DetectResult | null>(null)
  const [rows, setRows] = useState<Row[]>([])
  const [totalLength, setTotalLength] = useState(String(project.length))
  const [floor, setFloor] = useState(1)
  const [updateDims, setUpdateDims] = useState(true)
  const [confirmed, setConfirmed] = useState(false)

  useEffect(() => {
    if (!open) return
    const imgs = project.floorplans.filter((f) => f.content_type !== 'application/pdf')
    setPlans(project.floorplans); setPlanId(imgs[0]?.id ?? null); setResult(null); setRows([]); setError(null); setConfirmed(false); setFloor(1)
    setTotalLength(String(project.length))
  }, [open, project])

  const plan = plans.find((p) => p.id === planId) ?? null
  const bounds = useMemo(() => {
    if (!result?.rooms.length) return null
    const x0 = Math.min(...result.rooms.map((r) => r.x)), y0 = Math.min(...result.rooms.map((r) => r.y))
    return { x0, y0, w: Math.max(...result.rooms.map((r) => r.x + r.w)) - x0, h: Math.max(...result.rooms.map((r) => r.y + r.h)) - y0 }
  }, [result])

  const buildRows = (res: DetectResult, lengthM: number) => {
    const b = { x0: Math.min(...res.rooms.map((r) => r.x)), y0: Math.min(...res.rooms.map((r) => r.y)), w: Math.max(...res.rooms.map((r) => r.x + r.w)) - Math.min(...res.rooms.map((r) => r.x)) }
    const s = lengthM / b.w
    setRows(res.rooms.map((r) => ({
      include: true, name: `Room ${r.index}`, type: 'other', x0: snap((r.x - b.x0) * s), z0: snap((r.y - b.y0) * s), x1: snap((r.x + r.w - b.x0) * s), z1: snap((r.y + r.h - b.y0) * s),
      doors: 1, windows: 1, rectangular: r.rectangular,
    })))
  }

  const upload = async (f: File | undefined) => {
    if (!f) return
    const err = validateFile(f)
    if (err) { setError(err); return }
    setBusy('Uploading…'); setError(null)
    try { const fp = await api.uploadFloorplan(project.id, f); setPlans((p) => [...p, fp]); setPlanId(fp.id); setResult(null); setRows([]) }
    catch (e) { setError(e instanceof Error ? e.message : 'Upload failed.') } finally { setBusy(null) }
  }
  const detect = async () => {
    if (!plan) return
    setBusy('Detecting rooms…'); setError(null); setConfirmed(false)
    try {
      const res = await api.detectRooms(plan.id)
      setResult(res)
      if (res.rooms.length) {
        const b = { w: Math.max(...res.rooms.map((r) => r.x + r.w)) - Math.min(...res.rooms.map((r) => r.x)) }
        const len = plan.scale_m_per_px ? +(b.w * plan.scale_m_per_px).toFixed(2) : project.length // calibrated scale wins, else fit to the building length
        setTotalLength(String(len))
        buildRows(res, len)
      } else setRows([])
    } catch (e) { setError(e instanceof Error ? e.message : 'Detection failed.') } finally { setBusy(null) }
  }

  const lengthM = Number(totalLength)
  const scale = bounds && lengthM > 0 ? lengthM / bounds.w : 0
  const widthM = bounds && scale ? bounds.h * scale : 0
  const upd = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, k) => (k === i ? { ...r, ...patch } : r)))
  const included = rows.filter((r) => r.include)
  const rowErrors = included.flatMap((r) => [!(r.x1 - r.x0 >= 0.8 && r.z1 - r.z0 >= 0.8) && `"${r.name}" must be at least 0.8 m in both directions.`, !r.name.trim() && 'Every room needs a name.']).filter(Boolean) as string[]
  const canCreate = included.length > 0 && confirmed && rowErrors.length === 0 && lengthM > 0

  const confirm = async () => {
    setBusy('Creating rooms…'); setError(null)
    try {
      const rooms: RoomInput[] = included.map((r) => ({
        name: r.name.trim(), room_type: r.type, length: +(r.x1 - r.x0).toFixed(3), width: +(r.z1 - r.z0).toFixed(3), height: project.height, floor_number: floor, wall_thickness: null,
        doors: r.doors, windows: r.windows, area_override: null, pos_x: +r.x0.toFixed(3), pos_y: +r.z0.toFixed(3),
      }))
      await onConfirm(rooms, updateDims && bounds ? { length: +lengthM.toFixed(2), width: +widthM.toFixed(2) } : null, floor)
      onClose()
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not create the rooms.') } finally { setBusy(null) }
  }

  return (
    <Dialog open={open} onClose={onClose} title="Upload 2D floor plan" description="Detect rooms from a plan image, correct them, confirm, then generate the 3D model from the confirmed rooms." className="w-[min(64rem,calc(100vw-2rem))]">
      <div className="space-y-4">
        <Alert tone="warning" title="Detection is a suggestion, not a measurement">
          BuildWise AI finds closed, roughly rectangular regions in clean plans (walls = dark lines). It cannot read room names, doors, windows or dimension text, and L-shaped rooms are approximated by a rectangle. Check every room against your plan; doors and windows are added automatically and can be moved afterwards in the 2D plan.
        </Alert>
        {error && <Alert tone="error">{error}</Alert>}

        <div className="flex flex-wrap items-center gap-2">
          <input ref={fileRef} type="file" accept=".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf" className="hidden" onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = '' }} />
          <Button variant="outline" onClick={() => fileRef.current?.click()}><Upload className="h-4 w-4" /> Upload plan (JPG / PNG / PDF)</Button>
          {plans.length > 0 && (
            <Select aria-label="Floor plan file" value={planId ?? ''} onChange={(e) => { setPlanId(e.target.value || null); setResult(null); setRows([]) }} className="w-64">
              <option value="">Choose uploaded plan…</option>
              {plans.map((p) => <option key={p.id} value={p.id}>{p.original_name}{p.content_type === 'application/pdf' ? ' (PDF)' : ''}</option>)}
            </Select>
          )}
          <Button variant="primary" disabled={!plan || plan.content_type === 'application/pdf'} loading={!!busy && busy.startsWith('Detect')} onClick={detect}><ScanLine className="h-4 w-4" /> Detect rooms</Button>
          {plan?.content_type === 'application/pdf' && <Badge tone="amber">PDF: export a page as PNG/JPG to detect rooms, or add rooms manually</Badge>}
        </div>
        {busy && !busy.startsWith('Detect') && <Spinner label={busy} className="py-2" />}
        {busy?.startsWith('Detect') && <Spinner label={busy} className="py-4" />}

        {result && (
          <div className="space-y-4">
            {result.warnings.map((w) => <Alert key={w} tone="warning">{w}</Alert>)}
            {result.rooms.length === 0 && <Alert tone="error" title="No rooms detected">Draw the rooms manually (Edit floor plan) or use "Generate from building details".</Alert>}
            {result.rooms.length > 0 && (
              <>
                <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
                  <div>
                    <p className="mb-1 text-sm font-medium text-slate-700">Detected regions (numbered)</p>
                    <img src={`data:image/png;base64,${result.overlay_png_base64}`} alt="Detected rooms overlaid on the floor plan" className="w-full rounded border border-slate-200" />
                  </div>
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-2">
                      <Field label="Overall plan length (m)" hint={plan?.scale_m_per_px ? 'From your calibrated scale. Edit to override.' : 'Not calibrated: enter the real length of the whole plan.'}>
                        <Input type="number" step="any" value={totalLength} onChange={(e) => { setTotalLength(e.target.value); const l = Number(e.target.value); if (l > 0 && result) buildRows(result, l) }} />
                      </Field>
                      <Field label="Resulting plan width (m)"><Input value={widthM ? widthM.toFixed(2) : '—'} disabled /></Field>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <Field label="Create rooms on floor"><Input type="number" min={1} max={project.floors > 1 ? project.floors : 1} step={1} value={floor} onChange={(e) => setFloor(Math.max(1, Math.min(project.floors, Number(e.target.value) || 1)))} /></Field>
                      <label className="mt-6 flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-orange-500" checked={updateDims} onChange={(e) => setUpdateDims(e.target.checked)} /> Set building length/width to the plan</label>
                    </div>
                  </div>
                </div>

                <div className="overflow-x-auto rounded-lg border border-slate-200">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="px-2 py-2">Use</th><th className="px-2">Name</th><th className="px-2">Type</th><th className="px-2">X (m)</th><th className="px-2">Y (m)</th><th className="px-2">Length</th><th className="px-2">Width</th><th className="px-2">Doors</th><th className="px-2">Windows</th></tr></thead>
                    <tbody className="divide-y divide-slate-100">
                      {rows.map((r, i) => (
                        <tr key={i} className={r.include ? '' : 'opacity-50'}>
                          <td className="px-2 py-1.5"><input type="checkbox" className="h-4 w-4 accent-orange-500" aria-label={`Include room ${i + 1}`} checked={r.include} onChange={(e) => upd(i, { include: e.target.checked })} /></td>
                          <td className="px-2"><Input value={r.name} onChange={(e) => upd(i, { name: e.target.value })} className="h-8 w-36" aria-label={`Name of room ${i + 1}`} />{!r.rectangular && <Badge tone="amber" className="ml-1">not rectangular</Badge>}</td>
                          <td className="px-2"><Select value={r.type} onChange={(e) => upd(i, { type: e.target.value })} className="h-8 w-32" aria-label={`Type of room ${i + 1}`}>{ROOM_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</Select></td>
                          <td className="px-2"><Input type="number" step="0.05" value={+r.x0.toFixed(2)} onChange={(e) => upd(i, { x0: Number(e.target.value) })} className="h-8 w-20" /></td>
                          <td className="px-2"><Input type="number" step="0.05" value={+r.z0.toFixed(2)} onChange={(e) => upd(i, { z0: Number(e.target.value) })} className="h-8 w-20" /></td>
                          <td className="px-2"><Input type="number" step="0.05" value={+(r.x1 - r.x0).toFixed(2)} onChange={(e) => upd(i, { x1: r.x0 + Number(e.target.value) })} className="h-8 w-20" /></td>
                          <td className="px-2"><Input type="number" step="0.05" value={+(r.z1 - r.z0).toFixed(2)} onChange={(e) => upd(i, { z1: r.z0 + Number(e.target.value) })} className="h-8 w-20" /></td>
                          <td className="px-2"><Input type="number" min={0} step={1} value={r.doors} onChange={(e) => upd(i, { doors: Math.max(0, Number(e.target.value) || 0) })} className="h-8 w-16" /></td>
                          <td className="px-2"><Input type="number" min={0} step={1} value={r.windows} onChange={(e) => upd(i, { windows: Math.max(0, Number(e.target.value) || 0) })} className="h-8 w-16" /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {rowErrors.length > 0 && <Alert tone="error">{[...new Set(rowErrors)].join(' ')}</Alert>}
                {(project.rooms.some((r) => r.floor_number === floor)) && <Alert tone="warning">Rooms already on floor {floor} will be replaced. Rooms on other floors are kept.</Alert>}
                <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-0.5 h-4 w-4 accent-orange-500" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} /> I have checked these rooms, positions and dimensions against my floor plan and confirm they are correct.</label>
              </>
            )}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button variant="accent" disabled={!canCreate} loading={busy === 'Creating rooms…'} onClick={confirm}>Create rooms & generate 3D</Button>
        </div>
      </div>
    </Dialog>
  )
}
