#!/usr/bin/env python3
"""Gate the pre-collision continental extent the reconstruction carries into three orogens.

The product requirement behind this file is one sentence: *sufficient continental
land has to be compacted to explain the height of the mountains*. A rigid plate
model can fail that requirement silently. Nothing in the Cao et al. (2024) v2.4
package asserts how much crust an orogen consumed; the blocks simply move, and if
a block's present-day outline is all the crust it ever had, the model builds a
mountain belt out of nothing and no existing gate notices.

This validator makes that budget explicit for three collisions and pins it:

* **India-Asia (Himalaya-Tibet).** Cao 2024 carries a real pre-collision
  extension - the ``Greater India based on Gibbons et al. (2015) Gondwana
  Research`` feature on plate 501, with a lifecycle that ends at 10 Ma - plus the
  Tethyan Himalayan microcontinent and the Lesser Himalayan passive margin. Their
  northward reach beyond the model's own present-day Indian continental outline
  is measurable and is compared with the published Himalayan shortening budget.
* **Adria-Europe (Alps).** Cao 2024 carries ``Adria`` (307), ``Apulia`` (3307)
  and the ``Eastern Dinaride Platform`` (308) as present-day crust tiles only.
* **Baltica-Laurentia (Scandian Caledonides).** Cao 2024 carries Baltica (302 and
  its sub-blocks) and Laurentia/Greenland (101 family, 102) as present-day crust
  tiles, and lets them overlap during the Scandian window.

Three quantities are measured per collision, all of them re-derived here from the
pinned model rather than copied from the record:

1. **Extent.** In the model's own present-day (0 Ma) frame, how far the lower
   plate's continental crust reaches beyond that plate's present continental
   outline, along a named transect. This is the quantity the literature minima
   are stated in.
2. **Overlap.** The area shared by the two reconstructed crust sets at a given
   age. Rigid blocks that overlap are the model's own statement that this much
   crust must be thickened or subducted.
3. **Convergence.** The great-circle closure between one pin on each plate over
   the collision window.

``--self-test`` proves every gate can fail: a renamed feature, a shifted valid
time, a feature area moved past its 1 % band, a literature minimum raised above
the model, a measured extent moved past its band, and a minimum stripped of its
reference.

**A recorded FAIL is not a gate failure.** Two of the three verdicts are
failures today and are pinned as such: the Alps and the Caledonides carry no
restored pre-collision margin, and authoring one is Phase 11 of
``dev-docs/plans/palaeo-coastlines-polygons.md``. This file fails only when the
*measurement* drifts from the pinned record, when a recorded ``pass`` turns into
a ``fail``, or when a verdict stops following the numbers printed beside it. When
Phase 11 lands, the Alpine and Caledonide rows are re-measured and re-pinned here
in the same commit that adds the crust, and this gate is what proves they moved.

Wired into ``make check-corrections``: ``--record-only`` runs in any checkout and
checks the literature minima, their references, the pinned verdicts and the
tracked JSON record; the pyGPlates re-derivation runs only where the pinned
environment exists, the same rule ``check-palaeo-compile`` follows. See
``docs/research/palaeo-coastlines-collision-shortening.md``.
"""

from __future__ import annotations

import argparse
import copy
import json
import math
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
POOL = ROOT.parent / "EarthHistory-data/palaeomap-study"
MODEL = POOL / "plates/extracted/cao2024-v2.4/1.8Ga_model_GSF"
CONTINENTS = MODEL / "shapes_continents.gpmlz"
COASTS = MODEL / "shapes_coasts.gpmlz"
ROTATION_YOUNG = MODEL / "1000_0_rotfile.rot"
ROTATION_OLD = MODEL / "1800_1000_rotfile.rot"
RECORD = ROOT / "docs/research/palaeo-coastlines-collision-shortening.json"

EARTH_RADIUS_KM = 6371.0088
KM_PER_DEGREE_LATITUDE = 2.0 * math.pi * EARTH_RADIUS_KM / 360.0

#: Feature areas are re-derived on the sphere and must match within this band.
AREA_TOLERANCE_PERCENT = 1.0
#: Transect extents and reconstructed overlaps are measured, not authored, so
#: they get a tolerance rather than an equality: the densification step and the
#: equal-area projection both carry a sub-kilometre error.
EXTENT_TOLERANCE_KM = 5.0
OVERLAP_TOLERANCE_PERCENT = 1.0
CONVERGENCE_TOLERANCE_KM = 5.0

#: Densification of great-circle edges before any planar Boolean, in degrees.
#: The audit measured that without it a wide polygon's planar chord encloses
#: ground the spherical edge does not.
DENSIFY_DEGREES = 0.5

#: Every continental feature the three budgets rest on, pinned by name, plate id
#: and GPlates valid time. A renamed or re-dated feature is a different model.
PINNED_FEATURES = {
    "Greater India based on Gibbons et al. (2015) Gondwana Research":
        {"plateId": 501, "validFromMa": 600.0, "validToMa": 10.0, "areaKm2": 4_202_230.5},
    "Tethyan Himalayan microcontinent of Greater India":
        {"plateId": 501, "validFromMa": 600.0, "validToMa": None, "areaKm2": 482_290.6},
    "Lesser Himalayan pass margin Greater Indian Basin":
        {"plateId": 501, "validFromMa": 600.0, "validToMa": None, "areaKm2": 103_003.1},
    "Adria":
        {"plateId": 307, "validFromMa": 319.0, "validToMa": None, "areaKm2": 343_796.8},
    "Apulia":
        {"plateId": 3307, "validFromMa": 500.0, "validToMa": None, "areaKm2": 53_636.8},
    "Eastern Dinaride Platform":
        {"plateId": 308, "validFromMa": 319.0, "validToMa": None, "areaKm2": 222_022.3},
    "Greenland":
        {"plateId": 102, "validFromMa": 3600.0, "validToMa": 0.0, "areaKm2": 3_225_156.1},
}

#: Plate-id groups. ``exclude`` keeps the Greater India extension out of the
#: "present Indian crust" datum, which is the whole point of the India measure.
GROUPS = {
    "greater_india_extension": {"names": (
        "Greater India based on Gibbons et al. (2015) Gondwana Research",
        "Tethyan Himalayan microcontinent of Greater India",
        "Lesser Himalayan pass margin Greater Indian Basin")},
    "india_present_crust": {"plateIds": (501, 5011, 5014, 50101, 50102, 502),
                            "excludeNames": (
                                "Greater India based on Gibbons et al. (2015) Gondwana Research",
                                "Tethyan Himalayan microcontinent of Greater India",
                                "Lesser Himalayan pass margin Greater Indian Basin")},
    "asia_tibet": {"plateIds": (606, 616, 61601, 61602)},
    "adria": {"plateIds": (307, 3307, 308)},
    "europe": {"plateIds": (302, 30202, 30203, 30204, 304, 305, 303, 315, 301, 311, 309)},
    "baltica": {"plateIds": (302, 30202, 30203, 30204)},
    "laurentia": {"plateIds": (101, 10101, 10102, 10103, 10104, 10105, 10106, 102, 154)},
}

