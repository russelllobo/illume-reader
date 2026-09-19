-- Base books table. The original project created this table manually, so later
-- migrations only altered it. This migration reconstructs it for fresh projects.
create table if not exists public.books (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default '',
  author text not null default '',
  cover_url text,
  document_type text not null default 'epub',
  storage_path text not null,
  file_name text,
  file_size bigint,
  mime_type text,
  page_count integer,
  paragraph_count integer not null default 0,
  chapter_count integer not null default 0,
  pdf_page_metrics jsonb not null default '[]'::jsonb,
  pdf_toc jsonb not null default '[]'::jsonb,
  processing_status text not null default 'ready',
  processing_started_at timestamptz,
  processed_at timestamptz,
  processing_error text,
  current_index integer not null default 0,
  current_page integer not null default 1,
  last_opened_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint books_current_index_nonnegative check (current_index >= 0),
  constraint books_document_type_check check (document_type in ('epub', 'pdf')),
  constraint books_current_page_positive check (current_page > 0),
  constraint books_page_count_positive check (page_count is null or page_count > 0),
  constraint books_processing_status_check check (
    processing_status in ('ready', 'queued', 'processing', 'processed', 'failed')
  )
);

create index if not exists books_user_id_idx on public.books (user_id);

do $$
begin
  if exists (
    select 1 from pg_proc where proname = 'set_updated_at'
  ) and not exists (
    select 1 from pg_trigger where tgname = 'books_set_updated_at'
  ) then
    create trigger books_set_updated_at
      before update on public.books
      for each row execute function public.set_updated_at();
  end if;
end $$;
