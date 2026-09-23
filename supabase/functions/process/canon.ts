// Tag canonicalisation. Embeddings narrow the field, one model call decides.
//
// Embeddings alone cannot separate "linkedin"/"linkedin-links" (same tag) from
// "linkedin"/"twitter" (different tags) — both pairs sit at similar cosine
// distance. So the threshold is deliberately loose and only builds a shortlist.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { env } from '../_shared/env.ts'
import { chatJson, embed, pool } from '../_shared/openai.ts'
import { slugTag, uniq } from '../_shared/content.ts'
import { applyTagMap, sanitizeTagMap, unseenTags } from '../_shared/tags.ts'
import { TAG_SYSTEM } from '../_shared/prompts.ts'

/** Maps every item's tags onto the canonical vocabulary, registering what's new. */
export async function canonicalise(
  db: SupabaseClient,
  userId: string,
  itemTags: string[][],
): Promise<string[][]> {
  const all = uniq(itemTags.flat().map(slugTag))
  if (!all.length) return itemTags.map(() => [])

  const vectors = await embed(env.embed, all)
  const vec = new Map(all.map((t, i) => [t, vectors[i]]))

  const shortlists: Record<string, string[]> = {}
  await pool(all, env.ocrConcurrency, async (tag) => {
    const { data, error } = await db.rpc('match_tags', {
      p_user_id: userId,
      query_embedding: vec.get(tag),
      threshold: env.tagThreshold,
      match_count: 5,
    })
    if (error) throw new Error(`tag lookup failed for "${tag}": ${error.message}`)
    shortlists[tag] = (data ?? []).map((r: any) => r.name).filter((n: string) => n !== tag)
  })

  // Nothing to collapse onto — skip the model call entirely.
  const hasCandidates = Object.values(shortlists).some((s) => s.length)
  const map = hasCandidates
    ? sanitizeTagMap(
      await chatJson<Record<string, string>>(env.merge, [
        { role: 'system', content: TAG_SYSTEM },
        { role: 'user', content: JSON.stringify(shortlists) },
      ]),
      shortlists,
    )
    : {}

  const mapped = itemTags.map((tags) => applyTagMap(tags, map))

  const { data: existing, error } = await db.from('tags').select('name').eq('user_id', userId)
  if (error) throw new Error(`could not read tag registry: ${error.message}`)

  const fresh = unseenTags(mapped.flat(), (existing ?? []).map((r: any) => r.name))
  if (fresh.length) {
    // sanitizeTagMap only ever maps onto tags that already exist, so anything
    // left unseen came from `all` and was embedded above.
    const rows = fresh.map((name) => ({ user_id: userId, name, embedding: vec.get(name) }))
    const { error: ie } = await db.from('tags').upsert(rows, { onConflict: 'user_id,name' })
    if (ie) throw new Error(`could not register tags: ${ie.message}`)
  }

  return mapped
}
