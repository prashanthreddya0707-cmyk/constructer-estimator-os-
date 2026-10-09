import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, setUnauthorizedHandler, tokenStore } from '@/lib/api'
import type { User } from '@/types'

interface AuthCtx {
  user: User | null
  loading: boolean
  login: (email: string, password: string) => Promise<void>
  signup: (email: string, fullName: string, password: string) => Promise<void>
  logout: () => void
  setUser: (u: User) => void
}
const Ctx = createContext<AuthCtx | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(() => !!tokenStore.get())

  useEffect(() => {
    setUnauthorizedHandler(() => setUser(null))
    if (!tokenStore.get()) return
    api.me().then(setUser).catch(() => tokenStore.clear()).finally(() => setLoading(false))
    return () => setUnauthorizedHandler(null)
  }, [])

  const login = useCallback(async (email: string, password: string) => {
    const r = await api.login({ email, password })
    tokenStore.set(r.access_token)
    setUser(r.user)
  }, [])
  const signup = useCallback(async (email: string, full_name: string, password: string) => {
    const r = await api.signup({ email, full_name, password })
    tokenStore.set(r.access_token)
    setUser(r.user)
  }, [])
  const logout = useCallback(() => { tokenStore.clear(); setUser(null) }, [])

  const value = useMemo(() => ({ user, loading, login, signup, logout, setUser }), [user, loading, login, signup, logout])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAuth(): AuthCtx {
  const v = useContext(Ctx)
  if (!v) throw new Error('useAuth must be used inside AuthProvider')
  return v
}
