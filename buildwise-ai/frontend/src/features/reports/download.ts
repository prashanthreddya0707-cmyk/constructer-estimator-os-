import { api, saveBlob } from '@/lib/api'

/** Generates a fresh report from current saved project data, then downloads the PDF. */
export async function downloadReport(projectId: string) {
  const rep = await api.createReport(projectId)
  const blob = await api.reportBlob(rep.id)
  saveBlob(blob, rep.file_name)
  return rep
}

export async function downloadExisting(id: string, fileName: string) {
  saveBlob(await api.reportBlob(id), fileName)
}
