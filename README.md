# Reader Library

A Supabase-backed EPUB reader with per-user login, a synced catalogue, private EPUB storage, reading progress sync, and browser text-to-speech.

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

The database migration creates:

- `public.books`
- a private `epubs` storage bucket
- RLS policies for per-user book rows and files

## Production checklist

- Add the production domain to Supabase Auth redirect URLs.
- Configure email templates or SMTP before inviting real users.
- Raise the app and database quota constants when storage capacity is available.
- Add Terms and Privacy pages before public launch.

