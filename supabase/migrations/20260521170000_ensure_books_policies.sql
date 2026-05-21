-- Ensure RLS is enabled on books table
alter table public.books enable row level security;

-- Drop existing policies if any to avoid conflicts
drop policy if exists "Users can select their own books" on public.books;
drop policy if exists "Users can insert their own books" on public.books;
drop policy if exists "Users can update their own books" on public.books;
drop policy if exists "Users can delete their own books" on public.books;

-- Create robust policies
create policy "Users can select their own books"
  on public.books
  for select
  to authenticated
  using (auth.uid() = user_id);

create policy "Users can insert their own books"
  on public.books
  for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "Users can update their own books"
  on public.books
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete their own books"
  on public.books
  for delete
  to authenticated
  using (auth.uid() = user_id);
