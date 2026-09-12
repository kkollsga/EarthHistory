#!/usr/bin/env python3
"""Compile tracked regional material masks and guarded Cao chart replacements."""

from __future__ import annotations

import hashlib
import importlib.util
import json
import math
import struct
import subprocess
import tempfile
from pathlib import Path

import cao_material_corrections as contract


ROOT = Path(__file__).resolve().parents[2]
PUBLIC = ROOT / "public/data/reconstruction/cao-v2.4"
OUT = PUBLIC / "corrections/material-v1"
CATALOG_ID = "earthhistory-cao-v2.4-material-corrections-v1"
CATALOG_VERSION = "3"
QUALIFIED_COLOR = [0.58, 0.52, 0.28]
UNCERTAIN_COLOR = [0.34, 0.38, 0.35]
MAX_EDGE_RADIANS = math.radians(1)
EARTH_RADIUS_METRES = 6_371_000
DISPLAY_SHELL_OFFSET_METRES = 400
MAX_GEOMETRY_BYTES = 8 * 1024 * 1024


def canonical_json(value: object) -> bytes:
    return (json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode()


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def asset(path: Path) -> dict:
    return {"url": str(path.relative_to(PUBLIC)), "bytes": path.stat().st_size, "sha256": sha256(path)}


def unit(values):
    length = math.sqrt(sum(value * value for value in values))
    if length <= 1e-15:
        raise contract.CorrectionError("cannot normalize correction direction")
    return tuple(value / length for value in values)


def lon_lat_direction(position):
    lon, lat = map(math.radians, position[:2])
    radius = math.cos(lat)
    return (radius * math.cos(lon), radius * math.sin(lon), math.sin(lat))


def inverse(q):
    return (q[0], -q[1], -q[2], -q[3])


def compose(left, right):
    aw, ax, ay, az = left
    bw, bx, by, bz = right
    return (aw * bw - ax * bx - ay * by - az * bz,
            aw * bx + ax * bw + ay * bz - az * by,
            aw * by - ax * bz + ay * bw + az * bx,
            aw * bz + ax * by - ay * bx + az * bw)


def rotate(q, vector):
    w, x, y, z = q
    vx, vy, vz = vector
    tx, ty, tz = 2 * (y * vz - z * vy), 2 * (z * vx - x * vz), 2 * (x * vy - y * vx)
    return unit((vx + w * tx + (y * tz - z * ty),
                 vy + w * ty + (z * tx - x * tz),
                 vz + w * tz + (x * ty - y * tx)))


def dot(left, right):
    return sum(a * b for a, b in zip(left, right))


def angular_distance(left, right):
    return math.acos(max(-1, min(1, dot(unit(left), unit(right)))))


def float32_direction(direction):
    return struct.unpack("<fff", struct.pack("<fff", *direction))


def segment_radius(left, right):
    delta = tuple(right[axis] - left[axis] for axis in range(3))
    denominator = dot(delta, delta)
    fraction = 0 if denominator <= 1e-30 else max(0, min(1, -dot(left, delta) / denominator))
    point = tuple(left[axis] + fraction * delta[axis] for axis in range(3))
    return math.sqrt(dot(point, point))


def triangle_minimum_radius(left, middle, right):
    edge_a = tuple(middle[axis] - left[axis] for axis in range(3))
    edge_b = tuple(right[axis] - left[axis] for axis in range(3))
    normal = (edge_a[1] * edge_b[2] - edge_a[2] * edge_b[1],
              edge_a[2] * edge_b[0] - edge_a[0] * edge_b[2],
              edge_a[0] * edge_b[1] - edge_a[1] * edge_b[0])
    denominator = dot(normal, normal)
    if denominator > 1e-30:
        scale = dot(left, normal) / denominator
        projected = tuple(scale * value for value in normal)
        v2 = tuple(projected[axis] - left[axis] for axis in range(3))
        d00, d01, d11 = dot(edge_a, edge_a), dot(edge_a, edge_b), dot(edge_b, edge_b)
        d20, d21 = dot(v2, edge_a), dot(v2, edge_b)
        barycentric_denominator = d00 * d11 - d01 * d01
        if abs(barycentric_denominator) > 1e-30:
            v = (d11 * d20 - d01 * d21) / barycentric_denominator
            w = (d00 * d21 - d01 * d20) / barycentric_denominator
            if v >= 0 and w >= 0 and v + w <= 1:
                return math.sqrt(dot(projected, projected))
    return min(segment_radius(left, middle), segment_radius(middle, right),
               segment_radius(right, left))


def refine_triangle_edges(directions, indices, vertex_charts):
    """Conformingly bisect every correction-mesh edge until it is at most 1 degree."""
    triangles = [tuple(indices[offset:offset + 3]) for offset in range(0, len(indices), 3)]
    rounds = 0
    while True:
        violating = set()
        for triangle in triangles:
            for left, right in ((triangle[0], triangle[1]), (triangle[1], triangle[2]),
                                (triangle[2], triangle[0])):
                edge = tuple(sorted((left, right)))
                if angular_distance(directions[edge[0]], directions[edge[1]]) > MAX_EDGE_RADIANS + 1e-12:
                    violating.add(edge)
        if not violating:
            break
        rounds += 1
        if rounds > 32:
            raise contract.CorrectionError("correction edge refinement did not converge")
        refined_triangle_count = 0
        for a, b, c in triangles:
            marked = sum(tuple(sorted(edge)) in violating
                         for edge in ((a, b), (b, c), (c, a)))
            refined_triangle_count += (1, 2, 3, 4)[marked]
        refined_vertex_count = len(directions) + len(violating)
        if 32 + 20 * refined_vertex_count + 12 * refined_triangle_count >= MAX_GEOMETRY_BYTES:
            raise contract.CorrectionError("correction edge refinement exceeds binary byte bound")
        midpoints = {}
        for edge in sorted(violating):
            left, right = edge
            if vertex_charts[left] != vertex_charts[right]:
                raise contract.CorrectionError("correction triangle edge crosses chart identity")
            midpoints[edge] = len(directions)
            directions.append(unit(tuple(directions[left][axis] + directions[right][axis]
                                         for axis in range(3))))
            vertex_charts.append(vertex_charts[left])
        refined = []
        for a, b, c in triangles:
            ab = midpoints.get(tuple(sorted((a, b))))
            bc = midpoints.get(tuple(sorted((b, c))))
            ca = midpoints.get(tuple(sorted((c, a))))
            mask = (1 if ab is not None else 0) | (2 if bc is not None else 0) | (4 if ca is not None else 0)
            if mask == 0:
                refined.append((a, b, c))
            elif mask == 1:
                refined.extend(((a, ab, c), (ab, b, c)))
            elif mask == 2:
                refined.extend(((b, bc, a), (bc, c, a)))
            elif mask == 4:
                refined.extend(((c, ca, b), (ca, a, b)))
            elif mask == 3:
                refined.extend(((b, bc, ab), (a, ab, c), (ab, bc, c)))
            elif mask == 6:
                refined.extend(((c, ca, bc), (b, bc, a), (bc, ca, a)))
            elif mask == 5:
                refined.extend(((a, ab, ca), (c, ca, b), (ca, ab, b)))
            else:
                refined.extend(((a, ab, ca), (ab, b, bc), (ca, bc, c), (ab, bc, ca)))
        triangles = refined
    refined_indices = [index for triangle in triangles for index in triangle]
    validate_triangle_clearance(directions, refined_indices)
    return directions, refined_indices, vertex_charts


def validate_triangle_clearance(directions, indices):
    shell_radius = 1 + DISPLAY_SHELL_OFFSET_METRES / EARTH_RADIUS_METRES
    minimum = math.inf
    maximum_edge = 0.0
    quantized = [float32_direction(direction) for direction in directions]
    for offset in range(0, len(indices), 3):
        triangle = [quantized[indices[offset + local]] for local in range(3)]
        maximum_edge = max(maximum_edge, *(angular_distance(triangle[local], triangle[(local + 1) % 3])
                                            for local in range(3)))
        minimum = min(minimum, triangle_minimum_radius(*triangle) * shell_radius)
    if maximum_edge > MAX_EDGE_RADIANS + 1e-6:
        raise contract.CorrectionError(
            f"correction triangle edge {math.degrees(maximum_edge):.6g} degrees exceeds 1 degree"
        )
    if minimum <= 1:
        raise contract.CorrectionError(
            f"correction triangle shell radius {minimum:.9g} intersects opaque globe"
        )
    return {"maximumEdgeDegrees": math.degrees(maximum_edge), "minimumDisplayedRadius": minimum}


def slerp(left, right, fraction):
    cosine = dot(left, right)
    if cosine < 0:
        right = tuple(-value for value in right)
        cosine = -cosine
    if cosine > 0.999999:
        return unit(tuple((1 - fraction) * a + fraction * b for a, b in zip(left, right)))
    angle = math.acos(max(-1, min(1, cosine)))
    scale = math.sin(angle)
    return tuple((math.sin((1 - fraction) * angle) * a + math.sin(fraction * angle) * b) / scale
                 for a, b in zip(left, right))


def palette_data():
    manifest = json.loads((PUBLIC / "manifest.json").read_text())
    catalog = json.loads((PUBLIC / manifest["motionPalette"]["catalog"]["url"]).read_text())
    binary = (PUBLIC / manifest["motionPalette"]["binary"]["url"]).read_bytes()
    if binary[:4] != b"EHMP" or hashlib.sha256(binary).hexdigest() != manifest["motionPalette"]["binary"]["sha256"]:
        raise contract.CorrectionError("baseline motion palette changed")
    records = [struct.unpack_from("<Iffff", binary, 32 + index * 20)
               for index in range((len(binary) - 32) // 20)]
    return manifest, catalog, records


def entries_covering(catalog, plate_id, youngest, oldest):
    """Return an unambiguous, gap-free palette partition for an interval."""
    if oldest < youngest:
        raise contract.CorrectionError(f"plate {plate_id}: reversed motion interval")
    candidates = sorted(
        (entry for entry in catalog["entries"] if entry["plateId"] == plate_id),
        key=lambda entry: (entry["youngestAgeMa"], entry["oldestAgeMa"], entry["entryId"]),
    )
    if youngest == oldest:
        matches = [entry for entry in candidates
                   if entry["youngestAgeMa"] <= youngest <= entry["oldestAgeMa"]]
        if not matches:
            raise contract.CorrectionError(
                f"plate {plate_id}: baseline palette does not cover {youngest} Ma"
            )
        return [(matches[0], youngest, oldest)]
    selected = []
    cursor = youngest
    while cursor < oldest:
        matches = [entry for entry in candidates
                   if entry["youngestAgeMa"] <= cursor < entry["oldestAgeMa"]]
        correction_matches = [entry for entry in matches
                              if entry["entryId"].startswith("correction-plate-")]
        native_matches = [entry for entry in matches
                          if not entry["entryId"].startswith("correction-plate-")]
        if cursor >= 410 and correction_matches:
            matches = correction_matches
        elif cursor < 410 and native_matches:
            matches = native_matches
        if len(matches) != 1:
            raise contract.CorrectionError(
                f"plate {plate_id}: expected one baseline palette entry at {cursor} Ma, "
                f"found {len(matches)}"
            )
        entry = matches[0]
        next_cursor = min(float(entry["oldestAgeMa"]), oldest)
        if native_matches and cursor < 410 < next_cursor and correction_matches == []:
            starts = [candidate["youngestAgeMa"] for candidate in candidates
                      if candidate["entryId"].startswith("correction-plate-")
                      and cursor < candidate["youngestAgeMa"] < next_cursor]
            if starts:
                next_cursor = min(next_cursor, min(starts))
        selected.append((entry, cursor, next_cursor))
        if next_cursor <= cursor:
            raise contract.CorrectionError(f"plate {plate_id}: non-advancing motion partition")
        cursor = next_cursor
    return selected


def quaternion_at(entry, records, age_ma):
    rows = records[entry["sampleOffset"]:entry["sampleOffset"] + entry["sampleCount"]]
    target = round(age_ma * 1_000_000)
    for row in rows:
        if row[0] == target:
            return unit(row[1:])
    for younger, older in zip(rows, rows[1:]):
        if younger[0] < target < older[0]:
            return slerp(unit(younger[1:]), unit(older[1:]),
                         (target - younger[0]) / (older[0] - younger[0]))
    raise contract.CorrectionError(f"motion entry {entry['entryId']} has no sample bracketing {age_ma} Ma")


def quaternion_for_plate_at(catalog, records, plate_id, age_ma, *, correction_preferred=False):
    """Resolve a covered age; never hold a nearest palette entry across a gap."""
    matches = [entry for entry in catalog["entries"] if entry["plateId"] == plate_id
               and entry["youngestAgeMa"] <= age_ma <= entry["oldestAgeMa"]]
    correction_matches = [entry for entry in matches
                          if entry["entryId"].startswith("correction-plate-")]
    if correction_preferred and correction_matches:
        matches = correction_matches
    if not matches:
        raise contract.CorrectionError(f"plate {plate_id}: baseline palette does not cover {age_ma} Ma")
    quaternions = [quaternion_at(entry, records, age_ma) for entry in matches]
    reference = quaternions[0]
    for candidate in quaternions[1:]:
        cosine = abs(dot(unit(reference), unit(candidate)))
        residual = 2 * math.acos(max(-1, min(1, cosine)))
        if residual > 1e-5:
            raise contract.CorrectionError(
                f"plate {plate_id}: ambiguous baseline pose at {age_ma} Ma ({residual:.9g} radians)"
            )
    return reference


def palette_bindings(catalog, plate_id, youngest, oldest):
    return [
        {
            "paletteId": catalog["id"],
            "entryId": entry["entryId"],
            "validTimeMa": {
                "youngest": binding_youngest,
                "oldest": binding_oldest,
            },
        }
        for entry, binding_youngest, binding_oldest in entries_covering(
            catalog, plate_id, youngest, oldest
        )
    ]


def chart_binding_signature(chart, palette_id, youngest, oldest):
    bindings = sorted(
        (binding for binding in chart.get("motionBindings", [])
         if binding.get("paletteId") == palette_id),
        key=lambda binding: (binding["validTimeMa"]["youngest"],
                             binding["validTimeMa"]["oldest"], binding["entryId"]),
    )
    signature = []
    cursor = youngest
    while cursor < oldest:
        matches = [binding for binding in bindings
                   if binding["validTimeMa"]["youngest"] <= cursor
                   < binding["validTimeMa"]["oldest"]]
        if len(matches) != 1:
            raise contract.CorrectionError(
                f"{chart.get('chartId')}: expected one native motion binding at {cursor} Ma, "
                f"found {len(matches)}"
            )
        binding = matches[0]
        next_cursor = min(float(binding["validTimeMa"]["oldest"]), oldest)
        signature.append({
            "entryId": binding["entryId"],
            "youngest": cursor,
            "oldest": next_cursor,
        })
        cursor = next_cursor
    return signature


def polygons(geometry):
    if geometry["type"] == "Polygon":
        return [geometry["coordinates"]]
    if geometry["type"] == "MultiPolygon":
        return geometry["coordinates"]
    raise contract.CorrectionError(f"unsupported geometry type {geometry.get('type')}")


def find_geojson_feature(feature, manifest_path):
    descriptor = feature["geometryAsset"]
    data = json.loads((manifest_path.parent / descriptor["path"]).read_text())
    matches = [item for item in data["features"] if
               str(item.get("id", item.get("properties", {}).get("correctionFeatureId"))) == descriptor["featureId"]]
    if len(matches) != 1:
        raise contract.CorrectionError(f"{feature['correctionFeatureId']}: GeoJSON feature match changed")
    return matches[0]


def direction_lon_lat(direction):
    x, y, z = direction
    return math.degrees(math.atan2(y, x)), math.degrees(math.asin(max(-1, min(1, z))))


def sample_direction_arc(start, end, maximum_step_degrees=0.1):
    cosine = max(-1, min(1, sum(left * right for left, right in zip(start, end))))
    angle = math.acos(cosine)
    steps = max(1, math.ceil(math.degrees(angle) / maximum_step_degrees))
    for step in range(steps + 1):
        fraction = step / steps
        if angle < 1e-10:
            yield start
        else:
            scale = math.sin(angle)
            yield unit(tuple(
                math.sin((1 - fraction) * angle) / scale * start[axis]
                + math.sin(fraction * angle) / scale * end[axis]
                for axis in range(3)
            ))


def local_ring(ring, longitude, latitude):
    cosine = max(1e-6, math.cos(math.radians(latitude)))
    return [((((point[0] - longitude + 180) % 360) - 180) * cosine * 111.195,
             (point[1] - latitude) * 111.195) for point in ring]


def point_in_ring_origin(ring):
    inside = False
    for index, (left_x, left_y) in enumerate(ring):
        right_x, right_y = ring[(index + 1) % len(ring)]
        if ((left_y > 0) != (right_y > 0)
                and 0 < (right_x - left_x) * (-left_y) / (right_y - left_y) + left_x):
            inside = not inside
    return inside


def segment_distance_origin(left, right):
    dx, dy = right[0] - left[0], right[1] - left[1]
    length_squared = dx * dx + dy * dy
    if length_squared <= 1e-18:
        return math.hypot(*left)
    fraction = max(0, min(1, -(left[0] * dx + left[1] * dy) / length_squared))
    return math.hypot(left[0] + fraction * dx, left[1] + fraction * dy)


def geometry_distance_km(geometry, longitude, latitude):
    polygons = geometry["coordinates"] if geometry["type"] == "MultiPolygon" else [geometry["coordinates"]]
    minimum = math.inf
    for polygon in polygons:
        rings = [local_ring(ring, longitude, latitude) for ring in polygon]
        if point_in_ring_origin(rings[0]) and not any(point_in_ring_origin(ring) for ring in rings[1:]):
            return 0.0
        for ring in rings:
            for index, left in enumerate(ring):
                minimum = min(minimum, segment_distance_origin(left, ring[(index + 1) % len(ring)]))
    return minimum


def country_segment_bindings(native_core, source_country_chart_ids, geojson):
    chart_indices = {index: chart["chartId"] for index, chart in enumerate(native_core["charts"])
                     if chart["chartId"] in source_country_chart_ids}
    bindings = []
    for descriptor in native_core.get("lineBatches", []):
        binary = (PUBLIC / descriptor["geometryAsset"]["url"]).read_bytes()
        vertex_count = descriptor["vertexCount"]
        segment_count = descriptor["segmentCount"]
        if binary[:4] != b"EHGL" or len(binary) != 32 + vertex_count * 16 + segment_count * 8:
            raise contract.CorrectionError("native country-reference asset changed")
        directions = struct.unpack_from(f"<{vertex_count * 3}f", binary, 32)
        vertex_charts = struct.unpack_from(f"<{vertex_count}I", binary, 32 + vertex_count * 12)
        line_indices = struct.unpack_from(f"<{segment_count * 2}I", binary, 32 + vertex_count * 16)
        direction_at = lambda vertex: tuple(directions[vertex * 3:vertex * 3 + 3])
        for segment_index in range(segment_count):
            left, right = line_indices[segment_index * 2:segment_index * 2 + 2]
            source_index = vertex_charts[left]
            if source_index not in chart_indices:
                continue
            if vertex_charts[right] != source_index:
                raise contract.CorrectionError("native country segment crosses its source chart")
            domain_ids = set()
            maximum_distance = 0.0
            for sample in sample_direction_arc(direction_at(left), direction_at(right)):
                longitude, latitude = direction_lon_lat(sample)
                distances = [(geometry_distance_km(feature["geometry"], longitude, latitude),
                              str(feature["id"])) for feature in geojson["features"]]
                nearest = min(distance for distance, _ in distances)
                maximum_distance = max(maximum_distance, nearest)
                domain_ids.update(feature_id for distance, feature_id in distances
                                  if abs(distance - nearest) <= 1e-6)
            if maximum_distance > 12:
                raise contract.CorrectionError(
                    f"country segment {segment_index} is {maximum_distance:.6g} km from its nearest domain"
                )
            bindings.append({
                "batchId": descriptor["batchId"],
                "segmentIndex": segment_index,
                "sourceCountryChartId": chart_indices[source_index],
                "domainFragmentOrCohortIds": sorted(domain_ids),
                "maximumMatchKm": round(maximum_distance, 6),
            })
    return bindings


def native_override_rows(native_core):
    targets = contract.load_tracked_targets()
    overrides = []
    synthetic_rows = []
    for override_path in sorted(contract.CORRECTIONS.glob("*/native-overrides.json")):
        document = json.loads(override_path.read_text())
        if document.get("schemaVersion") != 1:
            raise contract.CorrectionError(f"{override_path}: unsupported native override schema")
        for raw in document.get("nativeChartOverrides", []):
            target = raw["nativeTarget"]
            expected = targets.get(target["patchId"])
            for key in ("patchId", "sourceFeatureId", "sourceFeatureOrder", "geometryOrder", "plateId", "geometrySha256"):
                if expected is None or target.get(key) != expected.get(key):
                    raise contract.CorrectionError(f"{raw.get('overrideId')}: native target identity changed")
            if (target.get("sourceCollection") != contract.SOURCE_COLLECTION
                    or target.get("sourceCollectionSha256") != contract.SOURCE_SHA256):
                raise contract.CorrectionError(f"{raw.get('overrideId')}: native source collection changed")
            asset = raw["replacementAsset"]
            asset_path = override_path.parent / asset["path"]
            if (not asset_path.is_file() or asset_path.stat().st_size != asset["bytes"]
                    or sha256(asset_path) != asset["sha256"]):
                raise contract.CorrectionError(f"{raw.get('overrideId')}: replacement asset changed")
            geojson = json.loads(asset_path.read_text())
            if geojson.get("type") != "FeatureCollection" or not geojson.get("features"):
                raise contract.CorrectionError(f"{raw.get('overrideId')}: replacement must be a FeatureCollection")
            chart_ids = []
            for source in geojson["features"]:
                properties = source.get("properties", {})
                feature_id = str(source.get("id", ""))
                if (not feature_id or properties.get("targetPatchId") != target["patchId"]
                        or properties.get("surfaceEvidence") != "unknown"
                        or properties.get("pose", {}).get("plateId") != target["plateId"]):
                    raise contract.CorrectionError(f"{raw.get('overrideId')}: invalid replacement feature identity")
                origin = properties.get("materialOriginRangeMa")
                if origin is not None and (not isinstance(origin, list) or len(origin) != 2
                        or not all(isinstance(value, (int, float)) and not isinstance(value, bool) for value in origin)
                        or origin[0] < origin[1]):
                    raise contract.CorrectionError(f"{feature_id}: invalid material-origin range")
                geometry_lifecycle = properties.get("geometryLifecycleMa")
                if (not isinstance(geometry_lifecycle, dict)
                        or not all(isinstance(geometry_lifecycle.get(key), (int, float))
                                   and not isinstance(geometry_lifecycle.get(key), bool)
                                   for key in ("youngest", "oldest"))
                        or geometry_lifecycle["youngest"] < 0
                        or geometry_lifecycle["oldest"] < geometry_lifecycle["youngest"]
                        or geometry_lifecycle["oldest"] > 540):
                    raise contract.CorrectionError(f"{feature_id}: invalid geometry lifecycle")
                status_rows = properties.get("materialStatusIntervalsMa")
                if not isinstance(status_rows, list) or not status_rows:
                    raise contract.CorrectionError(f"{feature_id}: missing material-status intervals")
                statuses = {row.get("status") for row in status_rows if isinstance(row, dict)}
                if not statuses <= {"material-supported", "formation-uncertain", "absent-before-formation",
                                    "native-source-supported-material-age-unknown"}:
                    raise contract.CorrectionError(f"{feature_id}: invalid material-status interval")
                geometry_youngest = float(geometry_lifecycle["youngest"])
                geometry_oldest = float(geometry_lifecycle["oldest"])
                phase_lifecycles = {}
                if origin is None:
                    if statuses != {"native-source-supported-material-age-unknown"}:
                        raise contract.CorrectionError(
                            f"{feature_id}: unknown origin is allowed only for retained native semantics"
                        )
                    supported_oldest = geometry_oldest
                elif "formation-uncertain" not in statuses:
                    if "material-supported" not in statuses:
                        raise contract.CorrectionError(f"{feature_id}: source-supported interval is missing")
                    supported_oldest = geometry_oldest
                else:
                    supported_oldest = min(float(origin[1]), geometry_oldest)
                if supported_oldest >= geometry_youngest:
                    phase_lifecycles["model-pose"] = {
                        "validTimeMa": {"youngest": geometry_youngest, "oldest": supported_oldest}
                    }
                possible_oldest = geometry_oldest if origin is None else min(float(origin[0]), geometry_oldest)
                if "formation-uncertain" in statuses and possible_oldest > supported_oldest:
                    phase_lifecycles["formation"] = {
                        "validTimeMa": {"youngest": supported_oldest, "oldest": possible_oldest},
                        "youngestExclusive": True,
                    }
                feature = {
                    "correctionFeatureId": feature_id,
                    "geometryAsset": {"path": asset["path"], "featureId": feature_id, "sha256": asset["sha256"]},
                    "geometryReferenceAgeMa": 0,
                    "pose": {"plateId": target["plateId"]},
                    "targets": [target],
                    "sourceIds": raw["sourceIds"],
                    "surfaceEvidence": {"kind": "unknown", "reason": "domain replacement does not establish surface exposure or height"},
                    "uncertainty": {
                        "spatial": properties.get("ageUncertainty", "domain-scale footprint is a schematic extent during its origin range"),
                        "temporal": "material-origin bounds do not define simultaneous formation of the complete polygon",
                        "exposure": "surface exposure and elevation are unknown",
                    },
                    "replacementPhaseLifecycles": phase_lifecycles,
                    "replacementEvidence": {
                        "materialOriginRangeMa": None if origin is None else [float(origin[0]), float(origin[1])],
                        "materialStatus": ("native-source-supported-age-unknown" if origin is None
                                           else "supported"),
                        "poseStatus": properties.get("pose", {}).get("status", "model-inference"),
                        "poseWarning": properties.get("pose", {}).get("warning", "target-partition pose is a model inference"),
                        "domain": properties.get("domain", feature_id),
                    },
                }
                manifest = {"correctionId": raw["correctionId"]}
                synthetic_rows.append((manifest, override_path, feature))
                for phase in phase_lifecycles:
                    chart_ids.append(f"correction:{raw['correctionId']}:{feature_id}:{phase}")
            native_chart = next((chart for chart in native_core["charts"]
                                 if chart["chartId"] == raw["nativeChart"]["chartId"]), None)
            if native_chart is None:
                raise contract.CorrectionError(f"{raw.get('overrideId')}: native chart is missing")
            if any(native_chart.get(key) != value for key, value in raw["nativeChart"].items()):
                raise contract.CorrectionError(f"{raw.get('overrideId')}: native chart identity changed")
            suppression = raw["suppression"]["validTimeMa"]
            native_signature = chart_binding_signature(
                native_chart, "cao-v2.4-shared-motion-v1",
                suppression["youngest"], suppression["oldest"],
            )
            source_country_chart_ids = sorted(chart["chartId"] for chart in native_core["charts"]
                if chart["role"] == "country-reference"
                and target["sourceFeatureId"] in chart.get("sourceFeatureIds", [])
                and chart_binding_signature(
                    chart, "cao-v2.4-shared-motion-v1",
                    suppression["youngest"], suppression["oldest"],
                ) == native_signature)
            if not source_country_chart_ids:
                raise contract.CorrectionError(f"{raw.get('overrideId')}: source country consumers are missing")
            segment_bindings = country_segment_bindings(native_core, source_country_chart_ids, geojson)
            if not segment_bindings:
                raise contract.CorrectionError(f"{raw.get('overrideId')}: source country segments are missing")
            overrides.append({
                "overrideId": raw["overrideId"], "operation": raw["operation"],
                "correctionId": raw["correctionId"], "nativeTarget": target,
                "nativeChart": raw["nativeChart"], "suppression": raw["suppression"],
                "replacementAssetSha256": asset["sha256"],
                "replacementChartIds": sorted(chart_ids), "sourceIds": raw["sourceIds"],
                "dependentConsumers": {
                    "countryReferences": "spatial-segment-remap",
                    "sourceCountryChartIds": source_country_chart_ids,
                    "maximumSegmentSampleDegrees": 0.1,
                    "maximumDomainMatchKm": 12,
                    "expectedSourceSegmentCount": len(segment_bindings),
                    "countrySegmentBindings": segment_bindings,
                    "anchors": "require-none",
                },
                "reason": raw["reason"],
            })
    return overrides, synthetic_rows


def normalize_direction(direction, feature, palette, records):
    reference_age = feature["geometryReferenceAgeMa"]
    if reference_age == 0:
        return direction
    relative = quaternion_for_plate_at(
        palette, records, feature["pose"]["plateId"], reference_age,
        correction_preferred=reference_age >= 410,
    )
    normalized = rotate(inverse(relative), direction)
    round_trip = rotate(relative, normalized)
    error = math.degrees(math.acos(max(-1, min(1, dot(round_trip, direction)))))
    if error > 1e-5:
        raise contract.CorrectionError(
            f"{feature['correctionFeatureId']}: reference normalization failed ({error:.9g} degrees)"
        )
    return normalized


def alignment_witnesses(rows, palette, records):
    output = []
    for manifest, _, feature in rows:
        reference_age = feature["geometryReferenceAgeMa"]
        if reference_age == 0:
            continue
        target_plate = feature["sourceBasis"]["targetPlateIds"][0]
        for source in feature["pose"]["alignmentWitnesses"]:
            reference = lon_lat_direction(source["referenceLonLat"])
            pose_reference = quaternion_for_plate_at(
                palette, records, feature["pose"]["plateId"], reference_age,
                correction_preferred=reference_age >= 410,
            )
            normalized = rotate(inverse(pose_reference), reference)
            pose_411 = quaternion_for_plate_at(
                palette, records, feature["pose"]["plateId"], 411,
                correction_preferred=True,
            )
            target_reference = quaternion_for_plate_at(
                palette, records, target_plate, reference_age
            )
            target_411 = quaternion_for_plate_at(palette, records, target_plate, 411)
            palette_target_411 = rotate(compose(target_411, inverse(target_reference)), reference)
            independent = next(item for item in source["olderPoseComparisons"] if item["ageMa"] == 411)
            expected_411 = lon_lat_direction(independent["expectedLonLat"])
            compiled_411 = rotate(pose_411, normalized)
            residual = math.degrees(math.acos(max(-1, min(1, dot(expected_411, compiled_411)))))
            target_residual = math.degrees(math.acos(max(-1, min(1, dot(expected_411, palette_target_411)))))
            normalization = math.degrees(math.acos(max(-1, min(1, dot(reference, normalized)))))
            if residual > 1e-5 or target_residual > 1e-5 or normalization < 1:
                raise contract.CorrectionError(
                    f"{source['witnessId']}: independent target/pose alignment failed "
                    f"({residual:.9g}/{target_residual:.9g} degrees; normalization {normalization:.6g})"
                )
            output.append({
                "witnessId": source["witnessId"],
                "correctionId": manifest["correctionId"],
                "chartId": f"correction:{manifest['correctionId']}:{feature['correctionFeatureId']}:qualified",
                "referenceAgeMa": reference_age,
                "referenceLonLat": source["referenceLonLat"],
                "normalizedDirectionAtZero": list(normalized),
                "expectedDirectionAt411Ma": list(expected_411),
                "posePlateId": feature["pose"]["plateId"],
                "targetPlateId": target_plate,
                "normalizationAngularDegrees": normalization,
                "targetPoseResidualAt411Degrees": residual,
                "paletteTargetResidualAt411Degrees": target_residual,
                "oracle": "tracked-pygplates-target-plate-witness",
            })
    return output


def stage_phases(rows, phases, batch_name, native_chart_count, palette, records, temporary):
    directions = []
    patch_rows = []
    chart_indices = {}
    for manifest, manifest_path, feature in rows:
        intervals = {name: (youngest, oldest) for name, youngest, oldest
                     in contract.feature_phase_intervals(feature, feature["correctionFeatureId"])}
        for phase in phases:
            if phase not in intervals:
                continue
            chart_index = native_chart_count + len(chart_indices)
            chart_indices[(manifest["correctionId"], feature["correctionFeatureId"], phase)] = chart_index
            source = find_geojson_feature(feature, manifest_path)
            for polygon_index, polygon in enumerate(polygons(source["geometry"])):
                rings = []
                polygon_directions = []
                for coordinates in polygon:
                    if coordinates[0][:2] == coordinates[-1][:2]:
                        coordinates = coordinates[:-1]
                    offset = len(directions)
                    ring_directions = [normalize_direction(lon_lat_direction(position), feature, palette, records)
                                       for position in coordinates]
                    directions.extend(ring_directions)
                    polygon_directions.extend(ring_directions)
                    rings.append({"offset": offset, "count": len(ring_directions)})
                patch_rows.append({
                    "patchId": f"{feature['correctionFeatureId']}:{phase}:{polygon_index}",
                    "rings": rings,
                    "interiorDirection": list(unit(tuple(sum(point[axis] for point in polygon_directions)
                                                            for axis in range(3)))),
                    "chartIndex": chart_index,
                })
    if not patch_rows:
        return None
    raw = bytearray(12 * len(directions))
    for index, direction in enumerate(directions):
        struct.pack_into("<fff", raw, index * 12, *direction)
    metadata_path = temporary / f"{batch_name}-rings.json"
    directions_path = temporary / f"{batch_name}-directions.f32"
    indices_path = temporary / f"{batch_name}-indices.u32"
    metadata_path.write_bytes(canonical_json({"patches": patch_rows}))
    directions_path.write_bytes(raw)
    subprocess.run(["node", str(ROOT / "scripts/research/triangulate_cao_rings.mjs"),
                    str(metadata_path), str(directions_path), str(indices_path)], check=True)
    triangulated = json.loads(Path(str(indices_path) + ".json").read_text())
    failures = [row for row in triangulated["patches"] if row["status"] != "candidate"]
    if failures:
        raise contract.CorrectionError(
            f"{batch_name}: {len(failures)} correction polygons failed triangulation: "
            + ", ".join(f"{row['patchId']} ({row['status']})" for row in failures)
        )
    indices = list(struct.unpack(f"<{indices_path.stat().st_size // 4}I", indices_path.read_bytes()))
    vertex_charts = [0] * len(directions)
    for row in triangulated["patches"]:
        original = next(item for item in patch_rows if item["patchId"] == row["patchId"])
        for ring in original["rings"]:
            vertex_charts[ring["offset"]:ring["offset"] + ring["count"]] = [original["chartIndex"]] * ring["count"]
    directions, indices, vertex_charts = refine_triangle_edges(directions, indices, vertex_charts)
    return directions, indices, vertex_charts, chart_indices


def write_geometry(path, directions, indices, charts):
    size = 32 + 20 * len(directions) + 12 * (len(indices) // 3)
    payload = bytearray(size)
    payload[:4] = b"EHGB"
    struct.pack_into("<HHIIIIII", payload, 4, 2, 32, len(directions), len(indices) // 3, 0, 0, 0, 0)
    offset = 32
    for direction in directions:
        struct.pack_into("<fff", payload, offset, *direction)
        offset += 12
    for index in range(len(directions)):
        struct.pack_into("<I", payload, offset, 2_000_000_000 + index)
        offset += 4
    for chart in charts:
        struct.pack_into("<I", payload, offset, chart)
        offset += 4
    for index in indices:
        struct.pack_into("<I", payload, offset, index)
        offset += 4
    if offset != size or size >= MAX_GEOMETRY_BYTES:
        raise contract.CorrectionError("correction geometry exceeds its binary contract")
    path.write_bytes(payload)


def chart(manifest, feature, phase, palette):
    intervals = {name: (youngest, oldest) for name, youngest, oldest
                 in contract.feature_phase_intervals(feature, feature["correctionFeatureId"])}
    youngest, oldest = intervals[phase]
    feature_id = feature["correctionFeatureId"]
    correction_id = manifest["correctionId"]
    source_ids = [str(value) for value in feature["sourceIds"]]
    replacement = feature.get("replacementEvidence")
    label = ("source-qualified-material" if phase in {"qualified", "model-pose"} else
             "formation-uncertain" if phase == "formation" else "uncertain-continuation")
    lifecycle = {"validTimeMa": {"youngest": youngest, "oldest": oldest}}
    if phase not in {"qualified", "model-pose"} or replacement is None:
        lifecycle["youngestExclusive"] = True
    correction = {"correctionId": correction_id, "phase": label}
    if replacement is not None:
        correction.update({
            "materialStatus": replacement["materialStatus"] if phase == "model-pose" else "formation-uncertain",
            "poseStatus": replacement["poseStatus"],
        })
        if replacement["materialOriginRangeMa"] is not None:
            correction["materialOriginRangeMa"] = replacement["materialOriginRangeMa"]
    return {
        "kind": "rigid",
        "role": "model-geography",
        "chartId": f"correction:{correction_id}:{feature_id}:{phase}",
        "chartRevision": CATALOG_ID + "@" + CATALOG_VERSION,
        "materialId": f"correction:{correction_id}:{feature_id}",
        "fragmentOrCohortId": feature_id,
        "lifecycle": lifecycle,
        "geometryReferenceAgeMa": 0,
        "motionBindings": palette_bindings(
            palette, feature["pose"]["plateId"], youngest, oldest
        ),
        "sourceFeatureIds": [target["sourceFeatureId"] for target in feature["targets"]],
        "sourceFeatureTypes": ["EarthHistoryDomainFragmentReplacement" if replacement is not None
                               else "EarthHistorySourceQualifiedMaterialCorrection"],
        "evidence": {
            "status": "derived-overlay",
            "sourceIds": source_ids,
            "limitations": [feature["uncertainty"]["spatial"], feature["uncertainty"]["temporal"],
                            feature["uncertainty"]["exposure"],
                            "material support is not a palaeoshoreline, exposed-land, or height claim",
                            *([replacement["poseWarning"]] if replacement is not None else [])],
            "correction": correction,
        },
        "surfaceEvidence": feature["surfaceEvidence"],
    }


def update_public_manifest(catalog_path, geometry_paths):
    manifest_path = PUBLIC / "manifest.json"
    package = json.loads(manifest_path.read_text())
    package["materialCorrections"] = {"id": CATALOG_ID, "catalog": asset(catalog_path)}
    manifest_path.write_bytes(canonical_json(package))

    root_manifest_path = ROOT / "public/data/manifest.json"
    root_manifest = json.loads(root_manifest_path.read_text())
    outputs = root_manifest["inputs"]["cao-reconstruction-foundation-v2"]["outputs"]
    package_row = next(row for row in outputs if row["path"] == "public/data/reconstruction/cao-v2.4/manifest.json")
    package_row.update({"bytes": manifest_path.stat().st_size, "sha256": sha256(manifest_path)})
    correction_outputs = []
    for path in [catalog_path, *geometry_paths]:
        correction_outputs.append({"role": path.name, "path": str(path.relative_to(ROOT)),
                                   "bytes": path.stat().st_size, "sha256": sha256(path)})
    root_manifest["inputs"]["regional-material-corrections-v1"] = {
        "processing": "Source-qualified regional masks compiled as rigid material charts and guarded exact native-chart replacements; raw Cao source assets remain unchanged",
        "scope": "Continental material support only; surface exposure, palaeoshoreline and physical height remain unknown",
        "outputs": correction_outputs,
    }
    root_manifest_path.write_text(json.dumps(root_manifest, indent=2) + "\n")


def main():
    manifests = contract.validate_all(validate_runtime=False)
    manifest_paths = {path.parent.name: path for path in sorted(contract.CORRECTIONS.glob("*/manifest.json"))}
    rows = [(manifest, manifest_paths[next(name for name, path in manifest_paths.items()
                                          if json.loads(path.read_text())["correctionId"] == manifest["correctionId"])], feature)
            for manifest in manifests for feature in manifest["features"]]
    additive_rows = rows
    package, palette, records = palette_data()
    core = json.loads((PUBLIC / package["core"]["url"]).read_text())
    native_overrides, replacement_rows = native_override_rows(core)
    rows = [*rows, *replacement_rows]
    OUT.mkdir(parents=True, exist_ok=True)
    charts = []
    batches = []
    geometry_paths = []
    with tempfile.TemporaryDirectory(prefix="earthhistory-corrections-") as scratch:
        for batch_name, phases in (("qualified", ("qualified",)),
                                   ("uncertain", ("uncertain", "model-pose", "formation"))):
            staged = stage_phases(rows, phases, batch_name, len(core["charts"]) + len(charts),
                                  palette, records, Path(scratch))
            if not staged:
                continue
            directions, indices, vertex_charts, chart_indices = staged
            phase_charts = []
            for manifest, _, feature in rows:
                for phase in phases:
                    if (manifest["correctionId"], feature["correctionFeatureId"], phase) not in chart_indices:
                        continue
                    phase_charts.append(chart(manifest, feature, phase, palette))
            charts.extend(phase_charts)
            geometry_path = OUT / f"{batch_name}.ehgb"
            write_geometry(geometry_path, directions, indices, vertex_charts)
            geometry_paths.append(geometry_path)
            batches.append({
                "batchId": f"material-correction-{batch_name}",
                "vertexCount": len(directions),
                "triangleCount": len(indices) // 3,
                "geometryAsset": asset(geometry_path),
                "encoding": "ehgb-v2-f32xyz-u32",
                "staticDisplayControl": {"displayHeightMetres": 0,
                                         "baseColorRgb": QUALIFIED_COLOR if batch_name == "qualified"
                                         else UNCERTAIN_COLOR},
                "overlapPolicy": "native-visual-and-picking-precedence",
            })
    catalog = {
        "schemaVersion": 1,
        "id": CATALOG_ID,
        "version": CATALOG_VERSION,
        "baseline": {"packageId": package["packageId"], "revision": package["revision"],
                     "coreSha256": package["core"]["sha256"], "motionPaletteId": palette["id"],
                     "frame": package["frame"]},
        "correctionIds": sorted({*(manifest["correctionId"] for manifest in manifests),
                                 *(override["correctionId"] for override in native_overrides)}),
        "nativeChartOverrides": native_overrides,
        "alignmentWitnesses": alignment_witnesses(additive_rows, palette, records),
        "charts": charts,
        "spatialBatches": batches,
    }
    catalog_path = OUT / "catalog.json"
    catalog_path.write_bytes(canonical_json(catalog))
    update_public_manifest(catalog_path, geometry_paths)
    print(json.dumps({"corrections": len(catalog["correctionIds"]), "charts": len(charts),
                      "nativeOverrides": len(native_overrides),
                      "batches": [{"id": batch["batchId"], "vertices": batch["vertexCount"],
                                   "triangles": batch["triangleCount"]} for batch in batches]}))


if __name__ == "__main__":
    main()
