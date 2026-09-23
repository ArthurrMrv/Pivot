// Where a batch actually is. Reading every file is the middle of the pipeline,
// not the end: finalize still has to group the transcriptions and write the
// notes, and that is the stage the graph is waiting on.
import type { IngestBatch } from './types'

export type Phase = 'uploading' | 'reading' | 'organising' | 'done' | 'stopped'

export const PHASE_LABEL: Record<Phase, string> = {
  uploading: 'Uploading',
  reading: 'Reading',
  organising: 'Organising',
  done: 'Done',
  stopped: 'Stopped',
}

export function batchPhase(b: IngestBatch): Phase {
  if (b.status === 'complete') return 'done'
  if (b.status === 'failed') return 'stopped'
  // 'pending' means the row exists but commit has not run: bytes are still
  // going up from the browser.
  if (b.status === 'pending') return 'uploading'
  return b.done + b.failed >= b.total ? 'organising' : 'reading'
}

/** Only the server says a batch is over — a full progress bar does not. */
export const isSettled = (b: IngestBatch) => b.status === 'complete' || b.status === 'failed'

// ponytail: fixed wall-clock cutoff, not a heartbeat. A batch whose worker died
// mid-stage stops being reported as in flight after this long. Raise it if a
// single stage can legitimately go quiet for longer.
export const STALE_MS = 15 * 60_000

/**
 * Work the pipeline is actually doing right now.
 *
 * Unsettled is not enough: a worker killed mid-batch leaves a row in
 * 'processing' or 'finalizing' that nothing will ever move again, and it would
 * otherwise sit in the tray forever. No progress for STALE_MS means abandoned.
 */
export const isLive = (b: IngestBatch, now = Date.now()) =>
  !isSettled(b) && b.total > 0 && now - b.updated < STALE_MS

/**
 * What belongs in the tray: work in progress, and failures nobody has looked at
 * yet. A finished batch is history and one whose worker died is a ghost —
 * neither is being ingested, so neither is reported.
 */
export const isReportable = (b: IngestBatch, seen: string[]) =>
  isLive(b) || (b.failed > 0 && !seen.includes(b.id))

/** Files still on their way into the graph. Stays above zero while organising. */
export const inFlight = (b: IngestBatch, now = Date.now()) =>
  (isLive(b, now) ? Math.max(0, b.total - b.failed) : 0)
