#!/usr/bin/env python3
"""Partition Natural Earth reference lines onto native Cao static fragments."""

from __future__ import annotations
import hashlib, json, math, struct
from pathlib import Path
import pygplates

ROOT = Path(__file__).resolve().parents[2]
STAGE = ROOT.parent / "EarthHistory-data/palaeomap-study/verification/reconstruction-cao-foundation-v1"
SOURCE = STAGE / "source-inputs/natural-earth-countries.geojson"
OUT = STAGE / "full-package"
MODEL = ROOT.parent / "EarthHistory-data/palaeomap-study/plates/extracted/cao2024-v2.4/1.8Ga_model_GSF"
SOURCE_SHA = "6866c877d39cba9c357620878839b336d569f8c662d3cfab4cb1dbe2d39c977f"
MAX_EDGE = math.radians(1)


def sha(path): return hashlib.sha256(path.read_bytes()).hexdigest()
def asset(path): return {"url": path.name, "bytes": path.stat().st_size, "sha256": sha(path)}
def unit(v):
    n = math.sqrt(sum(x*x for x in v)); return tuple(x/n for x in v)
def dot(a,b): return sum(x*y for x,y in zip(a,b))
def angle(a,b): return math.acos(max(-1,min(1,dot(a,b))))
def xyz(lon,lat):
    a,b=math.radians(lat),math.radians(lon);return math.cos(a)*math.cos(b),math.cos(a)*math.sin(b),math.sin(a)
def slerp(a,b,t):
    theta=angle(a,b)
    if theta < 1e-12:return a
    return unit(tuple(math.sin((1-t)*theta)/math.sin(theta)*x+math.sin(t*theta)/math.sin(theta)*y for x,y in zip(a,b)))


def rings(geometry):
    if geometry["type"] == "Polygon": yield from geometry["coordinates"]
    elif geometry["type"] == "MultiPolygon":
        for polygon in geometry["coordinates"]: yield from polygon


