#!/usr/bin/env python3
"""Acquire the bounded NPI Svalbard 1:750k geology source deterministically."""

from __future__ import annotations

import argparse
import hashlib
import json
import tempfile
import urllib.parse
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SOURCE_STORE = ROOT.parent / "EarthHistory-data/palaeomap-study"
DEFAULT_STORE = SOURCE_STORE / "regional-corrections/svalbard"
SERVICE = "https://geodata.npolar.no/arcgis/rest/services/Temadata/G_Geologi_Svalbard_S250_S750/MapServer"
LAYER_ID = 10
LAYER = f"{SERVICE}/{LAYER_ID}"
LICENSE = "https://geodata.npolar.no/bruksvilkar/"
REGION_CAP = 128 * 1024 * 1024
STORE_CAP = 4 * 1024 * 1024 * 1024
PAGE_SIZE = 1000


def fetch(url: str, params: dict[str, str] | None = None, *, maximum_bytes: int) -> tuple[bytes, str]:
    assert maximum_bytes >= 0, ("no bounded source-store capacity remains", maximum_bytes)
    full_url = url
    if params:
        full_url = f"{url}?{urllib.parse.urlencode(params)}"
    request = urllib.request.Request(full_url, headers={"User-Agent": "EarthHistory-offline-research/1"})
    with urllib.request.urlopen(request, timeout=60) as response:
        content_length = response.headers.get("Content-Length")
        if content_length is not None:
            assert int(content_length) <= maximum_bytes, (
                "response exceeds remaining source-store capacity",
                int(content_length),
                maximum_bytes,
            )
        data = response.read(maximum_bytes + 1)
        assert len(data) <= maximum_bytes, (
            "response exceeds remaining source-store capacity",
            len(data),
            maximum_bytes,
        )
        return data, full_url


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def canonical_json(value: object) -> bytes:
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n").encode()


def file_bytes_under(path: Path) -> int:
    return (
        sum(item.stat().st_size for item in path.rglob("*") if item.is_file() and not item.is_symlink())
        if path.exists()
        else 0
    )


def assert_capacity(whole_store_bytes: int, existing_region_bytes: int, staged_bytes: int) -> None:
    assert staged_bytes <= REGION_CAP, ("regional source cap", staged_bytes, REGION_CAP)
    final_bytes = whole_store_bytes - existing_region_bytes + staged_bytes
    peak_bytes = whole_store_bytes + staged_bytes
    assert final_bytes <= STORE_CAP, ("final whole-source-store cap", final_bytes, STORE_CAP)
    assert peak_bytes <= STORE_CAP, ("staging whole-source-store cap", peak_bytes, STORE_CAP)


def remaining_download_capacity(whole_store_bytes: int, existing_region_bytes: int, staged_bytes: int) -> int:
    return min(
        REGION_CAP - staged_bytes,
        STORE_CAP - (whole_store_bytes - existing_region_bytes + staged_bytes),
        STORE_CAP - (whole_store_bytes + staged_bytes),
    )


