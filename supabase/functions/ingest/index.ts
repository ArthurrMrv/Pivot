// Ingest control plane. Bytes never pass through here: the client uploads
// straight to Storage and this function only decides what is worth uploading,
// records it, and enqueues the work.
//
//   POST /ingest         { files: [...] }  -> { batchId, toUpload, duplicates }
//   POST /ingest/commit  { batchId }       -> { queued }

import { env } from '../_shared/env.ts'
import { admin, asCaller, handler, HttpError, json, userId } from '../_shared/http.ts'
import { INGESTIBLE, kindOf, SOURCE_EXT } from '../_shared/files.ts'

const MAX_FILES = 500
const MAX_BYTES = 20 * 1024 * 1024

interface FileSpec { name: string; size: number; sha256: string; ext: string }
/** A part carries its origin when the client expanded one file into many. */
interface ItemSpec extends FileSpec { source: FileSpec | null }

/** Validate at the boundary: nothing below this point re-checks these. */
function parseFile(f: any, where: string): FileSpec {
  const name = typeof f?.name === 'string' ? f.name.slice(0, 200) : ''
  const ext = String(f?.ext ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
  const sha256 = String(f?.sha256 ?? '')
  const size = Number(f?.size)
  if (!name) throw new HttpError(400, `${where}: name is required`)
  if (!/^[0-9a-f]{64}$/.test(sha256)) throw new HttpError(400, `${where}: sha256 must be 64 hex characters`)
  if (!Number.isFinite(size) || size <= 0) throw new HttpError(400, `${where}: size must be a positive number`)
  if (size > MAX_BYTES) throw new HttpError(400, `${name} is ${(size / 1e6).toFixed(1)}MB — the limit is ${MAX_BYTES / 1e6}MB`)
  return { name, size, sha256, ext }
}

function parseFiles(body: any): ItemSpec[] {
  const files = body?.files
  if (!Array.isArray(files) || files.length === 0) throw new HttpError(400, 'files must be a non-empty array')
  if (files.length > MAX_FILES) throw new HttpError(400, `At most ${MAX_FILES} files per batch (got ${files.length})`)

  return files.map((f: any, i: number) => {
    const spec = parseFile(f, `files[${i}]`)
    if (!kindOf(spec.ext)) {
      throw new HttpError(400, `${spec.name}: ${spec.ext || 'that'} files cannot be ingested (${INGESTIBLE.join(', ')})`)
    }
    if (f?.source == null) return { ...spec, source: null }
    const source = parseFile(f.source, `files[${i}].source`)
    if (!SOURCE_EXT.has(source.ext)) {
      throw new HttpError(400, `${source.name}: ${source.ext || 'that'} files cannot be ingested (${INGESTIBLE.join(', ')})`)
    }
    return { ...spec, source }
  })
}

async function plan(req: Request) {
  const uid = await userId(req)
  const db = asCaller(req)
  const files = parseFiles(await req.json())

  // Four ways a file can already be known: twice in this payload, already
  // stored, mid-flight in another batch, or — for an expanded file — its source
  // is one of those. The last matters because page renders are not byte-stable
  // across browsers, so the PDF's own hash is the identity, not its pages'.
  const hashes = [...new Set(files.flatMap((f) => [f.sha256, f.source?.sha256 ?? []].flat()))]
  const live = () => db.from('ingest_items').select('sha256,source').eq('user_id', uid)
    .not('status', 'in', '(failed,duplicate)')
  const [{ data: known, error: e1 }, { data: inflight, error: e2 }, { data: expanded, error: e3 }] =
    await Promise.all([
      db.from('docs').select('sha256').eq('user_id', uid).in('sha256', hashes),
      live().in('sha256', hashes),
      live().in('source->>sha256', hashes),
    ])
  const lookupError = e1 ?? e2 ?? e3
  if (lookupError) throw new HttpError(500, `Duplicate lookup failed: ${lookupError.message}`)

  // Two sets, because siblings share a source: a part is a duplicate when its
  // own hash is known (that set grows as the payload is read), or when the
  // source it came from was already ingested (that one does not grow here).
  const seen = new Set([
    ...(known ?? []).map((r: any) => r.sha256),
    ...[...(inflight ?? []), ...(expanded ?? [])]
      .flatMap((r: any) => [r.sha256, r.source?.sha256].filter(Boolean)),
  ])
  const sources = new Set(seen)
  const fresh: ItemSpec[] = []
  const duplicates: string[] = []
  for (const f of files) {
    if (seen.has(f.sha256) || (f.source && sources.has(f.source.sha256))) duplicates.push(f.sha256)
    else { seen.add(f.sha256); fresh.push(f) }
  }

  const { data: batch, error: e4 } = await db
    .from('ingest_batches').insert({ user_id: uid, total: fresh.length }).select('id').single()
  if (e4) throw new HttpError(500, `Could not open batch: ${e4.message}`)

  if (!fresh.length) {
    await db.from('ingest_batches').update({ status: 'complete' }).eq('id', batch.id)
    return json({ batchId: batch.id, toUpload: [], duplicates })
  }

  const path = (f: FileSpec) => `${uid}/${f.sha256}.${f.ext}`
  const rows = fresh.map((f, idx) => ({
    batch_id: batch.id, user_id: uid, idx,
    name: f.name, ext: f.ext, size: f.size, sha256: f.sha256,
    storage_path: path(f),
    source: f.source ? { ...f.source, storage_path: path(f.source) } : null,
  }))
  const { error: e5 } = await db.from('ingest_items').insert(rows)
  if (e5) throw new HttpError(500, `Could not record batch items: ${e5.message}`)

  // Sources are uploaded once however many parts came out of them.
  const uploads = new Map<string, { sha256: string; path: string }>()
  for (const f of fresh) {
    for (const spec of [f, f.source].filter(Boolean) as FileSpec[]) {
      uploads.set(spec.sha256, { sha256: spec.sha256, path: path(spec) })
    }
  }

  return json({
    batchId: batch.id,
    bucket: env.bucket,
    toUpload: [...uploads.values()],
    duplicates,
  })
}

async function commit(req: Request) {
  const uid = await userId(req)
  const db = asCaller(req)
  const { batchId } = await req.json()
  if (typeof batchId !== 'string') throw new HttpError(400, 'batchId is required')

  const { data: items, error } = await db
    .from('ingest_items').select('id').eq('batch_id', batchId).eq('user_id', uid).eq('status', 'pending')
  if (error) throw new HttpError(500, `Could not load batch: ${error.message}`)
  if (!items?.length) throw new HttpError(404, 'Nothing pending in that batch')

  const { error: qe } = await admin().rpc('queue_send', {
    msgs: items.map((i: any) => ({ kind: 'ocr', itemId: i.id, batchId, userId: uid })),
  })
  if (qe) throw new HttpError(500, `Could not enqueue work: ${qe.message}`)

  await db.from('ingest_batches').update({ status: 'processing' }).eq('id', batchId).eq('user_id', uid)
  return json({ queued: items.length })
}

Deno.serve(handler(async (req) => {
  const path = new URL(req.url).pathname
  if (path.endsWith('/commit')) return await commit(req)
  return await plan(req)
}))
