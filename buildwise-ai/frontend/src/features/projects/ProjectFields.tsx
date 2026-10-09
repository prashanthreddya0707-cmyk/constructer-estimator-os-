import type { FieldErrors, UseFormRegister } from 'react-hook-form'
import { Field, Input, Select, Textarea } from '@/components/ui/form'
import { BUILDING_TYPES, CURRENCIES } from '@/lib/utils'
import { blankToUndef, type ProjectFormValues } from './schemas'

type Props = { register: UseFormRegister<ProjectFormValues>; errors: FieldErrors<ProjectFormValues> }
const n = { valueAsNumber: true } as const
const opt = { setValueAs: blankToUndef } as const

export function ProjectDetailsFields({ register, errors }: Props) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Project name *" error={errors.name?.message} className="sm:col-span-2"><Input invalid={!!errors.name} {...register('name')} placeholder="e.g. Sharma Residence" /></Field>
      <Field label="Description" error={errors.description?.message} className="sm:col-span-2"><Textarea {...register('description')} /></Field>
      <Field label="Owner / client" error={errors.owner_name?.message}><Input {...register('owner_name')} /></Field>
      <Field label="Building type" error={errors.building_type?.message}>
        <Select {...register('building_type')}>{BUILDING_TYPES.map((t) => <option key={t} value={t}>{t[0].toUpperCase() + t.slice(1)}</option>)}</Select>
      </Field>
      <Field label="Location" error={errors.location?.message}><Input {...register('location')} placeholder="City / region" /></Field>
      <Field label="Number of floors *" error={errors.floors?.message}><Input type="number" min={1} step={1} invalid={!!errors.floors} {...register('floors', n)} /></Field>
      <Field label="Currency" error={errors.currency?.message}>
        <Select {...register('currency')}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</Select>
      </Field>
      <Field label="Project budget (optional)" error={errors.budget?.message} hint="Used for budget variance on Cost Analysis."><Input type="number" min={0} step="any" invalid={!!errors.budget} {...register('budget', opt)} /></Field>
    </div>
  )
}

export function BuildingDimensionFields({ register, errors, area }: Props & { area?: number }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Building length (m) *" error={errors.length?.message}><Input type="number" step="any" invalid={!!errors.length} {...register('length', n)} /></Field>
      <Field label="Building width (m) *" error={errors.width?.message}><Input type="number" step="any" invalid={!!errors.width} {...register('width', n)} /></Field>
      <Field label="Floor-to-ceiling height (m) *" error={errors.height?.message}><Input type="number" step="any" invalid={!!errors.height} {...register('height', n)} /></Field>
      <Field label="External wall thickness (m) *" error={errors.wall_thickness?.message} hint="0.23 m = standard 9-inch wall"><Input type="number" step="any" invalid={!!errors.wall_thickness} {...register('wall_thickness', n)} /></Field>
      <Field label="Slab thickness (m) *" error={errors.slab_thickness?.message}><Input type="number" step="any" invalid={!!errors.slab_thickness} {...register('slab_thickness', n)} /></Field>
      <Field label="Built-up area override (m² per floor)" error={errors.built_up_area?.message}
        hint={area !== undefined ? `Leave blank to use Length × Width = ${area.toFixed(2)} m². Override for irregular buildings.` : 'Leave blank to use Length × Width.'}>
        <Input type="number" step="any" invalid={!!errors.built_up_area} {...register('built_up_area', opt)} />
      </Field>
    </div>
  )
}
