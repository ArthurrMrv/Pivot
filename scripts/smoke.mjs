#!/usr/bin/env node
// End-to-end check against a running stack.
//
//   pnpm smoke ./fixtures
//
// Point it at a folder of screenshots. It duplicates one of them so dedupe is
// always exercised, drives the real ingest path, waits for the worker, then
// asserts the invariants that hold whatever the images are — and prints the
// grouping it produced so you can judge the merge decisions yourself.
//
// A good fixture set: three shots of one person's profile, one shot of a
// different person's profile, one unrelated screenshot.

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, extname, basename } from 'node:path'
import { createHash } from 'node:crypto'

const dir = process.argv[2] ?? 'fixtures'
const TIMEOUT_MS = 5 * 60_000

const env = Object.fromEntries(
  readFileSync('.env', 'utf8').split('\n')
    .map((l) => l.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean)
    .map((m) => [m[1], m[2].replace(/^"|"$/g, '')]),
)
const URL_ = env.SUPABASE_URL?.replace(/\/+$/, '')
const KEY = env.SUPABASE_SERVICE_ROLE_KEY
if (!URL_ || !KEY) fail('No SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env — run `pnpm setup` first.')
if (!existsSync(dir)) fail(`No such directory: ${dir}\nUsage: pnpm smoke <folder-of-screenshots>`)

const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' }

function fail(msg) { console.error(`\x1b[31m✗\x1b[0m ${msg}`); process.exit(1) }
let checks = 0
function check(cond, msg) {
  checks++
  if (cond) console.log(`  \x1b[32m✓\x1b[0m ${msg}`)
  else fail(msg)
}

