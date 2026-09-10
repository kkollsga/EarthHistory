#!/usr/bin/env python3
"""Bounded source-driven PALEOMAP boundary transfer at 400 Ma."""

from __future__ import annotations
import hashlib, json, math, struct, tempfile, zipfile
from pathlib import Path
import pygplates

ROOT=Path(__file__).resolve().parents[2]
EXT=ROOT.parent/'EarthHistory-data/palaeomap-study/verification/reconstruction-machinery-v1'
CHILD=EXT/'revision-stitch'; POLICY=CHILD/'source-boundary-policy.json'
OUTPUT=CHILD/'source-boundary-transfer-400ma.json'
GRID=ROOT/'public/data/paleodem-400ma.bin'
SOURCE_ZIP=ROOT/'dev-docs/temp/earthhistory-data/paleomap_global_plate_model_v3.zip'
CAO=ROOT.parent/'EarthHistory-data/palaeomap-study/plates/extracted/cao2024-v2.4/1.8Ga_model_GSF'
AGE=400.; EARTH_KM=6371.0088
EXPECTED_GRID='48c333ef9df4e690d8cf85389176777131dddf61c408bd55cdf4ecc744514ef2'
EXPECTED_ZIP='a58409f42bdb5f247e0dd543e8c3287f5d291d5928d0df730af8b2fa1ae7be65'

def sha(b): return hashlib.sha256(b).hexdigest()
def strict(model,plate):
 try:return model.get_rotation(AGE,plate,use_identity_for_missing_plate_ids=False)
 except pygplates.RotationModel.RotationNotFoundError:return None
def active(f):
 old,young=f.get_valid_time();return young<=AGE<=old
def angular(a,b):return math.degrees(pygplates.GeometryOnSphere.distance(a,b))
def km(a,b):return pygplates.GeometryOnSphere.distance(a,b)*EARTH_KM
def point(lon,lat):return pygplates.PointOnSphere(lat,lon)
def interp(a,b,va,vb,t):
 f=(t-va)/(vb-va);return (a[0]+f*(b[0]-a[0]),a[1]+f*(b[1]-a[1]))

def contours(values, threshold):
 # Marching squares with periodic longitude; asymptotic centre choice for saddles.
 segs=[]
 for r in range(180):
  y0=90-r;y1=y0-1
  for c in range(360):
   x0=-180+c;x1=x0+1
   v=[values[r][c],values[r][(c+1)%360],values[r+1][(c+1)%360],values[r+1][c]]
   p=[(x0,y0),(x1,y0),(x1,y1),(x0,y1)]
   edges=[]
   for i,j in ((0,1),(1,2),(2,3),(3,0)):
    if (v[i]<threshold)!=(v[j]<threshold):edges.append(interp(p[i],p[j],v[i],v[j],threshold))
   if len(edges)==2:segs.append((edges[0],edges[1]))
   elif len(edges)==4:
    if sum(v)/4>=threshold:segs.extend(((edges[0],edges[1]),(edges[2],edges[3])))
    else:segs.extend(((edges[0],edges[3]),(edges[1],edges[2])))
 def key(p):return (round(p[0],7),round(p[1],7))
 adj={}
 for i,(a,b) in enumerate(segs):
  adj.setdefault(key(a),[]).append((i,b));adj.setdefault(key(b),[]).append((i,a))
 used=set();loops=[]
 for start,(a,b) in enumerate(segs):
  if start in used:continue
  used.add(start);line=[a,b];cur=b
  while key(cur)!=key(line[0]):
   choices=[x for x in adj.get(key(cur),[]) if x[0] not in used]
   if len(choices)!=1:break
   i,nxt=choices[0];used.add(i);line.append(nxt);cur=nxt
  if key(line[-1])==key(line[0]) and len(line)>=8:loops.append(line)
 return loops

