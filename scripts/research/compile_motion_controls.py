#!/usr/bin/env python3
"""Compile the bounded Phase-1 Cao rigid-motion fixture and independent oracle."""

from __future__ import annotations

import argparse, hashlib, importlib.util, json, pathlib, struct

ROOT = pathlib.Path(__file__).resolve().parents[2]
MODEL = ROOT.parent / "EarthHistory-data/palaeomap-study/plates/extracted/cao2024-v2.4/1.8Ga_model_GSF"
OUTPUT = ROOT / "src/reconstruction/fixtures"
PLATE_ID = 69702
REFERENCE_AGE_MA = 5.0
REFERENCE_LAT_LON = (-5.0, 142.0)
HOLDOUT_FRACTIONS = (0.37, 0.73)
ROTATION_SHA = "e13c16ef5b2f8f116f598635e42a126b016b2c615358b499bcc3433f4a3c735c"
CONTINENT_SHA = "6e30de73967f81a403f46370295dec5c0d7ed3ffd80c73d47df926461d949616"
TOPOLOGY_SHA = "4a9f97f6368860e5917f4e6fbf78d6d7c3caf77e1736e854250d067540bb60d4"

def sha(path): return hashlib.sha256(path.read_bytes()).hexdigest()

def load_preflight():
    path = pathlib.Path(__file__).with_name("coordinate_preflight.py")
    spec = importlib.util.spec_from_file_location("coordinate_preflight", path)
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    return module

def inverse(q): return (q[0], -q[1], -q[2], -q[3])

def compose(a, b):
    aw,ax,ay,az=a; bw,bx,by,bz=b
    return (aw*bw-ax*bx-ay*by-az*bz, aw*bx+ax*bw+ay*bz-az*by,
            aw*by-ax*bz+ay*bw+az*bx, aw*bz+ax*by-ay*bx+az*bw)

def rotate(q, v):
    w,x,y,z=q; vx,vy,vz=v
    tx,ty,tz=2*(y*vz-z*vy),2*(z*vx-x*vz),2*(x*vy-y*vx)
    return (vx+w*tx+y*tz-z*ty, vy+w*ty+z*tx-x*tz, vz+w*tz+x*ty-y*tx)

def main():
    parser=argparse.ArgumentParser(); parser.add_argument("--output",type=pathlib.Path,default=OUTPUT); args=parser.parse_args()
    import pygplates
    cp=load_preflight(); rot=MODEL/"1000_0_rotfile.rot"; continents=MODEL/"shapes_continents.gpmlz"
    topology=MODEL/"250-0_plate_boundaries.gpml"
    if sha(rot)!=ROTATION_SHA or sha(continents)!=CONTINENT_SHA or sha(topology)!=TOPOLOGY_SHA:
      raise SystemExit("pinned Cao inputs changed")
    model=pygplates.RotationModel(str(rot),default_anchor_plate_id=0)
    clock=cp.all_source_rotation_times(rot,0.0,5.0)
    nodes,leaves,capped=cp.adaptive_table(model,PLATE_ID,clock)
    if capped: raise SystemExit("corrected source clock unexpectedly hit adaptive cap")
    reference_total=cp.exact_quaternion(model,REFERENCE_AGE_MA,PLATE_ID)
    relative={age:cp.float32_quaternion(compose(q,inverse(reference_total))) for age,q in nodes.items()}
    binary=bytearray(32+len(relative)*20)
    binary[0:4]=b"EHRC"; struct.pack_into("<HHIIIII",binary,4,1,20,len(relative),PLATE_ID,0,5_000_000,5_000_000)
    for index,(age,q) in enumerate(sorted(relative.items())):
        struct.pack_into("<Iffff",binary,32+index*20,round(age*1e6),*q)
    catalog={"schemaVersion":1,"id":"cao-motion-0-5-v1","frame":{"modelId":"cao-et-al-2024","modelVersion":"2.4",
      "absoluteFrameId":"palaeomagnetic","anchorPlateId":0,"axisConvention":"gplates-x0e-y90e-znorth",
      "rotationSha256":sha(rot),"topologySha256":sha(topology)},"chartRevision":"cao-rigid-chart-v1",
      "chartId":"cao-fragment-69702","materialId":"cao-material-69702","fragmentOrCohortId":"cao-fragment-69702",
      "plateId":PLATE_ID,"referenceAgeMa":REFERENCE_AGE_MA,"sourceIds":["cao-2024-v2.4-zenodo-13628813"],
      "license":"CC-BY-4.0","citation":"Cao et al. 2024 model release 2.4, doi:10.5281/zenodo.13628813",
      "retrievedUtc":"2026-09-09T13:26:07Z","compiledUtc":"2026-09-10",
      "sourceIntervals":[{"youngestAgeMa":0,"oldestAgeMa":5,"kind":"smooth-motion"}]+[
        {"youngestAgeMa":age,"oldestAgeMa":age,"kind":"source-knot"} for age in clock],
      "binary":{"bytes":len(binary),"sha256":hashlib.sha256(binary).hexdigest(),
      "timeEncoding":"uint32-micro-ma","quaternionEncoding":"float32-wxyz"},
      "scope":"Synthetic address on one source-valid rigid fragment; not a global material catalog."}
    lat,lon=REFERENCE_LAT_LON; point=pygplates.PointOnSphere(lat,lon); reference_direction=point.to_xyz()
    expected=[]
    for left,right,*_ in leaves:
      for fraction in HOLDOUT_FRACTIONS:
        age=left+(right-left)*fraction
        stage=model.get_rotation(age,PLATE_ID,REFERENCE_AGE_MA,anchor_plate_id=0,use_identity_for_missing_plate_ids=False)
        if stage is None: raise SystemExit(f"missing held-out circuit at {age} Ma")
        direction=(stage*point).to_xyz()
        expected.append({"ageMa":age,"direction":direction})
    oracle={"schemaVersion":1,"oracle":"pyGPlates 1.0.0 direct total rotations converted relative to 5 Ma reference",
      "frame":catalog["frame"],"referenceAgeMa":REFERENCE_AGE_MA,"referenceDirection":reference_direction,
      "plateId":PLATE_ID,"holdoutFractions":HOLDOUT_FRACTIONS,"angularToleranceRad":1e-5,"expected":expected}
    catalog_bytes=(json.dumps(catalog,indent=2,sort_keys=True)+"\n").encode()
    oracle_bytes=(json.dumps(oracle,indent=2,sort_keys=True)+"\n").encode()
    total=len(binary)+len(catalog_bytes)+len(oracle_bytes)
    if total>128*1024: raise SystemExit("fixture cap exceeded before write")
    args.output.mkdir(parents=True,exist_ok=True)
    (args.output/"cao-motion-0-5-v1.bin").write_bytes(binary)
    (args.output/"cao-motion-0-5-v1.json").write_bytes(catalog_bytes)
    (args.output/"cao-motion-0-5-v1.oracle.json").write_bytes(oracle_bytes)
    print(json.dumps({"nodes":len(relative),"holdouts":len(expected),"fixtureBytes":total,"binarySha256":catalog["binary"]["sha256"]}))

if __name__=="__main__": main()
