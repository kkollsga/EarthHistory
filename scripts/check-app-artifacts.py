#!/usr/bin/env python3
"""Validate the production bundle, data manifest, hashes, and size budgets."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def files_under(root: Path) -> list[Path]:
    return sorted(path for path in root.rglob("*") if path.is_file() and not path.is_symlink())


def declared_outputs(manifest: dict) -> dict[str, dict]:
    declared: dict[str, dict] = {}
    for entry in manifest.get("inputs", {}).values():
        candidates = [entry] if "path" in entry else []
        candidates.extend(entry.get("outputs", []))
        for output in candidates:
            path = output.get("path")
            if not isinstance(path, str) or not path.startswith("public/data/"):
                raise ValueError(f"manifest output has invalid path: {path!r}")
            if path in declared:
                raise ValueError(f"manifest output is duplicated: {path}")
            declared[path] = output
    return declared


def check(root: Path, max_mb: float, max_file_mb: float) -> int:
    errors: list[str] = []
    public_data = root / "public" / "data"
    dist = root / "dist"
    notice_path = root / "THIRD_PARTY_NOTICES.md"
    dist_notice = dist / "THIRD_PARTY_NOTICES.md"
    manifest_path = public_data / "manifest.json"
    if not manifest_path.is_file():
        print("check-app-artifacts: FAIL: public/data/manifest.json is missing")
        return 1
    try:
        manifest = json.loads(manifest_path.read_text())
        declared = declared_outputs(manifest)
    except (json.JSONDecodeError, ValueError) as error:
        print(f"check-app-artifacts: FAIL: invalid manifest: {error}")
        return 1

    actual_public = {
        str(path.relative_to(root))
        for path in files_under(public_data)
        if path != manifest_path
    }
    missing_declarations = actual_public - set(declared)
    missing_files = set(declared) - actual_public
    if missing_declarations:
        errors.append(f"unmanifested public data: {', '.join(sorted(missing_declarations))}")
    if missing_files:
        errors.append(f"declared public data missing: {', '.join(sorted(missing_files))}")

    dist_manifest = dist / "data" / "manifest.json"
    if not dist_manifest.is_file():
        errors.append("dist copy missing: dist/data/manifest.json")
    elif sha256(dist_manifest) != sha256(manifest_path):
        errors.append("dist copy differs: dist/data/manifest.json")

    if not notice_path.is_file():
        errors.append("THIRD_PARTY_NOTICES.md is missing")
    elif not dist_notice.is_file():
        errors.append("dist copy missing: dist/THIRD_PARTY_NOTICES.md")
    elif sha256(dist_notice) != sha256(notice_path):
        errors.append("dist copy differs: dist/THIRD_PARTY_NOTICES.md")

    for relative, record in declared.items():
        path = root / relative
        if not path.is_file():
            continue
        size = path.stat().st_size
        if size != record.get("bytes"):
            errors.append(f"{relative}: {size} bytes != manifest {record.get('bytes')}")
        digest = sha256(path)
        if digest != record.get("sha256"):
            errors.append(f"{relative}: sha256 {digest} != manifest {record.get('sha256')}")
        dist_relative = path.relative_to(public_data)
        dist_copy = dist / "data" / dist_relative
        if not dist_copy.is_file():
            errors.append(f"dist copy missing: dist/data/{dist_relative}")
        elif sha256(dist_copy) != digest:
            errors.append(f"dist copy differs: dist/data/{dist_relative}")

    index = dist / "index.html"
    if not index.is_file():
        errors.append("dist/index.html is missing")
    elif not (dist / "assets").is_dir():
        errors.append("dist/assets is missing")
    else:
        references = re.findall(r"(?:src|href)=[\"']([^\"']+)", index.read_text())
        root_relative = [reference for reference in references if reference.startswith("/")]
        if root_relative:
            errors.append(f"root-relative HTML assets break project-path hosting: {', '.join(root_relative)}")

    dist_files = files_under(dist) if dist.is_dir() else []
    total_bytes = sum(path.stat().st_size for path in dist_files)
    max_bytes = int(max_mb * 1024 * 1024)
    max_file_bytes = int(max_file_mb * 1024 * 1024)
    if total_bytes > max_bytes:
        errors.append(f"dist is {total_bytes} bytes, above {max_bytes}")
    oversize = [str(path.relative_to(root)) for path in dist_files if path.stat().st_size > max_file_bytes]
    if oversize:
        errors.append(f"files exceed {max_file_mb:g} MiB: {', '.join(oversize)}")

    if errors:
        for error in errors:
            print(f"check-app-artifacts: FAIL: {error}")
        return 1
    print(
        f"check-app-artifacts: {len(declared)} data files verified; "
        f"dist {total_bytes / (1024 * 1024):.2f} MiB / {max_mb:g} MiB"
    )
    return 0


def self_test() -> int:
    with tempfile.TemporaryDirectory() as temporary:
        root = Path(temporary)
        public = root / "public" / "data"
        built = root / "dist" / "data"
        assets = root / "dist" / "assets"
        public.mkdir(parents=True)
        built.mkdir(parents=True)
        assets.mkdir()
        payload = b"source data\n"
        (public / "fixture.json").write_bytes(payload)
        (built / "fixture.json").write_bytes(payload)
        (root / "dist" / "index.html").write_text('<script src="./assets/app.js"></script>')
        (assets / "app.js").write_text("export {}")
        notice = root / "THIRD_PARTY_NOTICES.md"
        dist_notice = root / "dist" / "THIRD_PARTY_NOTICES.md"
        notice.write_text("Canonical third-party notices\n")
        dist_notice.write_bytes(notice.read_bytes())
        manifest = {
            "inputs": {
                "fixture": {
                    "path": "public/data/fixture.json",
                    "bytes": len(payload),
                    "sha256": "0" * 64,
                }
            }
        }
        (public / "manifest.json").write_text(json.dumps(manifest))
        (built / "manifest.json").write_text(json.dumps(manifest))
        if check(root, 1, 1) != 1:
            print("check-app-artifacts self-test: FAIL: bad checksum passed")
            return 1
        manifest["inputs"]["fixture"]["sha256"] = sha256(public / "fixture.json")
        (public / "manifest.json").write_text(json.dumps(manifest))
        (built / "manifest.json").write_text(json.dumps(manifest))
        (root / "dist" / "index.html").write_text('<script src="/assets/app.js"></script>')
        if check(root, 1, 1) != 1:
            print("check-app-artifacts self-test: FAIL: root-relative asset passed")
            return 1
        (root / "dist" / "index.html").write_text('<script src="./assets/app.js"></script>')
        (assets / "oversize.bin").write_bytes(b"x" * (2 * 1024 * 1024))
        if check(root, 1, 1) != 1:
            print("check-app-artifacts self-test: FAIL: artifact budget violation passed")
            return 1
        (assets / "oversize.bin").unlink()
        dist_notice.unlink()
        if check(root, 1, 1) != 1:
            print("check-app-artifacts self-test: FAIL: missing third-party notices passed")
            return 1
        dist_notice.write_text("Mismatched third-party notices\n")
        if check(root, 1, 1) != 1:
            print("check-app-artifacts self-test: FAIL: mismatched third-party notices passed")
            return 1
        dist_notice.write_bytes(notice.read_bytes())
        if check(root, 1, 1) != 0:
            print("check-app-artifacts self-test: FAIL: restored fixture did not pass")
            return 1
    print("check-app-artifacts self-test: expected checksum, URL, notice, and budget failures observed")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--max-mb", type=float, default=50)
    parser.add_argument("--max-file-mb", type=float, default=8)
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    return self_test() if args.self_test else check(ROOT, args.max_mb, args.max_file_mb)


if __name__ == "__main__":
    raise SystemExit(main())
