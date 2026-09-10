#!/usr/bin/env python3
"""Compile and validate bounded, exact-age Cao tectonic controls."""

from __future__ import annotations
import copy, hashlib, json, math
from pathlib import Path
import pygplates

ROOT = Path(__file__).resolve().parents[2]
MODEL = (
    ROOT.parent
    / "EarthHistory-data/palaeomap-study/plates/extracted/cao2024-v2.4/1.8Ga_model_GSF"
)
OUT = (
    ROOT.parent
    / "EarthHistory-data/palaeomap-study/verification/reconstruction-machinery-v1/tectonic-compiler"
)
AGES = [0.0, 5.0, 400.0, 420.0, 450.0, 470.0, 540.0]
FILES = [
    "250-0_plate_boundaries.gpml",
    "410-250_plate_boundaries.gpml",
    "1000-410_plate_boundaries.gpml",
    "TopologyBuildingBlocks.gpml",
]
ROT = "1000_0_rotfile.rot"
CONT = "shapes_continents.gpmlz"
EARTH = 6371.0088
PIN = {
    "250-0_plate_boundaries.gpml": "4a9f97f6368860e5917f4e6fbf78d6d7c3caf77e1736e854250d067540bb60d4",
    "410-250_plate_boundaries.gpml": "6516dbac4d7928e7ad71244b0bbabc65eb25e6e89dc79d4becb9a82a25a6fc91",
    "1000-410_plate_boundaries.gpml": "488e4b6330e2586fc363a1ad8dada659ac1409742846186fc275a213db306fb1",
    "TopologyBuildingBlocks.gpml": "7603af2502a8d261256f293be71487d28fe5a6b5a8fadd4bdc7845dc67b72297",
    "1000_0_rotfile.rot": "e13c16ef5b2f8f116f598635e42a126b016b2c615358b499bcc3433f4a3c735c",
    "shapes_continents.gpmlz": "6e30de73967f81a403f46370295dec5c0d7ed3ffd80c73d47df926461d949616",
}


def sha(p):
    return hashlib.sha256(p.read_bytes()).hexdigest()


def tree(p):
    return sum(x.stat().st_size for x in p.rglob("*") if x.is_file())


def dot(a, b):
    return sum(x * y for x, y in zip(a, b))


def unit(a):
    n = math.sqrt(dot(a, a))
    return tuple(x / n for x in a)


def cross(a, b):
    return (
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    )


def finite_time(v):
    return v if math.isfinite(v) else ("distant-past" if v > 0 else "distant-future")


def strict(rot, age, plate, from_age=None):
    try:
        return rot.get_rotation(
            age,
            plate,
            from_time=from_age,
            anchor_plate_id=0,
            use_identity_for_missing_plate_ids=False,
        )
    except pygplates.RotationModel.RotationNotFoundError:
        return None


def identity(topology):
    f = topology.get_feature()
    return str(f.get_feature_id()), f.get_reconstruction_plate_id(None)


def owners(point, resolved):
    return sorted(
        {
            identity(x)
            for x in resolved
            if x.get_resolved_boundary().is_point_in_polygon(point)
        }
    )


def midpoint_frame(points, offset):
    edges = [
        (pygplates.GeometryOnSphere.distance(a, b), -i, a, b)
        for i, (a, b) in enumerate(zip(points, points[1:]))
    ]
    if not edges:
        return None
    _, _, a, b = max(edges)
    av, bv = a.to_xyz(), b.to_xyz()
    radial = unit(tuple(x + y for x, y in zip(av, bv)))
    tangent = unit(tuple(x - dot(bv, radial) * y for x, y in zip(bv, radial)))
    normal = unit(cross(radial, tangent))
    sides = [
        pygplates.PointOnSphere(
            tuple(
                math.cos(offset) * x + s * math.sin(offset) * y
                for x, y in zip(radial, normal)
            )
        )
        for s in (-1, 1)
    ]
    return pygplates.PointOnSphere(radial), tangent, normal, sides


def native_sides(shared):
    result = [[], []]
    for topology, is_left in zip(
        shared.get_sharing_resolved_topologies(),
        shared.get_sharing_resolved_topology_on_left_flags(),
    ):
        result[1 if is_left else 0].append(identity(topology))
    return [sorted(set(x)) for x in result]


def velocity(rot, age, plate, point, window):
    stage = strict(rot, age, plate, age + window)
    if stage is None:
        return None
    return pygplates.calculate_velocities(
        [point], stage, window, pygplates.VelocityUnits.cms_per_yr
    )[0].to_xyz()


def serialized_sides(items):
    return [
        [{"topologyFeatureId": fid, "plateId": plate} for fid, plate in side]
        for side in items
    ]


