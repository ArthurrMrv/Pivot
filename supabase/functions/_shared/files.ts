// What can be ingested, and how it is read. Adding a format is one entry here
// plus (if it needs expanding client-side) one entry in src/lib/expand.ts.
//
// Pure — no Deno APIs, so `node --test` covers it.

/** Extension -> how the pipeline reads it. */
export const KINDS: Record<string, 'image' | 'text'> = {
  png: 'image', jpg: 'image', jpeg: 'image', webp: 'image',
  gif: 'image', bmp: 'image', heic: 'image', heif: 'image',
  md: 'text', txt: 'text',
}

/**
 * Extensions allowed as the *source* of an item. A PDF never reaches the model
 * itself — the client renders its pages — so it is only ever a source.
 */
export const SOURCE_EXT = new Set([...Object.keys(KINDS), 'pdf'])

export const kindOf = (ext: string): 'image' | 'text' | null =>
  KINDS[String(ext).toLowerCase()] ?? null

export const INGESTIBLE = [...new Set([...Object.keys(KINDS), 'pdf'])]
