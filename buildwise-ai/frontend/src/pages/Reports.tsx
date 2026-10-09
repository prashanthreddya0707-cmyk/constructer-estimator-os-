import { Download, FilePlus2, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { ConfirmDialog } from '@/components/ui/dialog'
import { EmptyState, ErrorState, Spinner } from '@/components/ui/feedback'
import { PageHeader, ProjectPicker } from '@/components/ui/page'
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table'
import { downloadExisting, downloadReport } from '@/features/reports/download'
import { useAsync } from '@/hooks/useApi'
import { api } from '@/lib/api'
import { useToast } from '@/lib/toast'
import { formatDate, formatMoney } from '@/lib/utils'
import type { Report } from '@/types'

export default function Reports() {
  const toast = useToast()
  const reports = useAsync(() => api.reports(), [])
  const projects = useAsync(() => api.projects(), [])
  const [pid, setPid] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [del, setDel] = useState<Report | null>(null)
  const pidResolved = pid ?? projects.data?.[0]?.id
  const nameOf = (id: string) => projects.data?.find((p) => p.id === id)?.name ?? 'Deleted project'

  return (
    <>
      <PageHeader title="Reports" description="Generate a PDF from the current saved project data, or re-download earlier reports." />
      <Card className="mb-6">
        <CardHeader title="Generate a report" description="Includes project details, rooms, quantities, prices, costs, recommendations, assumptions and the engineering disclaimer." />
        <CardBody>
          {projects.loading ? <Spinner className="py-2" /> : !projects.data?.length ? (
            <EmptyState title="No projects" description="Create a project first." action={<Link to="/projects/new"><Button variant="accent">Create project</Button></Link>} />
          ) : (
            <div className="flex flex-wrap gap-2">
              <ProjectPicker projects={projects.data} value={pidResolved} onChange={setPid} />
              <Button variant="accent" loading={busy} onClick={async () => {
                if (!pidResolved) return
                setBusy(true)
                try { await downloadReport(pidResolved); toast.success('Report generated and downloaded.'); await reports.reload() } catch (e) { toast.error(e instanceof Error ? e.message : 'Report generation failed') } finally { setBusy(false) }
              }}><FilePlus2 className="h-4 w-4" /> Generate & download PDF</Button>
            </div>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Report history" />
        {reports.loading && <Spinner />}
        {reports.error && <CardBody><ErrorState message={reports.error} onRetry={reports.reload} /></CardBody>}
        {reports.data && (reports.data.length === 0 ? <CardBody><EmptyState title="No reports yet" description="Generated reports appear here." /></CardBody> : (
          <Table>
            <THead><TR><TH>File</TH><TH>Project</TH><TH className="text-right">Material cost</TH><TH>Generated</TH><TH>Size</TH><TH /></TR></THead>
            <TBody>{reports.data.map((r) => (
              <TR key={r.id}>
                <TD className="font-medium">{r.file_name}</TD><TD>{nameOf(r.project_id)}</TD><TD className="text-right tabular-nums">{formatMoney(r.total_cost, r.currency)}</TD>
                <TD>{formatDate(r.created_at)}</TD><TD>{(r.size_bytes / 1024).toFixed(0)} KB</TD>
                <TD className="whitespace-nowrap text-right">
                  <Button size="sm" variant="outline" onClick={async () => { try { await downloadExisting(r.id, r.file_name) } catch (e) { toast.error(e instanceof Error ? e.message : 'Download failed') } }}><Download className="h-4 w-4" /> Download</Button>
                  <Button size="icon" variant="ghost" aria-label={`Delete ${r.file_name}`} onClick={() => setDel(r)}><Trash2 className="h-4 w-4 text-red-500" /></Button>
                </TD>
              </TR>))}
            </TBody>
          </Table>
        ))}
      </Card>
      <ConfirmDialog open={!!del} onClose={() => setDel(null)} title="Delete report?" message={`“${del?.file_name}” will be permanently deleted.`}
        onConfirm={async () => { try { await api.deleteReport(del!.id); toast.success('Report deleted.'); await reports.reload() } catch (e) { toast.error(e instanceof Error ? e.message : 'Delete failed') } setDel(null) }} />
    </>
  )
}
