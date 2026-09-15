#!/usr/bin/env python3
"""Contract text for the restored pre-collision margin charts.

The literature record, the per-strip width derivations and the consumption
schedules live here; ``restored_margins_compile.py`` derives the geometry and
calls :func:`build` to assemble the tracked manifest, and
``restored_margins_correction.py`` gates what this file writes.

Every source carries its own Verbatim / Snippet / Bibliographic-only tag, its
licence and its retrieval date. Nothing is redistributed: the widths are the
sources' claims and the retirement ages are our inference, and the two are
declared separately (design memo section B).
"""
from __future__ import annotations

import hashlib
from pathlib import Path

CORRECTION_ID = "earthhistory-restored-collision-margins-v1"
PHASE = "restored-collision-margin"
SOURCE_TYPE = "EarthHistoryRestoredCollisionMargin"
ALPS_GEOMETRY = "restored-margins-alps-v1.geojson"
CALEDONIDES_GEOMETRY = "restored-margins-caledonides-v1.geojson"

#: The map-key register: name the model, say crust rather than land, carry the
#: published spread and name the age the model consumes it.
EDITORIAL_REFERENCES = {
    "adria": "Le Breton et al. (2021) and Schmid et al. (1996)",
    "europe": "Le Breton et al. (2021) and Handy et al. (2010)",
    "baltica": "Gayer et al. (1987) and Gee (1978)",
    "laurentia": "Lorenz et al. (2011) and Fossen (2010)",
}
PUBLISHED_SPREAD_KM = {"adria": "140-300", "europe": "150-290",
                       "baltica": "140-423", "laurentia": "200-400"}

#: Verbatim from the design memo; the runtime charts carry these three strings
#: as their `evidence.limitations`.
LIMITATION_SPATIAL = (
    "the strip is a rigid band of constant width offset from a model outline; "
    "real margin geometry is segmented, oblique and internally deformed. "
    "The published width spread for this margin is carried in restoredExtent.widthDerivation.")
LIMITATION_TEMPORAL = (
    "the retirement age is a schedule fitted to the model's own closure and to "
    "published stage boundaries, not a dated observation of when this crust was consumed")
LIMITATION_EXPOSURE = "unknown at every reconstructed age"
LIMITATION_PHASE = (
    "restored pre-collision margin crust: it is crust, not land, and asserts no shoreline, "
    "water depth, relief or subaerial exposure at any age")

SURFACE_EVIDENCE_REASON = (
    "restored rifted-margin crust: its water depth, any shoreline on it and its "
    "subaerial exposure are unmapped. The Cao 2017 palaeo-coastline classes over "
    "these present-day coordinates are bound to the conjugate plate and would slide "
    "off the restored crust, so no palaeo class is inherited.")

POSE_BINDING_RULE = (
    "the restored margin is bound to the Cao plate that carries the continental "
    "feature at the datum line it is offset from, never to the static partition "
    "beneath the restored ground, which is oceanic and would detach the margin "
    "from the continent it restores")
POSE_WARNING = ("the restored margin is rigid; real margin crust thinned, rotated and was "
                "internally shortened")

DATUM_DESCRIPTION = {
    "adria": "the southern limit of the Cao v2.4 European continental outline on each meridian",
    "europe": ("the southern limit of the Cao v2.4 European continental outline on each "
               "meridian, measured southwards"),
    "baltica": "the western limit of the Cao v2.4 plate-302 coastline polygons on each parallel",
    "laurentia": "the eastern limit of the Cao v2.4 plate-102 continental outline on each parallel",
}

REJECTION_CONDITIONS = [
    "the strip is described as land, shoreline, palaeotopography or mapped exposure",
    "the strip outlives the age at which the model's own closure leaves no room for it",
    "the strip is bound to the static partition beneath the restored ground rather than to "
    "the plate carrying its datum crust",
    "the published width floor the strip cites is lowered without a new source",
    "the restored Baltoscandian margin overlaps the North-Sea-restored plate-303 block",
]


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()