def validate_artifact(artifact, expected, hashes):
    errors = []
    if artifact.get("agesMa") != AGES:
        errors.append("age-domain")
    model = artifact.get("model", {})
    if model.get("frame") != "palaeomagnetic" or model.get("anchorPlateId") != 0:
        errors.append("frame")
    actual = {x.get("path"): x.get("sha256") for x in artifact.get("sourceMembers", [])}
    if actual != hashes:
        errors.append("source-digest")
    seen = set()
    fields = (
        "ageMa",
        "sourceFeatureId",
        "sourceType",
        "sourcePlateId",
        "resolvedPart",
        "polarity",
        "validTimeMa",
        "status",
        "sideOwners",
        "nativeSharingSideOwners",
        "sideShapeMembership",
    )
    numeric = (
        "relativeNormalCmYr",
        "relativeTangentCmYr",
        "nativeRelativeMagnitudeCmYr",
    )
    for age_result in artifact.get("ageResults", []):
        if age_result.get("ageMa") not in AGES:
            errors.append("age-domain")
        for record in age_result.get("segments", []):
            key = record.get("exactSlotSegmentId")
            if key in seen:
                errors.append(f"duplicate:{key}")
                continue
            seen.add(key)
            wanted = expected.get(key)
            if wanted is None:
                errors.append(f"unknown:{key}")
                continue
            for field in fields:
                if record.get(field) != wanted.get(field):
                    errors.append(f"{key}:{field}")
            if record.get("status") == "supported":
                for field in numeric:
                    value = record.get(field)
                    if (
                        not isinstance(value, (int, float))
                        or not math.isfinite(value)
                        or abs(value - wanted[field]) > 1e-9
                    ):
                        errors.append(f"{key}:{field}")
                if record["sideOwners"] != record["nativeSharingSideOwners"]:
                    errors.append(f"{key}:native-side-order")
    if seen != set(expected):
        errors.append("segment-set")
    if errors:
        raise ValueError(";".join(errors[:12]))


def rejected(artifact, expected, hashes):
    try:
        validate_artifact(artifact, expected, hashes)
    except ValueError as error:
        return str(error)
    raise AssertionError("mutation unexpectedly accepted")


