-- Cache Muse Spark image prompts per book section so image generation can
-- skip the prompt-writing step on cache hits and pre-warm prompts at upload.
create table if not exists public.reader_image_prompts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  book_id uuid not null references public.books(id) on delete cascade,
  style text not null default 'cartoon' check (style in ('cartoon', 'cute')),
  start_word integer not null check (start_word > 0),
  end_word integer not null check (end_word >= start_word),
  prompt text not null,
  prompt_source text not null default 'muse-spark',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (book_id, start_word, end_word, style)
);
alter table public.reader_image_prompts enable row level security;
drop policy if exists "Users can view their own reader image prompts" on public.reader_image_prompts;
create policy "Users can view their own reader image prompts"
  on public.reader_image_prompts
  for select
  to authenticated
  using ((select auth.uid()) = user_id);
drop trigger if exists reader_image_prompts_set_updated_at on public.reader_image_prompts;
create trigger reader_image_prompts_set_updated_at
  before update on public.reader_image_prompts
  for each row execute function public.set_updated_at();
create index if not exists reader_image_prompts_user_book_style_idx
  on public.reader_image_prompts (user_id, book_id, style);
grant select on public.reader_image_prompts to authenticated;
