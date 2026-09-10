#!/usr/bin/env python3
"""Bounded Cao/pyGPlates preflight for compact rigid-motion intervals."""

from __future__ import annotations

import argparse
import bisect
import hashlib
import json
import math
import pathlib
import random
import statistics
import struct
import sys
import time


ROOT = pathlib.Path(__file__).resolve().parents[2]
DEFAULT_MODEL = ROOT.parent / "EarthHistory-data/palaeomap-study/plates/extracted/cao2024-v2.4/1.8Ga_model_GSF"
DEFAULT_OUTPUT = ROOT.parent / "EarthHistory-data/palaeomap-study/verification/reconstruction-machinery-v1/coordinate"
CONTROL_AGES = (0.0, 420.0, 450.0, 470.0, 250.0)
FRACTIONS = (0.125, 0.25, 0.5, 0.75, 0.875)
HELD_OUT_FRACTIONS = (0.25, 0.75)
MAX_OUTPUT_BYTES = 8 * 1024 * 1024
ANGULAR_NUMERICAL_TOLERANCE_RAD = 1e-10
FLOAT32_QUANTIZATION_TOLERANCE_RAD = 5e-7
INTERPOLATION_TARGET_RAD = 1e-5
ADAPTIVE_MAX_DEPTH = 10
ADAPTIVE_MAX_SAMPLES = 256
ADAPTIVE_HOLDOUT_FRACTIONS = (0.37, 0.73)
ADAPTIVE_RANDOM_SEED = 240910
PINNED_ROTATION_SHA256 = "e13c16ef5b2f8f116f598635e42a126b016b2c615358b499bcc3433f4a3c735c"
PINNED_CONTINENTS_SHA256 = "6e30de73967f81a403f46370295dec5c0d7ed3ffd80c73d47df926461d949616"


class MissingCircuitError(RuntimeError):
    pass


