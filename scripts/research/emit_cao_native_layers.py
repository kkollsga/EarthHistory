#!/usr/bin/env python3
"""Emit exact-knot Cao boundary and instantaneous topology ownership layers."""

from __future__ import annotations
import hashlib, json, math, struct
from pathlib import Path
from cao_domain import CAO_SOURCE_OLDEST_MA, CAO_SOURCE_YOUNGEST_MA, display_checkpoint_ages_ma
import pygplates

ROOT = Path(__file__).resolve().parents[2]
MODEL = ROOT.parent / "EarthHistory-data/palaeomap-study/plates/extracted/cao2024-v2.4/1.8Ga_model_GSF"
DEFAULT_OUT = ROOT.parent / "EarthHistory-data/palaeomap-study/verification/reconstruction-cao-foundation-v1/full-package"
PACKAGE = "cao-v2.4-foundation-v1"
REVISION = "cao-foundation-v1"
AGES = tuple(display_checkpoint_ages_ma(CAO_SOURCE_OLDEST_MA))
ROTATION_FILES = ("1000_0_rotfile.rot", "1800_1000_rotfile.rot")
FILES = ("250-0_plate_boundaries.gpml", "410-250_plate_boundaries.gpml", "1000-410_plate_boundaries.gpml", "1800-1000_plate_boundaries.gpml", "TopologyBuildingBlocks.gpml")
OUT = DEFAULT_OUT
PACKAGE_FRAME = None


def sha(path): return hashlib.sha256(path.read_bytes()).hexdigest()
def asset(path): return {"url": path.name, "bytes": path.stat().st_size, "sha256": sha(path)}


def frame():
    if PACKAGE_FRAME is not None:
        return PACKAGE_FRAME
    return {
        "modelId": "cao-et-al-2024", "modelVersion": "2.4",
        "absoluteFrameId": "palaeomagnetic", "anchorPlateId": 0,
        "axisConvention": "gplates-x0e-y90e-znorth",
        "rotationSha256": hashlib.sha256("".join(sha(MODEL / name) for name in ROTATION_FILES).encode()).hexdigest(),
        "topologySha256": hashlib.sha256("".join(sha(MODEL / x) for x in FILES).encode()).hexdigest(),
    }


def xyz(latlon):
    lat, lon = map(math.radians, latlon)
    return math.cos(lat) * math.cos(lon), math.cos(lat) * math.sin(lon), math.sin(lat)


def write_points(path, magic, points, source_age):
    data = bytearray(32 + 12 * len(points)); data[:4] = magic
    struct.pack_into("<HHIIIIII", data, 4, 2, 32, len(points), 12, round(source_age * 1_000_000), 0, 0, 0)
    for index, point in enumerate(points): struct.pack_into("<fff", data, 32 + index * 12, *point)
    if len(data) > 8 * 1024 * 1024: raise ValueError(f"native layer exceeds 8 MiB: {path}")
    path.write_bytes(data)


def one_owner(side):
    return side[0] if len(side) == 1 else None


def boundary_kind(source_type):
    lower = source_type.lower()
    if "ridge" in lower: return "ridge"
    if "subduction" in lower: return "subduction"
    if "transform" in lower: return "transform"
    return "other"


def finite_time(value, fallback):
    return float(value) if math.isfinite(value) else fallback


def identity(topology):
    feature = topology.get_feature()
    return {"topologyFeatureId": str(feature.get_feature_id()),
            "plateId": feature.get_reconstruction_plate_id(None)}