const rest = async (path, init = {}) => {
  const res = await fetch(`${URL_}${path}`, {
    ...init,
    headers: { apikey: KEY, authorization: `Bearer ${KEY}`, 'content-type': 'application/json', ...init.headers },
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${text.slice(0, 300)}`)
  return text ? JSON.parse(text) : null
}

// ── Fixtures ────────────────────────────────────────────────────────────────
const files = readdirSync(dir)
  .filter((f) => MIME[extname(f).slice(1).toLowerCase()])
  .sort()
  .map((f) => ({ name: f, ext: extname(f).slice(1).toLowerCase(), bytes: readFileSync(join(dir, f)) }))

if (files.length < 2) fail(`Need at least 2 images in ${dir}, found ${files.length}.`)

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
const spec = (f) => ({ name: f.name, ext: f.ext, size: f.bytes.length, sha256: hash(f.bytes) })

// A byte-identical copy under a different filename: dedupe must catch it.
const payload = [...files, { ...files[0], name: `copy-of-${files[0].name}` }]

// The PDF path, minus the part only a browser can do. A PDF is ingested as one
// item per rendered page, all naming the PDF itself as their source; the notes
// that result must carry the PDF — not the page renders — in their carousel.
// Node cannot render pages, so the last two fixtures stand in for them and the
// relationship is declared directly. Needs 3+ fixtures; skipped below that.
const SOURCE = files.length >= 3
  ? { name: 'simulated-scan.pdf', ext: 'pdf', bytes: Buffer.from('%PDF-1.4\n% smoke fixture\n') }
  : null
const pages = SOURCE ? payload.splice(-3, 2) : []   // -3 keeps the duplicate copy last

const specs = [
  ...payload.map(spec),
  ...pages.map((f) => ({ ...spec(f), source: spec(SOURCE) })),
]

console.log(`\n  ${payload.length + pages.length} items (${files.length} distinct images${SOURCE ? `, ${pages.length} of them as pages of ${SOURCE.name}` : ''}) from ${dir}\n`)

// ── Ingest ──────────────────────────────────────────────────────────────────
const plan = await rest('/functions/v1/ingest', { method: 'POST', body: JSON.stringify({ files: specs }) })

const expectUploads = files.length + (SOURCE ? 1 : 0)
check(plan.toUpload.length === expectUploads,
  `planned ${plan.toUpload.length} uploads for ${files.length} distinct images${SOURCE ? ' plus their source document' : ''}`)
check(plan.duplicates.length === 1, 'the byte-identical copy was rejected before uploading')
if (SOURCE) {
  check(plan.toUpload.some((u) => u.sha256 === hash(SOURCE.bytes)), 'the source document is uploaded once, not once per page')
}

const byHash = new Map([...payload, ...pages, ...(SOURCE ? [SOURCE] : [])].map((f) => [hash(f.bytes), f]))
for (const u of plan.toUpload) {
  const f = byHash.get(u.sha256)
  const res = await fetch(`${URL_}/storage/v1/object/${env.STORAGE_BUCKET || 'uploads'}/${u.path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${KEY}`, 'content-type': MIME[f.ext] ?? 'application/pdf', 'x-upsert': 'true' },
    body: f.bytes,
  })
  if (!res.ok) fail(`upload of ${f.name} failed: ${res.status} ${(await res.text()).slice(0, 200)}`)
}
check(true, `uploaded ${plan.toUpload.length} files`)

await rest('/functions/v1/ingest/commit', { method: 'POST', body: JSON.stringify({ batchId: plan.batchId }) })
console.log(`  … waiting for the worker (batch ${plan.batchId})`)

// ── Wait ────────────────────────────────────────────────────────────────────
const started = Date.now()
let batch
for (;;) {
  ;[batch] = await rest(`/rest/v1/ingest_batches?id=eq.${plan.batchId}&select=status,total,done,failed`)
  if (batch.status === 'complete' || batch.status === 'failed') break
  if (Date.now() - started > TIMEOUT_MS) {
    fail(`timed out after ${TIMEOUT_MS / 1000}s at ${batch.done}/${batch.total}. ` +
      `Is the worker running? Try \`pnpm worker\` in another terminal.`)
  }
  await new Promise((r) => setTimeout(r, 3000))
}

// ── Assertions ──────────────────────────────────────────────────────────────
console.log()
check(batch.status === 'complete', `batch completed (${batch.done} done, ${batch.failed} failed)`)

const items = await rest(`/rest/v1/ingest_items?batch_id=eq.${plan.batchId}&select=id,idx,name,sha256,source,status,note_id,error&order=idx`)
const stuck = items.filter((i) => !['merged', 'failed', 'duplicate'].includes(i.status))
check(stuck.length === 0, `every item reached a terminal state${stuck.length ? `: ${stuck.map((i) => `${i.name}=${i.status}`).join(', ')}` : ''}`)

const broken = items.filter((i) => i.status === 'failed')
check(broken.length === 0, broken.length ? `${broken.length} failed: ${broken.map((i) => `${i.name} (${i.error})`).join('; ')}` : 'no item failed')

const merged = items.filter((i) => i.status === 'merged')
check(merged.every((i) => i.note_id), 'every transcribed image is attached to a note')

const noteIds = [...new Set(merged.map((i) => i.note_id))]
const notes = await rest(`/rest/v1/notes?id=in.(${noteIds.join(',')})&select=id,title,content`)
check(notes.length === noteIds.length, `${notes.length} notes produced from ${files.length} images`)

const TAG_RE = /#([\w-]+)/g
check(
  notes.every((n) => n.content.startsWith('# ')),
  'every note carries the `# title` line the frontend renders',
)
const untagged = notes.filter((n) => [...n.content.matchAll(TAG_RE)].length === 0)
check(untagged.length === 0, untagged.length ? `${untagged.length} notes have no graph tags` : 'every note yields tags to the graph')

// What each item should appear as in a carousel: the file it came from when it
// came from one, else itself.
const docOf = (i) => i.source?.sha256 ?? i.sha256
const expected = new Set(merged.map((i) => `${i.note_id}:${docOf(i)}`))

const docs = await rest(`/rest/v1/docs?note_id=in.(${noteIds.join(',')})&select=sha256,name,note_id`)
check(docs.length === expected.size,
  `${docs.length} documents attached — one per source document per note`)
check(docs.every((d) => expected.has(`${d.note_id}:${d.sha256}`)), 'every attached document is one an item came from')
check(new Set(docs.map((d) => `${d.note_id}:${d.sha256}`)).size === docs.length, 'no document is attached to a note twice')

if (SOURCE) {
  const srcHash = hash(SOURCE.bytes)
  const fromPages = merged.filter((i) => i.source?.sha256 === srcHash)
  const pageNotes = [...new Set(fromPages.map((i) => i.note_id))]
  check(fromPages.length === pages.length, `${fromPages.length} pages of ${SOURCE.name} were transcribed`)
  check(pageNotes.every((id) => docs.filter((d) => d.note_id === id).every((d) => d.sha256 === srcHash)),
    `the ${pageNotes.length} note(s) from ${SOURCE.name} carry the whole document, not the page renders`)
  check(!docs.some((d) => fromPages.some((i) => i.sha256 === d.sha256)), 'no page render leaks into a carousel')
}

const tags = await rest('/rest/v1/tags?select=name&order=name')

// ── Report ──────────────────────────────────────────────────────────────────
console.log(`\n  \x1b[1mGrouping\x1b[0m — judge these yourself:`)
for (const n of notes) {
  const from = merged.filter((i) => i.note_id === n.id).map((i) => i.name)
  console.log(`    \x1b[1m${n.title}\x1b[0m  \x1b[2m← ${from.join(', ')}\x1b[0m`)
}
console.log(`\n  \x1b[1mTag vocabulary\x1b[0m (${tags.length}): \x1b[2m${tags.map((t) => t.name).join(' ')}\x1b[0m`)
console.log(`\n  \x1b[32m${checks} checks passed\x1b[0m in ${Math.round((Date.now() - started) / 1000)}s\n`)
