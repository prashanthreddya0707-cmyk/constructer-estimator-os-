import { ChevronDown, ChevronRight, Download, RefreshCw } from 'lucide-react'
import { Fragment, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ProjectScope } from '@/components/ProjectScope'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader, Stat } from '@/components/ui/card'
import { Alert, Badge, Disclaimer, ErrorState, Spinner } from '@/components/ui/feedback'
import { Field, Input, Select } from '@/components/ui/form'
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table'
import { useEstimate } from '@/features/estimation/useEstimate'
import { downloadReport } from '@/features/reports/download'
import { useToast } from '@/lib/toast'
import { useUnits } from '@/lib/units'
import { formatMoney, formatNumber } from '@/lib/utils'
import type { Estimate, ProjectDetail } from '@/types'

export default function Estimation() {
  const toast = useToast()
  return (
    <ProjectScope basePath="/estimation" title="Material Estimation" description="Quantities with formulas, assumptions and wastage. Change an input and recalculate."
      actions={(id) => <PdfButton projectId={id} toast={toast} />}>
      {(id) => <EstimationBody key={id} projectId={id} />}
    </ProjectScope>
  )
}

function PdfButton({ projectId, toast }: { projectId: string; toast: ReturnType<typeof useToast> }) {
  const [busy, setBusy] = useState(false)
  return (
    <Button variant="accent" loading={busy} onClick={async () => {
      setBusy(true)
      try { await downloadReport(projectId); toast.success('Report downloaded.') } catch (e) { toast.error(e instanceof Error ? e.message : 'Report failed') } finally { setBusy(false) }
    }}><Download className="h-4 w-4" /> Download PDF</Button>
  )
}

interface Draft {
  steel_kg_per_m3: string; mix_c: string; mix_s: string; mix_a: string; concrete_supply: string
  external_masonry: string; internal_masonry: string; internal_wall_thickness: string; mortar_joint_mm: string
  mortar_sand_ratio: string; plaster_sand_ratio: string; plaster_thickness_mm: string; plaster_ceilings: boolean
  tile_l: string; tile_w: string; paint_coats: string; paint_coverage: string; frame_concrete_pct: string
}

function draftFrom(a: Record<string, unknown>): Draft {
  const mix = (a.concrete_mix as number[]) ?? [1, 1.5, 3]
  const s = (k: string) => String(a[k] ?? '')
  return {
    steel_kg_per_m3: s('steel_kg_per_m3'), mix_c: String(mix[0]), mix_s: String(mix[1]), mix_a: String(mix[2]), concrete_supply: s('concrete_supply'),
    external_masonry: s('external_masonry'), internal_masonry: s('internal_masonry'), internal_wall_thickness: s('internal_wall_thickness'),
    mortar_joint_mm: String(Number(a.mortar_joint) * 1000), mortar_sand_ratio: s('mortar_sand_ratio'), plaster_sand_ratio: s('plaster_sand_ratio'),
    plaster_thickness_mm: String(Number(a.plaster_thickness) * 1000), plaster_ceilings: Boolean(a.plaster_ceilings),
    tile_l: s('tile_l'), tile_w: s('tile_w'), paint_coats: s('paint_coats'), paint_coverage: s('paint_coverage'), frame_concrete_pct: s('frame_concrete_pct'),
  }
}