# --------------------------------------------------------------------------
# what the model measures
# --------------------------------------------------------------------------

#: Northward reach of Greater India beyond the model's own present-day Indian
#: continental outline, on each meridian, in the 0 Ma frame. Plate 501 is rigid,
#: so this length is the same at every age the feature is alive.
INDIA_EXTENT_KM = {"72E": 631.6, "75E": 825.1, "80E": 1194.2,
                   "85E": 1341.0, "88E": 1327.7, "92E": 1132.0}
#: The latitudes those lengths are the difference of.
INDIA_LIMITS_DEGREES = {
    "72E": {"greaterIndiaNorth": 40.04, "presentCrustNorth": 34.36},
    "75E": {"greaterIndiaNorth": 40.16, "presentCrustNorth": 32.74},
    "80E": {"greaterIndiaNorth": 39.90, "presentCrustNorth": 29.16},
    "85E": {"greaterIndiaNorth": 39.36, "presentCrustNorth": 27.30},
    "88E": {"greaterIndiaNorth": 38.66, "presentCrustNorth": 26.72},
    "92E": {"greaterIndiaNorth": 37.10, "presentCrustNorth": 26.92},
}
#: Adria carries no pre-collision extension at all: its northern limit and the
#: European southern limit are the two sides of one shared partition boundary.
ADRIA_EXTENT_KM = {"8E": 0.0, "10E": 0.0, "12E": 0.0, "14E": 0.0}
ADRIA_LIMITS_DEGREES = {
    "8E": {"adriaNorth": 45.56, "europeSouth": 46.30},
    "10E": {"adriaNorth": 47.30, "europeSouth": 47.32},
    "12E": {"adriaNorth": 47.68, "europeSouth": 47.70},
    "14E": {"adriaNorth": 47.06, "europeSouth": 47.92},
}
#: Baltica west of the Norwegian coastline is the present continental shelf, not
#: a restored Iapetan margin. Measured against the model's own plate-302
#: coastline polygons.
CALEDONIDE_EXTENT_KM = {"58N": 287.6, "60N": 190.1, "62N": 122.2,
                        "64N": 188.2, "66N": 142.0, "68N": 135.8}
CALEDONIDE_LIMITS_DEGREES = {
    "58N": {"crustWest": 2.20, "coastWest": 7.08},
    "60N": {"crustWest": 1.98, "coastWest": 5.40},
    "62N": {"crustWest": 3.04, "coastWest": 5.38},
    "64N": {"crustWest": 6.12, "coastWest": 9.98},
    "66N": {"crustWest": 9.42, "coastWest": 12.56},
    "68N": {"crustWest": 12.14, "coastWest": 15.40},
}

#: Reconstructed crust-on-crust overlap. Zero overlap with a positive minimum
#: gap is the model saying the two plates have not met yet; a positive overlap is
#: the model saying this much crust must be thickened or subducted by that age.
OVERLAP_KM2 = {
    ("greater_india_extension", "asia_tibet"): {
        "100": 0.0, "80": 0.0, "60": 0.0, "50": 0.0, "45": 0.0,
        "40": 50_106.9, "30": 335_703.9, "20": 478_370.8, "10": 854_112.5},
    ("adria", "europe"): {
        "100": 0.0, "60": 0.0, "35": 0.0, "20": 0.0, "0": 0.0},
    ("baltica", "laurentia"): {
        "440": 0.0, "430": 122_404.8, "420": 108_489.3,
        "410": 107_098.1, "400": 89_232.7},
}
#: Minimum separation of the same pairs, in km. The Alpine row is the whole
#: Alpine budget the model has: 166 km of gap closure since 35 Ma.
MINIMUM_GAP_KM = {
    ("greater_india_extension", "asia_tibet"): {
        "100": 4710.1, "80": 3736.1, "60": 1595.6, "50": 356.3, "45": 18.9},
    ("adria", "europe"): {
        "100": 575.6, "60": 337.8, "35": 166.2, "20": 83.4, "0": 0.0},
    ("baltica", "laurentia"): {"440": 1136.5},
}

#: Pin-pair convergence: the great-circle distance between one pin on each plate.
#: ``plateId`` is forced, because several of these present-day positions sit
#: under more than one continental feature.
CONVERGENCE_PINS = {
    "india_margin_85E": {"lon": 85.0, "lat": 27.0, "plateId": 5011},
    "lhasa_south_85E": {"lon": 85.0, "lat": 30.0, "plateId": 606},
    "greater_india_tip_85E": {"lon": 85.0, "lat": 39.3, "plateId": 501},
    "adria_po_10E": {"lon": 10.0, "lat": 45.2, "plateId": 307},
    "europe_molasse_10E": {"lon": 10.0, "lat": 48.5, "plateId": 305},
    "baltica_west_62N": {"lon": 3.1, "lat": 62.0, "plateId": 302},
    "greenland_east_62N": {"lon": -40.5, "lat": 62.0, "plateId": 102},
}
CONVERGENCE_KM = {
    ("india_margin_85E", "lhasa_south_85E"): {
        "60": 3147.1, "50": 1888.8, "40": 1404.6, "20": 774.1, "0": 333.6},
    ("greater_india_tip_85E", "lhasa_south_85E"): {
        "60": 1779.5, "50": 523.3, "45": 196.0},
    ("adria_po_10E", "europe_molasse_10E"): {
        "84": 1105.1, "60": 884.5, "35": 668.4, "20": 513.8, "0": 366.9},
    ("baltica_west_62N", "greenland_east_62N"): {
        "450": 2524.6, "440": 1911.4, "430": 1068.3, "420": 1091.6, "400": 1138.2},
}

# --------------------------------------------------------------------------
# what the literature requires
# --------------------------------------------------------------------------

