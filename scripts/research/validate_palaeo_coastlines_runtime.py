#!/usr/bin/env python3
"""Gate the published Cao 2017 palaeo-coastline bytes against both manifests.

`palaeo_coastlines_correction.py` is the compile oracle: it needs the pinned
pyGPlates environment, the source zips and the offline store, none of which a
checkout has. This is the half that can run anywhere, and it is the half that
protects what a browser downloads - that the package manifest's
``palaeoCoastlines`` section, the two columnar class catalogs and the outline
tone tables all describe the files actually published, byte for byte.

``--self-test`` proves each gate can fail: a payload byte flipped under an
unchanged catalog, a catalog digest that no longer matches the package manifest,
an interval dropped from one class only, a relaxed edge bound, a reservation
below the worst interval and an outer-manifest row that was never refreshed.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import struct
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PACKAGE = Path("public/data/reconstruction/cao-v2.4")
PALAEO = PACKAGE / "palaeo-coastlines"
OUTER_MANIFEST = Path("public/data/manifest.json")
OUTER_INPUT_KEY = "cao-2017-palaeogeography-v1"

CATALOG_SCHEMA_VERSION = 2
CATALOG_ENCODING = "palaeo-class-catalog-columnar-v1"
BINDING_ENTRY_RULE = "palaeo-binding-entry-v1"
PUBLISHED_INTERVALS = 24
AGE_DOMAIN_MA = {"youngest": 2.01, "oldest": 402.0}
MAXIMUM_EDGE_DEGREES = 1.0
# The interval store holds at most two resident intervals at a time.
RESIDENT_INTERVAL_MULTIPLE = 2
TONE_MAGIC = b"EHPT"


class RuntimeAssetError(ValueError):
    """A published palaeo-coastline asset disagrees with a manifest that indexes it."""


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def require(condition: bool, message: str) -> None:
    if not condition:
        raise RuntimeAssetError(message)


def check_asset(root: Path, base: Path, asset: dict, label: str) -> Path:
    path = root / base / asset["url"]
    require(path.is_file(), f"{label}: {asset['url']} is not published")
    require(path.stat().st_size == asset["bytes"],
            f"{label}: {asset['url']} is {path.stat().st_size} bytes, manifest says {asset['bytes']}")
    require(sha256(path) == asset["sha256"], f"{label}: {asset['url']} sha256 does not match the manifest")
    return path


def interval_rows(catalog: dict) -> list[dict]:
    table = catalog["intervals"]
    columns = [key for key in table if key != "count"]
    for column in columns:
        require(len(table[column]) == table["count"],
                f"interval column {column} disagrees with its row count")
    return [{column: table[column][index] for column in columns}
            for index in range(table["count"])]


def check_class(root: Path, entry: dict) -> dict:
    """One class: its catalog identity, its schedule and every payload it indexes."""
    class_name = entry["surfaceClass"]
    catalog_path = check_asset(root, PACKAGE, entry["catalog"], f"class {class_name} catalog")
    catalog = json.loads(catalog_path.read_text())
    require(catalog.get("schemaVersion") == CATALOG_SCHEMA_VERSION
            and catalog.get("encoding") == CATALOG_ENCODING,
            f"class {class_name}: catalog is not the columnar schemaVersion 2 document")
    require("charts" not in catalog,
            f"class {class_name}: the shipped catalog must carry no source-record chart table")
    require(catalog.get("entrySelection", {}).get("rule") == BINDING_ENTRY_RULE,
            f"class {class_name}: catalog does not declare {BINDING_ENTRY_RULE}")
    require(catalog.get("maximumEdgeDegrees", 0) > 0
            and catalog["maximumEdgeDegrees"] <= MAXIMUM_EDGE_DEGREES,
            f"class {class_name}: catalog edge bound is above the chord-sag contract")
    template = catalog["payloadNameTemplate"]
    rows = interval_rows(catalog)
    require(len(rows) == PUBLISHED_INTERVALS,
            f"class {class_name}: {len(rows)} intervals published, expected {PUBLISHED_INTERVALS}")
    directory = PACKAGE / Path(entry["catalog"]["url"]).parent
    bytes_total = catalog_path.stat().st_size
    for row in rows:
        payload = {"url": template.replace("<intervalId>", row["intervalId"]),
                   "bytes": row["bytes"], "sha256": row["sha256"]}
        path = check_asset(root, directory, payload, f"class {class_name} interval {row['intervalId']}")
        bytes_total += path.stat().st_size
    return {"class": class_name, "rows": rows, "bytes": bytes_total}


def check_tone_tables(root: Path, palaeo: dict) -> int:
    catalog_path = check_asset(root, PACKAGE, palaeo["outlineTones"]["catalog"], "outline tone catalog")
    binary_path = check_asset(root, PACKAGE, palaeo["outlineTones"]["binary"], "outline tone payload")
    catalog = json.loads(catalog_path.read_text())
    payload = binary_path.read_bytes()
    require(payload[:4] == TONE_MAGIC, "outline tone payload is not an EHPT file")
    version, header_bytes = struct.unpack_from("<HH", payload, 4)
    tables, segments, per_table = struct.unpack_from("<III", payload, 8)
    require(version == 1 and header_bytes == 32, "unsupported EHPT version")
    require(tables == PUBLISHED_INTERVALS and tables == catalog["tableCount"],
            "outline tone table count is not the published interval count")
    require(segments == catalog["segmentCount"] and per_table == catalog["bytesPerTable"]
            and per_table == -(-segments // 4),
            "outline tone header disagrees with its catalog")
    require(len(payload) == header_bytes + tables * per_table,
            "outline tone payload length disagrees with its header")
    return catalog_path.stat().st_size + binary_path.stat().st_size


def check_outer_manifest(root: Path, published: list[Path]) -> None:
    manifest = json.loads((root / OUTER_MANIFEST).read_text())
    entry = manifest.get("inputs", {}).get(OUTER_INPUT_KEY)
    require(entry is not None, f"the outer data manifest declares no {OUTER_INPUT_KEY} input")
    require(entry.get("license"), f"{OUTER_INPUT_KEY} declares no licence")
    declared = {row["path"]: row for row in entry.get("outputs", [])}
    for path in published:
        relative = str(path.relative_to(root))
        row = declared.pop(relative, None)
        require(row is not None, f"outer manifest does not declare {relative}")
        require(row["bytes"] == path.stat().st_size and row["sha256"] == sha256(path),
                f"outer manifest row for {relative} was not refreshed")
    require(not declared,
            f"outer manifest declares palaeo files that are not published: {sorted(declared)}")


def validate(root: Path = ROOT) -> dict:
    package = json.loads((root / PACKAGE / "manifest.json").read_text())
    palaeo = package.get("palaeoCoastlines")
    require(palaeo is not None, "the package manifest declares no palaeoCoastlines section")
    require(palaeo["ageDomainMa"] == AGE_DOMAIN_MA,
            "the palaeo age domain is not the 24 published Cao 2017 map intervals")
    reservation = palaeo["reservation"]
    require(0 < reservation["maxEdgeDegrees"] <= MAXIMUM_EDGE_DEGREES,
            "the declared edge bound is above the chord-sag contract")
    classes = [check_class(root, entry) for entry in palaeo["classes"]]
    schedule = [row["intervalId"] for row in classes[0]["rows"]]
    for entry in classes[1:]:
        require([row["intervalId"] for row in entry["rows"]] == schedule,
                f"class {entry['class']} publishes a different interval schedule")
    worst_triangles = max(sum(entry["rows"][index]["estimatedTrianglesAtOneDegree"]
                              for entry in classes) for index in range(len(schedule)))
    worst_bytes = max(sum(entry["rows"][index]["bytes"] for entry in classes)
                      for index in range(len(schedule)))
    require(reservation["maxIntervalTriangles"] >= worst_triangles,
            "the declared triangle reservation is below the worst interval the catalogs index")
    require(reservation["maxResidentSourceBytes"] >= worst_bytes * RESIDENT_INTERVAL_MULTIPLE,
            "the declared resident byte bound cannot hold two intervals")
    tone_bytes = check_tone_tables(root, palaeo)
    published = sorted(path for path in (root / PALAEO).rglob("*") if path.is_file())
    check_outer_manifest(root, published)
    total = sum(path.stat().st_size for path in published)
    require(total == sum(entry["bytes"] for entry in classes) + tone_bytes,
            "the published palaeo directory holds files no catalog or manifest indexes")
    return {
        "status": "pass",
        "classes": {entry["class"]: {"intervals": len(entry["rows"]), "bytes": entry["bytes"]}
                    for entry in classes},
        "outlineToneBytes": tone_bytes,
        "files": len(published),
        "bytes": total,
        "worstIntervalEstimatedTriangles": worst_triangles,
        "reservation": reservation,
    }


def expect_failure(label: str, root: Path) -> str:
    try:
        validate(root)
    except (RuntimeAssetError, KeyError, json.JSONDecodeError) as error:
        return f"{label}: rejected ({error})"
    raise SystemExit(f"self-test: {label} was accepted")


def self_test() -> dict:
    with tempfile.TemporaryDirectory() as temporary:
        root = Path(temporary)
        for relative in (PACKAGE / "manifest.json", OUTER_MANIFEST):
            (root / relative).parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(ROOT / relative, root / relative)
        shutil.copytree(ROOT / PALAEO, root / PALAEO)
        validate(root)
        package_path = root / PACKAGE / "manifest.json"
        outer_path = root / OUTER_MANIFEST
        clean_package = package_path.read_bytes()
        clean_outer = outer_path.read_bytes()
        rejections = []

        payload = root / PALAEO / "lm/palaeo-lm-94-81.ehpr"
        clean_payload = payload.read_bytes()
        flipped = bytearray(clean_payload)
        flipped[64] ^= 0xFF
        payload.write_bytes(bytes(flipped))
        rejections.append(expect_failure("a payload byte flipped under an unchanged catalog", root))
        payload.write_bytes(clean_payload)

        catalog_path = root / PALAEO / "sm/palaeo-sm-catalog.json"
        clean_catalog = catalog_path.read_bytes()
        catalog_path.write_bytes(clean_catalog + b"\n")
        rejections.append(expect_failure("a class catalog edited without a manifest update", root))
        catalog_path.write_bytes(clean_catalog)

        catalog = json.loads(clean_catalog)
        for column in catalog["intervals"]:
            if column != "count":
                catalog["intervals"][column] = catalog["intervals"][column][:-1]
        catalog["intervals"]["count"] -= 1
        dropped = json.dumps(catalog).encode()
        catalog_path.write_bytes(dropped)
        package = json.loads(clean_package)
        for entry in package["palaeoCoastlines"]["classes"]:
            if entry["surfaceClass"] == "sm":
                entry["catalog"]["bytes"] = len(dropped)
                entry["catalog"]["sha256"] = hashlib.sha256(dropped).hexdigest()
        package_path.write_text(json.dumps(package))
        rejections.append(expect_failure("one class missing an interval the other publishes", root))
        catalog_path.write_bytes(clean_catalog)
        package_path.write_bytes(clean_package)

        for field, value, label in (
            ("maxEdgeDegrees", 1.28, "an edge bound relaxed past the chord-sag contract"),
            ("maxIntervalTriangles", 1_000, "a triangle reservation below the worst interval"),
            ("maxResidentSourceBytes", 1_000, "a resident byte bound too small for two intervals"),
        ):
            package = json.loads(clean_package)
            package["palaeoCoastlines"]["reservation"][field] = value
            package_path.write_text(json.dumps(package))
            rejections.append(expect_failure(label, root))
            package_path.write_bytes(clean_package)

        outer = json.loads(clean_outer)
        outer["inputs"][OUTER_INPUT_KEY]["outputs"][0]["sha256"] = "0" * 64
        outer_path.write_text(json.dumps(outer))
        rejections.append(expect_failure("an outer-manifest row that was never refreshed", root))
        outer = json.loads(clean_outer)
        outer["inputs"][OUTER_INPUT_KEY]["outputs"].pop()
        outer_path.write_text(json.dumps(outer))
        rejections.append(expect_failure("a published file the outer manifest does not declare", root))
        outer_path.write_bytes(clean_outer)

        restored = validate(root)
    return {"status": "pass", "rejections": rejections, "restored": restored["status"]}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    try:
        result = self_test() if args.self_test else validate()
    except RuntimeAssetError as error:
        print(f"validate-palaeo-coastlines-runtime: FAIL: {error}", file=sys.stderr)
        return 1
    print(json.dumps(result, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
