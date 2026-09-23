// Minimal OpenAI-compatible client. The whole surface used here is two POSTs,
// which is less code than wiring an SDK — and it works unchanged against
// OpenAI, Gemini's compatibility endpoint, Ollama, vLLM or anything else.

export interface ModelCfg { baseUrl: string; apiKey: string; model: string }

const url = (base: string, path: string) => `${base.replace(/\/+$/, '')}/${path}`

/** Retries only what is worth retrying: rate limits and transient 5xx. */
async function post(cfg: ModelCfg, path: string, body: unknown, tries = 4): Promise<any> {
  let last = ''
  for (let i = 0; i < tries; i++) {
    let res: Response
    try {
      res = await fetch(url(cfg.baseUrl, path), {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` },
        body: JSON.stringify(body),
      })
    } catch (e) {
      last = `network error: ${e instanceof Error ? e.message : String(e)}`
      await sleep(i)
      continue
    }
    if (res.ok) return await res.json()

    last = `${res.status} ${(await res.text()).slice(0, 400)}`
    if (res.status !== 429 && res.status < 500) break // not our luck, our request
    await sleep(i)
  }
  throw new Error(`${cfg.model} ${path} failed: ${last}`)
}

const sleep = (attempt: number) =>
  new Promise((r) => setTimeout(r, Math.min(8000, 500 * 2 ** attempt) * (0.5 + Math.random())))

/** Chat completion constrained to a JSON object, with the parse guarded. */
export async function chatJson<T>(
  cfg: ModelCfg,
  messages: unknown[],
  opts: { temperature?: number } = {},
): Promise<T> {
  const data = await post(cfg, 'chat/completions', {
    model: cfg.model,
    messages,
    temperature: opts.temperature ?? 0,
    response_format: { type: 'json_object' },
  })
  const raw = data?.choices?.[0]?.message?.content
  if (typeof raw !== 'string') throw new Error(`${cfg.model}: no message content in response`)
  try {
    // Some providers still wrap JSON in a ```json fence despite response_format.
    return JSON.parse(raw.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, '')) as T
  } catch {
    throw new Error(`${cfg.model}: response was not valid JSON: ${raw.slice(0, 200)}`)
  }
}

export async function embed(cfg: ModelCfg, input: string[]): Promise<number[][]> {
  if (!input.length) return []
  const data = await post(cfg, 'embeddings', { model: cfg.model, input })
  const out = data?.data
  if (!Array.isArray(out) || out.length !== input.length) {
    throw new Error(`${cfg.model}: expected ${input.length} embeddings, got ${out?.length}`)
  }
  return out.map((d: any) => d.embedding as number[])
}

/** Bounded-concurrency map — the OCR stage's only throttle. */
export async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length)
  let i = 0
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        const k = i++
        out[k] = await fn(items[k])
      }
    }),
  )
  return out
}