#: Every minimum is the *least model-dependent* number in its literature: crust
#: that is mapped and restorable, so it has to have existed. Each carries the
#: references that constrain it and a claim-versus-inference tag. A minimum
#: without a reference fails.
LITERATURE_MINIMA = {
    "india-asia": {
        "quantity": "pre-collision northward extent of Indian continental crust "
                    "beyond the present northern edge of the Indian continental outline",
        "transect": "85E",
        "datum": "Main Frontal Thrust at the Sub-Himalayan front, about 27.5 N at 85 E; "
                 "the model's own present-day Indian continental outline ends at 27.30 N there",
        "minimumKm": 1000.0,
        "floorKm": 800.0,
        "bandKm": [800.0, 1350.0],
        "maximumDefensibleKm": 3000.0,
        "tag": "inference-from-published-minimum-shortening",
        "derivation": [
            "Balanced cross-sections across the Himalaya give minimum shortening of "
            "600-1100 km arc-wide (van Hinsbergen et al. 2019, Verbatim), about 900 km "
            "in the central Himalaya (Hu et al. 2016, Verbatim).",
            "The present N-S width of the Himalaya is about 200 km (van Hinsbergen et al. "
            "2019, Verbatim) to 250 km (van Hinsbergen et al. 2012, Verbatim).",
            "Restored pre-shortening width = present width + shortening: 800 km at the "
            "floor, about 1100 km centrally, 1350 km at the top of the band (Inference, "
            "standard balanced-section arithmetic).",
            "van Hinsbergen et al. 2019 publish the restored widths directly - Lesser "
            "Himalaya 'up to some 800 km' plus Tethyan and Greater Himalaya 'some "
            "300-400 km', i.e. 1100-1200 km (Verbatim), which confirms the arithmetic.",
            "The maximum defensible value, about 3000 km at 85 E, interpolates van "
            "Hinsbergen et al. 2019's 2600 km west / 3400 km east Greater India and "
            "assumes Greater India was entirely continental (Ingalls et al. 2016; "
            "Hu et al. 2016). That is a contested model, not a minimum.",
        ],
        "references": [
            {"citation": "van Hinsbergen, D.J.J., Lippert, P.C., Li, S., Huang, W., "
                         "Advokaat, E.L., Spakman, W. (2019) Reconstructing Greater India: "
                         "paleogeographic, kinematic, and geodynamic perspectives. "
                         "Tectonophysics 760, 69-94.",
             "url": "https://doi.org/10.1016/j.tecto.2018.04.006", "year": 2019,
             "constrains": "Himalayan balanced-section minimum shortening 600-1100 km; "
                           "restored Lesser Himalaya up to 800 km and Tethyan/Greater "
                           "Himalaya 300-400 km; Greater India 2600 km west to 3400 km east",
             "tag": "claim"},
            {"citation": "van Hinsbergen, D.J.J., Lippert, P.C., Dupont-Nivet, G., "
                         "McQuarrie, N., Doubrovine, P.V., Spakman, W., Torsvik, T.H. (2012) "
                         "Greater India Basin hypothesis and a two-stage Cenozoic collision "
                         "between India and Asia. PNAS 109(20), 7659-7664.",
             "url": "https://doi.org/10.1073/pnas.1117262109", "year": 2012,
             "constrains": "3600 +/- 35 km of convergence at the eastern syntaxis since "
                           "52 Ma; 500-900 km of Himalayan shortening; a continental "
                           "Greater India 'not larger than approximately 900 km'",
             "tag": "claim"},
            {"citation": "DeCelles, P.G., Robinson, D.M., Zandt, G. (2002) Implications of "
                         "shortening in the Himalayan fold-thrust belt for uplift of the "
                         "Tibetan Plateau. Tectonics 21(6), 1062.",
             "url": "https://doi.org/10.1029/2001TC001322", "year": 2002,
             "constrains": "total minimum fold-thrust-belt shortening up to about 670 km",
             "tag": "claim"},
            {"citation": "Long, S., McQuarrie, N., Tobgay, T., Grujic, D. (2011) Geometry "
                         "and crustal shortening of the Himalayan fold-thrust belt, eastern "
                         "and central Bhutan. GSA Bulletin 123(7-8), 1427-1447.",
             "url": "https://doi.org/10.1130/B30203.1", "year": 2011,
             "constrains": "344-405 km of minimum crustal shortening (70-75 %) in Bhutan",
             "tag": "claim"},
            {"citation": "Hu, X., Garzanti, E., Wang, J., Huang, W., An, W., Webb, A. "
                         "(2016) The timing of India-Asia collision onset - Facts, theories, "
                         "controversies. Earth-Science Reviews 160, 264-299.",
             "url": "https://doi.org/10.1016/j.earscirev.2016.07.014", "year": 2016,
             "constrains": "collision onset 59 +/- 1 Ma; about 900 km of Himalayan and "
                           "600-750 km of intra-Asian upper-crustal shortening",
             "tag": "claim"},
            {"citation": "Ingalls, M., Rowley, D.B., Currie, B., Colman, A.S. (2016) "
                         "Large-scale subduction of continental crust implied by India-Asia "
                         "mass-balance calculation. Nature Geoscience 9, 848-853.",
             "url": "https://doi.org/10.1038/ngeo2806", "year": 2016,
             "constrains": "about 50 % of the pre-collisional continental crustal mass is "
                           "missing from the present surface reservoir",
             "tag": "claim"},
            {"citation": "Gibbons, A.D., Zahirovic, S., Muller, R.D., Whittaker, J.M., "
                         "Yatheesh, V. (2015) A tectonic model reconciling evidence for the "
                         "collisions between India, Eurasia and intra-oceanic arcs of the "
                         "central-eastern Tethys. Gondwana Research 28(2), 451-492.",
             "url": "https://doi.org/10.1016/j.gr.2015.01.001", "year": 2015,
             "constrains": "the Greater India geometry this model's plate-501 feature is "
                           "named after: about 600 km west and 1000 km central",
             "tag": "claim"},
        ],
    },
    "adria-europe": {
        "quantity": "pre-collision northward extent of Adriatic continental crust beyond "
                    "its present northern outline",
        "transect": "10E",
        "datum": "the Adria-Europe partition boundary at about 47.3 N on 10 E",
        "minimumKm": 140.0,
        "floorKm": 140.0,
        "bandKm": [140.0, 300.0],
        "maximumDefensibleKm": 300.0,
        "tag": "inference-from-published-margin-widths",
        "derivation": [
            "Post-32 Ma N-S convergence across the Alps on the NFP20-East/EGT transect is "
            "58 + 61 = 119 km, and post-40 Ma is 45 + 58 + 61 = 164 km, from the Schmid et "
            "al. (1996) balanced table reproduced verbatim in Schmid et al. (2004b) "
            "(Verbatim rows; Inference for the sums). Handy et al. (2010) quote the same "
            "budget as 'about 160 km of post-Eocene N-S crustal shortening' (Verbatim), "
            "which is the internal check that the sum is the number they cite.",
            "Interpolating the 40-32 Ma row to 35 Ma gives about 136 km since 35 Ma; the "
            "minimum is therefore 120 km (Inference, weak: the 45 km row is itself declared "
            "'a minimum estimate only').",
            "Adria's own share of that budget is the Southern Alpine retro-wedge, 10 + 46 = "
            "56 km 'post-Adamello phase shortening in the Southern Alps' (Verbatim), plus "
            "15 km of Insubric backthrusting (Verbatim).",
            "The Adriatic margin consumed north of the present Insubric Line is Le Breton et "
            "al. (2021)'s modelled Adriatic sub-30-km-thick domain: 45-65 km of necking plus "
            "40-80 km of distal margin, i.e. 85-145 km (Verbatim components, Inference sum); "
            "Handy et al. (2010) assume 'about 100 km ... the actual width of the margins "
            "may have been greater' for a subducted continental margin (Verbatim).",
            "Minimum Adriatic crust beyond the present outline = 56 km of Southern Alpine "
            "shortening + about 85 km of consumed necking/distal margin, i.e. >= 140 km "
            "(Inference). Le Breton et al. (2021)'s restored Adriatic rift-affected length "
            "of 'ca. 300 km ... an absolute minimum, as this section represents only the "
            "preserved proximal part' (Verbatim) is an independent floor of the same order.",
            "Piemont-Liguria and Valais oceanic lithosphere does not count: it was never "
            "land. Le Breton et al. (2021) put 'at least 63 % ... of the material involved "
            "in the Alpine Orogeny' at extended continental lithosphere and ocean-continent "
            "transition (Verbatim).",
        ],
        "references": [
            {"citation": "Schmid, S.M., Pfiffner, O.A., Froitzheim, N., Schoenborn, G., "
                         "Kissling, E. (1996) Geophysical-geological transect and tectonic "
                         "evolution of the Swiss-Italian Alps. Tectonics 15(5), 1036-1064.",
             "url": "https://doi.org/10.1029/96TC00433", "year": 1996,
             "constrains": "the NFP20-East N-S convergence table: 200 km (65-50 Ma), 150 km "
                           "(50-40), 45 km (40-32, a minimum only), 58 km (32-19), 61 km "
                           "(19-0), more than 514 km in total since 65 Ma",
             "tag": "claim",
             "note": "read through the verbatim reproduction in Schmid et al. (2004b) "
                     "TRANSMED, whose table caption reads 'after Schmid et al. (1996)'; the "
                     "1996 paper itself was not retrieved"},
            {"citation": "Schmid, S.M., Fuegenschuh, B., Kissling, E., Schuster, R. (2004) "
                         "TRANSMED transects IV, V and VI: three lithospheric transects "
                         "across the Alps and their forelands. In: The TRANSMED Atlas.",
             "url": "https://tecto.earth.unibas.ch/research/TRANSMED/TRANSMED_all_textfig_correctedII.pdf",
             "year": 2004,
             "constrains": "the reproduced Schmid et al. (1996) table; about 120 km of "
                           "post-collisional shortening from subducted lower lithosphere in "
                           "the Central Alps, about 210 km in the Eastern Alps",
             "tag": "claim"},
            {"citation": "Handy, M.R., Schmid, S.M., Bousquet, R., Kissling, E., Bernoulli, "
                         "D. (2010) Reconciling plate-tectonic reconstructions of Alpine "
                         "Tethys with the geological-geophysical record of spreading and "
                         "subduction in the Alps. Earth-Science Reviews 102(3-4), 121-158.",
             "url": "https://doi.org/10.1016/j.earscirev.2010.06.002", "year": 2010,
             "constrains": "about 160 km of post-Eocene N-S crustal shortening; 63 km of it "
                           "north of the Insubric Line; a 243 km Adria-Europe "
                           "retrotranslation over 0-35 Ma; subducted continental margins "
                           "assumed about 100 km wide",
             "tag": "claim"},
            {"citation": "Le Breton, E., Brune, S., Ustaszewski, K., Zahirovic, S., Seton, "
                         "M., Mueller, R.D. (2021) Kinematics and extent of the "
                         "Piemont-Liguria Basin - implications for subduction processes in "
                         "the Alps. Solid Earth 12, 885-913.",
             "url": "https://doi.org/10.5194/se-12-885-2021", "year": 2021,
             "constrains": "680 km of Adria-Europe convergence since 84 Ma (420 km 84-35, "
                           "260 km 35-0); a Piemont-Liguria ocean at most 250 km wide; "
                           "Adriatic necking 45-65 km and distal margin 40-80 km; at least "
                           "63 % of the consumed material was continental",
             "tag": "claim"},
            {"citation": "Rosenberg, C.L., Berger, A., Bellahsen, N., Bousquet, R. (2015) "
                         "Relating orogen width to shortening, erosion, and exhumation "
                         "during Alpine collision. Tectonics 34(6), 1306-1328.",
             "url": "https://doi.org/10.1002/2014TC003736", "year": 2015,
             "constrains": "30-95 km of post-collisional shortening north of the "
                           "Periadriatic Line in the Central Alps, 75-110 km in the Eastern "
                           "Alps",
             "tag": "claim",
             "note": "retrieved as a search-result summary only; not verified against the "
                     "paper, and it excludes the Southern Alps, so it does not lower the "
                     "orogen-wide minimum used here"},
        ],
    },
    "baltica-laurentia": {
        "quantity": "pre-collision westward extent of Baltican continental crust beyond "
                    "the present Norwegian coastline",
        "transect": "62N",
        "datum": "the model's own plate-302 coastline polygons, which at 62 N reach 5.38 E",
        "minimumKm": 140.0,
        "floorKm": 140.0,
        "bandKm": [140.0, 370.0],
        "maximumDefensibleKm": 400.0,
        "tag": "inference-from-published-nappe-translation",
        "derivation": [
            "The Middle Allochthon (Seve Nappe Complex) at Jaemtland, about 63.4 N, 'was "
            "derived from west of the Norwegian coast and the upper units transported at "
            "least 400 km eastwards during Scandian orogeny' (Gee 1978, quoted verbatim by "
            "Lorenz et al. 2015 and restated by Gee et al. 2013).",
            "In a foreland-propagating piggyback system the most internal restorable sheet's "
            "displacement sums the slip beneath it, so minimum shortening at 62-66 N is at "
            "least 400 km (Inference). The Seve is not the highest sheet and the internal "
            "zone is 'not restorable' (Hossack & Cooper 1986, Verbatim), so the unmeasured "
            "internal strain can only add.",
            "Restoring the >= 400 km of ESE transport from the Seve outcrop belt puts the "
            "root of the Middle Allochthon about 140 km west of the present coast at "
            "62-63 N and about 250-290 km west at 66 N (Inference; longitudes approximate).",
            "The only directly published margin-extent figure is Gayer et al. (1987) at "
            "about 70 N: 'the Caledonian Baltoscandian margin prior to Iapetus suturing "
            "extended at least 400 km W of the Norwegian coast. On a Bullard reconstruction "
            "this overlaps with Laurentian rocks in Greenland. The excess continental crust "
            "is accounted for by shortening of the Baltoscandian margin during collision' "
            "(Verbatim), from a balanced section giving 626 km of translation and 78.7 % "
            "shortening.",
            "The root located this way is Baltica's outer shelf and continent-ocean "
            "transition; true continental Baltica extended further west still, so every "
            "number here is a floor (Inference).",
            "Iapetus oceanic lithosphere does not count: it was subducted and was never "
            "land. No retrieved source gives a defensible Iapetus width for the "
            "Baltica-Laurentia gap immediately before the Scandian collision.",
            "Devonian extensional collapse (403-380 Ma) and Mesozoic-Cenozoic Atlantic "
            "rifting both widened the present outline, so comparing restored margin width "
            "with the present orogen width understates the shortening (Inference from "
            "Fossen 2010 and Fossen et al. 2014, Verbatim offsets).",
        ],
        "references": [
            {"citation": "Gayer, R.A., Rice, A.H.N., Roberts, D., Townsend, C., Welbon, A. "
                         "(1987) Restoration of the Caledonian Baltoscandian margin from "
                         "balanced cross-sections: the problem of excess continental crust. "
                         "Transactions of the Royal Society of Edinburgh: Earth Sciences "
                         "78(4), 197-217.",
             "url": "https://doi.org/10.1017/S026359330001110X", "year": 1987,
             "constrains": "626 km of translation and 78.7 % total shortening in Finnmark; "
                           "the Baltoscandian margin extended at least 400 km west of the "
                           "present Norwegian coast and overlaps Greenland when restored",
             "tag": "claim"},
            {"citation": "Gee, D.G. (1978) Nappe displacement in the Scandinavian "
                         "Caledonides. Tectonophysics 47, 393-419.",
             "url": "https://doi.org/10.1016/0040-1951(78)90040-9", "year": 1978,
             "constrains": "the Middle Allochthon was derived from west of the Norwegian "
                           "coast and transported at least 400 km eastwards",
             "tag": "claim",
             "note": "read through the verbatim quotations in Lorenz et al. (2015) and Gee "
                     "et al. (2013); the 1978 paper itself was not retrieved"},
            {"citation": "Lorenz, H. et al. (2015) COSC-1 - drilling of a subduction-related "
                         "allochthon in the Palaeozoic Caledonide orogen of Scandinavia. "
                         "Scientific Drilling 19, 1-11.",
             "url": "https://doi.org/10.5194/sd-19-1-2015", "year": 2015,
             "constrains": "the >= 400 km Seve transport quotation; a 'collisional orogen of "
                           "Alpine-Himalayan dimensions' in which Baltica 'played a similar "
                           "role to that of India'",
             "tag": "claim"},
            {"citation": "Gee, D.G., Janak, M., Majka, J., Robinson, P., van Roermund, H. "
                         "(2013) Subduction along and within the Baltoscandian margin during "
                         "closing of the Iapetus Ocean and Baltica-Laurentia collision. "
                         "Lithosphere 5(2), 169-178.",
             "url": "https://doi.org/10.1130/L220.1", "year": 2013,
             "constrains": "the far-transported (greater than 400 km) Seve Nappe Complex; "
                           "UHP kyanite eclogite in northern Jaemtland metamorphosed at "
                           "100 km depth",
             "tag": "claim"},
            {"citation": "Fossen, H., Gabrielsen, R.H., Faleide, J.I., Hurich, C.A. (2014) "
                         "Crustal stretching in the Scandinavian Caledonides as revealed by "
                         "deep seismic data. Geology 42(9), 791-794.",
             "url": "https://doi.org/10.1130/G35842.1", "year": 2014,
             "constrains": "the leading edge of Baltica locally reached depths on the order "
                           "of 125 km in southwestern Norway; a Moho-offsetting Devonian "
                           "shear zone with about 50 km of displacement",
             "tag": "claim"},
            {"citation": "Fossen, H. (2010) Extensional tectonics in the North Atlantic "
                         "Caledonides: a regional view. Geological Society, London, Special "
                         "Publications 335, 767-793.",
             "url": "https://doi.org/10.1144/SP335.31", "year": 2010,
             "constrains": "a more than 1800 km long and 500 km wide orogenic wedge; "
                           "Devonian (403-380 Ma) extension with the Nordfjord-Sogn "
                           "Detachment Zone offset well in excess of 50 km; 200-400 km of "
                           "displacement on the Greenland side",
             "tag": "claim"},
            {"citation": "Gee, D.G., Fossen, H., Henriksen, N., Higgins, A.K. (2008) From "
                         "the Early Paleozoic Platforms of Baltica and Laurentia to the "
                         "Caledonide Orogen of Scandinavia and Greenland. Episodes 31(1), "
                         "44-51.",
             "url": "https://doi.org/10.18814/epiiugs/2008/v31i1/007", "year": 2008,
             "constrains": "the wide continental shelves west of Norway are inferred to be "
                           "underlain by the Caledonide hinterland; partial subduction of "
                           "the Baltoscandian margin beneath Laurentia",
             "tag": "claim",
             "note": "carries no kilometre figure of its own"},
            {"citation": "Hacker, B.R. (2007) Ascent of the ultrahigh-pressure Western "
                         "Gneiss Region, Norway. GSA Special Paper 419, 171-184.",
             "url": "https://doi.org/10.1130/2006.2419(09)", "year": 2007,
             "constrains": "coesite- and diamond-bearing eclogite at 2.0-3.5 GPa exhumed "
                           "from 130 km depth over a UHP terrane larger than 11,000 km2",
             "tag": "claim"},
        ],
    },
}

