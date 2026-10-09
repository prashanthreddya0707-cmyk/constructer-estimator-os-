import { Pencil, Plus, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { ConfirmDialog } from '@/components/ui/dialog'
import { Alert, Badge, EmptyState, ErrorState, Spinner } from '@/components/ui/feedback'
import { Input, Select } from '@/components/ui/form'
import { PageHeader, ProjectPicker } from '@/components/ui/page'
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table'
import { MaterialDialog } from '@/features/materials/MaterialDialog'
import { useAsync } from '@/hooks/useApi'
import { api } from '@/lib/api'
import { useToast } from '@/lib/toast'
import { cn, formatDate, formatMoney, formatNumber, KEY_LABEL, PRICED_KEYS } from '@/lib/utils'
import type { Estimate, Material, Project } from '@/types'

export default function Catalogue() {
  const toast = useToast()
  const mats = useAsync(() => api.materials(), [])
  const projects = useAsync(() => api.projects(), [])
  const [q, setQ] = useState('')
  const [key, setKey] = useState('all')
  const [edit, setEdit] = useState<{ m: Material | null } | null>(null)
  const [del, setDel] = useState<Material | null>(null)

  const list = (mats.data ?? []).filter((m) => (key === 'all' || m.estimate_key === key) && `${m.name} ${m.brand} ${m.grade} ${m.supplier} ${m.category}`.toLowerCase().includes(q.toLowerCase()))
  return (
    <>
      <PageHeader title="Material catalogue" description="Browse materials, compare alternatives and select the ones used by a project."
        actions={<Button variant="accent" onClick={() => setEdit({ m: null })}><Plus className="h-4 w-4" /> Add material</Button>} />
      <Alert tone="warning" title="Sample prices">Built-in materials carry placeholder SAMPLE prices for demonstration, not current market rates. Enter your locally verified rates on <Link className="underline" to="/prices">Material Prices</Link>.</Alert>
      <div className="my-4 flex flex-wrap gap-2">
        <Input placeholder="Search materials, brands, suppliers…" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" aria-label="Search materials" />
        <Select value={key} onChange={(e) => setKey(e.target.value)} className="w-48" aria-label="Filter by material type"><option value="all">All material types</option>{PRICED_KEYS.map((k) => <option key={k} value={k}>{KEY_LABEL[k]}</option>)}</Select>
      </div>

      {mats.loading && <Spinner />}
      {mats.error && <ErrorState message={mats.error} onRetry={mats.reload} />}
      {mats.data && (list.length === 0 ? <EmptyState title="No materials match" description="Adjust the filters or add a custom material." /> : (
        <Card className="mb-8"><Table>
          <THead><TR><TH>Material</TH><TH>Category</TH><TH>Brand</TH><TH>Grade / spec</TH><TH>Unit</TH><TH className="text-right">Unit price</TH><TH>Supplier</TH><TH>Location</TH><TH>Updated</TH><TH /></TR></THead>
          <TBody>{list.map((m) => (
            <TR key={m.id}>
              <TD className="font-medium">{m.name}<div className="text-xs font-normal text-slate-500">{m.specification}</div></TD>
              <TD>{m.category}</TD><TD>{m.brand || '—'}</TD><TD>{m.grade || '—'}</TD><TD>{m.unit}</TD>
              <TD className="text-right tabular-nums">{m.unit_price != null ? formatMoney(m.unit_price, m.currency ?? 'INR', 2) : '—'}{m.price_is_sample && <Badge tone="amber" className="ml-1">SAMPLE</Badge>}</TD>
              <TD>{m.supplier || '—'}</TD><TD>{m.location || '—'}</TD><TD className="whitespace-nowrap">{formatDate(m.last_updated)}</TD>
              <TD className="whitespace-nowrap text-right">{m.editable ? <>
                <Button size="icon" variant="ghost" aria-label={`Edit ${m.name}`} onClick={() => setEdit({ m })}><Pencil className="h-4 w-4" /></Button>
                <Button size="icon" variant="ghost" aria-label={`Delete ${m.name}`} onClick={() => setDel(m)}><Trash2 className="h-4 w-4 text-red-500" /></Button></> : <Badge>Built-in</Badge>}</TD>
            </TR>))}</TBody>
        </Table></Card>
      ))}

      {mats.data && projects.data && <ComparePanel materials={mats.data} projects={projects.data} />}

      <MaterialDialog open={!!edit} onClose={() => setEdit(null)} material={edit?.m} onSaved={() => { toast.success('Material saved.'); void mats.reload() }} />
      <ConfirmDialog open={!!del} onClose={() => setDel(null)} title="Delete material?" message={`“${del?.name}” and its price records will be deleted. Projects using it fall back to the default material.`}
        onConfirm={async () => { try { await api.deleteMaterial(del!.id); toast.success('Material deleted.'); await mats.reload() } catch (e) { toast.error(e instanceof Error ? e.message : 'Delete failed') } setDel(null) }} />
    </>
  )
}

function ComparePanel({ materials, projects }: { materials: Material[]; projects: Project[] }) {
  const toast = useToast()
  const [key, setKey] = useState<string>('cement')
  const [pid, setPid] = useState<string | undefined>(projects[0]?.id)
  const [est, setEst] = useState<Estimate | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (!pid) return
    let live = true
    setErr(null)
    api.runEstimate(pid).then((e) => { if (live) setEst(e) })
      .catch((e) => { if (live) { setEst(null); setErr(e instanceof Error ? e.message : 'Could not load the project estimate.') } })
    return () => { live = false }
  }, [pid])

  const alts = materials.filter((m) => m.estimate_key === key)
  const item = est?.items.find((i) => i.key === key)
  const qty = item?.gross_quantity ?? null
  const priced = alts.filter((m) => m.unit_price != null)
  const lowest = priced.length ? Math.min(...priced.map((m) => m.unit_price as number)) : null
  const currentId = item?.material_id
  const cur = projects.find((p) => p.id === pid)?.currency ?? 'INR'

  const choose = async (m: Material) => {
    if (!pid) return
    try {
      await api.updateConfig(pid, { material_selections: { [key]: m.id } })
      setEst(await api.runEstimate(pid))
      toast.success(`${m.name} selected for this project. Estimate recalculated.`)
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not select the material.') }
  }

  return (
    <Card>
      <CardHeader title="Compare alternatives" description="See each option's effect on the total project cost using the selected project's quantity."
        action={<div className="flex flex-wrap gap-2"><Select value={key} onChange={(e) => setKey(e.target.value)} className="w-40" aria-label="Material type to compare">{PRICED_KEYS.map((k) => <option key={k} value={k}>{KEY_LABEL[k]}</option>)}</Select>
          {projects.length > 0 && <ProjectPicker projects={projects} value={pid} onChange={setPid} />}</div>} />
      <CardBody>
        {projects.length === 0 ? <p className="text-sm text-slate-500">Create a project to compare costs against its quantities. <Link className="text-orange-600 underline" to="/projects/new">New project</Link></p> : err ? <Alert tone="error">{err}</Alert> : (
          <>
            <p className="mb-3 text-sm text-slate-600">Project requirement: <strong>{qty != null ? `${formatNumber(qty)} ${item?.unit}` : '—'}</strong> (incl. wastage). The lowest price is highlighted for convenience only — it is <strong>not</strong> a recommendation on quality.</p>
            {alts.length === 0 ? <EmptyState title="No alternatives" description="Add materials of this type to compare." /> : (
              <Table>
                <THead><TR><TH>Option</TH><TH>Brand</TH><TH>Grade</TH><TH>Specification</TH><TH>Durability notes</TH><TH>Supplier</TH><TH className="text-right">Price / unit</TH><TH className="text-right">Cost for this project</TH><TH /></TR></THead>
                <TBody>{alts.map((m) => {
                  const cost = m.unit_price != null && qty != null ? m.unit_price * qty : null
                  const isLow = m.unit_price != null && m.unit_price === lowest && priced.length > 1
                  return (
                    <TR key={m.id} className={cn(isLow && 'bg-emerald-50/60')}>
                      <TD className="font-medium">{m.name}{isLow && <Badge tone="green" className="ml-2">Lowest price</Badge>}{m.id === currentId && <Badge tone="navy" className="ml-2">Selected</Badge>}</TD>
                      <TD>{m.brand || '—'}</TD><TD>{m.grade || '—'}</TD><TD className="max-w-48 text-xs text-slate-600">{m.specification || '—'}</TD><TD className="max-w-48 text-xs text-slate-600">{m.durability_notes || '—'}</TD>
                      <TD>{m.supplier || '—'}</TD>
                      <TD className="text-right tabular-nums">{m.unit_price != null ? formatMoney(m.unit_price, cur, 2) : <Badge tone="red">no price</Badge>}{m.price_is_sample && <Badge tone="amber" className="ml-1">SAMPLE</Badge>}</TD>
                      <TD className="text-right font-medium tabular-nums">{cost != null ? formatMoney(cost, cur) : '—'}</TD>
                      <TD><Button size="sm" variant={m.id === currentId ? 'outline' : 'primary'} disabled={m.id === currentId} onClick={() => choose(m)}>{m.id === currentId ? 'In use' : 'Use in project'}</Button></TD>
                    </TR>)
                })}</TBody>
              </Table>
            )}
          </>
        )}
      </CardBody>
    </Card>
  )
}
