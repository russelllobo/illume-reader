insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('reels', 'reels', true, 52428800, array['video/mp4'])
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Users can upload their own reels" on storage.objects;
create policy "Users can upload their own reels"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'reels'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "Users can update their own reels" on storage.objects;
create policy "Users can update their own reels"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'reels'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'reels'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "Users can delete their own reels" on storage.objects;
create policy "Users can delete their own reels"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'reels'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
