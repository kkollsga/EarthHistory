#!/usr/bin/env python3
"""Intern the shipped Cao v2.4 package JSON and re-derive every dependent digest.

Phase 1 of ``dev-docs/plans/palaeo-coastlines-polygons.md``. The encoding is
``scripts/research/cao_package_intern.py``; this script is the owner that
applies it to ``public/data/reconstruction/cao-v2.4`` and moves every sha256
declaration that follows from it. Nothing scientific changes: the expanded form
of every rewritten file is proved deep-equal to the file it replaced, so every
chart, source id, citation, limitation, lifecycle, motion binding, boundary
segment and ownership ring keeps its exact value.

Digests that follow the rewritten files, each re-derived here rather than
edited (CLAUDE.md R10/R16):

  1. ``public/data/reconstruction/cao-v2.4/manifest.json`` — ``core``,
     ``materialCorrections.catalog``, every checkpoint's bytes/sha256 and
     ``transitiveBytes``, and ``motionPalette.requestedAgeTiles``.
  2. ``public/data/manifest.json`` — one output row per rewritten file.
  3. ``checkpoint-*.json`` — the boundary/ownership catalog asset each pins.
  4. ``corrections/material-v1/catalog.json`` — ``baseline.coreSha256``.
  5. ``motion-tiles/index.json`` — ``sourceIdentity.coreSha256`` and
     ``sourceIdentity.materialCorrectionCatalogSha256``, re-emitted through
     ``emit_cao_requested_age_motion_tiles`` and promoted through
     ``promote_cao_requested_age_motion_tiles`` so the tile payloads are proved
     unchanged by their own validator.
  6. ``data/corrections/requested-age-motion-tiles/source-contract.json`` — the
     pinned source-package identity and the emitted index digest.
  7. ``docs/research/regional-iceland-motion-validation.json`` and
     ``docs/research/north-sea-restoration-validation.json`` — the package
     identity these oracle records were measured against. Both are *identity*
     rebases: every measured field must stay byte-identical or the rebase is
     refused. Neither oracle can be re-run here (both need pyGPlates), and
     neither measures anything the interning changes.

Usage::

    python3 scripts/research/apply_cao_package_interning.py            # verify
    python3 scripts/research/apply_cao_package_interning.py --apply
"""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import cao_package_intern as intern  # noqa: E402
import emit_cao_requested_age_motion_tiles as tiles  # noqa: E402
import promote_cao_requested_age_motion_tiles as tile_promoter  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
PUBLIC = (ROOT / "public/data/reconstruction/cao-v2.4").resolve()
ROOT_MANIFEST = ROOT / "public/data/manifest.json"
TILE_CONTRACT = ROOT / "data/corrections/requested-age-motion-tiles/source-contract.json"
PROOF = ROOT / "docs/research/cao-package-interning-proof.json"
INTERNING_ID = "earthhistory-cao-package-interning-v1"
CORRECTION_CATALOG = "corrections/material-v1/catalog.json"
#: Tracked oracle records that pin the package identity they were measured
#: against. Each maps a record path to the flat or nested keys this rebase moves.
IDENTITY_PINNED_REPORTS = (
    ROOT / "docs/research/regional-iceland-motion-validation.json",
    ROOT / "docs/research/north-sea-restoration-validation.json",
)


class InterningApplyError(ValueError):
    pass


def sha_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def sha(path: Path) -> str:
    return sha_bytes(path.read_bytes())


def compact(document: object) -> bytes:
    """The package's own JSON encoding: minified, key order preserved."""
    return (json.dumps(document, separators=(",", ":")) + "\n").encode()


def indented(document: object) -> bytes:
    return (json.dumps(document, indent=2) + "\n").encode()


def asset(path: Path, url: str | None = None) -> dict:
    return {"url": url or path.name, "bytes": path.stat().st_size, "sha256": sha(path)}


def write_atomic(path: Path, payload: bytes) -> None:
    temporary = path.with_name(path.name + ".interning-stage")
    temporary.write_bytes(payload)
    os.replace(temporary, path)


def require_round_trip(path: Path, encode) -> dict:
    """Refuse to rewrite a file whose current serialization we cannot reproduce."""
    raw = path.read_bytes()
    document = json.loads(raw)
    if encode(document) != raw:
        raise InterningApplyError(f"{path.name}: serialization does not round-trip")
    return document