def main():
    policy = json.loads((OUT / "policy.json").read_text())
    assert policy["writtenBeforeMeasurement"] and policy["agesMa"] == [
        int(x) for x in AGES
    ]
    assert tree(OUT.parent) < policy["maximumProgramBytes"]
    for name, digest in PIN.items():
        assert sha(MODEL / name) == digest, name
    features = []
    for name in FILES:
        features.extend(pygplates.FeatureCollection(str(MODEL / name)))
    rotations = pygplates.RotationModel(str(MODEL / ROT), default_anchor_plate_id=0)
    continents = list(pygplates.FeatureCollection(str(MODEL / CONT)))
    expected = {}
    age_results = []
    samples = []
    total = 0
    side_matches = 0
    side_mismatches = 0
    disagreements = {"ridge": [], "subduction": []}
    offset = policy["sideOffsetKm"] / EARTH
    window = policy["velocityWindowMyr"]
    for age in AGES:
        resolved = []
        sections = []
        pygplates.resolve_topologies(
            features, rotations, resolved, age, sections, anchor_plate_id=0
        )
        resolved = [
            x for x in resolved if isinstance(x, pygplates.ResolvedTopologicalBoundary)
        ]
        reconstructed = []
        pygplates.reconstruct(continents, rotations, reconstructed, age)
        shapes = [
            (x.get_feature(), x.get_reconstructed_geometry())
            for x in reconstructed
            if isinstance(x.get_reconstructed_geometry(), pygplates.PolygonOnSphere)
        ]
        records = []
        counts = {}
        for section in sections:
            feature = section.get_feature()
            typ = str(feature.get_feature_type()).split(":")[-1]
            polarity = None
            if feature.get_feature_type() == pygplates.FeatureType.gpml_subduction_zone:
                polarity = feature.get_enumeration(
                    pygplates.PropertyName.gpml_subduction_polarity
                )
            for part, shared in enumerate(section.get_shared_sub_segments()):
                counts[typ] = counts.get(typ, 0) + 1
                total += 1
                points = list(shared.get_resolved_geometry_points())
                frame = midpoint_frame(points, offset)
                fid = str(feature.get_feature_id())
                slot = f"{age:g}:{fid}:part:{part}"
                record = {
                    "ageMa": age,
                    "segmentLineageId": fid,
                    "exactSlotSegmentId": slot,
                    "sourceFeatureId": fid,
                    "sourceType": typ,
                    "sourcePlateId": feature.get_reconstruction_plate_id(None),
                    "resolvedPart": part,
                    "polarity": polarity,
                    "validTimeMa": [finite_time(x) for x in feature.get_valid_time()],
                    "pointCount": len(points),
                    "geometryLatLon": [
                        [round(v, 5) for v in p.to_lat_lon()] for p in points
                    ],
                    "sideOrder": ["right(-normal)", "left(+normal)"],
                    "polaritySideIndex": {"Right": 0, "Left": 1}.get(polarity),
                }
                if frame is None:
                    record["status"] = "unavailable-degenerate"
                    records.append(record)
                    expected[slot] = copy.deepcopy(record)
                    continue
                midpoint, tangent, normal, side_points = frame
                probe = (
                    owners(side_points[0], resolved),
                    owners(side_points[1], resolved),
                )
                native = native_sides(shared)
                membership = []
                for point in side_points:
                    matched = [
                        feature
                        for feature, geometry in shapes
                        if geometry.is_point_in_polygon(point)
                    ]
                    membership.append(
                        {
                            "matchCount": len(matched),
                            "featureTypes": sorted(
                                set(
                                    str(x.get_feature_type()).split(":")[-1]
                                    for x in matched
                                )
                            ),
                        }
                    )
                record.update(
                    midpointLatLon=list(midpoint.to_lat_lon()),
                    sideOwners=serialized_sides(probe),
                    nativeSharingSideOwners=serialized_sides(native),
                    sideShapeMembership=membership,
                    sideShapeEvidence="raw membership in mixed-feature shapes_continents collection; neither match nor complement establishes crust type",
                )
                if any(len(x) != 1 for x in probe) or probe[0] == probe[1]:
                    record["status"] = "unavailable-side-ownership"
                elif native != list(probe):
                    side_mismatches += 1
                    record["status"] = "unavailable-native-side-disagreement"
                else:
                    side_matches += 1
                    rv = velocity(rotations, age, probe[0][0][1], midpoint, window)
                    lv = velocity(rotations, age, probe[1][0][1], midpoint, window)
                    if rv is None or lv is None:
                        record["status"] = "unavailable-strict-circuit"
                    else:
                        relative = tuple(l - r for r, l in zip(rv, lv))
                        normal_v = dot(relative, normal)
                        tangent_v = dot(relative, tangent)
                        magnitude = math.sqrt(dot(relative, relative))
                        residual = abs(magnitude - math.hypot(normal_v, tangent_v))
                        if typ == "MidOceanRidge":
                            effect = (
                                "source-ridge-divergent"
                                if normal_v > 0
                                else "source-ridge-nondivergent"
                            )
                        elif typ == "SubductionZone":
                            effect = (
                                "source-subduction-convergent"
                                if normal_v < 0
                                else "source-subduction-nonconvergent"
                            )
                        elif typ == "Transform":
                            effect = (
                                "source-transform-shear"
                                if abs(tangent_v) > abs(normal_v)
                                else "source-transform-oblique"
                            )
                        elif normal_v < 0:
                            effect = "untyped-convergent"
                        elif normal_v > 0:
                            effect = "untyped-divergent-not-ridge"
                        else:
                            effect = "source-typed-no-kinematic-effect"
                        setting = (
                            "published-source-type-with-local-kinematic-consistency"
                            if not effect.endswith(("nondivergent", "nonconvergent"))
                            else "published-source-type-with-local-kinematic-disagreement"
                        )
                        record.update(
                            status="supported",
                            effect=effect,
                            forcingSetting=setting,
                            relativeNormalCmYr=normal_v,
                            relativeTangentCmYr=tangent_v,
                            nativeRelativeMagnitudeCmYr=magnitude,
                            decompositionResidualCmYr=residual,
                        )
                        key = (
                            "ridge"
                            if effect == "source-ridge-nondivergent"
                            else "subduction"
                            if effect == "source-subduction-nonconvergent"
                            else None
                        )
                        if key and len(disagreements[key]) < 4:
                            disagreements[key].append(copy.deepcopy(record))
                records.append(record)
                expected[slot] = copy.deepcopy(record)
        status = {}
        for record in records:
            status[record["status"]] = status.get(record["status"], 0) + 1
        records.sort(
            key=lambda x: (x["sourceType"], x["sourceFeatureId"], x["resolvedPart"])
        )
        bounded = []
        for typ in sorted(counts):
            bounded += [x for x in records if x["sourceType"] == typ][
                : policy["samplePerSourceTypePerAge"]
            ]
        age_results.append(
            {
                "ageMa": age,
                "resolvedTopologyCount": len(resolved),
                "sourceSegmentCounts": counts,
                "statusCounts": status,
                "segments": records,
                "boundedSamples": bounded,
            }
        )
        samples += bounded
    hashes = {name: PIN[name] for name in [*FILES, ROT, CONT]}
    max_residual = max(
        x.get("decompositionResidualCmYr", 0)
        for a in age_results
        for x in a["segments"]
    )
    result = {
        "schemaVersion": 2,
        "classification": "complete seven-age exact-slot Cao diagnostic; not a production export",
        "agesMa": AGES,
        "model": {
            "id": "cao-et-al-2024",
            "version": "2.4",
            "frame": "palaeomagnetic",
            "anchorPlateId": 0,
            "doi": "10.5281/zenodo.13628813",
            "license": "CC-BY-4.0",
            "retrievalDate": "2026-09-09T13:26:07Z",
            "researchDate": "2026-09-10",
            "pygplatesVersion": pygplates.__version__,
        },
        "sourceMembers": [
            {"path": name, "sha256": PIN[name]} for name in [*FILES, ROT, CONT]
        ],
        "semantics": {
            "sourceType": "published model feature classification",
            "effect": "EarthHistory local motion diagnostic, not a replacement for source type",
            "sideOrder": "directed shared-subsegment right (-normal), then left (+normal)",
            "polarity": "published overriding side; Right=side0, Left=side1",
            "sideShapeMembership": "mixed feature collection membership only; not exposed land, shoreline, or resolved crust type",
            "ageContinuity": "none; exact source topology slots",
        },
        "counts": {
            "fullResolvedSegmentOccurrences": total,
            "emittedSegmentOccurrences": total,
            "boundedSampleCount": len(samples),
            "nativeSideReferenceMatches": side_matches,
            "nativeSideReferenceMismatches": side_mismatches,
        },
        "nativeApiCrossCheck": {
            "velocityMethod": "pygplates.calculate_velocities",
            "sideMethod": "get_sharing_resolved_topology_on_left_flags",
            "maximumOrthogonalDecompositionResidualCmYr": max_residual,
            "toleranceCmYr": 1e-8,
        },
        "disagreementExamples": disagreements,
        "ageResults": age_results,
    }
    validate_artifact(result, expected, hashes)
    witness = next(
        x
        for a in result["ageResults"]
        for x in a["segments"]
        if x.get("status") == "supported" and abs(x["relativeNormalCmYr"]) > 1e-9
    )
    polar = next(
        x
        for a in result["ageResults"]
        for x in a["segments"]
        if x.get("polarity") in ("Left", "Right")
    )
    mutations = {}
    mutant = copy.deepcopy(result)
    target = next(
        x
        for a in mutant["ageResults"]
        for x in a["segments"]
        if x["exactSlotSegmentId"] == witness["exactSlotSegmentId"]
    )
    target["relativeNormalCmYr"] = -target["relativeNormalCmYr"]
    mutations["normalAxisReversal"] = rejected(mutant, expected, hashes)
    mutant = copy.deepcopy(result)
    target = next(
        x
        for a in mutant["ageResults"]
        for x in a["segments"]
        if x["exactSlotSegmentId"] == polar["exactSlotSegmentId"]
    )
    target["polarity"] = {"Left": "Right", "Right": "Left"}[target["polarity"]]
    mutations["polarityFlip"] = rejected(mutant, expected, hashes)
    mutant = copy.deepcopy(result)
    mutant["ageResults"][0]["ageMa"] = -1
    mutations["outsideDomain"] = rejected(mutant, expected, hashes)
    for label, member in [("rotationDigest", ROT), ("continentDigest", CONT)]:
        mutant = copy.deepcopy(result)
        next(x for x in mutant["sourceMembers"] if x["path"] == member)["sha256"] = (
            "0" * 64
        )
        mutations[label] = rejected(mutant, expected, hashes)
    result["validation"] = {"baselineAccepted": True, "mutationRejections": mutations}
    encoded = (
        json.dumps(result, sort_keys=True, separators=(",", ":")) + "\n"
    ).encode()
    assert max_residual < 1e-8 and len(encoded) < policy["maximumOutputBytes"]
    output = OUT / "tectonic-controls.json"
    old = output.stat().st_size if output.exists() else 0
    assert tree(OUT.parent) - old + len(encoded) < policy["maximumProgramBytes"]
    output.write_bytes(encoded)
    print(
        json.dumps(
            {
                "bytes": len(encoded),
                "segments": total,
                "nativeSideMatches": side_matches,
                "nativeSideMismatches": side_mismatches,
                "mutations": mutations,
            }
        )
    )


if __name__ == "__main__":
    main()
