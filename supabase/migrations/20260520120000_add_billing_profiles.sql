create table if not exists public.billing_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  stripe_customer_id text unique,
  stripe_subscription_id text unique,
  stripe_price_id text,
  plan text not null default 'free' check (plan in ('free', 'pro')),
  status text not null default 'inactive',
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
alter table public.billing_profiles enable row level security;
drop policy if exists "Users can view their own billing profile" on public.billing_profiles;
create policy "Users can view their own billing profile"
  on public.billing_profiles
  for select
  to authenticated
  using (auth.uid() = user_id);
drop trigger if exists billing_profiles_set_updated_at on public.billing_profiles;
create trigger billing_profiles_set_updated_at
  before update on public.billing_profiles
  for each row execute function public.set_updated_at();