def rewrite(path: Path, encode, reduce) -> dict:
    """Intern one package file, proving the result expands back to what it replaced."""
    original = intern.expand_package_document(json.loads(path.read_text()))
    reduced = reduce(original)
    payload = compact(reduced)
    restored = intern.expand_package_document(json.loads(payload))
    if intern.canonical(restored) != intern.canonical(original):
        raise InterningApplyError(f"{path.name}: interned form does not expand to the shipped file")
    before = path.stat().st_size
    write_atomic(path, payload)
    return {"path": str(path.relative_to(ROOT)), "beforeBytes": before,
            "afterBytes": len(payload), "sha256": sha_bytes(payload)}


def update_root_rows(paths: list[Path]) -> None:
    manifest = require_round_trip(ROOT_MANIFEST, indented)
    rows = [row for entry in manifest["inputs"].values() for row in entry.get("outputs", [])]
    for path in paths:
        relative = str(path.relative_to(ROOT))
        matches = [row for row in rows if row["path"] == relative]
        if len(matches) != 1:
            raise InterningApplyError(f"root manifest has {len(matches)} outputs for {relative}")
        matches[0].update({"bytes": path.stat().st_size, "sha256": sha(path)})
    write_atomic(ROOT_MANIFEST, indented(manifest))


def rebase_identity_pinned_reports(manifest: dict) -> list[Path]:
    """Repoint tracked oracle records at the rewritten package identity.

    Only the core and material-correction catalog pins move, and only when every
    measured field of the record stays byte-identical. This is an identity
    refresh, never a substitute for re-running an oracle.
    """
    catalog = manifest["materialCorrections"]["catalog"]
    touched: list[Path] = []
    for path in IDENTITY_PINNED_REPORTS:
        if not path.is_file():
            continue
        report = require_round_trip(path, indented)
        expected = copy.deepcopy(report)
        provenance = "packageAssetsRebasedBy"
        if "packageAssets" in expected:
            assets = expected["packageAssets"]
            unchanged = {key: value for key, value in assets.items()
                         if key not in ("core", "materialCorrectionCatalog")}
            expected["packageAssets"] = {**assets, "core": manifest["core"],
                                         "materialCorrectionCatalog": catalog}
            if {key: value for key, value in expected["packageAssets"].items()
                    if key not in ("core", "materialCorrectionCatalog")} != unchanged:
                raise InterningApplyError(f"{path.name}: rebase would change a measured asset")
        elif "appliedCoreSha256" in expected:
            expected["appliedCoreSha256"] = manifest["core"]["sha256"]
        else:
            raise InterningApplyError(f"{path.name}: no known package identity pin")
        expected[provenance] = sorted({*report.get(provenance, []), INTERNING_ID})
        measured = {key: value for key, value in report.items()
                    if key not in ("packageAssets", "appliedCoreSha256", provenance)}
        if measured != {key: value for key, value in expected.items()
                        if key not in ("packageAssets", "appliedCoreSha256", provenance)}:
            raise InterningApplyError(f"{path.name}: rebase would change measured evidence")
        write_atomic(path, indented(expected))
        touched.append(path)
    return touched


def reemit_motion_tiles() -> dict:
    """Re-derive the tile index through its own emitter, promoter and validator."""
    contract = require_round_trip(TILE_CONTRACT, indented)
    manifest = json.loads((PUBLIC / "manifest.json").read_text())
    contract["sourcePackage"]["core"] = manifest["core"]
    contract["sourcePackage"]["materialCorrections"] = manifest["materialCorrections"]
    write_atomic(TILE_CONTRACT, indented(contract))

    source = tiles.load_source(PUBLIC, tiles.load_contract())
    expected = tiles.expected_index(source, tiles.expected_tiles(source))
    payload = tiles.canonical(expected)
    contract["derivation"]["expectedIndexBytes"] = len(payload)
    contract["derivation"]["expectedIndexSha256"] = sha_bytes(payload)
    write_atomic(TILE_CONTRACT, indented(contract))

    with tempfile.TemporaryDirectory(prefix="earthhistory-interning-tiles-") as temporary:
        stage = Path(temporary) / "motion-tiles"
        staged_manifest = Path(temporary) / "manifest.json"
        emitted = tiles.emit(PUBLIC, stage, staged_manifest)
        promoted = tile_promoter.promote(stage, staged_manifest, PUBLIC)
    return {"tileCount": emitted["tileCount"], "tileBytes": emitted["tileBytes"],
            "indexSha256": sha(PUBLIC / "motion-tiles/index.json"),
            "packageManifestSha256": promoted["packageManifestSha256"]}


