// Configuration, validated once at module load so a misconfigured deployment
// fails loudly on the first invocation instead of halfway through a 200-image
// batch. Every value is set by scripts/setup.mjs.

const req = (k: string): string => {
  const v = Deno.env.get(k)
  if (!v) throw new Error(`Missing required environment variable: ${k}`)
  return v
}
const opt = (k: string, d: string): string => Deno.env.get(k) || d
const num = (k: string, d: number): number => {
  const v = Number(Deno.env.get(k))
  return Number.isFinite(v) && v > 0 ? v : d
}

export const env = {
  supabaseUrl: req('SUPABASE_URL'),
  serviceKey: req('SUPABASE_SERVICE_ROLE_KEY'),
  authEnabled: opt('AUTH_ENABLED', 'true') !== 'false',
  localUserId: opt('LOCAL_USER_ID', ''),

  // Lazy: `ingest` never calls a model and must not fail to boot over a key
  // it does not use.
  get ocr() {
    return {
      baseUrl: opt('OCR_BASE_URL', 'https://generativelanguage.googleapis.com/v1beta/openai/'),
      apiKey: req('OCR_API_KEY'),
      model: opt('OCR_MODEL', 'gemini-flash-latest'),
    }
  },
  get embed() {
    return {
      baseUrl: opt('EMBED_BASE_URL', 'https://api.openai.com/v1'),
      apiKey: req('EMBED_API_KEY'),
      model: opt('EMBED_MODEL', 'text-embedding-3-small'),
    }
  },
  get merge() {
    return { ...this.ocr, model: opt('MERGE_MODEL', this.ocr.model) }
  },

  bucket: opt('STORAGE_BUCKET', 'uploads'),
  // ponytail: fixed drain size. If images pile up faster than the cron ticks,
  // raise this or shorten the schedule before reaching for a second worker.
  batchSize: num('BATCH_SIZE', 25),
  // ponytail: flat concurrency, no adaptive backoff. Tune to the OCR
  // provider's rate limit; 429s are retried but a too-high value wastes them.
  ocrConcurrency: num('OCR_CONCURRENCY', 5),
  // ponytail: single cosine cut for the shortlist an LLM then confirms. Loose
  // on purpose — the model, not this number, makes the final call. Re-tune if
  // the embedding model changes.
  tagThreshold: Number(opt('TAG_MATCH_THRESHOLD', '0.78')),
  // How many existing notes an image may be compared against when merging.
  matchNotes: num('MATCH_NOTES', 2),
  // ponytail: floor below which a nearest note is not worth a judge call at
  // all. Well under "same subject" — the judge, not this number, decides.
  matchNotesMin: Number(opt('MATCH_NOTES_MIN', '0.55')),
}
