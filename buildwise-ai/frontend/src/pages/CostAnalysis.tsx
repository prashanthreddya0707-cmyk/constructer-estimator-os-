import { Download, GitCompare, RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ProjectScope } from '@/components/ProjectScope'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader, Stat } from '@/components/ui/card'
import { Alert, Badge, Disclaimer, ErrorState, Spinner } from '@/components/ui/feedback'
import { Input, Select } from '@/components/ui/form'
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table'
import { useEstimate } from '@/features/estimation/useEstimate'
import { CostBars, CostPie } from '@/features/pricing/charts'
import { downloadReport } from '@/features/reports/download'
import { api } from '@/lib/api'
import { useToast } from '@/lib/toast'
import { cn, formatMoney, formatNumber } from '@/lib/utils'
import type { Estimate, ExtraCostConfig, ProjectDetail } from '@/types'

export default function CostAnalysis() {
  const toast = useToast()
  return (
    <ProjectScope basePath="/cost-analysis" title="Cost Analysis" description="Material cost, budget variance and alternative scenarios. Material-only cost is kept separate from optional extras."
      actions={(id) => <Button variant="accent" onClick={async () => { try { await downloadReport(id); toast.success('Report downloaded.') } catch (e) { toast.error(e instanceof Error ? e.message : 'Report failed') } }}><Download className="h-4 w-4" /> Download PDF</Button>}>
      {(id) => <Body key={id} projectId={id} />}
    </ProjectScope>
  )
}

const EXTRA_LABEL: Record<string, string> = { labour: 'Labour', transportation: 'Transportation', contingency: 'Contingency', other: 'Other costs' }

