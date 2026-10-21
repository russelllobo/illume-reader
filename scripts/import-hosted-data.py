#!/usr/bin/env python3
"""Import a hosted-data export directory into an empty local illume database.

Reads an export produced by scripts/export-hosted-data.py (table JSON files,
manifest.json, objects/<bucket>/<name> files) and loads it into the local
PostgreSQL schema (users/identities/object_files/jobs/... in public.*) plus
local file storage under FILES_ROOT/<bucket>/<path>.

Mapping (derived from the rehearsed import, verified against server/*.mjs):
  auth.users    -> public.users(id, email, password_hash=encrypted_password,
                     confirmed_at=email_confirmed_at, banned_until,
                     created_at, last_sign_in_at,
                     user_metadata=raw_user_meta_data,
                     app_metadata=raw_app_meta_data, role, source=full row)
  auth.identities -> public.identities(provider, subject=provider_id,
                     user_id, source=full row)
  public.*       -> same-named local table, verbatim (skips GENERATED columns)
  storage.objects + objects/ files -> FILES_ROOT/<bucket>/<name> and
                     public.object_files(bucket, path=name,
                     user_id=owner when it is a known user id, size and
                     sha256 of the stored bytes, mime_type from object metadata)
Ephemeral/host-only state is NOT imported: auth.sessions/refresh_tokens
(session rows), jobs, image_operations, webhook_events, oauth_attempts,
auth.* and storage.* system tables, migration_rehearsals bookkeeping.

The database schema itself is NOT created here: apply it first with e.g.
  pg_dump -s <reference_db> | psql <target>
(see docs/self-hosting/migration.md step 2).

Safety: refuses to touch a database whose name contains "rehearsal" (unless
--allow-rehearsal), refuses a non-empty target (unless --force), refuses an
incomplete export manifest, and validates path traversal on every object.
Never writes to Supabase; the export directory is only read.
"""
import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import urllib.parse
from pathlib import Path


PUBLIC_TABLES = [
    "billing_profiles",
    "books",
    "book_pages",
    "reader_image_prompts",
    "reader_image_usage",
    "reader_images",
    "instagram_dashboard_connection",
    "tiktok_dashboard_connection",
    "youtube_dashboard_connection",
    "waitlist_signups",
    "launch_waitlist_signups",
]


def parse_database_url(url):
    parts = urllib.parse.urlparse(url)
    if parts.scheme not in ("postgresql", "postgres"):
        raise ValueError("DATABASE_URL must be a postgresql:// URL")
    return {
        "host": parts.hostname or "127.0.0.1",
        "port": str(parts.port or 5432),
        "dbname": (parts.path or "").lstrip("/"),
        "user": urllib.parse.unquote(parts.username or ""),
        "password": urllib.parse.unquote(parts.password or ""),
    }


def psql_base(conn, container):
    if shutil.which("psql"):
        return (["psql", "-h", conn["host"], "-p", conn["port"],
                 "-U", conn["user"], "-d", conn["dbname"]], True)
    if container and shutil.which("docker"):
        return (["docker", "exec", "-i", "-e", "PGPASSWORD", container,
                 "psql", "-U", conn["user"], "-d", conn["dbname"]], False)
    raise RuntimeError("No psql client found (need psql on PATH or docker)")


PSQL_BASE = None


def psql(conn, sql_text, capture=False):
    env = dict(os.environ)
    env["PGPASSWORD"] = conn["password"]
    cmd = list(PSQL_BASE) + ["-v", "ON_ERROR_STOP=1", "-q"]
    if capture:
        cmd += ["-t", "-A"]
    result = subprocess.run(cmd, input=sql_text, capture_output=capture,
                            text=True, env=env)
    if result.returncode != 0:
        raise RuntimeError("psql failed: " + (result.stderr or "")[-2000:])
    return result.stdout if capture else ""


def quote_literal(value):
    tag = "illume"
    while tag in value:
        tag += "x"
    return f"${tag}${value}${tag}$"


def sql_value(value, udt):
    if value is None:
        return "NULL"
    if udt == "bool":
        return "TRUE" if value else "FALSE"
    if udt in ("int2", "int4", "int8", "float4", "float8", "numeric"):
        return str(value)
    if udt == "jsonb":
        return quote_literal(json.dumps(value, ensure_ascii=False)) + "::jsonb"
    return quote_literal(str(value))


def table_columns(conn, table):
    out = psql(conn, "SELECT column_name || '|' || udt_name || '|' || "
                     "coalesce(column_default, '') FROM "
                     "information_schema.columns WHERE table_schema='public' "
                     f"AND table_name='{table}' AND is_generated='NEVER' "
                     "ORDER BY ordinal_position;", capture=True)
    cols = [line.split("|", 2) for line in out.splitlines() if "|" in line]
    if not cols:
        raise RuntimeError(f"Target table public.{table} is missing; apply the schema first")
    return cols


