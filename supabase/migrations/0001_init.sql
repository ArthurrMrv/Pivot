-- Pivot — core schema.
-- Embedding dimension is rewritten by scripts/setup.mjs when a non-default
-- embedding model is chosen. Keep the literal `vector(1536)` spelling.

create extension if not exists vector with schema extensions;
create extension if not exists pgmq;
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

-- ── Identity ────────────────────────────────────────────────────────────────
-- One definition covers both auth modes.
--   auth on : no row -> falls through to auth.uid(); anon resolves to null and
--             every RLS policy denies.
--   auth off: setup.mjs records a local user id and the anon key acts as it.
--
-- A table rather than a database setting: `alter database ... set` on a custom
-- parameter needs superuser, which `postgres` is not on Supabase.
create table if not exists public.app_config (
  key   text primary key,
  value text not null
);

-- security definer so the function can read app_config while nothing else can:
-- RLS is on below with no policies, and the owner is exempt from it.
create or replace function public.current_user_id() returns uuid
  language sql stable security definer set search_path = public as $$
  select coalesce(
    auth.uid(),
    (select value::uuid from public.app_config where key = 'local_user_id')
  )
$$;

-- ── Tables ──────────────────────────────────────────────────────────────────
create table if not exists public.notes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default public.current_user_id(),
  title       text not null default 'Untitled note',
  content     text not null default '',
  embedding   vector(1536),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- One file can belong to several notes — a PDF that produced four of them is
-- still one document in each carousel — so the note is part of the key.
-- Storage stays content-addressed, so the bytes are stored once regardless.
create table if not exists public.docs (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default public.current_user_id(),
  note_id      uuid references public.notes(id) on delete cascade,
  storage_path text not null,
  name         text not null,
  ext          text not null default 'bin',
  size         bigint not null default 0,
  sha256       text not null,
  created_at   timestamptz not null default now(),
  unique (user_id, note_id, sha256)
);

-- Embedding registry for tag canonicalisation. Tags themselves live inline in
-- notes.content as `#tag` because the graph derives them from the text.
create table if not exists public.tags (
  id        uuid primary key default gen_random_uuid(),
  user_id   uuid not null default public.current_user_id(),
  name      text not null,
  embedding vector(1536),
  unique (user_id, name)
);

create table if not exists public.ingest_batches (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default public.current_user_id(),
  status     text not null default 'pending',  -- pending|processing|complete|failed
  total      int  not null default 0,
  done       int  not null default 0,
  failed     int  not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.ingest_items (
  id           uuid primary key default gen_random_uuid(),
  batch_id     uuid not null references public.ingest_batches(id) on delete cascade,
  user_id      uuid not null default public.current_user_id(),
  idx          int  not null,
  name         text not null,
  ext          text not null default 'png',
  size         bigint not null default 0,
  sha256       text not null,
  storage_path text not null,
  -- The file this item was expanded out of: a PDF's rendered page, say. The
  -- note attaches the source, never the part.
  source       jsonb,
  status       text not null default 'pending',  -- pending|ocr_done|merged|duplicate|failed
  ocr          jsonb,
  embedding    vector(1536),
  note_id      uuid references public.notes(id) on delete set null,
  attempts     int  not null default 0,
  error        text,
  created_at   timestamptz not null default now()
);

create index if not exists notes_user_idx        on public.notes(user_id);
create index if not exists docs_note_idx         on public.docs(note_id);
create index if not exists docs_sha_idx          on public.docs(user_id, sha256);
create index if not exists items_batch_idx       on public.ingest_items(batch_id, idx);
create index if not exists items_sha_idx         on public.ingest_items(user_id, sha256);
create index if not exists items_source_sha_idx  on public.ingest_items((source->>'sha256'));
create index if not exists notes_embedding_idx   on public.notes using hnsw (embedding vector_cosine_ops);
create index if not exists tags_embedding_idx    on public.tags  using hnsw (embedding vector_cosine_ops);

-- ── RLS ─────────────────────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['notes','docs','tags','ingest_batches','ingest_items'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists owner_all on public.%I', t);
    execute format(
      'create policy owner_all on public.%I for all to anon, authenticated
         using (user_id = public.current_user_id())
         with check (user_id = public.current_user_id())', t);
  end loop;
end $$;

-- No policies: nothing reaches this table through the API.
alter table public.app_config enable row level security;

-- ── Privileges ──────────────────────────────────────────────────────────────
-- RLS decides which ROWS a role may touch; it cannot grant access to the table
-- in the first place, and Supabase's default privileges on new tables are
-- REFERENCES/TRIGGER/TRUNCATE only. Without this, every request fails with
-- "permission denied for table notes" before a policy is ever consulted.
-- Least privilege, and no DELETE anywhere: nothing in the app deletes.
grant usage on schema public to anon, authenticated, service_role;

-- The browser, through PostgREST. Rows stay fenced off by owner_all.
grant select, insert, update on public.notes          to anon, authenticated;
grant select, insert, update on public.docs           to anon, authenticated;
-- The ingest function acts as the caller, so planning a batch is the caller's
-- write. Items are only read back and inserted from there.
grant select, insert, update on public.ingest_batches to anon, authenticated;
grant select, insert         on public.ingest_items   to anon, authenticated;

-- The worker. Bypasses RLS, so this is the whole of its reach.
grant select, insert, update on
  public.notes, public.docs, public.tags,
  public.ingest_batches, public.ingest_items
  to service_role;

-- ── Storage ─────────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public)
values ('uploads', 'uploads', false)
on conflict (id) do nothing;

drop policy if exists uploads_owner on storage.objects;
create policy uploads_owner on storage.objects for all to anon, authenticated
  using (bucket_id = 'uploads' and (storage.foldername(name))[1] = public.current_user_id()::text)
  with check (bucket_id = 'uploads' and (storage.foldername(name))[1] = public.current_user_id()::text);
