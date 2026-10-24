import { describe, expect, it } from 'vitest'
import { accessToken, AUTH_PROVIDER, getSupabase, toAppUser } from './supabase'

describe('Supabase Auth switch', () => {
  it('is off by default, so the existing login keeps working', async () => {
    expect(AUTH_PROVIDER).toBe('local')
    expect(await accessToken()).toBeNull()
    await expect(getSupabase()).rejects.toThrow('not enabled')
  })

  it('maps a Supabase user to the app user', () => {
    expect(toAppUser({ id: 'u1', email: 'a@b.co', user_metadata: { full_name: 'Priya' } })).toEqual({ id: 'u1', email: 'a@b.co', full_name: 'Priya' })
    expect(toAppUser({ id: 'u2', email: undefined, user_metadata: { full_name: 42 } })).toEqual({ id: 'u2', email: '', full_name: '' })
    expect(toAppUser({ id: 'u3', email: 'x@y.zz', user_metadata: {} }).full_name).toBe('')
  })
})
