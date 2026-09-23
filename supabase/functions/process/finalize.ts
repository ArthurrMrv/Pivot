// Stage B — runs once per batch, after every image has been transcribed.
// Canonicalises tags, decides which images describe one subject, and writes
// the resulting notes.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { env } from '../_shared/env.ts'
import { chatJson, embed, pool } from '../_shared/openai.ts'
import { buildNoteContent, extractTags, noteBody, uniq } from '../_shared/content.ts'
import { baseNoteId, neighbourRefs, NOTE, resolveGroups } from '../_shared/merge.ts'
import { MERGE_SYSTEM } from '../_shared/prompts.ts'
import { canonicalise } from './canon.ts'

interface Doc { name: string; ext: string; size: number; sha256: string; storage_path: string }
interface Item extends Doc {
  id: string; idx: number; embedding: unknown
  /** The file this item was expanded out of — a PDF's pages, a long file's chunks. */
  source: Doc | null
  ocr: { title: string; markdown: string; description: string; tags: string[] }
}

/** What the carousel shows: the original file when there was one, else the item. */
const docOf = (item: Item): Doc => item.source ?? item

// Longer than the queue's visibility timeout, so a row this quiet cannot still
// be held by a live worker — whoever set it to 'finalizing' is gone.
const STALE_CLAIM_MS = 300_000

export async function finalize(db: SupabaseClient, batchId: string, userId: string) {
  // Claim the batch. A concurrent or redelivered finalize finds nothing to claim
  // and leaves, rather than writing every note a second time. A worker that died
  // mid-finalisation leaves the row at 'finalizing' with nothing coming to move
  // it, so a claim that has gone quiet past the visibility timeout is taken over.
  const stale = new Date(Date.now() - STALE_CLAIM_MS).toISOString()
  const { data: claimed } = await db.from('ingest_batches')
    .update({ status: 'finalizing' }).eq('id', batchId)
    .or(`status.eq.processing,and(status.eq.finalizing,updated_at.lt."${stale}")`)
    .select('id')
  if (!claimed?.length) {
    // Nothing to claim is only correct when the batch is genuinely over. While
    // it is still mid-flight this message is the only thing that will ever
    // finish it, so fail instead of letting the worker delete it — the redelivery
    // after the visibility timeout is what gets past the stale window above.
    const { data: row } = await db.from('ingest_batches')
      .select('status').eq('id', batchId).maybeSingle()
    const status = row?.status
    if (status && status !== 'complete' && status !== 'failed') {
      throw new Error(`batch ${batchId} is held at '${status}'; retrying after the visibility timeout`)
    }
    return
  }

  // Only what is still unwritten. `write` marks each group's items 'merged' as
  // it goes, so a retry after a partial failure picks up exactly the remainder
  // rather than duplicating the notes it already created.
  const { data, error } = await db.from('ingest_items')
    .select('id,idx,name,ext,size,sha256,storage_path,source,embedding,ocr')
    .eq('batch_id', batchId).eq('status', 'ocr_done').order('idx')
  if (error) throw new Error(`could not load batch items: ${error.message}`)

  const items = (data ?? []) as Item[]
  if (!items.length) {
    await db.from('ingest_batches').update({ status: 'complete' }).eq('id', batchId)
    return
  }

  try {
    const tags = await canonicalise(db, userId, items.map((i) => i.ocr.tags ?? []))
    const { pairs, notes } = await judge(db, userId, items, tags)
    // Verdicts arrive in whatever order the pool finishes. Sort them so the
    // same batch always produces the same grouping — resolveGroups resolves
    // conflicting claims by first-come.
    pairs.sort((a, b) => Number(a[0]) - Number(b[0]) || a[1].localeCompare(b[1]))
    const members = [
      ...uniq(pairs.flat().filter((r) => r.startsWith(NOTE))),
      ...items.map((_, i) => String(i)),
    ]
    await write(db, userId, items, tags, resolveGroups(members, pairs), notes)
    await db.from('ingest_batches').update({ status: 'complete' }).eq('id', batchId)
  } catch (e) {
    // Hand the claim back so the redelivered message can retry. Without this a
    // single transient failure strands the batch in 'finalizing' for good.
    await db.from('ingest_batches').update({ status: 'processing' }).eq('id', batchId)
    throw e
  }
}

interface Existing { id: string; title: string; content: string }

/**
 * One verdict per image against its two neighbours and the two nearest
 * existing notes. Pairwise by design: chaining is resolveGroups' job, so a
 * subject spanning five images never needs a call that sees all five.
 */
