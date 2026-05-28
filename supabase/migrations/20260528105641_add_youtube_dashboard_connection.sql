create table if not exists public.youtube_dashboard_connection (
  id text primary key default 'owner',
  channel_handle text not null default '@ilumereader',
  refresh_token text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.youtube_dashboard_connection enable row level security;
