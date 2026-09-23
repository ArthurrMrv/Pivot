-- A tag with nothing left pointing at it is dead weight. The graph derives its
-- `#` nodes from notes.content, so deleting a note already removes them there;
-- this prunes the matching row from the tags registry, which is read back as a
-- canonicalisation candidate and would otherwise steer new tags onto a name no
-- note carries any more.
--
-- security definer: the trigger must delete tag rows that the caller has no
-- DELETE privilege on. Scoped to the departing note's owner, never wider.
create or replace function public.prune_orphan_tags() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  -- ponytail: one scan of the user's notes per deleted note. Fine at this size;
  -- index notes.content or prune on a schedule if deletes ever go bulk.
  delete from public.tags t
   where t.user_id = old.user_id
     and not exists (
       select 1 from public.notes n
        where n.user_id = t.user_id
          and n.content ~* ('(^|[^[:alnum:]_])#' || t.name || '([^[:alnum:]_-]|$)')
     );
  return old;
end $$;

-- Delete only: content updates run on every edit, and a regex scan per
-- keystroke costs more than a stale registry row.
drop trigger if exists notes_prune_tags on public.notes;
create trigger notes_prune_tags after delete on public.notes
  for each row execute function public.prune_orphan_tags();

revoke all on function public.prune_orphan_tags() from public, anon, authenticated;
