alter table public.books
  add column if not exists page_count integer,
  add column if not exists pdf_toc jsonb not null default '[]'::jsonb,
  add column if not exists pdf_page_metrics jsonb not null default '[]'::jsonb,
  add column if not exists processing_status text not null default 'ready',
  add column if not exists processing_error text,
  add column if not exists processing_started_at timestamptz,
  add column if not exists processed_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'books_page_count_positive'
      and conrelid = to_regclass('public.books')
  ) then
    alter table public.books
      add constraint books_page_count_positive check (page_count is null or page_count > 0);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'books_processing_status_check'
      and conrelid = to_regclass('public.books')
  ) then
    alter table public.books
      add constraint books_processing_status_check check (
        processing_status in ('ready', 'queued', 'processing', 'processed', 'failed')
      );
  end if;
end $$;

update public.books
set processing_status = 'queued'
where document_type = 'pdf'
  and processing_status = 'ready';

create table if not exists public.book_pages (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.books(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  page_number integer not null,
  text text not null default '',
  word_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint book_pages_page_number_positive check (page_number > 0),
  constraint book_pages_word_count_nonnegative check (word_count >= 0),
  constraint book_pages_book_page_unique unique (book_id, page_number)
);

create index if not exists book_pages_user_book_page_idx
  on public.book_pages (user_id, book_id, page_number);

alter table public.book_pages enable row level security;

drop policy if exists "Users can select their own book pages" on public.book_pages;
drop policy if exists "Users can insert their own book pages" on public.book_pages;
drop policy if exists "Users can update their own book pages" on public.book_pages;
drop policy if exists "Users can delete their own book pages" on public.book_pages;

create policy "Users can select their own book pages"
  on public.book_pages
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can insert their own book pages"
  on public.book_pages
  for insert
  to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1
      from public.books
      where books.id = book_pages.book_id
        and books.user_id = (select auth.uid())
    )
  );

create policy "Users can update their own book pages"
  on public.book_pages
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1
      from public.books
      where books.id = book_pages.book_id
        and books.user_id = (select auth.uid())
    )
  );

create policy "Users can delete their own book pages"
  on public.book_pages
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);

drop trigger if exists book_pages_set_updated_at on public.book_pages;
create trigger book_pages_set_updated_at
  before update on public.book_pages
  for each row execute function public.set_updated_at();
