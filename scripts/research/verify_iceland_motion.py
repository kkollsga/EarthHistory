#!/usr/bin/env python3
"""Compare Iceland correction palette poses with the strict Cao rotation oracle."""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

import pygplates

import apply_regional_barents_shelf as barents
import cao_package_intern as package_intern
import emit_cao_foundation_package as foundation


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_PACKAGE = ROOT / "public/data/reconstruction/cao-v2.4"
DEFAULT_REPORT = ROOT / "docs/research/regional-iceland-motion-validation.json"
CORRECTION_ID = "earthhistory-regional-iceland-surface-v1"
PLATES = (101, 301)
AGES = (0, 0.001, 0.021, 0.4, 0.799999, 0.8, 1, 3, 3.3, 5, 10, 15, 16.3)
LIMIT_RADIANS = 1e-5


class MotionError(ValueError):
    pass


def pose_at(palette: dict, records: list[tuple], plate: int, age_ma: float):
    entries = [entry for entry in palette["entries"] if entry["plateId"] == plate
               and entry["youngestAgeMa"] <= age_ma <= entry["oldestAgeMa"]]
    if not entries:
        raise MotionError(f"plate {plate}: no palette entry at {age_ma} Ma")
    poses = [barents.quaternion_at(entry, records, age_ma) for entry in entries]
    if any(barents.angular(poses[0], candidate) > LIMIT_RADIANS for candidate in poses[1:]):
        raise MotionError(f"plate {plate}: ambiguous palette pose at {age_ma} Ma")
    return poses[0], sorted(entry["entryId"] for entry in entries)


def validate(package: Path, output: Path) -> dict:
    manifest = json.loads((package / "manifest.json").read_text())
    palette = json.loads((package / manifest["motionPalette"]["catalog"]["url"]).read_text())
    _, records = barents.decode_palette(package / manifest["motionPalette"]["binary"]["url"], palette)
    correction_path = package / manifest["materialCorrections"]["catalog"]["url"]
    # The correction catalog ships interned; read it back through the interning
    # owner or every chart row would be an index list rather than a chart.
    correction = package_intern.read_package_json(correction_path)
    charts = [chart for chart in correction["charts"]
              if chart.get("evidence", {}).get("correction", {}).get("correctionId") == CORRECTION_ID]
    if len(charts) != 14:
        raise MotionError(f"expected 14 Iceland phase charts, found {len(charts)}")
    rotation = pygplates.RotationModel(
        [str(foundation.MODEL / name) for name in foundation.ROTATION_FILES],
        default_anchor_plate_id=0,
    )
    witnesses = []
    maximum = 0.0
    maximum_at = None
    for plate in PLATES:
        plate_charts = [chart for chart in charts
                        if chart["fragmentOrCohortId"].endswith(f"plate-{plate}")]
        if len(plate_charts) != 7:
            raise MotionError(f"plate {plate}: expected seven Iceland phase charts")
        for chart in plate_charts:
            if any(not binding["entryId"].startswith(f"plate-{plate}-")
                   for binding in chart["motionBindings"]):
                raise MotionError(f"{chart['chartId']}: crossed the Iceland plate partition")
        for age_ma in AGES:
            palette_pose, entry_ids = pose_at(palette, records, plate, age_ma)
            exact = barents.exact_relative(barents.CP, rotation, plate, age_ma)
            residual = barents.angular(palette_pose, exact)
            if residual > maximum:
                maximum, maximum_at = residual, {"plateId": plate, "ageMa": age_ma}
            witnesses.append({"plateId": plate, "ageMa": age_ma,
                              "entryIds": entry_ids, "angularResidualRadians": residual})
    if maximum > LIMIT_RADIANS:
        raise MotionError(f"Iceland palette pose residual {maximum:.9g} exceeds {LIMIT_RADIANS}")
    report = {
        "schemaVersion": 1,
        "correctionId": CORRECTION_ID,
        "oracle": "pyGPlates strict Cao v2.4 finite rotations relative to each plate's 0 Ma pose",
        "frame": manifest["frame"],
        "packageAssets": {
            "core": manifest["core"],
            "motionPaletteCatalog": manifest["motionPalette"]["catalog"],
            "motionPaletteBinary": manifest["motionPalette"]["binary"],
            "materialCorrectionCatalog": manifest["materialCorrections"]["catalog"],
        },
        "testedPlateIds": list(PLATES),
        "testedAgesMa": list(AGES),
        "maximumAngularResidualRadians": maximum,
        "maximumResidualAt": maximum_at,
        "acceptanceLimitRadians": LIMIT_RADIANS,
        "witnesses": witnesses,
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2) + "\n")
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--package", type=Path, default=DEFAULT_PACKAGE)
    parser.add_argument("--output", type=Path, default=DEFAULT_REPORT)
    args = parser.parse_args()
    report = validate(args.package.resolve(), args.output.resolve())
    print(json.dumps({"testedPlateIds": report["testedPlateIds"],
                      "testedAgesMa": report["testedAgesMa"],
                      "maximumAngularResidualRadians": report["maximumAngularResidualRadians"],
                      "maximumResidualAt": report["maximumResidualAt"]}, indent=2))


if __name__ == "__main__":
    main()
