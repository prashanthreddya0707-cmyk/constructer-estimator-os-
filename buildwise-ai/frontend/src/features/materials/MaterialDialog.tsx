import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Alert } from '@/components/ui/feedback'
import { Field, Input, Select, Textarea } from '@/components/ui/form'
import { api } from '@/lib/api'
import { KEY_LABEL, PRICED_KEYS } from '@/lib/utils'
import type { Material } from '@/types'

const empty = { estimate_key: 'cement', name: '', category: '', brand: '', grade: '', specification: '', durability_notes: '', unit: '', unit_price: '', supplier: '', location: '' }

/** Create or edit a user-owned catalogue material. */
export function MaterialDialog({ open, onClose, material, onSaved, currency = 'INR' }: { open: boolean; onClose: () => void; material?: Material | null; onSaved: () => void; currency?: string }) {
  const [f, setF] = useState(empty)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!open) return
    setError(null)
    setF(material ? { ...empty, ...material, unit_price: '' } : empty)
  }, [open, material])
  const set = (k: keyof typeof empty) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF((s) => ({ ...s, [k]: e.target.value }))

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!f.name.trim() || !f.unit.trim() || !f.category.trim()) { setError('Name, category and unit are required.'); return }
    const price = f.unit_price.trim() === '' ? undefined : Number(f.unit_price)
    if (price !== undefined && (!Number.isFinite(price) || price < 0)) { setError('Unit price must be zero or positive.'); return }
    setBusy(true); setError(null)
    try {
      const base = { estimate_key: f.estimate_key, name: f.name.trim(), category: f.category.trim(), brand: f.brand, grade: f.grade, specification: f.specification, durability_notes: f.durability_notes, unit: f.unit.trim() }
      if (material) await api.updateMaterial(material.id, base)
      else await api.createMaterial({ ...base, unit_price: price, supplier: f.supplier, location: f.location, currency })
      onSaved(); onClose()
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not save the material.') } finally { setBusy(false) }
  }

  return (
    <Dialog open={open} onClose={onClose} title={material ? 'Edit material' : 'Add material'} description="Custom materials are private to your account.">
      <form onSubmit={submit} className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Used for estimate line *"><Select value={f.estimate_key} onChange={set('estimate_key')}>{PRICED_KEYS.map((k) => <option key={k} value={k}>{KEY_LABEL[k]}</option>)}</Select></Field>
          <Field label="Name *"><Input value={f.name} onChange={set('name')} /></Field>
          <Field label="Category *"><Input value={f.category} onChange={set('category')} /></Field>
          <Field label="Unit *" hint="Must match the estimate unit, e.g. bag (50 kg), kg, m³, nos, litre"><Input value={f.unit} onChange={set('unit')} /></Field>
          <Field label="Brand"><Input value={f.brand} onChange={set('brand')} /></Field>
          <Field label="Grade / specification"><Input value={f.grade} onChange={set('grade')} /></Field>
          {!material && <>
            <Field label={`Unit price (${currency})`}><Input type="number" min={0} step="any" value={f.unit_price} onChange={set('unit_price')} /></Field>
            <Field label="Supplier"><Input value={f.supplier} onChange={set('supplier')} /></Field>
            <Field label="Location"><Input value={f.location} onChange={set('location')} /></Field>
          </>}
        </div>
        <Field label="Specification notes"><Textarea value={f.specification} onChange={set('specification')} /></Field>
        <Field label="Durability notes" hint="Only enter information you can verify."><Textarea value={f.durability_notes} onChange={set('durability_notes')} /></Field>
        <div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" variant="accent" loading={busy}>{material ? 'Save changes' : 'Add material'}</Button></div>
      </form>
    </Dialog>
  )
}
