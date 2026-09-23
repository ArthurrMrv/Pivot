# Contributing

## Getting set up

```bash
pnpm install
pnpm setup
pnpm dev
```

Before opening a pull request:

```bash
pnpm test        # pure logic
pnpm typecheck   # frontend and edge functions
```

`pnpm typecheck` covers the edge functions too, via
`supabase/functions/tsconfig.json`, which maps their `npm:` and `jsr:` imports
onto the installed packages. You do not need a Deno toolchain to check your work.

## How the code is arranged

**Pure logic lives in `supabase/functions/_shared/`** — `content.ts`, `merge.ts`,
`tags.ts` and `files.ts` have no Deno, Node or network dependencies, which is why
`node --test` can run them directly. Anything that can be expressed as a pure
function of its inputs belongs there, with a test. Everything that talks to the
database, storage or a model stays in `ingest/` and `process/`.

**The frontend does not know Supabase exists** outside `src/lib/`. `src/App.tsx`
is a design artifact; treat its styling as fixed and change it only when the
design changes.

## Things worth knowing

- **Tags live in two places on purpose.** They are inline `#tags` in
  `notes.content`, because the graph derives its tag nodes from the note text.
  The `tags` table exists only as an embedding registry for canonicalisation —
  it is not a junction table and does not define which note has which tag.

- **The merge test is strict, and should stay strict.** A false merge destroys
  information by welding two subjects together; a missed merge just leaves two
  notes the user can join. If you change `MERGE_SYSTEM` in `_shared/prompts.ts`,
  weight the prompt toward refusing.

- **`resolveGroups` refuses to merge two existing notes.** The judge is only
  ever asked "is this item part of that note", never "are those two notes the
  same". Acting on the stronger claim would silently destroy a note the user
  already had.

- **Expansion happens in the browser, never on the server.** A PDF is one file
  to the person dropping it and one item per page to the pipeline; the split is
  done by `src/lib/expand.ts` before anything is planned, so the backend only
  ever sees a flat list where an item may name a `source`. Adding a format is an
  entry in `_shared/files.ts` (what the server accepts) and, if it needs
  splitting, one in `EXPANDERS`. Nothing else changes.

- **A note carries the source, not the parts.** `finalize.ts` attaches
  `item.source ?? item` to the note, deduped by hash. That is why a PDF that
  produced four notes is still one clickable document in each of them, and why
  page renders never appear in a carousel.

- **Deliberate shortcuts are marked `ponytail:`** with the ceiling they hit and
  the upgrade path. `grep -rn 'ponytail:' supabase/ src/` lists them. If you
  raise one of those ceilings, remove the comment.

- **Retries are the queue's job.** Throwing out of a message handler leaves the
  message on `pgmq` to be redelivered after the visibility timeout. Swallowing
  an error instead means the work is silently lost.

## Commit messages

`<type>: <description>` — `feat`, `fix`, `refactor`, `docs`, `test`, `chore`,
`perf`, `ci`.
