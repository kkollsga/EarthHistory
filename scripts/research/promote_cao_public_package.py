#!/usr/bin/env python3
"""Promote a staged Cao package into public/data/reconstruction/cao-v2.4 and refresh hashes."""

from __future__ import annotations

import hashlib
import json
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PUBLIC_PKG = ROOT / "public/data/reconstruction/cao-v2.4"
PUBLIC_MANIFEST = ROOT / "public/data/manifest.json"


def sha(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main(source: Path, lean: bool = True):
    source = Path(source)
    if not (source / "manifest.json").is_file():
        raise SystemExit(f"missing package manifest: {source}")
    PUBLIC_PKG.mkdir(parents=True, exist_ok=True)
    # Remove previous package files only (keep directory).
    for path in PUBLIC_PKG.iterdir():
        if path.is_file():
            path.unlink()
        elif path.is_dir():
            shutil.rmtree(path)
    skip_names = set()
    if lean:
        skip_names.update(
            {
                "compiler-coverage.json",
                "native-layer-assets.json",
                "anchor-compiler-report.json",
                "country-reference.json",
                "country-reference-extension.json",
            }
        )
    copied = []
    for path in sorted(source.iterdir()):
        if not path.is_file():
            continue
        if path.name in skip_names:
            continue
        if path.name.startswith("paleodem"):
            continue
        dest = PUBLIC_PKG / path.name
        shutil.copy2(path, dest)
        copied.append(dest)

    pkg_manifest = json.loads((PUBLIC_PKG / "manifest.json").read_text())
    outputs = []
    for path in sorted(PUBLIC_PKG.iterdir()):
        if not path.is_file():
            continue
        rel = f"public/data/reconstruction/cao-v2.4/{path.name}"
        outputs.append(
            {
                "role": path.name,
                "path": rel,
                "sha256": sha(path),
                "bytes": path.stat().st_size,
            }
        )

    top = json.loads(PUBLIC_MANIFEST.read_text())
    key = "cao-reconstruction-foundation-v2"
    if key not in top.get("inputs", {}):
        raise SystemExit(f"missing {key} in public data manifest")
    entry = top["inputs"][key]
    entry["outputs"] = outputs
    entry["scope"] = (
        f"Cao v2.4 {pkg_manifest['ageDomainMa']['youngest']:g}-"
        f"{pkg_manifest['ageDomainMa']['oldest']:g} Ma layered foundation "
        "(coastline-class land over continental-outline shelf); Natural Earth "
        "country locator lines; native boundaries/ownership. Country lines remain "
        "modern locators only."
    )
    entry["processing"] = (
        "Pinned Cao v2.4 shapes_coasts.gpmlz as land-fill proxy and "
        "shapes_continents.gpmlz as shallow-shelf underlay; Natural Earth country "
        "locator lines; native boundaries/ownership over the compiled Cao domain."
    )
    top["retrievedAt"] = "2026-09-10"
    top["generatedBy"] = (
        "Cao layered coasts/continents foundation over full compiled source domain"
    )
    PUBLIC_MANIFEST.write_text(json.dumps(top, indent=2) + "\n")
    print(
        json.dumps(
            {
                "copied": len(copied),
                "ageDomainMa": pkg_manifest.get("ageDomainMa"),
                "checkpoints": len(pkg_manifest.get("checkpoints", [])),
                "publicBytes": sum(p.stat().st_size for p in copied),
                "manifestOutputs": len(outputs),
            }
        )
    )


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--source",
        type=Path,
        required=True,
        help="staged package directory to promote",
    )
    parser.add_argument("--no-lean", action="store_true", help="keep compiler reports")
    args = parser.parse_args()
    main(args.source, lean=not args.no_lean)
