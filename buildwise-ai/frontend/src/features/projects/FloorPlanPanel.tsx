import { FileImage, FileText, Replace, Ruler, ScanLine, Trash2, Upload, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { ConfirmDialog } from '@/components/ui/dialog'
import { Alert, Badge, Spinner } from '@/components/ui/feedback'
import { Input } from '@/components/ui/form'
import { api } from '@/lib/api'
import { useToast } from '@/lib/toast'
import type { FloorPlan } from '@/types'

export const MAX_MB = 10
const OK_EXT = ['.jpg', '.jpeg', '.png', '.pdf']

export function validateFile(f: File): string | null {
  const name = f.name.toLowerCase()
  if (!OK_EXT.some((e) => name.endsWith(e))) return 'Unsupported file type. Choose a JPG, JPEG, PNG or PDF file.'
  if (f.size === 0) return 'The selected file is empty.'
  if (f.size > MAX_MB * 1024 * 1024) return `File is too large (${(f.size / 1048576).toFixed(1)} MB). Maximum is ${MAX_MB} MB.`
  return null
}

/** Fetches a protected floor-plan file as an object URL (auth header cannot be sent by <img src>). */
export function useFloorplanUrl(id: string | undefined) {
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!id) return
    let revoked = false
    let obj: string | null = null
    setUrl(null); setError(null)
    api.floorplanBlob(id).then((b) => { if (!revoked) { obj = URL.createObjectURL(b); setUrl(obj) } })
      .catch((e) => !revoked && setError(e instanceof Error ? e.message : 'File unavailable.'))
    return () => { revoked = true; if (obj) URL.revokeObjectURL(obj) }
  }, [id])
  return { url, error }
}

/** Local file picker with validation + preview. Used in the project wizard before the project exists. */
export function FilePicker({ file, onChange }: { file: File | null; onChange: (f: File | null) => void }) {
  const ref = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  useEffect(() => {
    if (!file || file.type === 'application/pdf') { setPreview(null); return }
    const u = URL.createObjectURL(file)
    setPreview(u)
    return () => URL.revokeObjectURL(u)
  }, [file])
  const pick = (f: File | undefined) => {
    if (!f) return
    const err = validateFile(f)
    setError(err)
    if (!err) onChange(f)
  }
  return (
    <div className="space-y-3">
      <input ref={ref} type="file" accept=".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf" className="hidden" onChange={(e) => { pick(e.target.files?.[0]); e.target.value = '' }} />
      {error && <Alert tone="error">{error}</Alert>}
      {!file ? (
        <button type="button" onClick={() => ref.current?.click()} className="flex w-full flex-col items-center rounded-xl border-2 border-dashed border-slate-300 bg-white px-6 py-10 text-slate-500 hover:border-orange-400 hover:text-orange-600">
          <Upload className="mb-2 h-7 w-7" /><span className="font-medium">Choose a floor plan</span><span className="text-xs">JPG, PNG or PDF, up to {MAX_MB} MB</span>
        </button>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">{file.type === 'application/pdf' ? <FileText className="h-5 w-5 text-slate-400" /> : <FileImage className="h-5 w-5 text-slate-400" />}
              <span className="truncate text-sm font-medium">{file.name}</span><Badge>{(file.size / 1024).toFixed(0)} KB</Badge><Badge tone="orange">Ready to upload when the project is saved</Badge></div>
            <div className="flex gap-1"><Button size="sm" variant="outline" onClick={() => ref.current?.click()}><Replace className="h-4 w-4" /> Replace</Button>
              <Button size="sm" variant="ghost" onClick={() => onChange(null)}><X className="h-4 w-4" /> Remove</Button></div>
          </div>
          {preview && <img src={preview} alt="Floor plan preview" className="mt-3 max-h-72 w-full rounded-md border border-slate-200 object-contain" />}
          {file.type === 'application/pdf' && <p className="mt-3 text-sm text-slate-500">PDF selected. A preview will be available after saving.</p>}
        </div>
      )}
    </div>
  )
}

type Pt = { x: number; y: number }

