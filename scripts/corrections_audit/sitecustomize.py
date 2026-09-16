"""Record which project files a correction validator actually touches.

`scripts/run_corrections.py` puts this directory on ``PYTHONPATH`` so every
validator interpreter it starts imports this module at startup, before the
validator itself. The audit hook collects the project paths the run opens,
renames, or lists; the driver turns that set into the validator's input digest.
Nothing here changes what a validator asserts: without
``EARTHHISTORY_CORRECTIONS_RECORD_DIR`` the module is inert.
"""

from __future__ import annotations

import atexit
import json
import os
import sys

_RECORD_DIR = os.environ.get("EARTHHISTORY_CORRECTIONS_RECORD_DIR")
_EXCLUDED = ("/.git/", "/node_modules/", "/__pycache__/", "/.cache/", "/dist/", "/test-results/")


def _install() -> None:
    roots = tuple(
        os.path.realpath(entry)
        for entry in os.environ.get("EARTHHISTORY_CORRECTIONS_RECORD_ROOTS", "").split(os.pathsep)
        if entry
    )
    if not roots:
        return
    files: set[str] = set()
    directories: set[str] = set()

    def keep(raw: object) -> str | None:
        if isinstance(raw, bytes):
            try:
                raw = raw.decode()
            except UnicodeDecodeError:
                return None
        if not isinstance(raw, str) or not raw:
            return None
        try:
            resolved = os.path.realpath(raw)
        except (OSError, ValueError):
            return None
        if not resolved.startswith(roots):
            return None
        if any(marker in f"{resolved}/" for marker in _EXCLUDED):
            return None
        return resolved

    def hook(event: str, args: tuple) -> None:
        if event == "open":
            path = keep(args[0])
            if path is not None:
                files.add(path)
        elif event in ("os.rename", "os.replace", "os.link", "os.symlink"):
            for raw in args[:2]:
                path = keep(raw)
                if path is not None:
                    files.add(path)
        elif event in ("os.remove", "os.unlink"):
            path = keep(args[0])
            if path is not None:
                files.add(path)
        elif event in ("os.listdir", "os.scandir", "glob.glob"):
            path = keep(args[0])
            if path is not None:
                directories.add(path)

    def flush() -> None:
        # Imported helper modules are inputs too: editing cao_domain.py must
        # invalidate every validator that imports it.
        for module in list(sys.modules.values()):
            path = keep(getattr(module, "__file__", None))
            if path is not None:
                files.add(path)
        record = {"files": sorted(files), "directories": sorted(directories)}
        target = os.path.join(_RECORD_DIR, f"{os.getpid()}-{len(files)}-{id(record)}.json")
        try:
            with open(target, "w", encoding="utf-8") as handle:
                json.dump(record, handle)
        except OSError:
            pass

    sys.addaudithook(hook)
    atexit.register(flush)


if _RECORD_DIR:
    _install()
