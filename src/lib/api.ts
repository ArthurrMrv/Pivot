import { BUCKET, supabase, whoami } from './supabase'
import { expand, extOf } from './expand'
import type { IngestBatch, IngestItem, Note, NoteDoc } from './types'

// Keep in sync with supabase/functions/_shared/files.ts — the server is the
// authority, this copy only buys a readable message before anything uploads.
const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'heic', 'heif'])
const TEXT_EXT = new Set(['md', 'txt'])
const INGESTIBLE = new Set([...IMAGE_EXT, ...TEXT_EXT, 'pdf'])

const ms = (iso: string) => new Date(iso).getTime()

/** Browsers leave .md untyped; Storage then serves it as a download. */
function mimeOf(file: File): string | undefined {
  if (file.type) return file.type
  const ext = extOf(file.name)
  if (TEXT_EXT.has(ext)) return 'text/plain; charset=utf-8'
  if (ext === 'pdf') return 'application/pdf'
  return undefined
}

const spec = async (f: File) => ({
  name: f.name, size: f.size, ext: extOf(f.name) || 'bin', sha256: await sha256(f),
})

export async function sha256(file: File): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Bounded concurrency — 200 screenshots must not open 200 sockets at once. */
async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length)
  let i = 0
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]) }
  }))
  return out
}

/** Edge function call that surfaces the server's message instead of "non-2xx". */
async function callFn<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body })
  if (!error) return data as T
  const detail = await (error as any)?.context?.json?.().then((b: any) => b?.error).catch(() => null)
  throw new Error(detail || error.message)
}

// ── Reads ───────────────────────────────────────────────────────────────────
export async function listNotes(): Promise<Note[]> {
  const { data, error } = await supabase
    .from('notes')
    .select('id,title,content,created_at,updated_at,docs(id,name,ext,size,storage_path)')
    .order('created_at', { ascending: true })
  if (error) throw new Error(`Could not load notes: ${error.message}`)

  const rows = data ?? []
  const paths = rows.flatMap((n: any) => (n.docs ?? []).map((d: any) => d.storage_path))
  const signed = await signAll(paths)

  return rows.map((n: any): Note => ({
    id: n.id,
    name: n.title,
    content: n.content,
    created: ms(n.created_at),
    modified: ms(n.updated_at),
    docs: (n.docs ?? []).map((d: any): NoteDoc => toDoc(d, signed.get(d.storage_path))),
  }))
}

/** Every document is openable; only an image is also a thumbnail. */
const toDoc = (d: { id: string; name: string; ext: string; size: number }, url?: string): NoteDoc => ({
  id: d.id, name: d.name, ext: d.ext, size: d.size, url,
  preview: IMAGE_EXT.has(String(d.ext).toLowerCase()) ? url : undefined,
})

/** One round trip for every thumbnail on screen. */
async function signAll(paths: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (!paths.length) return out
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrls([...new Set(paths)], 3600)
  if (error) {
    console.error('could not sign document URLs:', error.message) // thumbnails degrade, notes still load
    return out
  }
  for (const s of data ?? []) if (s.signedUrl && s.path) out.set(s.path, s.signedUrl)
  return out
}

/** The most recent drops, newest first. Small enough to refetch on every tick. */
export async function listBatches(limit = 5): Promise<IngestBatch[]> {
  const { data, error } = await supabase
    .from('ingest_batches').select('id,status,total,done,failed,created_at,updated_at')
    .order('created_at', { ascending: false }).limit(limit)
  if (error) throw new Error(`Could not read ingestion progress: ${error.message}`)
  return (data ?? []).map((b: any): IngestBatch => ({
    id: b.id, status: b.status, total: b.total, done: b.done, failed: b.failed,
    created: ms(b.created_at), updated: ms(b.updated_at ?? b.created_at),
  }))
}

/** The files in those batches. Only fetched while someone is looking. */
export async function listItems(batchIds: string[]): Promise<IngestItem[]> {
  if (!batchIds.length) return []
  const { data, error } = await supabase
    .from('ingest_items').select('id,batch_id,name,status,error')
    .in('batch_id', batchIds).order('idx')
  if (error) throw new Error(`Could not read ingestion detail: ${error.message}`)
  return (data ?? []).map((i: any): IngestItem => ({
    id: i.id, batchId: i.batch_id, name: i.name, status: i.status, error: i.error,
  }))
}

// ── Writes ──────────────────────────────────────────────────────────────────
export async function createNote(name: string, content: string): Promise<Note> {
  const { data, error } = await supabase
    .from('notes').insert({ title: name, content }).select('id,created_at,updated_at').single()
  if (error) throw new Error(`Could not save the note: ${error.message}`)
  return { id: data.id, name, content, created: ms(data.created_at), modified: ms(data.updated_at) }
}

