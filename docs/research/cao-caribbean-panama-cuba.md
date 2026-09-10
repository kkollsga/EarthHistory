# Cao Caribbean / Panama / Cuba at present day

Research status: diagnosis of a user report, 2026-09-11. Not a plate-model
edit. Evidence is from Cao 2024 v2.4 (`doi:10.5281/zenodo.13628813`) as shipped
in `cao-v2.4-foundation-v1`, plus the Natural Earth country remap.

## Report

“Cuba crosses the Panama isthmus” at present day (0 Ma).

## Verdict

**Not an EarthHistory compile or remapping bug for Cuba.** At 0 Ma, Cuba land,
Cuba shelf, and `country:cub` all sit on Cuba. The unsettling Caribbean / isthmus
picture is **Cao source geography and plate coverage**, plus the expected gap
where Natural Earth Panama edges fall on static plates that this package does
not motion-bind.

## Evidence at 0 Ma

Geometry is stored at `geometryReferenceAgeMa: 0`. Every motion-palette entry
valid at 0 Ma is the identity quaternion, so rendered position equals packaged
coordinates.

| Layer | Feature / chart | Plate | Present-day bbox (approx.) |
| --- | --- | --- | --- |
| land (`shapes_coasts`) | Cuba / South Cuba | 274 / 275 | lon −85…−74, lat 19.8…23.2 |
| shelf (`shapes_continents`) | Cuba / South Cuba | 274 / 275 | lon −85.8…−73.7, lat 19.5…24.3 |
| country reference | `country:cub` → fragments 274, 275 | 274 / 275 | lon −85.0…−74.2, lat 19.9…23.2 |
| country reference | `country:pan` | 231 only | western isthmus only |

No `country:cub` vertex has latitude &lt; 15°. Cuba coast / continent polygons do
not contain Panama City. Motion bindings for Cuba match the Cao Cuba feature
IDs (`GPlates-7af81dea-…`, `GPlates-0dda923c-…`).

## What *does* look wrong near the isthmus

### 1. Oversized “Jamacia” continental outline (shelf)

Cao `shapes_continents` feature **Jamacia** (plate 222,
`GPlates-277b540d-…`) is not a tight Jamaica island outline. Its ring runs from
Jamaica south-west to about **11.1°N, 83.4°W** (Nicaragua Caribbean coast). In
the shelf underlay that fills a large western-Caribbean lobe that approaches
Costa Rica / the isthmus (~1.3° from Costa Rica in source coordinates). The
matching `shapes_coasts` Jamaica polygon is a normal small island.

This is native Cao continental-outline model geography, not exposed land, and
not a mis-tagged Cuba chart.

### 2. Incomplete Panama in coast / continent layers

| Plate | Name (static) | In `shapes_coasts` / `shapes_continents` | In shared motion palette |
| --- | --- | --- | --- |
| 231 | Western Panama | yes | yes |
| 230 | Central Panama | **no** | **no** |
| 229 | Eastern Panama (young static) | **no** | **no** |
| 201 | Eastern Panama (and much of South America) | yes (long Pacific / Colombia strip) | yes |

So the layered globe’s land/shelf isthmus is only Western Panama plus a
south-reaching “Eastern Panama” strip on plate 201. Central Panama never
enters the shelf/land batches. The isthmus therefore looks gappy or “crossed”
by neighbouring Caribbean shelves even though Cuba itself is elsewhere.

### 3. Panama country locator gaps (our remap, justified)

`emit_cao_country_reference.py` partitions Natural Earth admin-0 edges onto
**static** polygons and drops edges without a single motion-palette plate.
For Panama, `country-reference.json` records **40 unsupported** subdivisions:
16 with candidate plate **229**, 14 with **230**, 10 with none. Only western
segments on plate **231** remain as `country:pan`. That is incomplete Panama
locator coverage, not Cuba drawn on Panama.

Cuba has only 4 unsupported subdivisions.

## Ages

Checked first at **0 Ma** (identity). Cuba land/country remain outside the
Panama window in packaged coordinates. No app remapping fix is indicated for
Cuba at present day. Deeper-time Caribbean kinematics follow Cao rotations;
this note does not recalibrate them.

## Why we do not “fix” the polygons

- Replacing Cao Jamacia / Panama rings would invent geology.
- Promoting static-only plates 229/230 into shelf/land without coast/continent
  source rings would also invent outlines.
- Widening the country remap onto plates without palette entries would place
  locators without motion support.

Acceptable follow-ups (separate work): surface the unsupported Panama locator
gap in the UI/quality panel; cite Cao’s continental-outline limits more
visibly in the Caribbean; or adopt a future Cao release that publishes
consistent isthmus coasts.

## Method

- Parsed public `batch-land.ehgb`, `batch-shelf.ehgb`, `country-reference.ehgl`
  and `core.json` chart / motion bindings.
- Compared rings in Cao `shapes_coasts.gpmlz`, `shapes_continents.gpmlz`, and
  `static_polygons.gpmlz`.
- Confirmed 0 Ma identity samples in `motion-palette.bin`.
- Counted unsupported country edges in the foundation
  `country-reference.json` sidecar.
