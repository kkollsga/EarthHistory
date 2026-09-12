#!/usr/bin/env python3
"""Repair Cao layer evidence and append bounded correction motion to the public package."""

from __future__ import annotations

import copy
import hashlib
import json
import math
import struct
from pathlib import Path

import pygplates

import emit_cao_foundation_package as foundation


ROOT = Path(__file__).resolve().parents[2]
PUBLIC = ROOT / "public/data/reconstruction/cao-v2.4"
PROOF = ROOT / "docs/research/cao-correction-baseline-rebase-proof.json"
ORIGIN_CORE_SHA256 = "9be727ee8e24fb062703abaadbfca6d534e3906b5b87ef0303b889cc78392d2a"
ORIGIN_PALETTE_JSON_SHA256 = "abbaaf464d62fae1112ee0b5a0a676496d8f43331770502eeb2b6b8412b9c7a7"
ORIGIN_PALETTE_BINARY_SHA256 = "1705edc8cfe2e811a071aaf6ae0566dbfd4a3bec737f473e394bf12e175a2f54"
ROTATION_SOURCE_SHA256 = foundation.ROT_SHA
ANGULAR_ERROR_LIMIT_RAD = 1e-5


def canonical(value: object) -> bytes:
    return (json.dumps(value, separators=(",", ":")) + "\n").encode()


def sha_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha(path: Path) -> str:
    return sha_bytes(path.read_bytes())


def asset(path: Path) -> dict:
    return {"url": path.name, "bytes": path.stat().st_size, "sha256": sha(path)}


def difference_paths(left, right, prefix=""):
    if type(left) is not type(right):
        return [prefix]
    if isinstance(left, dict):
        paths = []
        for key in sorted(set(left) | set(right)):
            child = f"{prefix}.{key}" if prefix else key
            if key not in left or key not in right:
                paths.append(child)
            else:
                paths.extend(difference_paths(left[key], right[key], child))
        return paths
    if isinstance(left, list):
        if len(left) != len(right):
            return [prefix]
        paths = []
        for index, (a, b) in enumerate(zip(left, right)):
            paths.extend(difference_paths(a, b, f"{prefix}[{index}]"))
        return paths
    return [] if left == right else [prefix]


def unit(q):
    length = math.sqrt(sum(value * value for value in q))
    return tuple(value / length for value in q)


def slerp(left, right, fraction):
    cosine = sum(a * b for a, b in zip(left, right))
    if cosine < 0:
        right = tuple(-value for value in right)
        cosine = -cosine
    if cosine > 0.999999:
        return unit(tuple((1 - fraction) * a + fraction * b for a, b in zip(left, right)))
    theta = math.acos(max(-1, min(1, cosine)))
    sine = math.sin(theta)
    return tuple((math.sin((1 - fraction) * theta) * a + math.sin(fraction * theta) * b) / sine
                 for a, b in zip(left, right))


def angular(left, right):
    cosine = abs(sum(a * b for a, b in zip(unit(left), unit(right))))
    return 2 * math.acos(max(-1, min(1, cosine)))


def quaternion_at(entry, records, age):
    rows = records[entry["sampleOffset"]:entry["sampleOffset"] + entry["sampleCount"]]
    encoded = round(age * 1_000_000)
    for row in rows:
        if row[0] == encoded:
            return unit(row[1:])
    for younger, older in zip(rows, rows[1:]):
        if younger[0] < encoded < older[0]:
            return slerp(unit(younger[1:]), unit(older[1:]),
                         (encoded - younger[0]) / (older[0] - younger[0]))
    raise ValueError(f"{entry['entryId']} does not bracket {age} Ma")


def update_root_output(root_manifest, path):
    rows = root_manifest["inputs"]["cao-reconstruction-foundation-v2"]["outputs"]
    relative = str(path.relative_to(ROOT))
    matches = [row for row in rows if row["path"] == relative]
    if len(matches) != 1:
        raise ValueError(f"root manifest has {len(matches)} outputs for {relative}")
    matches[0].update({"bytes": path.stat().st_size, "sha256": sha(path)})


