-- When a batch last moved. Needed to tell a large batch still grinding through
-- its queue from one whose worker died: both sit in 'processing' with every item
-- read, and only the clock separates them.

alter table public.ingest_batches
  add column if not exists updated_at timestamptz not null default now();

-- Before the trigger exists, or it would stamp now() over the backfill. A batch
-- that was already abandoned must read as stale immediately rather than looking
-- busy for one more cutoff.
update public.ingest_batches set updated_at = created_at where updated_at > created_at;

-- A trigger rather than touching every writer: batch_progress, the ingest
-- function and finalize all set status, and all of them count as activity.
create or replace function public.touch_updated_at() returns trigger
  language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists ingest_batches_touch on public.ingest_batches;
create trigger ingest_batches_touch before update on public.ingest_batches
  for each row execute function public.touch_updated_at();

-- ── Recovering batches stranded before finalize.ts could take a claim over ──
-- A worker that died mid-finalisation left the row at 'finalizing'; the
-- redelivered message then found nothing to claim, returned quietly and was
-- deleted. Nothing will ever move those batches again.
--
-- The queue says which ones exactly, so no timeout has to guess: pgmq.read only
-- postpones a message's visibility, it does not remove it, so a batch with no
-- row in q_pivot has nothing coming for it. 'pending' batches are excluded —
-- those have not been committed yet and are still uploading.
create temp table _stranded as
  select b.id, b.user_id, b.status from public.ingest_batches b
   where b.status in ('processing', 'finalizing')
     and not exists (select 1 from pgmq.q_pivot q where q.message ->> 'batchId' = b.id::text);

-- Hand the claim back so the ordinary path picks it up, rather than relying on
-- the staleness takeover and burning redeliveries to get there.
update public.ingest_batches set status = 'processing'
 where id in (select id from _stranded where status = 'finalizing');

-- Their transcriptions are already stored and paid for, so requeue the work
-- rather than failing the batch and making the files worth re-ingesting: any
-- item that never finished reading, then finalisation for the rest.
select pgmq.send('pivot', jsonb_build_object(
         'kind', 'ocr', 'itemId', i.id, 'batchId', s.id, 'userId', s.user_id))
  from _stranded s join public.ingest_items i on i.batch_id = s.id and i.status = 'pending';

select pgmq.send('pivot', jsonb_build_object(
         'kind', 'finalize', 'batchId', s.id, 'userId', s.user_id))
  from _stranded s
 where not exists (
   select 1 from public.ingest_items i where i.batch_id = s.id and i.status = 'pending');

drop table _stranded;
