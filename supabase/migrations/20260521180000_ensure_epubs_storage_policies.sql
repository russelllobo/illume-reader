-- Ensure the 'epubs' storage bucket exists
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('epubs', 'epubs', false, 104857600, array['application/epub+zip'])
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
-- Drop existing storage policies for epubs bucket to avoid conflicts
drop policy if exists "Users can read their own EPUB files" on storage.objects;
drop policy if exists "Users can upload their EPUB files" on storage.objects;
drop policy if exists "Users can update their EPUB files" on storage.objects;
drop policy if exists "Users can delete their EPUB files" on storage.objects;
-- Create secure per-user storage policies
create policy "Users can read their own EPUB files"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'epubs'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
create policy "Users can upload their EPUB files"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'epubs'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and lower(storage.extension(name)) = 'epub'
  );
create policy "Users can update their EPUB files"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'epubs'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'epubs'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and lower(storage.extension(name)) = 'epub'
  );
create policy "Users can delete their EPUB files"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'epubs'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
