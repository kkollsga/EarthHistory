.PHONY: gate gate-fast gate-ci gate-full gate-full-ci typecheck test build test-e2e test-e2e-ci \
	check-dev-docs check-corrections check-corrections-changed check-corrections-all \
	check-build-cache check-app-artifacts check-agents self-test-gates \
	check-palaeo-compile check-precollision-extent check-restored-margins \
	prune-build-cache sync-agents

# Which gate to run when
# ---------------------
#   gate-fast  iteration, seconds: types, unit/data tests, the correction
#              validators that changed, build, artifact bounds. It asserts
#              exactly what those checks assert; it just skips the local
#              working-state and adapter-mirror checks and reuses the
#              validator digest cache.
#   gate       per commit: gate-fast's checks plus check-dev-docs,
#              check-agents and the build-cache bound, with every correction
#              validator considered (cached ones are named as cached passes).
#   gate-full  batch or release confidence reset: gate plus the browser suite,
#              which is the only target that needs an installed Chromium.
#              Run it once at program completion, and before a release.
# CORRECTIONS_JOBS bounds the validator pool; CORRECTIONS_CACHE=--no-cache
# forces every validator to run even when its recorded inputs are unchanged.

DEV_DOCS_MAX_MB ?= 50
BUILD_CACHE_MAX_MB ?= 100
DIST_MAX_MB ?= 50
DIST_MAX_FILE_MB ?= 9

# The explicit sub-makes keep build and artifact inspection ordered under -j.
gate:
	@$(MAKE) check-dev-docs
	@$(MAKE) check-corrections
	@$(MAKE) check-build-cache
	@$(MAKE) check-agents
	@$(MAKE) typecheck
	@$(MAKE) test
	@$(MAKE) build
	@$(MAKE) check-app-artifacts
	@$(MAKE) check-build-cache
	@echo "gate: doctrine, types, unit/data tests, build, and artifact checks passed"

# Iteration gate: the same assertions, without the local working-state and
# adapter-mirror checks, and with the correction validators served from their
# input-digest cache.
gate-fast:
	@$(MAKE) typecheck
	@$(MAKE) test
	@$(MAKE) check-corrections
	@$(MAKE) build
	@$(MAKE) check-app-artifacts
	@echo "gate-fast: types, unit/data tests, correction validators, build, and artifact checks passed"

# CI has no gitignored skill authority; keep the mirror check in the local gate.
gate-ci:
	@$(MAKE) check-dev-docs
	@$(MAKE) check-corrections
	@$(MAKE) check-build-cache
	@$(MAKE) typecheck
	@$(MAKE) test
	@$(MAKE) build
	@$(MAKE) check-app-artifacts
	@$(MAKE) check-build-cache
	@echo "gate-ci: types, unit/data tests, build, and artifact checks passed"

# Browser coverage is intentionally explicit because it installs/runs Chromium in CI.
gate-full:
	@$(MAKE) gate
	@$(MAKE) test-e2e
	@$(MAKE) check-app-artifacts
	@echo "gate-full: application and browser checks passed"

gate-full-ci:
	@$(MAKE) gate-ci
	@$(MAKE) test-e2e-ci
	@$(MAKE) check-app-artifacts
	@echo "gate-full-ci: application and browser checks passed"

typecheck:
	@npm run typecheck

test:
	@npm run test:run

build:
	@npm run build

test-e2e:
	@npm run test:e2e:built

# The GitHub runner has two cores and renders through swiftshader; two workers
# starve both @ci tests past their 20 s first-paint budget (main run 35093699520).
test-e2e-ci:
	@EARTHHISTORY_TEST_WORKERS=1 npm run test:e2e:ci

# R4: local state is gitignored, so only a local gate can enforce its bound.
check-dev-docs:
	@python3 scripts/check_dev_docs.py --max-mb "$(DEV_DOCS_MAX_MB)"

CORRECTIONS_JOBS ?= 6
CORRECTIONS_CACHE ?=

# The thirty-eight validator lines this replaces are independent oracles over
# the same tracked inputs. scripts/run_corrections.py keeps their commands and
# output verbatim, runs the mutating apply_* ones first and one at a time, then
# the rest in a bounded pool, and reports a validator whose recorded inputs and
# outputs are unchanged since its last green run as a cached pass.
check-corrections:
	@python3 scripts/run_corrections.py --jobs "$(CORRECTIONS_JOBS)" $(CORRECTIONS_CACHE)

