#!/usr/bin/env python3
"""Export the EarthHistory palaeogeography dataset as a citable archive.

The archive is the shipped realistic-coast package -- the 75 EHPR batch
payloads, their three class catalogs and the country-outline tone tables --
together with the tracked contracts that define every EarthHistory
modification, a provenance manifest naming every input and its digest, a
schema README, a citation file and the licence/attribution block.

Nothing is recompiled here. The exporter reads the promoted public tree and
the tracked contracts, re-hashes every payload against the digest the package
manifest already publishes, and refuses to write an archive when a digest, a
record count or a scientific reference does not resolve. An archive that this
script writes therefore carries exactly the bytes the application serves.

Stdlib only. Usage:

    export_earthhistory_palaeogeography.py                 build the archive
    export_earthhistory_palaeogeography.py --verify PATH   re-hash an archive
    export_earthhistory_palaeogeography.py --self-test     prove the gates fail
    export_earthhistory_palaeogeography.py --clean         drop the output tier

R4: the output directory is the bounded owned location; `--clean` is its
cleanup owner.
"""

from __future__ import annotations

import argparse
import datetime as _dt
import gzip
import hashlib
import io
import json
import re
import shutil
import struct
import sys
import tarfile
import tempfile
from pathlib import Path

# ---------------------------------------------------------------------------
# Identity and layout
# ---------------------------------------------------------------------------

DATASET_ID = "earthhistory-palaeogeography"
DATASET_VERSION = "2026.1"
DATASET_TITLE = "EarthHistory palaeogeography 2026.1"
ARCHIVE_STEM = f"earth-history-palaeogeography-{DATASET_VERSION}"

REPO_ROOT = Path(__file__).resolve().parents[2]
PACKAGE_RELATIVE = Path("public/data/reconstruction/cao-v2.4")
OUT_RELATIVE = Path("dev-docs/bench/out/dataset")

# The schedule is 24 published Cao 2017 map intervals plus the detached LGM
# state, in three surface classes.
EXPECTED_INTERVALS = 25
EXPECTED_CLASSES = ("lm", "sm", "m")
EXPECTED_BATCH_RECORDS = EXPECTED_INTERVALS * len(EXPECTED_CLASSES)

CLASS_NAMES = {"lm": "landmass", "sm": "shallow marine", "m": "mountain"}

# EHPR v1: 32-byte header, then a 12-byte piece record whose flags are a u16
# at offset 8. docs/data/palaeo-coastlines-format.md is the authority.
EHPR_MAGIC = b"EHPR"
EHPR_HEADER_BYTES = 32
EHPR_PIECE_BYTES = 12
EHPR_PIECE_FLAG_OFFSET = 8
PIECE_FLAGS = {
    1: "frameConflictFlagged",
    2: "boundByPlateIdOverride",
    4: "boundToNorthSeaRestoration",
    8: "offPublishedSchedule",
    16: "protectedBasinWindow",
    32: "retainedUnsimplified",
}

# Tracked contracts that define the EarthHistory modifications. Every one of
# them ships in the archive, because a consumer cannot audit a modification it
# cannot read.
BASIN_CONTRACT_DIR = Path("data/corrections/palaeo-coastlines/basins")
PALAEO_CONTRACT_FILES = (
    Path("data/corrections/palaeo-coastlines/overrides.json"),
    Path("data/corrections/palaeo-coastlines/simplification.json"),
    Path("data/corrections/palaeo-coastlines/sources.json"),
)
LGM_CONTRACT_DIR = Path("data/corrections/palaeo-coastlines/lgm")
RESTORED_MARGINS_DIR = Path("data/corrections/restored-margins")
RESTORED_MARGIN_BATCH_ID = "material-correction-restored-margin"

SOURCES_TS = Path("src/data/sources.ts")
DATA_MANIFEST = Path("public/data/manifest.json")
THIRD_PARTY_NOTICES = Path("THIRD_PARTY_NOTICES.md")
PACKAGE_JSON = Path("package.json")

# Licences an input may carry and still be redistributed, in derivative form,
# under a CC BY 4.0 compilation. Anything else is a licence conflict and stops
# the export: a NonCommercial, NoDerivatives or ShareAlike term cannot be
# relicensed into this compilation, and neither can a citation-only permission.
REDISTRIBUTABLE_LICENCES = (
    "cc by 4.0",
    "cc by 3.0",
    "cc0",
    "public domain",
)


class ExportError(RuntimeError):
    """A gate refused the export."""


# ---------------------------------------------------------------------------
# Licence text reused verbatim from THIRD_PARTY_NOTICES.md
# ---------------------------------------------------------------------------
#
# The attribution wording below is already approved in THIRD_PARTY_NOTICES.md.
# It is reproduced here rather than reworded, and `assert_notice_fragments`
# proves each block is still present in the notices file (whitespace
# normalised, because the notices are hard-wrapped). Licence text drifting
# apart in two places is a licence defect, so the mismatch stops the export.

NOTICE_CAO_2024 = (
    "**Earth's tectonic and plate boundary evolution over 1.8 billion years, "
    "Cao et al. (2024), model v2.4** — "
    "[Zenodo record 13628813](https://doi.org/10.5281/zenodo.13628813), licensed "
    "under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)."
)

NOTICE_NATURAL_EARTH = (
    "**Natural Earth 1:50m Admin 0 countries, version 5.1.1** — "
    "[Natural Earth](https://www.naturalearthdata.com/about/terms-of-use/), public "
    "domain."
)

NOTICE_ETOPO = (
    "**ETOPO 2022 Global Relief Model** — NOAA National Centers for Environmental "
    "Information, [DOI 10.25921/fd45-gt74](https://doi.org/10.25921/fd45-gt74), "
    "public-domain U.S. government data with attribution requested."
)

NOTICE_CAO_2017 = (
    "**Improving global paleogeography since the late Paleozoic using paleobiology** — "
    "Cao et al. (2017), [Biogeosciences 14 (2017)](https://doi.org/10.5194/bg-14-5425-2017), "
    "official EarthByte GPlates 2.3 Paleogeography package, licensed under "
    "[CC BY 3.0](https://creativecommons.org/licenses/by/3.0/); the package README "
    "also requires citing Matthews et al. (2016), "
    "[doi:10.1016/j.gloplacha.2016.10.002](https://doi.org/10.1016/j.gloplacha.2016.10.002)."
)

NOTICE_CAO_2017_MODIFICATION = (
    "The modifications are EarthHistory's: the present-day polygons are cut by the "
    "present-day Cao et al. (2024) v2.4 static partitions, each piece is given one "
    "partition owner and rides that plate, node counts are reduced by "
    "Douglas–Peucker, and the published `FROMAGE`/`TOAGE` map interval becomes a "
    "half-open lifecycle."
)

NOTICE_CAO_2017_LIMITATION = (
    "A map interval records the minimum land and maximum flooding recorded anywhere "
    "in that bin, not a shoreline at one moment; the absence of ice polygons is not "
    "proof of an ice-free Earth."
)

NOTICE_FRAGMENTS = (
    ("Cao et al. (2024) v2.4", NOTICE_CAO_2024),
    ("Natural Earth 1:50m", NOTICE_NATURAL_EARTH),
    ("ETOPO 2022", NOTICE_ETOPO),
    ("Cao et al. (2017)", NOTICE_CAO_2017),
    ("Cao 2017 modification statement", NOTICE_CAO_2017_MODIFICATION),
    ("Cao 2017 map-interval limitation", NOTICE_CAO_2017_LIMITATION),
)