def main():
    core_path = PUBLIC / "core.json"
    palette_json_path = PUBLIC / "motion-palette.json"
    palette_binary_path = PUBLIC / "motion-palette.bin"
    manifest_path = PUBLIC / "manifest.json"
    root_manifest_path = ROOT / "public/data/manifest.json"
    if (sha(core_path), sha(palette_json_path), sha(palette_binary_path)) != (
        ORIGIN_CORE_SHA256, ORIGIN_PALETTE_JSON_SHA256, ORIGIN_PALETTE_BINARY_SHA256
    ):
        raise ValueError("public Cao baseline is not the reviewed origin/main package")

    original_core = json.loads(core_path.read_text())
    core = copy.deepcopy(original_core)
    coast_count = 0
    for chart in core["charts"]:
        if not chart["chartId"].startswith("cao-coast:"):
            continue
        coast_count += 1
        limitations = chart["evidence"]["limitations"]
        if limitations[1] != "Cao continental-outline model geometry is not observed exposed land":
            raise ValueError(f"unexpected coast evidence text in {chart['chartId']}")
        limitations[1] = "Cao coastline-class model geometry is not observed exposed land"
        if chart["surfaceEvidence"]["reason"] != (
            "native Cao continental-outline geometry; exposed-land and height evidence unavailable"
        ):
            raise ValueError(f"unexpected coast surface-evidence text in {chart['chartId']}")
        chart["surfaceEvidence"]["reason"] = (
            "native Cao coastline-class geometry; exposed-land and height evidence unavailable"
        )
    if coast_count != 2921:
        raise ValueError(f"expected 2921 coastline charts, found {coast_count}")
    changed_paths = difference_paths(original_core, core)
    allowed_suffixes = (".evidence.limitations[1]", ".surfaceEvidence.reason")
    if len(changed_paths) != coast_count * 2 or any(
        not path.startswith("charts[") or not path.endswith(allowed_suffixes)
        for path in changed_paths
    ):
        raise ValueError("core repair would change fields outside coastline evidence labels")
    core_path.write_bytes(canonical(core))

    original_palette = json.loads(palette_json_path.read_text())
    original_binary = palette_binary_path.read_bytes()
    _version, record_bytes, entry_count, sample_count, data_offset, *_ = struct.unpack_from(
        "<HHIIIIII", original_binary, 4
    )
    if record_bytes != 20 or data_offset != 32 or entry_count != len(original_palette["entries"]):
        raise ValueError("unexpected Cao palette binary layout")
    records = [struct.unpack_from("<Iffff", original_binary, 32 + 20 * index)
               for index in range(sample_count)]

    cp = foundation.load_coordinate()
    rotation = pygplates.RotationModel(
        [str(foundation.MODEL / name) for name in foundation.ROTATION_FILES],
        default_anchor_plate_id=0,
    )
    global_clock = sorted({
        age for name in foundation.ROTATION_FILES
        for age in cp.all_source_rotation_times(
            foundation.MODEL / name,
            foundation.CAO_SOURCE_YOUNGEST_MA,
            foundation.CAO_SOURCE_OLDEST_MA,
        )
    })
    target_plates = {
        target["plateId"]
        for target in json.loads(
            (ROOT / "data/corrections/cao-v2.4-targets.json").read_text()
        )["targets"]
    }
    relevant_plates = target_plates | set(foundation.CORRECTION_MOTION_PLATES)
    palette = copy.deepcopy(original_palette)
    refined_records = []
    refinements = []
    native_oracle_max = 0.0
    for index, entry in enumerate(palette["entries"]):
        original_entry = original_palette["entries"][index]
        rows = records[
            original_entry["sampleOffset"]:
            original_entry["sampleOffset"] + original_entry["sampleCount"]
        ]
        row_by_age = {row[0]: row for row in rows}
        lo = max(0.0, float(entry["youngestAgeMa"]))
        hi = min(540.0, float(entry["oldestAgeMa"]))
        qref = cp.exact_quaternion(rotation, 0, entry["plateId"])
        maximum_before = 0.0
        if entry["plateId"] in relevant_plates and lo <= hi and qref is not None:
            for quarter in range(math.ceil(lo * 4), math.floor(hi * 4) + 1):
                age = quarter / 4
                expected = foundation.compose(
                    cp.exact_quaternion(rotation, age, entry["plateId"]),
                    foundation.inverse(qref),
                )
                maximum_before = max(maximum_before, angular(expected, quaternion_at(entry, records, age)))
        added = 0
        if maximum_before > ANGULAR_ERROR_LIMIT_RAD:
            for quarter in range(math.ceil(lo * 4), math.floor(hi * 4) + 1):
                age = quarter / 4
                encoded = round(age * 1_000_000)
                if encoded in row_by_age:
                    continue
                exact = cp.exact_quaternion(rotation, age, entry["plateId"])
                relative = cp.float32_quaternion(
                    foundation.compose(exact, foundation.inverse(qref))
                )
                row_by_age[encoded] = (encoded, *relative)
                added += 1
            initial_ages = sorted(age for age in row_by_age
                                  if round(lo * 1_000_000) <= age <= round(hi * 1_000_000))

            def refine_pair(left_u, right_u, depth=0):
                nonlocal added
                if right_u - left_u <= 1:
                    return
                left_q = unit(row_by_age[left_u][1:])
                right_q = unit(row_by_age[right_u][1:])
                probe_errors = []
                for numerator in (1, 2, 3):
                    probe_u = round(left_u + (right_u - left_u) * numerator / 4)
                    age = probe_u / 1_000_000
                    expected = foundation.compose(
                        cp.exact_quaternion(rotation, age, entry["plateId"]),
                        foundation.inverse(qref),
                    )
                    probe_errors.append(angular(
                        expected, slerp(left_q, right_q, (probe_u - left_u) / (right_u - left_u))
                    ))
                if max(probe_errors) <= ANGULAR_ERROR_LIMIT_RAD:
                    return
                if depth >= 20:
                    raise ValueError(f"{entry['entryId']}: adaptive refinement did not converge")
                middle_u = round((left_u + right_u) / 2)
                if middle_u not in row_by_age:
                    age = middle_u / 1_000_000
                    exact = cp.exact_quaternion(rotation, age, entry["plateId"])
                    relative = cp.float32_quaternion(
                        foundation.compose(exact, foundation.inverse(qref))
                    )
                    row_by_age[middle_u] = (middle_u, *relative)
                    added += 1
                refine_pair(left_u, middle_u, depth + 1)
                refine_pair(middle_u, right_u, depth + 1)

            for left_u, right_u in zip(initial_ages, initial_ages[1:]):
                refine_pair(left_u, right_u)
        rewritten_rows = [row_by_age[age] for age in sorted(row_by_age)]
        old_rows = {row[0]: row for row in rows}
        if any(row_by_age.get(age) != row for age, row in old_rows.items()):
            raise ValueError(f"{entry['entryId']}: an existing native sample value changed")
        entry["sampleOffset"] = len(refined_records)
        entry["sampleCount"] = len(rewritten_rows)
        refined_records.extend(rewritten_rows)
        if added:
            maximum_after = 0.0
            maximum_after_age = lo
            for step in range(math.ceil(lo * 40), math.floor(hi * 40) + 1):
                age = step / 40
                expected = foundation.compose(
                    cp.exact_quaternion(rotation, age, entry["plateId"]),
                    foundation.inverse(qref),
                )
                residual = angular(expected, quaternion_at(entry, refined_records, age))
                if residual > maximum_after:
                    maximum_after, maximum_after_age = residual, age
            if maximum_after > ANGULAR_ERROR_LIMIT_RAD:
                raise ValueError(
                    f"{entry['entryId']}: refined native interpolation exceeds angular budget "
                    f"at {maximum_after_age} Ma ({maximum_after} rad)"
                )
            native_oracle_max = max(native_oracle_max, maximum_after)
            refinements.append({
                "entryId": entry["entryId"],
                "plateId": entry["plateId"],
                "youngestAgeMa": entry["youngestAgeMa"],
                "oldestAgeMa": entry["oldestAgeMa"],
                "oldSampleCount": original_entry["sampleCount"],
                "newSampleCount": entry["sampleCount"],
                "addedSourceDerivedSamples": added,
                "maximumQuarterMaResidualBeforeRad": maximum_before,
                "maximumPoint025MaResidualAfterRad": maximum_after,
            })
    records = refined_records
    youngest = foundation.CORRECTION_MOTION_YOUNGEST_MA
    oldest = foundation.CORRECTION_MOTION_OLDEST_MA
    extension_clock = sorted({youngest, oldest, *(
        age for age in global_clock if youngest <= age <= oldest
    )})
    interval_id = "correction-clock-410-540"
    palette["sourceIntervalSets"].append({"id": interval_id, "intervals": [
        {"youngestAgeMa": youngest, "oldestAgeMa": oldest, "kind": "smooth-motion"},
        *[{"youngestAgeMa": age, "oldestAgeMa": age, "kind": "source-knot"}
          for age in extension_clock],
    ]})
    appended = []
    max_error = 0.0
    seam_checks = []
    for plate in foundation.CORRECTION_MOTION_PLATES:
        nodes = foundation.adaptive(cp, rotation, plate, extension_clock)
        qref = cp.exact_quaternion(rotation, 0, plate)
        if qref is None:
            raise ValueError(f"plate {plate} lacks a supported 0 Ma reference pose")
        relative = {
            age: cp.float32_quaternion(foundation.compose(q, foundation.inverse(qref)))
            for age, q in nodes.items()
        }
        offset = len(records)
        records.extend((round(age * 1_000_000), *q) for age, q in sorted(relative.items()))
        entry = {
            "entryId": f"correction-plate-{plate}-{youngest:g}-{oldest:g}",
            "plateId": plate,
            "storedCoordinateBasis": {"kind": "supported-reference", "geometryReferenceAgeMa": 0},
            "youngestAgeMa": youngest,
            "oldestAgeMa": oldest,
            "sampleOffset": offset,
            "sampleCount": len(relative),
            "sourceIds": ["doi:10.5281/zenodo.13628813"],
            "sourceIntervalSetId": interval_id,
        }
        palette["entries"].append(entry)
        appended.append({key: entry[key] for key in (
            "entryId", "plateId", "youngestAgeMa", "oldestAgeMa", "sampleOffset", "sampleCount"
        )})
        native = [candidate for candidate in palette["entries"][:entry_count]
                  if candidate["plateId"] == plate
                  and candidate["youngestAgeMa"] <= youngest <= candidate["oldestAgeMa"]]
        if len(native) != 1:
            raise ValueError(f"expected one native seam entry for plate {plate}, found {len(native)}")
        native_q = quaternion_at(native[0], records, youngest)
        extension_q = quaternion_at(entry, records, youngest)
        seam_error = angular(native_q, extension_q)
        if seam_error > ANGULAR_ERROR_LIMIT_RAD:
            raise ValueError(f"plate {plate} has ambiguous 505 Ma seam ({seam_error} rad)")
        local_max = 0.0
        for quarter in range(round(youngest * 4), round(oldest * 4) + 1):
            age = quarter / 4
            exact = cp.exact_quaternion(rotation, age, plate)
            expected = foundation.compose(exact, foundation.inverse(qref))
            local_max = max(local_max, angular(expected, quaternion_at(entry, records, age)))
        if local_max > ANGULAR_ERROR_LIMIT_RAD:
            raise ValueError(f"plate {plate} extension exceeds angular budget ({local_max} rad)")
        max_error = max(max_error, local_max)
        seam_checks.append({
            "plateId": plate,
            "nativeEntryId": native[0]["entryId"],
            "extensionEntryId": entry["entryId"],
            "angularResidualRad": seam_error,
            "selection": {
                f"{youngest - 0.000001:g}Ma": native[0]["entryId"],
                f"{youngest:g}Ma": entry["entryId"],
                f"{youngest + 0.000001:g}Ma": entry["entryId"],
            },
            "maximumQuarterMaOracleResidualRad": local_max,
        })

    binary = bytearray(32 + 20 * len(records))
    binary[:4] = b"EHMP"
    struct.pack_into("<HHIIIIII", binary, 4, 2, 20, len(palette["entries"]), len(records), 32, 0, 0, 0)
    for index, row in enumerate(records):
        struct.pack_into("<Iffff", binary, 32 + 20 * index, *row)
    palette_binary_path.write_bytes(binary)
    palette["binary"].update({"bytes": len(binary), "sha256": sha(palette_binary_path)})
    for current, original in zip(palette["entries"][:entry_count], original_palette["entries"]):
        if any(current.get(key) != original.get(key) for key in original
               if key not in {"sampleOffset", "sampleCount"}):
            raise ValueError(f"{original['entryId']}: native entry identity or interval changed")
    palette_json_path.write_bytes(canonical(palette))

    manifest = json.loads(manifest_path.read_text())
    manifest["core"] = asset(core_path)
    manifest["motionPalette"]["catalog"] = asset(palette_json_path)
    manifest["motionPalette"]["binary"] = asset(palette_binary_path)
    manifest_path.write_bytes(canonical(manifest))

    root_manifest = json.loads(root_manifest_path.read_text())
    for path in (core_path, palette_json_path, palette_binary_path, manifest_path):
        update_root_output(root_manifest, path)
    root_manifest_path.write_text(json.dumps(root_manifest, indent=2) + "\n")

    proof = {
        "schemaVersion": 1,
        "baseline": {
            "originMainCoreSha256": ORIGIN_CORE_SHA256,
            "originMainMotionPaletteCatalogSha256": ORIGIN_PALETTE_JSON_SHA256,
            "originMainMotionPaletteBinarySha256": ORIGIN_PALETTE_BINARY_SHA256,
            "rotationSourceAggregateSha256": ROTATION_SOURCE_SHA256,
            "frame": manifest["frame"],
        },
        "coastEvidenceRepair": {
            "chartCount": coast_count,
            "changedFieldCount": len(changed_paths),
            "allowedChangedFieldSuffixes": list(allowed_suffixes),
            "correctedCoreSha256": sha(core_path),
            "geometryAssetsUnchanged": original_core["spatialBatches"] == core["spatialBatches"],
            "nonEvidenceCoreFieldsUnchanged": True,
        },
        "motionRefinementAndAppend": {
            "nativeEntryCount": entry_count,
            "nativeSampleCount": sample_count,
            "nativeEntryIdsAndIntervalsUnchanged": True,
            "nativeSamplePayloadSha256": sha_bytes(original_binary[32:]),
            "existingNativeSampleValuesPreserved": True,
            "refinedEntries": refinements,
            "refinementAddedSampleCount": sum(row["addedSourceDerivedSamples"] for row in refinements),
            "refinementAddedSampleBytes": 20 * sum(row["addedSourceDerivedSamples"] for row in refinements),
            "maximumPoint025MaRefinedNativeResidualRad": native_oracle_max,
            "appendedEntries": appended,
            "correctionEntrySampleCount": sum(row["sampleCount"] for row in appended),
            "correctionEntrySampleBytes": 20 * sum(row["sampleCount"] for row in appended),
            "correctedPaletteCatalogSha256": sha(palette_json_path),
            "correctedPaletteBinarySha256": sha(palette_binary_path),
            "angularErrorLimitRad": ANGULAR_ERROR_LIMIT_RAD,
            "maximumQuarterMaOracleResidualRad": max_error,
            "seamChecks": seam_checks,
            "correctionOldestAgeMa": oldest,
            "noEndpointHolding": True,
        },
        "baselinePublicManifestSha256BeforeCorrectionCatalog": sha(manifest_path),
    }
    PROOF.write_text(json.dumps(proof, indent=2) + "\n")
    print(json.dumps({
        "coreSha256": sha(core_path),
        "paletteCatalogSha256": sha(palette_json_path),
        "paletteBinarySha256": sha(palette_binary_path),
        "appendedEntries": len(appended),
        "appendedSamples": len(records) - sample_count,
        "maximumOracleResidualRad": max_error,
        "proof": str(PROOF),
    }))


if __name__ == "__main__":
    main()
