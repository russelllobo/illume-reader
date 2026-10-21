#!/usr/bin/env python3
"""Export hosted data into a private, resumable migration directory."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import urllib.error
import urllib.parse
import urllib.request


def request(url, token, payload=None):
    headers = {"Authorization": "Bearer " + token}
    data = None
    if payload is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(payload).encode()
    req = urllib.request.Request(url, headers=headers, data=data)
    with urllib.request.urlopen(req, timeout=120) as response:
        return response.read()


def save_json(path, value):
    temporary = path.with_suffix(path.suffix + ".partial")
    temporary.write_text(json.dumps(value, indent=2) + "\n")
    temporary.chmod(0o600)
    temporary.replace(path)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project", default="hiswlrweciottgskunlc")
    parser.add_argument("--token-file", type=Path, default=Path.home() / ".config/illume-reader/supabase-access-token")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    os.umask(0o077)
    if not re.fullmatch(r"[a-z]{20}", args.project):
        parser.error("Invalid project reference")
    if not args.token_file.is_file():
        parser.error("Missing owner-only access token file")
    if args.token_file.stat().st_mode & 0o077:
        parser.error("Access token file must have owner-only permissions")
    output = args.output.resolve()
    repo = Path(__file__).resolve().parent.parent
    if output == repo or repo in output.parents:
        parser.error("Choose an export directory outside the repository")
    output.mkdir(parents=True, exist_ok=True, mode=0o700)
    if output.stat().st_mode & 0o077:
        parser.error("Export directory must have owner-only permissions")
    token = args.token_file.read_text().strip()
    api = f"https://api.supabase.com/v1/projects/{args.project}"

    def sql(query):
        return json.loads(request(api + "/database/query", token, {"query": query, "read_only": True}))

    tables = sql("select table_schema, table_name from information_schema.tables where table_type = 'BASE TABLE' and table_schema in ('public','auth','storage') order by table_schema, table_name")
    if not isinstance(tables, list):
        raise RuntimeError("Database query did not return a table list")
    save_json(output / "columns.json", sql("select * from information_schema.columns where table_schema in ('public','auth','storage') order by table_schema,table_name,ordinal_position"))
    manifest = {"project": args.project, "tables": {}, "objects": [], "complete": False}
    save_json(output / "manifest.json", manifest)
    for table in tables:
        schema, name = table["table_schema"], table["table_name"]
        if not re.fullmatch(r"[a-z_][a-z0-9_]*", schema) or not re.fullmatch(r"[a-z_][a-z0-9_]*", name):
            raise RuntimeError("Unexpected SQL identifier")
        rows = []
        offset = 0
        while True:
            page = sql(f'SELECT * FROM "{schema}"."{name}" ORDER BY ctid LIMIT 500 OFFSET {offset}')
            if not isinstance(page, list):
                raise RuntimeError(f"Invalid rows for {schema}.{name}")
            rows.extend(page)
            offset += len(page)
            if len(page) < 500:
                break
        path = output / f"{schema}.{name}.json"
        save_json(path, rows)
        manifest["tables"][f"{schema}.{name}"] = {"rows": len(rows), "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}
        print(f"Exported {schema}.{name}: {len(rows)} rows", flush=True)
    keys = json.loads(request(api + "/api-keys", token))
    service = next((key["api_key"] for key in keys if key.get("name") == "service_role"), None)
    if not service:
        raise RuntimeError("Service-role key unavailable; storage export cannot proceed")
    objects = json.loads((output / "storage.objects.json").read_text())
    for obj in objects:
        bucket, name = obj["bucket_id"], obj["name"]
        relative = Path(bucket) / name
        if relative.is_absolute() or any(part in ("..", ".") for part in relative.parts):
            raise RuntimeError("Unsafe storage object path")
        path = output / "objects" / relative
        if path.is_symlink() or (path.exists() and not path.is_file()):
            raise RuntimeError("Unexpected object destination")
        path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        encoded = urllib.parse.quote(bucket + "/" + name, safe="/")
        data = request(f"https://{args.project}.supabase.co/storage/v1/object/{encoded}", service)
        temporary = path.with_name(path.name + ".partial")
        temporary.write_bytes(data)
        temporary.replace(path)
        manifest["objects"].append({"bucket": bucket, "name": name, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()})
    manifest["complete"] = True
    save_json(output / "manifest.json", manifest)
    print(f"Export complete: {len(tables)} tables, {len(objects)} objects. Keep this directory private.")


if __name__ == "__main__":
    try:
        main()
    except urllib.error.HTTPError as error:
        raise SystemExit(f"Hosted API returned HTTP {error.code}; no credentials were printed.")
