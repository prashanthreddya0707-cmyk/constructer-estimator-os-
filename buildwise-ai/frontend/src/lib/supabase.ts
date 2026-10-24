/**
 * Supabase Auth (optional). The default is the app's own login; set VITE_AUTH_PROVIDER=supabase (plus the two public values
 * below) to use Supabase Auth instead. Only the PUBLIC project URL and publishable key belong in the frontend: never the
 * service-role key. The library is loaded on demand, so the default build does not run any of it.
 */
import type { SupabaseClient, User as SupabaseUser } from '@supabase/supabase-js'
import type { User } from '@/types'

export const AUTH_PROVIDER: 'local' | 'supabase' = import.meta.env.VITE_AUTH_PROVIDER === 'supabase' ? 'supabase' : 'local'

let client: Promise<SupabaseClient> | null = null

export function getSupabase(): Promise<SupabaseClient> {
  if (AUTH_PROVIDER !== 'supabase') return Promise.reject(new Error('Supabase Auth is not enabled.'))
  if (!client) {
    const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
    const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined
    if (!url || !key) return Promise.reject(new Error('Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.'))
    client = import('@supabase/supabase-js').then(({ createClient }) =>
      createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } }))
  }
  return client
}

/** Current access token (refreshed automatically by the library), or null when signed out / not using Supabase. */
export async function accessToken(): Promise<string | null> {
  if (AUTH_PROVIDER !== 'supabase') return null
  const { data } = await (await getSupabase()).auth.getSession()
  return data.session?.access_token ?? null
}

/** Shape a Supabase user like the app's own user. */
export function toAppUser(u: Pick<SupabaseUser, 'id' | 'email' | 'user_metadata'>): User {
  const name = (u.user_metadata as { full_name?: unknown } | undefined)?.full_name
  return { id: u.id, email: u.email ?? '', full_name: typeof name === 'string' ? name : '' }
}
