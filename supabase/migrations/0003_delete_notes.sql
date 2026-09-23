-- Deleting a note from the app. owner_all is `for all`, so RLS already fences
-- the rows; 0001 simply withheld the privilege because nothing deleted then.
-- docs rows cascade and ingest_items.note_id goes null, both by the FKs in
-- 0001. Uploaded files stay in storage: they are content-addressed and may be
-- attached to another note.
grant delete on public.notes to anon, authenticated;
