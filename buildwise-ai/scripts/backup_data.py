#!/usr/bin/env python3
"""Back up BuildWise data before any migration. Read-only: it copies, it never changes or deletes anything.

  python scripts/backup_data.py                  # backs up backend/data (SQLite files, uploads, reports)
  python scripts/backup_data.py --data-dir PATH  # another data directory
  python scripts/backup_data.py --pg-url postgresql://...   # also dumps a PostgreSQL database with pg_dump (needs pg_dump installed)

Writes backups/<timestamp>/ with a MANIFEST.json (file list, sizes, SHA-256) so the copy can be verified later.
The backups folder is git-ignored: backups contain real user data and must never be committed.
Encryption key files (.auth_key, .dev_jwt_secret) are copied too, because the encrypted credential store cannot be read without them:
keep the backup folder private.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import sqlite3
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def sha256(p: Path) -> str:
    h = hashlib.sha256()
    with p.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def backup_sqlite(src: Path, dst: Path) -> None:
    """Consistent copy of a live SQLite file (uses SQLite's own backup API, safe while the app is running)."""
    with sqlite3.connect(f"file:{src}?mode=ro", uri=True) as a, sqlite3.connect(dst) as b:
        a.backup(b)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data-dir", default=str(ROOT / "backend" / "data"))
    ap.add_argument("--out", default=str(ROOT / "backups"))
    ap.add_argument("--pg-url", default="")
    args = ap.parse_args()
    data = Path(args.data_dir)
    out = Path(args.out) / datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    out.mkdir(parents=True, exist_ok=False)
    copied: list[Path] = []
    if data.is_dir():
        for p in sorted(data.rglob("*")):
            if not p.is_file() or p.name.endswith(("-wal", "-shm", "-journal")):
                continue
            target = out / "data" / p.relative_to(data)
            target.parent.mkdir(parents=True, exist_ok=True)
            if p.suffix == ".db":
                backup_sqlite(p, target)
            else:
                shutil.copy2(p, target)
            copied.append(target)
    else:
        print(f"note: {data} does not exist (nothing to back up there)")
    if args.pg_url:
        dump = out / "postgres.sql"
        r = subprocess.run(["pg_dump", "--no-owner", "--no-privileges", "--file", str(dump), args.pg_url], capture_output=True, text=True)
        if r.returncode != 0:
            print("pg_dump failed:", r.stderr.strip()[:300], file=sys.stderr)
            return 1
        copied.append(dump)
    manifest = {"created": datetime.now(timezone.utc).isoformat(), "source": str(data), "files": [{"path": str(p.relative_to(out)), "bytes": p.stat().st_size, "sha256": sha256(p)} for p in copied]}
    (out / "MANIFEST.json").write_text(json.dumps(manifest, indent=1))
    print(f"backed up {len(copied)} file(s) to {out}")
    for f in manifest["files"]:
        print(f"  {f['bytes']:>10}  {f['path']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