function Calibrator({ fp, onChanged }: { fp: FloorPlan; onChanged: () => void }) {
  const toast = useToast()
  const { url, error } = useFloorplanUrl(fp.id)
  const [mode, setMode] = useState<'calibrate' | 'measure' | null>(null)
  const [pts, setPts] = useState<Pt[]>([])
  const [real, setReal] = useState('')
  const [busy, setBusy] = useState(false)
  const [analysis, setAnalysis] = useState<{ overlay: string; edges: string; count: number; disclaimer: string } | null>(null)
  const W = fp.width_px ?? 1, H = fp.height_px ?? 1

  const click = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!mode) return
    const r = e.currentTarget.getBoundingClientRect()
    const p = { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H }
    setPts((s) => (s.length >= 2 ? [p] : [...s, p]))
  }
  const pxDist = pts.length === 2 ? Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y) : 0

  const save = async () => {
    const len = Number(real)
    if (pts.length < 2 || !(len > 0)) { toast.error('Mark two points and enter a positive real-world length.'); return }
    setBusy(true)
    try {
      await api.calibrate(fp.id, { x1: pts[0].x, y1: pts[0].y, x2: pts[1].x, y2: pts[1].y, real_length_m: len })
      toast.success('Scale saved.'); setMode(null); setPts([]); setReal(''); onChanged()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not save the scale.') } finally { setBusy(false) }
  }
  const analyze = async () => {
    setBusy(true)
    try {
      const r = await api.analyzeFloorplan(fp.id)
      setAnalysis({ overlay: `data:image/png;base64,${r.overlay_png_base64}`, edges: `data:image/png;base64,${r.edges_png_base64}`, count: r.contour_count, disclaimer: r.disclaimer })
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Analysis failed.') } finally { setBusy(false) }
  }

  if (error) return <Alert tone="error">{error}</Alert>
  if (!url) return <Spinner label="Loading floor plan…" className="py-6" />
  if (fp.content_type === 'application/pdf') {
    return (
      <div className="space-y-2">
        <object data={url} type="application/pdf" className="h-96 w-full rounded-md border border-slate-200"><a href={url} target="_blank" rel="noreferrer">Open PDF</a></object>
        <p className="text-xs text-slate-500">Scale calibration and image analysis work with JPG/PNG plans. Export the PDF page as an image, or enter room dimensions manually.</p>
      </div>
    )
  }
  const measured = mode === 'measure' && fp.scale_m_per_px && pxDist ? pxDist * fp.scale_m_per_px : null
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant={mode === 'calibrate' ? 'accent' : 'outline'} onClick={() => { setMode(mode === 'calibrate' ? null : 'calibrate'); setPts([]) }}><Ruler className="h-4 w-4" /> Calibrate scale</Button>
        <Button size="sm" variant={mode === 'measure' ? 'accent' : 'outline'} disabled={!fp.scale_m_per_px} title={fp.scale_m_per_px ? '' : 'Calibrate the scale first'} onClick={() => { setMode(mode === 'measure' ? null : 'measure'); setPts([]) }}><Ruler className="h-4 w-4" /> Measure distance</Button>
        <Button size="sm" variant="outline" loading={busy && !mode} onClick={analyze}><ScanLine className="h-4 w-4" /> Detect edges (optional)</Button>
        {fp.scale_m_per_px ? <Badge tone="green">Scale: {(1 / fp.scale_m_per_px).toFixed(1)} px per metre</Badge> : <Badge tone="amber">Not calibrated</Badge>}
      </div>
      {mode === 'calibrate' && <Alert>Click two points on a distance you know (e.g. a door width or a labelled wall), then enter its real length in metres.</Alert>}
      {mode === 'measure' && <Alert>Click two points to measure. Use the result to fill in room dimensions manually.</Alert>}
      <div className="relative overflow-hidden rounded-md border border-slate-200 bg-slate-100">
        <img src={url} alt={`Floor plan ${fp.original_name}`} className="block max-h-[28rem] w-full object-contain" style={{ aspectRatio: `${W} / ${H}` }} />
        <svg viewBox={`0 0 ${W} ${H}`} className={`absolute inset-0 h-full w-full ${mode ? 'cursor-crosshair' : ''}`} preserveAspectRatio="none" onClick={click}>
          {pts.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={Math.max(W, H) / 150} fill="#f97316" stroke="#fff" strokeWidth={Math.max(W, H) / 500} />)}
          {pts.length === 2 && <line x1={pts[0].x} y1={pts[0].y} x2={pts[1].x} y2={pts[1].y} stroke="#f97316" strokeWidth={Math.max(W, H) / 300} />}
        </svg>
      </div>
      {mode === 'calibrate' && pts.length === 2 && (
        <div className="flex flex-wrap items-end gap-2">
          <div><label className="mb-1 block text-xs text-slate-500">Real length of marked line (m)</label><Input type="number" step="any" min={0} value={real} onChange={(e) => setReal(e.target.value)} className="w-40" /></div>
          <Button variant="accent" size="sm" loading={busy} onClick={save}>Save scale</Button>
          <span className="text-xs text-slate-500">Marked: {pxDist.toFixed(0)} px</span>
        </div>
      )}
      {measured !== null && <p className="text-sm font-medium text-navy-900">Measured distance: {measured.toFixed(2)} m</p>}
      {analysis && (
        <div className="space-y-2">
          <Alert tone="warning" title={`Edge/contour visualisation (${analysis.count} contours)`}>{analysis.disclaimer}</Alert>
          <div className="grid gap-2 sm:grid-cols-2">
            <img src={analysis.overlay} alt="Detected contours overlay" className="w-full rounded border border-slate-200" />
            <img src={analysis.edges} alt="Detected edges" className="w-full rounded border border-slate-200 bg-black" />
          </div>
        </div>
      )}
    </div>
  )
}

