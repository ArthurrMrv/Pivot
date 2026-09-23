import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from './supabase'
import { listBatches, listItems } from './api'
import { inFlight, isReportable, isSettled } from './phase'
import type { IngestBatch, IngestItem } from './types'

const SEEN_KEY = 'pivot.seenFailures'

/** Batch ids whose failures have already been looked at. Survives a reload. */
function readSeen(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]')
    return Array.isArray(raw) ? raw.filter((x) => typeof x === 'string') : []
  } catch {
    return [] // a corrupt entry just means the failure is shown once more
  }
}

/**
 * Live ingestion progress.
 *
 * The worker bumps ingest_batches once per finished file, and that table is in
 * the realtime publication, so one subscription drives both the count and the
 * file list — ingest_items never needs to be published.
 */
export function useIngest() {
  const [batches, setBatches] = useState<IngestBatch[]>([])
  const [items, setItems] = useState<IngestItem[]>([])
  const [open, setOpen] = useState(false)
  const [seen, setSeen] = useState<string[]>(readSeen)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const openRef = useRef(open)
  openRef.current = open

  // The full recent list, so a batch reaching 'complete' is still observed even
  // though the tray no longer shows it.
  const refresh = useCallback(async () => {
    try {
      const rows = await listBatches()
      setBatches(rows)
      setItems(openRef.current ? await listItems(rows.map((b) => b.id)) : [])
    } catch (e) {
      console.error('could not read ingestion progress:', e)
    }
  }, [])

  useEffect(() => {
    refresh()
    // Each finished file updates the batch row; coalesce a burst into one read.
    const nudge = () => {
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(refresh, 300)
    }
    const channel = supabase.channel('pivot-ingest')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ingest_batches' }, nudge)
      .subscribe()
    return () => {
      if (timer.current) clearTimeout(timer.current)
      supabase.removeChannel(channel)
    }
  }, [refresh])

  // Nothing writes a row when a batch is abandoned, so only the clock retires
  // it. One slow tick is enough for a cutoff measured in minutes.
  const stalling = batches.some((b) => !isSettled(b))
  useEffect(() => {
    if (!stalling) return
    const id = setInterval(refresh, 60_000)
    return () => clearInterval(id)
  }, [stalling, refresh])

  // Opening pulls the per-file detail in; closing drops it again.
  // ponytail: item rows only refresh when a batch row changes, so during
  // 'organising' — where no batch write happens — every file reads 'read' until
  // the batch completes. Publish ingest_items to realtime if that matters.
  useEffect(() => { if (open) refresh() }, [open, refresh])

  const shown = useMemo(() => batches.filter((b) => isReportable(b, seen)), [batches, seen])

  // Whatever has failed while the list is open counts as looked at.
  useEffect(() => {
    if (!open) return
    const failed = batches.filter((b) => b.failed > 0).map((b) => b.id)
    if (!failed.length) return
    setSeen((prev) => {
      if (failed.every((id) => prev.includes(id))) return prev // no needless render
      const next = [...new Set([...prev, ...failed])].slice(-50)
      localStorage.setItem(SEEN_KEY, JSON.stringify(next))
      return next
    })
  }, [open, batches])

  // Counts files still on their way into the graph, so it only reaches zero
  // once finalize has written the notes — not when the last image was read.
  const remaining = batches.reduce((n, b) => n + inFlight(b), 0)
  const unseenFailures = batches
    .filter((b) => !seen.includes(b.id))
    .reduce((n, b) => n + b.failed, 0)

  // Changes exactly once per batch that reaches the end, whichever way it went.
  const settledKey = batches.filter(isSettled).map((b) => b.id).sort().join(',')

  return { shown, items, remaining, unseenFailures, settledKey, open, setOpen }
}
