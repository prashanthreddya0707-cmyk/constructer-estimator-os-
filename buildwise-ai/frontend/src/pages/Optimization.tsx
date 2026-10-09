import { AlertTriangle, CheckCircle2, Info, RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ProjectScope } from '@/components/ProjectScope'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Alert, Badge, EmptyState, ErrorState, Spinner } from '@/components/ui/feedback'
import { Input } from '@/components/ui/form'
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table'
import { useEstimate } from '@/features/estimation/useEstimate'
import { useToast } from '@/lib/toast'
import { cn, formatMoney, formatNumber } from '@/lib/utils'
import type { Recommendation } from '@/types'

export default function Optimization() {
  return (
    <ProjectScope basePath="/optimization" title="Waste Optimization" description="Transparent, rule-based recommendations generated from your project's actual data. Savings are shown only when quantities and prices exist.">
      {(id) => <Body key={id} projectId={id} />}
    </ProjectScope>
  )
}

const SEV = {
  critical: { tone: 'red' as const, icon: AlertTriangle, ring: 'border-red-200', label: 'Critical' },
  warning: { tone: 'amber' as const, icon: AlertTriangle, ring: 'border-amber-200', label: 'Review' },
  info: { tone: 'navy' as const, icon: Info, ring: 'border-slate-200', label: 'Info' },
}

function RecCard({ r, currency }: { r: Recommendation; currency: string }) {
  const s = SEV[r.severity]
  const Icon = s.icon
  return (
    <Card className={cn('p-5', s.ring)}>
      <div className="flex items-start gap-3">
        <Icon className={cn('mt-0.5 h-5 w-5 shrink-0', r.severity === 'critical' ? 'text-red-500' : r.severity === 'warning' ? 'text-amber-500' : 'text-navy-400')} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold text-navy-900">{r.title}</h3><Badge tone={s.tone}>{s.label}</Badge>{r.material && <Badge>{r.material}</Badge>}</div>
          <p className="mt-1 text-sm text-slate-700">{r.explanation}</p>
          <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm md:grid-cols-3">
            <div><dt className="font-medium text-slate-500">Reason</dt><dd>{r.reason}</dd></div>
            <div><dt className="font-medium text-slate-500">Suggested action</dt><dd>{r.suggested_action}</dd></div>
            <div><dt className="font-medium text-slate-500">Potential benefit</dt><dd>{r.potential_benefit}{r.potential_savings != null && <span className="ml-1 font-semibold text-emerald-700">(up to {formatMoney(r.potential_savings, currency)})</span>}</dd></div>
          </dl>
        </div>
      </div>
    </Card>
  )
}

function Body({ projectId }: { projectId: string }) {
  const toast = useToast()
  const { project, estimate, loading, calculating, error, estimateError, recalc, applyConfig } = useEstimate(projectId)
  const [plan, setPlan] = useState<Record<string, string>>({})
  useEffect(() => { if (project) setPlan(Object.fromEntries(Object.entries(project.purchase_quantities).map(([k, v]) => [k, String(v)]))) }, [project])

  if (loading) return <Spinner label="Analysing…" />
  if (error || !project) return <ErrorState message={error ?? 'Project not found.'} onRetry={recalc} />
  if (estimateError || !estimate) return <Alert tone="error" title="Recommendations need a valid estimate">{estimateError} <Link className="underline" to={`/projects/${project.id}`}>Fix project data</Link>.</Alert>

  const recs = estimate.recommendations
  const savePlan = async () => {
    const out: Record<string, number | null> = {}
    for (const [k, v] of Object.entries(plan)) {
      if (v.trim() === '') { out[k] = null; continue }
      const n = Number(v)
      if (!Number.isFinite(n) || n < 0) { toast.error(`Planned purchase for ${k} must be zero or positive.`); return }
      out[k] = n
    }
    try { await applyConfig({ purchase_quantities: out }); toast.success('Purchase plan saved and recommendations refreshed.') } catch (e) { toast.error(e instanceof Error ? e.message : 'Failed') }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title={`Recommendations (${recs.length})`} description="Each recommendation states its reason, a suggested action and the potential benefit."
          action={<Button size="sm" variant="outline" loading={calculating} onClick={recalc}><RefreshCw className="h-4 w-4" /> Refresh</Button>} />
        <CardBody className="space-y-4">
          {recs.length === 0 ? <EmptyState icon={<CheckCircle2 className="h-6 w-6 text-emerald-500" />} title="No issues found" description="No rule flagged this project. Re-check after changing dimensions, prices or wastage." /> : recs.map((r) => <RecCard key={r.id} r={r} currency={project.currency} />)}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Planned purchase quantities (optional)" description="Enter what you plan to buy. BuildWise AI flags differences of 10 % or more from the requirement including wastage." />
        <Table>
          <THead><TR><TH>Material</TH><TH className="text-right">Requirement (incl. wastage)</TH><TH>Unit</TH><TH className="w-44 text-right">Planned purchase</TH><TH className="text-right">Difference</TH></TR></THead>
          <TBody>
            {estimate.items.filter((i) => i.counts_toward_cost).map((it) => {
              const planned = plan[it.key] !== undefined && plan[it.key] !== '' ? Number(plan[it.key]) : null
              const diff = planned !== null && Number.isFinite(planned) ? planned - it.gross_quantity : null
              return (
                <TR key={it.key}>
                  <TD className="font-medium">{it.name}</TD><TD className="text-right tabular-nums">{formatNumber(it.gross_quantity)}</TD><TD>{it.unit}</TD>
                  <TD className="text-right"><Input type="number" min={0} step="any" aria-label={`Planned ${it.name}`} className="h-8 text-right" value={plan[it.key] ?? ''} onChange={(e) => setPlan((p) => ({ ...p, [it.key]: e.target.value }))} /></TD>
                  <TD className={cn('text-right tabular-nums', diff != null && Math.abs(diff) / (it.gross_quantity || 1) >= 0.1 && 'font-semibold text-amber-700')}>{diff == null ? '—' : `${diff > 0 ? '+' : ''}${formatNumber(diff)}`}</TD>
                </TR>
              )
            })}
          </TBody>
        </Table>
        <div className="border-t border-slate-100 p-4"><Button variant="primary" loading={calculating} onClick={savePlan}>Save plan & refresh recommendations</Button></div>
      </Card>
      <p className="text-xs text-slate-500">Recommendations are produced by transparent rules (no machine learning). The service is structured so historical project data and trained models can be added later.</p>
    </div>
  )
}
