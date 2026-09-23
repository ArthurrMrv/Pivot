#!/usr/bin/env node
// Vite, plus the edge functions when the stack is local.
//
// `supabase start` has no way to give a function its secrets — only
// `supabase functions serve` reads supabase/functions/.env. Without it every
// call runs with AUTH_ENABLED unset and answers "Not signed in", and the
// worker has no model key. So local development needs both processes, and
// needing both is not something anyone should have to remember.
//
// A hosted project keeps its secrets in the cloud, so there only Vite runs.

import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'

const url = existsSync('.env')
  ? (readFileSync('.env', 'utf8').match(/^SUPABASE_URL=(.*)$/m)?.[1] ?? '').trim()
  : ''
const isLocal = /127\.0\.0\.1|localhost|host\.docker\.internal/.test(url)

const children = []
let stopping = false

function stop(code = 0) {
  if (stopping) return
  stopping = true
  for (const c of children) c.kill('SIGTERM')
  process.exit(code)
}

function start(label, cmd, args) {
  const child = spawn(cmd, args, { stdio: 'inherit' })
  child.on('error', (e) => {
    console.error(`\n  ${label} could not start: ${e.message}`)
    stop(1)
  })
  // One dying takes the other with it: a half-running dev stack is worse than
  // an obviously stopped one.
  child.on('exit', (code) => stop(code ?? 0))
  children.push(child)
}

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => stop(0))

start('vite', 'pnpm', ['exec', 'vite'])
if (isLocal) start('supabase functions serve', 'supabase', ['functions', 'serve'])
else if (url) console.log('  Hosted project — edge functions run in the cloud.\n')
