#!/usr/bin/env python3
"""Compare rebased Cao target and correction bindings with pinned pyGPlates rotations."""

from __future__ import annotations

import hashlib
import json
import math
import struct
from pathlib import Path

import pygplates

import emit_cao_foundation_package as foundation
import emit_cao_material_corrections as corrections


ROOT = Path(__file__).resolve().parents[2]
PUBLIC = ROOT / "public/data/reconstruction/cao-v2.4"
OUT = ROOT / "docs/research/cao-correction-motion-oracle.json"
LIMIT_RAD = 1e-5
CRITICAL_AGES = (402.5, 409.0, 410.0, 410.001, 430.0, 430.001, 504.999999, 505.0,
                 505.000001, 540.0)


def angular(left, right):
    cosine = abs(sum(a * b for a, b in zip(corrections.unit(left), corrections.unit(right))))
    return 2 * math.acos(max(-1, min(1, cosine)))


def select_entry(palette, plate, age, *, oldest_endpoint=False, correction_preferred=False):
    matches = [entry for entry in palette["entries"] if entry["plateId"] == plate
               and entry["youngestAgeMa"] <= age
               and (age < entry["oldestAgeMa"] or oldest_endpoint and age == entry["oldestAgeMa"])]
    if not matches and oldest_endpoint:
        matches = [entry for entry in palette["entries"] if entry["plateId"] == plate
                   and entry["youngestAgeMa"] <= age <= entry["oldestAgeMa"]]
    correction_matches = [entry for entry in matches
                          if entry["entryId"].startswith("correction-plate-")]
    native_matches = [entry for entry in matches
                      if not entry["entryId"].startswith("correction-plate-")]
    if correction_preferred and correction_matches:
        matches = correction_matches
    elif not correction_preferred and native_matches:
        matches = native_matches
    if len(matches) != 1:
        raise ValueError(f"plate {plate}: expected one half-open binding at {age} Ma, found {len(matches)}")
    return matches[0]


def exact_relative(cp, rotation, plate, age):
    q0 = cp.exact_quaternion(rotation, 0, plate)
    q = cp.exact_quaternion(rotation, age, plate)
    if q0 is None or q is None:
        raise ValueError(f"plate {plate}: missing exact Cao circuit at {age} Ma")
    return foundation.compose(q, foundation.inverse(q0))


