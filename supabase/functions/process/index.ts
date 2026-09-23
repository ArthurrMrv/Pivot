// The worker. pg_cron pokes this every few seconds; it drains what it can and
// returns. Nothing here is long-lived, so a 200-image batch is simply many
// short invocations rather than one that races the wall clock.

import { env } from '../_shared/env.ts'
import { admin, handler, HttpError, json } from '../_shared/http.ts'
import { pool } from '../_shared/openai.ts'
import { runOcr } from './ocr.ts'
import { finalize } from './finalize.ts'

const VISIBILITY = 180 // seconds a claimed message stays invisible to other ticks
const MAX_DELIVERIES = 5

interface Msg { msg_id: number; read_ct: number; message: { kind: string; itemId?: string; batchId: string; userId: string } }

Deno.serve(handler(async (req) => {
  // Only the scheduler. The service role key is a valid JWT for every signed-in
  // caller's platform, so membership of the JWT is not enough on its own.
  if ((req.headers.get('authorization') ?? '') !== `Bearer ${env.serviceKey}`) {
    throw new HttpError(403, 'Forbidden')
  }

  const db = admin()
  const { data, error } = await db.rpc('queue_read', { qty: env.batchSize, vt: VISIBILITY })
  if (error) throw new HttpError(500, `Could not read the queue: ${error.message}`)

  const msgs = (data ?? []) as Msg[]
  if (!msgs.length) return json({ drained: 0 })

  const done: number[] = []
  const failed: { msg_id: number; error: string }[] = []

  const run = async (m: Msg) => {
    try {
      if (m.read_ct > MAX_DELIVERIES) {
        // Poison message: stop redelivering it and leave a trail on the batch.
        console.error(`dropping message ${m.msg_id} after ${m.read_ct} deliveries`)
        await db.from('ingest_batches').update({ status: 'failed' }).eq('id', m.message.batchId)
        done.push(m.msg_id)
        return
      }
      if (m.message.kind === 'ocr') {
        const batchReady = await runOcr(db, m.message.itemId!)
        if (batchReady) {
          const { error: qe } = await db.rpc('queue_send', {
            msgs: [{ kind: 'finalize', batchId: m.message.batchId, userId: m.message.userId }],
          })
          if (qe) throw new Error(`could not enqueue finalisation: ${qe.message}`)
        }
      } else if (m.message.kind === 'finalize') {
        await finalize(db, m.message.batchId, m.message.userId)
      } else {
        console.error(`unknown message kind "${m.message.kind}", dropping`)
      }
      done.push(m.msg_id)
    } catch (e) {
      // Left on the queue; it reappears after the visibility timeout.
      const msg = e instanceof Error ? e.message : String(e)
      console.error(`message ${m.msg_id} (${m.message.kind}) failed: ${msg}`)
      failed.push({ msg_id: m.msg_id, error: msg })
    }
  }

  // Transcriptions are independent and go wide; finalisation touches every row
  // of its batch and runs after, one at a time.
  const ocr = msgs.filter((m) => m.message.kind === 'ocr')
  const rest = msgs.filter((m) => m.message.kind !== 'ocr')
  await pool(ocr, env.ocrConcurrency, run)
  for (const m of rest) await run(m)

  if (done.length) {
    const { error: de } = await db.rpc('queue_delete', { ids: done })
    if (de) console.error(`could not clear ${done.length} finished messages: ${de.message}`)
  }
  return json({ drained: done.length, failed })
}))
