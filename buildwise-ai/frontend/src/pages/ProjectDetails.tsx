import { Box, Calculator, Download, Pencil, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader, Stat } from '@/components/ui/card'
import { ConfirmDialog } from '@/components/ui/dialog'
import { Badge, EmptyState, ErrorState, Spinner } from '@/components/ui/feedback'
import { PageHeader } from '@/components/ui/page'
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table'
import { BuildingDialog } from '@/features/projects/BuildingDialog'
import { FloorPlanPanel } from '@/features/projects/FloorPlanPanel'
import { RoomDialog } from '@/features/projects/RoomDialog'
import { useAsync } from '@/hooks/useApi'
import { api } from '@/lib/api'
import { downloadReport } from '@/features/reports/download'
import { useToast } from '@/lib/toast'
import { useUnits } from '@/lib/units'
import { formatDate, formatMoney } from '@/lib/utils'
import type { Room } from '@/types'

export default function ProjectDetails() {
  const { projectId = '' } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const units = useUnits()
  const { data: p, loading, error, reload } = useAsync(() => api.project(projectId), [projectId])
  const [editProject, setEditProject] = useState(false)
  const [roomDlg, setRoomDlg] = useState<{ room: Room | null } | null>(null)
  const [delRoom, setDelRoom] = useState<Room | null>(null)
  const [delProject, setDelProject] = useState(false)
  const [pdfBusy, setPdfBusy] = useState(false)

  if (loading && !p) return <Spinner />
  if (error || !p) return <ErrorState message={error ?? 'Project not found.'} onRetry={reload} />

  return (
    <>
      <PageHeader title={p.name} description={`${p.location || 'No location'} · ${p.building_type} · updated ${formatDate(p.updated_at)}`}
        actions={<>
          {p.is_demo && <Badge tone="amber">DEMO DATA</Badge>}
          <Button variant="outline" onClick={() => setEditProject(true)}><Pencil className="h-4 w-4" /> Edit</Button>
          <Link to={`/studio/${p.id}`}><Button variant="outline"><Box className="h-4 w-4" /> 3D Studio</Button></Link>
          <Link to={`/estimation/${p.id}`}><Button variant="primary"><Calculator className="h-4 w-4" /> Estimate</Button></Link>
          <Button variant="accent" loading={pdfBusy} onClick={async () => { setPdfBusy(true); try { await downloadReport(p.id); toast.success('Report downloaded.') } catch (e) { toast.error(e instanceof Error ? e.message : 'Report failed') } finally { setPdfBusy(false) } }}><Download className="h-4 w-4" /> Download PDF</Button>
        </>} />
      {p.description && <p className="mb-4 max-w-3xl text-sm text-slate-600">{p.description}</p>}

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Floor area (per floor)" value={units.area(p.floor_area)} hint={p.built_up_area ? 'Manual override' : 'Length × Width'} />
        <Stat label="Total built-up area" value={units.area(p.total_built_up_area)} hint={`${p.floors} floor(s)`} />
        <Stat label="Dimensions" value={`${p.length} × ${p.width} m`} hint={`Height ${p.height} m · walls ${p.wall_thickness} m · slab ${p.slab_thickness} m`} />
        <Stat label="Material cost" value={p.latest_total_cost != null ? formatMoney(p.latest_total_cost, p.currency) : '—'} hint={p.budget ? `Budget ${formatMoney(p.budget, p.currency)}` : 'No budget set'} />
      </div>

      <Card className="mb-6">
        <CardHeader title={`Rooms (${p.rooms.length})`} description="Changes here update the 3D model and estimates."
          action={<Button size="sm" variant="accent" onClick={() => setRoomDlg({ room: null })}><Plus className="h-4 w-4" /> Add room</Button>} />
        {p.rooms.length === 0 ? <CardBody><EmptyState title="No rooms" description="Add rooms to improve wall, opening, tile and 3D accuracy." /></CardBody> : (
          <Table>
            <THead><TR><TH>Floor</TH><TH>Name</TH><TH>Type</TH><TH>L × W × H (m)</TH><TH>Area</TH><TH>Doors</TH><TH>Windows</TH><TH /></TR></THead>
            <TBody>{p.rooms.map((r) => (
              <TR key={r.id}>
                <TD>{r.floor_number}</TD><TD className="font-medium">{r.name}</TD><TD className="capitalize">{r.room_type}</TD>
                <TD>{r.length} × {r.width} × {r.height}</TD><TD>{units.area(r.area)}</TD><TD>{r.doors}</TD><TD>{r.windows}</TD>
                <TD className="whitespace-nowrap text-right">
                  <Button size="icon" variant="ghost" aria-label={`Edit ${r.name}`} onClick={() => setRoomDlg({ room: r })}><Pencil className="h-4 w-4" /></Button>
                  <Button size="icon" variant="ghost" aria-label={`Delete ${r.name}`} onClick={() => setDelRoom(r)}><Trash2 className="h-4 w-4 text-red-500" /></Button>
                </TD>
              </TR>))}
            </TBody>
          </Table>
        )}
      </Card>

      <FloorPlanPanel projectId={p.id} floorplans={p.floorplans} onChanged={reload} />

      <div className="mt-8 flex justify-end"><Button variant="danger-outline" onClick={() => setDelProject(true)}><Trash2 className="h-4 w-4" /> Delete project</Button></div>

      <BuildingDialog open={editProject} onClose={() => setEditProject(false)} project={p} onSaved={reload} />
      <RoomDialog open={!!roomDlg} onClose={() => setRoomDlg(null)} maxFloor={p.floors} initial={roomDlg?.room ?? undefined}
        onSubmit={async (r) => { if (roomDlg?.room) await api.updateRoom(p.id, roomDlg.room.id, r); else await api.addRoom(p.id, r); toast.success('Room saved.'); await reload() }} />
      <ConfirmDialog open={!!delRoom} onClose={() => setDelRoom(null)} title="Delete room?" message={`Remove “${delRoom?.name}” from this project?`}
        onConfirm={async () => { try { await api.deleteRoom(p.id, delRoom!.id); toast.success('Room deleted.'); await reload() } catch (e) { toast.error(e instanceof Error ? e.message : 'Failed') } setDelRoom(null) }} />
      <ConfirmDialog open={delProject} onClose={() => setDelProject(false)} title="Delete project?" message="This permanently deletes the project, rooms, estimates, floor plans and reports."
        onConfirm={async () => { try { await api.deleteProject(p.id); toast.success('Project deleted.'); navigate('/projects') } catch (e) { toast.error(e instanceof Error ? e.message : 'Failed') } }} />
    </>
  )
}
