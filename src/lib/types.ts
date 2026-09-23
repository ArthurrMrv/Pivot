// Mirrors the shapes App.tsx already declares locally. TypeScript is
// structural, so these stay assignable without the UI file importing anything
// it did not import before.
export interface NoteDoc {
  id: string; name: string; ext: string; size: number
  /** Signed URL, for images only — the carousel renders it as a thumbnail. */
  preview?: string
  /** Signed URL for any document, so the card can open it. */
  url?: string
}
export interface Note {
  id: string
  name: string
  content: string
  created: number
  modified: number
  docs?: NoteDoc[]
}

/** A drop of files, as the pipeline tracks it. */
export interface IngestBatch {
  id: string
  status: string   // pending | processing | finalizing | complete | failed
  total: number
  done: number
  failed: number
  created: number
  /** Last time the pipeline touched it — how a live batch is told from a ghost. */
  updated: number
}

/** One file inside a batch. */
export interface IngestItem {
  id: string
  batchId: string
  name: string
  status: string   // pending | processing | ocr_done | merged | failed
  error: string | null
}
