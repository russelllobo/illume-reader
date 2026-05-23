alter table public.books
  add column if not exists document_type text not null default 'epub',
  add column if not exists current_page integer not null default 1;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'books_document_type_check'
      and conrelid = to_regclass('public.books')
  ) then
    alter table public.books
      add constraint books_document_type_check check (document_type in ('epub', 'pdf'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'books_current_page_positive'
      and conrelid = to_regclass('public.books')
  ) then
    alter table public.books
      add constraint books_current_page_positive check (current_page > 0);
  end if;
end $$;

update public.books
set document_type = 'pdf'
where mime_type = 'application/pdf'
   or lower(file_name) like '%.pdf';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('epubs', 'epubs', false, 104857600, array['application/epub+zip', 'application/pdf'])
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Users can upload their EPUB files" on storage.objects;
drop policy if exists "Users can update their EPUB files" on storage.objects;
drop policy if exists "Users can upload their EPUB and PDF files" on storage.objects;
drop policy if exists "Users can update their EPUB and PDF files" on storage.objects;

create policy "Users can upload their EPUB and PDF files"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'epubs'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and lower(storage.extension(name)) in ('epub', 'pdf')
  );

create policy "Users can update their EPUB and PDF files"
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
    and lower(storage.extension(name)) in ('epub', 'pdf')
  );