def expanded_digests(package: Path) -> dict[str, str]:
    """Canonical digest of the *expanded* form of every file interning touches.

    The correction catalog's ``baseline.coreSha256`` is excluded: it is the one
    field that must follow the rewritten core, and it is checked separately.
    """
    digests: dict[str, str] = {}
    paths = [package / "core.json", package / CORRECTION_CATALOG,
             *sorted(package.glob("boundary-*.json")), *sorted(package.glob("ownership-*.json"))]
    for path in paths:
        document = intern.expand_package_document(json.loads(path.read_text()))
        if path.name == "catalog.json":
            document = {**document, "baseline": {**document["baseline"], "coreSha256": None}}
        digests[path.name] = sha_bytes(intern.canonical(document).encode())
    return digests


def summarise(rewritten: list[dict]) -> list[dict]:
    """Group the interned files into their four classes with shipped byte totals.

    Re-running the apply is a no-op, so this records the resulting inventory
    rather than one run's delta; the reclaim itself is reported in CHANGELOG.md
    and the Phase 1 measurement record.
    """
    classes = (("core.json", lambda name: name == "core.json"),
               ("corrections/material-v1/catalog.json", lambda name: name == "catalog.json"),
               ("boundary-*.json", lambda name: name.startswith("boundary-")),
               ("ownership-*.json", lambda name: name.startswith("ownership-")))
    rows = []
    for label, matches in classes:
        members = [row for row in rewritten if matches(Path(row["path"]).name)]
        rows.append({"files": label, "count": len(members),
                     "internedBytes": sum(row["afterBytes"] for row in members)})
    return rows


def apply(package: Path) -> dict:
    package = package.resolve()
    if package != PUBLIC:
        raise InterningApplyError("interning applies to the canonical public package only")
    manifest_path = package / "manifest.json"
    manifest = require_round_trip(manifest_path, compact)
    core_path = package / "core.json"
    catalog_path = package / CORRECTION_CATALOG

    if manifest["core"] != asset(core_path):
        raise InterningApplyError("package core identity is stale")
    if manifest["materialCorrections"]["catalog"] != asset(catalog_path, CORRECTION_CATALOG):
        raise InterningApplyError("material correction catalog identity is stale")
    before = expanded_digests(package)

    rewritten = [rewrite(core_path, compact,
                         lambda doc: intern.intern_charts(doc, intern.CORE_CHART_FIELDS)),
                 rewrite(catalog_path, compact,
                         lambda doc: intern.intern_charts(doc, intern.CORRECTION_CHART_FIELDS))]
    for path in sorted(package.glob("ownership-*.json")):
        rewritten.append(rewrite(path, compact, intern.intern_ownership))
    for path in sorted(package.glob("boundary-*.json")):
        rewritten.append(rewrite(path, compact, intern.intern_boundary))

    # The catalog's baseline follows the rewritten core, and the checkpoints
    # follow the rewritten native layers, before the manifest follows both.
    catalog = json.loads(catalog_path.read_text())
    catalog["baseline"]["coreSha256"] = sha(core_path)
    write_atomic(catalog_path, compact(catalog))

    checkpoints: list[Path] = []
    for path in sorted(package.glob("checkpoint-*.json")):
        checkpoint = require_round_trip(path, compact)
        for key in ("nativeBoundaryLayer", "topologyOwnershipLayer"):
            layer = checkpoint.get(key)
            if layer is None:
                continue
            url = layer["catalog"]["url"]
            layer["catalog"] = asset(package / url, url)
        write_atomic(path, compact(checkpoint))
        checkpoints.append(path)

    manifest["core"] = asset(core_path)
    manifest["materialCorrections"]["catalog"] = asset(catalog_path, CORRECTION_CATALOG)
    declared = {row["ageMa"]: row for row in manifest["checkpoints"]}
    for path in checkpoints:
        checkpoint = json.loads(path.read_text())
        row = declared[checkpoint["ageMa"]]
        if row["url"] != path.name:
            raise InterningApplyError(f"checkpoint url mismatch for {path.name}")
        transitive = path.stat().st_size + sum(
            (layer["catalog"]["bytes"] + layer["binary"]["bytes"])
            for key in ("nativeBoundaryLayer", "topologyOwnershipLayer")
            if (layer := checkpoint.get(key)) is not None)
        row.update({**asset(path), "ageMa": row["ageMa"], "transitiveBytes": transitive})
    write_atomic(manifest_path, compact(manifest))

    update_root_rows([core_path, catalog_path, manifest_path, *checkpoints,
                      *sorted(package.glob("ownership-*.json")),
                      *sorted(package.glob("boundary-*.json"))])
    reports = rebase_identity_pinned_reports(manifest)
    tiles_report = reemit_motion_tiles()

    after = expanded_digests(package)
    if after != before:
        changed = sorted(name for name in before if before[name] != after.get(name))
        raise InterningApplyError(f"interning changed package content: {changed[:5]}")
    proof = {
        "schemaVersion": 1,
        "id": INTERNING_ID,
        "encoding": "scripts/research/cao_package_intern.py",
        "runtimeDecoder": "src/reconstruction/packageIntern.ts",
        "losslessProof": "every rewritten file expands to a canonically identical document",
        # Per-file digests are the root data manifest's job; this record carries
        # the class totals the reclaim is measured by.
        "classes": summarise(rewritten),
        "internedBytes": sum(row["afterBytes"] for row in rewritten),
        "rebasedIdentityReports": [str(path.relative_to(ROOT)) for path in reports],
        "motionTiles": tiles_report,
    }
    write_atomic(PROOF, indented(proof))
    return {"files": len(rewritten),
            "savedBytes": sum(row["beforeBytes"] - row["afterBytes"] for row in rewritten),
            "internedBytes": proof["internedBytes"], "checkpoints": len(checkpoints),
            "proof": str(PROOF.relative_to(ROOT))}


