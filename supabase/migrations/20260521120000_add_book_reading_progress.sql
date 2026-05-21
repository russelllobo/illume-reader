alter table if exists public.books
  add column if not exists current_index integer;

do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'books'
  ) then
    update public.books
    set current_index = 0
    where current_index is null;
  end if;
end $$;

alter table if exists public.books
  alter column current_index set default 0,
  alter column current_index set not null;

do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'books'
  ) and not exists (
    select 1
    from pg_constraint
    where conname = 'books_current_index_nonnegative'
      and conrelid = to_regclass('public.books')
  ) then
    alter table public.books
      add constraint books_current_index_nonnegative check (current_index >= 0);
  end if;
end $$;

alter table if exists public.books
  add column if not exists last_opened_at timestamptz;

do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'books'
  ) then
    create index if not exists books_last_opened_at_idx
      on public.books (user_id, last_opened_at desc);
  end if;
end $$;