#: What the comparison currently says. The verdict is pinned, not computed at
#: gate time, so that a package or model refresh which changes it turns the gate
#: red and forces a deliberate edit here (R10). ``shortfallKm`` is the amount the
#: model is short of the minimum; a passing row has none.
PINNED_VERDICTS = {
    "india-asia": {"verdict": "pass", "modelExtentKm": 1341.0, "shortfallKm": None},
    "adria-europe": {"verdict": "fail", "modelExtentKm": 0.0, "shortfallKm": 140.0},
    "baltica-laurentia": {"verdict": "fail", "modelExtentKm": 122.2, "shortfallKm": 17.8},
}


class ExtentError(ValueError):
    """A pinned pre-collision extent premise did not hold."""


# --------------------------------------------------------------------------
# record-only checks (run in any checkout)
# --------------------------------------------------------------------------

def check_literature(minima: dict) -> dict:
    """Every minimum carries a number, a derivation and at least one reference."""
    rows = []
    for key, entry in minima.items():
        if entry.get("tag") == "pending":
            rows.append({"collision": key, "status": "pending"})
            continue
        if not isinstance(entry.get("minimumKm"), (int, float)):
            raise ExtentError(f"{key}: literature minimum is not a number")
        if not entry.get("derivation"):
            raise ExtentError(f"{key}: literature minimum carries no derivation chain")
        references = entry.get("references") or []
        if not references:
            raise ExtentError(f"{key}: literature minimum carries no reference")
        for reference in references:
            for field in ("citation", "url", "year", "constrains", "tag"):
                if not reference.get(field):
                    raise ExtentError(f"{key}: a reference is missing '{field}'")
            if reference["tag"] not in ("claim", "inference"):
                raise ExtentError(f"{key}: reference tag {reference['tag']!r} is neither "
                                  "'claim' nor 'inference'")
        band = entry.get("bandKm")
        if band and not (band[0] <= entry["minimumKm"] <= band[1]):
            raise ExtentError(f"{key}: the minimum {entry['minimumKm']} km is outside its "
                              f"own uncertainty band {band}")
        rows.append({"collision": key, "minimumKm": entry["minimumKm"],
                     "references": len(references)})
    return {"checked": rows}