def validate(package: Path) -> dict:
    """Assert the public package is interned, round-trips, and matches its manifests."""
    package = package.resolve()
    manifest = json.loads((package / "manifest.json").read_text())
    core_path = package / "core.json"
    catalog_path = package / CORRECTION_CATALOG
    if manifest["core"] != asset(core_path):
        raise InterningApplyError("package core identity is stale")
    if manifest["materialCorrections"]["catalog"] != asset(catalog_path, CORRECTION_CATALOG):
        raise InterningApplyError("material correction catalog identity is stale")
    if json.loads(catalog_path.read_text())["baseline"]["coreSha256"] != manifest["core"]["sha256"]:
        raise InterningApplyError("material correction baseline does not follow the core")
    interned = 0
    for path in [core_path, catalog_path, *sorted(package.glob("boundary-*.json")),
                 *sorted(package.glob("ownership-*.json"))]:
        document = json.loads(path.read_text())
        if not intern.is_interned(document):
            raise InterningApplyError(f"{path.name} is not interned")
        intern.expand_package_document(document)
        interned += 1
    for path in sorted(package.glob("checkpoint-*.json")):
        checkpoint = json.loads(path.read_text())
        for key in ("nativeBoundaryLayer", "topologyOwnershipLayer"):
            layer = checkpoint.get(key)
            if layer is None:
                continue
            url = layer["catalog"]["url"]
            if layer["catalog"] != asset(package / url, url):
                raise InterningApplyError(f"{path.name} pins a stale {key} catalog")
        row = next(r for r in manifest["checkpoints"] if r["url"] == path.name)
        transitive = path.stat().st_size + sum(
            (layer["catalog"]["bytes"] + layer["binary"]["bytes"])
            for key in ("nativeBoundaryLayer", "topologyOwnershipLayer")
            if (layer := checkpoint.get(key)) is not None)
        if row["sha256"] != sha(path) or row["bytes"] != path.stat().st_size \
                or row["transitiveBytes"] != transitive:
            raise InterningApplyError(f"{path.name} manifest ledger is stale")
    return {"internedFiles": interned, "checkpoints": len(list(package.glob("checkpoint-*.json"))),
            "status": "pass"}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--package", type=Path, default=PUBLIC)
    parser.add_argument("--apply", action="store_true",
                        help="rewrite the package and re-derive every dependent digest")
    args = parser.parse_args()
    report = apply(args.package) if args.apply else validate(args.package)
    print(json.dumps(report, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
