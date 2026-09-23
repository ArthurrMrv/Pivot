// Pure tag canonicalisation. No Deno/Node APIs.
//
// Embeddings produce a shortlist of plausible existing tags per new tag; one
// LLM call then decides the mapping. This file holds everything around that
// call that must be deterministic — in particular, refusing to trust a model
// that maps a tag onto something nobody offered it.

import { slugTag, uniq } from './content.ts'

export type TagMap = Record<string, string>

/**
 * Drop mappings the shortlist never proposed, self-maps, and chains. A model
 * answering `{"linkedin-links": "social"}` when only `linkedin` was on offer
 * gets ignored rather than inventing a tag nobody has.
 */
export function sanitizeTagMap(raw: unknown, shortlists: Record<string, string[]>): TagMap {
  const out: TagMap = {}
  if (!raw || typeof raw !== 'object') return out
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const from = slugTag(k)
    const to = typeof v === 'string' ? slugTag(v) : ''
    if (!from || !to || from === to) continue
    if (!(shortlists[from] ?? []).includes(to)) continue
    out[from] = to
  }
  return out
}

/** Rewrite a note's tags through the map, preserving order and de-duplicating. */
export function applyTagMap(tags: string[], map: TagMap): string[] {
  return uniq(tags.map(slugTag).map((t) => map[t] ?? t))
}

/** Tags that survived canonicalisation and are not yet in the registry. */
export function unseenTags(mapped: string[], existing: string[]): string[] {
  const have = new Set(existing.map(slugTag))
  return uniq(mapped.map(slugTag)).filter((t) => !have.has(t))
}
