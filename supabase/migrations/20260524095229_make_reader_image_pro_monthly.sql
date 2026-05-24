alter table public.reader_image_usage
  add column if not exists monthly_generated_count integer not null default 0 check (monthly_generated_count >= 0),
  add column if not exists monthly_period_start date not null default date_trunc('month', now())::date;

update public.reader_image_usage usage
set
  monthly_generated_count = monthly_counts.generated_count,
  monthly_period_start = date_trunc('month', now())::date,
  updated_at = now()
from (
  select user_id, count(*)::integer as generated_count
  from public.reader_images
  where created_at >= date_trunc('month', now())
  group by user_id
) monthly_counts
where usage.user_id = monthly_counts.user_id;

drop function if exists public.reserve_reader_image_generation(uuid, integer);
drop function if exists public.refund_reader_image_generation(uuid);

create or replace function public.reserve_reader_image_generation(
  p_user_id uuid,
  p_image_limit integer,
  p_resets_monthly boolean default false,
  p_period_start date default date_trunc('month', now())::date
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

  insert into public.reader_image_usage (
    user_id,
    generated_count,
    monthly_generated_count,
    monthly_period_start
  )
  values (p_user_id, 0, 0, p_period_start)
  on conflict (user_id) do nothing;

  if p_resets_monthly then
    update public.reader_image_usage
    set
      monthly_generated_count = case
        when monthly_period_start = p_period_start then monthly_generated_count
        else 0
      end,
      monthly_period_start = p_period_start
    where user_id = p_user_id;

    update public.reader_image_usage
    set
      generated_count = public.reader_image_usage.generated_count + 1,
      monthly_generated_count = public.reader_image_usage.monthly_generated_count + 1
    where user_id = p_user_id
      and public.reader_image_usage.monthly_period_start = p_period_start
      and public.reader_image_usage.monthly_generated_count < p_image_limit
    returning public.reader_image_usage.monthly_generated_count
    into generated_count;

    if generated_count is null then
      select public.reader_image_usage.monthly_generated_count
      into generated_count
      from public.reader_image_usage
      where user_id = p_user_id;

      return query select coalesce(generated_count, 0), p_image_limit, false;
      return;
    end if;

    return query select generated_count, p_image_limit, true;
    return;
  end if;

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

create or replace function public.refund_reader_image_generation(
  p_user_id uuid,
  p_resets_monthly boolean default false,
  p_period_start date default date_trunc('month', now())::date
)
returns integer
language plpgsql
set search_path = public
as $$
declare
  v_generated_count integer;
begin
  if p_resets_monthly then
    update public.reader_image_usage
    set
      generated_count = greatest(public.reader_image_usage.generated_count - 1, 0),
      monthly_generated_count = case
        when public.reader_image_usage.monthly_period_start = p_period_start
          then greatest(public.reader_image_usage.monthly_generated_count - 1, 0)
        else 0
      end,
      monthly_period_start = p_period_start
    where user_id = p_user_id
    returning public.reader_image_usage.monthly_generated_count into v_generated_count;

    return coalesce(v_generated_count, 0);
  end if;

  update public.reader_image_usage
  set generated_count = greatest(public.reader_image_usage.generated_count - 1, 0)
  where user_id = p_user_id
  returning public.reader_image_usage.generated_count into v_generated_count;

  return coalesce(v_generated_count, 0);
end;
$$;

revoke all on function public.reserve_reader_image_generation(uuid, integer, boolean, date) from public, anon, authenticated;
revoke all on function public.refund_reader_image_generation(uuid, boolean, date) from public, anon, authenticated;
grant execute on function public.reserve_reader_image_generation(uuid, integer, boolean, date) to service_role;
grant execute on function public.refund_reader_image_generation(uuid, boolean, date) to service_role;
