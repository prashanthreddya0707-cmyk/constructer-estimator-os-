import { useCallback, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { api } from '@/lib/api'
import { useAsync } from '@/hooks/useApi'
import type { Project } from '@/types'

const KEY = 'bw_active_project'
const read = () => { try { return localStorage.getItem(KEY) } catch { return null } }
const write = (id: string) => { try { localStorage.setItem(KEY, id) } catch { /* ignore */ } }

/**
 * Resolves which project a project-scoped page (Studio, Estimation, ...) shows:
 * URL param -> last used project -> most recently updated project.
 */
export function useActiveProject(basePath: string) {
  const { projectId } = useParams()
  const navigate = useNavigate()
  const list = useAsync<Project[]>(() => api.projects(), [])
  const projects = list.data
  const resolved = projects ? (projects.find((p) => p.id === projectId) ?? projects.find((p) => p.id === read()) ?? projects[0]) : undefined

  useEffect(() => {
    if (resolved) write(resolved.id)
    if (resolved && projectId !== resolved.id) navigate(`${basePath}/${resolved.id}`, { replace: true })
  }, [resolved, projectId, basePath, navigate])

  const select = useCallback((id: string) => navigate(`${basePath}/${id}`), [basePath, navigate])
  return { projects, projectId: resolved?.id, loading: list.loading, error: list.error, select, reloadProjects: list.reload }
}