function Body({ projectId }: { projectId: string }) {
  const toast = useToast()
  const { project, estimate, loading, calculating, error, estimateError, recalc, applyConfig } = useEstimate(projectId)
  const [budget, setBudget] = useState('')
  const [extras, setExtras] = useState<Record<string, ExtraCostConfig>>({})
  const [scenario, setScenario] = useState<Record<string, string>>({})
  const [scenarioResult, setScenarioResult] = useState<Estimate | null>(null)

  useEffect(() => { if (project) setBudget(project.budget != null ? String(project.budget) : '') }, [project])
  useEffect(() => {
    if (estimate) setExtras(Object.fromEntries(estimate.summary.extras.map((e) => [e.key, { enabled: e.enabled, mode: e.mode as 'fixed' | 'percent', value: e.value }])))
    setScenarioResult(null)
  }, [estimate])

  if (loading) return <Spinner label="Calculating…" />
  if (error || !project) return <ErrorState message={error ?? 'Project not found.'} onRetry={recalc} />
  if (estimateError || !estimate) return <Alert tone="error" title="The estimate could not be calculated">{estimateError} <Link className="underline" to={`/projects/${project.id}`}>Check project dimensions</Link>.</Alert>

  const s = estimate.summary
  const cur = project.currency
  const costed = estimate.items.filter((i) => i.counts_toward_cost)
  const guard = async (fn: () => Promise<unknown>, ok: string) => {
    try { await fn(); toast.success(ok) } catch (e) { toast.error(e instanceof Error ? e.message : 'Something went wrong.') }
  }

  const saveBudget = () => guard(async () => {
    const v = budget.trim() === '' ? null : Number(budget)
    if (v !== null && !(v > 0)) throw new Error('Budget must be a positive number (or blank to clear).')
    await api.updateProject(project.id, baseOf(project, v))
    await recalc()
  }, 'Budget saved.')

  const savePrice = (itemKey: string, materialId: string | null, value: string, current: number | null) => {
    const v = Number(value)
    if (value.trim() === '' || !Number.isFinite(v) || v < 0) { toast.error('Enter a valid, non-negative unit price.'); return }
    if (!materialId || v === current) return
    void guard(async () => { await api.createPrice({ material_id: materialId, unit_price: v, currency: cur, supplier: 'User-entered', location: project.location }); await recalc() }, `Price for ${itemKey} saved.`)
  }

  const scenarioDelta = scenarioResult ? scenarioResult.summary.material_total - s.material_total : null
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Total material cost" value={formatMoney(s.material_total, cur)} hint={s.complete ? 'All priced lines included' : 'Incomplete – prices missing'} />
        <Stat label="Total incl. enabled extras" value={formatMoney(s.project_total, cur)} hint={s.extras_total > 0 ? `Includes ${formatMoney(s.extras_total, cur)} of extras` : 'No extras enabled'} />
        <Stat label="Material cost / m²" value={formatMoney(s.cost_per_sqm, cur)} hint={`over ${formatNumber(estimate.geometry.total_built_up_area, 1)} m² built-up`} />
        <Stat label="Material cost / sq ft" value={formatMoney(s.cost_per_sqft, cur)} />
      </div>

      {!s.complete && <Alert tone="error" title="Missing prices">Add prices for: {estimate.items.filter((i) => s.missing_price_keys.includes(i.key)).map((i) => i.name).join(', ')}. <Link className="underline" to="/prices">Open Material Prices</Link></Alert>}
      {estimate.items.some((i) => i.price_is_sample && i.counts_toward_cost) && <Alert tone="warning" title="Sample prices in use">Lines marked SAMPLE use placeholder rates, not market prices. Edit a unit price below to enter your locally verified rate.</Alert>}

      <div className="grid gap-4 lg:grid-cols-[1fr_2fr]">
        <Card>
          <CardHeader title="Budget" description="Compared with the total including enabled extras." />
          <CardBody className="space-y-3">
            <div className="flex gap-2"><Input type="number" min={0} step="any" value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="No budget" aria-label="Project budget" /><Button variant="outline" onClick={saveBudget}>Save</Button></div>
            {s.budget ? (
              <div className={cn('rounded-lg p-3 text-sm', (s.budget_variance ?? 0) >= 0 ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-800')}>
                <p className="font-semibold">{(s.budget_variance ?? 0) >= 0 ? 'Under budget' : 'Over budget'} by {formatMoney(Math.abs(s.budget_variance ?? 0), cur)}</p>
                <p>Estimate is {formatNumber(s.budget_used_pct, 0)} % of the budget ({formatMoney(s.budget, cur)}).</p>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/70"><div className={cn('h-full', (s.budget_variance ?? 0) >= 0 ? 'bg-emerald-500' : 'bg-red-500')} style={{ width: `${Math.min(100, s.budget_used_pct ?? 0)}%` }} /></div>
              </div>
            ) : <p className="text-sm text-slate-500">Set a budget to see the variance.</p>}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Cost distribution" />
          <CardBody className="grid gap-2 md:grid-cols-2">
            <CostPie data={s.by_category} currency={cur} />
            <CostBars data={costed.filter((i) => i.cost).map((i) => ({ name: i.name.replace(' (RCC slabs)', ''), cost: Math.round(i.cost ?? 0) }))} currency={cur} />
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader title="Material-wise cost" description="Edit a unit price (saved as your own price record) or switch the material. Costs update immediately."
          action={<Button size="sm" variant="outline" loading={calculating} onClick={recalc}><RefreshCw className="h-4 w-4" /> Recalculate</Button>} />
        <Table>
          <THead><TR><TH>Material</TH><TH>Selected product</TH><TH className="text-right">Qty (incl. wastage)</TH><TH>Unit</TH><TH className="w-36 text-right">Unit price ({cur})</TH><TH className="text-right">Cost</TH><TH className="text-right">Share</TH></TR></THead>
          <TBody>
            {costed.map((it) => (
              <TR key={it.key}>
                <TD className="font-medium">{it.name}</TD>
                <TD>
                  <Select aria-label={`Product for ${it.name}`} value={it.material_id ?? ''} className="h-8 min-w-48 text-xs"
                    onChange={(e) => void guard(() => applyConfig({ material_selections: { [it.key]: e.target.value } }), 'Material selection updated.')}>
                    {(estimate.alternatives?.[it.key] ?? []).map((a) => <option key={a.id} value={a.id}>{a.label}{a.unit_price != null ? ` – ${formatNumber(a.unit_price)}` : ' – no price'}</option>)}
                  </Select>
                </TD>
                <TD className="text-right tabular-nums">{formatNumber(it.gross_quantity)}</TD>
                <TD>{it.unit}</TD>
                <TD className="text-right"><PriceCell key={`${it.material_id}-${it.unit_price}`} value={it.unit_price} sample={it.price_is_sample} onCommit={(v) => savePrice(it.name, it.material_id, v, it.unit_price)} /></TD>
                <TD className="text-right font-medium tabular-nums">{it.cost != null ? formatMoney(it.cost, cur) : <Badge tone="red">no price</Badge>}</TD>
                <TD className="text-right tabular-nums text-slate-500">{it.cost && s.material_total ? `${((it.cost / s.material_total) * 100).toFixed(1)} %` : '—'}</TD>
              </TR>
            ))}
            <TR className="bg-slate-50 font-semibold"><TD colSpan={5}>Total material cost</TD><TD className="text-right tabular-nums">{formatMoney(s.material_total, cur)}</TD><TD /></TR>
          </TBody>
        </Table>
        <p className="border-t border-slate-100 px-5 py-3 text-xs text-slate-500">Concrete, mortar and plaster are quantity-only lines (priced via cement, sand and aggregate) unless ready-mix concrete is selected in Material Estimation, so nothing is counted twice.</p>
      </Card>

      <Card>
        <CardHeader title="Optional additional costs" description="Only included in the total when enabled and populated. Percentages apply to material cost." />
        <CardBody className="space-y-3">
          {s.extras.map((e) => {
            const cfg = extras[e.key] ?? { enabled: false, mode: 'fixed', value: 0 }
            return (
              <div key={e.key} className="flex flex-wrap items-center gap-3">
                <label className="flex w-44 items-center gap-2 text-sm font-medium"><input type="checkbox" className="h-4 w-4 accent-orange-500" checked={cfg.enabled} onChange={(ev) => setExtras((x) => ({ ...x, [e.key]: { ...cfg, enabled: ev.target.checked } }))} />{EXTRA_LABEL[e.key]}</label>
                <Select value={cfg.mode} onChange={(ev) => setExtras((x) => ({ ...x, [e.key]: { ...cfg, mode: ev.target.value as 'fixed' | 'percent' } }))} className="h-8 w-40 text-sm" aria-label={`${EXTRA_LABEL[e.key]} mode`}><option value="fixed">Fixed amount</option><option value="percent">% of materials</option></Select>
                <Input type="number" min={0} step="any" value={cfg.value} onChange={(ev) => setExtras((x) => ({ ...x, [e.key]: { ...cfg, value: Number(ev.target.value) } }))} className="h-8 w-32" aria-label={`${EXTRA_LABEL[e.key]} value`} />
                <span className="text-sm text-slate-500">{e.included ? `= ${formatMoney(e.amount, cur)}` : e.enabled ? 'enter a value' : 'not included'}</span>
              </div>
            )
          })}
          <Button variant="primary" size="sm" loading={calculating} onClick={() => void guard(() => {
            for (const c of Object.values(extras)) if (!(c.value >= 0)) throw new Error('Extra costs cannot be negative.')
            return applyConfig({ extra_costs: extras })
          }, 'Additional costs updated.')}>Apply</Button>
          <p className="text-sm font-medium text-navy-900">Total including enabled extras: {formatMoney(s.project_total, cur)}</p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Alternative material scenario" description="Try different products and compare the project total before applying them." />
        <CardBody className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {costed.filter((i) => (estimate.alternatives?.[i.key]?.length ?? 0) > 1).map((it) => (
              <label key={it.key} className="block text-sm"><span className="mb-1 block font-medium text-slate-700">{it.name}</span>
                <Select value={scenario[it.key] ?? it.material_id ?? ''} onChange={(e) => { setScenario((sc) => ({ ...sc, [it.key]: e.target.value })); setScenarioResult(null) }} className="h-8 text-xs">
                  {(estimate.alternatives?.[it.key] ?? []).map((a) => <option key={a.id} value={a.id}>{a.label}{a.unit_price != null ? ` – ${formatNumber(a.unit_price)}` : ' – no price'}</option>)}
                </Select></label>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => void guard(async () => setScenarioResult(await api.runEstimate(project.id, { material_selections: scenario })), 'Scenario calculated (not saved).')}><GitCompare className="h-4 w-4" /> Compare scenario</Button>
            {scenarioResult && <Button variant="accent" onClick={() => void guard(() => applyConfig({ material_selections: scenario }), 'Scenario applied to the project.')}>Apply this scenario</Button>}
          </div>
          {scenarioResult && scenarioDelta !== null && (
            <div className="grid gap-3 sm:grid-cols-3">
              <Stat label="Current material total" value={formatMoney(s.material_total, cur)} />
              <Stat label="Scenario material total" value={formatMoney(scenarioResult.summary.material_total, cur)} hint={scenarioResult.summary.complete ? undefined : 'Some prices missing in scenario'} />
              <Stat label="Difference" value={<span className={scenarioDelta <= 0 ? 'text-emerald-600' : 'text-red-600'}>{scenarioDelta > 0 ? '+' : ''}{formatMoney(scenarioDelta, cur)}</span>} hint="Lower price does not imply equal quality" />
            </div>
          )}
        </CardBody>
      </Card>
      <Disclaimer />
    </div>
  )
}

function PriceCell({ value, sample, onCommit }: { value: number | null; sample: boolean; onCommit: (v: string) => void }) {
  const [v, setV] = useState(value != null ? String(value) : '')
  return (
    <div className="flex items-center justify-end gap-1">
      {sample && <Badge tone="amber">SAMPLE</Badge>}
      <Input type="number" min={0} step="any" value={v} aria-label="Unit price" onChange={(e) => setV(e.target.value)} onBlur={() => onCommit(v)} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} className="h-8 w-24 text-right" />
    </div>
  )
}

function baseOf(p: ProjectDetail, budget: number | null) {
  return {
    name: p.name, description: p.description, owner_name: p.owner_name, building_type: p.building_type, location: p.location, floors: p.floors,
    currency: p.currency, budget, length: p.length, width: p.width, height: p.height, wall_thickness: p.wall_thickness,
    slab_thickness: p.slab_thickness, built_up_area: p.built_up_area,
  }
}
