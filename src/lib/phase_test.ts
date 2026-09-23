// Two things must not regress: a batch that has read every file is not finished,
// and a batch nothing is working on any more must not sit in the tray forever.
import assert from 'node:assert/strict'
import test from 'node:test'
import { batchPhase, inFlight, isLive, isReportable, isSettled, STALE_MS } from './phase.ts'
import type { IngestBatch } from './types.ts'

const now = Date.now()
const batch = (o: Partial<IngestBatch>): IngestBatch =>
  ({ id: 'b', status: 'pending', total: 3, done: 0, failed: 0, created: now, updated: now, ...o })

test('phases follow the pipeline, not the counters alone', () => {
  assert.equal(batchPhase(batch({ status: 'pending' })), 'uploading')
  assert.equal(batchPhase(batch({ status: 'processing', done: 1 })), 'reading')
  // Every file read, notes not written yet.
  assert.equal(batchPhase(batch({ status: 'processing', done: 3 })), 'organising')
  assert.equal(batchPhase(batch({ status: 'finalizing', done: 3 })), 'organising')
  assert.equal(batchPhase(batch({ status: 'complete', done: 3 })), 'done')
  assert.equal(batchPhase(batch({ status: 'failed', done: 1, failed: 2 })), 'stopped')
})

test('an organising batch still counts as in flight', () => {
  assert.equal(inFlight(batch({ status: 'processing', done: 3 })), 3)
  assert.equal(inFlight(batch({ status: 'finalizing', done: 2, failed: 1 })), 2)
  assert.equal(inFlight(batch({ status: 'complete', done: 3 })), 0)
  assert.equal(isSettled(batch({ status: 'finalizing', done: 3 })), false)
})

test('a batch nothing has touched for too long is not live', () => {
  const ghost = batch({ status: 'finalizing', done: 3, updated: now - STALE_MS - 1 })
  assert.equal(isLive(ghost), false)
  assert.equal(inFlight(ghost), 0, 'a ghost must not inflate the badge count')
  assert.equal(isLive(batch({ status: 'finalizing', done: 3, updated: now - 1000 })), true)
  // A batch of nothing but duplicates never had work to report.
  assert.equal(isLive(batch({ status: 'pending', total: 0 })), false)
})

test('the tray reports live work and unread failures, nothing else', () => {
  const seen: string[] = []
  assert.equal(isReportable(batch({ status: 'processing', done: 3 }), seen), true)
  assert.equal(isReportable(batch({ status: 'complete', done: 3 }), seen), false,
    'a finished batch is history')
  assert.equal(isReportable(batch({ status: 'finalizing', updated: now - STALE_MS - 1 }), seen), false,
    'an abandoned batch is a ghost')
  // A failure outlives its batch until someone has opened the tray on it.
  const broke = batch({ id: 'x', status: 'failed', done: 1, failed: 2 })
  assert.equal(isReportable(broke, seen), true)
  assert.equal(isReportable(broke, ['x']), false)
})
