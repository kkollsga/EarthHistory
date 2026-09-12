#!/usr/bin/env python3
"""Acquire a bounded Arctic-map bedrock snapshot for the Barents correction."""

from __future__ import annotations

import hashlib
import json
import tempfile
import urllib.parse
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SOURCE_STORE = ROOT.parent / "EarthHistory-data/palaeomap-study"
STORE = SOURCE_STORE / "regional-corrections/barents"
SERVICE = "https://maps-cartes.services.geo.ca/server_serveur/rest/services/NRCan/international_polar_year_en/MapServer"
LAYER = f"{SERVICE}/3"
OPEN_DATA = "https://open.canada.ca/data/api/action/package_show"
LICENSE = "https://open.canada.ca/en/open-government-licence-canada"
DATASET_ID = "9f4aacbb-42eb-be93-f0a0-9a30cf6d658f"
REGION_CAP = 160 * 1024 * 1024
STORE_CAP = 4 * 1024 * 1024 * 1024
REGION = {"xmin": 0, "ymin": 60, "xmax": 75, "ymax": 85, "spatialReference": {"wkid": 4326}}
REFERENCE_METADATA = {
    "timan-preordovician-crossref.json": "https://api.crossref.org/works/10.1016/j.gr.2006.10.021",
    "novaya-structure-crossref.json": "https://api.crossref.org/works/10.1134/S0016852122020030",
    "fjl-caledonian-crossref.json": "https://api.crossref.org/works/10.1080/11035897.2019.1622151",
    "eurasian-arctic-fold-belts-crossref.json": "https://api.crossref.org/works/10.1007/s41063-015-0014-8",
    "urals-west-siberia-crossref.json": "https://api.crossref.org/works/10.1016/j.jseaes.2013.02.029",
}


def canonical_json(value: object) -> bytes:
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n").encode()


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def file_bytes_under(path: Path) -> int:
    return sum(item.stat().st_size for item in path.rglob("*") if item.is_file() and not item.is_symlink()) if path.exists() else 0


def assert_capacity(total: int, existing: int, staged: int) -> None:
    assert staged <= REGION_CAP, ("regional cap", staged, REGION_CAP)
    assert total - existing + staged <= STORE_CAP, ("final aggregate cap", total - existing + staged, STORE_CAP)
    assert total + staged <= STORE_CAP, ("staging aggregate cap", total + staged, STORE_CAP)


def remaining_capacity(total: int, existing: int, staged: int) -> int:
    return min(REGION_CAP - staged, STORE_CAP - (total - existing + staged), STORE_CAP - (total + staged))


def fetch(url: str, params: dict[str, str] | None, maximum: int) -> tuple[bytes, str]:
    assert maximum >= 0
    full_url = f"{url}?{urllib.parse.urlencode(params)}" if params else url
    request = urllib.request.Request(full_url, headers={"User-Agent": "EarthHistory-offline-research/1"})
    with urllib.request.urlopen(request, timeout=120) as response:
        length = response.headers.get("Content-Length")
        if length is not None:
            assert int(length) <= maximum, ("declared response exceeds capacity", int(length), maximum)
        data = response.read(maximum + 1)
    assert len(data) <= maximum, ("response exceeds capacity", len(data), maximum)
    return data, full_url


def verify_pinned() -> dict | None:
    path = STORE / "source-manifest.json"
    if not path.is_file():
        return None
    manifest = json.loads(path.read_text())
    for name, expected in manifest["files"].items():
        target = STORE / name
        assert target.is_file() and not target.is_symlink()
        payload = target.read_bytes()
        assert len(payload) == expected["bytes"] and sha256(payload) == expected["sha256"], ("pinned source changed", target)
    recorded_payload_bytes = sum(item["bytes"] for item in manifest["files"].values())
    bounds = manifest.get("bounds")
    if bounds is not None and bounds.get("bytesAfterAcquisitionExcludingManifest") != recorded_payload_bytes:
        bounds["bytesAfterAcquisitionExcludingManifest"] = recorded_payload_bytes
        path.write_bytes(canonical_json(manifest))
    return manifest


def add_reference_metadata(manifest: dict) -> dict:
    total = file_bytes_under(SOURCE_STORE)
    existing = file_bytes_under(STORE)
    staged = 0
    payloads = {}
    missing = {
        name: url for name, url in REFERENCE_METADATA.items() if name not in manifest["files"]
    }
    for name, url in missing.items():
        available = min(REGION_CAP - existing - staged, STORE_CAP - total - staged)
        payload, resolved = fetch(url, None, available)
        staged += len(payload)
        assert existing + staged <= REGION_CAP, ("regional cap", existing + staged, REGION_CAP)
        assert total + staged <= STORE_CAP, ("aggregate cap", total + staged, STORE_CAP)
        parsed = json.loads(payload)
        assert parsed.get("status") == "ok" and parsed.get("message", {}).get("DOI")
        payloads[name] = (canonical_json(parsed), resolved)
    for name, (payload, _) in payloads.items():
        destination = STORE / name
        assert not destination.exists(), ("refusing to overwrite reference snapshot", destination)
        destination.write_bytes(payload)
        manifest["files"][name] = {"bytes": len(payload), "sha256": sha256(payload)}
    manifest["source"]["referenceMetadata"] = [
        {"file": name, "url": url} for name, url in REFERENCE_METADATA.items()
    ]
    (STORE / "source-manifest.json").write_bytes(canonical_json(manifest))
    return verify_pinned()


