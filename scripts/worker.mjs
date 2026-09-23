#!/usr/bin/env node
// Local fallback worker: drives the same `process` edge function that pg_cron
// drives in production. Useful when pg_net inside docker cannot reach the local
// edge runtime — a common Linux/Colima situation — and for watching a batch go
// through with the logs in front of you.

import { readFileSync, existsSync } from 'node:fs'

const env = Object.fromEntries(
  ['.env'].filter(existsSync).flatMap((f) =>
    readFileSync(f, 'utf8').split('\n')
      .map((l) => l.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean)
      .map((m) => [m[1], m[2].replace(/^"|"$/g, '')])
  ),
)

const url = `${env.SUPABASE_URL?.replace(/\/+$/, '')}/functions/v1/process`
const key = env.SUPABASE_SERVICE_ROLE_KEY
if (!key) {
  console.error('No SUPABASE_SERVICE_ROLE_KEY in .env — run `pnpm setup` first.')
  process.exit(1)
}

const every = Number(process.argv[2] ?? 5) * 1000
console.log(`polling ${url} every ${every / 1000}s — ctrl-c to stop`)

let idle = 0
for (;;) {
  try {
    const res = await fetch(url, { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: '{}' })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) console.error(`  ${res.status}`, body)
    else if (body.drained) { idle = 0; console.log(`  drained ${body.drained}`, body.failed?.length ? body.failed : '') }
    else if (idle++ % 12 === 0) console.log('  idle')
  } catch (e) {
    console.error('  unreachable:', e.message)
  }
  await new Promise((r) => setTimeout(r, every))
}