def main():
    manifest = json.loads((PUBLIC / "manifest.json").read_text())
    palette = json.loads((PUBLIC / manifest["motionPalette"]["catalog"]["url"]).read_text())
    binary = (PUBLIC / manifest["motionPalette"]["binary"]["url"]).read_bytes()
    records = [struct.unpack_from("<Iffff", binary, 32 + index * 20)
               for index in range((len(binary) - 32) // 20)]
    catalog = json.loads((PUBLIC / manifest["materialCorrections"]["catalog"]["url"]).read_text())
    targets = json.loads((ROOT / "data/corrections/cao-v2.4-targets.json").read_text())["targets"]
    cp = foundation.load_coordinate()
    rotation = pygplates.RotationModel(
        [str(foundation.MODEL / name) for name in foundation.ROTATION_FILES],
        default_anchor_plate_id=0,
    )

    target_intervals = {}
    for target in targets:
        youngest = max(0.0, float(target["originalValidTimeMa"]["youngest"] or 0))
        oldest = min(540.0, float(target["originalValidTimeMa"]["oldest"] or 540))
        current = target_intervals.get(target["plateId"])
        target_intervals[target["plateId"]] = (
            youngest if current is None else min(current[0], youngest),
            oldest if current is None else max(current[1], oldest),
        )

    correction_intervals = {}
    for chart in catalog["charts"]:
        life = chart["lifecycle"]["validTimeMa"]
        for binding in chart["motionBindings"]:
            entry = next(entry for entry in palette["entries"] if entry["entryId"] == binding["entryId"])
            plate = entry["plateId"]
            current = correction_intervals.get(plate)
            interval = (float(life["youngest"]), float(life["oldest"]))
            correction_intervals[plate] = interval if current is None else (
                min(current[0], interval[0]), max(current[1], interval[1])
            )
    if any(oldest > 540 for _, oldest in correction_intervals.values()):
        raise ValueError("a material correction extends beyond 540 Ma")

    results = []
    critical = []
    global_max = 0.0
    correction_post_410_max = 0.0
    for scope, intervals in (("tracked-native-targets", target_intervals),
                             ("emitted-correction-charts", correction_intervals)):
        for plate, (youngest, oldest) in sorted(intervals.items()):
            ages = {youngest, oldest, *(quarter / 4 for quarter in range(
                math.ceil(youngest * 4), math.floor(oldest * 4) + 1
            ))}
            ages.update(age for age in CRITICAL_AGES if youngest <= age <= oldest)
            maximum = 0.0
            maximum_age = youngest
            bounded_correction_maximum = 0.0
            for age in sorted(ages):
                entry = select_entry(
                    palette, plate, age, oldest_endpoint=(age == oldest),
                    correction_preferred=(scope == "emitted-correction-charts" and age >= 410),
                )
                actual = corrections.quaternion_at(entry, records, age)
                residual = angular(exact_relative(cp, rotation, plate, age), actual)
                if residual > maximum:
                    maximum, maximum_age = residual, age
                if scope == "emitted-correction-charts" and age >= 410:
                    bounded_correction_maximum = max(bounded_correction_maximum, residual)
                if age in CRITICAL_AGES:
                    critical.append({
                        "scope": scope, "plateId": plate, "ageMa": age,
                        "entryId": entry["entryId"], "angularResidualRad": residual,
                    })
            if scope == "emitted-correction-charts" and bounded_correction_maximum > LIMIT_RAD:
                raise ValueError(
                    f"{scope} plate {plate} exceeds {LIMIT_RAD} rad after 410 Ma: "
                    f"{bounded_correction_maximum}"
                )
            global_max = max(global_max, maximum)
            correction_post_410_max = max(correction_post_410_max, bounded_correction_maximum)
            results.append({
                "scope": scope, "plateId": plate, "youngestAgeMa": youngest,
                "oldestAgeMa": oldest, "sampleCount": len(ages),
                "maximumAngularResidualRad": maximum, "maximumResidualAgeMa": maximum_age,
                "maximumPost410CorrectionResidualRad": bounded_correction_maximum,
            })

    active_after_540 = [chart["chartId"] for chart in catalog["charts"]
                        if chart["lifecycle"]["validTimeMa"]["youngest"] <= 540.000001
                        <= chart["lifecycle"]["validTimeMa"]["oldest"]]
    if active_after_540:
        raise ValueError("correction charts remain active after 540 Ma")
    proof = {
        "schemaVersion": 1,
        "rotationSourceAggregateSha256": foundation.ROT_SHA,
        "motionPaletteCatalogSha256": hashlib.sha256(
            (PUBLIC / manifest["motionPalette"]["catalog"]["url"]).read_bytes()
        ).hexdigest(),
        "motionPaletteBinarySha256": hashlib.sha256(binary).hexdigest(),
        "angularErrorLimitRad": LIMIT_RAD,
        "maximumAngularResidualRad": global_max,
        "maximumPost410CorrectionResidualRad": correction_post_410_max,
        "criticalAgesMa": list(CRITICAL_AGES),
        "criticalSamples": critical,
        "intervalResults": results,
        "trackedNativeTargetCount": len(targets),
        "correctionChartCount": len(catalog["charts"]),
        "correctionChartsActiveAfter540Ma": 0,
        "selectionRule": "youngest-inclusive, oldest-exclusive except the final lifecycle endpoint",
        "noNearestEntryHolding": True,
        "nativeTargetResidualPolicy": (
            "native entry IDs and valid intervals, native chart bindings, and pre-existing sample values are "
            "unchanged; added source-derived samples are described by the native refinement record"
        ),
    }
    OUT.write_text(json.dumps(proof, indent=2) + "\n")
    print(json.dumps({
        "maximumAngularResidualRad": global_max,
        "targetPlateCount": len(target_intervals),
        "correctionPlateCount": len(correction_intervals),
        "criticalSamples": len(critical),
        "proof": str(OUT),
    }))


if __name__ == "__main__":
    main()
