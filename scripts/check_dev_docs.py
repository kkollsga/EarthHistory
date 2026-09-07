#!/usr/bin/env python3
"""Bound local doctrine state without deleting or following symlinks."""

from __future__ import annotations

import argparse
import os
import tempfile
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
LIFETIMES_DAYS = {"temp": 1, "bench/out": 14}


def files_under(root: Path):
    if not root.is_dir():
        return
    for base, directories, files in os.walk(root, followlinks=False):
        directories[:] = [
            name for name in directories if not (Path(base) / name).is_symlink()
        ]
        for name in files:
            path = Path(base) / name
            if not path.is_symlink():
                yield path


def check(root: Path, max_mb: float) -> int:
    files = list(files_under(root) or [])
    total_bytes = sum(path.stat().st_size for path in files)
    total_mb = total_bytes / (1024 * 1024)

    now = time.time()
    for relative, days in LIFETIMES_DAYS.items():
        tier = root / relative
        for path in files_under(tier) or []:
            age_days = (now - path.stat().st_mtime) / 86400
            if age_days > days:
                print(
                    f"check-dev-docs: warning: {path.relative_to(root)} is "
                    f"{age_days:.1f}d old; inspect with dev-docs-cleanup "
                    "before deleting"
                )

    if total_mb > max_mb:
        print(
            f"check-dev-docs: FAIL: {total_mb:.2f} MiB exceeds "
            f"DEV_DOCS_MAX_MB={max_mb:g}"
        )
        return 1
    print(f"check-dev-docs: {total_mb:.2f} MiB / {max_mb:g} MiB")
    return 0


def self_test() -> int:
    with tempfile.TemporaryDirectory() as temporary:
        root = Path(temporary) / "dev-docs"
        root.mkdir()
        (root / "oversize.bin").write_bytes(b"x" * (2 * 1024 * 1024))
        result = check(root, 1)
        if result != 1:
            print("check-dev-docs self-test: FAIL: oversize fixture passed")
            return 1
    print("check-dev-docs self-test: expected failure observed")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--max-mb", type=float, default=50)
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    return self_test() if args.self_test else check(ROOT / "dev-docs", args.max_mb)


if __name__ == "__main__":
    raise SystemExit(main())