def boundary_records(age, features, rotations):
    resolved, sections = [], []
    pygplates.resolve_topologies(features, rotations, resolved, age, sections, anchor_plate_id=0)
    records = []
    for section in sections:
        feature = section.get_feature(); source_type = str(feature.get_feature_type()).split(":")[-1]
        polarity = None
        if feature.get_feature_type() == pygplates.FeatureType.gpml_subduction_zone:
            polarity = feature.get_enumeration(pygplates.PropertyName.gpml_subduction_polarity)
        oldest, youngest = feature.get_valid_time()
        for part, shared in enumerate(section.get_shared_sub_segments()):
            sides = [[], []]
            for topology, is_left in zip(shared.get_sharing_resolved_topologies(),
                                         shared.get_sharing_resolved_topology_on_left_flags()):
                sides[1 if is_left else 0].append(identity(topology))
            records.append({"exactSlotSegmentId": f"{age:g}:{feature.get_feature_id()}:part:{part}",
                            "sourceFeatureId": str(feature.get_feature_id()), "resolvedPart": part,
                            "sourceType": source_type, "polarity": polarity,
                            "validTimeMa": [finite_time(oldest, CAO_SOURCE_OLDEST_MA), finite_time(youngest, CAO_SOURCE_YOUNGEST_MA)],
                            "geometryLatLon": [point.to_lat_lon() for point in shared.get_resolved_geometry_points()],
                            "sideOwners": sides})
    return records


def emit_boundaries(age_result):
    age = age_result["ageMa"]; points = []; segments = []
    for record in age_result["segments"]:
        geometry = [xyz(pair) for pair in record.get("geometryLatLon", [])]
        if len(geometry) < 2: continue
        offset = len(points); points.extend(geometry)
        sides = record.get("sideOwners", [[], []]); right = one_owner(sides[0]); left = one_owner(sides[1])
        status = "resolved" if right and left else ("ambiguous" if any(len(x) > 1 for x in sides) else "unknown")
        polarity = str(record.get("polarity") or "unknown").lower()
        if polarity not in ("left", "right"): polarity = "unknown"
        valid = record.get("validTimeMa", [age, age])
        def finite(value, fallback): return fallback if isinstance(value, str) else float(value)
        segments.append({
            "segmentId": record["exactSlotSegmentId"], "sourceFeatureId": record["sourceFeatureId"],
            "sourcePart": record["resolvedPart"], "sourceFeatureType": record["sourceType"],
            "validTimeMa": {"youngest": finite(valid[1], CAO_SOURCE_YOUNGEST_MA), "oldest": finite(valid[0], CAO_SOURCE_OLDEST_MA)},
            "kind": boundary_kind(record["sourceType"]), "polarity": polarity,
            "rightTopologyId": right["topologyFeatureId"] if right else None,
            "leftTopologyId": left["topologyFeatureId"] if left else None,
            "rightPlateId": right["plateId"] if right else None, "leftPlateId": left["plateId"] if left else None,
            "ownershipStatus": status, "pointOffset": offset, "pointCount": len(geometry),
        })
    binary = OUT / f"boundary-{age:g}ma.ehnb"; write_points(binary, b"EHNB", points, age)
    catalog = {"schemaVersion": 2, "packageId": PACKAGE, "revision": REVISION, "frame": frame(),
               "sourceAgeMa": age, "pointEncoding": "ehnb-v2-f32xyz", "pointRecordBytes": 12, "binary": asset(binary),
               "segments": segments}
    path = OUT / f"boundary-{age:g}ma.json"; path.write_text(json.dumps(catalog, separators=(",", ":")) + "\n")
    return {"sourceAgeMa": age, "catalog": asset(path), "binary": asset(binary)}


def polygon_rings(geometry):
    if not isinstance(geometry, pygplates.PolygonOnSphere): return []
    rings = [geometry.get_exterior_ring_points()]
    rings.extend(geometry.get_interior_ring_points(index) for index in range(geometry.get_number_of_interior_rings()))
    return rings


