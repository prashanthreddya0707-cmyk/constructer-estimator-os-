import type {
  Dashboard, Estimate, FloorPlan, Material, Project, ProjectCreate, ProjectDetail, Recommendation, Report,
  Room, RoomInput, User, ProjectBase, ExtraCostConfig,
} from '@/types'

const BASE = `${(import.meta.env.VITE_API_BASE_URL as string | undefined) ?? ''}/api`
const TOKEN_KEY = 'bw_token'

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

export const tokenStore = {
  get: () => { try { return localStorage.getItem(TOKEN_KEY) } catch { return null } },
  set: (t: string) => { try { localStorage.setItem(TOKEN_KEY, t) } catch { /* storage unavailable */ } },
  clear: () => { try { localStorage.removeItem(TOKEN_KEY) } catch { /* storage unavailable */ } },
}

type Listener = () => void
let onUnauthorized: Listener | null = null
export const setUnauthorizedHandler = (fn: Listener | null) => { onUnauthorized = fn }

async function raw(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers)
  const token = tokenStore.get()
  if (token) headers.set('Authorization', `Bearer ${token}`)
  if (init.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  let res: Response
  try {
    res = await fetch(`${BASE}${path}`, { ...init, headers })
  } catch {
    throw new ApiError('Cannot reach the BuildWise AI server. Check that the backend is running and try again.', 0)
  }
  if (!res.ok) {
    let msg = `Request failed (${res.status}).`
    try {
      const body = await res.json()
      msg = body?.error?.message ?? body?.detail ?? msg
    } catch { /* non-JSON error */ }
    if (res.status === 401 && token) { tokenStore.clear(); onUnauthorized?.() }
    throw new ApiError(msg, res.status)
  }
  return res
}

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await raw(path, init)
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

const body = (data: unknown) => JSON.stringify(data)

export const api = {
  // auth
  signup: (d: { email: string; full_name: string; password: string }) => json<{ access_token: string; user: User }>('/auth/signup', { method: 'POST', body: body(d) }),
  login: (d: { email: string; password: string }) => json<{ access_token: string; user: User }>('/auth/login', { method: 'POST', body: body(d) }),
  me: () => json<User>('/auth/me'),
  updateMe: (full_name: string) => json<User>('/auth/me', { method: 'PUT', body: body({ full_name }) }),
  // dashboard / demo
  dashboard: () => json<Dashboard>('/dashboard'),
  seedDemo: () => json<Project>('/demo/seed', { method: 'POST' }),
  // projects
  projects: () => json<Project[]>('/projects'),
  project: (id: string) => json<ProjectDetail>(`/projects/${id}`),
  createProject: (d: ProjectCreate) => json<ProjectDetail>('/projects', { method: 'POST', body: body(d) }),
  updateProject: (id: string, d: ProjectBase) => json<ProjectDetail>(`/projects/${id}`, { method: 'PUT', body: body(d) }),
  deleteProject: (id: string) => json<void>(`/projects/${id}`, { method: 'DELETE' }),
  updateConfig: (id: string, d: {
    assumptions?: Record<string, unknown>; wastage?: Record<string, number>; material_selections?: Record<string, string | null>
    extra_costs?: Record<string, ExtraCostConfig>; purchase_quantities?: Record<string, number | null>
  }) => json<ProjectDetail>(`/projects/${id}/config`, { method: 'PUT', body: body(d) }),
  // rooms
  addRoom: (pid: string, d: RoomInput) => json<Room>(`/projects/${pid}/rooms`, { method: 'POST', body: body(d) }),
  updateRoom: (pid: string, rid: string, d: RoomInput) => json<Room>(`/projects/${pid}/rooms/${rid}`, { method: 'PUT', body: body(d) }),
  deleteRoom: (pid: string, rid: string) => json<void>(`/projects/${pid}/rooms/${rid}`, { method: 'DELETE' }),
  // estimate
  runEstimate: (pid: string, overrides?: { material_selections?: Record<string, string | null>; wastage?: Record<string, number> }) =>
    json<Estimate>(`/projects/${pid}/estimate`, { method: 'POST', body: body(overrides ? { persist: false, ...overrides } : {}) }),
  getEstimate: (pid: string) => json<Estimate>(`/projects/${pid}/estimate`),
  recommendations: (pid: string) => json<Recommendation[]>(`/projects/${pid}/recommendations`),
  // floor plans
  uploadFloorplan: (pid: string, file: File) => {
    const fd = new FormData(); fd.append('file', file)
    return json<FloorPlan>(`/projects/${pid}/floorplans`, { method: 'POST', body: fd })
  },
  deleteFloorplan: (id: string) => json<void>(`/floorplans/${id}`, { method: 'DELETE' }),
  calibrate: (id: string, d: { x1: number; y1: number; x2: number; y2: number; real_length_m: number }) =>
    json<FloorPlan>(`/floorplans/${id}/calibration`, { method: 'PUT', body: body(d) }),
  analyzeFloorplan: (id: string) => json<{ overlay_png_base64: string; edges_png_base64: string; contour_count: number; disclaimer: string }>(`/floorplans/${id}/analyze`, { method: 'POST' }),
  floorplanBlob: async (id: string) => (await raw(`/floorplans/${id}/file`)).blob(),
  // materials / prices
  materials: (estimate_key?: string) => json<Material[]>(`/materials${estimate_key ? `?estimate_key=${estimate_key}` : ''}`),
  createMaterial: (d: Record<string, unknown>) => json<Material>('/materials', { method: 'POST', body: body(d) }),
  updateMaterial: (id: string, d: Record<string, unknown>) => json<Material>(`/materials/${id}`, { method: 'PUT', body: body(d) }),
  deleteMaterial: (id: string) => json<void>(`/materials/${id}`, { method: 'DELETE' }),
  createPrice: (d: { material_id: string; unit_price: number; supplier?: string; location?: string; currency?: string }) =>
    json<unknown>('/prices', { method: 'POST', body: body(d) }),
  updatePrice: (id: string, d: { unit_price: number; supplier: string; location: string }) => json<unknown>(`/prices/${id}`, { method: 'PUT', body: body(d) }),
  deletePrice: (id: string) => json<void>(`/prices/${id}`, { method: 'DELETE' }),
  importPrices: (file: File) => {
    const fd = new FormData(); fd.append('file', file)
    return json<{ created: number; errors: { line: number; message: string }[] }>('/prices/import', { method: 'POST', body: fd })
  },
  // reports
  createReport: (pid: string) => json<Report>(`/projects/${pid}/report`, { method: 'POST' }),
  reports: () => json<Report[]>('/reports'),
  deleteReport: (id: string) => json<void>(`/reports/${id}`, { method: 'DELETE' }),
  reportBlob: async (id: string) => (await raw(`/reports/${id}/download`)).blob(),
}

export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