def check_verdicts(minima: dict, verdicts: dict, extents: dict) -> dict:
    """The pinned verdict is what the pinned numbers actually say."""
    rows = []
    for key, pinned in verdicts.items():
        entry = minima[key]
        measured = extents[key]
        if abs(measured - pinned["modelExtentKm"]) > EXTENT_TOLERANCE_KM:
            raise ExtentError(f"{key}: the pinned model extent {pinned['modelExtentKm']} km "
                              f"does not match the pinned measurement {measured} km")
        if entry.get("tag") == "pending":
            rows.append({"collision": key, "verdict": "pending"})
            continue
        minimum = entry["minimumKm"]
        verdict = "pass" if measured >= minimum else "fail"
        shortfall = None if verdict == "pass" else round(minimum - measured, 1)
        if verdict != pinned["verdict"]:
            raise ExtentError(
                f"{key}: the model gives {measured:.1f} km against a literature minimum of "
                f"{minimum:.1f} km, which is a {verdict}, but the record pins "
                f"{pinned['verdict']!r}")
        if shortfall is not None and pinned.get("shortfallKm") is not None \
                and abs(shortfall - pinned["shortfallKm"]) > EXTENT_TOLERANCE_KM:
            raise ExtentError(f"{key}: pinned shortfall {pinned['shortfallKm']} km is not "
                              f"the {shortfall} km the numbers give")
        rows.append({"collision": key, "verdict": verdict, "modelExtentKm": measured,
                     "minimumKm": minimum, "shortfallKm": shortfall})
    return {"checked": rows}