SOURCES = [
 # --- Alps
 {"sourceId": "lebreton-2021-piemont-liguria",
  "title": "Kinematics and extent of the Piemont-Liguria Basin - implications for subduction processes in the Alps",
  "citation": "Le Breton, E., Brune, S., Ustaszewski, K., Zahirovic, S., Seton, M., Mueller, R.D. (2021) Solid Earth 12, 885-913.",
  "url": "https://doi.org/10.5194/se-12-885-2021", "publicationOrVersionDate": "2021-04-16",
  "license": "CC BY 4.0", "attribution": "Le Breton et al. (2021), Solid Earth (Copernicus), CC BY 4.0",
  "retrievedAt": "2026-09-15", "evidenceRole": "continental-or-crustal-extent",
  "constrains": "necking zone 45-65 km and distal margin 40-80 km per conjugate margin; oceanic domain at most 250 km; total Piemont-Liguria Basin 480 km; restored Adriatic proximal margin 'an initial length of ca. 300 km ... should be regarded as an absolute minimum'; 680 km of Adria-Europe convergence since 84 Ma (420 km 84-35 Ma, 260 km 35-0 Ma); at least 63 % of the consumed material was extended continental lithosphere or OCT",
  "tag": "Verbatim"},
 {"sourceId": "schmid-1996-swiss-italian-transect",
  "title": "Geophysical-geological transect and tectonic evolution of the Swiss-Italian Alps",
  "citation": "Schmid, S.M., Pfiffner, O.A., Froitzheim, N., Schoenborn, G., Kissling, E. (1996) Tectonics 15(5), 1036-1064.",
  "url": "https://doi.org/10.1029/96TC00433", "publicationOrVersionDate": "1996-10-01",
  "license": "publisher copyright; cited, not redistributed",
  "attribution": "Schmid et al. (1996), Tectonics (AGU)", "retrievedAt": "2026-09-15",
  "evidenceRole": "continental-or-crustal-extent",
  "constrains": "NFP20-East N-S convergence 200 km (65-50 Ma), 150 km (50-40), 45 km (40-32, 'a minimum estimate only'), 58 km (32-19), 61 km (19-0); 'a total of 56 km post-Adamello phase shortening in the Southern Alps'; 15 km of Insubric backthrusting",
  "tag": "Verbatim through Schmid et al. (2004b) TRANSMED, whose table caption reads 'after Schmid et al. (1996)'; the 1996 paper itself was not retrieved"},
 {"sourceId": "schmid-2004-transmed",
  "title": "TRANSMED transects IV, V and VI: three lithospheric transects across the Alps and their forelands",
  "citation": "Schmid, S.M., Fuegenschuh, B., Kissling, E., Schuster, R. (2004) In: The TRANSMED Atlas, Springer.",
  "url": "https://tecto.earth.unibas.ch/research/TRANSMED/TRANSMED_all_textfig_correctedII.pdf",
  "publicationOrVersionDate": "2004-01-01", "license": "author copy; cited, not redistributed",
  "attribution": "Schmid, Fuegenschuh, Kissling & Schuster (2004), TRANSMED Atlas",
  "retrievedAt": "2026-09-15", "evidenceRole": "continental-or-crustal-extent",
  "constrains": "the reproduced Schmid et al. (1996) convergence table; about 120 km of post-collisional shortening from subducted lower lithosphere in the Central Alps and about 210 km in the Eastern Alps",
  "tag": "Verbatim"},
 {"sourceId": "handy-2010-alpine-tethys",
  "title": "Reconciling plate-tectonic reconstructions of Alpine Tethys with the geological-geophysical record of spreading and subduction in the Alps",
  "citation": "Handy, M.R., Schmid, S.M., Bousquet, R., Kissling, E., Bernoulli, D. (2010) Earth-Science Reviews 102(3-4), 121-158.",
  "url": "https://doi.org/10.1016/j.earscirev.2010.06.002", "publicationOrVersionDate": "2010-10-01",
  "license": "publisher copyright; cited, not redistributed",
  "attribution": "Handy et al. (2010), Earth-Science Reviews (Elsevier)", "retrievedAt": "2026-09-15",
  "evidenceRole": "continental-or-crustal-extent",
  "constrains": "about 160 km of post-Eocene N-S crustal shortening, 63 km of it north of the Insubric Line; 'we assumed the width of the subducted part of the continental margins to have been about 100 km'; a 243 km Adria-Europe retrotranslation over 0-35 Ma",
  "tag": "Verbatim"},
 {"sourceId": "rosenberg-2015-orogen-width",
  "title": "Relating orogen width to shortening, erosion, and exhumation during Alpine collision",
  "citation": "Rosenberg, C.L., Berger, A., Bellahsen, N., Bousquet, R. (2015) Tectonics 34(6), 1306-1328.",
  "url": "https://doi.org/10.1002/2014TC003736", "publicationOrVersionDate": "2015-06-01",
  "license": "publisher copyright; cited, not redistributed",
  "attribution": "Rosenberg et al. (2015), Tectonics (AGU)", "retrievedAt": "2026-09-15",
  "evidenceRole": "continental-or-crustal-extent",
  "constrains": "30-95 km of post-collisional shortening north of the Periadriatic Line in the Central Alps and 75-110 km in the Eastern Alps - the low end of the published spread",
  "tag": "Snippet; retrieved as a search-result summary only and not verified against the paper"},
 {"sourceId": "kissling-schlunegger-2018-rollback",
  "title": "Rollback Orogeny Model for the Evolution of the Swiss Alps",
  "citation": "Kissling, E., Schlunegger, F. (2018) Tectonics 37(4), 1097-1115.",
  "url": "https://doi.org/10.1002/2017TC004762", "publicationOrVersionDate": "2018-04-01",
  "license": "publisher copyright; cited, not redistributed",
  "attribution": "Kissling & Schlunegger (2018), Tectonics (AGU)", "retrievedAt": "2026-09-15",
  "evidenceRole": "continental-or-crustal-extent",
  "constrains": "the competing interpretation: 'a rollback orogeny model for the European plate offers the most suitable concept ... the construction of surface topography is accomplished without the requirement of a hard collision between two continents'. Carries no kilometre figure; it is recorded because it lowers, not raises, the crust a model must consume.",
  "tag": "Verbatim abstract (Crossref); full text not retrieved"},
 # --- Caledonides
 {"sourceId": "gayer-1987-baltoscandian-margin",
  "title": "Restoration of the Caledonian Baltoscandian margin from balanced cross-sections: the problem of excess continental crust",
  "citation": "Gayer, R.A., Rice, A.H.N., Roberts, D., Townsend, C., Welbon, A. (1987) Transactions of the Royal Society of Edinburgh: Earth Sciences 78(4), 247-254.",
  "url": "https://doi.org/10.1017/S026359330001110X", "publicationOrVersionDate": "1987-01-01",
  "license": "publisher copyright; cited, not redistributed",
  "attribution": "Gayer et al. (1987), Trans. R. Soc. Edinburgh: Earth Sci. (Cambridge University Press)",
  "retrievedAt": "2026-09-15", "evidenceRole": "continental-or-crustal-extent",
  "constrains": "'the Caledonian Baltoscandian margin prior to Iapetus suturing extended at least 400 km W of the Norwegian coast. On a Bullard reconstruction this overlaps with Laurentian rocks in Greenland. The excess continental crust is accounted for by shortening of the Baltoscandian margin during collision'; 'the passive Iapetus continental margin which was at least 423 km wide'; 'Total shortening is 78.7 % with a translation of the most internal thrust sheet of 626 km'; 'obducted continental crust at least 600 km across the Baltic margin'",
  "tag": "Verbatim abstract (Cambridge Core); the full paper was not retrieved"},
 {"sourceId": "gee-1978-nappe-displacement",
  "title": "Nappe displacement in the Scandinavian Caledonides",
  "citation": "Gee, D.G. (1978) Tectonophysics 47, 393-419.",
  "url": "https://doi.org/10.1016/0040-1951(78)90040-9", "publicationOrVersionDate": "1978-01-01",
  "license": "publisher copyright; cited, not redistributed",
  "attribution": "Gee (1978), Tectonophysics (Elsevier)", "retrievedAt": "2026-09-15",
  "evidenceRole": "continental-or-crustal-extent",
  "constrains": "the Middle Allochthon 'was derived from west of the Norwegian coast and the upper units transported at least 400 km eastwards during Scandian orogeny'",
  "tag": "Verbatim through Lorenz et al. (2015) and Gee et al. (2013); the 1978 paper itself was not retrieved"},
 {"sourceId": "gee-2008-platforms-to-orogen",
  "title": "From the Early Paleozoic Platforms of Baltica and Laurentia to the Caledonide Orogen of Scandinavia and Greenland",
  "citation": "Gee, D.G., Fossen, H., Henriksen, N., Higgins, A.K. (2008) Episodes 31(1), 44-51.",
  "url": "https://doi.org/10.18814/epiiugs/2008/v31i1/007", "publicationOrVersionDate": "2008-03-01",
  "license": "publisher copyright; cited, not redistributed",
  "attribution": "Gee et al. (2008), Episodes (IUGS)", "retrievedAt": "2026-09-15",
  "evidenceRole": "continental-or-crustal-extent",
  "constrains": "'Between the margins of western Scandinavia and eastern Greenland, the wide continental shelves ... are inferred to be underlain by the Caledonide hinterland'; 'Partial subduction of the Baltoscandian margin beneath Laurentia'. Carries no kilometre figure.",
  "tag": "Verbatim; full text read, no km value present"},
 {"sourceId": "gee-2013-baltoscandian-subduction",
  "title": "Subduction along and within the Baltoscandian margin during closing of the Iapetus Ocean and Baltica-Laurentia collision",
  "citation": "Gee, D.G., Janak, M., Majka, J., Robinson, P., van Roermund, H. (2013) Lithosphere 5(2), 169-178.",
  "url": "https://doi.org/10.1130/L220.1", "publicationOrVersionDate": "2013-04-01",
  "license": "publisher copyright; cited, not redistributed",
  "attribution": "Gee et al. (2013), Lithosphere (GSA)", "retrievedAt": "2026-09-15",
  "evidenceRole": "geological-unit-extent",
  "constrains": "'the far-transported (greater than 400 km) Seve Nappe Complex'; 'this Neoproterozoic to Cambrian rifted, extended, dike-intruded outer-margin assemblage'; UHP kyanite eclogite metamorphosed at 100 km depth",
  "tag": "Verbatim abstract (OpenAlex/Crossref)"},
 {"sourceId": "lorenz-2015-cosc1",
  "title": "COSC-1 - drilling of a subduction-related allochthon in the Palaeozoic Caledonide orogen of Scandinavia",
  "citation": "Lorenz, H. et al. (2015) Scientific Drilling 19, 1-11.",
  "url": "https://doi.org/10.5194/sd-19-1-2015", "publicationOrVersionDate": "2015-06-11",
  "license": "CC BY 3.0", "attribution": "Lorenz et al. (2015), Scientific Drilling (Copernicus), CC BY 3.0",
  "retrievedAt": "2026-09-15", "evidenceRole": "geological-unit-extent",
  "constrains": "'The entire Middle Allochthon was derived from west of the Norwegian coast and the upper units transported at least 400 km eastwards during Scandian orogeny (Gee, 1978)'; 'a collisional orogen of Alpine-Himalayan dimensions'; Baltica 'played a similar role to that of India'",
  "tag": "Verbatim"},
 {"sourceId": "lorenz-2011-cosc-workshop",
  "title": "COSC - Collisional Orogeny in the Scandinavian Caledonides",
  "citation": "Lorenz, H., Gee, D.G., Juhlin, C. (2011) Scientific Drilling 11, 60-63.",
  "url": "https://doi.org/10.2204/iodp.sd.11.09.2011", "publicationOrVersionDate": "2011-03-01",
  "license": "CC BY 3.0", "attribution": "Lorenz, Gee & Juhlin (2011), Scientific Drilling, CC BY 3.0",
  "retrievedAt": "2026-09-15", "evidenceRole": "geological-unit-extent",
  "constrains": "Greenland thrust sheets 'all derived from the Laurentian continental margin and transported at least two hundred kilometers westwards onto the platform'; Scandinavian allochthons 'derived from Baltica's outer shelf, dyke-intruded continent-ocean transition zone (COT), Iapetus oceanic domains and (uppermost) from the Laurentian margin'; 'doubling (even trebling) of continental thicknesses'",
  "tag": "Verbatim"},
 {"sourceId": "fossen-2010-extensional-tectonics",
  "title": "Extensional tectonics in the North Atlantic Caledonides: a regional view",
  "citation": "Fossen, H. (2010) Geological Society, London, Special Publications 335, 767-793.",
  "url": "https://doi.org/10.1144/SP335.31", "publicationOrVersionDate": "2010-01-01",
  "license": "publisher copyright; cited, not redistributed",
  "attribution": "Fossen (2010), GSL Special Publications", "retrievedAt": "2026-09-15",
  "evidenceRole": "geological-unit-extent",
  "constrains": "'a more than 1800 km long and 500 km wide orogenic wedge'; 'displacements of 200-400 km have been estimated for the highest allochthonous units (Higgins & Leslie 2000)' on the Greenland side; 'the majority of the mapped extensional structures are Devonian (403-380 Ma)'",
  "tag": "Verbatim"},
 {"sourceId": "fossen-2014-crustal-stretching",
  "title": "Crustal stretching in the Scandinavian Caledonides as revealed by deep seismic data",
  "citation": "Fossen, H., Gabrielsen, R.H., Faleide, J.I., Hurich, C.A. (2014) Geology 42(9), 791-794.",
  "url": "https://doi.org/10.1130/G35842.1", "publicationOrVersionDate": "2014-09-01",
  "license": "publisher copyright; cited, not redistributed",
  "attribution": "Fossen et al. (2014), Geology (GSA)", "retrievedAt": "2026-09-15",
  "evidenceRole": "continental-or-crustal-extent",
  "constrains": "'the leading edge of Baltica locally reached depths on the order of 125 km in southwestern Norway'",
  "tag": "Verbatim"},
 {"sourceId": "hacker-2007-wgr-ascent",
  "title": "Ascent of the ultrahigh-pressure Western Gneiss Region, Norway",
  "citation": "Hacker, B.R. (2007) GSA Special Paper 419, 171-184.",
  "url": "https://doi.org/10.1130/2006.2419(09)", "publicationOrVersionDate": "2007-01-01",
  "license": "publisher copyright; cited, not redistributed",
  "attribution": "Hacker (2007), GSA Special Papers", "retrievedAt": "2026-09-15",
  "evidenceRole": "geological-unit-extent",
  "constrains": "coesite- and diamond-bearing eclogite at 2.0-3.5 GPa exhumed 'from 130 km depth'; a UHP terrane larger than 11,000 km2",
  "tag": "Verbatim"},
 {"sourceId": "hacker-2010-wgr-deformation",
  "title": "High-temperature deformation during continental-margin subduction & exhumation: The ultrahigh-pressure Western Gneiss Region of Norway",
  "citation": "Hacker, B.R., Andersen, T.B., Johnston, S., Kylander-Clark, A.R.C., Peterman, E.M., Walsh, E.O., Young, D. (2010) Tectonophysics 480, 149-171.",
  "url": "https://doi.org/10.1016/j.tecto.2009.08.012", "publicationOrVersionDate": "2010-01-01",
  "license": "publisher copyright; cited, not redistributed",
  "attribution": "Hacker et al. (2010), Tectonophysics (Elsevier)", "retrievedAt": "2026-09-15",
  "evidenceRole": "geological-unit-extent",
  "constrains": "the Western Gneiss Region as subducted and exhumed Baltican continental margin. No kilometre figure was retrieved: Crossref holds no abstract and the full text was not obtained.",
  "tag": "Bibliographic only - no number extracted"},
 {"sourceId": "andersen-1998-extensional-caledonides",
  "title": "Extensional tectonics in the Caledonides of southern Norway, an overview",
  "citation": "Andersen, T.B. (1998) Tectonophysics 285(3-4), 333-351.",
  "url": "https://doi.org/10.1016/S0040-1951(97)00277-1", "publicationOrVersionDate": "1998-02-01",
  "license": "publisher copyright; cited, not redistributed",
  "attribution": "Andersen (1998), Tectonophysics (Elsevier)", "retrievedAt": "2026-09-15",
  "evidenceRole": "geological-unit-extent",
  "constrains": "Devonian extensional collapse of the Scandinavian Caledonides, the reason the present orogen is wider than it was at peak collision. No kilometre figure was retrieved: Crossref holds no abstract and the full text was not obtained.",
  "tag": "Bibliographic only - no number extracted"},
 {"sourceId": "corfu-2014-scandinavian-caledonides",
  "title": "New perspectives on the Caledonides of Scandinavia and related areas: introduction",
  "citation": "Corfu, F., Andersen, T.B., Gasser, D. (2014) Geological Society, London, Special Publications 390, 9-43.",
  "url": "https://doi.org/10.1144/SP390.25", "publicationOrVersionDate": "2014-01-01",
  "license": "publisher copyright; cited, not redistributed",
  "attribution": "Corfu, Andersen & Gasser (2014), GSL Special Publications", "retrievedAt": "2026-09-15",
  "evidenceRole": "material-affinity",
  "constrains": "'a sequence of allochthons, some derived from Baltica, but others of probably exotic origin, in part from the Laurentian margin'. No kilometre figure in the abstract; the full text is paywalled.",
  "tag": "Verbatim abstract (Crossref); full text not retrieved"},
 {"sourceId": "slagstad-kirkland-2018-scandian",
  "title": "Timing of collision initiation and location of the Scandian orogenic suture in the Scandinavian Caledonides",
  "citation": "Slagstad, T., Kirkland, C.L. (2018) Terra Nova 30(3), 179-188.",
  "url": "https://doi.org/10.1111/ter.12324", "publicationOrVersionDate": "2018-06-01",
  "license": "publisher copyright; cited, not redistributed",
  "attribution": "Slagstad & Kirkland (2018), Terra Nova (Wiley)", "retrievedAt": "2026-09-15",
  "evidenceRole": "material-affinity",
  "constrains": "'The Scandinavian Caledonides represent a classical example of a deeply eroded Himalayan-style orogen formed during Baltica-Laurentia continent collision'; magmatism at 438-434 Ma in 'what immediately thereafter became the upper plate (Laurentia)'. Bears on which allochthons are Laurentian and which Baltican; carries no crustal-thickness figure.",
  "tag": "Verbatim abstract (Crossref)"},
 {"sourceId": "roberts-2003-scandinavian-caledonides",
  "title": "The Scandinavian Caledonides: event chronology, palaeogeographic settings and likely modern analogues",
  "citation": "Roberts, D. (2003) Tectonophysics 365, 283-299.",
  "url": "https://doi.org/10.1016/S0040-1951(03)00026-X", "publicationOrVersionDate": "2003-04-01",
  "license": "publisher copyright; cited, not redistributed",
  "attribution": "Roberts (2003), Tectonophysics (Elsevier)", "retrievedAt": "2026-09-15",
  "evidenceRole": "material-affinity",
  "constrains": "bibliographic record confirmed through Crossref. No abstract is registered and the full text was refused by every route tried; NO number is taken from it.",
  "tag": "Bibliographic only - no number extracted"},
 {"sourceId": "torsvik-cocks-2017-earth-history",
  "title": "Earth History and Palaeogeography",
  "citation": "Torsvik, T.H., Cocks, L.R.M. (2017) Cambridge University Press.",
  "url": "https://doi.org/10.1017/9781316225523", "publicationOrVersionDate": "2017-01-01",
  "license": "publisher copyright; cited, not redistributed",
  "attribution": "Torsvik & Cocks (2017), Cambridge University Press", "retrievedAt": "2026-09-15",
  "evidenceRole": "material-affinity",
  "constrains": "the Baltica-Laurentia palaeogeographic framework. The book was not accessible; NO Iapetus width or margin figure is taken from it.",
  "tag": "Bibliographic only - no number extracted"},
 # --- the precedent
 {"sourceId": "gibbons-2015-greater-india",
  "title": "A tectonic model reconciling evidence for the collisions between India, Eurasia and intra-oceanic arcs of the central-eastern Tethys",
  "citation": "Gibbons, A.D., Zahirovic, S., Mueller, R.D., Whittaker, J.M., Yatheesh, V. (2015) Gondwana Research 28(2), 451-492.",
  "url": "https://doi.org/10.1016/j.gr.2015.01.001", "publicationOrVersionDate": "2015-08-01",
  "license": "publisher copyright; cited, not redistributed",
  "attribution": "Gibbons et al. (2015), Gondwana Research (Elsevier)", "retrievedAt": "2026-09-15",
  "evidenceRole": "continental-or-crustal-extent",
  "constrains": "the authoring precedent this correction follows: the geometry Cao et al. (2024) ships as 'Greater India based on Gibbons et al. (2015) Gondwana Research' on plate 501 with a lifecycle that ends at 10 Ma - restored pre-collision crust carried as a first-class, retired feature",
  "tag": "Verbatim"},
]

