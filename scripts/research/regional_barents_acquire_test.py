#!/usr/bin/env python3
"""Focused bounds and immutable-source tests for the Barents acquisition."""

from __future__ import annotations

import hashlib
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path


MODULE = Path(__file__).with_name("regional_barents_acquire.py")
SPEC = importlib.util.spec_from_file_location("regional_barents_acquire", MODULE)
assert SPEC and SPEC.loader
acquire = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(acquire)


class RegionalBarentsAcquireTest(unittest.TestCase):
    def test_region_and_aggregate_caps_are_independent(self) -> None:
        with self.assertRaisesRegex(AssertionError, "regional cap"):
            acquire.assert_capacity(0, 0, acquire.REGION_CAP + 1)
        with self.assertRaisesRegex(AssertionError, "aggregate cap"):
            acquire.assert_capacity(acquire.STORE_CAP - 1, 0, 2)

    def test_remaining_capacity_counts_staging_peak(self) -> None:
        value = acquire.remaining_capacity(acquire.STORE_CAP - 100, 80, 10)
        self.assertEqual(value, 90)

    def test_pinned_hash_mutation_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            store = Path(temporary)
            payload = b"source"
            (store / "source.json").write_bytes(payload)
            (store / "source-manifest.json").write_text(json.dumps({
                "files": {"source.json": {"bytes": len(payload), "sha256": hashlib.sha256(payload).hexdigest()}},
                "source": {"featureCount": 1},
            }))
            original = acquire.STORE
            try:
                acquire.STORE = store
                self.assertIsNotNone(acquire.verify_pinned())
                (store / "source.json").write_bytes(b"changed")
                with self.assertRaisesRegex(AssertionError, "pinned source changed"):
                    acquire.verify_pinned()
            finally:
                acquire.STORE = original


if __name__ == "__main__":
    unittest.main()
