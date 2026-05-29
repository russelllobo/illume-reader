create table if not exists public.instagram_dashboard_connection (
  id text primary key default 'owner',
  access_token text not null,
  expires_at timestamptz,
  instagram_user_id text,
  username text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.instagram_dashboard_connection enable row level security;
