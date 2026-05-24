# Reader Library

A Supabase-backed EPUB/PDF reader with per-user login, a synced catalogue, private document storage, reading progress sync, browser text-to-speech, and optional AI image mode.

## Run locally

```bash
npm install
npm run dev
```

Open the Vite URL, usually `http://localhost:5173`.

## Supabase

The app expects these Vite environment variables:

```bash
VITE_SUPABASE_URL=
VITE_SUPABASE_PUBLISHABLE_KEY=
VITE_USER_STORAGE_QUOTA_BYTES=104857600
```

The current quota is set to 100 MB per user for Supabase free-tier testing. Use `2147483648` for a 2 GB per-user quota after moving to a paid storage plan.

Image mode uses a Supabase Edge Function so the OpenAI key stays server-side. It stores generated images in the private `reader-images` storage bucket and records metadata in `public.reader_images` so future reads reuse existing images before calling OpenAI again. Free users can generate 25 lifetime images; Pro users get 100 images per month. Lifetime and monthly usage are tracked in `public.reader_image_usage`.

Set this function secret:

```bash
supabase secrets set OPENAI_API_KEY=sk-...
```

Deploy the reader Edge Functions:

```bash
supabase functions deploy generate-reader-image
supabase functions deploy delete-reader-book
supabase functions deploy reader-dashboard
```

## Owner dashboard

The owner dashboard is available when the app is served from `https://russell.systems` or at `/dashboard`.
It requires Google authentication and only allows `r.lobo2003@gmail.com`. The dashboard uses the
`reader-dashboard` Edge Function to read aggregate user, book, generated image, and Supabase Storage usage
without exposing privileged database access to the browser.

The database migrations create:

- `public.books`
- `public.billing_profiles`
- `public.reader_image_usage`
- a private `epubs` storage bucket for EPUB and PDF uploads
- RLS policies for per-user book rows and files

## Stripe Billing

The app includes a Pro subscription checkout flow backed by Supabase Edge Functions. Pro status is stored in `public.billing_profiles` and raises the image generation limit from 25 lifetime images to 100 images per month.

The current Stripe Pro product and price are:

```text
Product: Illume Pro (prod_UYCCYmewCaj2oE)
Price: price_1TZ5v9LZ9T22BHizLUFDsKjM (£12.99/month)
```

Set these Supabase Edge Function secrets:

```bash
supabase secrets set \
  STRIPE_SECRET_KEY=sk_... \
  STRIPE_PRO_PRICE_ID=price_1TZ5v9LZ9T22BHizLUFDsKjM \
  STRIPE_WEBHOOK_SECRET=whsec_... \
  SITE_URL=https://illume.russell.systems
```

Deploy the functions:

```bash
supabase functions deploy create-checkout-session
supabase functions deploy create-billing-portal
supabase functions deploy stripe-webhook --no-verify-jwt
```

In Stripe, point a webhook endpoint at:

```text
https://<project-ref>.supabase.co/functions/v1/stripe-webhook
```

Subscribe it to `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, and `customer.subscription.deleted`.

## Production checklist

- Add the production domain to Supabase Auth redirect URLs.
- Keep `SITE_URL` set to the production app URL before deploying live billing.
- Configure email templates or SMTP before inviting real users.
- Raise the app and database quota constants when storage capacity is available.
- Add Terms and Privacy pages before public launch.