/** Returns an error message, or the assumptions payload. */
function draftToAssumptions(d: Draft): { error: string } | { value: Record<string, unknown> } {
  const n = (s: string) => Number(s)
  const pos = (s: string, label: string) => (n(s) > 0 && Number.isFinite(n(s)) ? null : `${label} must be greater than 0.`)
  const err = pos(d.steel_kg_per_m3, 'Steel intensity') ?? pos(d.mix_c, 'Mix cement part') ?? pos(d.mix_s, 'Mix sand part') ?? pos(d.mix_a, 'Mix aggregate part')
    ?? pos(d.internal_wall_thickness, 'Internal wall thickness') ?? pos(d.mortar_sand_ratio, 'Mortar sand ratio') ?? pos(d.plaster_sand_ratio, 'Plaster sand ratio')
    ?? pos(d.plaster_thickness_mm, 'Plaster thickness') ?? pos(d.tile_l, 'Tile length') ?? pos(d.tile_w, 'Tile width') ?? pos(d.paint_coverage, 'Paint coverage')
  if (err) return { error: err }
  if (!(n(d.paint_coats) >= 1) || !Number.isInteger(n(d.paint_coats))) return { error: 'Paint coats must be a whole number of at least 1.' }
  if (!(n(d.mortar_joint_mm) >= 0) || !Number.isFinite(n(d.mortar_joint_mm))) return { error: 'Mortar joint must be 0 or more.' }
  if (!(n(d.frame_concrete_pct) >= 0) || !Number.isFinite(n(d.frame_concrete_pct))) return { error: 'Frame concrete allowance must be 0 or more.' }
  return {
    value: {
      steel_kg_per_m3: n(d.steel_kg_per_m3), concrete_mix: [n(d.mix_c), n(d.mix_s), n(d.mix_a)], concrete_supply: d.concrete_supply,
      external_masonry: d.external_masonry, internal_masonry: d.internal_masonry, internal_wall_thickness: n(d.internal_wall_thickness),
      mortar_joint: n(d.mortar_joint_mm) / 1000, mortar_sand_ratio: n(d.mortar_sand_ratio), plaster_sand_ratio: n(d.plaster_sand_ratio),
      plaster_thickness: n(d.plaster_thickness_mm) / 1000, plaster_ceilings: d.plaster_ceilings, tile_l: n(d.tile_l), tile_w: n(d.tile_w),
      paint_coats: n(d.paint_coats), paint_coverage: n(d.paint_coverage), frame_concrete_pct: n(d.frame_concrete_pct),
    },
  }
}

