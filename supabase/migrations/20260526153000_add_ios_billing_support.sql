alter table public.billing_profiles
  add column if not exists apple_original_transaction_id text unique,
  add column if not exists apple_transaction_id text,
  add column if not exists apple_product_id text,
  add column if not exists apple_environment text,
  add column if not exists apple_purchase_date timestamptz,
  add column if not exists apple_expires_at timestamptz,
  add column if not exists apple_revocation_date timestamptz,
  add column if not exists apple_last_signed_transaction_info text,
  add column if not exists apple_last_notification_type text,
  add column if not exists apple_last_notification_subtype text;

create index if not exists billing_profiles_apple_original_transaction_idx
  on public.billing_profiles (apple_original_transaction_id)
  where apple_original_transaction_id is not null;

create index if not exists billing_profiles_apple_product_idx
  on public.billing_profiles (apple_product_id, apple_environment)
  where apple_product_id is not null;
