-- Queue + vector-search RPCs. Edge functions reach these through PostgREST with
-- the service role, so everything here takes an explicit user id: the service
-- role bypasses RLS and must never be trusted to scope itself.

select pgmq.create('pivot') where not exists (
  select 1 from pg_tables where schemaname = 'pgmq' and tablename = 'q_pivot'
);

-- ── Queue wrappers ──────────────────────────────────────────────────────────
-- Takes a single JSON array rather than jsonb[]: PostgREST passes JSON, and an
-- array-of-jsonb parameter does not round-trip through it dependably.
create or replace function public.queue_send(msgs jsonb)
  returns setof bigint language sql security definer set search_path = public, pgmq as $$
  select pgmq.send_batch('pivot', array(select jsonb_array_elements(msgs)))
$$;

create or replace function public.queue_read(qty int, vt int default 120)
  returns table (msg_id bigint, read_ct int, message jsonb)
  language sql security definer set search_path = public, pgmq as $$
  select msg_id, read_ct, message from pgmq.read('pivot', vt, qty)
$$;

create or replace function public.queue_delete(ids bigint[])
  returns setof bigint language sql security definer set search_path = public, pgmq as $$
  select pgmq.delete('pivot', ids)
$$;

-- ── Vector search ───────────────────────────────────────────────────────────
create or replace function public.match_notes(
  p_user_id uuid, query_embedding vector(1536), match_count int default 2
) returns table (id uuid, title text, content text, similarity float)
  language sql stable security definer set search_path = public, extensions as $$
  select n.id, n.title, n.content, 1 - (n.embedding <=> query_embedding)
  from public.notes n
  where n.user_id = p_user_id and n.embedding is not null
  order by n.embedding <=> query_embedding
  limit match_count
$$;

create or replace function public.match_tags(
  p_user_id uuid, query_embedding vector(1536),
  threshold float default 0.78, match_count int default 5
) returns table (name text, similarity float)
  language sql stable security definer set search_path = public, extensions as $$
  select t.name, 1 - (t.embedding <=> query_embedding)
  from public.tags t
  where t.user_id = p_user_id and t.embedding is not null
    and 1 - (t.embedding <=> query_embedding) >= threshold
  order by t.embedding <=> query_embedding
  limit match_count
$$;

-- ── Batch progress ──────────────────────────────────────────────────────────
-- Atomic so the last OCR to land is the one — and the only one — that reports
-- the batch ready to finalise.
create or replace function public.batch_progress(p_batch_id uuid, p_failed boolean)
  returns boolean language plpgsql security definer set search_path = public as $$
declare b public.ingest_batches;
begin
  update public.ingest_batches
     set done   = done   + (case when p_failed then 0 else 1 end),
         failed = failed + (case when p_failed then 1 else 0 end),
         status = 'processing'
   where id = p_batch_id
  returning * into b;
  return b.done + b.failed >= b.total;
end $$;

revoke all on function public.queue_send(jsonb)            from public, anon, authenticated;
revoke all on function public.queue_read(int, int)         from public, anon, authenticated;
revoke all on function public.queue_delete(bigint[])       from public, anon, authenticated;
revoke all on function public.batch_progress(uuid, boolean) from public, anon, authenticated;
grant execute on function public.queue_send(jsonb)             to service_role;
grant execute on function public.queue_read(int, int)          to service_role;
grant execute on function public.queue_delete(bigint[])        to service_role;
grant execute on function public.batch_progress(uuid, boolean) to service_role;
grant execute on function public.match_notes(uuid, vector, int)                to service_role;
grant execute on function public.match_tags(uuid, vector, float, int)          to service_role;

-- The frontend needs its own id to build storage paths. With auth off that id
-- lives only in the database, so it is asked for rather than configured twice.
create or replace function public.whoami() returns uuid
  language sql stable as $$ select public.current_user_id() $$;
grant execute on function public.whoami() to anon, authenticated;

-- Realtime: the UI refetches when the worker lands a note, so a 200-image
-- batch fills the graph as it goes instead of on the next reload.
do $$
declare t text;
begin
  foreach t in array array['notes','docs','ingest_batches'] loop
    if not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
