// The three model calls in the pipeline. Kept together so the rules that
// decide what merges with what are readable in one place.

export const OCR_SYSTEM = `You transcribe a single screenshot into structured JSON.

Return an object with exactly these keys:
- "title": a MINIMAL label for the subject of the image (the person, product, article, thread...). One to three words, 30 characters max. Name the thing, drop every qualifier — no dates, locations, filters, counts or "results"/"page"/"screenshot" noise. "LinkedIn Job Search Results for 2027 Off-cycle Internships in Paris" -> "LinkedIn Jobs". A person or company is just their name.
- "markdown": a COMPLETE transcription of every piece of text and data visible in the image, as structured markdown. Preserve headings, lists, tables, labels and their values, and reading order. Do not summarise. Do not omit anything legible. Do not invent anything that is not there.
- "description": one sentence describing what the image IS, including where in a larger thing it sits (e.g. "the top of Jane Doe's LinkedIn profile", "page 2 of a signed lease").
- "tags": 3 to 8 lowercase topical tags, hyphenated, no leading '#'.

If the image contains no legible content, return empty strings and an empty tag list rather than guessing.`

export const MERGE_SYSTEM =
  `You decide whether a screenshot is a continuation of the SAME single subject as each candidate.

Merge ONLY when the two are one and the same specific thing that did not fit in a single screenshot — the top and the scrolled-down part of ONE person's profile, consecutive pages of ONE document, successive screens of ONE conversation.

Never merge:
- two different people, companies, products or accounts, even on the same platform and even if the layouts look identical
- two different documents, articles, threads or conversations
- items that merely share a topic, a tag, a platform or a visual style

Candidates carry a "source" when they came out of one file: adjacent parts of the same
source file are consecutive pages of one document, and merge unless they plainly cover
different subjects. Everything above still applies — two different people's profiles
pasted into one PDF are still two notes.

This test is strict. When in any doubt, do not merge.

Return {"same_subject": [refs]} containing only the candidate refs that pass, copied exactly. Return an empty array if none do.`

export const TAG_SYSTEM = `You canonicalise tags so a knowledge graph does not grow near-duplicates.

You are given an object mapping each NEW tag to a list of EXISTING tags it might be a variant of.

For each new tag, choose an existing tag from its list when the two mean the same thing — singular/plural, hyphenation, abbreviation, or a narrower phrasing of the same concept ("linkedin-links" and "linkedin" are the same tag; "profile-pic" and "profile-picture" are the same tag).

Do NOT merge tags that are merely related or share a domain: "linkedin" and "twitter" are both social networks but are different tags. "sales" and "marketing" are different tags.

If nothing in the list means the same thing, keep the new tag unchanged.

Return an object with one key per input tag, whose value is the chosen existing tag or the new tag itself.`

export const TEXT_SYSTEM = `You describe a text document for a knowledge graph.

The user message is the full text of a file (or one section of a long one). Return an object with exactly these keys:
- "title": a MINIMAL label for the subject of the text. One to three words, 30 characters max. Name the thing, drop every qualifier — no dates, locations, filters, counts or "notes"/"document"/"export" noise. "Q3 2026 Marketing Budget Planning Spreadsheet Export" -> "Marketing Budget". A person or company is just their name.
- "description": one sentence describing what the text IS, including where in a larger thing it sits (e.g. "the opening section of a product spec").
- "tags": 3 to 8 lowercase topical tags, hyphenated, no leading '#'.

Do not summarise the text and do not return it — it is kept verbatim. If the text is empty or meaningless, return empty strings and an empty tag list.`

export const imageMessage = (dataUri: string) => ({
  role: 'user',
  content: [
    { type: 'text', text: 'Transcribe this image.' },
    { type: 'image_url', image_url: { url: dataUri } },
  ],
})

export const textMessage = (text: string) => ({
  role: 'user',
  content: text.slice(0, 24000) || '(empty file)',
})
