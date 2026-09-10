#!/usr/bin/env python3
"""Export the app-pinned PALEOMAP v3 rigid-motion model for static use.

The PaleoDEM v2 report names the PALEOMAP v2d3 plate model as its tectonic
basemap. The v3 Zenodo bundle used by EarthHistory contains that model: its
rotation header identifies m15g60_v2d3 and ContOCeanPolyv10u_v2d3. This
export retains source polygon identities, valid times, and moving/fixed
rotation samples. It does not manufacture material identity outside the
source polygons or turn those static polygons into deforming topologies.

Requires pyGPlates >= 1.0. The job is offline and deterministic.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import pathlib
import tempfile
import zipfile


ROOT = pathlib.Path(__file__).resolve().parents[1]
DEFAULT_ARCHIVE = ROOT / "dev-docs" / "temp" / "earthhistory-data" / "paleomap_global_plate_model_v3.zip"
DEFAULT_OUTPUT = ROOT / "public" / "data" / "paleomap-motion-v1.json"
EXPECTED_ARCHIVE_SHA256 = "a58409f42bdb5f247e0dd543e8c3287f5d291d5928d0df730af8b2fa1ae7be65"
EXPECTED_ROTATION_BANNER = "PALEOMAP Plate Model m15g60_v2d3"
EXPECTED_POLYGON_BANNER = "ContOCeanPolyv10u_v2d3"
COORDINATE_SCALE_DEGREES = 180 / 32767
SOURCE_AGES_MA = list(range(0, 541, 5))
MAX_OUTPUT_BYTES = 2 * 1024 * 1024
POI_EVIDENCE_POINTS = {
    "chengjiang-biota": (24.7, 102.9),
    "cairo-fossil-forest": (42.3, -74.0),
    "siberian-traps": (68.0, 93.0),
    "karoo-ferrar": (-31.0, 25.0),
    "oae2": (43.5, 12.5),
    "chicxulub": (21.3, -89.5),
    "andes-volcanic-margin": (-23.5, -69.3),
    "east-african-rift": (-3.0, 36.0),
}


def sha256(path: pathlib.Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def finite_time(value: float) -> float | None:
    return value if math.isfinite(value) else None


def quantize_coordinate(longitude: float, latitude: float) -> tuple[int, int]:
    longitude = ((longitude + 180) % 360) - 180
    return (
        max(-32767, min(32767, round(longitude / COORDINATE_SCALE_DEGREES))),
        max(-32767, min(32767, round(latitude / COORDINATE_SCALE_DEGREES))),
    )


def finite_rotation_quaternion(rotation) -> list[float]:
    pole, angle = rotation.get_euler_pole_and_angle()
    x, y, z = pole.to_xyz()
    sine = math.sin(angle / 2)
    quaternion = [math.cos(angle / 2), x * sine, y * sine, z * sine]
    if quaternion[0] < 0:
        quaternion = [-value for value in quaternion]
    return [round(value, 12) for value in quaternion]


def polygon_cap(points) -> tuple[list[float], float]:
    vectors = [point.to_xyz() for point in points]
    centre = [sum(vector[index] for vector in vectors) for index in range(3)]
    magnitude = math.sqrt(sum(value * value for value in centre))
    if magnitude < 1e-12:
        centre = list(vectors[0])
        magnitude = 1
    centre = [value / magnitude for value in centre]
    radius = max(
        math.acos(max(-1, min(1, sum(centre[index] * vector[index] for index in range(3)))))
        for vector in vectors
    )
    return [round(value, 9) for value in centre], round(radius, 9)


def build_catalog(archive: pathlib.Path, pygplates) -> dict:
    actual_sha256 = sha256(archive)
    if actual_sha256 != EXPECTED_ARCHIVE_SHA256:
        raise SystemExit(f"unexpected PALEOMAP model checksum: {actual_sha256}")

    with tempfile.TemporaryDirectory(prefix="earthhistory-paleomap-motion-") as temporary:
        extraction = pathlib.Path(temporary)
        with zipfile.ZipFile(archive) as source:
            source.extractall(extraction)

        rotation_path = extraction / "PALEOMAP_PlateModel.rot"
        polygon_path = extraction / "PALEOMAP_PlatePolygons.gpml"
        rotation_text = rotation_path.read_text(encoding="utf-8", errors="replace")
        if EXPECTED_ROTATION_BANNER not in rotation_text or EXPECTED_POLYGON_BANNER not in rotation_text:
            raise SystemExit("the pinned rotation file no longer identifies the PaleoDEM v2d3 model")

        polygon_features = list(pygplates.FeatureCollection(str(polygon_path)))
        coordinates: list[int] = []
        fragments: list[dict] = []
        excluded_geometries: list[dict] = []
        for source_feature_index, feature in enumerate(polygon_features):
            feature_id = str(feature.get_feature_id())
            plate_id = feature.get_reconstruction_plate_id(None)
            valid_oldest, valid_youngest = feature.get_valid_time()
            for geometry_index, geometry in enumerate(feature.get_all_geometries()):
                if not hasattr(geometry, "get_exterior_ring_points"):
                    excluded_geometries.append(
                        {
                            "sourceFeatureId": feature_id,
                            "geometryIndex": geometry_index,
                            "reason": "non-polygon geometry cannot partition material",
                        }
                    )
                    continue
                points = list(geometry.get_exterior_ring_points())
                offset = len(coordinates) // 2
                for point in points:
                    latitude, longitude = point.to_lat_lon()
                    coordinates.extend(quantize_coordinate(longitude, latitude))
                cap_centre, cap_radius = polygon_cap(points)
                fragments.append(
                    {
                        "fragmentId": f"{feature_id}:{geometry_index}",
                        "sourceFeatureId": feature_id,
                        "sourceFeatureIndex": source_feature_index,
                        "geometryIndex": geometry_index,
                        "plateId": plate_id,
                        "validTimeMa": {
                            "oldest": finite_time(valid_oldest),
                            "youngest": finite_time(valid_youngest),
                        },
                        "coordinateOffset": offset,
                        "coordinateCount": len(points),
                        "referenceBoundingCap": {
                            "centreXyz": cap_centre,
                            "radiusRadians": cap_radius,
                        },
                    }
                )

        rotation_model = pygplates.RotationModel(str(rotation_path), default_anchor_plate_id=0)
        rotation_features = list(pygplates.FeatureCollection(str(rotation_path)))
        rotation_sequences: list[dict] = []
        disabled_rotation_samples = 0
        for source_order, feature in enumerate(rotation_features):
            fixed_plate_id, moving_plate_id, sequence = feature.get_total_reconstruction_pole()
            enabled_samples = list(sequence.get_enabled_time_samples())
            disabled_rotation_samples += len(sequence.get_time_samples()) - len(enabled_samples)
            samples = [
                {
                    "ageMa": round(float(sample.get_time()), 6),
                    "quaternionWxyz": finite_rotation_quaternion(sample.get_value().get_finite_rotation()),
                }
                for sample in enabled_samples
            ]
            if not samples:
                continue
            endpoint_inclusion = {}
            for endpoint_name, endpoint_age in (
                ("youngest", samples[0]["ageMa"]), ("oldest", samples[-1]["ageMa"])
            ):
                edge = rotation_model.get_reconstruction_tree(endpoint_age).get_edge(moving_plate_id)
                endpoint_inclusion[endpoint_name] = (
                    edge is not None and edge.get_fixed_plate_id() == fixed_plate_id
                )
            rotation_sequences.append(
                {
                    "sequenceId": f"rotation-{source_order}",
                    "sourceOrder": source_order,
                    "movingPlateId": moving_plate_id,
                    "fixedPlateId": fixed_plate_id,
                    "sampleRangeMa": {
                        "youngest": samples[0]["ageMa"],
                        "oldest": samples[-1]["ageMa"],
                    },
                    "endpointInclusion": endpoint_inclusion,
                    "samples": samples,
                }
            )

        present_partitioner = pygplates.PlatePartitioner(
            str(polygon_path), rotation_model, reconstruction_time=0
        )
        poi_plate_ids = {}
        for poi_id, (latitude, longitude) in POI_EVIDENCE_POINTS.items():
            reconstructed_polygon = present_partitioner.partition_point((latitude, longitude))
            if reconstructed_polygon is not None:
                poi_plate_ids[poi_id] = reconstructed_polygon.get_feature().get_reconstruction_plate_id()
        coverage = []
        probe_ages = [0, 5, 100, 250, 400, 540]
        latitudes = [-87.5 + 5 * index for index in range(36)]
        longitudes = [-177.5 + 5 * index for index in range(72)]
        for age in probe_ages:
            partitioner = pygplates.PlatePartitioner(
                str(polygon_path), rotation_model, reconstruction_time=float(age)
            )
            assigned = 0
            feature_ids: set[str] = set()
            plate_ids: set[int] = set()
            for latitude in latitudes:
                for longitude in longitudes:
                    reconstructed_polygon = partitioner.partition_point((latitude, longitude))
                    if reconstructed_polygon is None:
                        continue
                    assigned += 1
                    feature = reconstructed_polygon.get_feature()
                    feature_ids.add(str(feature.get_feature_id()))
                    plate_ids.add(feature.get_reconstruction_plate_id())
            total = len(latitudes) * len(longitudes)
            coverage.append(
                {
                    "ageMa": age,
                    "assignedPoints": assigned,
                    "totalPoints": total,
                    "assignedFraction": round(assigned / total, 6),
                    "representedFeatureCount": len(feature_ids),
                    "representedPlateCount": len(plate_ids),
                }
            )

        return {
            "schemaVersion": 1,
            "id": "paleomap-rigid-material-motion-v1",
            "model": {
                "id": "paleomap-global-plate-model-v3",
                "underlyingModelVersion": "m15g60_v2d3 / ContOCeanPolyv10u_v2d3",
                "sourceRecord": "https://doi.org/10.5281/zenodo.7994000",
                "sourceArchiveUrl": "https://zenodo.org/records/7994000/files/paleomap_global_plate_model_v3.zip?download=1",
                "sourceArchiveSha256": actual_sha256,
                "rotationMemberSha256": sha256(rotation_path),
                "polygonMemberSha256": sha256(polygon_path),
                "license": "CC-BY-4.0",
                "referenceFrame": "PALEOMAP model frame",
                "anchorPlateId": 0,
            },
            "paleoDemCompatibility": {
                "sourceRecord": "https://doi.org/10.5281/zenodo.5460860",
                "sourceVersion": "PALEOMAP PaleoDEM v2",
                "reportEvidence": "The PaleoDEM report names PALEOMAP Global Plate Model v2d3 and directs GPlates basemaps to use its Plate Tectonic Model Age.",
                "rotationHeaderEvidence": f"{EXPECTED_ROTATION_BANNER}; {EXPECTED_POLYGON_BANNER}",
                "supportedSourceAgesMa": SOURCE_AGES_MA,
            },
            "coordinateEncoding": {
                "type": "flat-int16-longitude-latitude",
                "scaleDegrees": COORDINATE_SCALE_DEGREES,
                "referenceAgeMa": 0,
                "polygonRingsAreImplicitlyClosed": True,
            },
            "reconstruction": {
                "kind": "rigid-static-polygon",
                "rotationInterpolation": "SLERP each enabled moving/fixed source sequence, then compose through the age-specific hierarchy to anchor plate 0",
                "partitionOrdering": "active reconstructed polygons ordered by descending plate ID, preserving source feature/geometry order within a plate",
                "validity": "a fragment is usable only when active at requested and both bracketing ages and all three plate circuits resolve",
                "missingPolicy": "return unknown; retain a discrete source surface rather than inventing motion",
            },
            "coverage": {
                "classification": "partial-material-coverage-at-nonzero-ages",
                "probe": "5-degree global cell centres; deterministic pyGPlates PlatePartitioner",
                "samples": coverage,
                "limitations": [
                    "The static polygons do not provide global material identity at nonzero ages.",
                    "They provide rigid partitions, not deforming topological networks or point lifetimes.",
                    "Destroyed and synthetic ancient ocean cells generally lack a persistent correspondence.",
                    "The two non-polygon source geometries are deliberately excluded.",
                ],
            },
            "fragments": fragments,
            "excludedGeometries": excluded_geometries,
            "coordinates": coordinates,
            "rotationSequences": rotation_sequences,
            "poiPlateIds": poi_plate_ids,
            "sourceCounts": {
                "features": len(polygon_features),
                "polygonFragments": len(fragments),
                "coordinatePairs": len(coordinates) // 2,
                "excludedGeometries": len(excluded_geometries),
                "rotationSequences": len(rotation_sequences),
                "disabledRotationSamples": disabled_rotation_samples,
            },
            "evidence": "model-output",
            "epistemicStatus": "kinematically evaluated where a valid rigid source fragment and plate circuit exist; unknown elsewhere",
        }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model-archive", type=pathlib.Path, default=DEFAULT_ARCHIVE)
    parser.add_argument("--output", type=pathlib.Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()

    try:
        import pygplates
    except ImportError as error:
        raise SystemExit("pyGPlates >= 1.0 is required") from error

    catalog = build_catalog(args.model_archive, pygplates)
    encoded = (json.dumps(catalog, sort_keys=True, separators=(",", ":")) + "\n").encode("utf-8")
    if len(encoded) > MAX_OUTPUT_BYTES:
        raise SystemExit(f"motion catalog exceeds {MAX_OUTPUT_BYTES} bytes: {len(encoded)}")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_bytes(encoded)
    print(f"wrote {args.output} ({len(encoded)} bytes, sha256 {hashlib.sha256(encoded).hexdigest()})")


if __name__ == "__main__":
    main()
