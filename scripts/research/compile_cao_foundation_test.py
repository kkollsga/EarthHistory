#!/usr/bin/env python3

import hashlib
import math
import struct
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
import compile_cao_foundation as compiler  # noqa: E402


class CaoFoundationPrecisionTest(unittest.TestCase):
    def test_serialized_float32_triangle_is_the_validation_geometry(self):
        native = (
            (-0.7495435045987886, 0.47007679755596243, -0.4660604457721085),
            (-0.74948002651706, 0.47008718575988123, -0.4661520434754544),
            (-0.7494165266386009, 0.4700975700033434, -0.4662436533379161),
        )
        emitted = tuple(compiler.quantized_direction(point) for point in native)
        self.assertLess(compiler.triangle_area(*native), 1e-14)
        self.assertGreater(compiler.triangle_area(*emitted), 1e-12)
        self.assertAlmostEqual(
            compiler.triangle_area(*emitted), 2.024562844657345e-12, places=24
        )

    def test_stable_area_subtracts_a_hole_regardless_of_winding(self):
        def direction(longitude, latitude):
            longitude, latitude = map(math.radians, (longitude, latitude))
            return (
                math.cos(latitude) * math.cos(longitude),
                math.cos(latitude) * math.sin(longitude),
                math.sin(latitude),
            )

        outer = [direction(*point) for point in ((0, 0), (4, 0), (4, 4), (0, 4))]
        hole = [direction(*point) for point in ((1, 1), (2, 1), (2, 2), (1, 2))]
        centre = direction(3, 3)
        same_winding = compiler.stable_polygon_area([outer, hole], centre)
        reverse_winding = compiler.stable_polygon_area(
            [outer, list(reversed(hole))], centre
        )
        exterior = compiler.stable_polygon_area([outer], centre)
        self.assertAlmostEqual(same_winding, reverse_winding, places=15)
        self.assertLess(same_winding, exterior)

    def test_pinned_two_opt_repair_removes_crossing_and_fails_on_mutation(self):
        values = struct.unpack(
            "<12f",
            bytes.fromhex(
                "f46900bf44374c3f365eabbe997200bf593a4c3f9935abbefc7500bf"
                "5f364c3f683eabbeee6900bf85444c3f101fabbe"
            ),
        )
        ring = [values[index : index + 3] for index in range(0, 12, 3)]
        centre = compiler.unit(tuple(sum(point[axis] for point in ring) for axis in range(3)))
        digest = hashlib.sha256(
            b"".join(struct.pack("<fff", *point) for point in ring)
        ).hexdigest()
        contract = {
            "fixture": {
                "ringIndex": 0,
                "firstEdgeStart": 0,
                "secondEdgeStart": 2,
                "windowSha256": digest,
            }
        }
        with patch.object(compiler, "SOURCE_RING_REPAIRS", contract):
            self.assertEqual(
                compiler.proper_self_intersections(
                    compiler.project_ring(ring, centre)
                ),
                [(0, 2)],
            )
            repaired, record = compiler.repair_source_ring(
                "fixture", 0, ring, centre
            )
            self.assertEqual(record["kind"], "vertex-preserving-2-opt-untangling")
            self.assertFalse(
                compiler.proper_self_intersections(
                    compiler.project_ring(repaired, centre)
                )
            )
            mutated = list(ring)
            mutated[0] = (mutated[0][0] + 1e-5, *mutated[0][1:])
            with self.assertRaisesRegex(ValueError, "repair window changed"):
                compiler.repair_source_ring("fixture", 0, mutated, centre)


if __name__ == "__main__":
    unittest.main()
