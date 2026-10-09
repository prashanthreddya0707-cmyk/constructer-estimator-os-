import { zodResolver } from '@hookform/resolvers/zod'
import { Check, Pencil, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Alert, EmptyState } from '@/components/ui/feedback'
import { PageHeader } from '@/components/ui/page'
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table'
import { FilePicker } from '@/features/projects/FloorPlanPanel'
import { BuildingDimensionFields, ProjectDetailsFields } from '@/features/projects/ProjectFields'
import { RoomDialog } from '@/features/projects/RoomDialog'
import { projectDefaults, projectSchema, toProjectBase, type ProjectFormValues } from '@/features/projects/schemas'
import { api } from '@/lib/api'
import { useToast } from '@/lib/toast'
import { useUnits } from '@/lib/units'
import { cn, formatMoney } from '@/lib/utils'
import type { RoomInput } from '@/types'

const STEPS = ['Project details', 'Building dimensions', 'Rooms', 'Floor plan', 'Review & save']
const STEP_FIELDS: (keyof ProjectFormValues)[][] = [
  ['name', 'description', 'owner_name', 'building_type', 'location', 'floors', 'currency', 'budget'],
  ['length', 'width', 'height', 'wall_thickness', 'slab_thickness', 'built_up_area'],
]

export default function NewProject() {
  const navigate = useNavigate()
  const toast = useToast()
  const units = useUnits()
  const [step, setStep] = useState(0)
  const [rooms, setRooms] = useState<RoomInput[]>([])
  const [file, setFile] = useState<File | null>(null)
  const [dialog, setDialog] = useState<{ index: number | null } | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { register, trigger, getValues, watch, formState: { errors } } = useForm<ProjectFormValues>({ resolver: zodResolver(projectSchema), defaultValues: projectDefaults, mode: 'onTouched' })
  const [l, w, floors] = watch(['length', 'width', 'floors'])
  const footprint = Number.isFinite(l * w) ? l * w : 0

  const next = async () => {
    if (step < 2) { if (!(await trigger(STEP_FIELDS[step]))) return }
    if (step === 2) {
      const bad = rooms.find((r) => r.floor_number > floors)
      if (bad) { setError(`Room "${bad.name}" is on floor ${bad.floor_number}, but the project has ${floors} floor(s). Edit the room or the number of floors.`); return }
    }
    setError(null)
    setStep((s) => s + 1)
  }

  const save = async () => {
    if (!(await trigger())) { setStep(0); toast.error('Please fix the highlighted fields.'); return }
    setSaving(true); setError(null)
    try {
      const project = await api.createProject({ ...toProjectBase(getValues()), rooms })
      if (file) {
        try { await api.uploadFloorplan(project.id, file) } catch (e) { toast.error(`Project saved, but the floor plan upload failed: ${e instanceof Error ? e.message : 'unknown error'}`) }
      }
      toast.success('Project saved.')
      navigate(`/projects/${project.id}`)
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save the project.') } finally { setSaving(false) }
  }

  const v = getValues()
  const byFloor = Array.from({ length: Number.isFinite(floors) ? Math.max(1, Math.min(floors, 50)) : 1 }, (_, i) => {
    const rs = rooms.filter((r) => r.floor_number === i + 1)
    return { floor: i + 1, count: rs.length, area: rs.reduce((a, r) => a + (r.area_override ?? r.length * r.width), 0) }
  })

  return (
    <>
      <PageHeader title="New project" description="Enter building details, dimensions and rooms. You can refine everything later." />
      <ol className="mb-6 flex flex-wrap gap-2" aria-label="Progress">
        {STEPS.map((s, i) => (
          <li key={s} className={cn('flex items-center gap-2 rounded-full border px-3 py-1 text-sm', i === step ? 'border-orange-500 bg-orange-50 text-orange-700' : i < step ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-white text-slate-500')} aria-current={i === step ? 'step' : undefined}>
            <span className={cn('flex h-5 w-5 items-center justify-center rounded-full text-xs font-semibold', i < step ? 'bg-emerald-500 text-white' : i === step ? 'bg-orange-500 text-white' : 'bg-slate-200')}>{i < step ? <Check className="h-3 w-3" /> : i + 1}</span>{s}
          </li>
        ))}
      </ol>
      <div className="mb-4 h-1.5 overflow-hidden rounded-full bg-slate-200"><div className="h-full bg-orange-500 transition-all" style={{ width: `${((step + 1) / STEPS.length) * 100}%` }} /></div>

      <Card>
        <CardHeader title={STEPS[step]} />
        <CardBody className="space-y-5">
          {error && <Alert tone="error">{error}</Alert>}
          <div className={step === 0 ? '' : 'hidden'}><ProjectDetailsFields register={register} errors={errors} /></div>
          <div className={step === 1 ? 'space-y-4' : 'hidden'}>
            <BuildingDimensionFields register={register} errors={errors} area={footprint || undefined} />
            <Alert>Floor area = Length × Width = <strong>{footprint ? footprint.toFixed(2) : '—'} m²</strong> per floor ({footprint ? (footprint * (floors || 1)).toFixed(2) : '—'} m² total built-up area). All dimensions are in metres.</Alert>
          </div>

          {step === 2 && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-slate-500">Add each room with its dimensions. Rooms are optional but improve wall, opening, tile and 3D accuracy.</p>
                <Button variant="accent" size="sm" onClick={() => setDialog({ index: null })}><Plus className="h-4 w-4" /> Add room</Button>
              </div>
              {rooms.length === 0 ? <EmptyState title="No rooms yet" description="Without rooms, partition walls and openings are not estimated and the 3D model shows only the building shell." /> : (
                <Table>
                  <THead><TR><TH>Floor</TH><TH>Room</TH><TH>Type</TH><TH>L × W × H (m)</TH><TH>Area</TH><TH>Doors / Win.</TH><TH /></TR></THead>
                  <TBody>
                    {rooms.map((r, i) => (
                      <TR key={i}>
                        <TD>{r.floor_number}</TD><TD className="font-medium">{r.name}</TD><TD className="capitalize">{r.room_type}</TD>
                        <TD>{r.length} × {r.width} × {r.height}</TD><TD>{units.area(r.area_override ?? r.length * r.width)}</TD><TD>{r.doors} / {r.windows}</TD>
                        <TD className="text-right">
                          <Button size="icon" variant="ghost" aria-label={`Edit ${r.name}`} onClick={() => setDialog({ index: i })}><Pencil className="h-4 w-4" /></Button>
                          <Button size="icon" variant="ghost" aria-label={`Remove ${r.name}`} onClick={() => setRooms((rs) => rs.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4 text-red-500" /></Button>
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              )}
              {byFloor.some((f) => f.count) && (
                <div className="text-xs text-slate-500">{byFloor.filter((f) => f.count).map((f) => `Floor ${f.floor}: ${f.count} room(s), ${f.area.toFixed(1)} m² of ${footprint.toFixed(1)} m²`).join(' · ')}</div>
              )}
            </div>
          )}

          {step === 3 && (
            <div className="space-y-3">
              <p className="text-sm text-slate-500">Optional. Attach a floor plan (JPG, PNG or PDF). It is uploaded when the project is saved; you can then calibrate its scale on the project page. Room dimensions are always confirmed manually.</p>
              <FilePicker file={file} onChange={setFile} />
            </div>
          )}

          {step === 4 && (
            <div className="space-y-5">
              <div className="grid gap-4 md:grid-cols-2">
                <Card className="p-4 text-sm"><h4 className="mb-2 font-semibold text-navy-900">Project</h4>
                  <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
                    <dt className="text-slate-500">Name</dt><dd>{v.name}</dd><dt className="text-slate-500">Owner</dt><dd>{v.owner_name || '—'}</dd>
                    <dt className="text-slate-500">Type</dt><dd className="capitalize">{v.building_type}</dd><dt className="text-slate-500">Location</dt><dd>{v.location || '—'}</dd>
                    <dt className="text-slate-500">Floors</dt><dd>{v.floors}</dd><dt className="text-slate-500">Budget</dt><dd>{v.budget ? formatMoney(v.budget, v.currency) : 'Not set'}</dd>
                  </dl></Card>
                <Card className="p-4 text-sm"><h4 className="mb-2 font-semibold text-navy-900">Building</h4>
                  <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
                    <dt className="text-slate-500">Length × Width</dt><dd>{v.length} m × {v.width} m</dd><dt className="text-slate-500">Height</dt><dd>{v.height} m</dd>
                    <dt className="text-slate-500">Wall / Slab</dt><dd>{v.wall_thickness} m / {v.slab_thickness} m</dd>
                    <dt className="text-slate-500">Floor area</dt><dd>{units.area(v.built_up_area ?? v.length * v.width)}{v.built_up_area ? ' (override)' : ''}</dd>
                    <dt className="text-slate-500">Rooms</dt><dd>{rooms.length}</dd><dt className="text-slate-500">Floor plan</dt><dd>{file ? file.name : 'None'}</dd>
                  </dl></Card>
              </div>
              {rooms.length === 0 && <Alert tone="warning">No rooms added. You can save now and add rooms later from the project page.</Alert>}
            </div>
          )}

          <div className="flex justify-between border-t border-slate-100 pt-4">
            <Button variant="outline" disabled={step === 0} onClick={() => { setError(null); setStep((s) => s - 1) }}>Back</Button>
            {step < STEPS.length - 1 ? <Button onClick={next}>Next</Button> : <Button variant="accent" loading={saving} onClick={save}>Save project</Button>}
          </div>
        </CardBody>
      </Card>

      <RoomDialog open={!!dialog} onClose={() => setDialog(null)} maxFloor={Number.isFinite(floors) ? floors : 1}
        initial={dialog?.index != null ? rooms[dialog.index] : undefined}
        onSubmit={(r) => setRooms((rs) => (dialog?.index != null ? rs.map((x, i) => (i === dialog.index ? r : x)) : [...rs, r]))} />
    </>
  )
}
