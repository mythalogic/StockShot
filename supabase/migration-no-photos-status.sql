-- StockShot migration: add "no photos available" status
-- Run once in Supabase Dashboard → SQL Editor (existing projects only;
-- fresh installs get this from schema.sql)

alter table public.captures drop constraint if exists captures_status_check;
alter table public.captures add constraint captures_status_check
  check (status in ('not_started', 'partial', 'done', 'no_image'));

-- Allow signed-in users to delete photos (needed for the Delete button)
drop policy if exists "captures bucket delete" on storage.objects;
create policy "captures bucket delete"
  on storage.objects for delete to authenticated
  using (bucket_id = 'captures');
