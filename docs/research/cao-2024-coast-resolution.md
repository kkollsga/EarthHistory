# Cao 2024 coast resolution: the needle-toothed coast at closest zoom

Diagnosis, 2026-09-16. The `batch-land` fill drawn from `shapes_coasts.gpmlz`
shows spiky, needle-toothed coast at closest zoom over Britain and Denmark.
The question was whether the teeth come from the source polygons, from the
emitter's triangulation, or from the 1° refinement in
`scripts/research/emit_cao_foundation_package.py`.

**[measured]** is measured from the shipped
`public/data/reconstruction/cao-v2.4/batch-land.ehgb` and the pinned
`shapes_coasts.gpmlz`; **[inferred]** is our reading of it. Test box: 49–61 N,
11 W–3 E at 0 Ma; 28 charts, 1,680 triangles, 824 one-triangle boundary edges.

## Verdict: the source polygons' own vertices

**[measured]** 820 of the 824 boundary edges (99.5 %) are a `shapes_coasts`
ring segment, matched endpoint-to-endpoint within 0.5 km. The four that are
not all share one inserted vertex at 52.637 N, 8.814 W (Shannon estuary) —
the documented `repair_source_ring` self-intersection repair in
`compile_cao_foundation.py`. The rendered coast outline is the Cao 2024 ring
geometry verbatim.

**[measured]** Edge lengths agree because they are the same edges. Emitted
boundary / source ring segments, km: p5 4.85/4.76, p25 9.49/9.50, **median
14.25/14.19**, p75 21.91/21.70, p95 41.73/41.0, max 102.1/113.3.

**[measured]** The teeth are digitised needles, not coarse spacing. Interior
angle at the source vertices: 6.6 % below 20°, 12.0 % below 30°, 17.1 % below
40°. The sharpest is 0.53° at 52.030 N, 1.168 E (Orwell/Stour estuary: 15.2 km
out, 11.2 km back), then 1.11° at 56.381 N, 3.378 W (Firth of Tay). Scottish
sea lochs — Loch Linnhe (56.57 N, 5.04 W), Loch Fyne (55.95 N, 5.72 W) — are
each a single zero-width spike.

**[measured]** The 1° refinement (option c) is not involved: 105 of the 924
box vertices are refinement midpoints and none is on the outline, because the
longest boundary edge in the box (102.1 km) is under the 1° = 111.2 km limit,
so `refine()` never bisected a coast edge here.

**[measured]** Sliver triangles (option b) exist — 34.7 % of box triangles
have circumradius/inradius above 10, worst 7,554 — but they are interior fill.
**[inferred]** They cannot read as teeth: the land shell carries no vertex
normals (no `computeVertexNormals`, no `flatShading` anywhere in `src/`), so
shading is radial and a sliver is invisible against its neighbours.

## Recommendation

This is a data-resolution limit of Cao et al. (2024), not an emitter defect.
Do not smooth or filter it: a resampled coast would misstate the source. The
available finer present-day coast is Natural Earth, already vendored for the
`observed-land-omission` correction and the 1:50m Admin 0 country lines.
**[measured]** Those lines, Douglas–Peucker pre-simplified at 0.02° (≈ 2.2 km),
sit at a median 12.58 km segment in the same box — comparable spacing but
shape-accurate to 2.2 km, so the sea lochs resolve as inlets, not needles.

A Natural-Earth present-day coast fill for 0 Ma and the ages that fall back to
the Cao 2024 proxy is therefore defensible, but it is budget work, not a free
swap: it needs its own triangulation and must be measured against the 50 MiB
`dist` ceiling in `scripts/check-app-artifacts.py`. **[measured]** `dist` is
45.75 MiB on 2026-09-16, so 4.25 MiB is the whole budget for it. Follow-up,
not done here. The map key states the limitation on the native `Land` row.
