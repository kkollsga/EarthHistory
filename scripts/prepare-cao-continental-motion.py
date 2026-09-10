#!/usr/bin/env python3
"""Export Cao 2024 v2.4 static continental material partitions.

These child-plate polygons are distinct from the instantaneous resolved
topological containers. For example, India remains static fragment 501 while
its 250 Ma enclosing Gondwana topology has plate ID 701.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import pathlib
import struct


ROOT = pathlib.Path(__file__).resolve().parents[1]
DEFAULT_MODEL_DIR = ROOT.parent / "EarthHistory-data/palaeomap-study/plates/extracted/cao2024-v2.4/1.8Ga_model_GSF"
DEFAULT_BINARY = ROOT / "public/data/cao-continental-motion-v1.bin"
DEFAULT_METADATA = ROOT / "public/data/cao-continental-motion-v1.json"
SOURCE_RECORD = "https://doi.org/10.5281/zenodo.13628813"
SOURCE_ARCHIVE_SHA256 = "4ae9158a29c597b46f687f8c3f0f5a4a55df5ab69bde18e24257a17d358d8592"
SOURCE_FILE = "shapes_continents.gpmlz"
SCALE_DEGREES = 180 / 32767
HEADER = struct.Struct("<4sHHII")
MAX_COMBINED_BYTES = 650 * 1024


def sha256(path: pathlib.Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def finite_time(value: float) -> float | None:
    return value if math.isfinite(value) else None


def quantize(point) -> tuple[int, int]:
    latitude, longitude = point.to_lat_lon()
    longitude = ((longitude + 180) % 360) - 180
    return (
        max(-32767, min(32767, round(longitude / SCALE_DEGREES))),
        max(-32767, min(32767, round(latitude / SCALE_DEGREES))),
    )


def bounding_cap(points) -> tuple[list[float], float]:
    xyz = [point.to_xyz() for point in points]
    centre = [sum(point[index] for point in xyz) for index in range(3)]
    magnitude = math.sqrt(sum(value * value for value in centre))
    if magnitude < 1e-12:
        centre = list(xyz[0])
        magnitude = 1
    centre = [value / magnitude for value in centre]
    radius = max(math.acos(max(-1, min(1, sum(centre[index] * point[index] for index in range(3))))) for point in xyz)
    maximum_edge = max(
        math.acos(max(-1, min(1, sum(point[index] * xyz[(offset + 1) % len(xyz)][index] for index in range(3)))))
        for offset, point in enumerate(xyz)
    )
    return [round(value, 9) for value in centre], round(min(math.pi, radius + maximum_edge / 2 + 1e-9), 9)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model-dir", type=pathlib.Path, default=DEFAULT_MODEL_DIR)
    parser.add_argument("--binary-output", type=pathlib.Path, default=DEFAULT_BINARY)
    parser.add_argument("--metadata-output", type=pathlib.Path, default=DEFAULT_METADATA)
    args = parser.parse_args()
    try:
        import pygplates
    except ImportError as error:
        raise SystemExit("pyGPlates >= 1.0 is required") from error

    source_path = args.model_dir / SOURCE_FILE
    coordinates: list[int] = []
    fragments = []
    skipped = []
    for source_order, feature in enumerate(pygplates.FeatureCollection(str(source_path))):
        geometry = feature.get_geometry()
        if not isinstance(geometry, pygplates.PolygonOnSphere):
            skipped.append(str(feature.get_feature_id()))
            continue
        rings = [list(geometry.get_exterior_ring_points())]
        rings.extend(
            list(geometry.get_interior_ring_points(index))
            for index in range(geometry.get_number_of_interior_rings())
        )
        ring_records = []
        for ring in rings:
            offset = len(coordinates) // 2
            for point in ring:
                coordinates.extend(quantize(point))
            ring_records.append([offset, len(ring)])
        oldest, youngest = feature.get_valid_time()
        cap_centre, cap_radius = bounding_cap(rings[0])
        fragments.append({
            "fragmentId": f"cao-continent:{source_order}",
            "sourceFeatureId": str(feature.get_feature_id()),
            "plateId": feature.get_reconstruction_plate_id(None),
            "featureType": str(feature.get_feature_type()).split(":")[-1],
            "validTimeMa": {"oldest": finite_time(oldest), "youngest": finite_time(youngest)},
            "sourceOrder": source_order,
            "areaSteradians": round(geometry.get_area(), 12),
            "rings": ring_records,
            "boundingCap": {"centreXyz": cap_centre, "radiusRadians": cap_radius},
        })

    coordinate_bytes = struct.pack(f"<{len(coordinates)}h", *coordinates)
    binary = HEADER.pack(b"EHCN", 1, 0, len(coordinates) // 2, 0) + coordinate_bytes
    binary_sha = hashlib.sha256(binary).hexdigest()
    metadata = {
        "schemaVersion": 1,
        "id": "cao-continental-motion-v1",
        "model": {
            "id": "cao-et-al-2024",
            "version": "2.4",
            "sourceRecord": SOURCE_RECORD,
            "sourceArchiveSha256": SOURCE_ARCHIVE_SHA256,
            "license": "CC-BY-4.0",
            "referenceFrame": "palaeomagnetic",
            "anchorPlateId": 0,
        },
        "sourceMember": {"path": SOURCE_FILE, "sha256": sha256(source_path)},
        "binary": {
            "path": "cao-continental-motion-v1.bin",
            "bytes": len(binary),
            "sha256": binary_sha,
            "header": "16 bytes little-endian: EHCN; uint16 schema,reserved; uint32 coordinatePairCount,reserved",
            "coordinates": "flat int16 longitude,latitude pairs at scaleDegrees",
        },
        "coordinateEncoding": {
            "scaleDegrees": SCALE_DEGREES,
            "referenceAgeMa": 0,
            "axisConvention": "GPlates unit sphere: x=lon 0, y=lon 90E, z=north",
        },
        "partitionContract": {
            "identity": "source static continental feature and child reconstruction plate ID",
            "priority": "active reconstructed polygon area descending, matching pyGPlates SortPartitioningPlates.by_partition_type_then_plate_area",
            "topology": "instantaneous resolved topology is a containing stage and need not have the child fragment plate ID",
            "overlap": "first active containing fragment after deterministic area/source-order sort",
        },
        "fragments": fragments,
        "skippedGeometrylessFeatureIds": skipped,
        "epistemicStatus": "source-native static continental material partition; rigid child-plate reconstruction",
    }
    metadata_bytes = (json.dumps(metadata, sort_keys=True, separators=(",", ":")) + "\n").encode()
    if len(binary) + len(metadata_bytes) > MAX_COMBINED_BYTES:
        raise SystemExit(f"Cao continental controls exceed {MAX_COMBINED_BYTES} bytes")
    args.binary_output.parent.mkdir(parents=True, exist_ok=True)
    args.binary_output.write_bytes(binary)
    args.metadata_output.write_bytes(metadata_bytes)
    print(f"wrote {args.binary_output} ({len(binary)} bytes, sha256 {binary_sha})")
    print(f"wrote {args.metadata_output} ({len(metadata_bytes)} bytes, sha256 {hashlib.sha256(metadata_bytes).hexdigest()})")
    print(f"fragments {len(fragments)}, rings {sum(len(fragment['rings']) for fragment in fragments)}, coordinate pairs {len(coordinates) // 2}, skipped {len(skipped)}")


if __name__ == "__main__":
    main()
