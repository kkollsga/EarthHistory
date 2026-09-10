#!/usr/bin/env python3
"""Derive coarse Cao-native ocean lifecycle controls with typed attribution.

pyGPlates' default point deactivation is only a kinematic transition signal.
This export accepts an age bound only when the last active point is also near a
source MidOceanRidge (backward birth) or SubductionZone (forward loss).
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
DEFAULT_BINARY = ROOT / "public/data/cao-ocean-lifecycle-v1.bin"
DEFAULT_METADATA = ROOT / "public/data/cao-ocean-lifecycle-v1.json"
SOURCE_RECORD = "https://doi.org/10.5281/zenodo.13628813"
SOURCE_ARCHIVE_SHA256 = "4ae9158a29c597b46f687f8c3f0f5a4a55df5ab69bde18e24257a17d358d8592"
BOUNDARY_FILES = ["250-0_plate_boundaries.gpml", "410-250_plate_boundaries.gpml", "1000-410_plate_boundaries.gpml", "TopologyBuildingBlocks.gpml"]
ROTATION_FILE = "1000_0_rotfile.rot"
CONTINENT_FILE = "shapes_continents.gpmlz"
DISPLAY_AGES = list(range(0, 541, 5))
TRACE_AGES = list(range(0, 1001, 5))
WIDTH = 180
HEIGHT = 91
CELL_COUNT = WIDTH * HEIGHT
UNATTRIBUTED = 253
CENSORED = 254
UNAVAILABLE = 255
ATTRIBUTION_DISTANCE_RADIANS = 300 / 6371.0088
COORDINATE_SCALE_DEGREES = 180 / 32767
HEADER = struct.Struct("<4sHHHHIII")
MAX_COMBINED_BYTES = 6 * 1024 * 1024


def digest(path: pathlib.Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def quantize(point) -> tuple[int, int]:
    latitude, longitude = point.to_lat_lon()
    longitude = ((longitude + 180) % 360) - 180
    return round(longitude / COORDINATE_SCALE_DEGREES), round(latitude / COORDINATE_SCALE_DEGREES)


def canonical_geometry_key(points) -> tuple[tuple[int, int], ...]:
    quantized = [quantize(point) for point in points]
    minimum = min(quantized)
    candidates = []
    for values in (quantized, list(reversed(quantized))):
        for index, value in enumerate(values):
            if value == minimum:
                candidates.append(tuple(values[index:] + values[:index]))
    return min(candidates)


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

    topology_features = []
    for name in BOUNDARY_FILES:
        topology_features.extend(pygplates.FeatureCollection(str(args.model_dir / name)))
    continents = list(pygplates.FeatureCollection(str(args.model_dir / CONTINENT_FILE)))
    rotations = pygplates.RotationModel(str(args.model_dir / ROTATION_FILE), default_anchor_plate_id=0)
    model = pygplates.TopologicalModel(topology_features, rotations, anchor_plate_id=0, topological_snapshot_cache_size=3)
    birth_bounds = bytearray([UNAVAILABLE]) * (len(DISPLAY_AGES) * CELL_COUNT)
    loss_bounds = bytearray([UNAVAILABLE]) * (len(DISPLAY_AGES) * CELL_COUNT)
    source_topology_slots = bytearray([UNAVAILABLE]) * (len(DISPLAY_AGES) * CELL_COUNT)
    typed_boundaries = {}
    topology_slot_signatures = []

    def boundary_geometries(age_index: int, feature_type):
        key = (age_index, str(feature_type))
        if key in typed_boundaries:
            return typed_boundaries[key]
        resolved = []
        sections = []
        pygplates.resolve_topologies(topology_features, rotations, resolved, TRACE_AGES[age_index], sections, anchor_plate_id=0)
        geometries = []
        for section in sections:
            if section.get_feature().get_feature_type() != feature_type:
                continue
            for shared in section.get_shared_sub_segments():
                points = shared.get_resolved_geometry_points()
                if len(points) >= 2:
                    geometries.append(pygplates.PolylineOnSphere(points))
        typed_boundaries[key] = geometries
        return geometries

    def attributed(point, age_index: int, feature_type) -> bool:
        return any(
            pygplates.GeometryOnSphere.distance(point, geometry, ATTRIBUTION_DISTANCE_RADIANS) is not None
            for geometry in boundary_geometries(age_index, feature_type)
        )

    counts = {"oceanSamples": 0, "ridgeConfirmedBirth": 0, "subductionConfirmedLoss": 0,
              "birthCensored": 0, "lossCensored": 0, "birthUnattributed": 0, "lossUnattributed": 0}
    for source_age_index, source_age in enumerate(DISPLAY_AGES):
        resolved = []
        pygplates.resolve_topologies(topology_features, rotations, resolved, source_age, anchor_plate_id=0)
        source_topologies = sorted(
            [item for item in resolved if isinstance(item, pygplates.ResolvedTopologicalBoundary)],
            key=lambda item: (
                str(item.get_feature().get_feature_id()),
                item.get_feature().get_reconstruction_plate_id(-1),
                canonical_geometry_key(item.get_resolved_boundary().get_exterior_ring_points()),
            ),
        )
        topology_slot_signatures.append(hashlib.sha256(json.dumps([
            [
                str(topology.get_feature().get_feature_id()),
                topology.get_feature().get_reconstruction_plate_id(None),
                canonical_geometry_key(topology.get_resolved_boundary().get_exterior_ring_points()),
            ]
            for topology in source_topologies
        ], separators=(",", ":")).encode()).hexdigest())
        reconstructed_continents = []
        pygplates.reconstruct(continents, rotations, reconstructed_continents, source_age, anchor_plate_id=0)
        continent_partitioner = pygplates.PlatePartitioner(
            reconstructed_continents,
            rotations,
            sort_partitioning_plates=pygplates.SortPartitioningPlates.by_partition_type_then_plate_area,
        )
        points = []
        cell_indices = []
        for latitude_index in range(HEIGHT):
            latitude = 90 - 2 * latitude_index
            for longitude_index in range(WIDTH):
                longitude = -180 + 2 * longitude_index
                point = pygplates.PointOnSphere(latitude, longitude)
                topology_hits = [
                    slot for slot, topology in enumerate(source_topologies, start=1)
                    if topology.get_resolved_boundary().is_point_in_polygon(point)
                ]
                if continent_partitioner.partition_point(point) is None and len(topology_hits) == 1:
                    points.append(point)
                    cell_indices.append(latitude_index * WIDTH + longitude_index)
                    source_topology_slots[source_age_index * CELL_COUNT + cell_indices[-1]] = topology_hits[0]
        counts["oceanSamples"] += len(points)
        span = model.reconstruct_geometry(points, source_age, oldest_time=1000, youngest_time=0, time_increment=5)
        states = [span.get_geometry_points(age, return_inactive_points=True) or [None] * len(points) for age in TRACE_AGES]
        for point_index, cell_index in enumerate(cell_indices):
            active = [age_index for age_index, state in enumerate(states) if state[point_index] is not None]
            if source_age_index not in active:
                continue
            youngest = source_age_index
            while youngest > 0 and states[youngest - 1][point_index] is not None:
                youngest -= 1
            oldest = source_age_index
            while oldest + 1 < len(TRACE_AGES) and states[oldest + 1][point_index] is not None:
                oldest += 1
            output_index = source_age_index * CELL_COUNT + cell_index
            if oldest == len(TRACE_AGES) - 1:
                birth_bounds[output_index] = CENSORED
                counts["birthCensored"] += 1
            elif attributed(states[oldest][point_index], oldest, pygplates.FeatureType.gpml_mid_ocean_ridge):
                birth_bounds[output_index] = oldest
                counts["ridgeConfirmedBirth"] += 1
            else:
                birth_bounds[output_index] = UNATTRIBUTED
                counts["birthUnattributed"] += 1
            if youngest == 0:
                loss_bounds[output_index] = CENSORED
                counts["lossCensored"] += 1
            elif attributed(states[youngest][point_index], youngest, pygplates.FeatureType.gpml_subduction_zone):
                loss_bounds[output_index] = youngest
                counts["subductionConfirmedLoss"] += 1
            else:
                loss_bounds[output_index] = UNATTRIBUTED
                counts["lossUnattributed"] += 1
        if source_age_index % 20 == 0:
            print(f"processed {source_age} Ma ({len(points)} ocean controls)", flush=True)

    birth_offset = HEADER.size
    loss_offset = birth_offset + len(birth_bounds)
    topology_slot_offset = loss_offset + len(loss_bounds)
    binary = HEADER.pack(
        b"EHCL", 1, WIDTH, HEIGHT, len(DISPLAY_AGES), birth_offset, loss_offset, topology_slot_offset,
    ) + birth_bounds + loss_bounds + source_topology_slots
    binary_sha = hashlib.sha256(binary).hexdigest()
    source_paths = [args.model_dir / name for name in [*BOUNDARY_FILES, ROTATION_FILE, CONTINENT_FILE]]
    metadata = {
        "schemaVersion": 1,
        "id": "cao-ocean-lifecycle-v1",
        "model": {"id": "cao-et-al-2024", "version": "2.4", "sourceRecord": SOURCE_RECORD,
                  "sourceArchiveSha256": SOURCE_ARCHIVE_SHA256, "license": "CC-BY-4.0",
                  "referenceFrame": "palaeomagnetic", "anchorPlateId": 0},
        "sourceMembers": [{"path": path.name, "sha256": digest(path)} for path in source_paths],
        "binary": {"path": "cao-ocean-lifecycle-v1.bin", "bytes": len(binary), "sha256": binary_sha,
                   "header": "24 bytes little-endian: EHCL; uint16 schema,width,height,ageCount; uint32 birthOffset,lossOffset,sourceTopologySlotOffset",
                   "values": "birth/loss are age-major uint8: 0..200 is a last-active 5 Ma trace-age index with typed-boundary attribution, 253 deactivated but unattributed, 254 censored at model bound, 255 unavailable; sourceTopologySlot is the one-based exact resolved-topology slot or 255 unavailable"},
        "grid": {"width": WIDTH, "height": HEIGHT, "longitudes": "-180..178 every 2 degrees", "latitudes": "90..-90 every 2 degrees",
                 "maximumNearestCellRegistrationUncertaintyKm": 158},
        "time": {"displayAgesMa": DISPLAY_AGES, "traceRangeMa": [0, 1000], "stepMa": 5, "boundUncertaintyMa": 5},
        "topologySlotIdentitySha256ByAge": topology_slot_signatures,
        "method": {"engine": "pyGPlates 1.0.0 TopologicalModel.reconstruct_geometry with DefaultDeactivatePoints",
                   "birthAcceptance": "backward deactivation retained as a boundary-attributed model interval only when the last active point is within 300 km of a source MidOceanRidge",
                   "lossAcceptance": "forward deactivation retained as a boundary-attributed model interval only when the last active point is within 300 km of a source SubductionZone",
                   "distanceLimitKm": 300,
                   "registrationGuard": "consumer must match exact resolved topology slot to sourceTopologySlot before nearest-cell sampling",
                   "warning": "a typed-boundary proximity is an inference; unattributed kinematic deactivation is unavailable, and no value is an observed seafloor age"},
        "coverage": counts,
        "epistemicStatus": "model-derived coarse lifecycle control; not an observed or measured seafloor-age grid",
    }
    metadata_bytes = (json.dumps(metadata, sort_keys=True, separators=(",", ":")) + "\n").encode()
    if len(binary) + len(metadata_bytes) > MAX_COMBINED_BYTES:
        raise SystemExit("Cao lifecycle controls exceed owned size bound")
    args.binary_output.write_bytes(binary)
    args.metadata_output.write_bytes(metadata_bytes)
    print(f"wrote {args.binary_output} ({len(binary)} bytes, sha256 {binary_sha})")
    print(f"wrote {args.metadata_output} ({len(metadata_bytes)} bytes, sha256 {hashlib.sha256(metadata_bytes).hexdigest()})")
    print(json.dumps(counts, sort_keys=True))


if __name__ == "__main__":
    main()