def choose_loop(loops):
 eligible=[]
 for loop in loops:
  if max(abs(y) for x,y in loop)>=75 or max(x for x,y in loop)-min(x for x,y in loop)>=300:continue
  length=sum(km(point(*a),point(*b)) for a,b in zip(loop,loop[1:]))
  eligible.append((length,min(loop),loop))
 if not eligible:raise RuntimeError('no eligible closed loop')
 return max(eligible,key=lambda x:(x[0],tuple(-q for q in x[1])))[2]

def main():
 policy=json.loads(POLICY.read_text());assert policy['writtenBeforeMeasurement'] and policy['ageMa']==400
 raw=GRID.read_bytes();assert sha(raw)==EXPECTED_GRID and raw[:4]==b'EHPD'
 schema,age,w,h,reserved=struct.unpack_from('<HHHHI',raw,4);assert (schema,age,w,h,reserved)==(1,400,360,181,0)
 flat=struct.unpack_from('<'+str(w*h)+'h',raw,16);values=[flat[r*w:(r+1)*w] for r in range(h)]
 z=SOURCE_ZIP.read_bytes();assert sha(z)==EXPECTED_ZIP
 with zipfile.ZipFile(SOURCE_ZIP) as ar:
  gpml=ar.read('PALEOMAP_PlatePolygons.gpml');rot=ar.read('PALEOMAP_PlateModel.rot')
 with tempfile.TemporaryDirectory() as td:
  td=Path(td);(td/'s.gpml').write_bytes(gpml);(td/'s.rot').write_bytes(rot)
  sf=list(pygplates.FeatureCollection(str(td/'s.gpml')));sm=pygplates.RotationModel(str(td/'s.rot'))
  sr=[];pygplates.reconstruct([f for f in sf if active(f)],sm,sr,AGE)
  source=[]
  for rg in sr:
   g=rg.get_reconstructed_geometry();f=rg.get_feature()
   if isinstance(g,pygplates.PolygonOnSphere) and strict(sm,f.get_reconstruction_plate_id()):source.append((f,g))
  tf=list(pygplates.FeatureCollection(str(CAO/'shapes_continents.gpmlz')))
  tm=pygplates.RotationModel([str(CAO/'1000_0_rotfile.rot'),str(CAO/'1800_1000_rotfile.rot')])
  target=[]
  for f in tf:
   if not active(f) or not strict(tm,f.get_reconstruction_plate_id()):continue
   for g in f.get_geometries():
    if isinstance(g,pygplates.PolygonOnSphere):target.append((f,g,g.get_area()))
  target.sort(key=lambda x:-x[2])
  results=[]
  for threshold in (0,-200):
   loop=choose_loop(contours(values,threshold));rows=[]
   totals={k:0. for k in ('total','sourceUnmatched','sourceAmbiguous','targetUnmatched','targetAmbiguous','supported')}
   max_sr=max_tr=0.;supported_points=[]
   for a,b in zip(loop,loop[1:]):
    length=km(point(*a),point(*b));totals['total']+=length
    mid=((a[0]+b[0])/2,(a[1]+b[1])/2);probes=[a,mid,b]
    source_hits=[]
    for xy in probes:
     hits=[(f,g) for f,g in source if g.is_point_in_polygon(point(*xy))]
     source_hits.append(hits)
    ids=[{str(f.get_feature_id()) for f,g in hits} for hits in source_hits]
    common=set.intersection(*ids) if ids else set()
    if not all(source_hits) or not common:
     totals['sourceUnmatched']+=length;rows.append({'status':'source-unmatched','lengthKm':length});continue
    if len(common)!=1 or any(len(h)>1 for h in source_hits):
     totals['sourceAmbiguous']+=length;rows.append({'status':'source-ambiguous','lengthKm':length,'commonIds':sorted(common)});continue
    sid=next(iter(common));source_feature=next(f for f,g in source_hits[1] if str(f.get_feature_id())==sid)
    srot=strict(sm,source_feature.get_reconstruction_plate_id());refs=[srot.get_inverse()*point(*xy) for xy in probes]
    max_sr=max(max_sr,max(angular(point(*xy),srot*ref) for xy,ref in zip(probes,refs)))
    target_hits=[]
    for ref in refs:
     hits=[(f,g) for f,g,area in target if g.is_point_in_polygon(ref)]
     target_hits.append(hits)
    tids=[{str(f.get_feature_id())+':'+str(f.get_reconstruction_plate_id()) for f,g in hits} for hits in target_hits]
    tcommon=set.intersection(*tids) if tids else set()
    if not all(target_hits) or not tcommon:
     totals['targetUnmatched']+=length;rows.append({'status':'target-unmatched','lengthKm':length,'sourceFeatureId':sid});continue
    # Multiple containing target fragments are ambiguous even if area priority is deterministic.
    if len(tcommon)!=1 or any(len(h)>1 for h in target_hits):
     totals['targetAmbiguous']+=length;rows.append({'status':'target-ambiguous','lengthKm':length,'targetCommonIds':sorted(tcommon)});continue
    tid=next(iter(tcommon));target_feature=next(f for f,g in target_hits[1] if str(f.get_feature_id())+':'+str(f.get_reconstruction_plate_id())==tid)
    trot=strict(tm,target_feature.get_reconstruction_plate_id());mapped=[trot*ref for ref in refs]
    max_tr=max(max_tr,max(angular(ref,trot.get_inverse()*m) for ref,m in zip(refs,mapped)))
    totals['supported']+=length
    if not supported_points:supported_points.append(mapped[0])
    supported_points.append(mapped[2])
    rows.append({'status':'supported','lengthKm':length,'sourceFeatureId':sid,'sourcePlateId':source_feature.get_reconstruction_plate_id(),'targetFeaturePlate':tid})
   closed_supported=(len(rows)>0 and all(x['status']=='supported' for x in rows) and angular(supported_points[0],supported_points[-1])<1e-6)
   accepted=(totals['sourceUnmatched']==0 and totals['sourceAmbiguous']==0 and totals['targetUnmatched']==0 and
             totals['targetAmbiguous']==0 and closed_supported and max_sr<=0.001 and max_tr<=0.001)
   results.append({'thresholdMetres':threshold,'accepted':accepted,'sourceLoopPointCount':len(loop),'sourceLoopClosed':loop[0]==loop[-1],
    'sourceLoopFirstLongitudeLatitude':loop[0],
    'sourceLoopBoundsLongitudeLatitude':[min(x for x,y in loop),min(y for x,y in loop),max(x for x,y in loop),max(y for x,y in loop)],
    'sourceLoopLengthKm':totals['total'],'arcLengthKm':totals,'arcFractions':{k:v/totals['total'] for k,v in totals.items() if k!='total'},
    'transferredRingClosed':closed_supported,'maximumSourceRoundTripErrorDegrees':max_sr,'maximumTargetRoundTripErrorDegrees':max_tr,
    'segmentStatusRuns':rows})
 result={'schemaVersion':1,'researchDate':'2026-09-10','classification':'two-loop source-driven contour transfer diagnostic; not global coverage',
  'policy':policy,'provenance':{'paleoDemSha256':EXPECTED_GRID,'paleomapArchiveSha256':EXPECTED_ZIP,'paleomapPolygonMemberSha256':sha(gpml),'paleomapRotationMemberSha256':sha(rot),'pygplatesVersion':pygplates.__version__,'caoRecord':'https://doi.org/10.5281/zenodo.13628813'},'loops':results}
 encoded=(json.dumps(result,indent=2,sort_keys=True)+'\n').encode();assert len(encoded)<2*1024*1024
 current=sum(p.stat().st_size for p in EXT.rglob('*') if p.is_file());old=OUTPUT.stat().st_size if OUTPUT.exists() else 0
 assert current-old+len(encoded)<32*1024*1024
 OUTPUT.write_bytes(encoded);print(json.dumps({'output':str(OUTPUT),'bytes':len(encoded),'summaries':[{k:v for k,v in x.items() if k not in ('segmentStatusRuns','policy')} for x in results]}))
if __name__=='__main__':main()