def main():
    assert sha(SOURCE) == SOURCE_SHA
    core_path=OUT/"core.json";core=json.loads(core_path.read_text());palette=json.loads((OUT/"motion-palette.json").read_text())
    static=list(pygplates.FeatureCollection(str(MODEL/"static_polygons.gpmlz")))
    polygons=[]
    for feature in static:
        if not feature.is_valid_at_time(0):continue
        plate=feature.get_reconstruction_plate_id(None)
        if plate is None:continue
        oldest, youngest = feature.get_valid_time()
        validity = (max(0.0, youngest if math.isfinite(youngest) else 0.0),
                    min(540.0, oldest if math.isfinite(oldest) else 540.0))
        for geometry in feature.get_all_geometries():
            if isinstance(geometry,pygplates.PolygonOnSphere):polygons.append((plate,str(feature.get_feature_id()),validity,geometry))
    entry_by_plate={}
    for entry in palette["entries"]:entry_by_plate.setdefault(entry["plateId"],[]).append(entry)
    core["charts"] = [chart for chart in core["charts"] if chart["role"] != "country-reference"]
    core.pop("lineBatches", None)
    base_chart_index=len(core["charts"])
    vertices=[];indices=[];vertex_charts=[];chart_rows={};metadata=[];unsupported=[]
    source=json.loads(SOURCE.read_text())
    for feature_index,feature in enumerate(source["features"]):
        props=feature["properties"]
        identifiers=[props.get("ADM0_A3"),props.get("ISO_A3"),props.get("NE_ID"),feature_index]
        country=str(next(value for value in identifiers if value not in (None,"",-99,"-99"))).lower()
        name=props.get("NAME") or country
        for part,ring in enumerate(rings(feature["geometry"])):
            for edge,(start,end) in enumerate(zip(ring,ring[1:])):
                a,b=xyz(*start),xyz(*end);count=max(1,math.ceil(angle(a,b)/MAX_EDGE))
                for subdivision in range(count):
                    left=slerp(a,b,subdivision/count);right=slerp(a,b,(subdivision+1)/count);mid=slerp(left,right,.5)
                    probes=[pygplates.PointOnSphere(left),pygplates.PointOnSphere(mid),pygplates.PointOnSphere(right)]
                    matches=[[(plate,fid,validity) for plate,fid,validity,polygon in polygons
                              if polygon.is_point_in_polygon(point)] for point in probes]
                    plate_sets=[{plate for plate,_,_ in rows} for rows in matches]
                    common_plates=set.intersection(*plate_sets) if plate_sets else set()
                    plates=sorted(common_plates)
                    common_features=(set((plate,fid,validity) for plate,fid,validity in matches[0])
                                     .intersection(*[set(rows) for rows in matches[1:]])) if matches else set()
                    candidates=sorted(row for row in common_features if row[0] in common_plates)
                    if len(plates)!=1 or not candidates or plates[0] not in entry_by_plate:
                        unsupported.append({"countryId":country,"part":part,"edge":edge,"subdivision":subdivision,
                                            "candidatePlateIds":plates,"reason":"ambiguous-static-fragment" if len(plates)>1 else "unknown-static-fragment"})
                        continue
                    plate,fid,validity=candidates[0];key=(country,plate,fid,validity)
                    if key not in chart_rows:
                        entries=sorted(entry_by_plate[plate],key=lambda x:(x["youngestAgeMa"],x["oldestAgeMa"],x["entryId"]))
                        chart_rows[key]={"countryId":country,"name":name,"plateId":plate,
                                         "sourceFeatureIds":[fid],"validity":validity,"entries":entries}
                    chart_index=base_chart_index+list(chart_rows).index(key)
                    offset=len(vertices);vertices.extend((left,right));vertex_charts.extend((chart_index,chart_index));indices.extend((offset,offset+1))
                    metadata.append({"countryId":country,"sourcePart":part,"sourceEdge":edge,"chartIndex":chart_index,
                                     "segmentOffset":len(indices)//2-1,"segmentCount":1})
    data=bytearray(32+16*len(vertices)+4*len(indices));data[:4]=b"EHGL"
    struct.pack_into("<HHIIIIII",data,4,2,32,len(vertices),len(indices)//2,0,0,0,0)
    offset=32
    for v in vertices:struct.pack_into("<fff",data,offset,*v);offset+=12
    for value in vertex_charts:struct.pack_into("<I",data,offset,value);offset+=4
    for value in indices:struct.pack_into("<I",data,offset,value);offset+=4
    path=OUT/"country-reference.ehgl";path.write_bytes(data)
    catalog={"schemaVersion":2,"packageId":core["packageId"],"revision":core["revision"],
             "geometryReferenceAgeMa":0,"sourceId":"natural-earth-countries-110m","sourceSha256":SOURCE_SHA,
             "segments":metadata,"unsupported":unsupported,"geometryAsset":asset(path)}
    (OUT/"country-reference.json").write_text(json.dumps(catalog,separators=(",",":"))+"\n")
    charts=[]
    for (country,plate,_fid,validity),row in chart_rows.items():
        bindings=[{"paletteId":palette["id"],"entryId":entry["entryId"],
                   "validTimeMa":{"youngest":max(entry["youngestAgeMa"],validity[0]),
                                  "oldest":min(entry["oldestAgeMa"],validity[1])}} for entry in row["entries"]
                  if max(entry["youngestAgeMa"],validity[0]) <= min(entry["oldestAgeMa"],validity[1])]
        suffix=f"{validity[0]:.6g}-{validity[1]:.6g}"
        charts.append({"kind":"rigid","role":"country-reference","chartId":f"country:{country}:plate:{plate}:fragment:{_fid}:{suffix}",
                       "chartRevision":core["revision"],"materialId":f"country:{country}","fragmentOrCohortId":f"country:{country}:cao-fragment:{_fid}:{suffix}",
                       "lifecycle":{"validTimeMa":{"youngest":validity[0],"oldest":validity[1]}},"geometryReferenceAgeMa":0,"motionBindings":bindings,
                       "sourceFeatureIds":[country,*row["sourceFeatureIds"]],"sourceFeatureTypes":["NaturalEarthAdmin0Reference","CaoStaticPolygonBinding"],
                       "evidence":{"status":"derived-overlay","sourceIds":["natural-earth-countries-110m","doi:10.5281/zenodo.13628813"],
                                   "limitations":["modern-country locator only; not historical borders","1-degree endpoint-and-midpoint static-fragment binding approximation","segments without consistent Cao static-fragment ownership are omitted"]},
                       "surfaceEvidence":{"kind":"unknown","reason":"line overlay has no surface-height evidence"}})
    report={"charts":charts,"lineBatch":{"batchId":"country-reference","vertexCount":len(vertices),"segmentCount":len(indices)//2,
                                           "geometryAsset":asset(path),"encoding":"ehgl-v2-f32xyz-u32"},
            "catalogAsset":asset(OUT/"country-reference.json"),"unsupportedSegmentCount":len(unsupported)}
    (OUT/"country-reference-extension.json").write_text(json.dumps(report,separators=(",",":"))+"\n")
    core["charts"].extend(charts)
    core["lineBatches"]=[report["lineBatch"]]
    core_path.write_text(json.dumps(core,separators=(",",":"))+"\n")
    manifest_path=OUT/"manifest.json";manifest=json.loads(manifest_path.read_text());manifest["core"]=asset(core_path)
    manifest_path.write_text(json.dumps(manifest,separators=(",",":"))+"\n")
    print(json.dumps({"charts":len(charts),"vertices":len(vertices),"segments":len(indices)//2,"unsupported":len(unsupported),"bytes":len(data)}))


if __name__=="__main__":main()
