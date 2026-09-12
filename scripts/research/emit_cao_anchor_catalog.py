#!/usr/bin/env python3
"""Bind coordinate-bearing application POIs to native Cao static fragments."""

from __future__ import annotations
import hashlib, json, math
from pathlib import Path
from cao_domain import CAO_SOURCE_OLDEST_MA, CAO_SOURCE_YOUNGEST_MA
import pygplates

ROOT=Path(__file__).resolve().parents[2]
MODEL=ROOT.parent/"EarthHistory-data/palaeomap-study/plates/extracted/cao2024-v2.4/1.8Ga_model_GSF"
DEFAULT_OUT=ROOT.parent/"EarthHistory-data/palaeomap-study/verification/reconstruction-cao-foundation-v1/full-package"
OUT=DEFAULT_OUT
POIS={
 "chengjiang-biota":((102.9,24.7),(517.32,518.74),30,"yang-chengjiang-2018"),
 "cairo-fossil-forest":((-74,42.3),(383,388),25,"stein-cairo-forest-2020"),
 "siberian-traps":((93,68),(251.8,252.3),700,"burgess-siberian-traps-2017"),
 "karoo-ferrar":((25,-31),(182,184),500,"burgess-karoo-ferrar-2015"),
 "oae2":((12.5,43.5),(93.5,94.5),100,"kuroda-oae2-2007"),
 "chicxulub":((-89.5,21.3),(66.032,66.086),20,"renne-chicxulub-2013"),
 "andes-volcanic-margin":((-69.3,-23.5),(0,23),400,"usgs-andes-volcanism-2009"),
 "east-african-rift":((36,-3),(0,30),300,"ebinger-east-african-rift-2005"),
}

def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def asset(path):return {"url":path.name,"bytes":path.stat().st_size,"sha256":sha(path)}
def xyz(lon,lat):
 a,b=math.radians(lat),math.radians(lon);return [math.cos(a)*math.cos(b),math.cos(a)*math.sin(b),math.sin(a)]

def main(out=None):
 global OUT
 OUT=Path(out) if out else DEFAULT_OUT
 core_path=OUT/"core.json";core=json.loads(core_path.read_text());palette=json.loads((OUT/"motion-palette.json").read_text())
 core["charts"]=[chart for chart in core["charts"] if chart["role"] not in ("poi-anchor","focus-anchor")]
 entries={}
 for entry in palette["entries"]:entries.setdefault(entry["plateId"],[]).append(entry)
 features=list(pygplates.FeatureCollection(str(MODEL/"static_polygons.gpmlz")))
 anchors=[];unsupported=[]
 for anchor_id,(coordinates,event_validity,uncertainty,source_id) in POIS.items():
  point=pygplates.PointOnSphere((coordinates[1],coordinates[0]));matches=[]
  for feature in features:
   if not feature.is_valid_at_time(0):continue
   for geometry in feature.get_all_geometries():
    if isinstance(geometry,pygplates.PolygonOnSphere) and geometry.is_point_in_polygon(point):matches.append(feature)
  plates=sorted({feature.get_reconstruction_plate_id(None) for feature in matches if feature.get_reconstruction_plate_id(None) is not None})
  if len(plates)!=1 or plates[0] not in entries:
   unsupported.append({"anchorId":anchor_id,"candidatePlateIds":plates,"reason":"missing-unique-supported-Cao-static-fragment"})
   continue
  plate=plates[0];feature=sorted((f for f in matches if f.get_reconstruction_plate_id(None)==plate),key=lambda f:str(f.get_feature_id()))[0]
  oldest,youngest=feature.get_valid_time();validity=(max(0,youngest if math.isfinite(youngest) else 0),min(CAO_SOURCE_OLDEST_MA,oldest if math.isfinite(oldest) else CAO_SOURCE_OLDEST_MA))
  bindings=[{"paletteId":palette["id"],"entryId":entry["entryId"],"validTimeMa":{
              "youngest":max(validity[0],entry["youngestAgeMa"]),"oldest":min(validity[1],entry["oldestAgeMa"])}}
            for entry in entries[plate] if max(validity[0],entry["youngestAgeMa"])<=min(validity[1],entry["oldestAgeMa"])]
  fid=str(feature.get_feature_id());chart_id=f"poi:{anchor_id}:cao-fragment:{fid}"
  chart={"kind":"rigid","role":"poi-anchor","chartId":chart_id,"chartRevision":core["revision"],
         "materialId":f"poi:{anchor_id}","fragmentOrCohortId":f"poi:{anchor_id}:cao-fragment:{fid}",
         "lifecycle":{"validTimeMa":{"youngest":validity[0],"oldest":validity[1]}},"geometryReferenceAgeMa":0,
         "motionBindings":bindings,"sourceFeatureIds":[anchor_id,fid],"sourceFeatureTypes":["PointOfInterest","CaoStaticPolygonBinding"],
         "evidence":{"status":"derived-overlay","sourceIds":[source_id,"doi:10.5281/zenodo.13628813"],
                     "limitations":["present evidence coordinate reconstructed with a uniquely containing Cao static fragment","does not locate the original geological event more precisely than cited uncertainty"]},
         "surfaceEvidence":{"kind":"unknown","reason":"point anchor has no surface-height evidence"}}
  core["charts"].append(chart)
  anchor_y=max(event_validity[0],validity[0]);anchor_o=min(event_validity[1],validity[1])
  if anchor_y>anchor_o:
   core["charts"].pop();unsupported.append({"anchorId":anchor_id,"candidatePlateIds":[plate],"reason":"event-outside-fragment-validity"});continue
  anchors.append({"anchorId":anchor_id,"role":"poi-anchor","chartId":chart_id,"chartRevision":core["revision"],
                  "directionAtReference":xyz(*coordinates),"validTimeMa":{"youngest":anchor_y,"oldest":anchor_o},
                  "coordinateUncertaintyKm":uncertainty,"sourceIds":[source_id,"doi:10.5281/zenodo.13628813"],
                  "limitations":["present evidence coordinate; palaeoposition is Cao-model dependent"]})
 catalog={"schemaVersion":2,"packageId":core["packageId"],"revision":core["revision"],"frame":core["frame"],"anchors":anchors}
 path=OUT/"anchors.json";path.write_text(json.dumps(catalog,separators=(",",":"))+"\n");core["anchorCatalog"]=asset(path)
 core_path.write_text(json.dumps(core,separators=(",",":"))+"\n")
 manifest_path=OUT/"manifest.json";manifest=json.loads(manifest_path.read_text());manifest["core"]=asset(core_path);manifest_path.write_text(json.dumps(manifest,separators=(",",":"))+"\n")
 (OUT/"anchor-compiler-report.json").write_text(json.dumps({"supported":len(anchors),"unsupported":unsupported},indent=2)+"\n")
 print(json.dumps({"supported":len(anchors),"unsupported":unsupported,"catalogSha256":sha(path)}))

if __name__=="__main__":
 import argparse
 parser=argparse.ArgumentParser(description=__doc__)
 parser.add_argument("--out", type=Path, default=None)
 main(**vars(parser.parse_args()))
