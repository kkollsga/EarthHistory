#!/usr/bin/env python3
"""Focused mutation tests for the native Cao triangulation package appender."""

from __future__ import annotations

import copy
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import apply_cao_native_triangulation_repair as repair


def binding(entry_id: str, youngest: float, oldest: float) -> dict:
    return {
        "paletteId": "palette",
        "entryId": entry_id,
        "validTimeMa": {"youngest": youngest, "oldest": oldest},
    }


class NativeTriangulationApplyTest(unittest.TestCase):
    def test_only_pinned_source_discontinuity_gaps_are_accepted(self) -> None:
        bindings = [
            binding("native-recovery-plate-626-0-79.1", 0, 79.1),
            binding("native-recovery-plate-626-79.100001-119.999999", 79.100001, 119.999999),
            binding("native-recovery-plate-626-120-130", 120, 130),
            binding("native-recovery-plate-626-130-505", 130, 150),
        ]
        repair.validate_binding_coverage(bindings, 626, 0, 150)
        self.assertEqual(repair.motion_support_gaps(626, 0, 150), [
            {
                "validTimeMa": {"youngest": 79.1, "oldest": 79.100001},
                "youngestExclusive": True,
                "oldestExclusive": True,
                "reason": "source-seam",
                "sourceIds": ["doi:10.5281/zenodo.13628813"],
            },
            {
                "validTimeMa": {"youngest": 119.999999, "oldest": 120.0},
                "youngestExclusive": True,
                "oldestExclusive": True,
                "reason": "source-seam",
                "sourceIds": ["doi:10.5281/zenodo.13628813"],
            },
        ])

        undeclared = copy.deepcopy(bindings)
        undeclared[1]["validTimeMa"]["youngest"] = 79.100002
        with self.assertRaisesRegex(repair.BuildError, "unexpected native motion gap"):
            repair.validate_binding_coverage(undeclared, 626, 0, 150)

        ordinary_gap = [binding("younger", 0, 100), binding("older", 101, 150)]
        with self.assertRaisesRegex(repair.BuildError, "unexpected native motion gap"):
            repair.validate_binding_coverage(ordinary_gap, 801, 0, 150)

    def test_chart_carries_exact_open_gap_declarations(self) -> None:
        palette = {
            "id": "palette",
            "entries": [
                {"entryId": "native-recovery-plate-626-0-79.1", "plateId": 626,
                 "youngestAgeMa": 0, "oldestAgeMa": 79.1},
                {"entryId": "native-recovery-plate-626-79.100001-119.999999", "plateId": 626,
                 "youngestAgeMa": 79.100001, "oldestAgeMa": 119.999999},
                {"entryId": "native-recovery-plate-626-120-130", "plateId": 626,
                 "youngestAgeMa": 120, "oldestAgeMa": 130},
                {"entryId": "native-recovery-plate-626-130-505", "plateId": 626,
                 "youngestAgeMa": 130, "oldestAgeMa": 505},
            ],
        }
        patch = {
            "chartId": "source-chart", "materialId": "source-chart",
            "fragmentOrCohortId": "source-chart", "plateId": 626,
            "lifecycle": {"youngestAgeMa": 0, "oldestAgeMa": 150},
            "sourceFeatureIds": ["source-feature"],
            "sourceFeatureTypes": ["ClosedContinentalBoundary"],
        }
        chart = repair.chart(patch, palette)
        self.assertEqual(chart["motionSupportGaps"], repair.motion_support_gaps(626, 0, 150))
        self.assertEqual(chart["motionBindings"][0]["validTimeMa"], {"youngest": 0, "oldest": 79.1})
        self.assertEqual(chart["motionBindings"][-1]["validTimeMa"], {"youngest": 130, "oldest": 150})

    def test_mixed_triangle_ownership_is_rejected(self) -> None:
        decoded = {
            "directions": [(1.0, 0.0, 0.0), (0.0, 1.0, 0.0), (0.0, 0.0, 1.0), (-1.0, 0.0, 0.0)],
            "charts": [7, 7, 8, 8],
            "indices": [0, 1, 0, 2, 3, 2],
        }
        self.assertEqual(repair.extract_chart_geometry(decoded, 7)["indices"], [0, 1, 0])

        mutated = copy.deepcopy(decoded)
        mutated["indices"][:3] = [0, 1, 2]
        with self.assertRaisesRegex(repair.BuildError, "mixed triangle ownership"):
            repair.extract_chart_geometry(mutated, 7)


if __name__ == "__main__":
    unittest.main()
