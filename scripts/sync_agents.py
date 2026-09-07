#!/usr/bin/env python3
"""Regenerate Codex adapters from the Claude-side doctrine authorities."""

from __future__ import annotations

import argparse
import shutil
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
AUTHORITY_HEADING = "# EarthHistory — Claude Code Conventions"
ADAPTER_HEADING = "# EarthHistory — Codex Conventions"


def adapt(text: str) -> str:
    """Apply name-only substitution while preserving the authority declaration."""
    lines = text.splitlines(keepends=True)
    output: list[str] = []
    in_authority = False
    for line in lines:
        if line.startswith("**Authority:**"):
            in_authority = True
        elif in_authority and not line.strip():
            in_authority = False

        if line.startswith(AUTHORITY_HEADING):
            line = line.replace(AUTHORITY_HEADING, ADAPTER_HEADING, 1)
        elif not in_authority:
            line = line.replace("CLAUDE.md", "AGENTS.md")
        output.append(line)
    return "".join(output)


def check(authority: Path, agent_path: Path, source: Path, destination: Path) -> int:
    expected_agent = adapt(authority.read_text())
    if not agent_path.is_file() or agent_path.read_text() != expected_agent:
        print("sync-agents: FAIL: AGENTS.md differs from CLAUDE.md authority")
        return 1
    source_files = {path.relative_to(source) for path in source.glob("*/SKILL.md")}
    destination_files = {path.relative_to(destination) for path in destination.glob("*/SKILL.md")} if destination.is_dir() else set()
    if source_files != destination_files:
        print("sync-agents: FAIL: adapter skill inventory differs from authority")
        return 1
    for relative in source_files:
        if (destination / relative).read_text() != adapt((source / relative).read_text()):
            print(f"sync-agents: FAIL: stale adapter {destination / relative}")
            return 1
    print("sync-agents: adapters match authorities")
    return 0


def self_test() -> int:
    with tempfile.TemporaryDirectory() as temporary:
        root = Path(temporary)
        authority = root / "CLAUDE.md"
        agent = root / "AGENTS.md"
        source = root / ".claude" / "skills"
        destination = root / ".agents" / "skills"
        authority.write_text(AUTHORITY_HEADING + "\nAuthority body\n")
        agent.write_text(adapt(authority.read_text()))
        (source / "fixture").mkdir(parents=True)
        (destination / "fixture").mkdir(parents=True)
        (source / "fixture" / "SKILL.md").write_text("# Source\n")
        (destination / "fixture" / "SKILL.md").write_text("# stale\n")
        if check(authority, agent, source, destination) != 1:
            print("sync-agents self-test: FAIL: stale adapter passed")
            return 1
    print("sync-agents self-test: expected stale-adapter failure observed")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        return self_test()
    authority = ROOT / "CLAUDE.md"
    if not authority.is_file():
        raise SystemExit("sync-agents: CLAUDE.md authority is missing")

    source = ROOT / ".claude" / "skills"
    destination = ROOT / ".agents" / "skills"
    if not source.is_dir() or not any(source.glob("*/SKILL.md")):
        raise SystemExit("sync-agents: .claude/skills authority is empty")
    if args.check:
        return check(authority, ROOT / "AGENTS.md", source, destination)
    (ROOT / "AGENTS.md").write_text(adapt(authority.read_text()))
    if destination.exists():
        shutil.rmtree(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(source, destination)
    for skill in destination.glob("*/SKILL.md"):
        skill.write_text(adapt(skill.read_text()))

    print("sync-agents: regenerated AGENTS.md and .agents/skills")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
