# Canadian Arctic shelf audit at 74 Ma

Research status: resolved no-data-change audit, 2026-09-13.

The reported missing shallow sea north of Greenland at 74 Ma is not a source,
lifecycle, compilation, or shell-clearance omission. Five relevant Cao v2.4
features are active in both `shapes_coasts` and `shapes_continents`, and the
released EHGB contains all five shelf charts:

| Feature | Plate | Cao feature ID | Shelf chart vertices / triangles |
| --- | ---: | --- | ---: |
| Canadian Arctic Islands North | 120 | `GPlates-0bde4fc7-5415-42c0-b8dc-3e10a0ffbdda` | 265 / 448 |
| Canadian Arctic Islands South | 141 | `GPlates-aabe8357-8489-4f8e-8936-e7e6f6fcc84c` | 118 / 173 |
| North Ellesmere Island (Pearya) | 124 | `GPlates-07112260-c9aa-4713-b989-5c25cd1c6045` | 130 / 209 |
| North-Central Ellesmere Island | 123 | `GPlates-e0621848-530c-45e9-988a-3e063fbae938` | 171 / 268 |
| South-Central Ellesmere Island | 122 | `GPlates-26838120-dc5d-42da-9bdf-ca3e5e9c3692` | 74 / 90 |

Together the charts have 758 vertices and 1,188 triangles. All five source
features are valid from 0 through 410 Ma, so 74 Ma is well inside their native
lifecycle. Their matching land/coast set has 47 polygon components.

A north-polar spherical Lambert azimuthal equal-area comparison at 74 Ma gives
about 292,731 km² of coast union, 778,850 km² of continental-outline union, and
486,148 km² of outline outside coast. Only 28.65 km² of coast lies outside the
outline, 0.0098% of the coast area, at source digitization seams. The outline
therefore supplies substantial visible shelf context around the island pieces.
The continental outline remains Cao model geography with unknown water depth
and exposure; this audit does not relabel it as a measured shallow-water class.

The visual report was caused by low contrast between the dark shelf and ocean
under the earlier normal/light transform. Renderer work owns that presentation
issue. No Canadian source correction, inferred coastal buffer, or modern mask
is warranted.

The fixed visual witness is 74 Ma in Cao coordinates, centered approximately at
69.5°W, 82.0°N, distance 1.82 for regional context or 1.45 for a tighter view.
It should show blue continental-outline material around the five island groups.

Source: Cao et al. (2024) v2.4, Zenodo
`doi:10.5281/zenodo.13628813`, CC BY 4.0, retrieved 2026-09-09, Cao
palaeomagnetic frame with anchor plate 0. Pinned source SHA-256 values are
`c660bc074aa84b366600d81d7ccf3a45658db81ab8cdd8f6bda26e094c0dc71f`
for `shapes_coasts.gpmlz` and
`6e30de73967f81a403f46370295dec5c0d7ed3ffd80c73d47df926461d949616`
for `shapes_continents.gpmlz`.
