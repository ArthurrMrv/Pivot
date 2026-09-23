// Stage A — one image in, one structured transcription out. Runs once per
// queue message so a single bad image can never sink a batch.

import { encodeBase64 } from 'jsr:@std/encoding@1/base64'
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { env } from '../_shared/env.ts'
import { chatJson, embed } from '../_shared/openai.ts'
import { hoistTags, type Ocr } from '../_shared/content.ts'
import { kindOf } from '../_shared/files.ts'
import { imageMessage, OCR_SYSTEM, TEXT_SYSTEM, textMessage } from '../_shared/prompts.ts'

const MAX_ATTEMPTS = 3

/** Returns true when this item completed the batch and finalisation is due. */
export async function runOcr(db: SupabaseClient, itemId: string): Promise<boolean> {
  // Claim it. A redelivered message, or a second commit of the same batch,
  // finds nothing to claim and leaves the progress counter alone.
  const { data: claimed, error } = await db.from('ingest_items')
    .update({ status: 'processing' }).eq('id', itemId).eq('status', 'pending').select('*')
  if (error) throw new Error(`could not claim item ${itemId}: ${error.message}`)
  if (!claimed?.length) return false
  const item = claimed[0]

  try {
    const ocr = hoistTags(await read(db, item.storage_path, item.ext))
    const [embedding] = await embed(env.embed, [`${ocr.title}\n${ocr.description}\n${ocr.markdown}`.slice(0, 8000)])

    const { error: ue } = await db.from('ingest_items')
      .update({ ocr, embedding, status: 'ocr_done', error: null }).eq('id', itemId)
    if (ue) throw new Error(`could not store transcription: ${ue.message}`)

    return await progress(db, item.batch_id, false)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const attempts = item.attempts + 1
    await db.from('ingest_items').update({ attempts, error: msg }).eq('id', itemId)


    if (attempts < MAX_ATTEMPTS) {
      await db.from('ingest_items').update({ status: 'pending' }).eq('id', itemId) // re-claimable
      throw e // leave it queued; pgmq redelivers it
    }
    console.error(`item ${itemId} failed permanently after ${attempts} attempts: ${msg}`)
    await db.from('ingest_items').update({ status: 'failed' }).eq('id', itemId)
    return await progress(db, item.batch_id, true)
  }
}

/**
 * One stored file in, one structured transcription out. An image is read by
 * the vision model; text is kept verbatim and only described, so nothing the
 * user wrote can be summarised away. PDFs never arrive here — the client
 * renders their pages, which arrive as images.
 */
async function read(db: SupabaseClient, path: string, ext: string): Promise<Ocr> {
  const kind = kindOf(ext)
  if (!kind) throw new Error(`${path} is a .${ext} file, which cannot be transcribed`)

  const { data: blob, error } = await db.storage.from(env.bucket).download(path)
  if (error || !blob) throw new Error(`could not download ${path}: ${error?.message}`)

  if (kind === 'text') {
    const text = await blob.text()
    const meta = await chatJson<Partial<Ocr>>(env.ocr, [
      { role: 'system', content: TEXT_SYSTEM },
      textMessage(text),
    ])
    return { ...coerce(meta), markdown: text }
  }

  if (!blob.type.startsWith('image/')) throw new Error(`${path} is ${blob.type || 'untyped'}, not an image`)
  const uri = `data:${blob.type};base64,${encodeBase64(await blob.arrayBuffer())}`
  const raw = await chatJson<Partial<Ocr>>(env.ocr, [
    { role: 'system', content: OCR_SYSTEM },
    imageMessage(uri),
  ])
  return coerce(raw)
}

/** Never trust the shape a model returns, even with response_format set. */
const coerce = (raw: Partial<Ocr> | null): Ocr => ({
  title: String(raw?.title ?? '').slice(0, 200),
  markdown: String(raw?.markdown ?? ''),
  description: String(raw?.description ?? '').slice(0, 500),
  tags: Array.isArray(raw?.tags) ? raw.tags.filter((t) => typeof t === 'string').slice(0, 12) : [],
})

const progress = async (db: SupabaseClient, batchId: string, failed: boolean): Promise<boolean> => {
  const { data, error } = await db.rpc('batch_progress', { p_batch_id: batchId, p_failed: failed })
  if (error) throw new Error(`could not record batch progress: ${error.message}`)
  return data === true
}
