#!/usr/bin/env python3
"""Ring hygiene shared by the LGM derivation and the interval compiler.

Two artefacts survive every polygon pipeline that meets a coarser source than
the grid it is measured on, and neither is a claim about a shoreline:

* **spikes** - a vertex whose two edges double back along each other. Removing
  it closes the needle without moving any other vertex;
* **needle holes** - an interior ring so thin that it encloses no ground the
  renderer can fill. Its mean width is ``4 * area / perimeter`` (a rectangle of
  length L and width w has area wL and perimeter 2(L+w), so the ratio returns w
  for L >> w); below the int16 quantisation error the two walls cross and the
  ear-clip fills the ring with hairline triangles instead of leaving a hole.

Both filters run on the ring that will be *shipped* - after node reduction and
before quantisation - so they judge the geometry the renderer sees rather than
the staircase it came from. Neither invents a vertex: a spike removal deletes
one node, and a needle hole is deleted whole.

Import under the pinned pyGPlates environment; spherical areas come from
``palaeo_coastlines_audit``, exactly as the rest of the pipeline measures area.
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

from shapely.geometry import Polygon

sys.path.insert(0, str(Path(__file__).resolve().parent))
import palaeo_coastlines_audit as audit  # noqa: E402


EARTH_RADIUS_KM = audit.EARTH_RADIUS_KM
KM_PER_DEGREE = EARTH_RADIUS_KM * math.pi / 180.0
# Vertices sharper than this are spikes, not shore.
MINIMUM_INTERIOR_ANGLE_DEGREES = 3.0
# Narrowest interior ring worth shipping, and the same number the LGM
# derivation opens its exposed shelf at. Set well above the int16 quantisation
# error (0.0055 deg lon, 0.0027 deg lat) so no surviving hole is narrow enough
# for quantisation to turn inside out.
MINIMUM_HOLE_WIDTH_KM = 1.5


def ring_cosine(bounds) -> float:
    """Longitude scale at the middle latitude of ``bounds``.

    Every measurement here is planar in degrees; without this factor a degree of
    longitude would count as a degree of latitude and an angle at 66 N would be
    read roughly 2.5 times too wide.
    """
    _, south, _, north = bounds
    return max(math.cos(math.radians((south + north) / 2.0)), 0.1)


def interior_angle_degrees(before, vertex, after, cosine: float) -> float:
    ax = (before[0] - vertex[0]) * cosine
    ay = before[1] - vertex[1]
    bx = (after[0] - vertex[0]) * cosine
    by = after[1] - vertex[1]
    first = math.hypot(ax, ay)
    second = math.hypot(bx, by)
    if first == 0.0 or second == 0.0:
        return 0.0
    cosine_angle = max(-1.0, min(1.0, (ax * bx + ay * by) / (first * second)))
    return math.degrees(math.acos(cosine_angle))


def despike_ring(coordinates, minimum_degrees: float, cosine: float):
    """Drop vertices whose interior angle is below ``minimum_degrees``.

    A spike is a vertex whose two edges double back along each other; removing
    it closes the needle without moving any other vertex. Removal can expose a
    new spike at a neighbour, so the pass repeats until the ring is clean or too
    short to be a ring at all. Returns the ring and how many vertices went.
    """
    points = list(coordinates)
    if len(points) >= 2 and points[0] == points[-1]:
        points = points[:-1]
    removed = 0
    while len(points) > 3:
        total = len(points)
        sharpest = None
        for index in range(total):
            angle = interior_angle_degrees(points[index - 1], points[index],
                                           points[(index + 1) % total], cosine)
            if angle < minimum_degrees and (sharpest is None or angle < sharpest[0]):
                sharpest = (angle, index)
        if sharpest is None:
            break
        points.pop(sharpest[1])
        removed += 1
    if len(points) < 3:
        return None, removed
    return points + [points[0]], removed


def ring_width_km(coordinates, cosine: float) -> float:
    """Mean width of a ring: ``4 * area / perimeter``, in kilometres.

    Zero for a ring that encloses nothing, which is what a three-vertex hole
    around Iceland measures.
    """
    points = list(coordinates)
    if len(points) < 2:
        return 0.0
    if points[0] != points[-1]:
        points = points + [points[0]]
    perimeter = 0.0
    for first, second in zip(points, points[1:]):
        perimeter += math.hypot((second[0] - first[0]) * cosine, second[1] - first[1])
    perimeter *= KM_PER_DEGREE
    if perimeter <= 0.0:
        return 0.0
    return 4.0 * audit.ring_area_km2(points) / perimeter


def blank_report() -> dict:
    return {"spikeVertices": 0, "spikeRings": 0, "collapsedRings": 0,
            "droppedHoleRings": 0, "droppedHoleAreaSquareKilometres": 0.0,
            "repairedParts": 0, "declinedParts": 0}


def polish_parts(parts, minimum_degrees: float = MINIMUM_INTERIOR_ANGLE_DEGREES,
                 minimum_hole_width_km: float = 0.0,
                 minimum_hole_area_km2: float = 0.0,
                 repair: bool = True, report: dict | None = None) -> tuple[list, dict]:
    """Despike every ring of every part and drop the interior rings that are needles.

    ``minimum_hole_width_km`` and ``minimum_hole_area_km2`` default to off, so a
    caller that only wants the spike filter gets exactly that. A hole is measured
    before it is despiked: a needle has nothing worth despiking, and despiking one
    can collapse it below three vertices anyway.

    ``repair`` decides what happens to a part the edit leaves invalid. The LGM
    derivation repairs with ``buffer(0)`` and re-splits, because it is building
    one mask and the part count is not a contract. The interval compiler declines
    instead: a piece that has already passed the seam and assembly rules keeps its
    unpolished rings rather than being restructured behind those rules' backs.
    """
    if report is None:
        report = blank_report()
    cleaned: list = []
    for part in parts:
        cosine = ring_cosine(part.bounds)
        exterior, gone = despike_ring(part.exterior.coords, minimum_degrees, cosine)
        if gone:
            report["spikeVertices"] += gone
            report["spikeRings"] += 1
        if exterior is None:
            report["collapsedRings"] += 1
            continue
        holes = []
        for interior in part.interiors:
            area = audit.ring_area_km2(interior.coords)
            if (area < minimum_hole_area_km2
                    or ring_width_km(interior.coords, cosine) < minimum_hole_width_km):
                report["droppedHoleRings"] += 1
                report["droppedHoleAreaSquareKilometres"] += area
                continue
            hole, gone = despike_ring(interior.coords, minimum_degrees, cosine)
            if gone:
                report["spikeVertices"] += gone
                report["spikeRings"] += 1
            if hole is None:
                report["collapsedRings"] += 1
                report["droppedHoleRings"] += 1
                report["droppedHoleAreaSquareKilometres"] += area
                continue
            holes.append(hole)
        candidate = Polygon(exterior, holes)
        if not candidate.is_valid:
            if not repair:
                report["declinedParts"] += 1
                cleaned.append(part)
                continue
            report["repairedParts"] += 1
            candidate = candidate.buffer(0)
        cleaned.extend(audit.polygon_parts(candidate))
    return cleaned, report