def emit_ownership(age, features, rotations):
    resolved = []; pygplates.resolve_topologies(features, rotations, resolved, age, anchor_plate_id=0)
    points = []; rings = []
    for topology in resolved:
        if not isinstance(topology, pygplates.ResolvedTopologicalBoundary): continue
        feature = topology.get_feature(); fid = str(feature.get_feature_id()); plate = feature.get_reconstruction_plate_id(None)
        for part, ring in enumerate(polygon_rings(topology.get_resolved_boundary())):
            values = [tuple(point.to_xyz()) for point in ring]
            if len(values) < 3: continue
            offset = len(points); points.extend(values)
            rings.append({"ringId": f"{age:g}:{fid}:{part}", "polygonId": f"{age:g}:{fid}",
                          "ringRole": "exterior" if part == 0 else "hole", "topologyId": fid,
                          "plateId": plate, "status": "instantaneous-owner" if plate is not None else "unknown",
                          "candidatePlateIds": [] if plate is None else [plate],
                          "pointOffset": offset, "pointCount": len(values)})
    binary = OUT / f"ownership-{age:g}ma.ehto"; write_points(binary, b"EHTO", points, age)
    catalog = {"schemaVersion": 2, "packageId": PACKAGE, "revision": REVISION, "frame": frame(),
               "sourceAgeMa": age, "pointEncoding": "ehto-v2-f32xyz", "pointRecordBytes": 12,
               "binary": asset(binary), "rings": rings}
    path = OUT / f"ownership-{age:g}ma.json"; path.write_text(json.dumps(catalog, separators=(",", ":")) + "\n")
    return {"sourceAgeMa": age, "catalog": asset(path), "binary": asset(binary)}


def main(out: Path | None = None):
    global OUT, PACKAGE_FRAME
    OUT = Path(out) if out else DEFAULT_OUT
    OUT.mkdir(parents=True, exist_ok=True)
    PACKAGE_FRAME = json.loads((OUT / "manifest.json").read_text())["frame"]
    features = [feature for name in FILES for feature in pygplates.FeatureCollection(str(MODEL / name))]
    rotations = pygplates.RotationModel([str(MODEL / name) for name in ROTATION_FILES], default_anchor_plate_id=0)
    result = {"boundary": {}, "ownership": {}}
    for age in AGES:
        result["boundary"][str(age)] = emit_boundaries({"ageMa": age, "segments": boundary_records(age, features, rotations)})
        result["ownership"][str(age)] = emit_ownership(age, features, rotations)
        checkpoint_path = OUT / f"checkpoint-{age:g}ma.json"
        checkpoint = json.loads(checkpoint_path.read_text())
        checkpoint["nativeBoundaryLayer"] = result["boundary"][str(age)]
        checkpoint["topologyOwnershipLayer"] = result["ownership"][str(age)]
        checkpoint_path.write_text(json.dumps(checkpoint, separators=(",", ":")) + "\n")
    manifest_path = OUT / "manifest.json"
    manifest = json.loads(manifest_path.read_text())
    refreshed = []
    for row in manifest["checkpoints"]:
        path = OUT / Path(row["url"]).name
        checkpoint = json.loads(path.read_text())
        transitive = path.stat().st_size
        for key in ("nativeBoundaryLayer", "topologyOwnershipLayer"):
            if key in checkpoint:
                transitive += checkpoint[key]["catalog"]["bytes"] + checkpoint[key]["binary"]["bytes"]
        refreshed.append({"ageMa": row["ageMa"], **asset(path), "transitiveBytes": transitive})
    manifest["checkpoints"] = refreshed
    manifest_path.write_text(json.dumps(manifest, separators=(",", ":")) + "\n")
    (OUT / "native-layer-assets.json").write_text(json.dumps(result, indent=2) + "\n")
    total = sum(path.stat().st_size for path in OUT.iterdir() if path.is_file())
    report = {"packageBytes": total,
              "boundaryBytes": sum(v["catalog"]["bytes"] + v["binary"]["bytes"] for v in result["boundary"].values()),
              "ownershipBytes": sum(v["catalog"]["bytes"] + v["binary"]["bytes"] for v in result["ownership"].values()),
              "overBudget": total > 50 * 1024 * 1024}
    print(json.dumps(report))
    if total > 50 * 1024 * 1024:
        raise SystemExit(f"candidate package exceeds app budget: {total} bytes")


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=None)
    main(**vars(parser.parse_args()))