export function FloorPlanPanel({ projectId, floorplans, onChanged }: { projectId: string; floorplans: FloorPlan[]; onChanged: () => void }) {
  const toast = useToast()
  const ref = useRef<HTMLInputElement>(null)
  const replaceTarget = useRef<FloorPlan | null>(null)
  const [uploading, setUploading] = useState(false)
  const [confirm, setConfirm] = useState<FloorPlan | null>(null)

  const upload = async (f: File | undefined) => {
    if (!f) return
    const err = validateFile(f)
    if (err) { toast.error(err); return }
    setUploading(true)
    try {
      await api.uploadFloorplan(projectId, f)
      const old = replaceTarget.current
      if (old) await api.deleteFloorplan(old.id)
      toast.success(old ? 'Floor plan replaced.' : 'Floor plan uploaded.')
      onChanged()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Upload failed.') } finally { setUploading(false); replaceTarget.current = null }
  }

  return (
    <Card>
      <CardHeader title="Floor plans" description="Upload a plan, calibrate its scale, then confirm room dimensions manually."
        action={<Button size="sm" variant="outline" loading={uploading} onClick={() => { replaceTarget.current = null; ref.current?.click() }}><Upload className="h-4 w-4" /> Upload</Button>} />
      <CardBody className="space-y-6">
        <input ref={ref} type="file" accept=".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf" className="hidden" onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = '' }} />
        {uploading && <Spinner label="Uploading…" className="py-2" />}
        {floorplans.length === 0 && !uploading && <p className="text-sm text-slate-500">No floor plan uploaded. You can still enter all room dimensions manually.</p>}
        {floorplans.map((fp) => (
          <div key={fp.id} className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2"><span className="truncate text-sm font-medium">{fp.original_name}</span><Badge>{(fp.size_bytes / 1024).toFixed(0)} KB</Badge></div>
              <div className="flex gap-1">
                <Button size="sm" variant="outline" onClick={() => { replaceTarget.current = fp; ref.current?.click() }}><Replace className="h-4 w-4" /> Replace</Button>
                <Button size="sm" variant="danger-outline" onClick={() => setConfirm(fp)}><Trash2 className="h-4 w-4" /> Remove</Button>
              </div>
            </div>
            <Calibrator fp={fp} onChanged={onChanged} />
          </div>
        ))}
      </CardBody>
      <ConfirmDialog open={!!confirm} onClose={() => setConfirm(null)} title="Remove floor plan?" message="The uploaded file will be permanently deleted. Room data is not affected."
        confirmLabel="Remove" onConfirm={async () => {
          try { await api.deleteFloorplan(confirm!.id); toast.success('Floor plan removed.'); onChanged() } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not remove the file.') }
          setConfirm(null)
        }} />
    </Card>
  )
}
