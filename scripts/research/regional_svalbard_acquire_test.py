#!/usr/bin/env python3
"""Focused acquisition-bound and pinning tests for the Svalbard source."""

from __future__ import annotations

import hashlib
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

MODULE_PATH = Path(__file__).with_name("regional_svalbard_acquire.py")
SPEC = importlib.util.spec_from_file_location("regional_svalbard_acquire", MODULE_PATH)
assert SPEC and SPEC.loader
acquire = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(acquire)


class RegionalSvalbardAcquireTest(unittest.TestCase):
    def test_response_content_length_is_rejected_before_body_read(self) -> None:
        class Response:
            headers = {"Content-Length": "11"}
            read_called = False

            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

            def read(self, _limit):
                self.read_called = True
                return b"oversized!!"

        response = Response()
        with patch.object(acquire.urllib.request, "urlopen", return_value=response):
            with self.assertRaisesRegex(AssertionError, "response exceeds remaining"):
                acquire.fetch("https://example.invalid/source", maximum_bytes=10)
        self.assertFalse(response.read_called)

    def test_response_without_length_uses_bounded_read(self) -> None:
        class Response:
            headers = {}
            read_limit = None

            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

            def read(self, limit):
                self.read_limit = limit
                return b"x" * limit

        response = Response()
        with patch.object(acquire.urllib.request, "urlopen", return_value=response):
            with self.assertRaisesRegex(AssertionError, "response exceeds remaining"):
                acquire.fetch("https://example.invalid/source", maximum_bytes=10)
        self.assertEqual(response.read_limit, 11)

    def test_whole_store_near_four_gib_rejects_region_staging(self) -> None:
        near_cap = int(3.99 * 1024 * 1024 * 1024)
        with self.assertRaisesRegex(AssertionError, "whole-source-store cap"):
            acquire.assert_capacity(near_cap, 0, acquire.REGION_CAP)

    def test_replacement_peak_counts_existing_and_staged_copy(self) -> None:
        with self.assertRaisesRegex(AssertionError, "staging whole-source-store cap"):
            acquire.assert_capacity(
                acquire.STORE_CAP - 8 * 1024 * 1024,
                64 * 1024 * 1024,
                16 * 1024 * 1024,
            )

    def test_pinned_hash_mutation_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            store = Path(temporary)
            source = store / "source.json"
            source.write_bytes(b"original")
            manifest = {
                "files": {
                    "source.json": {
                        "bytes": len(b"original"),
                        "sha256": hashlib.sha256(b"original").hexdigest(),
                    }
                },
                "source": {"featureCount": 1},
                "bounds": {},
            }
            (store / "source-manifest.json").write_text(json.dumps(manifest))
            source.write_bytes(b"mutated!")
            with self.assertRaisesRegex(AssertionError, "pinned source changed"):
                acquire.verify_pinned(store)


if __name__ == "__main__":
    unittest.main()
