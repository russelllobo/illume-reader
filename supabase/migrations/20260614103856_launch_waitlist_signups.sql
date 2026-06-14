create table if not exists public.launch_waitlist_signups (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  normalized_email text generated always as (lower(btrim(email))) stored,
  source text not null default 'landing_mobile_tablet',
  launch_context jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint launch_waitlist_signups_email_not_blank check (length(btrim(email)) between 3 and 320),
  constraint launch_waitlist_signups_email_shape check (btrim(email) ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  constraint launch_waitlist_signups_source_not_blank check (length(btrim(source)) between 1 and 80)
);

create unique index if not exists launch_waitlist_signups_normalized_email_key
  on public.launch_waitlist_signups (normalized_email);

alter table public.launch_waitlist_signups enable row level security;

revoke all on table public.launch_waitlist_signups from anon, authenticated;
grant insert on table public.launch_waitlist_signups to anon, authenticated;
grant select, insert, update, delete on table public.launch_waitlist_signups to service_role;

drop policy if exists "Anyone can join the launch waitlist" on public.launch_waitlist_signups;
create policy "Anyone can join the launch waitlist"
  on public.launch_waitlist_signups
  for insert
  to anon, authenticated
  with check (true);
