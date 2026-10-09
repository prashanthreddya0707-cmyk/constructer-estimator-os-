import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Alert } from '@/components/ui/feedback'
import { Field, Input, Select } from '@/components/ui/form'
import { PageHeader } from '@/components/ui/page'
import { api } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { useToast } from '@/lib/toast'
import { useUnits, type UnitSystem } from '@/lib/units'

export default function SettingsPage() {
  const { user, setUser, logout } = useAuth()
  const toast = useToast()
  const units = useUnits()
  const navigate = useNavigate()
  const [name, setName] = useState(user?.full_name ?? '')
  const [busy, setBusy] = useState(false)
  const [demoBusy, setDemoBusy] = useState(false)

  return (
    <>
      <PageHeader title="Settings" />
      <div className="grid max-w-3xl gap-6">
        <Card>
          <CardHeader title="Profile" />
          <CardBody className="space-y-4">
            <Field label="E-mail"><Input value={user?.email ?? ''} disabled /></Field>
            <Field label="Full name"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
            <Button variant="primary" loading={busy} onClick={async () => {
              if (!name.trim()) { toast.error('Name cannot be empty.'); return }
              setBusy(true)
              try { setUser(await api.updateMe(name.trim())); toast.success('Profile updated.') } catch (e) { toast.error(e instanceof Error ? e.message : 'Update failed') } finally { setBusy(false) }
            }}>Save profile</Button>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Display units" description="Data is always stored in metres and square metres. This only changes how areas and lengths are displayed in the app." />
          <CardBody><Field label="Unit system"><Select value={units.system} onChange={(e) => units.setSystem(e.target.value as UnitSystem)} className="max-w-xs"><option value="metric">Metric (m, m²)</option><option value="imperial">Imperial (ft, sq ft)</option></Select></Field></CardBody>
        </Card>

        <Card>
          <CardHeader title="Demo data" description="Adds a clearly labelled demonstration project so you can explore every feature." />
          <CardBody><Button variant="outline" loading={demoBusy} onClick={async () => {
            setDemoBusy(true)
            try { const p = await api.seedDemo(); toast.success('Demo project created.'); navigate(`/projects/${p.id}`) } catch (e) { toast.error(e instanceof Error ? e.message : 'Failed') } finally { setDemoBusy(false) }
          }}>Create demo project</Button></CardBody>
        </Card>

        <Card>
          <CardHeader title="Account & security" />
          <CardBody className="space-y-3">
            <Alert>Authentication is active: passwords are hashed (scrypt) on the server, sessions use signed expiring tokens, and every project, room, estimate, price, floor plan and report is checked against its owner on the server. Set a strong <code>JWT_SECRET</code> before any shared deployment.</Alert>
            <Button variant="danger-outline" onClick={() => { logout(); navigate('/') }}>Log out</Button>
          </CardBody>
        </Card>
      </div>
    </>
  )
}