def main() -> None:
    pinned = verify_pinned()
    if pinned and any(name not in pinned["files"] for name in REFERENCE_METADATA):
        pinned = add_reference_metadata(pinned)
    if pinned:
        print(json.dumps({"status": "reused-verified-pinned-source", "featureCount": pinned["source"]["featureCount"], "bytes": file_bytes_under(STORE)}))
        return

    total = file_bytes_under(SOURCE_STORE)
    existing = file_bytes_under(STORE)
    downloaded = 0

    def bounded(url: str, params: dict[str, str] | None = None) -> tuple[bytes, str]:
        nonlocal downloaded
        payload, full_url = fetch(url, params, remaining_capacity(total, existing, downloaded))
        downloaded += len(payload)
        assert_capacity(total, existing, downloaded)
        return payload, full_url

    service_raw, service_url = bounded(SERVICE, {"f": "pjson"})
    layer_raw, layer_url = bounded(LAYER, {"f": "pjson"})
    package_raw, package_url = bounded(OPEN_DATA, {"id": DATASET_ID})
    license_raw, license_url = bounded(LICENSE)
    service, layer, package = map(json.loads, (service_raw, layer_raw, package_raw))
    assert service["supportedQueryFormats"].find("geoJSON") >= 0
    assert layer["name"] == "Arctic Northern Europe-Russia GSC EN 1:5M Onshore Bedrock Geology"
    assert layer["geometryType"] == "esriGeometryPolygon"
    assert package["success"] and package["result"]["license_id"] == "ca-ogl-lgo"

    common = {
        "where": "1=1",
        "geometry": json.dumps(REGION, separators=(",", ":")),
        "geometryType": "esriGeometryEnvelope",
        "inSR": "4326",
        "spatialRel": "esriSpatialRelIntersects",
    }
    count_raw, count_url = bounded(f"{LAYER}/query", {**common, "returnCountOnly": "true", "f": "json"})
    count = json.loads(count_raw)["count"]
    assert 0 < count <= layer["maxRecordCount"]
    geology_raw, query_url = bounded(
        f"{LAYER}/query",
        {
            **common,
            "outFields": "*",
            "returnGeometry": "true",
            "outSR": "4326",
            "orderByFields": "OBJECTID_1 ASC",
            "geometryPrecision": "6",
            "f": "geojson",
        },
    )
    geology = json.loads(geology_raw)
    assert geology["type"] == "FeatureCollection" and len(geology["features"]) == count
    ids = [feature["properties"]["OBJECTID_1"] for feature in geology["features"]]
    assert ids == sorted(ids) and len(ids) == len(set(ids))
    geology["name"] = "GSC Map 2159A Arctic northern Europe-Russia onshore bedrock, Barents query"
    geology["crs"] = {"type": "name", "properties": {"name": "urn:ogc:def:crs:OGC:1.3:CRS84"}}
    outputs = {
        "service-metadata.json": canonical_json(service),
        "layer-3-metadata.json": canonical_json(layer),
        "open-data-metadata.json": canonical_json(package),
        "license-terms.html": license_raw,
        "northern-europe-russia-bedrock.geojson": canonical_json(geology),
    }
    projected = sum(map(len, outputs.values()))
    assert_capacity(total, existing, projected)
    manifest = {
        "schemaVersion": 1,
        "retrievalDate": "2026-09-12",
        "owner": "scripts/research/regional_barents_acquire.py",
        "bounds": {
            "regionalSourceStoreMaximumBytes": REGION_CAP,
            "wholePalaeomapStudyStoreMaximumBytes": STORE_CAP,
            "wholePalaeomapStudyBytesBeforeAcquisition": total,
            "bytesBeforeAcquisition": existing,
            "bytesAfterAcquisitionExcludingManifest": projected,
        },
        "source": {
            "title": "Geological map of the Arctic, 1:5 000 000",
            "mapNumber": "Geological Survey of Canada Map 2159A",
            "doi": "10.4095/287868",
            "publisher": "Natural Resources Canada, Geological Survey of Canada",
            "publicationDate": "2011-02-01",
            "layerId": 3,
            "featureCount": count,
            "queryEnvelopeCrs84": REGION,
            "coordinateReferenceSystem": "OGC CRS84 longitude/latitude returned by ArcGIS outSR=4326",
            "serviceUrl": service_url,
            "layerUrl": layer_url,
            "openDataMetadataUrl": package_url,
            "countUrl": count_url,
            "queryUrl": query_url,
            "queryPolicy": "all source records intersecting the fixed 0-75E, 60-85N envelope, OBJECTID_1 ascending, all attributes, source geometry rounded by ArcGIS to six decimal places",
        },
        "rights": {
            "license": "Open Government Licence – Canada",
            "licenseUrl": license_url,
            "requiredAttribution": "Contains information licensed under the Open Government Licence – Canada; source Natural Resources Canada, Geological Survey of Canada.",
        },
        "files": {},
    }
    for name, payload in outputs.items():
        manifest["files"][name] = {"bytes": len(payload), "sha256": sha256(payload)}
    manifest_bytes = canonical_json(manifest)
    assert_capacity(total, existing, projected + len(manifest_bytes))
    STORE.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=STORE.parent) as temporary:
        stage = Path(temporary)
        for name, payload in outputs.items():
            (stage / name).write_bytes(payload)
        (stage / "source-manifest.json").write_bytes(manifest_bytes)
        STORE.mkdir(parents=True, exist_ok=True)
        for path in stage.iterdir():
            destination = STORE / path.name
            assert not destination.exists(), ("refusing to overwrite pinned source", destination)
            path.replace(destination)
    print(json.dumps({"featureCount": count, "bytes": file_bytes_under(STORE), "regionalCapBytes": REGION_CAP, "aggregateCapBytes": STORE_CAP}))


if __name__ == "__main__":
    main()