STRIP_DOC = {
 "alps-adria-distal-margin-oct": ("distal Adriatic margin and ocean-continent transition, crust thinner than 10 km",
   "Le Breton et al. (2021) give 40-80 km for the distal margin of each conjugate; 60 km is the midpoint.",
   ["lebreton-2021-piemont-liguria"]),
 "alps-adria-necking-zone": ("Adriatic necking zone, crust thinning from about 30 km to about 10 km",
   "Le Breton et al. (2021) give 45-65 km for the necking zone of each conjugate; 55 km is the midpoint.",
   ["lebreton-2021-piemont-liguria"]),
 "alps-adria-proximal-retrowedge": ("proximal Adriatic margin shortened in the Southern Alpine retro-wedge",
   "56 km of 'post-Adamello phase shortening in the Southern Alps' plus 15 km of Insubric backthrusting (Schmid et al. 1996, through Schmid et al. 2004b).",
   ["schmid-1996-swiss-italian-transect", "schmid-2004-transmed"]),
 "alps-europe-distal-margin-oct": ("distal European and Briancconnais margin and OCT facing the Piemont-Liguria and Valais basins",
   "2 x 40 km, the floor of Le Breton et al. (2021)'s 40-80 km distal-margin range, once for the margin facing Piemont-Liguria and once for the margin facing the Valais; 234 km rather than 230 km only so the 0.02 deg transect sampling cannot read below the 230 km floor.",
   ["lebreton-2021-piemont-liguria"]),
 "alps-europe-outer-necking-zone": ("necking zone of the Briancconnais ribbon facing the Piemont-Liguria Basin",
   "45 km, the floor of Le Breton et al. (2021)'s 45-65 km necking range.",
   ["lebreton-2021-piemont-liguria"]),
 "alps-europe-inner-necking-zone": ("necking zone of the Briancconnais ribbon facing the Valais Basin",
   "45 km, the floor of Le Breton et al. (2021)'s 45-65 km necking range.",
   ["lebreton-2021-piemont-liguria"]),
 "alps-europe-proximal-subducted-margin": ("proximal European (Helvetic-Dauphinois) margin consumed beneath the orogen",
   "60 km, below Handy et al. (2010)'s 63 km of post-Eocene shortening north of the Insubric Line and well below their 'about 100 km' assumed width of a subducted continental margin.",
   ["handy-2010-alpine-tethys"]),
 "caledonides-baltica-distal-margin-cot": ("distal Baltoscandian margin and dyke-intruded continent-ocean transition",
   "Outer edge at 401 km west of the present Norwegian coastline: Gayer et al. (1987)'s 'at least 400 km W of the Norwegian coast', plus one kilometre so the 0.02 deg transect sampling cannot read below the published floor.",
   ["gayer-1987-baltoscandian-margin", "gee-2013-baltoscandian-subduction", "lorenz-2011-cosc-workshop"]),
 "caledonides-baltica-outer-shelf": ("outer Baltoscandian shelf, the source of the Middle Allochthon",
   "130-250 km west of the coast: restoring Gee (1978)'s 'at least 400 km' of ESE transport from the Seve outcrop belt puts the root of the Middle Allochthon about 250-290 km west of the coast at 66 N.",
   ["gee-1978-nappe-displacement", "lorenz-2015-cosc1", "gee-2013-baltoscandian-subduction"]),
 "caledonides-baltica-middle-allochthon-root": ("inner Baltoscandian shelf, from the coast to the restored Middle Allochthon root",
   "0-130 km west of the coast: the same restoration puts the root about 141 km west of the coast at 63.4 N.",
   ["gee-1978-nappe-displacement", "lorenz-2015-cosc1", "gee-2008-platforms-to-orogen"]),
 "caledonides-laurentia-distal-margin-cot": ("distal Laurentian (East Greenland) margin and continent-ocean transition",
   "100-202 km east of the present Greenland continental outline: Lorenz et al. (2011)'s Greenland thrust sheets 'transported at least two hundred kilometers westwards onto the platform'; 202 km rather than 200 km only so the 0.02 deg transect sampling cannot read below the published floor.",
   ["lorenz-2011-cosc-workshop", "fossen-2010-extensional-tectonics"]),
 "caledonides-laurentia-proximal-margin": ("proximal Laurentian (East Greenland) margin",
   "0-100 km east of the present Greenland continental outline, the inner half of the same 200 km restoration.",
   ["lorenz-2011-cosc-workshop", "fossen-2010-extensional-tectonics"]),
}

