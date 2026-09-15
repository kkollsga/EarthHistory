#!/usr/bin/env python3
"""Validate the restored pre-collision margin correction.

The correction authors the continental margin crust the Alpine and Scandian
collisions consumed, as cited model-inference charts whose lifecycles retire
each strip as the model closes the room for it - the pattern Cao et al. (2024)
already use for ``Greater India based on Gibbons et al. (2015) Gondwana
Research`` on plate 501.

It runs from a clean checkout against tracked inputs only. ``--runtime``
additionally checks the generated public correction catalog and the batch that
owns each chart; ``--model`` re-derives the two structural invariants that need
the pinned Cao model and pyGPlates:

* no strip outlives the room the model leaves it (arithmetic, tracked-only);
* no restored Baltoscandian strip comes within
  ``MINIMUM_NORTH_SEA_CLEARANCE_KM`` of the North-Sea-restored UK block at any
  Scandian age (``--model``).

Design record: ``docs/research/palaeo-coastlines-restored-margins-design.md``.
Implementation record: ``docs/research/palaeo-coastlines-restored-margins.md``.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
from copy import deepcopy
from pathlib import Path

import cao_package_intern as package_intern
import restored_margins_manifest as contract


ROOT = Path(__file__).resolve().parents[2]
REGION = ROOT / "data/corrections/restored-margins"
MANIFEST = REGION / "restored-margins-manifest.json"
PUBLIC = ROOT / "public/data/reconstruction/cao-v2.4"
NORTH_SEA_CONTRACT = ROOT / "data/corrections/north-sea-restoration/restoration-contract.json"
MODEL = (ROOT.parent
         / "EarthHistory-data/palaeomap-study/plates/extracted/cao2024-v2.4/1.8Ga_model_GSF")

CORRECTION_ID = contract.CORRECTION_ID
PHASE = contract.PHASE
SOURCE_TYPE = contract.SOURCE_TYPE
BATCH_ID = "material-correction-restored-margin"
GEOMETRY_NAMES = (contract.ALPS_GEOMETRY, contract.CALEDONIDES_GEOMETRY)

#: The five pinned Cao v2.4 source collections. Both rotation files are read.
PINNED_SOURCE_SHA256 = {
    "shapes_continents.gpmlz":
        "6e30de73967f81a403f46370295dec5c0d7ed3ffd80c73d47df926461d949616",
    "shapes_coasts.gpmlz":
        "c660bc074aa84b366600d81d7ccf3a45658db81ab8cdd8f6bda26e094c0dc71f",
    "static_polygons.gpmlz":
        "9b30d231157f99f9a7942d073efcb85649b0a6e10e49332637df2386f1b1350f",
    "1000_0_rotfile.rot":
        "e13c16ef5b2f8f116f598635e42a126b016b2c615358b499bcc3433f4a3c735c",
    "1800_1000_rotfile.rot":
        "db2a57a8b7c7a08891c19840b6334ffb9c279b6a991a2c2eed099edb23445785",
}

#: Every strip, as compiled from the pinned model. Identity, carrying plate,
#: published width, offset band, lifecycle and area are all pinned: a recompile
#: that moves any of them has to move this table in the same change.
PINNED_FEATURES = {
    "alps-adria-distal-margin-oct-plate-307":
        {"plateId": 307, "widthKm": 60.0, "datumOffsetKm": [126.0, 186.0],
         "oldestMa": 165.0, "youngestMa": 35.0, "areaKm2": 5601.2, "margin": "adria"},
    "alps-adria-distal-margin-oct-plate-308":
        {"plateId": 308, "widthKm": 60.0, "datumOffsetKm": [126.0, 186.0],
         "oldestMa": 165.0, "youngestMa": 35.0, "areaKm2": 27364.8, "margin": "adria"},
    "alps-adria-necking-zone-plate-307":
        {"plateId": 307, "widthKm": 55.0, "datumOffsetKm": [71.0, 126.0],
         "oldestMa": 180.0, "youngestMa": 19.0, "areaKm2": 5185.0, "margin": "adria"},
    "alps-adria-necking-zone-plate-308":
        {"plateId": 308, "widthKm": 55.0, "datumOffsetKm": [71.0, 126.0],
         "oldestMa": 180.0, "youngestMa": 19.0, "areaKm2": 25342.0, "margin": "adria"},
    "alps-adria-proximal-retrowedge-plate-307":
        {"plateId": 307, "widthKm": 71.0, "datumOffsetKm": [0.0, 71.0],
         "oldestMa": 200.0, "youngestMa": 5.0, "areaKm2": 13822.6, "margin": "adria"},
    "alps-adria-proximal-retrowedge-plate-308":
        {"plateId": 308, "widthKm": 71.0, "datumOffsetKm": [0.0, 71.0],
         "oldestMa": 200.0, "youngestMa": 5.0, "areaKm2": 51217.4, "margin": "adria"},
    "alps-europe-distal-margin-oct-plate-305":
        {"plateId": 305, "widthKm": 84.0, "datumOffsetKm": [-234.0, -150.0],
         "oldestMa": 165.0, "youngestMa": 40.0, "areaKm2": 47301.0, "margin": "europe"},
    "alps-europe-outer-necking-zone-plate-305":
        {"plateId": 305, "widthKm": 45.0, "datumOffsetKm": [-150.0, -105.0],
         "oldestMa": 180.0, "youngestMa": 32.0, "areaKm2": 25077.2, "margin": "europe"},
    "alps-europe-inner-necking-zone-plate-305":
        {"plateId": 305, "widthKm": 45.0, "datumOffsetKm": [-105.0, -60.0],
         "oldestMa": 180.0, "youngestMa": 25.0, "areaKm2": 24891.4, "margin": "europe"},
    "alps-europe-proximal-subducted-margin-plate-305":
        {"plateId": 305, "widthKm": 60.0, "datumOffsetKm": [-60.0, 0.0],
         "oldestMa": 200.0, "youngestMa": 10.0, "areaKm2": 32897.4, "margin": "europe"},
    "caledonides-baltica-distal-margin-cot-plate-302":
        {"plateId": 302, "widthKm": 151.0, "datumOffsetKm": [250.0, 401.0],
         "oldestMa": 600.0, "youngestMa": 430.0, "areaKm2": 169559.4, "margin": "baltica"},
    "caledonides-baltica-outer-shelf-plate-302":
        {"plateId": 302, "widthKm": 120.0, "datumOffsetKm": [130.0, 250.0],
         "oldestMa": 600.0, "youngestMa": 420.0, "areaKm2": 133880.0, "margin": "baltica"},
    "caledonides-baltica-middle-allochthon-root-plate-302":
        {"plateId": 302, "widthKm": 130.0, "datumOffsetKm": [0.0, 130.0],
         "oldestMa": 600.0, "youngestMa": 405.0, "areaKm2": 144611.5, "margin": "baltica"},
    "caledonides-laurentia-distal-margin-cot-plate-102":
        {"plateId": 102, "widthKm": 102.0, "datumOffsetKm": [100.0, 202.0],
         "oldestMa": 600.0, "youngestMa": 425.0, "areaKm2": 73372.6, "margin": "laurentia"},
    "caledonides-laurentia-proximal-margin-plate-102":
        {"plateId": 102, "widthKm": 100.0, "datumOffsetKm": [0.0, 100.0],
         "oldestMa": 600.0, "youngestMa": 410.0, "areaKm2": 72184.4, "margin": "laurentia"},
}
AREA_TOLERANCE_PERCENT = 1.0

#: The published width floor each margin's outer strip must still reach. Lowering
#: one of these without a new source is a rejection condition of the contract.
PUBLISHED_WIDTH_FLOOR_KM = {"adria": 140.0, "europe": 230.0,
                            "baltica": 400.0, "laurentia": 200.0}

#: The restored margin must clear the North Sea rigid-restoration block by at
#: least this much at every Scandian age, in both the native and the restored
#: pose of plates 303 and 315. Measured minimum: 56.4 km against restored 303.
#: How far the surviving strips may exceed the model's measured seam between two
#: published stage boundaries. At a retirement age itself the fit must be exact.
MAX_SEAM_OVERFLOW_KM = 40.0

MINIMUM_NORTH_SEA_CLEARANCE_KM = 50.0
SCANDIAN_AGES_MA = (430.0, 425.0, 420.0, 415.0, 410.0, 405.0)
NORTH_SEA_PLATES = (303, 315)
#: Measured 2026-09-15 against the compiled contract and pinned; ``--model``
#: re-derives them. The restoration closes the Shetland-Bergen gap entirely at
#: Caledonian ages, so the restored 303 row is the binding one.
PINNED_NORTH_SEA_CLEARANCE_KM = {
    "303-native": 71.3, "303-restored": 56.2,
    "315-native": 418.7, "315-restored": 419.1,
}
CLEARANCE_TOLERANCE_KM = 1.0

#: The Baltoscandian belt is authored between these parallels and Greenland
#: between those; both are design decisions with reasons, not sampling limits.
BALTICA_LATITUDE_BAND = (60.5, 71.5)
GREENLAND_LATITUDE_BAND = (69.5, 76.5)
GREENLAND_FULL_WIDTH_BAND = (70.0, 76.0)

EARTH_RADIUS_KM = 6371.0088


class CorrectionError(ValueError):
    pass


def fail(label: str, message: str) -> None:
    raise CorrectionError(f"{label}: {message}")


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def active(lifecycle: dict, age: float) -> bool:
    valid = lifecycle["validTimeMa"]
    lower = (valid["youngest"] < age if lifecycle.get("youngestExclusive")
             else valid["youngest"] <= age)
    upper = age < valid["oldest"] if lifecycle.get("oldestExclusive") else age <= valid["oldest"]
    return lower and upper


def rings_of(geometry: dict):
    if geometry.get("type") == "Polygon":
        return list(geometry.get("coordinates", []))
    if geometry.get("type") == "MultiPolygon":
        return [ring for polygon in geometry.get("coordinates", []) for ring in polygon]
    return []


# --------------------------------------------------------------------------
# tracked-input checks
# --------------------------------------------------------------------------

def check_sources(manifest: dict) -> dict:
    """Every source resolves, carries its licence and declares its evidence tag."""
    rows = manifest.get("sourceAssets") or []
    sources = {row.get("sourceId"): row for row in rows}
    if len(sources) != len(rows) or not sources:
        fail("sourceAssets", "source ids are not unique")
    for source_id, row in sources.items():
        for field in ("title", "citation", "url", "publicationOrVersionDate", "license",
                      "attribution", "retrievedAt", "evidenceRole", "constrains", "tag"):
            if not row.get(field):
                fail(f"sourceAssets.{source_id}", f"missing '{field}'")
        if not str(row["tag"]).startswith(("Verbatim", "Snippet", "Bibliographic")):
            fail(f"sourceAssets.{source_id}",
                 f"tag {row['tag']!r} is not Verbatim, Snippet or Bibliographic only")
    return {"sources": len(sources)}


def check_seam_schedule(manifest: dict) -> dict:
    """No strip may outlive the room the model's own closure leaves it.

    The Alpine schedule is the one the model constrains directly: at each pinned
    age the surviving Adriatic plus European widths must fit inside the measured
    seam. The Caledonide schedule is a published collision window cross-checked
    against the model's own crust-to-crust gap, which is closed (0 km) across it.
    """
    # The strips of one family are split across carrying plates but occupy a
    # single offset band, so a plate-split pair contributes its width once.
    bands = {}
    for pinned in PINNED_FEATURES.values():
        if pinned["margin"] not in ("adria", "europe"):
            continue
        bands[(pinned["margin"], tuple(pinned["datumOffsetKm"]))] = (pinned["youngestMa"],
                                                                    pinned["widthKm"])

    alps = manifest["consumptionModel"]["alps"]
    schedule_ages = set(alps["scheduleAgesMa"])
    declared_overflow = alps["maxInterStageOverflowKm"]
    if declared_overflow > MAX_SEAM_OVERFLOW_KM:
        fail("consumptionModel.alps",
             f"the declared inter-stage overflow {declared_overflow:.1f} km exceeds the "
             f"{MAX_SEAM_OVERFLOW_KM:.0f} km the contract allows")
    rows = []
    worst = 0.0
    for age_label, seam_km in sorted(alps["seamKm"].items(), key=lambda item: -float(item[0])):
        age = float(age_label)
        total = sum(width for youngest, width in bands.values() if youngest < age)
        overflow = total - seam_km
        # At a retirement age the surviving strips must fit outright: that is the
        # rule the schedule is fitted by. Between two published stage boundaries
        # the model closes faster than the schedule retires, and the contract
        # declares how far that is allowed to go rather than hiding it.
        if age in schedule_ages and overflow > 0:
            fail("consumptionModel.alps",
                 f"at the {age:g} Ma retirement age the surviving strips total {total:.0f} km "
                 f"but the model's measured seam is only {seam_km:.0f} km")
        if overflow > declared_overflow + 0.1:
            fail("consumptionModel.alps",
                 f"at {age:g} Ma the surviving strips exceed the seam by {overflow:.1f} km, "
                 f"past the declared {declared_overflow:.1f} km inter-stage overflow")
        worst = max(worst, overflow)
        rows.append({"ageMa": age, "survivingKm": total, "seamKm": seam_km})
    gap = manifest["consumptionModel"]["caledonides"]["modelGapKm"]
    for age_label, gap_km in gap.items():
        if float(age_label) <= 430.0 and gap_km != 0.0:
            fail("consumptionModel.caledonides",
                 f"the model's Baltica-Laurentia gap at {age_label} Ma is {gap_km} km, so the "
                 "Scandian window the schedule follows is not the window the model closes")
    return {"alpineScheduleRows": len(rows),
            "maxSeamOverflowKm": round(worst, 1)}


def check_latitude_bands(documents: dict) -> dict:
    """Greenland strips stay inside 70-76 N; the Baltoscandian belt inside its taper."""
    for identifier, row in documents.items():
        pinned = PINNED_FEATURES[identifier]
        latitudes = [position[1] for ring in rings_of(row["geometry"]) for position in ring]
        low, high = min(latitudes), max(latitudes)
        if pinned["margin"] == "laurentia":
            band = GREENLAND_LATITUDE_BAND
        elif pinned["margin"] == "baltica":
            band = BALTICA_LATITUDE_BAND
        else:
            continue
        if low < band[0] - 1e-6 or high > band[1] + 1e-6:
            fail(identifier, f"latitudes {low:.2f}-{high:.2f} N leave the authored band {band}")
        if pinned["margin"] == "laurentia":
            # The full-width core is 70-76 N; outside it the strip is tapered to
            # zero, never carried north into the Svalbard domain.
            full = [position for ring in rings_of(row["geometry"]) for position in ring
                    if GREENLAND_FULL_WIDTH_BAND[0] <= position[1] <= GREENLAND_FULL_WIDTH_BAND[1]]
            if not full:
                fail(identifier, "no sample inside the 70-76 N full-width band")
    return {"bandsChecked": len(documents)}


def validate_document(manifest: dict, *, check_assets: bool = True,
                      region: Path | None = None) -> dict:
    if (manifest.get("schemaVersion") != 1 or manifest.get("version") != "1"
            or manifest.get("correctionId") != CORRECTION_ID
            or manifest.get("kind") != "restored-pre-collision-continental-margin"
            or "crust, not land" not in manifest.get("description", "")):
        fail("manifest", "identity, version, or the crust-not-land claim changed")

    baseline = manifest.get("baseline", {})
    collections = baseline.get("sourceCollections", {})
    if (baseline.get("modelId") != "cao-et-al-2024" or baseline.get("modelVersion") != "2.4"
            or baseline.get("coordinateFrame", {}).get("anchorPlateId") != 0
            or baseline.get("coordinateFrame", {}).get("absoluteFrameId") != "palaeomagnetic"
            or set(collections) != set(PINNED_SOURCE_SHA256)):
        fail("baseline", "pinned Cao source set or reference frame changed")
    for name, digest in PINNED_SOURCE_SHA256.items():
        if collections[name] != digest:
            fail(f"baseline.{name}", "source identity changed")

    emission = manifest.get("emission", {})
    if (emission.get("batchId") != BATCH_ID or emission.get("phase") != PHASE
            or emission.get("sourceFeatureType") != SOURCE_TYPE
            or emission.get("poseStatus") != "model-inference"
            or emission.get("materialStatus") != "restored-consumed-margin"
            or emission.get("surfaceAppearance") != "shelf"
            or emission.get("overlapPolicy") != "native-visual-and-picking-precedence"
            or emission.get("staticDisplayControl", {}).get("displayHeightMetres") != 0
            or "must not read as cited land" not in emission.get("appearanceRationale", "")
            or emission.get("limitations") != [contract.LIMITATION_SPATIAL,
                                               contract.LIMITATION_TEMPORAL,
                                               contract.LIMITATION_EXPOSURE,
                                               contract.LIMITATION_PHASE]):
        fail("emission", "batch, phase, appearance, or limitation contract changed")

    result = check_sources(manifest)
    sources = {row["sourceId"] for row in manifest["sourceAssets"]}

    features = {row.get("correctionFeatureId"): row for row in manifest.get("features", [])}
    if len(features) != len(manifest.get("features", [])) or set(features) != set(PINNED_FEATURES):
        fail("features", "the authored strip set changed")

    for identifier, feature in features.items():
        pinned = PINNED_FEATURES[identifier]
        lifecycles = feature.get("phaseLifecycles", {})
        lifecycle = lifecycles.get(PHASE)
        pose = feature.get("pose", {})
        extent = feature.get("restoredExtent", {})
        consumption = feature.get("consumption", {})
        if (feature.get("coordinateFrame") != "WGS84-reference-coordinates"
                or feature.get("geometryReferenceAgeMa") != 0
                or feature.get("epistemicStatus") != "model-inference"
                or feature.get("materialRole") != "restored-collision-margin"
                or feature.get("margin") != pinned["margin"]
                or set(lifecycles) != {PHASE} or not isinstance(lifecycle, dict)
                or lifecycle.get("youngestExclusive") is not True
                or lifecycle.get("birth", {}).get("status") != "bounded"
                or len(lifecycle.get("birth", {}).get("intervalMa", [])) != 2
                or lifecycle.get("loss", {}).get("status") != "bounded"
                or feature.get("surfaceEvidence", {}).get("kind") != "unknown"
                or "no palaeo class is inherited" not in feature["surfaceEvidence"].get("reason", "")
                or pose.get("plateId") != pinned["plateId"]
                or pose.get("method") != "cao-rigid-plate-motion"
                or pose.get("status") != "model-inference"
                or "never to the static partition" not in pose.get("sourceOrHypothesis", "")
                or "rigid" not in pose.get("warning", "")
                or not feature.get("sourceIds")
                or set(feature["sourceIds"]) - sources
                or not feature.get("rejectionConditions")
                or contract.REJECTION_CONDITIONS[0] not in feature["rejectionConditions"]):
            fail(identifier, "evidence, lifecycle, pose, or material semantics changed")
        valid = lifecycle["validTimeMa"]
        if (valid.get("youngest") != pinned["youngestMa"]
                or valid.get("oldest") != pinned["oldestMa"]):
            fail(identifier, "lifecycle moved off its pinned schedule")
        if lifecycle["loss"]["intervalMa"] != [pinned["youngestMa"], pinned["youngestMa"]]:
            fail(identifier, "the recorded loss interval is not the retirement age")
        if consumption.get("consumedByMa") != pinned["youngestMa"]:
            fail(identifier, "the consumption age is not the lifecycle retirement age")
        if (extent.get("widthKm") != pinned["widthKm"]
                or extent.get("datumOffsetKm") != pinned["datumOffsetKm"]
                or not extent.get("widthDerivation") or not extent.get("datum")
                or not extent.get("publishedSpreadKm")):
            fail(identifier, "the restored width, its band, or its derivation changed")
        editorial = feature.get("editorial") or ""
        if (not editorial.startswith("Model inference after ")
                or extent["publishedSpreadKm"] not in editorial
                or "consumed by collision at" not in editorial):
            fail(identifier, "the map-key editorial line lost its model, spread, or consumption age")
        if any(active(lifecycle, age) for age in (0.0,)):
            fail(identifier, "a restored margin is active at 0 Ma")
        if not active(lifecycle, (pinned["youngestMa"] + pinned["oldestMa"]) / 2.0):
            fail(identifier, "a restored margin is inactive inside its own lifecycle")

    # The outer band of each margin, as the manifest declares it, must still
    # reach the published floor the strip cites.
    for margin, floor in PUBLISHED_WIDTH_FLOOR_KM.items():
        outer = max(max(abs(value) for value in feature["restoredExtent"]["datumOffsetKm"])
                    for feature in features.values() if feature["margin"] == margin)
        if outer < floor:
            fail(f"features.{margin}",
                 f"the outer band reaches {outer:.0f} km, below the published floor {floor:.0f} km")

    result |= check_seam_schedule(manifest)

    if check_assets:
        base = region or REGION
        documents = {}
        for name in GEOMETRY_NAMES:
            path = base / name
            declared = {tuple(sorted(feature["geometryAsset"].items()))
                        for feature in features.values()
                        if feature["geometryAsset"]["path"] == name}
            if not declared:
                fail("features.geometryAsset", f"no feature claims {name}")
            for row in declared:
                asset = dict(row)
                if (not path.is_file() or path.stat().st_size != asset["bytes"]
                        or sha(path) != asset["sha256"]):
                    fail("features.geometryAsset", f"tracked geometry identity changed for {name}")
            document = json.loads(path.read_text())
            if document.get("type") != "FeatureCollection":
                fail(name, "not a FeatureCollection")
            for row in document["features"]:
                documents[row["id"]] = row
        if set(documents) != set(PINNED_FEATURES):
            fail("geometry", "tracked correction feature set changed")
        for identifier, row in documents.items():
            pinned = PINNED_FEATURES[identifier]
            properties = row.get("properties", {})
            valid = properties.get("validTimeMa", {})
            if (properties.get("correctionFeatureId") != identifier
                    or properties.get("plateId") != pinned["plateId"]
                    or properties.get("margin") != pinned["margin"]
                    or properties.get("restoredWidthKm") != pinned["widthKm"]
                    or properties.get("datumOffsetKm") != pinned["datumOffsetKm"]
                    or properties.get("surfaceEvidence") != "unknown"
                    or valid.get("youngest") != pinned["youngestMa"]
                    or valid.get("oldest") != pinned["oldestMa"]
                    or valid.get("youngestExclusive") is not True):
                fail(identifier, "geometry properties or lifecycle changed")
            area = float(properties.get("areaKm2", 0))
            if abs(area - pinned["areaKm2"]) > pinned["areaKm2"] * AREA_TOLERANCE_PERCENT / 100.0:
                fail(identifier, f"area {area:.0f} km2 is outside {AREA_TOLERANCE_PERCENT} % "
                                 f"of the pinned {pinned['areaKm2']:.0f} km2")
            rings = rings_of(row.get("geometry", {}))
            if not rings or any(len(ring) < 4 or ring[0][:2] != ring[-1][:2] for ring in rings):
                fail(identifier, "rings are missing or not closed")
        result |= check_latitude_bands(documents)
        result["totalAreaKm2"] = round(sum(float(row["properties"]["areaKm2"])
                                           for row in documents.values()), 1)
    result["features"] = len(features)
    return result


# --------------------------------------------------------------------------
# generated-catalog checks
# --------------------------------------------------------------------------

def batch_chart_indices(path: Path, vertex_count: int) -> set[int]:
    import struct
    data = path.read_bytes()
    offset = 32 + vertex_count * 16
    return set(struct.unpack_from(f"<{vertex_count}I", data, offset))


def validate_generated_catalog(manifest: dict, catalog: dict,
                               package_dir: Path | None = None) -> dict:
    expected = {f"correction:{CORRECTION_ID}:{feature['correctionFeatureId']}:{PHASE}": feature
                for feature in manifest["features"]}
    charts = {chart["chartId"]: chart for chart in catalog.get("charts", [])
              if chart.get("evidence", {}).get("correction", {}).get("correctionId") == CORRECTION_ID}
    if set(charts) != set(expected):
        fail("generated catalog", "restored-margin chart set changed")
    palette_plates = {}
    if package_dir is not None:
        palette = json.loads((package_dir / "motion-palette.json").read_text())
        palette_plates = {entry["entryId"]: entry["plateId"] for entry in palette["entries"]}
    for chart_id, feature in expected.items():
        chart = charts[chart_id]
        lifecycle = feature["phaseLifecycles"][PHASE]
        correction = chart.get("evidence", {}).get("correction", {})
        bindings = chart.get("motionBindings", [])
        plate = feature["pose"]["plateId"]
        if (chart.get("lifecycle") != lifecycle
                or chart.get("surfaceEvidence") != feature["surfaceEvidence"]
                or chart.get("geometryReferenceAgeMa") != 0
                or correction.get("phase") != PHASE
                or correction.get("materialStatus") != "restored-consumed-margin"
                or correction.get("poseStatus") != "model-inference"
                or correction.get("consumedByMa") != lifecycle["validTimeMa"]["youngest"]
                or correction.get("restoredWidthKm") != feature["restoredExtent"]["widthKm"]
                or chart.get("sourceFeatureTypes") != [SOURCE_TYPE]
                or chart.get("fragmentOrCohortId") != feature["correctionFeatureId"]
                or chart.get("evidence", {}).get("limitations") != manifest["emission"]["limitations"]
                or not bindings
                or (palette_plates and any(palette_plates.get(binding.get("entryId")) != plate
                                           for binding in bindings))):
            fail(chart_id, "generated lifecycle, evidence, or motion binding changed")
        ordered = sorted(bindings, key=lambda binding: binding["validTimeMa"]["youngest"])
        cursor = lifecycle["validTimeMa"]["youngest"]
        for binding in ordered:
            if binding["validTimeMa"]["youngest"] != cursor:
                fail(chart_id, "motion bindings do not partition the lifecycle")
            cursor = binding["validTimeMa"]["oldest"]
        if cursor != lifecycle["validTimeMa"]["oldest"]:
            fail(chart_id, "motion bindings stop before the lifecycle oldest age")
    if CORRECTION_ID not in catalog.get("correctionIds", []):
        fail("generated catalog", "correction identity is absent from the catalog")
    batch = next((row for row in catalog["spatialBatches"] if row["batchId"] == BATCH_ID), None)
    if batch is None:
        fail("generated catalog", f"the {BATCH_ID} batch is absent")
    if (batch.get("surfaceAppearance") != "shelf"
            or batch.get("overlapPolicy") != "native-visual-and-picking-precedence"
            or batch.get("staticDisplayControl", {}).get("displayHeightMetres") != 0):
        fail(BATCH_ID, "the declared crust appearance or display control changed")
    if package_dir is not None:
        core = package_intern.read_package_json(package_dir / "core.json")
        indices = {row["chartId"]: len(core["charts"]) + index
                   for index, row in enumerate(catalog["charts"])}
        members = {}
        for row in catalog["spatialBatches"]:
            geometry = package_dir / row["geometryAsset"]["url"]
            if (not geometry.is_file() or geometry.stat().st_size != row["geometryAsset"]["bytes"]
                    or sha(geometry) != row["geometryAsset"]["sha256"]):
                fail(row["batchId"], "geometry identity changed")
            members[row["batchId"]] = batch_chart_indices(geometry, row["vertexCount"])
        for chart_id in expected:
            containing = [batch_id for batch_id, rows in members.items()
                          if indices[chart_id] in rows]
            if containing != [BATCH_ID]:
                fail(chart_id, f"expected only {BATCH_ID}, found {containing}")
    return {"charts": len(charts)}


# --------------------------------------------------------------------------
# model re-derivation (pinned pyGPlates environment)
# --------------------------------------------------------------------------

def measure_north_sea_clearance(region: Path | None = None) -> dict:
    """Minimum great-circle gap to the UK block at every Scandian age."""
    import pygplates

    base = region or REGION
    rotations = pygplates.RotationModel([str(MODEL / "1000_0_rotfile.rot"),
                                         str(MODEL / "1800_1000_rotfile.rot")])
    continents = list(pygplates.FeatureCollection(str(MODEL / "shapes_continents.gpmlz")))
    restoration = json.loads(NORTH_SEA_CONTRACT.read_text())
    pole = restoration["pole"]["lonLat"]
    angle = restoration["angleSchedule"][-1]["angleDegrees"]
    pre = pygplates.FiniteRotation(pygplates.PointOnSphere(pole[1], pole[0]),
                                   math.radians(angle))

    def polygon(ring):
        points = [pygplates.PointOnSphere(position[1], position[0]) for position in ring]
        if len(points) < 3:
            return None
        try:
            return pygplates.PolygonOnSphere(points)
        except Exception:
            return None

    strips = []
    document = json.loads((base / contract.CALEDONIDES_GEOMETRY).read_text())
    for row in document["features"]:
        if row["properties"]["margin"] != "baltica":
            continue
        for ring in rings_of(row["geometry"]):
            shape = polygon(ring)
            if shape is not None:
                strips.append(shape)
    if not strips:
        fail("model", "no restored Baltoscandian strip to measure")

    blocks = {}
    for plate in NORTH_SEA_PLATES:
        shapes = []
        for feature in continents:
            if feature.get_reconstruction_plate_id() != plate:
                continue
            for geometry in feature.get_geometries():
                ring = [(point.to_lat_lon()[1], point.to_lat_lon()[0])
                        for point in geometry.get_points()]
                shape = polygon(ring)
                if shape is not None:
                    shapes.append(shape)
        blocks[plate] = shapes

    def move(shapes, plate, age, restore=False):
        rotation = rotations.get_rotation(age, plate)
        output = []
        for shape in shapes:
            points = [rotation * (pre * point if restore else point)
                      for point in shape.get_points()]
            try:
                output.append(pygplates.PolygonOnSphere(points))
            except Exception:
                continue
        return output

    def minimum(left, right):
        best = None
        for one in left:
            for other in right:
                distance = pygplates.GeometryOnSphere.distance(one, other) * EARTH_RADIUS_KM
                if best is None or distance < best:
                    best = distance
        return best

    measured = {}
    for age in SCANDIAN_AGES_MA:
        posed = move(strips, 302, age)
        for plate in NORTH_SEA_PLATES:
            for label, restore in (("native", False), ("restored", True)):
                gap = minimum(posed, move(blocks[plate], plate, age, restore))
                if gap is None:
                    fail("model", f"no gap could be measured against plate {plate} at {age:g} Ma")
                measured.setdefault(f"{plate}-{label}", []).append(round(gap, 1))
    rows = {key: round(min(values), 1) for key, values in measured.items()}
    for key, value in rows.items():
        if value < MINIMUM_NORTH_SEA_CLEARANCE_KM:
            fail("northSeaClearance",
                 f"the restored Baltoscandian margin comes within {value:.1f} km of the "
                 f"{key} UK block, under the {MINIMUM_NORTH_SEA_CLEARANCE_KM:.0f} km minimum")
        pinned = PINNED_NORTH_SEA_CLEARANCE_KM[key]
        if abs(value - pinned) > CLEARANCE_TOLERANCE_KM:
            fail("northSeaClearance",
                 f"the {key} clearance measured {value:.1f} km, not the pinned {pinned:.1f} km")
    return {"northSeaClearanceKm": rows}


def validate_model(region: Path | None = None) -> dict:
    return measure_north_sea_clearance(region)


# --------------------------------------------------------------------------
# entry points
# --------------------------------------------------------------------------

def validate(runtime: bool = False, model: bool = False, package_dir: Path = PUBLIC) -> dict:
    manifest = json.loads(MANIFEST.read_text())
    result = validate_document(manifest)
    if runtime:
        package = json.loads((package_dir / "manifest.json").read_text())
        catalog = package_intern.read_package_json(
            package_dir / package["materialCorrections"]["catalog"]["url"])
        result |= validate_generated_catalog(manifest, catalog, package_dir)
    if model:
        result |= validate_model()
    return result


def expect_failure(label: str, manifest: dict, *, region: Path | None = None) -> None:
    try:
        validate_document(manifest, region=region)
    except CorrectionError:
        return
    raise CorrectionError(f"self-test: mutation {label!r} was accepted")


def self_test(runtime: bool = False, model: bool = False, package_dir: Path = PUBLIC) -> dict:
    import tempfile

    manifest = json.loads(MANIFEST.read_text())
    validate_document(manifest)
    mutations = []

    mutated = deepcopy(manifest)
    mutated["features"][0]["correctionFeatureId"] = "alps-adria-renamed-strip"
    mutations.append(("a renamed feature", mutated))

    mutated = deepcopy(manifest)
    mutated["features"][0]["phaseLifecycles"][PHASE]["validTimeMa"]["youngest"] = 0.0
    mutations.append(("a widened lifecycle that survives to the present", mutated))

    mutated = deepcopy(manifest)
    target = next(feature for feature in mutated["features"] if feature["margin"] == "baltica")
    target["pose"]["plateId"] = 303
    mutations.append(("a Baltoscandian strip rebound to the restored UK block", mutated))

    mutated = deepcopy(manifest)
    target = next(feature for feature in mutated["features"] if feature["margin"] == "adria")
    target["pose"]["plateId"] = 305
    mutations.append(("the datum partition changed to the conjugate plate", mutated))

    mutated = deepcopy(manifest)
    target = next(feature for feature in mutated["features"]
                  if feature["correctionFeatureId"].endswith("distal-margin-cot-plate-302"))
    target["restoredExtent"]["datumOffsetKm"] = [250.0, 380.0]
    target["restoredExtent"]["widthKm"] = 130.0
    mutations.append(("the published Baltoscandian width floor lowered", mutated))

    mutated = deepcopy(manifest)
    mutated["consumptionModel"]["alps"]["seamKm"]["19"] = 100.0
    mutations.append(("a strip left alive past the room the model leaves it", mutated))

    mutated = deepcopy(manifest)
    mutated["consumptionModel"]["alps"]["maxInterStageOverflowKm"] = 5.0
    mutations.append(("an inter-stage overflow smaller than the schedule's own", mutated))

    mutated = deepcopy(manifest)
    mutated["emission"]["surfaceAppearance"] = "land"
    mutations.append(("the crust appearance replaced by the land appearance", mutated))

    mutated = deepcopy(manifest)
    mutated["baseline"]["sourceCollections"]["1800_1000_rotfile.rot"] = "0" * 64
    mutations.append(("an unpinned second rotation file", mutated))

    for label, document in mutations:
        expect_failure(label, document)

    # A strip physically moved into the North Sea block: the tracked-geometry
    # half sees it leave the authored latitude band, and --model sees the
    # clearance collapse.
    with tempfile.TemporaryDirectory(prefix="earthhistory-restored-margins-") as scratch:
        region = Path(scratch)
        for name in GEOMETRY_NAMES:
            (region / name).write_text((REGION / name).read_text())
        document = json.loads((region / contract.CALEDONIDES_GEOMETRY).read_text())
        for row in document["features"]:
            if row["properties"]["margin"] != "baltica":
                continue
            for ring in row["geometry"]["coordinates"]:
                for position in ring:
                    position[0] -= 8.0
                    position[1] -= 4.0
        (region / contract.CALEDONIDES_GEOMETRY).write_text(json.dumps(document))
        mutated = deepcopy(manifest)
        for feature in mutated["features"]:
            path = region / feature["geometryAsset"]["path"]
            feature["geometryAsset"]["bytes"] = path.stat().st_size
            feature["geometryAsset"]["sha256"] = sha(path)
        expect_failure("a strip overlapping the restored UK block", mutated, region=region)
        rejected = len(mutations) + 1
        if model:
            try:
                measure_north_sea_clearance(region)
            except CorrectionError:
                rejected += 1
            else:
                raise CorrectionError(
                    "self-test: a strip inside the North Sea block passed the clearance check")

    result = {"mutationsRejected": rejected}
    if runtime:
        package = json.loads((package_dir / "manifest.json").read_text())
        catalog = package_intern.read_package_json(
            package_dir / package["materialCorrections"]["catalog"]["url"])
        validate_generated_catalog(manifest, catalog, package_dir)
        broken = deepcopy(catalog)
        chart = next(row for row in broken["charts"]
                     if row["evidence"]["correction"]["correctionId"] == CORRECTION_ID)
        chart["lifecycle"]["youngestExclusive"] = False
        try:
            validate_generated_catalog(manifest, broken, package_dir)
        except CorrectionError:
            result["runtimeMutationRejected"] = True
        else:
            raise CorrectionError("self-test: a present-active generated chart was accepted")
    if model:
        result |= validate_model()
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--self-test", action="store_true")
    parser.add_argument("--runtime", action="store_true")
    parser.add_argument("--model", action="store_true",
                        help="re-derive the North Sea clearance from the pinned Cao model")
    parser.add_argument("--package", type=Path, default=PUBLIC)
    arguments = parser.parse_args()
    result = (self_test(arguments.runtime, arguments.model, arguments.package)
              if arguments.self_test
              else validate(arguments.runtime, arguments.model, arguments.package))
    print(json.dumps(result, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
