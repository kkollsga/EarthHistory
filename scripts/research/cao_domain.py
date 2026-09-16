"""Shared Cao 2024 v2.4 domain bounds for foundation emitters."""

CAO_SOURCE_YOUNGEST_MA = 0.0
CAO_SOURCE_OLDEST_MA = 1800.0
PUBLIC_FOUNDATION_MAX_BYTES = 50 * 1024 * 1024

# Dense 5 Ma through 540 Ma (existing package), then 10 Ma to the source oldest
# so the public Pages budget remains reachable while motion still uses every
# qualified source rotation knot.
DENSE_CHECKPOINT_UNTIL_MA = 540.0
COARSE_CHECKPOINT_STEP_MA = 10.0


def display_checkpoint_ages_ma(oldest_ma: float = CAO_SOURCE_OLDEST_MA) -> list[float]:
    ages = {float(age) for age in range(0, int(min(DENSE_CHECKPOINT_UNTIL_MA, oldest_ma)) + 1, 5)}
    age = DENSE_CHECKPOINT_UNTIL_MA + COARSE_CHECKPOINT_STEP_MA
    while age <= oldest_ma:
        ages.add(float(age))
        age += COARSE_CHECKPOINT_STEP_MA
    ages.add(float(oldest_ma))
    return sorted(ages)


# ---------------------------------------------------------------------------
# Country-outline / basement-domain matching
#
# A ``domain-fragment-replacement`` override suppresses a native Cao static
# fragment and replaces it with mapped basement-domain tiles. The modern-country
# reference line inherits that fragment's motion, so every country segment over
# the suppressed fragment has to resolve to a replacement tile. Segments farther
# than ``MAXIMUM_DOMAIN_MATCH_KM`` from every tile sit over ground the
# replacement declares unmapped: they are dropped from the country-reference
# line batch instead of being carried on a domain they do not touch
# (CLAUDE.md: unsupported fragments disappear rather than be placed with false
# precision). The tolerance and the sampling step are one contract shared by the
# emitter that builds the batch and the emitter that binds it, so a segment can
# never be dropped by one and required by the other.
# ---------------------------------------------------------------------------

import math

MAXIMUM_DOMAIN_MATCH_KM = 12
MAXIMUM_SEGMENT_SAMPLE_DEGREES = 0.1
KM_PER_DEGREE = 111.195


def unit_direction(vector):
    norm = math.sqrt(sum(axis * axis for axis in vector))
    return tuple(axis / norm for axis in vector)


def direction_lon_lat(direction):
    x, y, z = direction
    return math.degrees(math.atan2(y, x)), math.degrees(math.asin(max(-1, min(1, z))))


def sample_direction_arc(start, end, maximum_step_degrees=MAXIMUM_SEGMENT_SAMPLE_DEGREES):
    cosine = max(-1, min(1, sum(left * right for left, right in zip(start, end))))
    angle = math.acos(cosine)
    steps = max(1, math.ceil(math.degrees(angle) / maximum_step_degrees))
    for step in range(steps + 1):
        fraction = step / steps
        if angle < 1e-10:
            yield start
        else:
            scale = math.sin(angle)
            yield unit_direction(tuple(
                math.sin((1 - fraction) * angle) / scale * start[axis]
                + math.sin(fraction * angle) / scale * end[axis]
                for axis in range(3)
            ))


def local_ring(ring, longitude, latitude):
    cosine = max(1e-6, math.cos(math.radians(latitude)))
    return [((((point[0] - longitude + 180) % 360) - 180) * cosine * KM_PER_DEGREE,
             (point[1] - latitude) * KM_PER_DEGREE) for point in ring]


def point_in_ring_origin(ring):
    inside = False
    for index, (left_x, left_y) in enumerate(ring):
        right_x, right_y = ring[(index + 1) % len(ring)]
        if ((left_y > 0) != (right_y > 0)
                and 0 < (right_x - left_x) * (-left_y) / (right_y - left_y) + left_x):
            inside = not inside
    return inside


def segment_distance_origin(left, right):
    dx, dy = right[0] - left[0], right[1] - left[1]
    length_squared = dx * dx + dy * dy
    if length_squared <= 1e-18:
        return math.hypot(*left)
    fraction = max(0, min(1, -(left[0] * dx + left[1] * dy) / length_squared))
    return math.hypot(left[0] + fraction * dx, left[1] + fraction * dy)


def geometry_distance_km(geometry, longitude, latitude):
    polygons = geometry["coordinates"] if geometry["type"] == "MultiPolygon" else [geometry["coordinates"]]
    minimum = math.inf
    for polygon in polygons:
        rings = [local_ring(ring, longitude, latitude) for ring in polygon]
        if point_in_ring_origin(rings[0]) and not any(point_in_ring_origin(ring) for ring in rings[1:]):
            return 0.0
        for ring in rings:
            for index, left in enumerate(ring):
                minimum = min(minimum, segment_distance_origin(left, ring[(index + 1) % len(ring)]))
    return minimum


def segment_domain_match(start, end, features,
                         maximum_step_degrees=MAXIMUM_SEGMENT_SAMPLE_DEGREES):
    """Nearest-domain evidence for one country segment.

    Returns the worst per-sample distance along the arc and the domain ids that
    are nearest at some sample. The caller compares the distance with
    ``MAXIMUM_DOMAIN_MATCH_KM``; it is never rounded before that comparison.
    """
    domain_ids = set()
    maximum_distance = 0.0
    for sample in sample_direction_arc(start, end, maximum_step_degrees):
        longitude, latitude = direction_lon_lat(sample)
        distances = [(geometry_distance_km(feature["geometry"], longitude, latitude),
                      str(feature["id"])) for feature in features]
        nearest = min(distance for distance, _ in distances)
        maximum_distance = max(maximum_distance, nearest)
        domain_ids.update(feature_id for distance, feature_id in distances
                          if abs(distance - nearest) <= 1e-6)
    return maximum_distance, sorted(domain_ids)