def check_record(record_path: Path | None = None, features: dict | None = None,
                 verdicts: dict | None = None) -> dict:
    """The tracked JSON record repeats the constants this file pins."""
    record_path = RECORD if record_path is None else record_path
    features = PINNED_FEATURES if features is None else features
    verdicts = PINNED_VERDICTS if verdicts is None else verdicts
    if not record_path.is_file():
        raise ExtentError(f"missing record: {record_path}")
    record = json.loads(record_path.read_text())
    for name, pinned in features.items():
        row = record["model"]["features"].get(name)
        if row is None:
            raise ExtentError(f"record: no feature row named {name!r}")
        for field in ("plateId", "validFromMa", "validToMa"):
            if row.get(field) != pinned[field]:
                raise ExtentError(f"record: {name} {field} is {row.get(field)!r}, "
                                  f"not {pinned[field]!r}")
        if abs(row["areaKm2"] - pinned["areaKm2"]) > pinned["areaKm2"] * AREA_TOLERANCE_PERCENT / 100.0:
            raise ExtentError(f"record: {name} area {row['areaKm2']} is outside "
                              f"{AREA_TOLERANCE_PERCENT} % of {pinned['areaKm2']}")
    for key, pinned in verdicts.items():
        row = record["collisions"][key]["verdict"]
        if row["verdict"] != pinned["verdict"]:
            raise ExtentError(f"record: {key} verdict is {row['verdict']!r}, "
                              f"not {pinned['verdict']!r}")
    return {"record": record_path.name, "features": len(features)}


# --------------------------------------------------------------------------
# model checks (need the pinned pyGPlates environment)
# --------------------------------------------------------------------------

def model_available() -> bool:
    if not (CONTINENTS.is_file() and ROTATION_YOUNG.is_file() and ROTATION_OLD.is_file()):
        return False
    try:
        import pygplates  # noqa: F401
        import numpy  # noqa: F401
        import shapely  # noqa: F401
    except Exception:
        return False
    return True


