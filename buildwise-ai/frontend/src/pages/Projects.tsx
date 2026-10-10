import { Calculator, Box, Copy, FolderOpen, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { ConfirmDialog } from '@/components/ui/dialog'
import { Badge, EmptyState, ErrorState, Spinner } from '@/components/ui/feedback'
import { Input } from '@/components/ui/form'
import { PageHeader } from '@/components/ui/page'
import { useAsync } from '@/hooks/useApi'
import { api } from '@/lib/api'
import { useToast } from '@/lib/toast'
import { useUnits } from '@/lib/units'
import { formatDate, formatMoney } from '@/lib/utils'
import type { Project } from '@/types'

export default function Projects() {
  const { data, loading, error, reload } = useAsync(() => api.projects(), [])
  const toast = useToast()
  const units = useUnits()
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [del, setDel] = useState<Project | null>(null)
  const [busy, setBusy] = useState(false)

  const list = (data ?? []).filter((p) => (p.name + p.location + p.owner_name).toLowerCase().includes(q.toLowerCase()))
  return (
    <>
      <PageHeader title="My projects" description="All your saved projects and estimates." actions={<div className="flex gap-2"><Button variant="outline" onClick={async () => { try { const p = await api.seedDemo(); toast.success('Demo project created: opening the 3D Studio.'); navigate(`/studio/${p.id}`) } catch (e) { toast.error(e instanceof Error ? e.message : 'Failed') } }}><Box className="h-4 w-4" /> Load demo &amp; open 3D</Button><Link to="/projects/new"><Button variant="accent"><Plus className="h-4 w-4" /> New project</Button></Link></div>} />
      {loading && <Spinner />}
      {error && <ErrorState message={error} onRetry={reload} />}
      {data && data.length === 0 && (
        <EmptyState title="No projects yet" description="Create your first project or load a clearly-labelled demo project to explore the app."
          action={<div className="flex gap-2"><Link to="/projects/new"><Button variant="accent">Create project</Button></Link>
            <Button variant="outline" onClick={async () => { try { const p = await api.seedDemo(); toast.success('Demo project created.'); navigate(`/projects/${p.id}`) } catch (e) { toast.error(e instanceof Error ? e.message : 'Failed') } }}><Copy className="h-4 w-4" /> Load demo project</Button></div>} />
      )}
      {data && data.length > 0 && (
        <>
          <Input placeholder="Search projects…" value={q} onChange={(e) => setQ(e.target.value)} className="mb-4 max-w-sm" aria-label="Search projects" />
          {list.length === 0 && <p className="text-sm text-slate-500">No projects match “{q}”.</p>}
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {list.map((p) => (
              <Card key={p.id} className="flex flex-col p-5">
                <div className="flex items-start justify-between gap-2">
                  <Link to={`/projects/${p.id}`} className="font-semibold text-navy-900 hover:text-orange-600">{p.name}</Link>
                  {p.is_demo && <Badge tone="amber">DEMO</Badge>}
                </div>
                <p className="mt-1 text-sm text-slate-500">{p.location || 'No location'} · <span className="capitalize">{p.building_type}</span></p>
                <dl className="mt-4 grid grid-cols-2 gap-y-1 text-sm">
                  <dt className="text-slate-500">Floors</dt><dd>{p.floors}</dd>
                  <dt className="text-slate-500">Rooms</dt><dd>{p.room_count}</dd>
                  <dt className="text-slate-500">Built-up area</dt><dd>{units.area(p.total_built_up_area)}</dd>
                  <dt className="text-slate-500">Material cost</dt><dd>{p.latest_total_cost != null ? formatMoney(p.latest_total_cost, p.currency) : 'Not estimated'}</dd>
                  <dt className="text-slate-500">Updated</dt><dd>{formatDate(p.updated_at)}</dd>
                </dl>
                <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-4">
                  <Link to={`/projects/${p.id}`}><Button size="sm" variant="outline"><FolderOpen className="h-4 w-4" /> Open</Button></Link>
                  <Link to={`/studio/${p.id}`}><Button size="sm" variant="outline"><Box className="h-4 w-4" /> 3D</Button></Link>
                  <Link to={`/estimation/${p.id}`}><Button size="sm" variant="outline"><Calculator className="h-4 w-4" /> Estimate</Button></Link>
                  <Button size="icon" variant="ghost" className="ml-auto" aria-label={`Delete ${p.name}`} onClick={() => setDel(p)}><Trash2 className="h-4 w-4 text-red-500" /></Button>
                </div>
              </Card>
            ))}
          </div>
        </>
      )}
      <ConfirmDialog open={!!del} onClose={() => setDel(null)} loading={busy} title="Delete project?"
        message={`“${del?.name}” with its rooms, estimates, floor plans and reports will be permanently deleted.`}
        onConfirm={async () => {
          setBusy(true)
          try { await api.deleteProject(del!.id); toast.success('Project deleted.'); setDel(null); await reload() } catch (e) { toast.error(e instanceof Error ? e.message : 'Delete failed') } finally { setBusy(false) }
        }} />
    </>
  )
}
