// Run: pnpm test   (node --test, native TS stripping — no framework, no deps)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildNoteContent, extractTags, hoistTags, noteBody, noteTitle, slugTag } from './content.ts'
import { baseNoteId, neighbourRefs, NOTE, resolveGroups } from './merge.ts'
import { applyTagMap, sanitizeTagMap, unseenTags } from './tags.ts'
import { INGESTIBLE, kindOf, SOURCE_EXT } from './files.ts'

test('slugTag produces tags the frontend regex accepts', () => {
  assert.equal(slugTag('Sales Navigator!'), 'sales-navigator')
  assert.equal(slugTag('  LinkedIn  '), 'linkedin')
  assert.equal(slugTag('café/pro'), 'cafepro')
  assert.equal(slugTag('a__b'), 'a-b')
  for (const s of ['Sales Navigator!', 'café/pro', 'a__b']) {
    assert.match(slugTag(s), /^[\w-]+$/)
  }
})

test('hoistTags moves inline hashtags out of the body and into the tag list', () => {
  const o = hoistTags({
    title: 'Post by #jane',
    markdown: 'Shipping v2 today #buildinpublic #saas',
    description: 'A LinkedIn\npost screenshot',
    tags: ['linkedin'],
  })
  assert.equal(o.markdown.includes('#'), false)
  assert.equal(o.title, 'Post by jane')
  assert.equal(o.description, 'A LinkedIn post screenshot') // single line for `> ` blockquote
  assert.deepEqual(o.tags, ['linkedin', 'jane', 'buildinpublic', 'saas'])
})

test('buildNoteContent round-trips through the frontend extractTags', () => {
  const c = buildNoteContent(
    'Jane Doe — LinkedIn',
    [
      { markdown: '## Experience\n- Head of Sales', description: 'Top of the profile' },
      { markdown: '## Education\n- ESSEC', description: 'Scrolled further down' },
    ],
    ['LinkedIn', 'sales', 'linkedin'],
  )
  assert.deepEqual(extractTags(c), ['linkedin', 'sales'])
  assert.match(c, /^# Jane Doe — LinkedIn\n/)
  assert.match(c, /\n---\n/)                       // the two parts stay distinguishable
  assert.match(c, /^> Top of the profile$/m)       // frontend blockquote regex
  assert.equal(c.trimEnd().endsWith('#linkedin #sales'), true)
})

test('markdown headings are never mistaken for tags', () => {
  const c = buildNoteContent('T', [{ markdown: '# H1\n## H2\n### H3', description: '' }], [])
  assert.deepEqual(extractTags(c), [])
})

test('neighbourRefs gives the overlapping window, clamped at both ends', () => {
  assert.deepEqual(neighbourRefs(0, 5), ['1'])
  assert.deepEqual(neighbourRefs(2, 5), ['1', '3'])
  assert.deepEqual(neighbourRefs(4, 5), ['3'])
})

test('pairwise verdicts chain 3-4-5 into a single group', () => {
  const members = ['0', '1', '2', '3', '4', '5']
  const groups = resolveGroups(members, [['2', '3'], ['3', '4']])
  assert.deepEqual(groups, [['0'], ['1'], ['2', '3', '4'], ['5']])
})

test('adjacent but unrelated images stay separate', () => {
  assert.deepEqual(resolveGroups(['0', '1', '2'], []), [['0'], ['1'], ['2']])
})

test('a group attaches to an existing note when one was confirmed', () => {
  const g = resolveGroups([NOTE + 'abc', '0', '1'], [['0', NOTE + 'abc']])
  assert.deepEqual(g, [[NOTE + 'abc', '0'], ['1']])
  assert.equal(baseNoteId(g[0]), 'abc')
  assert.equal(baseNoteId(g[1]), null)
})

test('two existing notes are never welded together by a shared image', () => {
  const a = NOTE + 'aaa', b = NOTE + 'bbb'
  const g = resolveGroups([a, b, '0', '1'], [['0', a], ['0', b], ['0', '1']])
  assert.equal(g.length, 2)
  assert.deepEqual(g[0], [a, '0', '1'])   // first verdict wins
  assert.deepEqual(g[1], [b])             // the other note is left untouched
})

test('sanitizeTagMap collapses linkedin-links but refuses invented targets', () => {
  const shortlists = { 'linkedin-links': ['linkedin'], twitter: ['linkedin'], sales: [] }
  const map = sanitizeTagMap(
    { 'linkedin-links': 'linkedin', twitter: 'social-media', sales: 'sales' },
    shortlists,
  )
  assert.deepEqual(map, { 'linkedin-links': 'linkedin' })   // 'social-media' was never offered
  assert.deepEqual(applyTagMap(['linkedin-links', 'twitter', 'LinkedIn'], map), ['linkedin', 'twitter'])
})

test('unseenTags reports only what the registry is missing', () => {
  assert.deepEqual(unseenTags(['linkedin', 'sales'], ['LinkedIn']), ['sales'])
})

test('noteBody strips the shell so appending never duplicates it', () => {
  const first = buildNoteContent('Jane Doe', [{ markdown: '## Experience\n- Head of Sales', description: 'Top of the profile' }], ['linkedin'])
  assert.equal(noteTitle(first), 'Jane Doe')

  // What finalize does when a later image joins an existing note.
  const grown = buildNoteContent('Jane Doe', [
    { markdown: noteBody(first), description: '' },
    { markdown: '## Education\n- ESSEC', description: 'Scrolled further down' },
  ], ['linkedin', 'education'])

  assert.equal(grown.split('# Jane Doe').length - 1, 1)     // one title, not two
  assert.deepEqual(extractTags(grown), ['linkedin', 'education'])
  assert.match(grown, /Head of Sales/)
  assert.match(grown, /ESSEC/)
  assert.equal(noteBody(grown).includes('#linkedin'), false)
})

test('noteBody tolerates notes that never had a shell', () => {
  assert.equal(noteBody('just some text'), 'just some text')
  assert.equal(noteTitle('just some text'), 'Untitled note')
  assert.equal(noteBody(''), '')
})

test('kindOf decides how a file is read, and refuses what cannot be read', () => {
  assert.equal(kindOf('PNG'), 'image')
  assert.equal(kindOf('jpeg'), 'image')
  assert.equal(kindOf('md'), 'text')
  assert.equal(kindOf('txt'), 'text')
  // A PDF is never transcribed directly — the client renders its pages.
  assert.equal(kindOf('pdf'), null)
  assert.equal(kindOf('docx'), null)
  assert.equal(kindOf(''), null)
})

test('a PDF is a valid source even though it is not a valid item', () => {
  assert.equal(SOURCE_EXT.has('pdf'), true)
  assert.equal(SOURCE_EXT.has('png'), true)   // a chunked file is its own source
  assert.equal(SOURCE_EXT.has('exe'), false)
  assert.deepEqual(INGESTIBLE.filter((e) => !SOURCE_EXT.has(e)), [])
})