def measure_model(features_pinned: dict | None = None) -> dict:
    """Re-derive every measured number from the pinned model."""
    features_pinned = PINNED_FEATURES if features_pinned is None else features_pinned
    import numpy as np
    import pygplates
    from shapely.geometry import LineString, Polygon
    from shapely.ops import unary_union
    from shapely.validation import make_valid

    rotations = pygplates.RotationModel([str(ROTATION_YOUNG), str(ROTATION_OLD)])
    continents = list(pygplates.FeatureCollection(str(CONTINENTS)))
    coasts = list(pygplates.FeatureCollection(str(COASTS)))

    def rings_of(feature):
        out = []
        for geometry in feature.get_geometries():
            out.append([(point.to_lat_lon()[1], point.to_lat_lon()[0])
                        for point in geometry.get_points()])
        return out

    def spherical_area(rings):
        total = 0.0
        for ring in rings:
            points = [pygplates.PointOnSphere(lat, lon) for lon, lat in ring]
            if len(points) < 3:
                continue
            try:
                total += pygplates.PolygonOnSphere(points).get_area() * EARTH_RADIUS_KM ** 2
            except Exception:
                pass
        return total

    # ---- pinned feature identity, plate id, valid time and area
    by_name = {}
    for feature in continents:
        by_name.setdefault(feature.get_name(), []).append(feature)
    features = {}
    for name, pinned in features_pinned.items():
        matches = by_name.get(name, [])
        if len(matches) != 1:
            raise ExtentError(f"shapes_continents holds {len(matches)} features named "
                              f"{name!r}; exactly one is pinned")
        feature = matches[0]
        plate_id = feature.get_reconstruction_plate_id()
        begin, end = feature.get_valid_time()
        valid_to = None if end == float("-inf") else end
        if plate_id != pinned["plateId"]:
            raise ExtentError(f"{name}: plate id {plate_id}, not {pinned['plateId']}")
        if begin != pinned["validFromMa"] or valid_to != pinned["validToMa"]:
            raise ExtentError(f"{name}: valid time ({begin}, {valid_to}), not "
                              f"({pinned['validFromMa']}, {pinned['validToMa']})")
        area = spherical_area(rings_of(feature))
        if abs(area - pinned["areaKm2"]) > pinned["areaKm2"] * AREA_TOLERANCE_PERCENT / 100.0:
            raise ExtentError(f"{name}: area {area:,.1f} km2 is outside "
                              f"{AREA_TOLERANCE_PERCENT} % of {pinned['areaKm2']:,.1f} km2")
        features[name] = {"plateId": plate_id, "validFromMa": begin, "validToMa": valid_to,
                          "areaKm2": round(area, 1)}

    # ---- group membership
    def group_features(key):
        spec = GROUPS[key]
        names = set(spec.get("names", ()))
        plate_ids = set(spec.get("plateIds", ()))
        excluded = set(spec.get("excludeNames", ()))
        out = []
        for feature in continents:
            if feature.get_name() in excluded:
                continue
            if feature.get_name() in names or feature.get_reconstruction_plate_id() in plate_ids:
                out.append(feature)
        return out

    def polygons_of(features_or_rings):
        polygons = []
        for rings in features_or_rings:
            for ring in rings:
                points = [pygplates.PointOnSphere(lat, lon) for lon, lat in ring]
                if len(points) < 3:
                    continue
                try:
                    polygons.append(pygplates.PolygonOnSphere(points))
                except Exception:
                    pass
        return polygons

    def contains(polygons, lon, lat):
        point = pygplates.PointOnSphere(lat, lon)
        return any(polygon.is_point_in_polygon(point) for polygon in polygons)

    def limit_on_meridian(polygons, lon, low, high, step=0.02, northern=True):
        best = None
        count = int(round((high - low) / step))
        for index in range(count + 1):
            lat = low + index * step
            if contains(polygons, lon, lat):
                if best is None or (lat > best if northern else lat < best):
                    best = lat
        return best

    def limit_on_parallel(polygons, lat, low, high, step=0.02):
        best = None
        count = int(round((high - low) / step))
        for index in range(count + 1):
            lon = low + index * step
            if contains(polygons, lon, lat) and (best is None or lon < best):
                best = lon
        return best

    present = {key: [rings_of(feature) for feature in group_features(key)] for key in GROUPS}
    present_polygons = {key: polygons_of(rings) for key, rings in present.items()}

    # ---- India transects
    india_extent = {}
    for label, pinned_km in INDIA_EXTENT_KM.items():
        lon = float(label[:-1])
        north_gi = limit_on_meridian(present_polygons["greater_india_extension"], lon, 5.0, 45.0)
        north_in = limit_on_meridian(present_polygons["india_present_crust"], lon, 5.0, 45.0)
        if north_gi is None or north_in is None:
            raise ExtentError(f"India transect {label}: no crust on the meridian")
        measured = (north_gi - north_in) * KM_PER_DEGREE_LATITUDE
        if abs(measured - pinned_km) > EXTENT_TOLERANCE_KM:
            raise ExtentError(f"India transect {label}: {measured:.1f} km, not the pinned "
                              f"{pinned_km:.1f} km")
        india_extent[label] = round(measured, 1)

    # ---- Adria transects: Adria north limit against the European south limit
    adria_extent = {}
    for label, pinned_km in ADRIA_EXTENT_KM.items():
        lon = float(label[:-1])
        north_ad = limit_on_meridian(present_polygons["adria"], lon, 35.0, 52.0)
        south_eu = limit_on_meridian(present_polygons["europe"], lon, 35.0, 55.0, northern=False)
        if north_ad is None or south_eu is None:
            raise ExtentError(f"Adria transect {label}: no crust on the meridian")
        overhang = max(0.0, (north_ad - south_eu) * KM_PER_DEGREE_LATITUDE)
        if abs(overhang - pinned_km) > EXTENT_TOLERANCE_KM:
            raise ExtentError(f"Adria transect {label}: {overhang:.1f} km of Adriatic crust "
                              f"north of the European margin, not the pinned {pinned_km:.1f} km")
        adria_extent[label] = round(overhang, 1)

    # ---- Caledonide transects: Baltica crust west of the model's own coastline
    coast_rings = [rings_of(feature) for feature in coasts
                   if feature.get_reconstruction_plate_id() in (302, 30202, 30203, 30204)]
    coast_polygons = polygons_of(coast_rings)
    caledonide_extent = {}
    for label, pinned_km in CALEDONIDE_EXTENT_KM.items():
        lat = float(label[:-1])
        west_crust = limit_on_parallel(present_polygons["baltica"], lat, -20.0, 35.0)
        west_coast = limit_on_parallel(coast_polygons, lat, -20.0, 35.0)
        if west_crust is None or west_coast is None:
            raise ExtentError(f"Caledonide transect {label}: no Baltica crust or coast")
        km_per_degree = KM_PER_DEGREE_LATITUDE * math.cos(math.radians(lat))
        measured = (west_coast - west_crust) * km_per_degree
        if abs(measured - pinned_km) > EXTENT_TOLERANCE_KM:
            raise ExtentError(f"Caledonide transect {label}: {measured:.1f} km of crust west "
                              f"of the coast, not the pinned {pinned_km:.1f} km")
        caledonide_extent[label] = round(measured, 1)

    # ---- reconstructed overlap, on an equal-area projection about the pair
    def unit(lon, lat):
        phi, lam = math.radians(lat), math.radians(lon)
        return np.array([math.cos(phi) * math.cos(lam), math.cos(phi) * math.sin(lam),
                         math.sin(phi)])

    def densified(ring):
        vectors = [unit(lon, lat) for lon, lat in ring]
        out = []
        for index in range(len(vectors)):
            first, second = vectors[index], vectors[(index + 1) % len(vectors)]
            out.append(first)
            angle = math.acos(float(np.clip(np.dot(first, second), -1.0, 1.0)))
            steps = int(math.ceil(math.degrees(angle) / DENSIFY_DEGREES))
            if steps > 1 and math.sin(angle) > 1e-12:
                for step in range(1, steps):
                    ratio = step / steps
                    point = (math.sin((1 - ratio) * angle) * first
                             + math.sin(ratio * angle) * second) / math.sin(angle)
                    out.append(point / np.linalg.norm(point))
        return out

    def frame_of(ring_sets):
        accumulator = np.zeros(3)
        for rings in ring_sets:
            for ring in rings:
                for lon, lat in ring:
                    accumulator += unit(lon, lat)
        centre = accumulator / np.linalg.norm(accumulator)
        helper = np.array([0.0, 0.0, 1.0])
        if abs(float(np.dot(centre, helper))) > 0.9:
            helper = np.array([1.0, 0.0, 0.0])
        first = np.cross(helper, centre)
        first /= np.linalg.norm(first)
        return first, np.cross(centre, first), centre

    def shape_of(rings, frame):
        first, second, centre = frame
        parts = []
        for ring in rings:
            planar = []
            for vector in densified(ring):
                dot = min(1.0, max(-1.0, float(np.dot(vector, centre))))
                scale = math.sqrt(max(0.0, 2.0 / (1.0 + dot)))
                planar.append((EARTH_RADIUS_KM * scale * float(np.dot(vector, first)),
                               EARTH_RADIUS_KM * scale * float(np.dot(vector, second))))
            if len(planar) < 3:
                continue
            polygon = Polygon(planar)
            if not polygon.is_valid:
                polygon = make_valid(polygon)
            for piece in getattr(polygon, "geoms", [polygon]):
                if piece.geom_type == "Polygon" and not piece.is_empty:
                    parts.append(piece)
        return unary_union(parts) if parts else Polygon()

    def reconstructed_rings(key, age):
        selected = [feature for feature in group_features(key)
                    if age <= feature.get_valid_time()[0]
                    and age >= (feature.get_valid_time()[1]
                                if feature.get_valid_time()[1] != float("-inf") else -1e9)]
        if not selected:
            return []
        if age == 0.0:
            return [ring for feature in selected for ring in rings_of(feature)]
        out = []
        reconstructed = []
        pygplates.reconstruct(selected, rotations, reconstructed, float(age))
        for item in reconstructed:
            geometry = item.get_reconstructed_geometry()
            out.append([(point.to_lat_lon()[1], point.to_lat_lon()[0])
                        for point in geometry.get_points()])
        return out

    overlaps = {}
    gaps = {}
    for (left, right), pinned_by_age in OVERLAP_KM2.items():
        for age_label, pinned_km2 in pinned_by_age.items():
            age = float(age_label)
            rings_left = reconstructed_rings(left, age)
            rings_right = reconstructed_rings(right, age)
            frame = frame_of([rings_left, rings_right])
            shape_left = shape_of(rings_left, frame)
            shape_right = shape_of(rings_right, frame)
            measured = shape_left.intersection(shape_right).area
            allowed = max(OVERLAP_TOLERANCE_PERCENT / 100.0 * pinned_km2, 1.0)
            if abs(measured - pinned_km2) > allowed:
                raise ExtentError(f"{left} vs {right} at {age_label} Ma: overlap "
                                  f"{measured:,.1f} km2, not the pinned {pinned_km2:,.1f} km2")
            overlaps[f"{left}|{right}|{age_label}"] = round(measured, 1)
            pinned_gap = MINIMUM_GAP_KM.get((left, right), {}).get(age_label)
            if pinned_gap is not None:
                gap = shape_left.distance(shape_right)
                if abs(gap - pinned_gap) > EXTENT_TOLERANCE_KM:
                    raise ExtentError(f"{left} vs {right} at {age_label} Ma: minimum gap "
                                      f"{gap:.1f} km, not the pinned {pinned_gap:.1f} km")
                gaps[f"{left}|{right}|{age_label}"] = round(gap, 1)

    # ---- pin-pair convergence
    convergence = {}
    for (left, right), pinned_by_age in CONVERGENCE_KM.items():
        first_pin, second_pin = CONVERGENCE_PINS[left], CONVERGENCE_PINS[right]
        for age_label, pinned_km in pinned_by_age.items():
            age = float(age_label)
            positions = []
            for pin in (first_pin, second_pin):
                rotation = rotations.get_rotation(age, int(pin["plateId"]))
                positions.append(rotation * pygplates.PointOnSphere(pin["lat"], pin["lon"]))
            measured = pygplates.GeometryOnSphere.distance(*positions) * EARTH_RADIUS_KM
            if abs(measured - pinned_km) > CONVERGENCE_TOLERANCE_KM:
                raise ExtentError(f"{left} to {right} at {age_label} Ma: {measured:.1f} km, "
                                  f"not the pinned {pinned_km:.1f} km")
            convergence[f"{left}|{right}|{age_label}"] = round(measured, 1)

    return {"features": features, "indiaExtentKm": india_extent,
            "adriaExtentKm": adria_extent, "caledonideExtentKm": caledonide_extent,
            "overlapKm2": overlaps, "minimumGapKm": gaps, "convergenceKm": convergence}


