create table if not exists public.tiktok_dashboard_connection (
  id text primary key default 'owner',
  access_token text not null,
  refresh_token text,
  expires_at timestamptz,
  refresh_expires_at timestamptz,
  open_id text,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.tiktok_dashboard_connection enable row level security;

grant select, insert, update, delete on table public.tiktok_dashboard_connection to service_role;