def digest(path: pathlib.Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def dot(a, b):
    return sum(x * y for x, y in zip(a, b))


def normalize(q):
    length = math.sqrt(dot(q, q))
    return tuple(x / length for x in q)


def rotation_quaternion(rotation):
    pole, angle = rotation.get_euler_pole_and_angle()
    x, y, z = pole.to_xyz()
    half = angle / 2
    return normalize((math.cos(half), x * math.sin(half), y * math.sin(half), z * math.sin(half)))


def slerp(a, b, fraction):
    cosine = dot(a, b)
    if cosine < 0:
        b = tuple(-x for x in b)
        cosine = -cosine
    cosine = max(-1.0, min(1.0, cosine))
    if cosine > 0.9999995:
        return normalize(tuple(x + fraction * (y - x) for x, y in zip(a, b)))
    angle = math.acos(cosine)
    scale_a = math.sin((1 - fraction) * angle) / math.sin(angle)
    scale_b = math.sin(fraction * angle) / math.sin(angle)
    return normalize(tuple(scale_a * x + scale_b * y for x, y in zip(a, b)))


def angular_rotation_error(a, b):
    a, b = normalize(a), normalize(b)
    if dot(a, b) < 0:
        b = tuple(-x for x in b)
    difference = math.sqrt(sum((x - y) ** 2 for x, y in zip(a, b)))
    total = math.sqrt(sum((x + y) ** 2 for x, y in zip(a, b)))
    return 4 * math.atan2(difference, total)


def float32_quaternion(q):
    return normalize(tuple(struct.unpack("<f", struct.pack("<f", value))[0] for value in q))


def exact_quaternion(model, age, plate_id):
    rotation = model.get_rotation(age, plate_id, anchor_plate_id=0, use_identity_for_missing_plate_ids=False)
    return None if rotation is None else rotation_quaternion(rotation)


def validate_model_identity(actual, expected):
    if actual != expected:
        raise ValueError("model/frame/source identity mismatch")


def source_rotation_times(path, moving_plate_id, younger, older):
    records = []
    for line_number, raw in enumerate(path.read_text(errors="replace").splitlines(), 1):
        fields = raw.split("!", 1)[0].split()
        if len(fields) < 6:
            continue
        try:
            plate_id, age, fixed_id = int(fields[0]), float(fields[1]), int(fields[5])
        except ValueError:
            continue
        if plate_id == moving_plate_id and younger <= age <= older:
            records.append({"ageMa": age, "fixedPlateId": fixed_id, "line": line_number})
    by_age = {}
    for record in records:
        by_age.setdefault(record["ageMa"], set()).add(record["fixedPlateId"])
    seams = [{"ageMa": age, "fixedPlateIds": sorted(fixed_ids)} for age, fixed_ids in by_age.items()
             if len(fixed_ids) > 1]
    return sorted(set([younger, older] + list(by_age))), records, seams


def all_source_rotation_times(path, younger, older):
    ages = {younger, older}
    for raw in path.read_text(errors="replace").splitlines():
        fields = raw.split("!", 1)[0].split()
        if len(fields) < 6:
            continue
        try:
            age = float(fields[1])
        except ValueError:
            continue
        if younger <= age <= older:
            ages.add(age)
    return sorted(ages)


def adaptive_table(model, plate_id, initial_ages):
    nodes = {}
    for age in initial_ages:
        quaternion = exact_quaternion(model, age, plate_id)
        if quaternion is None:
            raise MissingCircuitError(f"missing circuit for plate {plate_id} at {age} Ma")
        nodes[age] = float32_quaternion(quaternion)
    leaves = []
    capped = False

    def train(left_age, right_age, depth):
        nonlocal capped
        midpoint = (left_age + right_age) / 2
        exact = exact_quaternion(model, midpoint, plate_id)
        if exact is None:
            raise MissingCircuitError(f"missing circuit for plate {plate_id} at {midpoint} Ma")
        predicted = slerp(nodes[left_age], nodes[right_age], 0.5)
        error = angular_rotation_error(exact, predicted)
        if error <= INTERPOLATION_TARGET_RAD:
            leaves.append((left_age, right_age, depth, error))
            return
        if depth >= ADAPTIVE_MAX_DEPTH or len(nodes) >= ADAPTIVE_MAX_SAMPLES:
            capped = True
            leaves.append((left_age, right_age, depth, error))
            return
        nodes[midpoint] = float32_quaternion(exact)
        train(left_age, midpoint, depth + 1)
        train(midpoint, right_age, depth + 1)

    for left, right in zip(initial_ages, initial_ages[1:]):
        train(left, right, 0)
    return nodes, sorted(leaves), capped


def compact_lookup(nodes, age):
    ages = sorted(nodes)
    index = bisect.bisect_left(ages, age)
    if index < len(ages) and ages[index] == age:
        return nodes[age]
    if index == 0 or index == len(ages):
        return None
    left, right = ages[index - 1], ages[index]
    return slerp(nodes[left], nodes[right], (age - left) / (right - left))


def bounded_write_result(result, output_dir):
    encoded = (json.dumps(result, indent=2, sort_keys=True) + "\n").encode()
    if len(encoded) > 64 * 1024:
        raise SystemExit("summary exceeds 64 KiB")
    output = output_dir / "summary.json"
    existing_output_bytes = sum(path.stat().st_size for path in output_dir.rglob("*") if path.is_file())
    replaced_bytes = output.stat().st_size if output.exists() else 0
    projected_output_bytes = existing_output_bytes - replaced_bytes + len(encoded)
    study_root = ROOT.parent / "EarthHistory-data/palaeomap-study"
    existing_parent_bytes = sum(path.stat().st_size for path in study_root.rglob("*") if path.is_file())
    projected_parent_bytes = existing_parent_bytes - replaced_bytes + len(encoded)
    if projected_output_bytes > MAX_OUTPUT_BYTES:
        raise SystemExit("coordinate trial exceeded 8 MiB bound")
    if projected_parent_bytes > 4 * 1024 * 1024 * 1024:
        raise SystemExit("parent study exceeded 4 GiB bound")
    output.write_bytes(encoded)
    return output, len(encoded)


def select_plate(features, model, younger, older):
    candidates = []
    for feature in features:
        valid_oldest, valid_youngest = feature.get_valid_time()
        if older > valid_oldest or younger < valid_youngest:
            continue
        plate_id = feature.get_reconstruction_plate_id(None)
        if plate_id in (None, 0):
            continue
        quaternions = [exact_quaternion(model, younger + (older - younger) * f, plate_id) for f in FRACTIONS]
        q0, q1 = exact_quaternion(model, younger, plate_id), exact_quaternion(model, older, plate_id)
        if q0 is None or q1 is None or any(q is None for q in quaternions):
            continue
        movement = angular_rotation_error(q0, q1)
        candidates.append((movement, plate_id, str(feature.get_feature_id())))
    if not candidates:
        return None
    # Exercise a moving circuit; tie-breaking is deterministic and declared.
    return max(candidates, key=lambda item: (item[0], -item[1], item[2]))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model-dir", type=pathlib.Path, default=DEFAULT_MODEL)
    parser.add_argument("--output-dir", type=pathlib.Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--corrected-0-5-only", action="store_true")
    args = parser.parse_args()
    import pygplates

    args.output_dir.mkdir(parents=True, exist_ok=True)
    rotation_path = args.model_dir / "1000_0_rotfile.rot"
    continent_path = args.model_dir / "shapes_continents.gpmlz"
    rotation_digest, continent_digest = digest(rotation_path), digest(continent_path)
    if rotation_digest != PINNED_ROTATION_SHA256 or continent_digest != PINNED_CONTINENTS_SHA256:
        raise SystemExit("model directory does not match the pinned Cao 2024 v2.4 trial inputs")
    model = pygplates.RotationModel(str(rotation_path), default_anchor_plate_id=0)
    features = list(pygplates.FeatureCollection(str(continent_path)))

    if args.corrected_0_5_only:
        output = args.output_dir / "summary.json"
        if not output.exists():
            raise SystemExit("baseline summary is required before the correction-only run")
        result = json.loads(output.read_text())
        baseline = next(record for record in result["records"] if record["intervalMa"] == [0.0, 5.0])
        plate_id = baseline["plateId"]
        clock = all_source_rotation_times(rotation_path, 0.0, 5.0)
        expected_clock = [0.0, 0.2, 0.52, 0.6, 0.8, 1.0, 1.2, 1.8, 1.9, 2.0, 2.6, 2.9,
                          3.0, 3.1, 3.28, 3.3, 3.5, 3.6, 4.0, 4.2, 4.5, 4.6, 5.0]
        if clock != expected_clock:
            raise SystemExit(f"pinned 0-5 Ma full ROT clock changed: {clock}")
        try:
            nodes, leaves, capped = adaptive_table(model, plate_id, clock)
        except MissingCircuitError as error:
            corrected = {"status": "missing-circuit", "reason": str(error), "clockAgesMa": clock}
        else:
            holdout_errors = []
            query_ages = []
            missing_age = None
            for left, right, *_ in leaves:
                for fraction in ADAPTIVE_HOLDOUT_FRACTIONS:
                    age = left + (right - left) * fraction
                    expected = exact_quaternion(model, age, plate_id)
                    if expected is None:
                        missing_age = age
                        break
                    holdout_errors.append(angular_rotation_error(expected, compact_lookup(nodes, age)))
                    query_ages.append(age)
                if missing_age is not None:
                    break
            if missing_age is not None:
                corrected = {"status": "missing-circuit", "missingAgeMa": missing_age, "clockAgesMa": clock}
            else:
                shuffled = list(query_ages)
                random.Random(ADAPTIVE_RANDOM_SEED).shuffle(shuffled)
                canonical = {age: compact_lookup(nodes, age) for age in query_ages}
                random_error = max((angular_rotation_error(canonical[age], compact_lookup(nodes, age))
                                    for age in shuffled), default=0.0)
                mutated = dict(nodes)
                mutated[max(mutated)] = (1.0, 0.0, 0.0, 0.0)
                mutation_age = leaves[-1][0] + (leaves[-1][1] - leaves[-1][0]) * 0.73
                mutation_error = angular_rotation_error(
                    exact_quaternion(model, mutation_age, plate_id), compact_lookup(mutated, mutation_age))
                corrected = {
                    "status": "cap" if capped else "resolved", "plateId": plate_id,
                    "clockKind": "conservative-all-ROT-record-times-not-minimal-circuit-clock",
                    "clockAgesMa": clock, "storedSampleCount": len(nodes), "leafCount": len(leaves),
                    "unpackedNodeBytes": 24, "unpackedTableBytes": len(nodes) * 24,
                    "maximumTrainingMidpointErrorRad": max((leaf[3] for leaf in leaves), default=0.0),
                    "holdoutCount": len(holdout_errors),
                    "maximumIndependentHoldoutErrorRad": max(holdout_errors, default=0.0),
                    "randomOrderErrorRad": random_error,
                    "identityEndpointMutationMaximumErrorRad": mutation_error,
                    "acceptance": {
                        "withinTarget": not capped and max(holdout_errors, default=math.inf) <= INTERPOLATION_TARGET_RAD,
                        "deterministic": random_error <= ANGULAR_NUMERICAL_TOLERANCE_RAD,
                        "mutationRejected": mutation_error > INTERPOLATION_TARGET_RAD,
                    },
                    "limitation": "All ROT record times are overinclusive and are neither a minimal influencing circuit clock nor topology/geological events."
                }
        result["corrected0To5"] = corrected
        saved, byte_count = bounded_write_result(result, args.output_dir)
        print(json.dumps({"output": str(saved), "bytes": byte_count, "corrected0To5": corrected}, indent=2))
        return
    records = []
    timing_direct_ns = []
    timing_compact_ns = []
    numerical_mutation_max_error = None
    adaptive_records = []
    adaptive_mutation_error = None

    for control_age in CONTROL_AGES:
        younger = control_age
        older = control_age + 5.0
        selected = select_plate(features, model, younger, older)
        if selected is None:
            records.append({"controlAgeMa": control_age, "intervalMa": [younger, older], "status": "missing-circuit"})
            continue
        movement, plate_id, feature_id = selected
        q0, q1 = exact_quaternion(model, younger, plate_id), exact_quaternion(model, older, plate_id)
        qmid = exact_quaternion(model, (younger + older) / 2, plate_id)
        endpoint_errors, midpoint_errors, quantization_errors = [], [], []
        q0f, qmidf, q1f = float32_quaternion(q0), float32_quaternion(qmid), float32_quaternion(q1)
        samples = []
        for fraction in FRACTIONS:
            age = younger + (older - younger) * fraction
            start = time.perf_counter_ns()
            exact = exact_quaternion(model, age, plate_id)
            timing_direct_ns.append(time.perf_counter_ns() - start)
            start = time.perf_counter_ns()
            endpoint = slerp(q0, q1, fraction)
            if fraction <= 0.5:
                midpoint_calibrated = slerp(q0, qmid, fraction * 2)
                compact_quantized = slerp(q0f, qmidf, fraction * 2)
            else:
                midpoint_calibrated = slerp(qmid, q1, (fraction - 0.5) * 2)
                compact_quantized = slerp(qmidf, q1f, (fraction - 0.5) * 2)
            timing_compact_ns.append(time.perf_counter_ns() - start)
            endpoint_error = angular_rotation_error(exact, endpoint)
            midpoint_error = angular_rotation_error(exact, midpoint_calibrated)
            quantization_error = angular_rotation_error(midpoint_calibrated, compact_quantized)
            endpoint_errors.append(endpoint_error)
            midpoint_errors.append(midpoint_error)
            quantization_errors.append(quantization_error)
            samples.append({"ageMa": age, "heldOut": fraction in HELD_OUT_FRACTIONS,
                            "endpointErrorRad": endpoint_error, "midpointCalibrationErrorRad": midpoint_error,
                            "float32ErrorRad": quantization_error})
        def compact(fraction):
            return slerp(q0f, qmidf, fraction * 2) if fraction <= 0.5 else slerp(qmidf, q1f, (fraction - 0.5) * 2)
        forward = [compact(f) for f in FRACTIONS]
        reverse = [compact(f) for f in reversed(FRACTIONS)]
        deterministic_error = max(angular_rotation_error(a, b) for a, b in zip(forward, reversed(reverse)))
        records.append({
            "controlAgeMa": control_age, "intervalMa": [younger, older], "status": "resolved",
            "plateId": plate_id, "sourceFeatureId": feature_id, "endpointMovementRad": movement,
            "maximumEndpointErrorRad": max(endpoint_errors), "maximumMidpointCalibrationErrorRad": max(midpoint_errors),
            "maximumFloat32ErrorRad": max(quantization_errors), "forwardReverseErrorRad": deterministic_error,
            "samples": samples,
        })

        source_ages, source_records, source_seams = source_rotation_times(rotation_path, plate_id, younger, older)
        if source_seams:
            adaptive_records.append({"intervalMa": [younger, older], "plateId": plate_id,
                                     "status": "source-time-discontinuity", "sourceSeams": source_seams})
        else:
            try:
                nodes, leaves, capped = adaptive_table(model, plate_id, source_ages)
            except MissingCircuitError as error:
                adaptive_records.append({"intervalMa": [younger, older], "plateId": plate_id,
                                         "status": "missing-circuit", "reason": str(error),
                                         "sourceRotationRecords": source_records})
                continue
            holdout_errors = []
            holdout_count = 0
            missing_holdout_age = None
            for left, right, _depth, _training_error in leaves:
                for local_fraction in ADAPTIVE_HOLDOUT_FRACTIONS:
                    age = left + (right - left) * local_fraction
                    expected = exact_quaternion(model, age, plate_id)
                    if expected is None:
                        missing_holdout_age = age
                        break
                    actual = compact_lookup(nodes, age)
                    holdout_errors.append(angular_rotation_error(expected, actual))
                    holdout_count += 1
                if missing_holdout_age is not None:
                    break
            if missing_holdout_age is not None:
                adaptive_records.append({"intervalMa": [younger, older], "plateId": plate_id,
                                         "status": "missing-circuit", "missingAgeMa": missing_holdout_age,
                                         "sourceRotationRecords": source_records})
                continue
            order = [left + (right - left) * fraction for left, right, *_ in leaves
                     for fraction in ADAPTIVE_HOLDOUT_FRACTIONS]
            shuffled = list(order)
            random.Random(ADAPTIVE_RANDOM_SEED + int(control_age)).shuffle(shuffled)
            ordered_values = {age: compact_lookup(nodes, age) for age in order}
            random_order_error = max((angular_rotation_error(ordered_values[age], compact_lookup(nodes, age))
                                      for age in shuffled), default=0.0)
            adaptive_records.append({
                "intervalMa": [younger, older], "plateId": plate_id, "status": "cap" if capped else "resolved",
                "sourceRotationRecords": source_records, "sourceSeams": source_seams,
                "storedSampleCount": len(nodes), "storedAgesMa": sorted(nodes), "leafCount": len(leaves),
                "maximumTrainingMidpointErrorRad": max((leaf[3] for leaf in leaves), default=0.0),
                "holdoutCount": holdout_count, "maximumIndependentHoldoutErrorRad": max(holdout_errors, default=0.0),
                "randomOrderErrorRad": random_order_error,
            })
            if adaptive_mutation_error is None:
                mutated_nodes = dict(nodes)
                mutated_nodes[max(mutated_nodes)] = (1.0, 0.0, 0.0, 0.0)
                mutation_age = leaves[-1][0] + (leaves[-1][1] - leaves[-1][0]) * ADAPTIVE_HOLDOUT_FRACTIONS[-1]
                adaptive_mutation_error = angular_rotation_error(
                    exact_quaternion(model, mutation_age, plate_id), compact_lookup(mutated_nodes, mutation_age))
        if numerical_mutation_max_error is None:
            mutated_q1 = (1.0, 0.0, 0.0, 0.0)
            mutation_errors = []
            for fraction in HELD_OUT_FRACTIONS:
                age = younger + (older - younger) * fraction
                exact = exact_quaternion(model, age, plate_id)
                mutated = slerp(q0f, qmidf, fraction * 2) if fraction <= 0.5 else slerp(
                    qmidf, mutated_q1, (fraction - 0.5) * 2)
                mutation_errors.append(angular_rotation_error(exact, mutated))
            numerical_mutation_max_error = max(mutation_errors)

    missing_identity = model.get_rotation(100.0, 999999, anchor_plate_id=0, use_identity_for_missing_plate_ids=True)
    missing_rejected = model.get_rotation(100.0, 999999, anchor_plate_id=0, use_identity_for_missing_plate_ids=False)
    expected_identity = {"modelId": "cao-et-al-2024", "modelVersion": "2.4",
                         "absoluteFrameId": "palaeomagnetic", "anchorPlateId": 0,
                         "rotationSha256": rotation_digest}
    mutation_rejected = False
    try:
        validate_model_identity({**expected_identity, "rotationSha256": "0" * 64}, expected_identity)
    except ValueError:
        mutation_rejected = True
    mutation = {
        "unknownPlateDefaultReturnedIdentity": missing_identity is not None,
        "unknownPlateStrictReturnedNone": missing_rejected is None,
        "frameDigestMutationRejected": mutation_rejected,
        "identityEndpointMutationMaximumErrorRad": numerical_mutation_max_error,
        "identityEndpointMutationFailedNumericalGuard":
            numerical_mutation_max_error is not None and numerical_mutation_max_error > INTERPOLATION_TARGET_RAD,
    }
    result = {
        "schemaVersion": 1,
        "status": "bounded-preflight-complete",
        "hypothesis": "Precompiled model-qualified motion intervals with preserved subknots can replace runtime rotation-tree queries for supported rigid material.",
        "policy": {
            "controlAgesMa": CONTROL_AGES, "sampleFractions": FRACTIONS,
            "heldOutFractions": HELD_OUT_FRACTIONS,
            "plateSelection": "active non-anchor continent feature with maximum endpoint angular movement; deterministic tie break",
            "angularNumericalToleranceRad": ANGULAR_NUMERICAL_TOLERANCE_RAD,
            "float32QuantizationToleranceRad": FLOAT32_QUANTIZATION_TOLERANCE_RAD,
            "interpolationTargetRad": INTERPOLATION_TARGET_RAD,
        },
        "reference": {"python": sys.version, "pygplates": pygplates.__version__,
                      "modelId": "cao-et-al-2024", "modelVersion": "2.4",
                      "sourceDoi": "10.5281/zenodo.13628813", "absoluteFrame": "palaeomagnetic",
                      "anchorPlateId": 0, "rotationSha256": rotation_digest,
                      "continentsSha256": continent_digest},
        "records": records,
        "mutation": mutation,
        "adaptive": {
            "method": "selected moving-plate ROT times plus oracle-midpoint adaptive float32 quaternion table",
            "sourceTimeLimit": "Does not collect fixed-plate ancestor knots; adaptive oracle samples absorb composed motion only where the numerical checks pass.",
            "maximumDepth": ADAPTIVE_MAX_DEPTH, "maximumSamplesPerControl": ADAPTIVE_MAX_SAMPLES,
            "holdoutFractionsPerLeaf": ADAPTIVE_HOLDOUT_FRACTIONS,
            "randomOrderSeed": ADAPTIVE_RANDOM_SEED,
            "records": adaptive_records,
            "identityEndpointMutationMaximumErrorRad": adaptive_mutation_error,
        },
        "timing": {
            "directRotationMedianMicroseconds": statistics.median(timing_direct_ns) / 1000,
            "compactSlerpMedianMicroseconds": statistics.median(timing_compact_ns) / 1000,
            "sampleCount": len(timing_direct_ns),
            "note": "Single-process algorithm timing, not app or production performance evidence."
        },
    }
    result["acceptance"] = {
        "allCircuitsResolved": all(record["status"] == "resolved" for record in records),
        "midpointCalibrationWithinTarget": all(record.get("maximumMidpointCalibrationErrorRad", math.inf) <= INTERPOLATION_TARGET_RAD for record in records),
        "float32WithinTarget": all(record.get("maximumFloat32ErrorRad", math.inf) <= FLOAT32_QUANTIZATION_TOLERANCE_RAD for record in records),
        "deterministic": all(record.get("forwardReverseErrorRad", math.inf) <= ANGULAR_NUMERICAL_TOLERANCE_RAD for record in records),
        "missingCircuitRejected": mutation["unknownPlateStrictReturnedNone"],
        "numericalMutationRejected": mutation["identityEndpointMutationFailedNumericalGuard"],
        "adaptiveNoCapsOrDiscontinuities": all(record["status"] == "resolved" for record in adaptive_records),
        "adaptiveIndependentHoldoutsWithinTarget": all(
            record.get("maximumIndependentHoldoutErrorRad", math.inf) <= INTERPOLATION_TARGET_RAD
            for record in adaptive_records),
        "adaptiveRandomOrderDeterministic": all(
            record.get("randomOrderErrorRad", math.inf) <= ANGULAR_NUMERICAL_TOLERANCE_RAD
            for record in adaptive_records),
        "adaptiveNumericalMutationRejected":
            adaptive_mutation_error is not None and adaptive_mutation_error > INTERPOLATION_TARGET_RAD,
    }
    output, byte_count = bounded_write_result(result, args.output_dir)
    print(json.dumps({"output": str(output), "bytes": byte_count, "acceptance": result["acceptance"]}, indent=2))


if __name__ == "__main__":
    main()
