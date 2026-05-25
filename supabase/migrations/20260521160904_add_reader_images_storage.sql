insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('reader-images', 'reader-images', false, 10485760, array['image/webp'])
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
create table if not exists public.reader_images (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  book_id uuid not null references public.books(id) on delete cascade,
  start_word integer not null check (start_word > 0),
  end_word integer not null check (end_word >= start_word),
  storage_path text not null unique,
  prompt text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (book_id, start_word, end_word)
);
alter table public.reader_images enable row level security;
drop policy if exists "Users can view their own reader images" on public.reader_images;
create policy "Users can view their own reader images"
  on public.reader_images
  for select
  to authenticated
  using ((select auth.uid()) = user_id);
drop trigger if exists reader_images_set_updated_at on public.reader_images;
create trigger reader_images_set_updated_at
  before update on public.reader_images
  for each row execute function public.set_updated_at();
create index if not exists reader_images_user_created_at_idx
  on public.reader_images (user_id, created_at desc);
grant select on public.reader_images to authenticated;
drop policy if exists "Users can view their own billing profile" on public.billing_profiles;
create policy "Users can view their own billing profile"
  on public.billing_profiles
  for select
  to authenticated
  using ((select auth.uid()) = user_id);
drop policy if exists "Users can read their own generated reader images" on storage.objects;
create policy "Users can read their own generated reader images"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'reader-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