# --------------------------------------------------------------------------
# entry points
# --------------------------------------------------------------------------

def validate(record_only: bool = False, minima: dict | None = None,
             verdicts: dict | None = None, features: dict | None = None,
             record_path: Path | None = None) -> dict:
    minima = LITERATURE_MINIMA if minima is None else minima
    verdicts = PINNED_VERDICTS if verdicts is None else verdicts
    features = PINNED_FEATURES if features is None else features
    extents = {
        "india-asia": INDIA_EXTENT_KM[minima["india-asia"]["transect"]],
        "adria-europe": ADRIA_EXTENT_KM[minima["adria-europe"]["transect"]],
        "baltica-laurentia": CALEDONIDE_EXTENT_KM[minima["baltica-laurentia"]["transect"]],
    }
    result = {"status": "pass",
              "literature": check_literature(minima),
              "verdicts": check_verdicts(minima, verdicts, extents),
              "record": check_record(record_path, features, verdicts)}
    if record_only:
        result["model"] = {"status": "not run",
                           "reason": "record-only run; the pinned pyGPlates model was not read"}
        return result
    if not model_available():
        result["model"] = {"status": "not run",
                           "reason": f"the pinned model or environment is unavailable ({MODEL})"}
        return result
    result["model"] = measure_model(features)
    return result


def expect_failure(label: str, **kwargs) -> str:
    try:
        validate(**kwargs)
    except ExtentError as error:
        return f"{label}: rejected ({error})"
    raise ExtentError(f"{label}: the mutation was accepted")


def self_test(record_only: bool = False) -> dict:
    """Prove each gate can fail, then prove the clean run still passes."""
    rejections = []
    original_name = "Greater India based on Gibbons et al. (2015) Gondwana Research"

    renamed = copy.deepcopy(PINNED_FEATURES)
    renamed["Greater India (Gibbons 2015)"] = renamed.pop(original_name)
    rejections.append(expect_failure("a renamed Greater India feature",
                                     record_only=record_only, features=renamed))

    shifted = copy.deepcopy(PINNED_FEATURES)
    shifted[original_name]["validToMa"] = 0.0
    rejections.append(expect_failure("a Greater India lifecycle that no longer ends at 10 Ma",
                                     record_only=record_only, features=shifted))

    widened = copy.deepcopy(PINNED_FEATURES)
    widened["Adria"]["areaKm2"] = PINNED_FEATURES["Adria"]["areaKm2"] * 1.02
    rejections.append(expect_failure("an Adria area moved 2 % off its pin",
                                     record_only=record_only, features=widened))

    raised = copy.deepcopy(LITERATURE_MINIMA)
    raised["india-asia"]["minimumKm"] = 2000.0
    raised["india-asia"]["bandKm"] = [800.0, 3000.0]
    rejections.append(expect_failure("an India-Asia minimum raised above the model",
                                     record_only=record_only, minima=raised))

    stripped = copy.deepcopy(LITERATURE_MINIMA)
    stripped["india-asia"]["references"] = []
    rejections.append(expect_failure("an India-Asia minimum stripped of its references",
                                     record_only=record_only, minima=stripped))

    untagged = copy.deepcopy(LITERATURE_MINIMA)
    untagged["india-asia"]["references"][0]["tag"] = "assumed"
    rejections.append(expect_failure("a reference tagged neither claim nor inference",
                                     record_only=record_only, minima=untagged))

    outside = copy.deepcopy(LITERATURE_MINIMA)
    outside["adria-europe"]["minimumKm"] = 50.0
    rejections.append(expect_failure("an Alpine minimum below its own uncertainty band",
                                     record_only=record_only, minima=outside))

    moved = copy.deepcopy(PINNED_VERDICTS)
    moved["india-asia"]["modelExtentKm"] = 900.0
    rejections.append(expect_failure("a pinned model extent that no longer matches the "
                                     "measurement", record_only=record_only, verdicts=moved))

    flipped = copy.deepcopy(PINNED_VERDICTS)
    flipped["adria-europe"]["verdict"] = "pass"
    rejections.append(expect_failure("an Alpine verdict flipped to pass while the model "
                                     "carries no Adriatic extension",
                                     record_only=record_only, verdicts=flipped))

    shrunk = copy.deepcopy(LITERATURE_MINIMA)
    shrunk["baltica-laurentia"]["minimumKm"] = 100.0
    rejections.append(expect_failure("a Caledonide minimum lowered until the modern Atlantic "
                                     "shelf passes for a restored margin",
                                     record_only=record_only, minima=shrunk))

    restored = validate(record_only=record_only)
    return {"status": "pass", "rejections": rejections, "restored": restored["status"]}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--self-test", action="store_true")
    parser.add_argument("--record-only", action="store_true",
                        help="skip the pyGPlates half; check the record and the budget only")
    parser.add_argument("--record", type=Path, default=None,
                        help="read a record other than the tracked one (draft review)")
    arguments = parser.parse_args()
    if arguments.record is not None:
        global RECORD  # noqa: PLW0603 - a draft record is reviewed before it is tracked
        RECORD = arguments.record
    try:
        result = (self_test(record_only=arguments.record_only) if arguments.self_test
                  else validate(record_only=arguments.record_only))
    except ExtentError as error:
        print(f"validate-precollision-extent: FAIL: {error}", file=sys.stderr)
        return 1
    print(json.dumps(result, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
