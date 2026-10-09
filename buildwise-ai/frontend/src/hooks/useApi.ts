import { useCallback, useEffect, useRef, useState } from 'react'

export interface AsyncState<T> {
  data: T | undefined
  loading: boolean
  error: string | null
  reload: () => Promise<void>
  setData: (d: T | undefined) => void
}

/** Minimal data-loading hook: runs `fn` on mount / when `deps` change, ignoring stale responses. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): AsyncState<T> {
  const [data, setData] = useState<T>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const seq = useRef(0)
  const fnRef = useRef(fn)
  fnRef.current = fn

  const run = useCallback(async () => {
    const id = ++seq.current
    setLoading(true)
    setError(null)
    try {
      const r = await fnRef.current()
      if (id === seq.current) setData(r)
    } catch (e) {
      if (id === seq.current) { setError(e instanceof Error ? e.message : 'Something went wrong.'); setData(undefined) }
    } finally {
      if (id === seq.current) setLoading(false)
    }
  }, [])

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void run() }, deps)
  return { data, loading, error, reload: run, setData }
}
