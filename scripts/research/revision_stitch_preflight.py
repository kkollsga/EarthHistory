#!/usr/bin/env python3
"""Trace one PALEOMAP-to-Cao 400 Ma feature-revision crosswalk failure."""

from __future__ import annotations

import hashlib
import json
import math
import os
from pathlib import Path
import sys
import tempfile
import zipfile

import pygplates

ROOT = Path(__file__).resolve().parents[2]
SOURCE_ZIP = ROOT / "dev-docs/temp/earthhistory-data/paleomap_global_plate_model_v3.zip"
CAO_ROOT = ROOT.parent / "EarthHistory-data/palaeomap-study/plates/extracted/cao2024-v2.4/1.8Ga_model_GSF"
OUTPUT_ROOT = ROOT.parent / "EarthHistory-data/palaeomap-study/verification/reconstruction-machinery-v1/revision-stitch"
OUTPUT = OUTPUT_ROOT / "paleomap-cao-400ma-revision-stitch.json"
PROGRAM_ROOT = OUTPUT_ROOT.parent
AGE = 400.0
PROGRAM_CAP = 32 * 1024 * 1024
CHILD_CAP = 2 * 1024 * 1024
EXPECTED_ZIP_SHA256 = "a58409f42bdb5f247e0dd543e8c3287f5d291d5928d0df730af8b2fa1ae7be65"
EXPECTED_POLYGON_SHA256 = "4925c064a415cfa6e7fd3f5e0682585baa9908f01bee9e053ca5dea0b0dc57ca"
EXPECTED_ROTATION_SHA256 = "d56846bb3c6260805d088171066bc18e9d54e831892b660fd31315260e288022"


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def directory_bytes(path: Path) -> int:
    return sum(p.stat().st_size for p in path.rglob("*") if p.is_file()) if path.exists() else 0


def active(feature: pygplates.Feature, age: float) -> bool:
    begin, end = feature.get_valid_time()
    return end <= age <= begin


def feature_record(feature: pygplates.Feature, geometry, point) -> dict:
    plate = feature.get_reconstruction_plate_id()
    begin, end = feature.get_valid_time()
    return {
        "featureId": str(feature.get_feature_id()),
        "name": feature.get_name() or None,
        "plateId": plate,
        "validTimeMa": {
            "oldest": begin if math.isfinite(begin) else ("distant-past" if begin > 0 else "distant-future"),
            "youngest": end if math.isfinite(end) else ("distant-past" if end > 0 else "distant-future"),
        },
        "activeAt400Ma": active(feature, AGE),
        "containsReferencePoint": bool(geometry.is_point_in_polygon(point)),
    }


def angular_degrees(a, b) -> float:
    return math.degrees(pygplates.GeometryOnSphere.distance(a, b))


def strict_rotation(model, age, plate):
    try:
        return model.get_rotation(age, plate, use_identity_for_missing_plate_ids=False)
    except pygplates.RotationModel.RotationNotFoundError:
        return None


