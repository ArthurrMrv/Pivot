// A malformed path renders as nothing at all, silently, so pin the geometry.
import assert from 'node:assert/strict'
import test from 'node:test'
import { notch } from './notch.ts'

/** Walks the pen through the path and returns the bounding box it touches. */
function bounds(d: string) {
  let x = 0
  let y = 0
  const box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity }
  const mark = () => {
    box.x0 = Math.min(box.x0, x); box.x1 = Math.max(box.x1, x)
    box.y0 = Math.min(box.y0, y); box.y1 = Math.max(box.y1, y)
  }
  for (const [, cmd, args] of d.matchAll(/([MHVAZ])([-\d. ]*)/g)) {
    const n = args.trim().split(/[ ]+/).filter(Boolean).map(Number)
    if (cmd === 'M') { [x, y] = n }
    else if (cmd === 'H') { x = n[0] }
    else if (cmd === 'V') { y = n[0] }
    else if (cmd === 'A') { x = n[5]; y = n[6] }
    else continue
    mark()
  }
  return box
}

test('notch fills its square and closes', () => {
  const d = notch(50, 40, 10, 4)
  assert.ok(d.startsWith('M'), 'starts with a moveto')
  assert.ok(d.endsWith('Z'), 'closes the shape')
  assert.equal(d.match(/A/g)!.length, 2, 'exactly two corners are rounded')
  assert.deepEqual(bounds(d), { x0: 40, y0: 30, x1: 60, y1: 50 })
})

test('the two arcs share the corner radius and sweep the same way', () => {
  const arcs = [...notch(0, 0, 12, 5).matchAll(/A(\S+) (\S+) 0 0 (\d)/g)]
  assert.equal(arcs.length, 2)
  for (const [, rx, ry, sweep] of arcs) assert.deepEqual([rx, ry, sweep], ['5', '5', '1'])
})
