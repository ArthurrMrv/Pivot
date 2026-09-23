import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { env } from './env.ts'

export const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
}

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'content-type': 'application/json' },
  })

export class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
  }
}

/** Service role. Bypasses RLS, so every query through it scopes by user id itself. */
export const admin = (): SupabaseClient =>
  createClient(env.supabaseUrl, env.serviceKey, { auth: { persistSession: false } })

/** The caller's own credentials — RLS still applies. Used for all user data. */
export const asCaller = (req: Request): SupabaseClient =>
  createClient(env.supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY') ?? env.serviceKey, {
    auth: { persistSession: false },
    global: { headers: { authorization: req.headers.get('authorization') ?? '' } },
  })

/**
 * Who is acting. With auth on this is the verified JWT subject and nothing
 * else; with auth off it is the single local user the setup wizard created.
 * The client never gets to name itself.
 */
export async function userId(req: Request): Promise<string> {
  if (!env.authEnabled) {
    if (!env.localUserId) throw new HttpError(500, 'AUTH_ENABLED=false but LOCAL_USER_ID is unset — re-run pnpm setup')
    return env.localUserId
  }
  const { data, error } = await asCaller(req).auth.getUser()
  if (error || !data.user) throw new HttpError(401, 'Not signed in')
  return data.user.id
}

/** Wraps a handler so no error escapes as an opaque 500 or a leaked stack. */
export const handler = (fn: (req: Request) => Promise<Response>) => async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    return await fn(req)
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status)
    console.error('unhandled:', e)
    return json({ error: e instanceof Error ? e.message : 'Internal error' }, 500)
  }
}
