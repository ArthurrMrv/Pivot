// Pure merge resolution. No Deno/Node APIs.
//
// Each image is judged against a small candidate set (previous image, next
// image, and the two nearest existing notes). Those pairwise verdicts are
// unioned, so a subject spanning images 3-4-5 collapses into one group even
// though no single judge call ever saw all three.

export const NOTE = 'note:'
const isNote = (ref: string) => ref.startsWith(NOTE)

/** Candidate refs for image `idx` within a batch of `n`: its two neighbours. */
export function neighbourRefs(idx: number, n: number): string[] {
  return [idx - 1, idx + 1].filter((i) => i >= 0 && i < n).map(String)
}

/**
 * Union-find over confirmed same-subject pairs.
 *
 * `members` fixes both the order of the returned groups and the order within
 * each group, so callers pass existing-note refs first (a group containing one
 * is appended to rather than created) and image refs in `idx` order.
 *
 * A union that would weld two *existing* notes together is refused: the judge
 * only ever answered "is this image part of that note", never "are those two
 * notes the same thing", and acting on the stronger claim would silently
 * destroy a note the user already had.
 */
export function resolveGroups(members: string[], pairs: [string, string][]): string[][] {
  const all = [...new Set([...members, ...pairs.flat()])]
  const rank = new Map(all.map((m, i) => [m, members.indexOf(m) === -1 ? all.length + i : i]))
  const parent = new Map(all.map((m) => [m, m]))
  const hasNote = new Map(all.map((m) => [m, isNote(m)]))

  const find = (x: string): string => {
    const p = parent.get(x)!
    if (p === x) return x
    const r = find(p)
    parent.set(x, r)
    return r
  }

  for (const [a, b] of pairs) {
    const ra = find(a), rb = find(b)
    if (ra === rb) continue
    if (hasNote.get(ra) && hasNote.get(rb)) continue // never merge two existing notes
    const [keep, drop] = rank.get(ra)! <= rank.get(rb)! ? [ra, rb] : [rb, ra]
    parent.set(drop, keep)
    hasNote.set(keep, hasNote.get(keep)! || hasNote.get(drop)!)
  }

  const groups = new Map<string, string[]>()
  for (const m of [...all].sort((a, b) => rank.get(a)! - rank.get(b)!)) {
    const r = find(m)
    groups.set(r, [...(groups.get(r) ?? []), m])
  }
  return [...groups.values()].sort((a, b) => rank.get(a[0])! - rank.get(b[0])!)
}

/** The one existing note a group attaches to, if any. */
export function baseNoteId(group: string[]): string | null {
  const ref = group.find(isNote)
  return ref ? ref.slice(NOTE.length) : null
}
