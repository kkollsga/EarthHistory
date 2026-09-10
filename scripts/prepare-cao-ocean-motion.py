#!/usr/bin/env python3
"""Export compact Cao et al. 2024 v2.4 target-native ocean motion controls.

The binary contains age-major 2-degree topology ownership, a bit-packed
continental mask, and resolved boundary coordinates. JSON retains topology
and boundary source identity, ridge adjacency, subduction polarity, rotations,
validity, provenance, and explicit ambiguity/missing rules.
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
DEFAULT_BINARY = ROOT / "public/data/cao-ocean-motion-v1.bin"
DEFAULT_METADATA = ROOT / "public/data/cao-ocean-motion-v1.json"
SOURCE_RECORD = "https://doi.org/10.5281/zenodo.13628813"
SOURCE_ARCHIVE_SHA256 = "4ae9158a29c597b46f687f8c3f0f5a4a55df5ab69bde18e24257a17d358d8592"
AGES_MA = list(range(0, 541, 5))
WIDTH = 180
HEIGHT = 91
UNKNOWN_SLOT = 0
AMBIGUOUS_SLOT = 255
COORDINATE_SCALE_DEGREES = 180 / 32767
HEADER = struct.Struct("<4sHHHHIIIII")
MAX_COMBINED_BYTES = 7 * 1024 * 1024
BOUNDARY_SAMPLE_STEP_RADIANS = math.radians(0.5)
BOUNDARY_CELL_RADIUS_RADIANS = math.radians(2.25)
BOUNDARY_LINK_MAX_DISTANCE_RADIANS = math.radians(15)
BOUNDARY_LINK_MAX_LENGTH_RATIO = 2
BOUNDARY_FILES = [
    "250-0_plate_boundaries.gpml",
    "410-250_plate_boundaries.gpml",
    "1000-410_plate_boundaries.gpml",
    "TopologyBuildingBlocks.gpml",
]
ROTATION_FILE = "1000_0_rotfile.rot"
CONTINENT_FILE = "shapes_continents.gpmlz"


def sha256(path: pathlib.Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def finite_time(value: float) -> float | None:
    return value if math.isfinite(value) else None


def quaternion(rotation) -> list[float]:
    pole, angle = rotation.get_euler_pole_and_angle()
    x, y, z = pole.to_xyz()
    sine = math.sin(angle / 2)
    values = [math.cos(angle / 2), x * sine, y * sine, z * sine]
    if values[0] < 0:
        values = [-value for value in values]
    return [round(value, 12) for value in values]


def quantize(point) -> tuple[int, int]:
    latitude, longitude = point.to_lat_lon()
    longitude = ((longitude + 180) % 360) - 180
    return (
        max(-32767, min(32767, round(longitude / COORDINATE_SCALE_DEGREES))),
        max(-32767, min(32767, round(latitude / COORDINATE_SCALE_DEGREES))),
    )


def canonical_geometry_key(points) -> tuple[tuple[int, int], ...]:
    quantized = [quantize(point) for point in points]
    if not quantized:
        return ()
    candidates = []
    minimum = min(quantized)
    for values in (quantized, list(reversed(quantized))):
        for index, value in enumerate(values):
            if value == minimum:
                candidates.append(tuple(values[index:] + values[:index]))
    return min(candidates)


def topology_plate_id(topology) -> int | None:
    return topology.get_feature().get_reconstruction_plate_id(None) if topology is not None else None


def polygon_bounding_cap(polygon) -> tuple[tuple[float, float, float], float]:
    points = list(polygon.get_exterior_ring_points())
    xyz = [point.to_xyz() for point in points]
    centre = [sum(point[index] for point in xyz) for index in range(3)]
    magnitude = math.sqrt(sum(value * value for value in centre))
    if magnitude < 1e-12:
        centre = list(xyz[0])
        magnitude = 1
    centre = tuple(value / magnitude for value in centre)
    vertex_radius = max(math.acos(max(-1, min(1, sum(centre[index] * point[index] for index in range(3))))) for point in xyz)
    maximum_edge = max(
        math.acos(max(-1, min(1, sum(point[index] * xyz[(offset + 1) % len(xyz)][index] for index in range(3)))))
        for offset, point in enumerate(xyz)
    )
    return centre, min(math.pi, vertex_radius + maximum_edge / 2 + 1e-9)


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

    source_paths = [args.model_dir / name for name in [*BOUNDARY_FILES, ROTATION_FILE, CONTINENT_FILE]]
    for path in source_paths:
        if not path.is_file():
            raise SystemExit(f"missing Cao source member: {path}")

    rotation_path = args.model_dir / ROTATION_FILE
    rotation_model = pygplates.RotationModel(str(rotation_path), default_anchor_plate_id=0)
    topology_features = []
    for name in BOUNDARY_FILES:
        topology_features.extend(pygplates.FeatureCollection(str(args.model_dir / name)))
    continent_features = list(pygplates.FeatureCollection(str(args.model_dir / CONTINENT_FILE)))

    cell_count = WIDTH * HEIGHT
    topology_grid = bytearray(len(AGES_MA) * cell_count)
    continent_mask = bytearray(math.ceil(len(AGES_MA) * cell_count / 8))
    coordinates: list[int] = []
    features: list[dict] = []
    feature_index_by_id: dict[str, int] = {}
    segments: list[dict] = []
    segment_points = []
    age_records: list[dict] = []
    boundary_cell_candidates: list[dict[int, set[int]]] = []

    def feature_index(feature) -> int:
        source_id = str(feature.get_feature_id())
        existing = feature_index_by_id.get(source_id)
        if existing is not None:
            return existing
        oldest, youngest = feature.get_valid_time()
        polarity = None
        if feature.get_feature_type() == pygplates.FeatureType.gpml_subduction_zone:
            polarity = feature.get_enumeration(pygplates.PropertyName.gpml_subduction_polarity)
        index = len(features)
        features.append({
            "sourceFeatureId": source_id,
            "featureType": str(feature.get_feature_type()).split(":")[-1],
            "plateId": feature.get_reconstruction_plate_id(None),
            "validTimeMa": {"oldest": finite_time(oldest), "youngest": finite_time(youngest)},
            "subductionPolarity": polarity,
        })
        feature_index_by_id[source_id] = index
        return index

    for age_index, age_ma in enumerate(AGES_MA):
        resolved = []
        resolved_sections = []
        pygplates.resolve_topologies(
            topology_features,
            rotation_model,
            resolved,
            age_ma,
            resolved_sections,
            anchor_plate_id=0,
        )
        boundaries = [
            topology for topology in resolved
            if isinstance(topology, pygplates.ResolvedTopologicalBoundary)
        ]
        boundaries.sort(key=lambda topology: (
            str(topology.get_feature().get_feature_id()),
            topology.get_feature().get_reconstruction_plate_id(-1),
            canonical_geometry_key(topology.get_resolved_boundary().get_exterior_ring_points()),
        ))
        if len(boundaries) >= AMBIGUOUS_SLOT:
            raise SystemExit(f"too many topology slots at {age_ma} Ma: {len(boundaries)}")
        topology_slots = []
        topology_rings = []
        for topology in boundaries:
            polygon = topology.get_resolved_boundary()
            ring = list(polygon.get_exterior_ring_points())
            ring_offset = len(coordinates) // 2
            for point in ring:
                coordinates.extend(quantize(point))
            cap_centre, cap_radius = polygon_bounding_cap(polygon)
            if polygon.get_area() > 2 * math.pi:
                cap_radius = math.pi
            interior_point = polygon.get_interior_centroid().to_xyz()
            topology_slots.append({
                "sourceFeatureId": str(topology.get_feature().get_feature_id()),
                "plateId": topology.get_feature().get_reconstruction_plate_id(None),
                "coordinateOffset": ring_offset,
                "coordinateCount": len(ring),
                "boundingCap": {"centreXyz": [round(value, 9) for value in cap_centre], "radiusRadians": round(cap_radius, 9)},
                "interiorPointXyz": [round(value, 9) for value in interior_point],
            })
            topology_rings.append(ring)

        candidate_cells: dict[int, set[int]] = {}

        def mark_boundary_sample(point, slot: int) -> None:
            latitude, longitude = point.to_lat_lon()
            point_xyz = point.to_xyz()
            centre_row = round((90 - latitude) / 2)
            for row in range(max(0, centre_row - 2), min(HEIGHT, centre_row + 3)):
                grid_latitude = 90 - 2 * row
                grid_latitude_radians = math.radians(grid_latitude)
                denominator = math.cos(math.radians(latitude)) * math.cos(grid_latitude_radians)
                numerator = math.cos(BOUNDARY_CELL_RADIUS_RADIANS) - math.sin(math.radians(latitude)) * math.sin(grid_latitude_radians)
                if abs(denominator) < 1e-12:
                    columns = range(WIDTH) if numerator <= 0 else ()
                else:
                    longitude_radius = math.degrees(math.acos(max(-1, min(1, numerator / denominator))))
                    centre_column = round((longitude + 180) / 2) % WIDTH
                    column_radius = min(WIDTH // 2, math.ceil(longitude_radius / 2) + 1)
                    columns = ((centre_column + delta) % WIDTH for delta in range(-column_radius, column_radius + 1))
                for column in columns:
                    grid_longitude_radians = math.radians(-180 + 2 * column)
                    grid_xyz = (
                        math.cos(grid_latitude_radians) * math.cos(grid_longitude_radians),
                        math.cos(grid_latitude_radians) * math.sin(grid_longitude_radians),
                        math.sin(grid_latitude_radians),
                    )
                    cosine = sum(point_xyz[index] * grid_xyz[index] for index in range(3))
                    if cosine >= math.cos(BOUNDARY_CELL_RADIUS_RADIANS):
                        candidate_cells.setdefault(row * WIDTH + column, set()).add(slot)

        for slot, ring in enumerate(topology_rings, start=1):
            for point_index, start in enumerate(ring):
                end = ring[(point_index + 1) % len(ring)]
                angle = pygplates.GeometryOnSphere.distance(start, end)
                sample_count = max(1, math.ceil(angle / BOUNDARY_SAMPLE_STEP_RADIANS))
                start_xyz = start.to_xyz()
                end_xyz = end.to_xyz()
                sine = math.sin(angle)
                for sample_index in range(sample_count + 1):
                    fraction = sample_index / sample_count
                    if sine < 1e-12:
                        sample = start
                    else:
                        sample = pygplates.PointOnSphere(tuple(
                            (math.sin((1 - fraction) * angle) * start_xyz[index] + math.sin(fraction * angle) * end_xyz[index]) / sine
                            for index in range(3)
                        ))
                    mark_boundary_sample(
                        sample,
                        slot,
                    )
        for row in [0, 1, HEIGHT - 2, HEIGHT - 1]:
            for column in range(WIDTH):
                candidate_cells.setdefault(row * WIDTH + column, set()).clear()
        boundary_cell_candidates.append(candidate_cells)

        reconstructed_continents = []
        pygplates.reconstruct(continent_features, rotation_model, reconstructed_continents, age_ma, anchor_plate_id=0)
        continent_partitioner = pygplates.PlatePartitioner(
            reconstructed_continents,
            rotation_model,
            sort_partitioning_plates=pygplates.SortPartitioningPlates.by_partition_type_then_plate_area,
        )
        bounded_topologies = [
            (index + 1, topology, *polygon_bounding_cap(topology.get_resolved_boundary()))
            for index, topology in enumerate(boundaries)
        ]

        assigned = ambiguous = unknown = continental = 0
        for latitude_index in range(HEIGHT):
            latitude = 90 - 2 * latitude_index
            for longitude_index in range(WIDTH):
                longitude = -180 + 2 * longitude_index
                cell_index = age_index * cell_count + latitude_index * WIDTH + longitude_index
                point = pygplates.PointOnSphere(latitude, longitude)
                point_xyz = point.to_xyz()
                hits = [
                    slot for slot, topology, centre, radius in bounded_topologies
                    if sum(centre[index] * point_xyz[index] for index in range(3)) >= math.cos(radius)
                    and topology.get_resolved_boundary().is_point_in_polygon(point)
                ]
                if len(hits) == 1:
                    slot = hits[0]
                    assigned += 1
                elif len(hits) > 1:
                    slot = AMBIGUOUS_SLOT
                    ambiguous += 1
                else:
                    slot = UNKNOWN_SLOT
                    unknown += 1
                topology_grid[cell_index] = slot
                if continent_partitioner.partition_point(point) is not None:
                    continent_mask[cell_index // 8] |= 1 << (cell_index % 8)
                    continental += 1

        segment_start = len(segments)
        resolved_sections.sort(key=lambda section: (
            str(section.get_feature().get_feature_id()),
            tuple(sorted(
                canonical_geometry_key(shared.get_resolved_geometry_points())
                for shared in section.get_shared_sub_segments()
            )),
        ))
        for section in resolved_sections:
            source_feature = section.get_feature()
            source_feature_index = feature_index(source_feature)
            for shared in sorted(
                section.get_shared_sub_segments(),
                key=lambda item: canonical_geometry_key(item.get_resolved_geometry_points()),
            ):
                points = shared.get_resolved_geometry_points()
                if len(points) < 2:
                    continue
                coordinate_offset = len(coordinates) // 2
                for point in points:
                    coordinates.extend(quantize(point))
                left_plate_ids = []
                right_plate_ids = []
                for topology, on_left in zip(
                    shared.get_sharing_resolved_topologies(),
                    shared.get_sharing_resolved_topology_on_left_flags(),
                ):
                    plate_id = topology_plate_id(topology)
                    if plate_id is not None:
                        (left_plate_ids if on_left else right_plate_ids).append(plate_id)
                overriding_plate_id = None
                subducting_plate_id = None
                if source_feature.get_feature_type() == pygplates.FeatureType.gpml_subduction_zone:
                    overriding_plate_id = topology_plate_id(shared.get_overriding_plate())
                    subducting_plate_id = topology_plate_id(shared.get_subducting_plate())
                segments.append([
                    age_index,
                    source_feature_index,
                    coordinate_offset,
                    len(points),
                    sorted(set(left_plate_ids)),
                    sorted(set(right_plate_ids)),
                    overriding_plate_id,
                    subducting_plate_id,
                ])
                segment_points.append(list(points))

        age_records.append({
            "ageMa": age_ma,
            "topologySlots": topology_slots,
            "topologySlotIdentitySha256": hashlib.sha256(json.dumps([
                [
                    str(topology.get_feature().get_feature_id()),
                    topology.get_feature().get_reconstruction_plate_id(None),
                    canonical_geometry_key(topology.get_resolved_boundary().get_exterior_ring_points()),
                ]
                for topology in boundaries
            ], separators=(",", ":")).encode()).hexdigest(),
            "segmentOffset": segment_start,
            "segmentCount": len(segments) - segment_start,
            "coverage": {
                "assignedCells": assigned,
                "ambiguousCells": ambiguous,
                "unknownCells": unknown,
                "continentalCells": continental,
                "totalCells": cell_count,
            },
        })

    rotation_sequences = []
    for source_order, feature in enumerate(pygplates.FeatureCollection(str(rotation_path))):
        fixed_plate_id, moving_plate_id, sequence = feature.get_total_reconstruction_pole()
        all_samples = [
            {"ageMa": round(float(sample.get_time()), 6), "quaternionWxyz": quaternion(sample.get_value().get_finite_rotation())}
            for sample in sequence.get_enabled_time_samples()
        ]
        if not all_samples or all_samples[0]["ageMa"] > 540:
            continue
        samples = [sample for sample in all_samples if sample["ageMa"] <= 540]
        older_bracket = next((sample for sample in all_samples if sample["ageMa"] > 540), None)
        if older_bracket is not None:
            samples.append(older_bracket)
        endpoint_inclusion = {}
        for name, age in (("youngest", all_samples[0]["ageMa"]), ("oldest", all_samples[-1]["ageMa"])):
            edge = rotation_model.get_reconstruction_tree(age).get_edge(moving_plate_id)
            endpoint_inclusion[name] = edge is not None and edge.get_fixed_plate_id() == fixed_plate_id
        rotation_sequences.append({
            "movingPlateId": moving_plate_id,
            "fixedPlateId": fixed_plate_id,
            "sampleRangeMa": {"youngest": all_samples[0]["ageMa"], "oldest": all_samples[-1]["ageMa"]},
            "endpointInclusion": endpoint_inclusion,
            "samples": samples,
        })

    def polyline_length(points) -> float:
        return sum(pygplates.GeometryOnSphere.distance(points[index], points[index + 1]) for index in range(len(points) - 1))

    def resample(points, count: int = 17):
        lengths = [pygplates.GeometryOnSphere.distance(points[index], points[index + 1]) for index in range(len(points) - 1)]
        cumulative = [0]
        for length in lengths:
            cumulative.append(cumulative[-1] + length)
        if cumulative[-1] < 1e-12:
            return [points[0]] * count
        output = []
        segment_index = 0
        for sample_index in range(count):
            target = cumulative[-1] * sample_index / (count - 1)
            while segment_index + 1 < len(cumulative) - 1 and cumulative[segment_index + 1] < target:
                segment_index += 1
            start = points[segment_index]
            end = points[segment_index + 1]
            length = lengths[segment_index]
            fraction = 0 if length < 1e-12 else (target - cumulative[segment_index]) / length
            start_xyz = start.to_xyz()
            end_xyz = end.to_xyz()
            sine = math.sin(length)
            output.append(start if sine < 1e-12 else pygplates.PointOnSphere(tuple(
                (math.sin((1 - fraction) * length) * start_xyz[index] + math.sin(fraction * length) * end_xyz[index]) / sine
                for index in range(3)
            )))
        return output

    def boundary_link_metrics(younger_points, older_points):
        younger_samples = resample(younger_points)
        older_samples = resample(older_points)
        forward_distance = max(
            pygplates.GeometryOnSphere.distance(left, right)
            for left, right in zip(younger_samples, older_samples)
        )
        reversed_distance = max(
            pygplates.GeometryOnSphere.distance(left, right)
            for left, right in zip(younger_samples, reversed(older_samples))
        )
        return forward_distance, reversed_distance

    synthetic_forward = [pygplates.PointOnSphere(0, longitude) for longitude in (0, 1, 3)]
    synthetic_reversed = list(reversed(synthetic_forward))
    synthetic_forward_distance, synthetic_reversed_distance = boundary_link_metrics(synthetic_forward, synthetic_reversed)
    if not synthetic_reversed_distance < synthetic_forward_distance:
        raise AssertionError("boundary orientation rejection self-test failed")

    boundary_links = []
    boundary_link_counts = {}
    for younger_age_index in range(len(AGES_MA) - 1):
        younger_record = age_records[younger_age_index]
        older_record = age_records[younger_age_index + 1]
        younger_indexes = range(younger_record["segmentOffset"], younger_record["segmentOffset"] + younger_record["segmentCount"])
        older_indexes = range(older_record["segmentOffset"], older_record["segmentOffset"] + older_record["segmentCount"])

        def correspondence_key(segment_index: int):
            segment = segments[segment_index]
            return (segment[1], tuple(segment[4]), tuple(segment[5]), segment[6], segment[7])

        younger_by_key = {}
        older_by_key = {}
        for segment_index in younger_indexes:
            younger_by_key.setdefault(correspondence_key(segment_index), []).append(segment_index)
        for segment_index in older_indexes:
            older_by_key.setdefault(correspondence_key(segment_index), []).append(segment_index)
        for key in sorted(set(younger_by_key) & set(older_by_key), key=repr):
            if len(younger_by_key[key]) != 1 or len(older_by_key[key]) != 1:
                continue
            younger_index = younger_by_key[key][0]
            older_index = older_by_key[key][0]
            feature = features[segments[younger_index][1]]
            oldest = feature["validTimeMa"]["oldest"]
            youngest = feature["validTimeMa"]["youngest"]
            if (oldest is not None and AGES_MA[younger_age_index + 1] > oldest) or (youngest is not None and AGES_MA[younger_age_index] < youngest):
                continue
            younger_length = polyline_length(segment_points[younger_index])
            older_length = polyline_length(segment_points[older_index])
            if min(younger_length, older_length) < 1e-12 or max(younger_length, older_length) / min(younger_length, older_length) > BOUNDARY_LINK_MAX_LENGTH_RATIO:
                continue
            maximum_distance, reversed_distance = boundary_link_metrics(
                segment_points[younger_index], segment_points[older_index],
            )
            if reversed_distance + 1e-9 < maximum_distance or maximum_distance > BOUNDARY_LINK_MAX_DISTANCE_RADIANS:
                continue
            boundary_links.append([younger_age_index, younger_index, older_index, round(maximum_distance, 9)])
            feature_type = feature["featureType"]
            boundary_link_counts[feature_type] = boundary_link_counts.get(feature_type, 0) + 1

    topology_row_offsets = [0]
    topology_runs = bytearray()
    for row_start in range(0, len(topology_grid), WIDTH):
        row = topology_grid[row_start:row_start + WIDTH]
        run_value = row[0]
        run_length = 1
        for value in row[1:]:
            if value == run_value and run_length < 255:
                run_length += 1
            else:
                topology_runs.extend((run_value, run_length))
                run_value = value
                run_length = 1
        topology_runs.extend((run_value, run_length))
        topology_row_offsets.append(len(topology_runs))
    topology_grid_section = struct.pack(f"<{len(topology_row_offsets)}I", *topology_row_offsets) + topology_runs

    candidate_age_offsets = [0]
    candidate_records = bytearray()
    for age_candidates in boundary_cell_candidates:
        for cell_index, slots in sorted(age_candidates.items()):
            if len(slots) >= 255:
                raise SystemExit(f"too many boundary candidates for cell {cell_index}")
            candidate_records.extend(struct.pack("<HB", cell_index, len(slots)))
            candidate_records.extend(sorted(slots))
        candidate_age_offsets.append(len(candidate_records))
    candidate_section = struct.pack(f"<{len(candidate_age_offsets)}I", *candidate_age_offsets) + candidate_records

    grid_offset = HEADER.size
    continent_offset = grid_offset + len(topology_grid_section)
    coordinate_offset = continent_offset + len(continent_mask)
    boundary_candidate_offset = coordinate_offset + len(coordinates) * 2
    binary = bytearray(HEADER.pack(
        b"EHCO", 1, WIDTH, HEIGHT, len(AGES_MA), grid_offset,
        continent_offset, coordinate_offset, len(coordinates) // 2, boundary_candidate_offset,
    ))
    binary.extend(topology_grid_section)
    binary.extend(continent_mask)
    binary.extend(struct.pack(f"<{len(coordinates)}h", *coordinates))
    binary.extend(candidate_section)
    binary_sha256 = hashlib.sha256(binary).hexdigest()

    metadata = {
        "schemaVersion": 1,
        "id": "cao-ocean-motion-v1",
        "model": {
            "id": "cao-et-al-2024",
            "version": "2.4",
            "sourceRecord": SOURCE_RECORD,
            "sourceArchiveSha256": SOURCE_ARCHIVE_SHA256,
            "license": "CC-BY-4.0",
            "referenceFrame": "palaeomagnetic",
            "anchorPlateId": 0,
        },
        "sourceMembers": [{"path": path.name, "sha256": sha256(path)} for path in source_paths],
        "binary": {
            "path": "cao-ocean-motion-v1.bin",
            "bytes": len(binary),
            "sha256": binary_sha256,
            "header": "32 bytes little-endian: EHCO; uint16 schema,width,height,ageCount; uint32 topologyGridOffset,continentMaskOffset,coordinateOffset,coordinatePairCount,boundaryCandidateOffset",
            "topologyGrid": "age-major rows compressed as uint32 row offsets followed by uint8 value,runLength pairs; decoded slots use 0 unknown, 255 ambiguous, otherwise one-based age topologySlots; exact ownership must use packed rings",
            "continentMask": "age-major row-major bitset; 1 means inside at least one reconstructed shapes_continents polygon",
            "coordinates": "flat int16 longitude,latitude pairs at scaleDegrees; resolved line direction retained",
            "boundaryCandidates": "uint32 age byte offsets followed by sorted <uint16 cellIndex,uint8 slotCount,uint8 slots[]> records; slotCount zero means exact full scan; ring samples <=0.5 degrees mark cell centres within 2.25 degrees",
        },
        "grid": {
            "width": WIDTH,
            "height": HEIGHT,
            "longitudes": "-180..178 inclusive, 2 degree spacing",
            "latitudes": "90..-90 inclusive, 2 degree spacing",
            "scaleDegrees": COORDINATE_SCALE_DEGREES,
        },
        "timeContract": {
            "nativeAgesMa": AGES_MA,
            "interpolation": "within a five-million-year bracket, retain a material only when model motion maps it to the same unambiguous plate at both endpoints",
            "topologySlotConvention": "source topology is resolved only at the native 5 Ma endpoints; no direct arbitrary-age resolution across the source's 0.1 Ma validity gaps",
            "lifecycle": "plate mismatch, topology ambiguity, ridge birth, subduction loss, or unknown ownership returns unsupported",
        },
        "coverage": {
            "classification": "target-native instantaneous global topology; 2-degree slots are candidate acceleration/diagnostics and packed rings provide exact ownership; not persistent material by itself",
            "minimumAssignedFraction": min(record["coverage"]["assignedCells"] / cell_count for record in age_records),
            "maximumAmbiguousFraction": max(record["coverage"]["ambiguousCells"] / cell_count for record in age_records),
            "maximumUnknownFraction": max(record["coverage"]["unknownCells"] / cell_count for record in age_records),
        },
        "features": features,
        "segments": segments,
        "segmentTuple": [
            "ageIndex", "sourceFeatureIndex", "coordinateOffset", "coordinateCount",
            "leftPlateIds", "rightPlateIds", "overridingPlateId|null", "subductingPlateId|null",
        ],
        "boundaryLinks": boundary_links,
        "boundaryLinkTuple": ["youngerAgeIndex", "youngerSegmentIndex", "olderSegmentIndex", "maximumResampledAngularDistanceRadians"],
        "boundaryInterpolation": {
            "method": "unique source feature and identical directed adjacency/polarity; normalized spherical-arclength resampling then geodesic point interpolation",
            "status": "interpolation between source-native resolved outputs, not direct model output",
            "maximumAngularDistanceRadians": BOUNDARY_LINK_MAX_DISTANCE_RADIANS,
            "maximumLengthRatio": BOUNDARY_LINK_MAX_LENGTH_RATIO,
            "unsupported": "split/merge, duplicate correspondence key, validity break, excessive shape change, reversed endpoint orientation (when reverse arclength correspondence is better), directed adjacency change, or missing source identity",
            "orientationRegression": "generator self-test rejects a synthetic reversed short segment",
            "countsByFeatureType": boundary_link_counts,
        },
        "ages": age_records,
        "rotationSequences": rotation_sequences,
        "rotationSequenceOrdering": "source file order; array index is the source-order precedence key",
        "epistemicStatus": "resolved model output at native ages; interpolation requires endpoint-consistent rigid material ownership",
    }
    metadata_bytes = (json.dumps(metadata, sort_keys=True, separators=(",", ":")) + "\n").encode()
    if len(binary) + len(metadata_bytes) > MAX_COMBINED_BYTES:
        raise SystemExit(
            f"combined Cao controls exceed {MAX_COMBINED_BYTES} bytes: "
            f"binary={len(binary)}, metadata={len(metadata_bytes)}, total={len(binary) + len(metadata_bytes)}"
        )
    args.binary_output.parent.mkdir(parents=True, exist_ok=True)
    args.binary_output.write_bytes(binary)
    args.metadata_output.write_bytes(metadata_bytes)
    print(f"wrote {args.binary_output} ({len(binary)} bytes, sha256 {binary_sha256})")
    print(f"wrote {args.metadata_output} ({len(metadata_bytes)} bytes, sha256 {hashlib.sha256(metadata_bytes).hexdigest()})")
    print(f"features {len(features)}, segments {len(segments)}, coordinate pairs {len(coordinates) // 2}, rotations {len(rotation_sequences)}")


if __name__ == "__main__":
    main()
