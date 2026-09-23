// Pure note-content assembly. No Deno/Node APIs so `node --test` can run it.
//
// The frontend is the consumer of record: it derives graph tag nodes with
// /#([\w-]+)/g and renders blockquotes with /^> (.+)$/gm (src/App.tsx). Every
// shape below exists to satisfy those two regexes.

export interface Ocr {
  title: string
  markdown: string
  description: string
  tags: string[]
}

const TAG_RE = /#([\w-]+)/g

/** `Sales Navigator!` -> `sales-navigator`. Must match the frontend's [\w-]+. */
export function slugTag(raw: string): string {
  return raw
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)
}

export function uniq(xs: string[]): string[] {
  return [...new Set(xs.filter(Boolean))]
}

/**
 * Hashtags inside a transcription would become graph tags that never went
 * through canonicalisation. Lift them into the tag list (where they do get
 * canonicalised) and leave the body as plain text.
 */
export function hoistTags(ocr: Ocr): Ocr {
  const inline = [...`${ocr.title}\n${ocr.markdown}`.matchAll(TAG_RE)].map((m) => m[1])
  return {
    title: ocr.title.replace(TAG_RE, '$1').trim() || 'Untitled note',
    markdown: ocr.markdown.replace(TAG_RE, '$1'),
    description: ocr.description.replace(TAG_RE, '$1').replace(/\s*\n+\s*/g, ' ').trim(),
    tags: uniq([...ocr.tags, ...inline].map(slugTag)),
  }
}

/** One note out of one-or-more merged transcriptions, in `idx` order. */
export function buildNoteContent(
  title: string,
  parts: { markdown: string; description: string }[],
  tags: string[],
): string {
  const body = parts
    .map(({ markdown, description }) =>
      [markdown.trim(), description.trim() && `> ${description.trim()}`]
        .filter(Boolean).join('\n\n')
    )
    .filter(Boolean)
    .join('\n\n---\n\n')

  const line = uniq(tags.map(slugTag)).map((t) => `#${t}`).join(' ')
  return [`# ${title.replace(TAG_RE, '$1').trim()}`, body, line]
    .filter(Boolean).join('\n\n')
}

/** Mirrors the frontend's extractTags — used by tests to prove the round trip. */
export function extractTags(content: string): string[] {
  return uniq([...content.matchAll(TAG_RE)].map((m) => m[1]))
}

/**
 * A note's body without the `# title` line or the trailing `#tag #tag` line,
 * so an existing note can be rebuilt with new material appended without its
 * shell accumulating copies of itself.
 */
export function noteBody(content: string): string {
  const lines = content.split('\n')
  if (lines[0]?.startsWith('# ')) lines.shift()
  while (lines.length && !lines.at(-1)!.trim()) lines.pop()
  const last = lines.at(-1)?.trim() ?? ''
  if (last && /^#[\w-]+(\s+#[\w-]+)*$/.test(last)) lines.pop()
  return lines.join('\n').trim()
}

/** The title a note displays, falling back when the `# ` line is missing. */
export function noteTitle(content: string, fallback = 'Untitled note'): string {
  const first = content.split('\n')[0] ?? ''
  return first.startsWith('# ') ? first.slice(2).trim() || fallback : fallback
}