function EstimationBody({ projectId }: { projectId: string }) {
  const toast = useToast()
  const units = useUnits()
  const { project, estimate, loading, calculating, error, estimateError, recalc, applyConfig } = useEstimate(projectId)
  const [draft, setDraft] = useState<Draft>()
  const [waste, setWaste] = useState<Record<string, string>>({})
  const [open, setOpen] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => {
    if (estimate) {
      setDraft(draftFrom(estimate.assumptions))
      setWaste(Object.fromEntries(estimate.items.map((i) => [i.key, String(i.wastage_pct)])))
    }
  }, [estimate])

  if (loading) return <Spinner label="Calculating…" />
  if (error || !project) return <ErrorState message={error ?? 'Project not found.'} onRetry={recalc} />

  const apply = async () => {
    if (!draft) return
    const a = draftToAssumptions(draft)
    if ('error' in a) { setFormError(a.error); return }
    const w: Record<string, number> = {}
    for (const [k, v] of Object.entries(waste)) {
      const x = Number(v)
      if (v === '' || !Number.isFinite(x) || x < 0 || x > 100) { setFormError(`Wastage for ${k} must be between 0 and 100 %.`); return }
      w[k] = x
    }
    setFormError(null)
    try { await applyConfig({ assumptions: a.value, wastage: w }); toast.success('Estimate recalculated.') }
    catch (e) { setFormError(e instanceof Error ? e.message : 'Could not recalculate.') }
  }

  if (estimateError || !estimate || !draft) {
    return (
      <div className="space-y-4">
        <Alert tone="error" title="The estimate could not be calculated">{estimateError}</Alert>
        <p className="text-sm text-slate-600">Check the building dimensions and rooms on the <Link className="text-orange-600 underline" to={`/projects/${project.id}`}>project page</Link>.</p>
      </div>
    )
  }

  const set = (k: keyof Draft) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setDraft((d) => d && { ...d, [k]: e.target.value })
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Total built-up area" value={units.area(estimate.geometry.total_built_up_area)} hint={`${project.floors} floor(s) × ${units.area(estimate.geometry.floor_area)}`} />
        <Stat label="Estimated material cost" value={formatMoney(estimate.summary.material_total, project.currency)} hint={estimate.summary.complete ? 'All priced lines included' : 'Incomplete: some prices missing'} />
        <Stat label="External wall perimeter" value={units.length(estimate.geometry.external_perimeter)} />
        <Stat label="Internal wall length / floor" value={units.length(estimate.geometry.internal_wall_length_per_floor)} hint="Shared walls counted once" />
      </div>

      {estimate.warnings.length > 0 && <Alert tone="warning" title="Input checks"><ul className="ml-4 list-disc">{estimate.warnings.map((w) => <li key={w}>{w}</li>)}</ul></Alert>}
      {!estimate.summary.complete && <Alert tone="error" title="Missing prices">Some materials have no price, so costs are incomplete. Add prices in <Link className="underline" to="/prices">Material Prices</Link>.</Alert>}

      <Card>
        <CardHeader title="Quantities" description="Net = exact requirement; quantity including wastage is what you should plan to procure. Click a row for the formula and assumptions."
          action={<Button variant="primary" size="sm" loading={calculating} onClick={apply}><RefreshCw className="h-4 w-4" /> Apply changes & recalculate</Button>} />
        <Table>
          <THead><TR><TH /><TH>Material</TH><TH className="text-right">Net qty</TH><TH className="w-28 text-right">Wastage %</TH><TH className="text-right">Qty incl. wastage</TH><TH>Unit</TH><TH className="text-right">Unit price</TH><TH className="text-right">Cost</TH></TR></THead>
          <TBody>
            {estimate.items.map((it) => (
              <Fragment key={it.key}>
                <TR className="cursor-pointer" onClick={() => setOpen(open === it.key ? null : it.key)}>
                  <TD className="w-8">{open === it.key ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</TD>
                  <TD><span className="font-medium">{it.name}</span>{!it.counts_toward_cost && <Badge className="ml-2">quantity only</Badge>}{it.material_label && it.counts_toward_cost && <div className="text-xs text-slate-500">{it.material_label}</div>}</TD>
                  <TD className="text-right tabular-nums">{formatNumber(it.net_quantity)}</TD>
                  <TD className="text-right" onClick={(e) => e.stopPropagation()}><Input type="number" min={0} max={100} step="any" aria-label={`Wastage for ${it.name}`} value={waste[it.key] ?? ''} onChange={(e) => setWaste((w) => ({ ...w, [it.key]: e.target.value }))} className="h-8 w-24 text-right" /></TD>
                  <TD className="text-right font-medium tabular-nums">{formatNumber(it.gross_quantity)}</TD>
                  <TD>{it.unit}</TD>
                  <TD className="text-right tabular-nums">{it.unit_price != null ? <>{formatNumber(it.unit_price)}{it.price_is_sample && <Badge tone="amber" className="ml-1">SAMPLE</Badge>}</> : it.counts_toward_cost ? <Badge tone="red">missing</Badge> : '—'}</TD>
                  <TD className="text-right font-medium tabular-nums">{!it.counts_toward_cost ? '—' : it.cost != null ? formatMoney(it.cost, project.currency) : '—'}</TD>
                </TR>
                {open === it.key && (
                  <TR><TD /><TD colSpan={7} className="bg-slate-50">
                    <p className="text-sm"><span className="font-semibold">Formula:</span> {it.formula}</p>
                    <p className="mt-2 text-sm font-semibold">Assumptions</p>
                    <ul className="ml-5 list-disc text-sm text-slate-600">{it.assumptions.map((a) => <li key={a}>{a}</li>)}</ul>
                    {it.note && <p className="mt-2 text-sm text-slate-600">{it.note}</p>}
                  </TD></TR>
                )}
              </Fragment>
            ))}
          </TBody>
        </Table>
      </Card>

      <Card>
        <CardHeader title="Calculation assumptions" description="Defaults are typical planning values, not site-verified. Adjust them to match your design and specification." />
        <CardBody className="space-y-4">
          {formError && <Alert tone="error">{formError}</Alert>}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Steel intensity (kg/m³ concrete)"><Input type="number" step="any" value={draft.steel_kg_per_m3} onChange={set('steel_kg_per_m3')} /></Field>
            <Field label="Concrete mix cement : sand : aggregate">
              <div className="flex gap-1"><Input type="number" step="any" value={draft.mix_c} onChange={set('mix_c')} aria-label="Cement part" /><Input type="number" step="any" value={draft.mix_s} onChange={set('mix_s')} aria-label="Sand part" /><Input type="number" step="any" value={draft.mix_a} onChange={set('mix_a')} aria-label="Aggregate part" /></div>
            </Field>
            <Field label="Concrete supply"><Select value={draft.concrete_supply} onChange={set('concrete_supply')}><option value="site_mix">Site mix (cement, sand, aggregate)</option><option value="ready_mix">Ready-mix concrete</option></Select></Field>
            <Field label="Frame concrete allowance (% of slab)" hint="Columns, beams, footings"><Input type="number" step="any" value={draft.frame_concrete_pct} onChange={set('frame_concrete_pct')} /></Field>
            <Field label="External masonry"><Select value={draft.external_masonry} onChange={set('external_masonry')}><option value="brick">Bricks</option><option value="block">Blocks</option></Select></Field>
            <Field label="Internal masonry"><Select value={draft.internal_masonry} onChange={set('internal_masonry')}><option value="brick">Bricks</option><option value="block">Blocks</option></Select></Field>
            <Field label="Internal wall thickness (m)"><Input type="number" step="any" value={draft.internal_wall_thickness} onChange={set('internal_wall_thickness')} /></Field>
            <Field label="Mortar joint (mm)"><Input type="number" step="any" value={draft.mortar_joint_mm} onChange={set('mortar_joint_mm')} /></Field>
            <Field label="Mortar mix 1 : sand"><Input type="number" step="any" value={draft.mortar_sand_ratio} onChange={set('mortar_sand_ratio')} /></Field>
            <Field label="Plaster mix 1 : sand"><Input type="number" step="any" value={draft.plaster_sand_ratio} onChange={set('plaster_sand_ratio')} /></Field>
            <Field label="Plaster thickness (mm)"><Input type="number" step="any" value={draft.plaster_thickness_mm} onChange={set('plaster_thickness_mm')} /></Field>
            <Field label="Plaster ceilings"><Select value={draft.plaster_ceilings ? 'yes' : 'no'} onChange={(e) => setDraft((d) => d && { ...d, plaster_ceilings: e.target.value === 'yes' })}><option value="yes">Yes</option><option value="no">No</option></Select></Field>
            <Field label="Tile length (m)"><Input type="number" step="any" value={draft.tile_l} onChange={set('tile_l')} /></Field>
            <Field label="Tile width (m)"><Input type="number" step="any" value={draft.tile_w} onChange={set('tile_w')} /></Field>
            <Field label="Paint coats"><Input type="number" step={1} value={draft.paint_coats} onChange={set('paint_coats')} /></Field>
            <Field label="Paint coverage (m²/litre/coat)"><Input type="number" step="any" value={draft.paint_coverage} onChange={set('paint_coverage')} /></Field>
          </div>
          <Button variant="primary" loading={calculating} onClick={apply}><RefreshCw className="h-4 w-4" /> Apply changes & recalculate</Button>
        </CardBody>
      </Card>
      <ExtraNotes estimate={estimate} project={project} />
      <Disclaimer />
    </div>
  )
}

function ExtraNotes({ estimate, project }: { estimate: Estimate; project: ProjectDetail }) {
  return (
    <p className="text-xs text-slate-500">
      Last calculated {estimate.created_at ? new Date(estimate.created_at).toLocaleString() : 'just now'} for “{project.name}”.
      Openings deducted from walls: {estimate.geometry.door_count ?? 0} door(s) and {estimate.geometry.window_count ?? 0} window(s), {estimate.geometry.openings_source ?? 'estimated from room counts'} (open the 3D Studio and save the layout to use its exact doors and windows). Estimates are rule-based calculations, not machine-learning predictions.
      Prices come from your <Link className="underline" to="/prices">price list</Link> (sample prices are placeholders).
    </p>
  )
}
