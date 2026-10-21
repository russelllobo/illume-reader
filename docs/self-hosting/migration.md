# Move Illume onto this computer

## Acceptance

The migration is complete when the public web app runs from this computer, no runtime requests or packages depend on Supabase, all existing account IDs, password hashes, books, progress, billing records, quotas, provider connections, and stored files survive, and the running app passes the checks below. Production remains on the existing service until those checks pass.

## Architecture

Use plain PostgreSQL 17, a Node API and worker, and private files on local disk. Serve the built web app alongside the API. Cloudflare provides the public HTTPS connection to this host. Existing image, speech, payment, OAuth, and social providers remain external services.

The PostgreSQL design from candidate A is the base. It preserves the source database's UUID, JSON, constraint, and transaction semantics. Candidate B contributes operation IDs for quota refunds, durable file publication and cleanup, webhook deduplication, and an explicit fence against old-client writes. SQLite saves a database container but requires translating every database invariant. The source is already PostgreSQL, and the host has enough memory for a small instance.

Use application operations in the web and mobile clients. Authenticate at the HTTP boundary and require user ownership for every book, file, page, and image operation. Keep provider algorithms from the existing functions, replacing their database, authentication, and storage calls with local modules. Preserve response shapes where the reader depends on them.

Browser sessions use HttpOnly cookies. Native sessions use revocable tokens stored as hashes. Imported bcrypt passwords keep working; OAuth subjects map to their original account IDs. Never accept an unsigned old token or identify an OAuth account solely by an unverified email.

## Sequence and gates

1. Export the source privately. Record every table and object, sizes, hashes, and account identities. This first export is a rehearsal while production accepts writes, not the final consistent snapshot.
2. Import into a separate local database. Preserve original values and foreign keys. Verify every row and object against the rehearsal manifest. Keep orphaned historical files in the archive.
3. Build authentication, authorized library operations, private storage, and durable jobs. Verify password sign-in, two-user isolation, upload, download, progress persistence, PDF processing, and process restart.
4. Port all 19 backend functions and the Vite-only reel endpoints. Verify cached and generated images, quota concurrency and refunds, narration, owner dashboard, and provider adapters. Publishing to social accounts requires a separate explicit instruction.
5. Update web and mobile clients to the application API. Verify the browser against the local server, inspect screenshots, and scan built runtime files for Supabase dependencies.
6. Install persistent services, the HTTPS tunnel, backups, and health checks. Restore a backup into an isolated instance and compare files and database records.
7. Enter a short maintenance window, block old-client writes, take a final export, import and verify it, then switch the domain and callbacks. Reopen writes only after the public checks pass.

Before local writes begin, routing traffic back to the hosted app restores the old service. After local writes begin, recovery must preserve the new database rather than reverting to stale hosted data. Deleting the hosted project is a separate destructive action after acceptance.

## Current evidence

The source has 24 users, 30 books, 163 saved images, and 590 storage objects totaling about 487 MB. The computer has about 37 GB free disk and 6 GB available memory. The private rehearsal export is at `/home/lobo/.local/share/illume-reader/migration/2026-10-12`.

The repeatable exporter is `scripts/export-hosted-data.py`. The initial dependency inventory is `artifacts/self-hosting/baseline.json`. Decisions are recorded in `docs/self-hosting/decisions.tsv`.

Public DNS was failing through Tailscale. Disabling Tailscale DNS via its authorized operator restored domain resolution. Cloudflare Pages currently serves `illumereader.com` and `www.illumereader.com` from project `reader`. The saved Cloudflare login can manage the Pages project and tunnels but has not demonstrated DNS edit permission.

Password and identity export follows the source's [account migration documentation](https://supabase.com/docs/guides/troubleshooting/migrating-auth-users-between-projects). Database backup and restoration follow [PostgreSQL backup guidance](https://www.postgresql.org/docs/17/backup-dump.html).
