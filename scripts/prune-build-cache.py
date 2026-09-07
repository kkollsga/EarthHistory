#!/usr/bin/env python3
"""Bound or clear only EarthHistory-owned regenerable build caches."""

from __future__ import annotations

import argparse
import os
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
OWNED = (
    Path("node_modules/.vite"),
    Path("node_modules/.vite-temp"),
    Path("tsconfig.app.tsbuildinfo"),
    Path("tsconfig.node.tsbuildinfo"),
)


def cache_files(root: Path) -> list[Path]:
    files: list[Path] = []
    for relative in OWNED:
        target = root / relative
        if target.is_symlink():
            continue
        if target.is_file():
            files.append(target)
        elif target.is_dir():
            for base, directories, names in os.walk(target, followlinks=False):
                directories[:] = [name for name in directories if not (Path(base) / name).is_symlink()]
                files.extend(Path(base) / name for name in names if not (Path(base) / name).is_symlink())
    return files


def size(root: Path) -> int:
    return sum(path.stat().st_size for path in cache_files(root))


def prune(root: Path) -> None:
    for path in cache_files(root):
        path.unlink()
    for relative in OWNED:
        target = root / relative
        if target.is_dir() and not target.is_symlink():
            for directory, _, _ in os.walk(target, topdown=False, followlinks=False):
                try:
                    Path(directory).rmdir()
                except OSError:
                    pass


def check(root: Path, max_mb: float, should_prune: bool) -> int:
    before = size(root)
    if should_prune:
        prune(root)
    after = size(root)
    limit = int(max_mb * 1024 * 1024)
    if after > limit:
        print(f"build-cache: FAIL: {after / (1024 * 1024):.2f} MiB exceeds {max_mb:g} MiB")
        return 1
    action = f"pruned {before - after} bytes; " if should_prune else ""
    print(f"build-cache: {action}{after / (1024 * 1024):.2f} MiB / {max_mb:g} MiB")
    return 0


def self_test() -> int:
    with tempfile.TemporaryDirectory() as temporary:
        root = Path(temporary)
        fixture = root / "node_modules" / ".vite" / "oversize.bin"
        fixture.parent.mkdir(parents=True)
        fixture.write_bytes(b"x" * (2 * 1024 * 1024))
        if check(root, 1, False) != 1:
            print("build-cache self-test: FAIL: oversize fixture passed")
            return 1
        if check(root, 1, True) != 0 or fixture.exists():
            print("build-cache self-test: FAIL: owned cache was not pruned")
            return 1
    print("build-cache self-test: expected failure and bounded cleanup observed")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--max-mb", type=float, default=100)
    parser.add_argument("--prune", action="store_true")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    return self_test() if args.self_test else check(ROOT, args.max_mb, args.prune)


if __name__ == "__main__":
    raise SystemExit(main())
