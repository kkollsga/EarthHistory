#!/usr/bin/env python3
"""Bind Natural Earth complement segments to the Cao fragment verified at a shared endpoint.

The 0 Ma complement appended by ``apply_cao_modern_country_reference.py`` bound
every subdivision the static-polygon partitioner rejected to an exact-present
locator chart whose lifecycle is [0, 0] Ma. Those segments therefore vanished at
every reconstructed age and the modern-country overlay read as a dashed line.

A rejected subdivision shares a float32-exact endpoint with an accepted
subdivision whenever the two are adjacent on the same Natural Earth ring, and
the partitioner positively placed that shared endpoint inside the accepted
subdivision's Cao static fragment. This repair rebinds such a subdivision to
that fragment's chart, so the segment follows authored Cao plate motion that was
verified at one of its own endpoints. Geometry, country identity, segment order
and the 0 Ma appearance are untouched.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import struct
import tempfile
from copy import deepcopy
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
PUBLIC = (ROOT / "public/data/reconstruction/cao-v2.4").resolve()
ROOT_MANIFEST = ROOT / "public/data/manifest.json"
CONTRACT = ROOT / "data/corrections/country-reference/source-fragment-bridge-v1.json"
# Tracked measurement reports that pin the package assets they were measured
# against. The bridge rewrites core.json and the correction catalog's baseline
# digest only; the motion palette those reports actually measure is untouched.
IDENTITY_PINNED_REPORTS = (ROOT / "docs/research/regional-iceland-motion-validation.json",)
BRIDGE_ID = "earthhistory-country-reference-source-fragment-bridge-v1"
PRESENT_PREFIX = "country-present-reference:"
FRAGMENT_PREFIX = "country:"
HEADER_BYTES = 32
SCOPE_CLAUSE = (
    " Complement segments sharing a verified endpoint with an accepted native segment follow that "
    "segment's Cao static fragment above 0 Ma; the rest remain exact-present only."
)


class BuildError(ValueError):
    pass


def sha256(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha(path: Path) -> str:
    return sha256(path.read_bytes())


def canonical(value: object) -> bytes:
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n").encode()


def compact(value: object) -> bytes:
    """Serialization used by the emitted material-correction catalog."""
    return (json.dumps(value, separators=(",", ":")) + "\n").encode()


def asset(path: Path, url: str | None = None) -> dict:
    return {"url": url or path.name, "bytes": path.stat().st_size, "sha256": sha(path)}


def write_atomic(path: Path, value: bytes) -> None:
    temporary = path.with_name(path.name + ".country-bridge-stage")
    temporary.write_bytes(value)
    os.replace(temporary, path)


def decode_ehgl(data: bytes) -> dict:
    if len(data) < HEADER_BYTES or data[:4] != b"EHGL":
        raise BuildError("invalid EHGL geometry")
    version, header, vertices, segments, *reserved = struct.unpack_from("<HHIIIIII", data, 4)
    if (version, header) != (2, HEADER_BYTES) or any(reserved):
        raise BuildError("unsupported EHGL geometry header")
    if len(data) != HEADER_BYTES + 16 * vertices + 8 * segments:
        raise BuildError("EHGL byte count changed")
    offset = HEADER_BYTES
    directions = [struct.unpack_from("<fff", data, offset + 12 * index) for index in range(vertices)]
    offset += 12 * vertices
    charts = list(struct.unpack_from(f"<{vertices}I", data, offset))
    offset += 4 * vertices
    indices = list(struct.unpack_from(f"<{2 * segments}I", data, offset))
    return {"directions": directions, "charts": charts, "indices": indices}


def encode_ehgl(directions, charts, indices) -> bytes:
    vertices = len(directions)
    if len(charts) != vertices or len(indices) % 2:
        raise BuildError("inconsistent EHGL arrays")
    segments = len(indices) // 2
    payload = bytearray(HEADER_BYTES + 16 * vertices + 8 * segments)
    payload[:4] = b"EHGL"
    struct.pack_into("<HHIIIIII", payload, 4, 2, HEADER_BYTES, vertices, segments, 0, 0, 0, 0)
    offset = HEADER_BYTES
    for row in directions:
        struct.pack_into("<fff", payload, offset, *row)
        offset += 12
    for value in charts:
        struct.pack_into("<I", payload, offset, value)
        offset += 4
    for value in indices:
        struct.pack_into("<I", payload, offset, value)
        offset += 4
    return bytes(payload)


def country_of(chart: dict) -> str:
    material = chart.get("materialId", "")
    if chart.get("role") != "country-reference" or not material.startswith(FRAGMENT_PREFIX):
        raise BuildError("country line vertex references a non-country chart")
    return material[len(FRAGMENT_PREFIX):]


def segment_chart(geometry: dict, segment: int) -> int:
    left, right = geometry["indices"][segment * 2:segment * 2 + 2]
    if geometry["charts"][left] != geometry["charts"][right]:
        raise BuildError("country line segment crosses chart ownership")
    return geometry["charts"][left]


def segment_endpoints(geometry: dict, segment: int) -> tuple:
    left, right = geometry["indices"][segment * 2:segment * 2 + 2]
    return geometry["directions"][left], geometry["directions"][right]


def blocked_donor_chart_ids(package: Path, manifest: dict) -> frozenset[str]:
    """Country charts a native chart override already owns as source-domain segments.

    Their segments are gated by preselected nearest replacement domains computed
    offline with the regional 12 km corridor, so a complement segment cannot join
    them without that corridor evidence.
    """
    declared = manifest.get("materialCorrections")
    if not declared:
        return frozenset()
    catalog = json.loads((package / declared["catalog"]["url"]).read_text())
    return frozenset(chart_id for override in catalog.get("nativeChartOverrides", [])
                     for chart_id in override["dependentConsumers"]["sourceCountryChartIds"])


def derive(core: dict, geometry: dict, baseline_segments: int,
           blocked: frozenset[str] = frozenset()) -> dict:
    """Re-derives the bridge from the package alone.

    Accepted ownership is read only from baseline subdivisions, so the result is
    identical before and after the repair and never chains one inferred binding
    onto another.
    """
    charts = core["charts"]
    total_segments = len(geometry["indices"]) // 2
    if baseline_segments <= 0 or baseline_segments >= total_segments:
        raise BuildError("complement range is empty")
    accepted: dict[tuple, list[tuple[str, int]]] = {}
    for segment in range(baseline_segments):
        chart_index = segment_chart(geometry, segment)
        chart = charts[chart_index]
        if chart["chartId"].startswith(PRESENT_PREFIX):
            raise BuildError("baseline country segment carries an exact-present locator chart")
        if chart["chartId"] in blocked:
            continue
        country = country_of(chart)
        for point in segment_endpoints(geometry, segment):
            accepted.setdefault((country, point), []).append((chart["chartId"], segment, chart_index))
    bridged: dict[int, int] = {}
    unbridged: list[int] = []
    for segment in range(baseline_segments, total_segments):
        country = country_of(charts[segment_chart(geometry, segment)])
        left, right = segment_endpoints(geometry, segment)
        candidates = accepted.get((country, left)) or accepted.get((country, right)) or []
        if candidates:
            bridged[segment] = sorted(candidates)[0][2]
        else:
            unbridged.append(segment)
    return {"bridged": bridged, "unbridged": unbridged}


def ownership_digests(core: dict, bridge: dict) -> dict:
    charts = core["charts"]
    bridged = sha256(b"".join(
        struct.pack("<I", segment) + charts[chart_index]["chartId"].encode() + b"\0"
        for segment, chart_index in sorted(bridge["bridged"].items())
    ))
    unbridged = sha256(b"".join(
        struct.pack("<I", segment) for segment in sorted(bridge["unbridged"])
    ))
    return {"bridgedOwnershipSha256": bridged, "exactPresentOwnershipSha256": unbridged}


def load_contract() -> dict:
    contract = json.loads(CONTRACT.read_text())
    if contract.get("schemaVersion") != 1 or contract.get("bridgeId") != BRIDGE_ID:
        raise BuildError("country-segment bridge contract identity changed")
    return contract


def apply(package: Path) -> dict:
    package = package.resolve()
    contract = load_contract()
    core_path, manifest_path = package / "core.json", package / "manifest.json"
    core = json.loads(core_path.read_text())
    manifest = json.loads(manifest_path.read_text())
    if manifest["core"] != asset(core_path):
        raise BuildError("package core identity is stale")
    line_batch = next(row for row in core["lineBatches"] if row["batchId"] == contract["lineBatch"]["batchId"])
    line_path = package / line_batch["geometryAsset"]["url"]
    if line_batch["geometryAsset"] != asset(line_path):
        raise BuildError("package country line identity is stale")
    origin = contract["origin"]
    if sha(core_path) != origin["coreSha256"] or sha(line_path) != origin["lineSha256"]:
        raise BuildError("package is not the pinned pre-bridge country-reference baseline")
    geometry = decode_ehgl(line_path.read_bytes())
    original_geometry = deepcopy(geometry)
    original_charts = deepcopy(core["charts"])
    bridge = derive(core, geometry, contract["lineBatch"]["baselineSegmentCount"],
                    blocked_donor_chart_ids(package, manifest))

    for segment, chart_index in bridge["bridged"].items():
        left, right = geometry["indices"][segment * 2:segment * 2 + 2]
        geometry["charts"][left] = chart_index
        geometry["charts"][right] = chart_index
    donor_indices = sorted(set(bridge["bridged"].values()))
    expected = contract["donorEvidence"]["limitations"]
    for chart_index in donor_indices:
        limitations = core["charts"][chart_index]["evidence"]["limitations"]
        if list(limitations) != expected[:-1]:
            raise BuildError("donor chart evidence is not the pinned pre-bridge text")
        core["charts"][chart_index]["evidence"]["limitations"] = list(expected)

    write_atomic(line_path, encode_ehgl(geometry["directions"], geometry["charts"], geometry["indices"]))
    line_batch["geometryAsset"] = asset(line_path)
    write_atomic(core_path, canonical(core))
    manifest["core"] = asset(core_path)
    if SCOPE_CLAUSE.strip() not in manifest["scope"]:
        manifest["scope"] += SCOPE_CLAUSE
    rebased = rebase_material_correction_baseline(package, manifest, origin["coreSha256"], sha(core_path))
    if package == PUBLIC:
        rebase_identity_pinned_reports(package, manifest)
    write_atomic(manifest_path, canonical(manifest))
    if package == PUBLIC and ROOT_MANIFEST.is_file():
        update_root_manifest([core_path, line_path, manifest_path, *rebased])
    return validate_applied(package, original_geometry=original_geometry, original_charts=original_charts)


def rebase_material_correction_baseline(package: Path, manifest: dict,
                                        old_core_sha: str, new_core_sha: str) -> list[Path]:
    """Repoints only ``baseline.coreSha256`` at the rewritten core."""
    declared = manifest.get("materialCorrections")
    if not declared:
        return []
    catalog_url = declared["catalog"]["url"]
    catalog_path = package / catalog_url
    if declared["catalog"] != asset(catalog_path, catalog_url):
        raise BuildError("material correction catalog identity is stale")
    original = json.loads(catalog_path.read_text())
    if original["baseline"]["coreSha256"] != old_core_sha:
        raise BuildError("material correction baseline is not the pinned pre-bridge core")
    if compact(original) != catalog_path.read_bytes():
        raise BuildError("material correction catalog serialization does not round-trip")
    catalog = deepcopy(original)
    catalog["baseline"]["coreSha256"] = new_core_sha
    write_atomic(catalog_path, compact(catalog))
    declared["catalog"] = asset(catalog_path, catalog_url)
    return [catalog_path]


def rebase_identity_pinned_reports(package: Path, manifest: dict) -> list[Path]:
    """Repoints tracked measurement reports at the rewritten package identities.

    Only the core and material-correction catalog pins move. The motion palette
    assets the residuals were measured against, and every measured field, must be
    byte-identical or the rebase is refused: this is an identity refresh, never a
    substitute for re-running the oracle.
    """
    catalog = manifest.get("materialCorrections", {}).get("catalog")
    touched = []
    for report_path in IDENTITY_PINNED_REPORTS:
        if not report_path.is_file():
            continue
        report = json.loads(report_path.read_text())
        assets = report["packageAssets"]
        expected = deepcopy(report)
        expected["packageAssets"] = {**assets, "core": manifest["core"],
                                     "materialCorrectionCatalog": catalog}
        expected["packageAssetsRebasedBy"] = sorted(
            {*report.get("packageAssetsRebasedBy", []), BRIDGE_ID})
        if (expected["packageAssets"]["motionPaletteCatalog"] != assets["motionPaletteCatalog"]
                or expected["packageAssets"]["motionPaletteBinary"] != assets["motionPaletteBinary"]):
            raise BuildError(f"{report_path.name} measures a motion palette the bridge would change")
        measured = {key: value for key, value in report.items()
                    if key not in ("packageAssets", "packageAssetsRebasedBy")}
        if measured != {key: value for key, value in expected.items()
                        if key not in ("packageAssets", "packageAssetsRebasedBy")}:
            raise BuildError(f"{report_path.name} rebase would change measured evidence")
        if json.dumps(report, indent=2) + "\n" != report_path.read_text():
            raise BuildError(f"{report_path.name} serialization does not round-trip")
        report_path.write_text(json.dumps(expected, indent=2) + "\n")
        touched.append(report_path)
    return touched


def update_root_manifest(paths: list[Path]) -> None:
    manifest = json.loads(ROOT_MANIFEST.read_text())
    rows = [row for entry in manifest["inputs"].values() for row in entry.get("outputs", [])]
    for path in paths:
        relative = str(path.relative_to(ROOT))
        matches = [row for row in rows if row["path"] == relative]
        if len(matches) != 1:
            raise BuildError(f"root manifest has {len(matches)} outputs for {relative}")
        matches[0].update({"bytes": path.stat().st_size, "sha256": sha(path)})
    ROOT_MANIFEST.write_text(json.dumps(manifest, indent=2) + "\n")


def validate_applied(package: Path, *, original_geometry=None, original_charts=None) -> dict:
    package = package.resolve()
    contract = load_contract()
    core_path, manifest_path = package / "core.json", package / "manifest.json"
    core = json.loads(core_path.read_text())
    manifest = json.loads(manifest_path.read_text())
    if manifest["core"] != asset(core_path):
        raise BuildError("package core identity is stale")
    line_batch = next(row for row in core["lineBatches"] if row["batchId"] == contract["lineBatch"]["batchId"])
    line_path = package / line_batch["geometryAsset"]["url"]
    if line_batch["geometryAsset"] != asset(line_path):
        raise BuildError("applied country line identity is stale")
    declared = contract["lineBatch"]
    if (line_batch["segmentCount"] != declared["totalSegmentCount"]
            or line_batch["vertexCount"] != declared["totalVertexCount"]):
        raise BuildError("country line inventory changed")
    if SCOPE_CLAUSE.strip() not in manifest["scope"]:
        raise BuildError("package scope does not declare the source-fragment bridge")
    declared_corrections = manifest.get("materialCorrections")
    if declared_corrections:
        catalog_url = declared_corrections["catalog"]["url"]
        catalog_path = package / catalog_url
        if declared_corrections["catalog"] != asset(catalog_path, catalog_url):
            raise BuildError("material correction catalog identity is stale")
        if json.loads(catalog_path.read_text())["baseline"]["coreSha256"] != manifest["core"]["sha256"]:
            raise BuildError("material correction baseline does not follow the bridged core")
        if package == PUBLIC:
            for report_path in IDENTITY_PINNED_REPORTS:
                if not report_path.is_file():
                    continue
                assets = json.loads(report_path.read_text())["packageAssets"]
                if (assets["core"] != manifest["core"]
                        or assets["materialCorrectionCatalog"] != declared_corrections["catalog"]):
                    raise BuildError(f"{report_path.name} does not pin the bridged package identities")
    geometry = decode_ehgl(line_path.read_bytes())
    baseline = declared["baselineSegmentCount"]
    bridge = derive(core, geometry, baseline, blocked_donor_chart_ids(package, manifest))
    expected = contract["bridge"]

    charts = core["charts"]
    for segment, chart_index in bridge["bridged"].items():
        current = segment_chart(geometry, segment)
        if current != chart_index:
            raise BuildError(f"complement segment {segment} does not follow its verified source fragment")
        if charts[current]["chartId"].startswith(PRESENT_PREFIX):
            raise BuildError(f"complement segment {segment} still carries an exact-present locator chart")
    for segment in bridge["unbridged"]:
        if not charts[segment_chart(geometry, segment)]["chartId"].startswith(PRESENT_PREFIX):
            raise BuildError(f"complement segment {segment} claims a source fragment it cannot verify")
    donor_indices = sorted(set(bridge["bridged"].values()))
    donor_text = list(contract["donorEvidence"]["limitations"])
    for chart_index, chart in enumerate(charts):
        if chart.get("role") != "country-reference" or not chart["chartId"].startswith(FRAGMENT_PREFIX):
            continue
        limitations = list(chart["evidence"]["limitations"])
        if chart_index in bridge["bridged"].values():
            if limitations != donor_text:
                raise BuildError(f"donor chart {chart['chartId']} does not declare the bridged-endpoint limitation")
        elif limitations != donor_text[:-1]:
            raise BuildError(f"country chart {chart['chartId']} evidence changed outside the bridge")
    digests = ownership_digests(core, bridge)
    observed = {
        "complementSegmentCount": declared["totalSegmentCount"] - baseline,
        "bridgedSegmentCount": len(bridge["bridged"]),
        "exactPresentBoundSegmentCount": len(bridge["unbridged"]),
        "donorChartCount": len(donor_indices),
        **digests,
    }
    for key, value in observed.items():
        if expected.get(key) != value:
            raise BuildError(f"country-segment bridge {key} changed: {expected.get(key)!r} != {value!r}")
    if original_geometry is not None:
        if (geometry["directions"] != original_geometry["directions"]
                or geometry["indices"] != original_geometry["indices"]
                or geometry["charts"][:declared["baselineVertexCount"]]
                != original_geometry["charts"][:declared["baselineVertexCount"]]):
            raise BuildError("bridge changed country line geometry or baseline ownership")
    if original_charts is not None:
        allowed = set(donor_indices)
        for index, (before, after) in enumerate(zip(original_charts, charts)):
            if index in allowed:
                before = deepcopy(before)
                before["evidence"]["limitations"] = donor_text
            if before != after:
                raise BuildError("bridge changed core charts outside donor evidence")
    return observed


def self_test() -> dict:
    """Proves the derivation binds a shared endpoint, isolates an orphan, and rejects a mutation."""
    def point(value):
        return struct.unpack("<fff", struct.pack("<fff", *value))

    a, b, c, d = point((1, 0, 0)), point((0, 1, 0)), point((0, 0, 1)), point((0, -1, 0))
    core = {
        "lineBatches": [{"batchId": "country-reference", "vertexCount": 8, "segmentCount": 4,
                         "geometryAsset": {"url": "country-reference.ehgl"}}],
        "charts": [
            {"chartId": "country:xxx:plate:701:fragment:A:0-410", "role": "country-reference",
             "materialId": "country:xxx", "evidence": {"limitations": ["p", "q", "r"]}},
            {"chartId": "country:xxx:plate:702:fragment:B:0-410", "role": "country-reference",
             "materialId": "country:xxx", "evidence": {"limitations": ["p", "q", "r"]}},
            {"chartId": "country-present-reference:xxx", "role": "country-reference",
             "materialId": "country:xxx", "evidence": {"limitations": ["s"]}},
        ],
    }
    # Two accepted baseline segments (a-b on fragment B, b-c on fragment A), one
    # complement segment bridging b and one complement segment touching nothing.
    directions = [a, b, b, c, b, d, point((0.6, 0.8, 0)), point((0.8, 0.6, 0))]
    chart_indices = [1, 1, 0, 0, 2, 2, 2, 2]
    indices = [0, 1, 2, 3, 4, 5, 6, 7]
    geometry = {"directions": directions, "charts": chart_indices, "indices": indices}
    bridge = derive(core, geometry, 2)
    # Both accepted charts share endpoint b; (chartId, segment) ordering selects
    # the fragment-A chart, and the orphan complement segment stays unbridged.
    if bridge["bridged"] != {2: 0} or bridge["unbridged"] != [3]:
        raise BuildError(f"self-test derivation changed: {bridge}")
    blocked = derive(core, geometry, 2, frozenset({"country:xxx:plate:701:fragment:A:0-410"}))
    if blocked["bridged"] != {2: 1} or blocked["unbridged"] != [3]:
        raise BuildError(f"self-test blocked donor was not skipped: {blocked}")
    mutated = {**geometry, "charts": list(chart_indices)}
    mutated["charts"][4] = mutated["charts"][5] = 1
    if derive(core, mutated, 2)["bridged"] != {2: 0}:
        raise BuildError("self-test mutation was not re-derived independently of current ownership")
    round_trip = decode_ehgl(encode_ehgl(directions, chart_indices, indices))
    if round_trip != geometry:
        raise BuildError("self-test EHGL round trip changed")
    with tempfile.TemporaryDirectory() as temporary:
        package = Path(temporary)
        (package / "core.json").write_bytes(canonical({"charts": []}))
        try:
            apply(package)
        except (BuildError, KeyError, FileNotFoundError):
            pass
        else:
            raise BuildError("self-test apply accepted a package without the pinned baseline")
    return {"bridged": len(bridge["bridged"]), "unbridged": len(bridge["unbridged"])}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--package", type=Path, default=PUBLIC)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--self-test", action="store_true")
    parser.add_argument("--print-contract", action="store_true",
                        help="print the observed bridge inventory without comparing it to the contract")
    args = parser.parse_args()
    if args.self_test:
        print(json.dumps(self_test(), indent=2, sort_keys=True))
        if not (args.apply or args.print_contract):
            return
    if args.print_contract:
        package = args.package.resolve()
        core = json.loads((package / "core.json").read_text())
        line_batch = next(row for row in core["lineBatches"] if row["batchId"] == "country-reference")
        geometry = decode_ehgl((package / line_batch["geometryAsset"]["url"]).read_bytes())
        contract = load_contract()
        manifest = json.loads((package / "manifest.json").read_text())
        bridge = derive(core, geometry, contract["lineBatch"]["baselineSegmentCount"],
                        blocked_donor_chart_ids(package, manifest))
        print(json.dumps({
            "complementSegmentCount": len(geometry["indices"]) // 2
            - contract["lineBatch"]["baselineSegmentCount"],
            "bridgedSegmentCount": len(bridge["bridged"]),
            "exactPresentBoundSegmentCount": len(bridge["unbridged"]),
            "donorChartCount": len(set(bridge["bridged"].values())),
            **ownership_digests(core, bridge),
        }, indent=2, sort_keys=True))
        return
    result = apply(args.package) if args.apply else validate_applied(args.package)
    print(json.dumps(result, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