def main() -> None:
    if digest(SOURCE_ZIP.read_bytes()) != EXPECTED_ZIP_SHA256:
        raise RuntimeError("unexpected PALEOMAP archive digest")
    with zipfile.ZipFile(SOURCE_ZIP) as archive:
        polygon_bytes = archive.read("PALEOMAP_PlatePolygons.gpml")
        rotation_bytes = archive.read("PALEOMAP_PlateModel.rot")
    if digest(polygon_bytes) != EXPECTED_POLYGON_SHA256 or digest(rotation_bytes) != EXPECTED_ROTATION_SHA256:
        raise RuntimeError("unexpected PALEOMAP member digest")

    with tempfile.TemporaryDirectory() as temp:
        temp_root = Path(temp)
        source_gpml = temp_root / "source.gpml"
        source_rot = temp_root / "source.rot"
        source_gpml.write_bytes(polygon_bytes)
        source_rot.write_bytes(rotation_bytes)
        source_features = list(pygplates.FeatureCollection(str(source_gpml)))
        source_model = pygplates.RotationModel(str(source_rot))

        cao_features = list(pygplates.FeatureCollection(str(CAO_ROOT / "shapes_continents.gpmlz")))
        cao_model = pygplates.RotationModel([
            str(CAO_ROOT / "1000_0_rotfile.rot"), str(CAO_ROOT / "1800_1000_rotfile.rot")
        ])
        reconstructed = []
        pygplates.reconstruct(cao_features, cao_model, reconstructed, AGE)

        source_geometries = []
        for index, feature in enumerate(source_features):
            for geometry_index, geometry in enumerate(feature.get_geometries()):
                if isinstance(geometry, pygplates.PolygonOnSphere):
                    source_geometries.append((index, geometry_index, feature, geometry))

        selected = None
        # The earlier probe used a 2-degree grid. Avoid polar examples and select
        # its first target whose present source owner expires before 400 Ma.
        for lat in range(-70, 72, 2):
            for lon in range(-180, 180, 2):
                target = pygplates.PointOnSphere(lat, lon)
                cao_hits = [item for item in reconstructed if isinstance(item.get_reconstructed_geometry(), pygplates.PolygonOnSphere)
                            and item.get_reconstructed_geometry().is_point_in_polygon(target)]
                if not cao_hits:
                    continue
                cao_hits.sort(key=lambda item: -item.get_reconstructed_geometry().get_area())
                cao_hit = cao_hits[0]
                cao_feature = cao_hit.get_feature()
                cao_rotation = strict_rotation(cao_model, AGE, cao_feature.get_reconstruction_plate_id())
                if cao_rotation is None:
                    continue
                reference = cao_rotation.get_inverse() * target
                present_hits = [item for item in source_geometries if active(item[2], 0) and item[3].is_point_in_polygon(reference)]
                present_hits.sort(key=lambda item: (-item[2].get_reconstruction_plate_id(), item[0], item[1]))
                if present_hits and not active(present_hits[0][2], AGE):
                    selected = (lon, lat, target, reference, cao_feature, present_hits)
                    break
            if selected:
                break
        if selected is None:
            raise RuntimeError("no non-polar 400 Ma feature-lifetime failure found")

        lon, lat, target, reference, cao_feature, present_hits = selected
        present_geometry = present_hits[0][3]
        older_active = [item for item in source_geometries if active(item[2], AGE)]
        older_overlaps = [item for item in older_active if pygplates.GeometryOnSphere.distance(
            present_geometry, item[3], geometry1_is_solid=True, geometry2_is_solid=True,
        ) == 0]
        candidates = []
        present_feature = present_hits[0][2]
        present_rotation = strict_rotation(source_model, AGE, present_feature.get_reconstruction_plate_id())
        for _, _, feature, geometry in older_overlaps:
            record = feature_record(feature, geometry, reference)
            rotation = strict_rotation(source_model, AGE, feature.get_reconstruction_plate_id())
            record["strictRotationAt400Ma"] = rotation is not None
            record["sharedReferenceGeometry"] = "solid spherical polygon distance is zero"
            record["selectedVerticesInsideCandidate"] = sum(
                geometry.is_point_in_polygon(point) for point in present_geometry.get_points()
            )
            record["candidateVerticesInsideSelected"] = sum(
                present_geometry.is_point_in_polygon(point) for point in geometry.get_points()
            )
            record["selectedVertexCount"] = len(present_geometry.get_points())
            record["candidateVertexCount"] = len(geometry.get_points())
            if rotation is not None:
                record["mappedReferencePointAt400Ma"] = list((rotation * reference).to_lat_lon()[::-1])
                if present_rotation is not None:
                    record["circuitPoseDifferenceAt400MaDegrees"] = angular_degrees(
                        present_rotation * reference, rotation * reference)
            # Local shared-reference geometry is a diagnostic, not polygon area.
            lat0, lon0 = reference.to_lat_lon()
            offsets = [(0, 0), (0.25, 0), (-0.25, 0), (0, 0.25), (0, -0.25)]
            record["localContainment5PointCount"] = sum(
                geometry.is_point_in_polygon(pygplates.PointOnSphere(lat0 + dy, lon0 + dx))
                for dx, dy in offsets if -90 <= lat0 + dy <= 90
            )
            candidates.append(record)

        result = {
            "schemaVersion": 1,
            "researchDate": "2026-09-10",
            "classification": "one-feature derived revision-lineage diagnostic; not global conversion evidence",
            "policy": {
                "selection": "first non-polar 2-degree Cao continental point whose ordered PALEOMAP present owner is inactive at 400 Ma",
                "acceptUniqueOnlyIf": "exactly one active 400 Ma reference-space owner has a strict circuit and unambiguous local shared geometry",
                "noValidityExtension": True,
                "noNearestGeometry": True,
            },
            "provenance": {
                "paleomapRecord": "https://doi.org/10.5281/zenodo.7994000",
                "paleomapArchiveSha256": EXPECTED_ZIP_SHA256,
                "paleomapPolygonMemberSha256": EXPECTED_POLYGON_SHA256,
                "paleomapRotationMemberSha256": EXPECTED_ROTATION_SHA256,
                "caoRecord": "https://doi.org/10.5281/zenodo.13628813",
                "pygplatesVersion": pygplates.__version__,
            },
            "targetAt400Ma": {
                "longitudeLatitude": [lon, lat],
                "caoContainingFeatureCount": len(cao_hits),
                "caoContainingFeaturesInAreaPriority": [{
                    "featureId": str(item.get_feature().get_feature_id()),
                    "plateId": item.get_feature().get_reconstruction_plate_id(),
                    "areaSteradians": item.get_reconstructed_geometry().get_area(),
                } for item in cao_hits],
                "caoFeatureId": str(cao_feature.get_feature_id()),
                "caoName": cao_feature.get_name() or None,
                "caoPlateId": cao_feature.get_reconstruction_plate_id(),
                "commonReferenceLongitudeLatitude": list(reference.to_lat_lon()[::-1]),
            },
            "orderedPresentOwners": [feature_record(f, g, reference) for _, _, f, g in present_hits],
            "selectedPresentOwner": feature_record(present_feature, present_hits[0][3], reference),
            "active400MaCommonReferenceCandidates": candidates,
            "localContainingCandidateCount": sum(c["containsReferencePoint"] for c in candidates),
            "decision": "unique" if sum(c["containsReferencePoint"] for c in candidates) == 1 and
                        next(c for c in candidates if c["containsReferencePoint"])["strictRotationAt400Ma"] else
                        ("missing" if not any(c["containsReferencePoint"] for c in candidates) else "ambiguous"),
            "qualification": "Point and five-point local containment are not spherical intersection area or full-ring closure evidence.",
        }

    encoded = (json.dumps(result, indent=2, sort_keys=True) + "\n").encode()
    if len(encoded) > CHILD_CAP:
        raise RuntimeError("revision-stitch output exceeds 2 MiB")
    current_program = directory_bytes(PROGRAM_ROOT)
    old_size = OUTPUT.stat().st_size if OUTPUT.exists() else 0
    if current_program - old_size + len(encoded) > PROGRAM_CAP:
        raise RuntimeError("reconstruction machinery program exceeds 32 MiB")
    OUTPUT_ROOT.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_bytes(encoded)
    print(json.dumps({"output": str(OUTPUT), "bytes": len(encoded), "decision": result["decision"]}))


if __name__ == "__main__":
    main()
