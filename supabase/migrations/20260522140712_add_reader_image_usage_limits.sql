create table if not exists public.reader_image_usage (
  user_id uuid primary key references auth.users(id) on delete cascade,
  generated_count integer not null default 0 check (generated_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.reader_image_usage enable row level security;
insert into public.reader_image_usage (user_id, generated_count)
select user_id, count(*)::integer
from public.reader_images
group by user_id
on conflict (user_id) do update
set
  generated_count = greatest(public.reader_image_usage.generated_count, excluded.generated_count),
  updated_at = now();
drop policy if exists "Users can view their own reader image usage" on public.reader_image_usage;
create policy "Users can view their own reader image usage"
  on public.reader_image_usage
  for select
  to authenticated
  using ((select auth.uid()) = user_id);
drop trigger if exists reader_image_usage_set_updated_at on public.reader_image_usage;
create trigger reader_image_usage_set_updated_at
  before update on public.reader_image_usage
  for each row execute function public.set_updated_at();
grant select on public.reader_image_usage to authenticated;
create or replace function public.reserve_reader_image_generation(
  p_user_id uuid,
  p_image_limit integer
)
returns table (
  generated_count integer,
  image_limit integer,
  allowed boolean
)
language plpgsql
set search_path = public
as $$
begin
  if p_image_limit < 1 then
    raise exception 'Image limit must be positive.';
  end if;

  insert into public.reader_image_usage (user_id, generated_count)
  values (p_user_id, 0)
  on conflict (user_id) do nothing;

  update public.reader_image_usage
  set generated_count = public.reader_image_usage.generated_count + 1
  where user_id = p_user_id
    and public.reader_image_usage.generated_count < p_image_limit
  returning public.reader_image_usage.generated_count
  into generated_count;

  if generated_count is null then
    select public.reader_image_usage.generated_count
    into generated_count
    from public.reader_image_usage
    where user_id = p_user_id;

    return query select coalesce(generated_count, 0), p_image_limit, false;
    return;
  end if;

  return query select generated_count, p_image_limit, true;
end;
$$;
create or replace function public.refund_reader_image_generation(p_user_id uuid)
returns integer
language plpgsql
set search_path = public
as $$
declare
  v_generated_count integer;
begin
  update public.reader_image_usage
  set generated_count = greatest(public.reader_image_usage.generated_count - 1, 0)
  where user_id = p_user_id
  returning public.reader_image_usage.generated_count into v_generated_count;

  return coalesce(v_generated_count, 0);
end;
$$;
revoke all on function public.reserve_reader_image_generation(uuid, integer) from public, anon, authenticated;
revoke all on function public.refund_reader_image_generation(uuid) from public, anon, authenticated;
grant execute on function public.reserve_reader_image_generation(uuid, integer) to service_role;
grant execute on function public.refund_reader_image_generation(uuid) to service_role;
