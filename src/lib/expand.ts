// One dropped file in, the items the pipeline should actually read out.
//
// A PDF is the interesting case: it stays ONE document you can open from a
// note's carousel, but its pages are rendered to images and ingested
// separately, so the model reads tables, charts and layout the way it reads a
// screenshot — and a dense PDF can become several notes.
//
// Adding a format: one entry in EXPANDERS here, one in
// supabase/functions/_shared/files.ts (which the server validates against).

export interface Expanded {
  /** What gets transcribed. */
  parts: File[]
  /** The original file, when parts came out of it. Attached to every note. */
  source?: File
}

// ponytail: a hard page cap. A 300-page PDF is a different feature (chunked
// batches); until someone drops one, refusing past the cap keeps the browser
// responsive and the bill finite.
const MAX_PAGES = 100
const PAGE_WIDTH = 1600 // px; enough for body text to stay legible to the model
const QUALITY = 0.85

type Expander = (file: File) => Promise<Expanded>

const EXPANDERS: Record<string, Expander> = { pdf: expandPdf }

export const extOf = (name: string) =>
  name.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || ''

export async function expand(file: File): Promise<Expanded> {
  const fn = EXPANDERS[extOf(file.name)]
  return fn ? await fn(file) : { parts: [file] }
}

async function expandPdf(file: File): Promise<Expanded> {
  // Lazily imported: pdf.js is large and only a PDF ever needs it.
  const [pdfjs, worker] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ])
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default

  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) })
  const doc = await task.promise
  if (doc.numPages > MAX_PAGES) {
    throw new Error(`${file.name} has ${doc.numPages} pages — the limit is ${MAX_PAGES}.`)
  }

  const base = file.name.replace(/\.pdf$/i, '')
  const parts: File[] = []
  try {
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n)
      try {
        const scale = Math.min(2, PAGE_WIDTH / page.getViewport({ scale: 1 }).width)
        const viewport = page.getViewport({ scale })
        const canvas = document.createElement('canvas')
        canvas.width = Math.ceil(viewport.width)
        canvas.height = Math.ceil(viewport.height)
        await page.render({ canvas, viewport, background: '#ffffff' }).promise

        const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', QUALITY))
        if (!blob) throw new Error(`could not render page ${n} of ${file.name}`)
        parts.push(new File([blob], `${base} — page ${n}.jpg`, { type: 'image/jpeg' }))
        canvas.width = canvas.height = 0 // release the backing store immediately
      } finally {
        page.cleanup()
      }
    }
  } finally {
    await task.destroy() // releases the worker; a dropped PDF must not leak one
  }

  if (!parts.length) throw new Error(`${file.name} has no pages.`)
  return { parts, source: file }
}