CONSUMPTION = {
 "alps": {
  "basis": "the model's own measured Adria-Europe closure on the 10 E transect (Po plain on plate 307 to the Molasse basin on plate 305), reduced by the present-day 366.9 km pin separation to give the width of the open seam at each age; a strip retires at the youngest published stage boundary at which the surviving strips still fit inside that seam",
  "seamKm": {"84": 738.2, "70": 582.6, "65": 536.6, "60": 517.6, "55": 500.7, "50": 473.3,
             "45": 429.0, "40": 371.5, "35": 301.5, "32": 263.8, "30": 244.8, "25": 196.4,
             "20": 146.9, "19": 140.1, "15": 112.8, "10": 77.9, "5": 39.0, "0": 0.0},
  "stageBoundarySource": "Schmid et al. (1996) convergence stages 65-50, 50-40, 40-32, 32-19, 19-0 Ma, through Schmid et al. (2004b); Le Breton et al. (2021)'s 84/35/0 Ma budget",
  "scheduleAgesMa": [45.0, 40.0, 35.0, 32.0, 25.0, 19.0, 10.0, 5.0],
  "maxInterStageOverflowKm": 39.1,
  "overflowNote": (
   "The schedule is snapped to published stage boundaries, so at every retirement age the "
   "surviving strips fit inside the measured seam, but between two boundaries the model closes "
   "faster than the schedule retires: the surviving strips exceed the seam by 39.1 km at 20 Ma "
   "and by 18.2 km at 15 Ma. That excess is authored crust the model leaves no room for at that "
   "instant, and it is recorded rather than removed: moving a retirement age off a published "
   "stage boundary would replace a cited stage with a fitted one."),
 },
 "caledonides": {
  "basis": "the Scandian collision window 430-400 Ma of the published literature, cross-checked against the model's own Baltica-Greenland crust-to-crust minimum gap, which closes to zero at 432 Ma and then re-opens",
  "modelGapKm": {"450": 2054.3, "445": 1636.6, "440": 1155.6, "438": 865.4, "436": 538.0,
                 "435": 372.3, "434": 206.3, "432": 0.0, "430": 0.0, "420": 0.0, "410": 0.0, "400": 0.0},
  "stageBoundarySource": "Scandian collision 430-400 Ma; Devonian extensional collapse 403-380 Ma (Fossen 2010)",
 },
}


