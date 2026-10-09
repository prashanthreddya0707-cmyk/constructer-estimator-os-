import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Alert } from '@/components/ui/feedback'
import { Field, Input, Select } from '@/components/ui/form'
import { ROOM_TYPES } from '@/lib/utils'
import type { RoomInput } from '@/types'
import { blankToUndef, roomDefaults, roomSchema, toRoomInput, type RoomFormValues } from './schemas'

const n = { valueAsNumber: true } as const
const opt = { setValueAs: blankToUndef } as const

export function RoomDialog({ open, onClose, initial, maxFloor, onSubmit, title }: {
  open: boolean; onClose: () => void; initial?: RoomInput; maxFloor: number; onSubmit: (r: RoomInput) => Promise<void> | void; title?: string
}) {
  const [error, setError] = useState<string | null>(null)
  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<RoomFormValues>({ resolver: zodResolver(roomSchema), defaultValues: roomDefaults })
  useEffect(() => {
    if (open) {
      setError(null)
      reset(initial ? { ...initial, wall_thickness: initial.wall_thickness ?? undefined, area_override: initial.area_override ?? undefined, pos_x: initial.pos_x ?? undefined, pos_y: initial.pos_y ?? undefined } : roomDefaults)
    }
  }, [open, initial, reset])

  return (
    <Dialog open={open} onClose={onClose} title={title ?? (initial ? 'Edit room' : 'Add room')} description="Dimensions in metres.">
      <form className="space-y-4" onSubmit={handleSubmit(async (v) => {
        if (v.floor_number > maxFloor) { setError(`The project has only ${maxFloor} floor(s).`); return }
        setError(null)
        try { await onSubmit(toRoomInput(v)); onClose() } catch (e) { setError(e instanceof Error ? e.message : 'Could not save the room.') }
      })}>
        {error && <Alert tone="error">{error}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Room name *" error={errors.name?.message}><Input invalid={!!errors.name} {...register('name')} /></Field>
          <Field label="Room type"><Select {...register('room_type')}>{ROOM_TYPES.map((t) => <option key={t} value={t}>{t[0].toUpperCase() + t.slice(1)}</option>)}</Select></Field>
          <Field label="Length (m) *" error={errors.length?.message}><Input type="number" step="any" invalid={!!errors.length} {...register('length', n)} /></Field>
          <Field label="Width (m) *" error={errors.width?.message}><Input type="number" step="any" invalid={!!errors.width} {...register('width', n)} /></Field>
          <Field label="Height (m) *" error={errors.height?.message}><Input type="number" step="any" invalid={!!errors.height} {...register('height', n)} /></Field>
          <Field label={`Floor number (1–${maxFloor}) *`} error={errors.floor_number?.message}><Input type="number" step={1} invalid={!!errors.floor_number} {...register('floor_number', n)} /></Field>
          <Field label="Doors" error={errors.doors?.message}><Input type="number" step={1} {...register('doors', n)} /></Field>
          <Field label="Windows" error={errors.windows?.message}><Input type="number" step={1} {...register('windows', n)} /></Field>
          <Field label="Wall thickness (m, optional)" error={errors.wall_thickness?.message} hint="Overrides the default internal wall thickness."><Input type="number" step="any" {...register('wall_thickness', opt)} /></Field>
          <Field label="Area override (m², optional)" error={errors.area_override?.message} hint="For irregular rooms."><Input type="number" step="any" {...register('area_override', opt)} /></Field>
          <Field label="Position X (m, optional)" error={errors.pos_x?.message} hint="From the building's left edge."><Input type="number" step="any" {...register('pos_x', opt)} /></Field>
          <Field label="Position Y (m, optional)" error={errors.pos_y?.message} hint="From the building's top edge."><Input type="number" step="any" {...register('pos_y', opt)} /></Field>
        </div>
        <p className="text-xs text-slate-500">Positions are optional. If any room on a floor has no position, that floor is shown in a schematic layout in the 3D Studio.</p>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="accent" loading={isSubmitting}>{initial ? 'Save room' : 'Add room'}</Button>
        </div>
      </form>
    </Dialog>
  )
}