async function judge(db: SupabaseClient, userId: string, items: Item[], tags: string[][]) {
  const notes = new Map<string, Existing>()
  const pairs: [string, string][] = []
  const card = (ref: string, i: number) => ({
    ref,
    title: items[i].ocr.title,
    description: items[i].ocr.description,
    tags: tags[i],
    // Present only for expanded files, and it is the whole point of the hint:
    // part 3 and part 4 of one PDF are consecutive pages, not two documents.
    ...(items[i].source ? { source: `part ${items[i].idx + 1} of ${items[i].source!.name}` } : {}),
  })

  await pool(items.map((_, i) => i), env.ocrConcurrency, async (i) => {
    const { data: near, error } = await db.rpc('match_notes', {
      p_user_id: userId,
      query_embedding: items[i].embedding,
      match_count: env.matchNotes,
    })
    if (error) throw new Error(`note lookup failed for item ${items[i].id}: ${error.message}`)

    const candidates = [
      ...neighbourRefs(i, items.length).map((r) => card(r, Number(r))),
      ...(near ?? []).filter((n: any) => n.similarity >= env.matchNotesMin).map((n: any) => {
        notes.set(NOTE + n.id, { id: n.id, title: n.title, content: n.content })
        return { ref: NOTE + n.id, title: n.title, excerpt: noteBody(n.content).slice(0, 600) }
      }),
    ]
    if (!candidates.length) return

    // A judge that will not answer means "no merge", not a dead batch. The
    // transcription is already stored; the worst case is a note that should
    // have been joined to its neighbour and can be joined by hand.
    let verdict: { same_subject?: unknown }
    try {
      verdict = await chatJson<{ same_subject?: unknown }>(env.merge, [
        { role: 'system', content: MERGE_SYSTEM },
        {
          role: 'user',
          content: JSON.stringify({ subject: card(String(i), i), candidates }),
        },
      ])
    } catch (e) {
      console.error(`merge check skipped for item ${items[i].id}: ${e instanceof Error ? e.message : e}`)
      return
    }

    const refs = new Set(candidates.map((c) => c.ref))
    for (const r of Array.isArray(verdict.same_subject) ? verdict.same_subject : []) {
      if (typeof r === 'string' && refs.has(r)) pairs.push([String(i), r])
    }
  })

  return { pairs, notes }
}

/** One note per group: existing notes are appended to, everything else created. */
async function write(
  db: SupabaseClient,
  userId: string,
  items: Item[],
  tags: string[][],
  groups: string[][],
  notes: Map<string, Existing>,
) {
  const drafts = groups.map((group) => {
    const base = baseNoteId(group)
    const existing = base ? notes.get(NOTE + base)! : null
    const members = group.filter((r) => !r.startsWith(NOTE)).map(Number)
    const prior = existing ? [{ markdown: noteBody(existing.content), description: '' }] : []

    return {
      id: base,
      members,
      title: existing?.title || items[members[0]].ocr.title || 'Untitled note',
      content: buildNoteContent(
        existing?.title || items[members[0]].ocr.title || 'Untitled note',
        [...prior, ...members.map((i) => items[i].ocr)],
        uniq([...(existing ? extractTags(existing.content) : []), ...members.flatMap((i) => tags[i])]),
      ),
    }
  }).filter((d) => d.members.length)

  // One embeddings call for the whole batch rather than one per note.
  const vectors = await embed(env.embed, drafts.map((d) => d.content.slice(0, 8000)))

  for (const [n, draft] of drafts.entries()) {
    const row = { user_id: userId, title: draft.title, content: draft.content, embedding: vectors[n], updated_at: new Date().toISOString() }
    const { data: note, error } = draft.id
      ? await db.from('notes').update(row).eq('id', draft.id).eq('user_id', userId).select('id').single()
      : await db.from('notes').insert(row).select('id').single()
    if (error) throw new Error(`could not write note "${draft.title}": ${error.message}`)

    // Deduped by hash: every page of one PDF resolves to the same document, and
    // Postgres refuses an upsert that hits one conflict key twice.
    const docs = new Map(draft.members.map((i) => [docOf(items[i]).sha256, docOf(items[i])]))
    const { error: de } = await db.from('docs').upsert(
      [...docs.values()].map((d) => ({
        user_id: userId, note_id: note.id, storage_path: d.storage_path,
        name: d.name, ext: d.ext, size: d.size, sha256: d.sha256,
      })),
      { onConflict: 'user_id,note_id,sha256' },
    )
    if (de) throw new Error(`could not attach documents to "${draft.title}": ${de.message}`)

    const { error: ue } = await db.from('ingest_items')
      .update({ note_id: note.id, status: 'merged' })
      .in('id', draft.members.map((i) => items[i].id))
    if (ue) throw new Error(`could not link items to "${draft.title}": ${ue.message}`)
  }
}