# The cache already limits a run to the validators whose inputs changed; this
# name exists for the iteration loop that wants to say so.
check-corrections-changed: check-corrections

# Ignore the cache: every validator runs, as the sequential recipe always did.
check-corrections-all:
	@python3 scripts/run_corrections.py --jobs "$(CORRECTIONS_JOBS)" --no-cache

# The palaeo-coastline compile oracle reads the Cao source zips and the offline
# compiled store through the pinned pyGPlates environment, and the Iceland
# contract re-derives its geometry from the pinned NI bedrock snapshot through
# the same one. A bare checkout has none of them. Where they are present it must pass; where they are not it says
# so by name instead of reporting a pass. The published bytes are gated
# unconditionally by validate_palaeo_coastlines_runtime.py in check-corrections.
PALAEO_PYTHON ?= ../EarthHistory-data/palaeomap-study/verification/pygplates-venv/bin/python
check-palaeo-compile:
	@if [ -x "$(PALAEO_PYTHON)" ]; then \
		"$(PALAEO_PYTHON)" scripts/research/palaeo_coastlines_iceland_ops.py --check >/dev/null \
		&& "$(PALAEO_PYTHON)" scripts/research/palaeo_coastlines_iceland_ops.py --self-test >/dev/null \
		&& "$(PALAEO_PYTHON)" scripts/research/palaeo_coastlines_correction.py --self-test >/dev/null \
		&& echo "palaeo_coastlines_iceland_ops --check/--self-test and palaeo_coastlines_correction --self-test: pass"; \
	else \
		echo "palaeo_coastlines_iceland_ops and palaeo_coastlines_correction --self-test: not run, the pinned pyGPlates environment is absent ($(PALAEO_PYTHON))"; \
	fi

# The restored pre-collision margin contract has the same two halves. Its
# tracked and published checks run unconditionally in check-corrections;
# re-deriving the
# minimum gap between the restored Baltoscandian margin and the North-Sea-
# restored UK block at every Scandian age needs the pinned Cao model and
# pyGPlates, so it reports "not run" by name rather than a pass it did not earn.
check-restored-margins:
	@if [ -x "$(PALAEO_PYTHON)" ]; then \
		"$(PALAEO_PYTHON)" scripts/research/restored_margins_correction.py --model --self-test >/dev/null \
		&& "$(PALAEO_PYTHON)" scripts/research/restored_margins_correction.py --model >/dev/null \
		&& echo "restored_margins_correction (North Sea clearance re-derivation): pass"; \
	else \
		echo "restored_margins_correction (North Sea clearance re-derivation): not run, the pinned pyGPlates environment is absent ($(PALAEO_PYTHON))"; \
	fi

# The pre-collision extent gate has the same two halves. Its record-only run is
# unconditional in check-corrections: the literature minima, their references and the pinned
# verdicts need no model. Re-deriving the sixteen transects, nineteen overlaps
# and twenty convergences from the Cao 2024 model needs the same pinned
# environment the palaeo compile does, so it reports "not run" by name rather
# than reporting a pass it did not earn (R2/R10).
check-precollision-extent:
	@if [ -x "$(PALAEO_PYTHON)" ]; then \
		"$(PALAEO_PYTHON)" scripts/research/validate_precollision_extent.py >/dev/null \
		&& echo "validate_precollision_extent (model re-derivation): pass"; \
	else \
		echo "validate_precollision_extent (model re-derivation): not run, the pinned pyGPlates environment is absent ($(PALAEO_PYTHON))"; \
	fi

# R4: Vite/TypeScript caches have a named owner and explicit bound.
check-build-cache:
	@python3 scripts/prune-build-cache.py --max-mb "$(BUILD_CACHE_MAX_MB)"

check-app-artifacts:
	@python3 scripts/check-app-artifacts.py \
		--max-mb "$(DIST_MAX_MB)" \
		--max-file-mb "$(DIST_MAX_FILE_MB)"

check-agents:
	@python3 scripts/sync_agents.py --check

self-test-gates:
	@python3 scripts/check_dev_docs.py --self-test
	@python3 scripts/check-app-artifacts.py --self-test
	@python3 scripts/prune-build-cache.py --self-test
	@python3 scripts/sync_agents.py --self-test
	@python3 scripts/run_corrections.py --self-test

prune-build-cache:
	@python3 scripts/prune-build-cache.py --max-mb "$(BUILD_CACHE_MAX_MB)" --prune

# CLAUDE.md and .claude/skills are the authorities; adapters are generated.
sync-agents:
	@python3 scripts/sync_agents.py
