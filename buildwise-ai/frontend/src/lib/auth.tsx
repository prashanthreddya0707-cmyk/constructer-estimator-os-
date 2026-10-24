import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, setUnauthorizedHandler, tokenStore } from '@/lib/api'
import { AUTH_PROVIDER, getSupabase, toAppUser } from '@/lib/supabase'
import type { User } from '@/types'

interface AuthCtx {
  user: User | null
  loading: boolean
  login: (email: string, password: string) => Promise<void>
  /** 'confirm' = the account exists but Supabase wants the e-mail confirmed before the first login. */
  signup: (email: string, fullName: string, password: string) => Promise<'ok' | 'confirm'>
  logout: () => void
  setUser: (u: User) => void
}
const Ctx = createContext<AuthCtx | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setUnauthorizedHandler(() => setUser(null))
    let unsubscribe = () => {}
    let alive = true
    if (AUTH_PROVIDER === 'supabase') {
      // Supabase keeps the session (and refreshes it); the profile name comes from our API so edits stick across refreshes
      const sync = async (hasSession: boolean, fallback: User | null) => {
        if (!hasSession) return setUser(null)
        try { setUser(await api.me()) } catch { setUser(fallback) }
      }
      getSupabase().then(async (sb) => {
        const { data } = await sb.auth.getSession()
        await sync(!!data.session, data.session ? toAppUser(data.session.user) : null)
        if (alive) setLoading(false)
        const sub = sb.auth.onAuthStateChange((event, session) => {
          if (event === 'TOKEN_REFRESHED') return
          setTimeout(() => { void sync(!!session, session ? toAppUser(session.user) : null) }, 0)   // never call the API inside the callback
        })
        unsubscribe = () => sub.data.subscription.unsubscribe()
      }).catch(() => alive && setLoading(false))
    } else {
      // the session cookie (if any) is sent automatically; no token is read from browser storage
      api.me().then(setUser).catch(() => tokenStore.clear()).finally(() => setLoading(false))
    }
    return () => { alive = false; unsubscribe(); setUnauthorizedHandler(null) }
  }, [])

  const login = useCallback(async (email: string, password: string) => {
    if (AUTH_PROVIDER === 'supabase') {
      const { data, error } = await (await getSupabase()).auth.signInWithPassword({ email, password })
      if (error) throw new Error(error.message === 'Invalid login credentials' ? 'Incorrect e-mail or password.' : error.message)
      setUser(await api.me().catch(() => toAppUser(data.user)))
      return
    }
    const r = await api.login({ email, password })
    tokenStore.set(r.access_token)
    setUser(r.user)
  }, [])

  const signup = useCallback(async (email: string, full_name: string, password: string): Promise<'ok' | 'confirm'> => {
    if (AUTH_PROVIDER === 'supabase') {
      const { data, error } = await (await getSupabase()).auth.signUp({ email, password, options: { data: { full_name } } })
      if (error) throw new Error(error.message)
      if (!data.session) return 'confirm'
      setUser(await api.me().catch(() => toAppUser(data.session!.user)))
      return 'ok'
    }
    const r = await api.signup({ email, full_name, password })
    tokenStore.set(r.access_token)
    setUser(r.user)
    return 'ok'
  }, [])

  const logout = useCallback(() => {
    tokenStore.clear()
    setUser(null)
    if (AUTH_PROVIDER === 'supabase') void getSupabase().then((sb) => sb.auth.signOut())
    else api.logout().catch(() => { /* cookie expires on its own */ })
  }, [])

  const value = useMemo(() => ({ user, loading, login, signup, logout, setUser }), [user, loading, login, signup, logout])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAuth(): AuthCtx {
  const v = useContext(Ctx)
  if (!v) throw new Error('useAuth must be used inside AuthProvider')
  return v
}