def build(alps: dict, caledonides: dict, digests: dict, region: Path) -> dict:
    """Assemble the tracked manifest from the two compiled collections."""
    documents = {"alps": (region / ALPS_GEOMETRY, alps),
                 "caledonides": (region / CALEDONIDES_GEOMETRY, caledonides)}
    features = []
    for collision, (path, document) in documents.items():
        for row in document["features"]:
            properties = row["properties"]
            base = row["id"].rsplit("-plate-", 1)[0]
            role, derivation, source_ids = STRIP_DOC[base]
            margin = properties["margin"]
            valid = properties["validTimeMa"]
            features.append({
                "correctionFeatureId": row["id"],
                "collision": collision,
                "margin": margin,
                "materialRole": "restored-collision-margin",
                "epistemicStatus": "model-inference",
                "coordinateFrame": "WGS84-reference-coordinates",
                "geometryReferenceAgeMa": 0,
                "geometryAsset": {"path": path.name, "featureId": row["id"],
                                  "sha256": sha(path), "bytes": path.stat().st_size},
                "pose": {"plateId": properties["plateId"],
                         "method": "cao-rigid-plate-motion",
                         "status": "model-inference",
                         "sourceOrHypothesis": POSE_BINDING_RULE,
                         "warning": POSE_WARNING},
                "phaseLifecycles": {PHASE: {
                    "validTimeMa": {"youngest": valid["youngest"], "oldest": valid["oldest"]},
                    "youngestExclusive": True,
                    "birth": {"status": "bounded", "intervalMa": properties["birthIntervalMa"]},
                    "loss": {"status": "bounded",
                             "intervalMa": [valid["youngest"], valid["youngest"]]},
                }},
                "restoredExtent": {
                    "widthKm": properties["restoredWidthKm"],
                    "datumOffsetKm": properties["datumOffsetKm"],
                    "areaKm2": properties["areaKm2"],
                    "datum": DATUM_DESCRIPTION[margin],
                    "role": role,
                    "widthDerivation": derivation,
                    "publishedSpreadKm": PUBLISHED_SPREAD_KM[margin],
                },
                "consumption": {
                    "consumedByMa": valid["youngest"],
                    "schedule": CONSUMPTION[collision]["basis"],
                    "stageBoundarySource": CONSUMPTION[collision]["stageBoundarySource"],
                },
                "surfaceEvidence": {"kind": "unknown", "reason": SURFACE_EVIDENCE_REASON},
                "uncertainty": {"spatial": LIMITATION_SPATIAL, "temporal": LIMITATION_TEMPORAL,
                                "exposure": LIMITATION_EXPOSURE},
                "sourceIds": source_ids,
                "editorial": (
                    f"Model inference after {EDITORIAL_REFERENCES[margin]}; published spread "
                    f"{PUBLISHED_SPREAD_KM[margin]} km; consumed by collision at "
                    f"{valid['youngest']:g} Ma in the model."),
                "rejectionConditions": list(REJECTION_CONDITIONS),
            })

    return {
        "schemaVersion": 1,
        "correctionId": CORRECTION_ID,
        "version": "1",
        "kind": "restored-pre-collision-continental-margin",
        "attribution": "Cao et al. (2024); literature cited, never redistributed.",
        "description": (
            "Restored pre-collision continental-margin crust for the Alps (Adria-Europe) and the "
            "Scandinavian Caledonides (Baltica-Laurentia), authored as cited model-inference charts "
            "with lifecycles that retire each strip as the collision consumes it - the way Cao et al. "
            "(2024) carry 'Greater India based on Gibbons et al. (2015) Gondwana Research' on plate 501 "
            "with a lifecycle that ends at 10 Ma. It is crust, not land: no shoreline, depth or height "
            "claim is made anywhere."),
        "baseline": {
            "modelId": "cao-et-al-2024", "modelVersion": "2.4",
            "sourceCollections": dict(sorted(digests.items())),
            "coordinateFrame": {"absoluteFrameId": "palaeomagnetic", "anchorPlateId": 0,
                                "axisConvention": "gplates-x0e-y90e-znorth"},
        },
        "emission": {
            "batchId": "material-correction-restored-margin",
            "phase": PHASE,
            "sourceFeatureType": SOURCE_TYPE,
            "chartIdTemplate": f"correction:{CORRECTION_ID}:<correctionFeatureId>:{PHASE}",
            "poseStatus": "model-inference",
            "materialStatus": "restored-consumed-margin",
            "overlapPolicy": "native-visual-and-picking-precedence",
            "surfaceAppearance": "shelf",
            "staticDisplayControl": {"displayHeightMetres": 0},
            "appearanceRationale": (
                "the strips draw with the shelf (crust, depth-unmapped) appearance and below "
                "palaeo-shallow-marine in the stacking, never with the land appearance the other "
                "material-correction batches carry: they must not read as cited land"),
            "limitations": [LIMITATION_SPATIAL, LIMITATION_TEMPORAL, LIMITATION_EXPOSURE,
                            LIMITATION_PHASE],
        },
        "consumptionModel": CONSUMPTION,
        "sourceAssets": SOURCES,
        "features": features,
    }
