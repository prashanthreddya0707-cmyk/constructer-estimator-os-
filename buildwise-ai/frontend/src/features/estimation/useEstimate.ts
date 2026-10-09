import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '@/lib/api'
import type { Estimate, ProjectDetail } from '@/types'

type Config = Parameters<typeof api.updateConfig>[1]

/**
 * Loads a project and (re)calculates + saves its estimate. Every mutation goes through the server so
 * quantities, prices, selections and recommendations always come from one source of truth.
 */
export function useEstimate(projectId: string) {
  const [project, setProject] = useState<ProjectDetail>()
  const [estimate, setEstimate] = useState<Estimate>()
  const [loading, setLoading] = useState(true)
  const [calculating, setCalculating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [estimateError, setEstimateError] = useState<string | null>(null)
  const seq = useRef(0)

  const recalc = useCallback(async () => {
    const id = ++seq.current
    setCalculating(true)
    try {
      const [p, e] = await Promise.all([api.project(projectId), api.runEstimate(projectId).then((r) => ({ ok: r }), (err: unknown) => ({ err }))])
      if (id !== seq.current) return
      setProject(p)
      if ('ok' in e) { setEstimate(e.ok); setEstimateError(null) }
      else { setEstimate(undefined); setEstimateError(e.err instanceof Error ? e.err.message : 'The estimate could not be calculated.') }
      setError(null)
    } catch (err) {
      if (id === seq.current) setError(err instanceof Error ? err.message : 'Could not load the project.')
    } finally {
      if (id === seq.current) { setCalculating(false); setLoading(false) }
    }
  }, [projectId])

  useEffect(() => { setLoading(true); void recalc() }, [recalc])

  /** Save configuration (assumptions / wastage / selections / extra costs / purchase plan), then recalculate. */
  const applyConfig = useCallback(async (cfg: Config) => {
    await api.updateConfig(projectId, cfg)
    await recalc()
  }, [projectId, recalc])

  return { project, estimate, loading, calculating, error, estimateError, recalc, applyConfig }
}
