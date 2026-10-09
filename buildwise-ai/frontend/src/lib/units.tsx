import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

export type UnitSystem = 'metric' | 'imperial'
const KEY = 'bw_units'
const M_PER_FT = 0.3048
const SQFT_PER_SQM = 1 / (M_PER_FT * M_PER_FT)

interface UnitsCtx {
  system: UnitSystem
  setSystem: (s: UnitSystem) => void
  length: (m: number | null | undefined) => string
  area: (sqm: number | null | undefined) => string
}
const Ctx = createContext<UnitsCtx | null>(null)

function load(): UnitSystem {
  try { return localStorage.getItem(KEY) === 'imperial' ? 'imperial' : 'metric' } catch { return 'metric' }
}

/** Data is always stored in metres / m². This only changes how values are *displayed*. */
export function UnitsProvider({ children }: { children: ReactNode }) {
  const [system, setS] = useState<UnitSystem>(load)
  const setSystem = useCallback((s: UnitSystem) => {
    setS(s)
    try { localStorage.setItem(KEY, s) } catch { /* ignore */ }
  }, [])
  const value = useMemo<UnitsCtx>(() => ({
    system, setSystem,
    length: (m) => (m == null || Number.isNaN(m) ? '—' : system === 'metric' ? `${+m.toFixed(2)} m` : `${+(m / M_PER_FT).toFixed(2)} ft`),
    area: (a) => (a == null || Number.isNaN(a) ? '—' : system === 'metric' ? `${+a.toFixed(2)} m²` : `${+(a * SQFT_PER_SQM).toFixed(1)} sq ft`),
  }), [system, setSystem])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useUnits(): UnitsCtx {
  const v = useContext(Ctx)
  if (!v) throw new Error('useUnits must be used inside UnitsProvider')
  return v
}