def verify_pinned(store: Path) -> dict[str, object] | None:
    manifest_path = store / "source-manifest.json"
    if not manifest_path.exists():
        return None
    manifest = json.loads(manifest_path.read_text())
    for name, expected in manifest["files"].items():
        path = store / name
        assert path.is_file() and not path.is_symlink(), ("missing or linked pinned source", path)
        data = path.read_bytes()
        assert len(data) == expected["bytes"] and sha256(data) == expected["sha256"], (
            "pinned source changed",
            path,
        )
    # One-time metadata correction for the first acquisition made during this task.
    # This does not change any pinned source response or its checksum.
    if "serviceVersion" in manifest["source"]:
        manifest["source"]["arcgisServerVersion"] = manifest["source"].pop("serviceVersion")
        manifest["source"]["scientificMapVersionOrEditDate"] = None
        manifest["source"]["versionLimitation"] = (
            "The service reports no scientific map version or edit date; currentVersion is the ArcGIS "
            "server version only. This acquisition is pinned by response hashes and retrieval date."
        )
        bounds = manifest["bounds"]
        bounds.pop("regionalCorrectionStoreMaximumBytes")
        bounds["wholePalaeomapStudyStoreMaximumBytes"] = STORE_CAP
        bounds["wholePalaeomapStudyBytesBeforeAcquisition"] = 3_522_388_950
        manifest_path.write_bytes(canonical_json(manifest))
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--refresh-to",
        help="Acquire a changed live service into a distinct sibling snapshot, for example 2026-10-01.",
    )
    args = parser.parse_args()
    store = DEFAULT_STORE
    if args.refresh_to:
        assert args.refresh_to.replace("-", "").isalnum() and "/" not in args.refresh_to
        store = DEFAULT_STORE.with_name(f"svalbard-{args.refresh_to}")
    pinned = verify_pinned(store)
    if pinned is not None:
        print(
            json.dumps(
                {
                    "store": str(store),
                    "status": "reused-verified-pinned-source",
                    "featureCount": pinned["source"]["featureCount"],
                    "bytes": file_bytes_under(store),
                }
            )
        )
        return

    existing_total = file_bytes_under(SOURCE_STORE)
    existing_region = file_bytes_under(store)
    downloaded_bytes = 0

    def bounded_fetch(url: str, params: dict[str, str] | None = None):
        nonlocal downloaded_bytes
        data, full_url = fetch(
            url,
            params,
            maximum_bytes=remaining_download_capacity(
                existing_total, existing_region, downloaded_bytes
            ),
        )
        downloaded_bytes += len(data)
        assert_capacity(existing_total, existing_region, downloaded_bytes)
        return data, full_url

    service_raw, service_url = bounded_fetch(SERVICE, {"f": "pjson"})
    layer_raw, layer_url = bounded_fetch(LAYER, {"f": "pjson"})
    license_raw, license_url = bounded_fetch(LICENSE)
    service = json.loads(service_raw)
    layer = json.loads(layer_raw)
    assert service["supportedQueryFormats"].find("geoJSON") >= 0
    assert service["copyrightText"] == "Norwegian Polar Institute"
    assert layer["geometryType"] == "esriGeometryPolygon"
    assert layer["maxRecordCount"] == PAGE_SIZE

    count_raw, count_url = bounded_fetch(
        f"{LAYER}/query", {"where": "1=1", "returnCountOnly": "true", "f": "json"}
    )
    feature_count = json.loads(count_raw)["count"]
    assert feature_count > 0
    features: list[dict[str, object]] = []
    page_records = []
    for offset in range(0, feature_count, PAGE_SIZE):
        params = {
            "where": "1=1",
            "outFields": "*",
            "returnGeometry": "true",
            "outSR": "4326",
            "orderByFields": "OBJECTID ASC",
            "resultOffset": str(offset),
            "resultRecordCount": str(PAGE_SIZE),
            "f": "geojson",
        }
        page_raw, page_url = bounded_fetch(f"{LAYER}/query", params)
        page = json.loads(page_raw)
        assert page["type"] == "FeatureCollection"
        page_features = page["features"]
        features.extend(page_features)
        page_records.append(
            {
                "offset": offset,
                "count": len(page_features),
                "responseBytes": len(page_raw),
                "responseSha256": sha256(page_raw),
                "url": page_url,
            }
        )
    assert len(features) == feature_count
    object_ids = [feature["properties"]["OBJECTID"] for feature in features]
    assert object_ids == sorted(object_ids)
    assert len(set(object_ids)) == feature_count

    collection = {
        "type": "FeatureCollection",
        "name": "NPI Svalbard geological units 1:750000, layer 10",
        "crs": {"type": "name", "properties": {"name": "urn:ogc:def:crs:OGC:1.3:CRS84"}},
        "features": features,
    }
    outputs = {
        "service-metadata.json": canonical_json(service),
        "layer-10-metadata.json": canonical_json(layer),
        "license-terms.html": license_raw,
        "geological-units-1-750k.geojson": canonical_json(collection),
    }
    projected_region = sum(len(data) for data in outputs.values())
    assert_capacity(existing_total, existing_region, projected_region)

    manifest = {
        "schemaVersion": 1,
        "retrievalDate": "2026-09-12",
        "owner": "scripts/research/regional_svalbard_acquire.py",
        "bounds": {
            "regionalSourceStoreMaximumBytes": REGION_CAP,
            "wholePalaeomapStudyStoreMaximumBytes": STORE_CAP,
            "wholePalaeomapStudyBytesBeforeAcquisition": existing_total,
            "bytesBeforeAcquisition": existing_region,
            "bytesAfterAcquisitionExcludingManifest": projected_region,
        },
        "source": {
            "title": "Geology, Svalbard — Geological units 1:750,000",
            "publisher": "Norwegian Polar Institute",
            "author": service["documentInfo"]["Author"],
            "arcgisServerVersion": service["currentVersion"],
            "scientificMapVersionOrEditDate": None,
            "versionLimitation": "The service reports no scientific map version or edit date; currentVersion is the ArcGIS server version only. This acquisition is pinned by response hashes and retrieval date.",
            "layerId": LAYER_ID,
            "coordinateReferenceSystem": "OGC CRS84 longitude/latitude returned by ArcGIS outSR=4326",
            "featureCount": feature_count,
            "serviceUrl": service_url,
            "layerUrl": layer_url,
            "countUrl": count_url,
            "queryPolicy": "OBJECTID ascending, 1000 records per page, all attributes and source geometry",
            "pages": page_records,
        },
        "rights": {
            "license": "Creative Commons Attribution 4.0 International (CC BY 4.0)",
            "licenseUrl": "https://creativecommons.org/licenses/by/4.0/",
            "termsUrl": license_url,
            "requiredAttribution": "© Norwegian Polar Institute",
        },
        "files": {},
    }
    for name, data in outputs.items():
        manifest["files"][name] = {"bytes": len(data), "sha256": sha256(data)}
    manifest_bytes = canonical_json(manifest)
    assert_capacity(existing_total, existing_region, projected_region + len(manifest_bytes))

    store.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=store.parent) as temporary:
        staged = Path(temporary)
        for name, data in outputs.items():
            (staged / name).write_bytes(data)
        (staged / "source-manifest.json").write_bytes(manifest_bytes)
        store.mkdir(parents=True, exist_ok=True)
        for path in staged.iterdir():
            destination = store / path.name
            assert not destination.exists(), ("refusing to overwrite pinned source", destination)
            path.replace(destination)
    print(
        json.dumps(
            {
                "store": str(store),
                "featureCount": feature_count,
                "bytes": file_bytes_under(store),
                "regionalCapBytes": REGION_CAP,
                "aggregateCapBytes": STORE_CAP,
            }
        )
    )


if __name__ == "__main__":
    main()