export async function updateNote(id: string, content: string): Promise<void> {
  const { error } = await supabase
    .from('notes').update({ content, updated_at: new Date().toISOString() }).eq('id', id)
  if (error) throw new Error(`Could not save your edit: ${error.message}`)
}

export async function deleteNote(id: string): Promise<void> {
  const { error } = await supabase.from('notes').delete().eq('id', id)
  if (error) throw new Error(`Could not delete the note: ${error.message}`)
}

/** Attaches a file to an existing note. Content-addressed, so re-adding is free. */
export async function uploadDoc(noteId: string, file: File): Promise<NoteDoc> {
  const [uid, hash] = await Promise.all([whoami(), sha256(file)])
  const ext = extOf(file.name) || 'bin'
  const path = `${uid}/${hash}.${ext}`

  const { error: ue } = await supabase.storage.from(BUCKET)
    .upload(path, file, { contentType: mimeOf(file), upsert: true })
  if (ue) throw new Error(`Could not upload ${file.name}: ${ue.message}`)

  const { data, error } = await supabase.from('docs')
    .upsert({ note_id: noteId, storage_path: path, name: file.name, ext, size: file.size, sha256: hash },
      { onConflict: 'user_id,note_id,sha256' })
    .select('id').single()
  if (error) throw new Error(`Could not attach ${file.name}: ${error.message}`)

  const signed = await signAll([path])
  return toDoc({ id: data.id, name: file.name, ext, size: file.size }, signed.get(path))
}

// ── Ingestion ───────────────────────────────────────────────────────────────
export interface IngestResult { queued: number; duplicates: number }

/**
 * Plan, upload, commit. Duplicates are settled before any bytes move, so
 * re-dropping a folder you already ingested costs one request.
 */
export async function ingestFiles(
  files: File[],
  onPhase: (phase: string) => void = () => {},
): Promise<IngestResult> {
  if (!files.length) throw new Error('No files selected.')
  const rejected = files.find((f) => !INGESTIBLE.has(extOf(f.name)))
  if (rejected) {
    throw new Error(`“${rejected.name}” cannot be ingested — images, PDFs and text files only.`)
  }

  // A PDF becomes one item per page plus itself as the source. Expanding is
  // the expensive part, so skip anything already ingested first.
  onPhase('Checking what is new…')
  const known = await knownHashes(await pool(files, 8, sha256))
  const fresh = files.filter((f, i) => !known.has(i))
  if (fresh.some((f) => extOf(f.name) === 'pdf')) onPhase('Rendering pages…')
  const expanded = await pool(fresh, 2, expand)

  const byHash = new Map<string, File>()
  const items = await pool(expanded.flatMap((e) => e.parts.map((p) => [p, e.source] as const)), 8,
    async ([part, source]) => {
      const [p, s] = await Promise.all([spec(part), source ? spec(source) : null])
      byHash.set(p.sha256, part)
      if (s && source) byHash.set(s.sha256, source)
      return { ...p, source: s }
    })
  if (!items.length) return { queued: 0, duplicates: files.length }

  const plan = await callFn<{ batchId: string; toUpload: { sha256: string; path: string }[]; duplicates: string[] }>(
    'ingest', { files: items },
  )

  let sent = 0
  const total = plan.toUpload.length
  if (total) onPhase(`Uploading 0 of ${total}…`)
  await pool(plan.toUpload, 6, async (u) => {
    const file = byHash.get(u.sha256)!
    const { error } = await supabase.storage.from(BUCKET)
      .upload(u.path, file, { contentType: mimeOf(file), upsert: true })
    if (error) throw new Error(`Could not upload ${file.name}: ${error.message}`)
    onPhase(`Uploading ${++sent} of ${total}…`)
  })

  if (total) {
    onPhase('Queueing for processing…')
    await callFn('ingest/commit', { batchId: plan.batchId })
  }

  // Counted in files, not parts: 40 rejected pages of one known PDF is one
  // duplicate as far as the person who dropped it is concerned.
  const byPart = new Map(items.map((i) => [i.sha256, i.source?.sha256 ?? i.sha256]))
  const dupes = new Set(plan.duplicates.map((h) => byPart.get(h) ?? h))
  return { queued: plan.toUpload.length, duplicates: files.length - fresh.length + dupes.size }
}

/**
 * Which of these files the server already has, by index. Only an optimisation
 * — the ingest function settles duplicates for real — but it saves rendering
 * every page of a PDF that is already in the graph.
 */
async function knownHashes(hashes: string[]): Promise<Set<number>> {
  const { data, error } = await supabase.from('docs').select('sha256').in('sha256', hashes)
  if (error) return new Set() // not worth failing an ingest over
  const seen = new Set((data ?? []).map((d: { sha256: string }) => d.sha256))
  return new Set(hashes.flatMap((h, i) => (seen.has(h) ? [i] : [])))
}