def _normalise(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def assert_notice_fragments(repo_root: Path) -> None:
    notices_path = repo_root / THIRD_PARTY_NOTICES
    if not notices_path.is_file():
        raise ExportError(f"{THIRD_PARTY_NOTICES} is missing; the approved licence text has no authority")
    notices = _normalise(notices_path.read_text(encoding="utf-8"))
    for label, fragment in NOTICE_FRAGMENTS:
        if _normalise(fragment) not in notices:
            raise ExportError(
                f"licence text drift: the {label} block in this exporter is no longer "
                f"present in {THIRD_PARTY_NOTICES}. Reconcile the two before exporting."
            )


# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def sha256_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def read_json(path: Path) -> object:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as error:
        raise ExportError(f"missing input: {path}") from error
    except json.JSONDecodeError as error:
        raise ExportError(f"unreadable JSON: {path}: {error}") from error


def json_bytes(document: object) -> bytes:
    return (json.dumps(document, indent=2, sort_keys=True, ensure_ascii=False) + "\n").encode("utf-8")


# ---------------------------------------------------------------------------
# Member assembly
# ---------------------------------------------------------------------------


class Member:
    """One file in the archive, with the digest `--verify` re-checks."""

    __slots__ = ("path", "payload", "role", "sha256", "bytes")

    def __init__(self, path: str, payload: bytes, role: str) -> None:
        self.path = path
        self.payload = payload
        self.role = role
        self.sha256 = sha256_bytes(payload)
        self.bytes = len(payload)

    def record(self) -> dict:
        return {"path": self.path, "bytes": self.bytes, "sha256": self.sha256, "role": self.role}


def verified_asset(package_dir: Path, asset: dict, what: str) -> bytes:
    """Read a shipped asset and prove it is the bytes the manifest published."""

    url = asset.get("url")
    if not isinstance(url, str) or not url:
        raise ExportError(f"{what}: the manifest record has no asset url")
    path = package_dir / url
    if not path.is_file():
        raise ExportError(f"{what}: the promoted package has no {url}")
    payload = path.read_bytes()
    declared_bytes = asset.get("bytes")
    declared_sha = asset.get("sha256")
    if len(payload) != declared_bytes:
        raise ExportError(
            f"{what}: {url} weighs {len(payload)} bytes, the package manifest declares {declared_bytes}"
        )
    actual = sha256_bytes(payload)
    if actual != declared_sha:
        raise ExportError(
            f"{what}: {url} hashes to {actual}, the package manifest declares {declared_sha}. "
            "The shipped payload and its published digest disagree; the export is refused."
        )
    return payload


def decode_ehpr_flags(payload: bytes, what: str) -> dict:
    """Count the piece flags of one EHPR v1 payload (see the format doc)."""

    if len(payload) < EHPR_HEADER_BYTES or payload[:4] != EHPR_MAGIC:
        raise ExportError(f"{what}: not an EHPR payload")
    version, header_bytes, pieces = struct.unpack_from("<HHI", payload, 4)
    if version != 1 or header_bytes != EHPR_HEADER_BYTES:
        raise ExportError(f"{what}: EHPR version {version}/header {header_bytes} is not v1/32")
    end = EHPR_HEADER_BYTES + pieces * EHPR_PIECE_BYTES
    if end > len(payload):
        raise ExportError(f"{what}: the piece table runs past the payload")
    counts = {name: 0 for name in PIECE_FLAGS.values()}
    counts["pieces"] = pieces
    for index in range(pieces):
        offset = EHPR_HEADER_BYTES + index * EHPR_PIECE_BYTES + EHPR_PIECE_FLAG_OFFSET
        flags = struct.unpack_from("<H", payload, offset)[0]
        for bit, name in PIECE_FLAGS.items():
            if flags & bit:
                counts[name] += 1
    return counts


def tracked_files(repo_root: Path, relative_dir: Path) -> list[Path]:
    root = repo_root / relative_dir
    if not root.is_dir():
        raise ExportError(f"missing contract directory: {relative_dir}")
    return sorted(p for p in root.rglob("*") if p.is_file() and not p.name.startswith("."))


# ---------------------------------------------------------------------------
# Scientific reference resolution
# ---------------------------------------------------------------------------


def source_catalog_ids(repo_root: Path) -> set[str]:
    text = (repo_root / SOURCES_TS).read_text(encoding="utf-8")
    ids = set(re.findall(r'\bid:\s*"([^"]+)"', text))
    if not ids:
        raise ExportError(f"{SOURCES_TS} declared no source ids; the reference gate has no catalog")
    return ids


def reference_is_self_contained(reference: dict) -> bool:
    """A contract-local reference must carry its own full citation."""

    citation = reference.get("citation")
    url = reference.get("url")
    year = reference.get("year")
    return bool(
        isinstance(citation, str)
        and citation.strip()
        and isinstance(url, str)
        and url.strip()
        and isinstance(year, int)
    )


def resolve_references(repo_root: Path, contracts: list[tuple[str, dict]]) -> list[dict]:
    """Every scientific reference a shipped contract cites must resolve.

    It resolves through `src/data/sources.ts`, or -- for a reference the app
    catalog does not carry -- through its own complete citation (citation, url
    and year) in the contract row. A reference that resolves through neither is
    an unciteable claim and stops the export.
    """

    catalog = source_catalog_ids(repo_root)
    resolved: dict[str, dict] = {}
    for contract_name, document in contracts:
        for reference in document.get("references", []) or []:
            if not isinstance(reference, dict):
                raise ExportError(f"{contract_name}: a references entry is not an object")
            source_id = reference.get("sourceId") or reference.get("id")
            if not isinstance(source_id, str) or not source_id.strip():
                raise ExportError(f"{contract_name}: a references entry has no sourceId")
            in_catalog = source_id in catalog
            self_contained = reference_is_self_contained(reference)
            if not in_catalog and not self_contained:
                raise ExportError(
                    f"{contract_name}: reference '{source_id}' is in neither {SOURCES_TS} nor "
                    "carries its own citation, url and year. An unresolvable reference cannot ship."
                )
            row = resolved.setdefault(
                source_id,
                {
                    "sourceId": source_id,
                    "citation": reference.get("citation"),
                    "url": reference.get("url"),
                    "year": reference.get("year"),
                    "catalog": "src/data/sources.ts" if in_catalog else "contract-local",
                    "citedBy": [],
                },
            )
            if contract_name not in row["citedBy"]:
                row["citedBy"].append(contract_name)
            if row["citation"] is None and reference.get("citation"):
                row["citation"] = reference["citation"]
            if row["url"] is None and reference.get("url"):
                row["url"] = reference["url"]
            if row["year"] is None and reference.get("year"):
                row["year"] = reference["year"]
    for row in resolved.values():
        row["citedBy"].sort()
    return [resolved[key] for key in sorted(resolved)]


# ---------------------------------------------------------------------------
# Provenance
# ---------------------------------------------------------------------------


def licence_gate(inputs: list[dict]) -> None:
    for entry in inputs:
        if not entry.get("redistributedInThisArchive"):
            continue
        licence = (entry.get("license") or "").strip().lower()
        if not any(licence.startswith(allowed) for allowed in REDISTRIBUTABLE_LICENCES):
            raise ExportError(
                f"licence conflict: input '{entry.get('sourceId')}' is redistributed in derivative "
                f"form but is licensed '{entry.get('license')}', which a CC BY 4.0 compilation "
                "cannot carry. Stop and resolve the licence before exporting."
            )


def build_provenance(
    repo_root: Path,
    package_manifest: dict,
    palaeo_sources: dict,
    lgm_manifest: dict,
    restored_manifest: dict,
    data_manifest: dict,
    references: list[dict],
    modifications: list[dict],
    generated_utc: str,
) -> dict:
    by_id = {entry.get("sourceId"): entry for entry in palaeo_sources.get("sources", [])}

    cao2017 = by_id.get("cao-2017-paleogeography")
    if cao2017 is None:
        raise ExportError("data/corrections/palaeo-coastlines/sources.json has no cao-2017-paleogeography input")
    cao2024 = by_id.get("cao-v2.4-static-partitions")
    if cao2024 is None:
        raise ExportError("data/corrections/palaeo-coastlines/sources.json has no cao-v2.4-static-partitions input")

    frame = package_manifest.get("frame", {})
    etopo = lgm_manifest.get("source", {})
    ne_input = data_manifest.get("inputs", {}).get("natural-earth-observed-land-omission-50m", {})

    inputs = [
        {
            "sourceId": "cao-2017-paleogeography",
            "title": cao2017.get("title"),
            "citation": cao2017.get("citation"),
            "url": cao2017.get("url"),
            "publicationOrVersionDate": cao2017.get("publicationOrVersionDate"),
            "license": cao2017.get("license"),
            "attribution": cao2017.get("attribution"),
            "retrievedAt": cao2017.get("retrievedAt"),
            "temporalRangeMa": cao2017.get("temporalRangeMa"),
            "geographicBasis": cao2017.get("geographicBasis"),
            "archive": cao2017.get("archive"),
            "members": cao2017.get("members"),
            "excludedFromEveryBuild": cao2017.get("excludedFromEveryBuild"),
            "modificationStatement": cao2017.get("modificationStatement"),
            "role": "the landmass, shallow-marine and mountain polygons every EHPR payload derives from",
            "redistributedInThisArchive": True,
        },
        {
            "sourceId": "matthews-2016-plate-boundaries",
            "title": by_id.get("matthews-2016-plate-boundaries", {}).get("title"),
            "citation": by_id.get("matthews-2016-plate-boundaries", {}).get("citation"),
            "url": by_id.get("matthews-2016-plate-boundaries", {}).get("url"),
            "license": by_id.get("matthews-2016-plate-boundaries", {}).get("license"),
            "retrievedAt": by_id.get("matthews-2016-plate-boundaries", {}).get("retrievedAt"),
            "role": "citation requirement of the Cao 2017 package README; no Matthews rotation is loaded or redistributed",
            "redistributedInThisArchive": False,
        },
        {
            "sourceId": "cao-v2.4-static-partitions",
            "title": cao2024.get("title"),
            "citation": cao2024.get("citation"),
            "url": cao2024.get("url"),
            "publicationOrVersionDate": cao2024.get("publicationOrVersionDate"),
            "license": cao2024.get("license"),
            "attribution": cao2024.get("attribution"),
            "retrievedAt": cao2024.get("retrievedAt"),
            "geographicBasis": cao2024.get("geographicBasis"),
            "members": cao2024.get("members"),
            "packageId": package_manifest.get("packageId"),
            "packageRevision": package_manifest.get("revision"),
            "modelId": frame.get("modelId"),
            "modelVersion": frame.get("modelVersion"),
            "rotationSha256": frame.get("rotationSha256"),
            "topologySha256": frame.get("topologySha256"),
            "role": "present-day cookie-cut partitions that cut every piece, and the rotation model every piece is posed by",
            "redistributedInThisArchive": True,
        },
        {
            "sourceId": "cao-v2.4-motion-palette",
            "title": by_id.get("cao-v2.4-motion-palette", {}).get("title"),
            "citation": by_id.get("cao-v2.4-motion-palette", {}).get("citation"),
            "license": by_id.get("cao-v2.4-motion-palette", {}).get("license"),
            "sha256": by_id.get("cao-v2.4-motion-palette", {}).get("sha256"),
            "bytes": by_id.get("cao-v2.4-motion-palette", {}).get("bytes"),
            "retrievedAt": by_id.get("cao-v2.4-motion-palette", {}).get("retrievedAt"),
            "role": "the palette entry ids a catalog binding resolves against; derived from Cao et al. (2024), not shipped in this archive",
            "redistributedInThisArchive": False,
        },
        {
            "sourceId": "noaa-etopo-2022",
            "title": "ETOPO 2022 Global Relief Model, v1 60 arc-second surface",
            "citation": etopo.get("attribution"),
            "url": etopo.get("record"),
            "license": "public domain (NOAA / US Government work); attribution requested",
            "product": etopo.get("product"),
            "service": etopo.get("service"),
            "crops": [
                {
                    "id": crop.get("id"),
                    "bounds": crop.get("bounds"),
                    "width": crop.get("width"),
                    "height": crop.get("height"),
                    "sha256": crop.get("sha256"),
                    "bytes": crop.get("bytes"),
                    "retrievedUtc": crop.get("retrievedUtc"),
                }
                for crop in etopo.get("crops", [])
            ],
            "role": "the surface the LGM lowstand -120 m contour is taken from; no raster is redistributed, only the derived rings",
            "redistributedInThisArchive": True,
        },
        {
            "sourceId": "natural-earth-countries-50m",
            "title": "Natural Earth 1:50m Admin 0 Countries, version 5.1.1",
            "citation": "Natural Earth 2022. 1:50m Cultural Vectors, Admin 0 - Countries, version 5.1.1. Public domain.",
            "url": "https://www.naturalearthdata.com/downloads/50m-cultural-vectors/50m-admin-0-countries-2/",
            "license": "public domain",
            "sha256": ne_input.get("sha256"),
            "bytes": ne_input.get("bytes"),
            "role": (
                "present-day land, indirectly: the observed-land omission correction derives from this "
                "archive and is part of the drawn 0 Ma land subtracted from the LGM -120 m mask. No "
                "Natural Earth geometry ships in this archive."
            ),
            "redistributedInThisArchive": False,
        },
        {
            "sourceId": "palaeo-coastlines-cao2017-audit-v1",
            "title": by_id.get("palaeo-coastlines-cao2017-audit-v1", {}).get("title"),
            "citation": by_id.get("palaeo-coastlines-cao2017-audit-v1", {}).get("citation"),
            "license": by_id.get("palaeo-coastlines-cao2017-audit-v1", {}).get("license"),
            "retrievedAt": by_id.get("palaeo-coastlines-cao2017-audit-v1", {}).get("retrievedAt"),
            "role": "the measurements the override table, the one-owner rule and the simplification budget rest on",
            "redistributedInThisArchive": False,
        },
        {
            "sourceId": "earthhistory-north-sea-restoration-v1",
            "title": by_id.get("earthhistory-north-sea-restoration-v1", {}).get("title"),
            "citation": by_id.get("earthhistory-north-sea-restoration-v1", {}).get("citation"),
            "license": by_id.get("earthhistory-north-sea-restoration-v1", {}).get("license"),
            "retrievedAt": by_id.get("earthhistory-north-sea-restoration-v1", {}).get("retrievedAt"),
            "role": "the restoration palette entries pieces on partitions 303 and 315 bind to inside the window",
            "redistributedInThisArchive": False,
        },
        {
            "sourceId": restored_manifest.get("correctionId"),
            "title": restored_manifest.get("description"),
            "citation": "EarthHistory restored pre-collision margin correction contract",
            "license": "EarthHistory",
            "version": restored_manifest.get("version"),
            "role": "the restored-margin geometry drawn as shallow marine while the realistic layer is on",
            "redistributedInThisArchive": False,
        },
    ]

    licence_gate(inputs)

    return {
        "datasetId": DATASET_ID,
        "datasetVersion": DATASET_VERSION,
        "generatedUtc": generated_utc,
        "generator": "scripts/research/export_earthhistory_palaeogeography.py",
        "compilationLicense": "CC BY 4.0",
        "frame": {
            "presentDaySourceFrame": "WGS84 (GCS_WGS_1984); the Cao 2017 polygons are present-day geometry",
            "reconstructionModel": frame,
            "note": (
                "Every ring in this dataset is present-day geometry. A piece reaches a palaeo-position "
                "only through the Cao et al. (2024) v2.4 rotation model named above. Coordinates from an "
                "incompatible plate model must not be mixed in without a documented conversion."
            ),
        },
        "inputs": inputs,
        "modifications": modifications,
        "references": references,
    }


# ---------------------------------------------------------------------------
# Documents
# ---------------------------------------------------------------------------


def render_readme(app_version: str, schedule: list[dict], counts: dict, frame: dict) -> str:
    interval_ids = ", ".join(row["id"] for row in schedule if not row["detached"])
    return f"""# EarthHistory palaeogeography {DATASET_VERSION}

A citable snapshot of the palaeo-coastline layer EarthHistory {app_version} ships:
{EXPECTED_BATCH_RECORDS} ring payloads (three surface classes × {EXPECTED_INTERVALS} map states), their
class catalogs, the country-outline tone tables, and every tracked contract that
defines an EarthHistory modification of the source data.

The dataset is a **modified derivative of Cao et al. (2017)**. It is not the
authors' own product, and it is not reconstructed with the rotations they used.
Read `LICENSE.md` for the attribution and modification statement, and
`PROVENANCE.json` for every input, digest and retrieval date.

## What is in the archive

| Path | Holds |
|---|---|
| `manifest.json` | dataset identity, the {EXPECTED_BATCH_RECORDS} batch records, the class catalog index, the reservation, the schedule and a digest for every member |
| `palaeo-coastlines/<class>/palaeo-<class>-<interval>.ehpr` | one surface class of one map state: pieces, rings, quantised vertices |
| `palaeo-coastlines/<class>/palaeo-<class>-catalog.json` | the interned tables a piece's indices resolve into |
| `palaeo-coastlines/outline-tones.ehpt` / `.json` | modern-country outline tone tables, two bits per reference segment |
| `contracts/palaeo-coastlines/` | the basin edit contracts, the plate-id override table, the simplification budget, the LGM contract and the pinned source manifest |
| `corrections/restored-margins/` | the restored pre-collision margin correction and the batch/catalog rows it ships as |
| `PROVENANCE.json`, `CITATION.cff`, `LICENSE.md` | inputs and digests, citation, licence and attribution |

Every member's sha256 is in `manifest.json`. The `.ehpr` digests are the same
values the application's own package manifest publishes, and the exporter
refuses to write an archive when a shipped payload and its published digest
disagree.

## EHPR v1 rings

All integers and floats are little-endian; the file is four consecutive sections
with no padding.

**Header, 32 bytes:** magic `EHPR` (4 bytes), `version` u16 = 1, `headerBytes`
u16 = 32, `pieceCount` u32, `ringCount` u32, `vertexCount` u32, `classCode` u16
(1 `lm`, 2 `sm`, 3 `m`), `intervalIndex` u16 (0 = oldest … 24 = `lgm`),
`fromAgeMa` f32, `toAgeMa` f32.

**Piece table, 12 bytes per piece,** from offset 32: `chartIndex` u16 (the
ordinal of the Cao 2017 source record the piece was cut from), `bindingIndex`
u16 into `catalog.bindings`, `evidenceIndex` u16 into `catalog.evidence`,
`lifecycleIndex` u16 into `catalog.lifecycles`, `flags` u16, `ringCount` u16.

**Flags:** bit 1 frame conflict (more than 250 km from the piece's own
`PLATEID1` position at the interval mid-age); bit 2 bound by the source
`PLATEID1` override rather than by the owner partition; bit 4 bound to a North
Sea restoration palette entry; bit 8 the source record is off the published
24-interval schedule; bit 16 inside a protected basin window, never simplified;
bit 32 retained unsimplified because simplification would have lost or distorted
a component. Bits 1, 2, 4 and 8 each add a limitation line, given verbatim in
`catalog.flagLimitations`, to whatever the piece's evidence record already says.

**Ring table, 2 bytes per ring:** vertex count in bits 0–14; bit 15 set marks an
interior ring (hole). Rings are consumed in order and each starts where the
previous ended. A ring's vertices are not repeated to close it. A hole belongs
to the most recent exterior ring in the same piece.

**Vertices, 4 bytes each:** longitude and latitude quantised to i16 over the
full sphere, in present-day WGS84.

A piece's ring records are the next `ringCount` entries after the pieces before
it, so a decoder carries one running cursor through both tables.

## The batch record

`manifest.json` publishes one spatial batch record per class per map state, in
the same record shape the application's native package batches use:

```json
{{
  "id": "palaeo-lm-94-81",
  "appearance": "palaeo-land",
  "surfaceClass": "lm",
  "interval": {{ "id": "94-81", "index": 16, "fromAgeMa": 94.0,
                "toAgeMa": 81.01, "detached": false }},
  "geometryAsset": {{ "url": "palaeo-coastlines/lm/palaeo-lm-94-81.ehpr",
                     "bytes": 142358, "sha256": "…" }},
  "encoding": "ehpr-v1-i16lonlat-rings",
  "ringCount": 1317,
  "vertexCount": 31554,
  "charts": {{ "records": 1123, "bindings": 761, "evidence": 23, "lifecycles": 67 }}
}}
```

`charts` names the interned columns: how many chart records this batch draws, and
the sizes of the `bindings`, `evidence` and `lifecycles` tables its indices
resolve into. A record's byte count is implied by its own counts —
`32 + 12·records + 2·ringCount + 4·vertexCount` — so a payload that does not
weigh what its record predicts is rejected before it is read.

An empty batch is legal and ships: the detached `lgm` state publishes a landmass
and no shallow sea or mountain at all, so its `sm` and `m` payloads are a bare
32-byte header with zero pieces, rings and vertices.

## Class semantics

`lm` landmass, `sm` shallow marine, `m` mountain. **These are map classes, not
depths or elevations.** A Cao 2017 map interval records the *minimum land and
maximum transgression mapped anywhere in that bin*, not a shoreline at one
moment: `sm` says "mapped as shallow sea somewhere inside this interval", never
"this many metres of water", and `lm` says "mapped as land", never "this many
metres above sea level". The source carries no surface elevation, no bathymetry
and no exposure state, and this dataset invents none.

A piece is drawn on its **own** `(TOAGE, FROMAGE]` lifecycle from
`catalog.lifecycles`, not on the interval of the file it ships in: an
off-schedule source record appears in every canonical interval it overlaps and
keeps its own lifecycle. Test the piece, not the file, before drawing it at a
requested age.

The 24 published intervals are {interval_ids} Ma.

## The LGM state

`lgm` is the one **detached** state, `(19.5 ka, 26.5 ka]`, two million years
younger than the whole Cao 2017 band with no map in between. **It is not Cao
geometry at all.** Its landmass payload is the ETOPO 2022 60 arc-second surface
at or above the −120 m eustatic datum inside three footprints (the southern and
central North Sea, the Sunda shelf and Beringia), vectorised on the source grid,
with the present-day drawn land subtracted so only the exposed shelf remains,
then cut by the same Cao 2024 static partitions and bound by the same rule. Its
shallow-marine payload is a header-only empty file, because a eustatic contour
says where land was and nothing about where a shallow sea was.

The method, the −120 m datum's citation, its eight limitations (eustatic only;
no glacio-isostatic adjustment; ice sheets are not drawn; modern bathymetry;
regional footprints only) and its references are in
`contracts/palaeo-coastlines/lgm/lgm-lowstand-v1.manifest.json`. Do not merge
the LGM state into the Cao interval series: it is a different source, a
different method and a different age frame.

## Hard dependency: the rotation model

Every ring in this dataset is **present-day geometry**. Nothing here is
pre-reconstructed. A piece reaches a palaeo-position only through the
Cao et al. (2024) plate model, version {frame.get("modelVersion")}, in its
{frame.get("absoluteFrameId")} absolute frame anchored to plate
{frame.get("anchorPlateId")}, with GPlates Cartesian axes
(`{frame.get("axisConvention")}`), rotation file sha256
`{frame.get("rotationSha256")}` and topology sha256
`{frame.get("topologySha256")}`. Without that model and its present-day static
partitions this dataset is a set of present-day polygons and nothing more.

Coordinates from an incompatible plate model must not be mixed in without a
documented conversion.

## How a consumer poses a piece

1. **Binding.** Read the piece's `bindingIndex` and look it up in
   `catalog.bindings`: it names a `bindingPlateId`, the `partitionPlateId` that
   owns the piece, the binding `kind` (`partition`, `override`, `restoration` or
   `recovery`) and a `gapSet` of ages at which that binding has no motion.
2. **Palette entry.** Resolve the binding plate to one motion-palette entry at
   the requested age by the normative `palaeo-binding-entry-v1` rule recorded in
   `catalog.entrySelection`: a North Sea restoration entry first, then the
   recovery plates that never fall back to native motion, then
   `correction-plate-` entries at and above 410 Ma, then the native chain. A
   piece the rule cannot pose is **not drawn**; its state is `missing-motion`,
   which is a statement about the model, not about what failed to load.
3. **Rotation.** Apply that entry's finite rotation for the requested age to the
   piece's present-day vertices. The palette is derived from the Cao et al.
   (2024) rotation file named above; a consumer without the palette can compute
   the same rotation directly from that file for the binding plate.

The reference implementation is the application's own loader:
`src/reconstruction/palaeoCoastlines/` decodes the payloads in a worker, and
`src/reconstruction/palaeoBindingEntry.ts` implements the entry-selection rule.

## Simplification, seams and drops

Node counts are reduced by Douglas–Peucker under the budget in
`contracts/palaeo-coastlines/simplification.json`. Because each cut piece is
reduced on its own, the two copies of a shared edge would separate; each piece is
therefore grown back across its seams and clipped to the record it came from, so
neighbours overlap instead of gapping. The overlap is the same ground counted
twice and is declared per interval in the class catalogs. A piece whose binding
would carry it more than 1,000 km from its own `PLATEID1` position at the
interval mid-age is dropped rather than drawn; the 250 km flag marks the pieces
that remain.

Measured in this archive: {counts.get('piecesTotal')} pieces,
{counts.get('frameConflictFlagged')} of them frame-conflict flagged,
{counts.get('boundByPlateIdOverride')} bound by a `PLATEID1` override,
{counts.get('boundToNorthSeaRestoration')} bound to a North Sea restoration
entry, {counts.get('offPublishedSchedule')} from off-schedule source records,
{counts.get('protectedBasinWindow')} inside a protected basin window and
{counts.get('retainedUnsimplified')} retained unsimplified.

## Basin edits

`contracts/palaeo-coastlines/basins/*.json` are the five pinned basin edit
contracts. Each names its window, the intervals and classes it touches, its
editorial statement, its operations and its literature references with the claim
each source constrains and whether the drawn result is the source's claim or
EarthHistory's inference. A basin operation is an EarthHistory modification of
Cao 2017, never a Cao 2017 statement.

## Verifying this archive

Re-hash every member against `manifest.json`:

    python3 export_earthhistory_palaeogeography.py --verify {ARCHIVE_STEM}.tar.gz

The `.sha256` sidecar beside the archive covers the archive file itself.
"""


def render_citation(app_version: str, generated_utc: str) -> str:
    date = generated_utc[:10]
    return f"""cff-version: 1.2.0
message: >-
  If you use this dataset, please cite it, and cite Cao et al. 2017 and
  Cao et al. 2024 alongside it. This dataset is a modified derivative of the
  Cao et al. (2017) palaeogeography package and cannot be used without the
  Cao et al. (2024) v2.4 plate model.
title: "{DATASET_TITLE}"
abstract: >-
  The Cao et al. (2017) landmass, shallow-marine and mountain map classes of the
  24 published map intervals, cut by the present-day Cao et al. (2024) v2.4
  static partitions, bound one piece to one plate, node-reduced and encoded as
  EHPR v1 ring payloads, together with a detached Last Glacial Maximum lowstand
  state derived from ETOPO 2022, the class catalogs, the modern-country outline
  tone tables and every tracked contract that defines an EarthHistory
  modification.
type: dataset
version: "{DATASET_VERSION}"
date-released: "{date}"
license: CC-BY-4.0
authors:
  - name: "EarthHistory"
keywords:
  - palaeogeography
  - palaeo-coastlines
  - plate reconstruction
  - Phanerozoic
  - Last Glacial Maximum
identifiers:
  - type: other
    value: "{DATASET_ID}-{DATASET_VERSION}"
    description: dataset identifier
  - type: other
    value: "EarthHistory {app_version}"
    description: the application version this dataset ships with
references:
  - type: article
    title: "Improving global paleogeography since the late Paleozoic using paleobiology"
    authors:
      - family-names: Cao
        given-names: Xianzhi
      - family-names: Zahirovic
        given-names: Sabin
      - family-names: Flament
        given-names: Nicolas
      - family-names: Williams
        given-names: Simon
      - family-names: Golonka
        given-names: Jan
      - family-names: Muller
        given-names: R. Dietmar
    year: 2017
    journal: Biogeosciences
    volume: 14
    start: 5425
    end: 5439
    doi: 10.5194/bg-14-5425-2017
    notes: >-
      The source of every landmass, shallow-marine and mountain polygon in this
      dataset. Its package README also requires citing Matthews et al. (2016),
      doi:10.1016/j.gloplacha.2016.10.002.
  - type: data
    title: >-
      Earth's tectonic and plate boundary evolution over 1.8 billion years,
      model v2.4
    authors:
      - family-names: Cao
        given-names: Xianzhi
    year: 2024
    doi: 10.5281/zenodo.13628813
    notes: >-
      The static partitions every piece is cut by and the rotation model every
      piece is posed with. This dataset cannot be reconstructed without it.
  - type: article
    title: "Global plate boundary evolution and kinematics since the late Paleozoic"
    authors:
      - family-names: Matthews
        given-names: Kara J.
    year: 2016
    journal: Global and Planetary Change
    volume: 146
    start: 226
    end: 250
    doi: 10.1016/j.gloplacha.2016.10.002
    notes: Required by the Cao et al. (2017) package README.
  - type: data
    title: "ETOPO 2022 Global Relief Model"
    authors:
      - name: "NOAA National Centers for Environmental Information"
    year: 2022
    doi: 10.25921/fd45-gt74
    notes: The surface the detached Last Glacial Maximum lowstand state is derived from.
"""


def render_license(app_version: str) -> str:
    return f"""# Licence and attribution

## This compilation

The **{DATASET_TITLE}** compilation — the EHPR encoding, the class catalogs, the
batch records, the tone tables, the contracts, the documentation and the
arrangement of all of them — is released by EarthHistory under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

Attribute it as: *EarthHistory palaeogeography {DATASET_VERSION}
(EarthHistory {app_version}), CC BY 4.0*, and cite the sources below alongside
it. `CITATION.cff` carries the machine-readable form.

The compilation licence does not, and cannot, weaken the terms of the sources.
Each source's own terms are reproduced verbatim from the EarthHistory
`THIRD_PARTY_NOTICES.md` below.

## Sources

- {NOTICE_CAO_2017}
  EarthHistory, for the palaeo-coastline layer, redistributes the landmass,
  shallow-marine and mountain polygons of the 24 published map intervals as a
  modified derivative. {NOTICE_CAO_2017_MODIFICATION} The polygons are not
  reconstructed with the Matthews et al. (2016) rotations the authors used.
  {NOTICE_CAO_2017_LIMITATION}

  *CC BY 3.0 permits the distribution of an adaptation under a different
  licence, provided the original is attributed and the modifications are
  identified. This compilation does both, above, and is itself CC BY 4.0. No
  additional restriction is placed on the original material.*

- {NOTICE_CAO_2024}
  EarthHistory derives triangulated model geography, sampled rotations, exact
  resolved topology and typed directed boundaries from the palaeomagnetic
  reconstruction anchored to plate 0. In this dataset the model supplies the
  present-day static partitions every piece is cut by and the rotations every
  piece is posed with. Geometry refinement, compact encoding, motion
  interpolation and reference binding are EarthHistory processing. The data
  license is separate from GPlates/pyGPlates software licenses.

- {NOTICE_ETOPO}
  In this dataset the product is the source of the detached Last Glacial
  Maximum lowstand state: the −120 m contour of 1 arc-minute crops, vectorised
  on the source grid, simplified and cut by the Cao 2024 static partitions. No
  ETOPO raster is redistributed; only the derived rings ship.

- {NOTICE_NATURAL_EARTH}
  EarthHistory subdivides and binds present-day reference lines to Cao plate
  coordinates offline, retaining ambiguity and validity limitations. These
  reference lines do not represent historical political borders. In this dataset
  the archive reaches the data only indirectly, through the observed-land
  omission correction subtracted from the Last Glacial Maximum mask; no Natural
  Earth geometry ships here. The country-outline tone tables index the
  application's own reference segments and carry no Natural Earth geometry.

## Not included

The research-only Cao 2017 GitHub snapshot (commit `e92592aa`, for which GitHub
reports no repository licence) and the supplement raster maps are not inputs to
this dataset and are not redistributed. The offline provenance sidecars, which
carry the per-source-record compile measurements, stay in the owned offline
store and are not part of this archive.
"""


# ---------------------------------------------------------------------------
# Collection
# ---------------------------------------------------------------------------


class Dataset:
    def __init__(self, members: list[Member], manifest: dict) -> None:
        self.members = members
        self.manifest = manifest


def collect(repo_root: Path, generated_utc: str) -> Dataset:
    package_dir = repo_root / PACKAGE_RELATIVE
    package_manifest = read_json(package_dir / "manifest.json")
    if not isinstance(package_manifest, dict):
        raise ExportError("the package manifest is not an object")

    palaeo = package_manifest.get("palaeoCoastlines")
    if not isinstance(palaeo, dict):
        raise ExportError("the package manifest has no palaeoCoastlines section")

    assert_notice_fragments(repo_root)

    app_package = read_json(repo_root / PACKAGE_JSON)
    app_version = app_package.get("version")
    if not isinstance(app_version, str) or not app_version:
        raise ExportError("package.json declares no application version")

    # --- batch records -----------------------------------------------------
    batches = palaeo.get("realisticBatches")
    if not isinstance(batches, list):
        raise ExportError("palaeoCoastlines.realisticBatches is not a list")
    if len(batches) != EXPECTED_BATCH_RECORDS:
        raise ExportError(
            f"palaeoCoastlines.realisticBatches holds {len(batches)} records; this dataset is "
            f"{len(EXPECTED_CLASSES)} classes × {EXPECTED_INTERVALS} map states = "
            f"{EXPECTED_BATCH_RECORDS}. A record count mismatch means the package and the dataset "
            "disagree about what ships."
        )

    members: list[Member] = []
    flag_counts = {name: 0 for name in PIECE_FLAGS.values()}
    flag_counts["piecesTotal"] = 0
    per_class_pieces = {name: 0 for name in EXPECTED_CLASSES}
    schedule_rows: dict[str, dict] = {}
    seen_ids: set[str] = set()
    seen_pairs: set[tuple[str, str]] = set()

    for record in batches:
        batch_id = record.get("id")
        surface_class = record.get("surfaceClass")
        interval = record.get("interval") or {}
        if batch_id in seen_ids:
            raise ExportError(f"duplicate batch record id {batch_id}")
        seen_ids.add(batch_id)
        if surface_class not in EXPECTED_CLASSES:
            raise ExportError(f"{batch_id}: unknown surface class {surface_class!r}")
        pair = (surface_class, interval.get("id"))
        if pair in seen_pairs:
            raise ExportError(f"two batch records for class {pair[0]} interval {pair[1]}")
        seen_pairs.add(pair)

        payload = verified_asset(package_dir, record.get("geometryAsset") or {}, f"batch {batch_id}")
        counts = decode_ehpr_flags(payload, f"batch {batch_id}")
        flag_counts["piecesTotal"] += counts["pieces"]
        per_class_pieces[surface_class] += counts["pieces"]
        for name in PIECE_FLAGS.values():
            flag_counts[name] += counts[name]

        members.append(Member(record["geometryAsset"]["url"], payload, f"{surface_class} ring payload"))

        row = {
            "id": interval.get("id"),
            "index": interval.get("index"),
            "fromAgeMa": interval.get("fromAgeMa"),
            "toAgeMa": interval.get("toAgeMa"),
            "detached": bool(interval.get("detached")),
        }
        existing = schedule_rows.setdefault(row["id"], row)
        if existing != row:
            raise ExportError(
                f"interval {row['id']} is described differently by two classes: {existing} vs {row}"
            )

    if len(schedule_rows) != EXPECTED_INTERVALS:
        raise ExportError(
            f"the batch records describe {len(schedule_rows)} map states, not {EXPECTED_INTERVALS}"
        )
    schedule = sorted(schedule_rows.values(), key=lambda row: row["index"])
    if [row["index"] for row in schedule] != list(range(EXPECTED_INTERVALS)):
        raise ExportError("the schedule indices are not a dense 0..n range")

    # --- class catalogs ----------------------------------------------------
    classes = palaeo.get("classes")
    if not isinstance(classes, list) or len(classes) != len(EXPECTED_CLASSES):
        raise ExportError(f"palaeoCoastlines.classes must hold {len(EXPECTED_CLASSES)} entries")
    catalogs: dict[str, dict] = {}
    for entry in classes:
        surface_class = entry.get("surfaceClass")
        if surface_class not in EXPECTED_CLASSES:
            raise ExportError(f"unknown class entry {surface_class!r}")
        payload = verified_asset(package_dir, entry.get("catalog") or {}, f"class catalog {surface_class}")
        members.append(Member(entry["catalog"]["url"], payload, f"{surface_class} class catalog"))
        catalogs[surface_class] = json.loads(payload.decode("utf-8"))

    # --- outline tones -----------------------------------------------------
    tones = palaeo.get("outlineTones") or {}
    for key, role in (("binary", "country-outline tone tables"), ("catalog", "country-outline tone catalog")):
        asset = tones.get(key)
        if not isinstance(asset, dict):
            raise ExportError(f"palaeoCoastlines.outlineTones.{key} is missing")
        payload = verified_asset(package_dir, asset, role)
        members.append(Member(asset["url"], payload, role))

    # --- contracts ---------------------------------------------------------
    contracts_for_references: list[tuple[str, dict]] = []

    basin_documents: list[dict] = []
    for path in tracked_files(repo_root, BASIN_CONTRACT_DIR):
        payload = path.read_bytes()
        archive_path = f"contracts/palaeo-coastlines/basins/{path.name}"
        members.append(Member(archive_path, payload, "basin edit contract"))
        document = json.loads(payload.decode("utf-8"))
        basin_documents.append(document)
        contracts_for_references.append((archive_path, document))
    if not basin_documents:
        raise ExportError("no basin edit contracts were found")

    palaeo_sources: dict = {}
    for relative in PALAEO_CONTRACT_FILES:
        path = repo_root / relative
        if not path.is_file():
            raise ExportError(f"missing contract: {relative}")
        payload = path.read_bytes()
        archive_path = f"contracts/palaeo-coastlines/{path.name}"
        members.append(Member(archive_path, payload, "palaeo-coastline contract"))
        if path.name == "sources.json":
            palaeo_sources = json.loads(payload.decode("utf-8"))

    lgm_manifest: dict = {}
    for path in tracked_files(repo_root, LGM_CONTRACT_DIR):
        payload = path.read_bytes()
        archive_path = f"contracts/palaeo-coastlines/lgm/{path.name}"
        members.append(Member(archive_path, payload, "LGM lowstand contract"))
        if path.name.endswith(".manifest.json"):
            lgm_manifest = json.loads(payload.decode("utf-8"))
            contracts_for_references.append((archive_path, lgm_manifest))
    if not lgm_manifest:
        raise ExportError("the LGM contract directory has no manifest")

    restored_manifest: dict = {}
    restored_files = 0
    for path in tracked_files(repo_root, RESTORED_MARGINS_DIR):
        payload = path.read_bytes()
        archive_path = f"corrections/restored-margins/{path.name}"
        members.append(Member(archive_path, payload, "restored pre-collision margin correction"))
        restored_files += 1
        if path.name.endswith("-manifest.json"):
            restored_manifest = json.loads(payload.decode("utf-8"))
            contracts_for_references.append((archive_path, restored_manifest))
    if not restored_manifest:
        raise ExportError("the restored-margins directory has no manifest")

    # The rows the restored margin ships as in the application package, so a
    # consumer can align the correction with the batch it is drawn from.
    correction_catalog_asset = (package_manifest.get("materialCorrections") or {}).get("catalog")
    if not isinstance(correction_catalog_asset, dict):
        raise ExportError("the package manifest has no materialCorrections catalog")
    correction_payload = verified_asset(package_dir, correction_catalog_asset, "material-correction catalog")
    correction_catalog = json.loads(correction_payload.decode("utf-8"))
    batch_rows = [
        row
        for row in correction_catalog.get("spatialBatches", [])
        if row.get("batchId") == RESTORED_MARGIN_BATCH_ID
    ]
    if len(batch_rows) != 1:
        raise ExportError(
            f"the material-correction catalog holds {len(batch_rows)} '{RESTORED_MARGIN_BATCH_ID}' "
            "batch rows; expected exactly one"
        )
    correction_id = restored_manifest.get("correctionId")
    if not isinstance(correction_id, str) or not correction_id:
        raise ExportError("the restored-margins manifest declares no correctionId")
    chart_rows = [
        row
        for row in correction_catalog.get("charts", [])
        if isinstance(row.get("chartId"), str) and correction_id in row["chartId"]
    ]
    restored_payload = verified_asset(
        package_dir, batch_rows[0].get("geometryAsset") or {}, "restored-margin batch payload"
    )
    members.append(
        Member(
            "corrections/restored-margins/restored-margin.ehgb",
            restored_payload,
            "restored pre-collision margin shipped batch payload",
        )
    )
    members.append(
        Member(
            "corrections/restored-margins/shipped-rows.json",
            json_bytes(
                {
                    "correctionId": correction_id,
                    "catalogId": correction_catalog.get("id"),
                    "catalogVersion": correction_catalog.get("version"),
                    "spatialBatch": batch_rows[0],
                    "charts": chart_rows,
                    "note": (
                        "The rows this correction ships as in the EarthHistory package. The batch "
                        "payload beside them is ehgb-v2 triangles, not EHPR rings; while the "
                        "realistic layer is on it is drawn as shallow marine."
                    ),
                }
            ),
            "restored pre-collision margin shipped batch/catalog rows",
        )
    )

    # --- references and modifications --------------------------------------
    references = resolve_references(repo_root, contracts_for_references)

    overrides = read_json(repo_root / PALAEO_CONTRACT_FILES[0])
    override_plate_count = sum(
        len(entry.get("plates", [])) for entry in (overrides.get("classes") or {}).values()
    )
    binding_kind_counts: dict[str, int] = {}
    total_bindings = 0
    total_source_records = 0
    for surface_class, catalog in catalogs.items():
        kinds = catalog.get("bindingKinds") or []
        kind_column = (catalog.get("bindings") or {}).get("kind") or []
        total_bindings += len(kind_column)
        total_source_records += int(catalog.get("chartCount") or 0)
        for value in kind_column:
            name = kinds[value] if isinstance(value, int) and value < len(kinds) else str(value)
            binding_kind_counts[name] = binding_kind_counts.get(name, 0) + 1

    basin_ops = sum(len(document.get("ops", []) or []) for document in basin_documents)
    simplification = read_json(repo_root / PALAEO_CONTRACT_FILES[1])

    modifications = [
        {
            "type": "cut",
            "what": "every present-day Cao 2017 source record is cookie-cut by the present-day Cao 2024 v2.4 static partitions",
            "sourceRecords": total_source_records,
            "piecesEmitted": flag_counts["piecesTotal"],
            "piecesPerClass": per_class_pieces,
        },
        {
            "type": "bind",
            "what": "each cut piece is given exactly one owning plate and rides it",
            "bindingRows": total_bindings,
            "bindingRowsByKind": binding_kind_counts,
            "piecesBoundToNorthSeaRestoration": flag_counts["boundToNorthSeaRestoration"],
        },
        {
            "type": "override",
            "what": "a piece whose own PLATEID1 has an override entry, and whose centroid and half its area lie inside that plate's declared footprint, is rebound to PLATEID1 instead of to the partition owner",
            "overridePlateEntries": override_plate_count,
            "piecesBoundByOverride": flag_counts["boundByPlateIdOverride"],
        },
        {
            "type": "drop",
            "what": "a piece the binding would carry more than 1,000 km from its own PLATEID1 position at the interval mid-age is dropped and never drawn; the 250 km flag marks the pieces that remain",
            "piecesFrameConflictFlagged": flag_counts["frameConflictFlagged"],
            "piecesDropped": None,
            "piecesDroppedNote": (
                "the dropped pieces and their area are measured by the compiler into the offline "
                "provenance sidecar, which does not ship with the application or with this archive; "
                "a dropped piece is absent from the payloads and cannot be counted from them"
            ),
        },
        {
            "type": "simplify",
            "what": "node counts are reduced by Douglas-Peucker under the tracked budget, and each piece is grown back across its cut seams and clipped to its source record so neighbours overlap instead of gapping",
            "method": simplification.get("method"),
            "seamBufferKilometres": simplification.get("seamBufferKilometres"),
            "vertexCapPerPiece": simplification.get("vertexCapPerPiece"),
            "piecesRetainedUnsimplified": flag_counts["retainedUnsimplified"],
            "piecesInProtectedBasinWindow": flag_counts["protectedBasinWindow"],
        },
        {
            "type": "basin ops",
            "what": "pinned regional edits inside a declared window, each with its literature references and its claim-or-inference statement",
            "contracts": len(basin_documents),
            "operations": basin_ops,
            "basins": sorted(document.get("basinId") for document in basin_documents),
        },
        {
            "type": "restored margins",
            "what": "restored pre-collision margin geometry drawn as shallow marine while the realistic layer is on",
            "contractFiles": restored_files,
            "features": len(restored_manifest.get("features", []) or []),
            "shippedBatches": 1,
            "shippedChartRows": len(chart_rows),
        },
        {
            "type": "LGM",
            "what": "a detached Last Glacial Maximum lowstand state that is not Cao geometry: the ETOPO 2022 -120 m eustatic contour inside three footprints, with the present-day drawn land subtracted",
            "intervalId": lgm_manifest.get("intervalId"),
            "oldestMa": lgm_manifest.get("oldestMa"),
            "youngestExclusiveMa": lgm_manifest.get("youngestExclusiveMa"),
            "methodId": (lgm_manifest.get("method") or {}).get("id"),
            "limitations": len(lgm_manifest.get("limitations", []) or []),
            "originatesFromCao2017": False,
        },
        {
            "type": "off-schedule lifecycle",
            "what": "the published FROMAGE/TOAGE map interval becomes a half-open (TOAGE, FROMAGE] lifecycle, so an off-schedule source record appears in every canonical interval it overlaps and keeps its own lifecycle",
            "piecesOffPublishedSchedule": flag_counts["offPublishedSchedule"],
        },
    ]

    data_manifest = read_json(repo_root / DATA_MANIFEST)
    provenance = build_provenance(
        repo_root,
        package_manifest,
        palaeo_sources,
        lgm_manifest,
        restored_manifest,
        data_manifest,
        references,
        modifications,
        generated_utc,
    )

    frame = package_manifest.get("frame", {})
    readme = render_readme(app_version, schedule, flag_counts, frame)
    citation = render_citation(app_version, generated_utc)
    licence = render_license(app_version)

    members.append(Member("PROVENANCE.json", json_bytes(provenance), "provenance manifest"))
    members.append(Member("README.md", readme.encode("utf-8"), "schema and method"))
    members.append(Member("CITATION.cff", citation.encode("utf-8"), "citation"))
    members.append(Member("LICENSE.md", licence.encode("utf-8"), "licence and attribution"))

    members.sort(key=lambda member: member.path)

    manifest = {
        "datasetId": DATASET_ID,
        "datasetVersion": DATASET_VERSION,
        "title": DATASET_TITLE,
        "appVersion": app_version,
        "generatedUtc": generated_utc,
        "generator": "scripts/research/export_earthhistory_palaeogeography.py",
        "license": "CC BY 4.0 (compilation); see LICENSE.md for every source's own terms",
        "sourcePackage": {
            "packageId": package_manifest.get("packageId"),
            "revision": package_manifest.get("revision"),
            "schemaVersion": package_manifest.get("schemaVersion"),
            "palaeoCoastlinesId": palaeo.get("id"),
            "ageDomainMa": palaeo.get("ageDomainMa"),
        },
        "frame": frame,
        "classes": [
            {
                "surfaceClass": surface_class,
                "className": CLASS_NAMES[surface_class],
                "catalogId": catalogs[surface_class].get("catalogId"),
                "appearance": catalogs[surface_class].get("appearance"),
                "sourceRecords": catalogs[surface_class].get("chartCount"),
                "detachedIntervalIds": catalogs[surface_class].get("detachedIntervalIds"),
                "catalog": next(
                    entry["catalog"] for entry in classes if entry["surfaceClass"] == surface_class
                ),
            }
            for surface_class in EXPECTED_CLASSES
        ],
        "outlineTones": tones,
        "reservation": palaeo.get("reservation"),
        "schedule": schedule,
        "realisticBatches": batches,
        "members": [member.record() for member in members],
    }

    manifest_member = Member("manifest.json", json_bytes(manifest), "dataset manifest")
    members.insert(0, manifest_member)
    return Dataset(members, manifest)


# ---------------------------------------------------------------------------
# Archive I/O
# ---------------------------------------------------------------------------


def write_archive(dataset: Dataset, out_dir: Path) -> tuple[Path, Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    archive_path = out_dir / f"{ARCHIVE_STEM}.tar.gz"
    sidecar_path = out_dir / f"{ARCHIVE_STEM}.tar.gz.sha256"

    raw = io.BytesIO()
    with tarfile.open(fileobj=raw, mode="w") as tar:
        for member in dataset.members:
            info = tarfile.TarInfo(f"{ARCHIVE_STEM}/{member.path}")
            info.size = member.bytes
            info.mode = 0o644
            info.mtime = 0
            info.uid = 0
            info.gid = 0
            info.uname = ""
            info.gname = ""
            tar.addfile(info, io.BytesIO(member.payload))

    with archive_path.open("wb") as handle:
        with gzip.GzipFile(fileobj=handle, mode="wb", compresslevel=9, mtime=0) as gz:
            gz.write(raw.getvalue())

    digest = sha256_file(archive_path)
    sidecar_path.write_text(f"{digest}  {archive_path.name}\n", encoding="utf-8")
    return archive_path, sidecar_path


def verify_archive(archive_path: Path) -> dict:
    if not archive_path.is_file():
        raise ExportError(f"no such archive: {archive_path}")
    payloads: dict[str, bytes] = {}
    with tarfile.open(archive_path, "r:gz") as tar:
        for info in tar.getmembers():
            if not info.isfile():
                continue
            prefix, _, relative = info.name.partition("/")
            if not relative:
                raise ExportError(f"archive member outside the dataset directory: {info.name}")
            if prefix != ARCHIVE_STEM:
                raise ExportError(f"unexpected archive root {prefix!r} in {info.name}")
            handle = tar.extractfile(info)
            if handle is None:
                raise ExportError(f"unreadable archive member: {info.name}")
            payloads[relative] = handle.read()

    if "manifest.json" not in payloads:
        raise ExportError("the archive has no manifest.json")
    manifest = json.loads(payloads["manifest.json"].decode("utf-8"))
    records = manifest.get("members")
    if not isinstance(records, list) or not records:
        raise ExportError("the archive manifest declares no members")

    declared = {record["path"] for record in records}
    present = set(payloads) - {"manifest.json"}
    missing = sorted(declared - present)
    extra = sorted(present - declared)
    if missing:
        raise ExportError(f"the archive is missing {len(missing)} declared member(s): {missing[:5]}")
    if extra:
        raise ExportError(f"the archive holds {len(extra)} undeclared member(s): {extra[:5]}")

    for record in records:
        payload = payloads[record["path"]]
        if len(payload) != record["bytes"]:
            raise ExportError(
                f"{record['path']}: {len(payload)} bytes in the archive, {record['bytes']} declared"
            )
        actual = sha256_bytes(payload)
        if actual != record["sha256"]:
            raise ExportError(f"{record['path']}: hashes to {actual}, manifest declares {record['sha256']}")

    sidecar = archive_path.with_name(archive_path.name + ".sha256")
    sidecar_state = "absent"
    if sidecar.is_file():
        expected = sidecar.read_text(encoding="utf-8").split()[0]
        actual = sha256_file(archive_path)
        if expected != actual:
            raise ExportError(f"the .sha256 sidecar declares {expected}, the archive hashes to {actual}")
        sidecar_state = "verified"

    return {
        "datasetId": manifest.get("datasetId"),
        "datasetVersion": manifest.get("datasetVersion"),
        "appVersion": manifest.get("appVersion"),
        "members": len(records) + 1,
        "batchRecords": len(manifest.get("realisticBatches", [])),
        "sidecar": sidecar_state,
        "sha256": sha256_file(archive_path),
        "bytes": archive_path.stat().st_size,
    }


# ---------------------------------------------------------------------------
# Self-test
# ---------------------------------------------------------------------------

SANDBOX_INPUTS = (
    PACKAGE_RELATIVE,
    Path("data/corrections/palaeo-coastlines"),
    RESTORED_MARGINS_DIR,
    SOURCES_TS,
    DATA_MANIFEST,
    THIRD_PARTY_NOTICES,
    PACKAGE_JSON,
)

# The package holds ~1,200 checkpoint/boundary/ownership files the exporter
# never reads; copying only what it does read keeps the self-test inside its
# five-second budget.
SANDBOX_PACKAGE_FILES = ("manifest.json",)
SANDBOX_PACKAGE_DIRS = ("palaeo-coastlines", "corrections")


def _make_sandbox(repo_root: Path, destination: Path) -> None:
    for relative in SANDBOX_INPUTS:
        source = repo_root / relative
        target = destination / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        if source.is_file():
            shutil.copy2(source, target)
        elif relative == PACKAGE_RELATIVE:
            target.mkdir(parents=True, exist_ok=True)
            for name in SANDBOX_PACKAGE_FILES:
                shutil.copy2(source / name, target / name)
            for name in SANDBOX_PACKAGE_DIRS:
                shutil.copytree(source / name, target / name)
        else:
            shutil.copytree(source, target, dirs_exist_ok=True)


def _rewrite_json(path: Path, mutate) -> None:
    document = json.loads(path.read_text(encoding="utf-8"))
    mutate(document)
    path.write_text(json.dumps(document), encoding="utf-8")


def self_test(repo_root: Path) -> int:
    generated = "2026-01-01T00:00:00Z"
    failures: list[str] = []

    with tempfile.TemporaryDirectory(prefix="ehpg-selftest-") as raw:
        sandbox_root = Path(raw)
        baseline = sandbox_root / "baseline"
        _make_sandbox(repo_root, baseline)
        try:
            collect(baseline, generated)
        except ExportError as error:
            print(f"FAIL  baseline: an unmutated copy of the tracked inputs was rejected: {error}")
            return 1
        print("pass  baseline: an unmutated copy of the tracked inputs exports")

        def tamper_payload(root: Path) -> str:
            target = root / PACKAGE_RELATIVE / "palaeo-coastlines/lm/palaeo-lm-94-81.ehpr"
            payload = bytearray(target.read_bytes())
            # Flip one coordinate bit deep in the vertex table.
            payload[-3] ^= 0x01
            target.write_bytes(bytes(payload))
            return "tampered payload sha256"

        def break_reference(root: Path) -> str:
            target = root / BASIN_CONTRACT_DIR / "western-interior.json"
            _rewrite_json(
                target,
                lambda document: document["references"].append(
                    {"sourceId": "self-test-unknown-source", "constrains": "nothing"}
                ),
            )
            return "basin reference that resolves nowhere"

        def drop_record(root: Path) -> str:
            target = root / PACKAGE_RELATIVE / "manifest.json"
            _rewrite_json(target, lambda document: document["palaeoCoastlines"]["realisticBatches"].pop())
            return "manifest batch-record count mismatch"

        cases = [tamper_payload, break_reference, drop_record]

        for index, mutate in enumerate(cases):
            case_root = sandbox_root / f"case{index}"
            _make_sandbox(repo_root, case_root)
            label = mutate(case_root)
            try:
                collect(case_root, generated)
            except ExportError as error:
                print(f"pass  {label}: rejected ({str(error)[:110]})")
                continue
            failures.append(label)
            print(f"FAIL  {label}: the export accepted it")

    if failures:
        print(f"self-test: {len(failures)} gate(s) did not fail on a deliberate mutation")
        return 1
    print(f"self-test: baseline exports and {len(cases)} deliberate mutations are each rejected")
    return 0


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def clean(out_dir: Path) -> int:
    if not out_dir.exists():
        print(f"clean: {out_dir} does not exist")
        return 0
    freed = sum(path.stat().st_size for path in out_dir.rglob("*") if path.is_file())
    shutil.rmtree(out_dir)
    print(f"clean: removed {out_dir} ({freed / 1024 / 1024:.2f} MiB)")
    return 0


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--repo-root", type=Path, default=REPO_ROOT, help="repository root (default: inferred)")
    parser.add_argument("--out-dir", type=Path, default=None, help="output directory (default: dev-docs/bench/out/dataset)")
    parser.add_argument("--verify", type=Path, metavar="ARCHIVE", help="re-hash every member of an archive against its manifest")
    parser.add_argument("--self-test", action="store_true", help="prove the export gates fail on deliberate mutations")
    parser.add_argument("--clean", action="store_true", help="remove the bounded output directory")
    parser.add_argument("--generated-utc", default=None, help="fix the generation timestamp (reproducible builds)")
    args = parser.parse_args(argv)

    repo_root = args.repo_root.resolve()
    out_dir = (args.out_dir or (repo_root / OUT_RELATIVE)).resolve()

    try:
        if args.clean:
            return clean(out_dir)
        if args.self_test:
            return self_test(repo_root)
        if args.verify is not None:
            summary = verify_archive(args.verify.resolve())
            print(
                f"verify: {summary['datasetId']} {summary['datasetVersion']} "
                f"(app {summary['appVersion']}), {summary['members']} members, "
                f"{summary['batchRecords']} batch records, sidecar {summary['sidecar']}"
            )
            print(f"verify: {summary['bytes']} bytes, sha256 {summary['sha256']}")
            return 0

        generated = args.generated_utc or _dt.datetime.now(_dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        dataset = collect(repo_root, generated)
        archive_path, sidecar_path = write_archive(dataset, out_dir)
        digest = sidecar_path.read_text(encoding="utf-8").split()[0]
        size = archive_path.stat().st_size
        print(f"dataset: {archive_path}")
        print(f"dataset: {len(dataset.members)} members, {size} bytes ({size / 1024 / 1024:.2f} MiB)")
        print(f"dataset: sha256 {digest}")
        print(f"dataset: sidecar {sidecar_path}")
        return 0
    except ExportError as error:
        print(f"export refused: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
