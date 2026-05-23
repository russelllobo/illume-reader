alter table public.reader_images
  add column if not exists style text not null default 'cartoon';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'reader_images_style_check'
      and conrelid = 'public.reader_images'::regclass
  ) then
    alter table public.reader_images
      add constraint reader_images_style_check check (style in ('cartoon', 'cute'));
  end if;
end $$;

alter table public.reader_images
  drop constraint if exists reader_images_book_id_start_word_end_word_key;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'reader_images_book_id_start_word_end_word_style_key'
      and conrelid = 'public.reader_images'::regclass
  ) then
    alter table public.reader_images
      add constraint reader_images_book_id_start_word_end_word_style_key
      unique (book_id, start_word, end_word, style);
  end if;
end $$;

create index if not exists reader_images_user_book_style_idx
  on public.reader_images (user_id, book_id, style);