def insert_rows(conn, table, columns, rows):
    names = [name for name, _, _ in columns]
    types = {name: udt for name, udt, _ in columns}
    defaults = {name: default for name, _, default in columns}
    keep = [name for name in names
            if not (defaults[name] and all(row.get(name) is None for row in rows))]
    if not keep:
        raise RuntimeError(f"Nothing to insert into {table}")
    names = keep
    with tempfile.NamedTemporaryFile("w", suffix=".sql", delete=False) as handle:
        path = handle.name
        handle.write("BEGIN;\n")
        batch = []
        for row in rows:
            values = ", ".join(sql_value(row.get(name), types[name]) for name in names)
            batch.append(f"({values})")
            if len(batch) >= 100:
                handle.write(f"INSERT INTO public.\"{table}\" "
                             f"({', '.join(chr(34) + n + chr(34) for n in names)}) VALUES "
                             + ", ".join(batch) + ";\n")
                batch = []
        if batch:
            handle.write(f"INSERT INTO public.\"{table}\" "
                         f"({', '.join(chr(34) + n + chr(34) for n in names)}) VALUES "
                         + ", ".join(batch) + ";\n")
        handle.write("COMMIT;\n")
    try:
        with open(path) as handle:
            psql(conn, handle.read())
    finally:
        os.unlink(path)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--export-dir", type=Path, required=True)
    parser.add_argument("--database-url", default=os.environ.get("DATABASE_URL"))
    parser.add_argument("--files-root", type=Path,
                        default=Path(os.environ.get("FILES_ROOT", "")))
    parser.add_argument("--schema-sql", type=Path, default=None,
                        help="Schema dump to apply to the target first (e.g. pg_dump -s output)")
    parser.add_argument("--force", action="store_true",
                        help="Import even if the target database already holds rows")
    parser.add_argument("--allow-rehearsal", action="store_true",
                        help="Permit a target database with 'rehearsal' in its name")
    parser.add_argument("--db-container", default="illume-database",
                        help="Docker container used when no local psql client exists")
    args = parser.parse_args()
    global PSQL_BASE
    if not args.database_url:
        parser.error("Missing --database-url and DATABASE_URL is unset")
    export = args.export_dir.resolve()
    manifest_path = export / "manifest.json"
    if not manifest_path.is_file():
        parser.error("Export directory has no manifest.json")
    manifest = json.loads(manifest_path.read_text())
    if not manifest.get("complete"):
        parser.error("Export manifest is not marked complete; refusing to import")
    conn = parse_database_url(args.database_url)
    if not conn["dbname"]:
        parser.error("DATABASE_URL has no database name")
    direct, _ = psql_base(conn, args.db_container)
    PSQL_BASE = direct
    if "rehearsal" in conn["dbname"] and not args.allow_rehearsal:
        parser.error("Target looks like the rehearsal reference database; refusing "
                     "(pass --allow-rehearsal only if you truly mean it)")
    if args.schema_sql:
        with open(args.schema_sql) as handle:
            psql(conn, handle.read())
        print(f"Applied schema from {args.schema_sql}", flush=True)
    local_tables = ["users"] + PUBLIC_TABLES + ["identities", "object_files"]
    counts = {}
    for table in ["users", "identities"] + PUBLIC_TABLES + ["object_files",
                                                            "auth_sessions", "jobs",
                                                            "image_operations",
                                                            "webhook_events",
                                                            "oauth_attempts",
                                                            "migration_rehearsals"]:
        try:
            out = psql(conn, f"SELECT count(*) FROM public.\"{table}\";", capture=True)
            counts[table] = int(out.strip())
        except RuntimeError:
            counts[table] = None
    nonempty = {t: n for t, n in counts.items() if n}
    if nonempty and not args.force:
        parser.error("Target database is not empty "
                     + json.dumps(nonempty) + "; refusing (pass --force to override)")
    elif nonempty:
        print("WARNING: target is not empty (--force): " + json.dumps(nonempty), flush=True)

    def load_export(name):
        path = export / f"{name}.json"
        rows = json.loads(path.read_text())
        expected = manifest["tables"].get(name, {})
        if expected.get("rows") is not None and len(rows) != expected["rows"]:
            raise RuntimeError(f"{name}: {len(rows)} rows on disk but manifest says "
                               f"{expected['rows']}")
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        if expected.get("sha256") and digest != expected["sha256"]:
            raise RuntimeError(f"{name}: file hash differs from manifest")
        return rows

    summary = {}
    users = load_export("auth.users")
    user_ids = {u["id"] for u in users}
    user_rows = [{
        "id": u["id"], "email": u.get("email"),
        "password_hash": u.get("encrypted_password"),
        "confirmed_at": u.get("email_confirmed_at"),
        "banned_until": u.get("banned_until"),
        "created_at": u.get("created_at"),
        "last_sign_in_at": u.get("last_sign_in_at"),
        "user_metadata": u.get("raw_user_meta_data") or {},
        "app_metadata": u.get("raw_app_meta_data") or {},
        "role": u.get("role") or "authenticated",
        "source": u,
    } for u in users]
    insert_rows(conn, "users", table_columns(conn, "users"), user_rows)
    summary["users"] = len(user_rows)
    print(f"Imported users: {len(user_rows)}", flush=True)

    identities = load_export("auth.identities")
    identity_rows = [{
        "provider": i["provider"], "subject": i["provider_id"],
        "user_id": i["user_id"], "source": i,
    } for i in identities]
    insert_rows(conn, "identities", table_columns(conn, "identities"), identity_rows)
    summary["identities"] = len(identity_rows)
    print(f"Imported identities: {len(identity_rows)}", flush=True)

    for table in PUBLIC_TABLES:
        rows = load_export(f"public.{table}")
        columns = table_columns(conn, table)
        names = {name for name, _, _ in columns}
        trimmed = [{k: v for k, v in row.items() if k in names} for row in rows]
        if rows:
            insert_rows(conn, table, columns, trimmed)
        summary[table] = len(trimmed)
        print(f"Imported {table}: {len(trimmed)}", flush=True)

    storage_objects = load_export("storage.objects")
    files_root = Path(str(args.files_root)).resolve()
    if not str(args.files_root):
        parser.error("Missing --files-root and FILES_ROOT is unset")
    object_rows = []
    for obj in storage_objects:
        bucket, name = obj["bucket_id"], obj["name"]
        relative = Path(bucket) / name
        if relative.is_absolute() or any(part in ("..", ".") for part in relative.parts):
            raise RuntimeError(f"Unsafe storage object path: {bucket}/{name}")
        source = export / "objects" / relative
        if not source.is_file():
            raise RuntimeError(f"Export file missing: objects/{bucket}/{name}")
        destination = files_root / relative
        if destination.is_symlink() or (destination.exists() and not destination.is_file()):
            raise RuntimeError(f"Unexpected file destination: {destination}")
        destination.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        os.chmod(destination.parent, 0o700)
        hasher = hashlib.sha256()
        size = 0
        with open(source, "rb") as incoming, open(destination, "wb") as outgoing:
            while True:
                chunk = incoming.read(1024 * 1024)
                if not chunk:
                    break
                size += len(chunk)
                hasher.update(chunk)
                outgoing.write(chunk)
        os.chmod(destination, 0o600)
        digest = hasher.hexdigest()
        owner = obj.get("owner") or obj.get("owner_id")
        object_rows.append({
            "bucket": bucket, "path": name,
            "user_id": owner if owner in user_ids else None,
            "size": size,
            "mime_type": (obj.get("metadata") or {}).get("mimetype"),
            "sha256": digest,
        })
    insert_rows(conn, "object_files", table_columns(conn, "object_files"), object_rows)
    summary["object_files"] = len(object_rows)
    print(f"Imported object_files: {len(object_rows)}", flush=True)

    print("Verifying row counts against the manifest...", flush=True)
    problems = []
    expected_counts = {"users": manifest["tables"]["auth.users"]["rows"],
                       "identities": manifest["tables"]["auth.identities"]["rows"]}
    for table in PUBLIC_TABLES:
        expected_counts[table] = manifest["tables"][f"public.{table}"]["rows"]
    expected_counts["object_files"] = manifest["tables"]["storage.objects"]["rows"]
    for table, expected in expected_counts.items():
        actual = int(psql(conn, f"SELECT count(*) FROM public.\"{table}\";",
                           capture=True).strip())
        status = "ok" if actual == expected == summary[table] else "MISMATCH"
        if status != "ok":
            problems.append(f"{table}: expected {expected}, imported {summary[table]}, in db {actual}")
        print(f"  {table}: manifest={expected} imported={summary[table]} db={actual} {status}",
              flush=True)
    print("Verifying stored file hashes...", flush=True)
    bad = 0
    for obj in storage_objects:
        destination = files_root / obj["bucket_id"] / obj["name"]
        hasher = hashlib.sha256()
        with open(destination, "rb") as handle:
            while True:
                chunk = handle.read(1024 * 1024)
                if not chunk:
                    break
                hasher.update(chunk)
        manifest_entry = next((m for m in manifest.get("objects", [])
                               if m["bucket"] == obj["bucket_id"] and m["name"] == obj["name"]),
                              None)
        if manifest_entry and hasher.hexdigest() != manifest_entry["sha256"]:
            bad += 1
            problems.append(f"hash mismatch: {obj['bucket_id']}/{obj['name']}")
    print(f"  file hashes checked: {len(storage_objects)} bad: {bad}", flush=True)
    if problems:
        print("VERIFICATION FAILED:", flush=True)
        for problem in problems:
            print("  " + problem, flush=True)
        raise SystemExit(1)
    print("Import verified: all counts and hashes match the manifest.")


if __name__ == "__main__":
    try:
        main()
    except (BrokenPipeError, KeyboardInterrupt):
        raise SystemExit(130)
