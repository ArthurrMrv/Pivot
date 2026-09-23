import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !key) {
  throw new Error(
    'Pivot is not configured: VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are missing. Run `pnpm setup`.',
  )
}

export const supabase = createClient(url, key)
export const AUTH_ENABLED = import.meta.env.VITE_AUTH_ENABLED !== 'false'
export const BUCKET = 'uploads'

/** Own user id — from the session when auth is on, from the database when off. */
let cached: Promise<string> | null = null
export function whoami(): Promise<string> {
  cached ??= (async () => {
    const { data, error } = await supabase.rpc('whoami')
    if (error || !data) {
      cached = null // let the next caller try again rather than cache a failure
      throw new Error(`Could not identify the current user: ${error?.message ?? 'no id returned'}`)
    }
    return data as string
  })()
  return cached
}
export const forgetUser = () => { cached = null }
