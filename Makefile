.PHONY: gate gate-ci gate-full gate-full-ci typecheck test build test-e2e test-e2e-ci check-dev-docs check-corrections \
	check-build-cache check-app-artifacts check-agents self-test-gates \
	check-palaeo-compile prune-build-cache sync-agents

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

test-e2e-ci:
	@npm run test:e2e:ci

# R4: local state is gitignored, so only a local gate can enforce its bound.
check-dev-docs:
	@python3 scripts/check_dev_docs.py --max-mb "$(DEV_DOCS_MAX_MB)"

check-corrections:
	@python3 scripts/research/cao_package_intern.py --self-test
	@python3 scripts/research/apply_cao_package_interning.py
	@python3 scripts/research/cao_material_corrections.py --self-test
	@python3 scripts/research/cao_material_corrections.py
	@python3 scripts/research/validate_regional_barents_shelf.py --self-test
	@python3 scripts/research/validate_regional_barents_shelf.py
	@python3 scripts/research/validate_cao_shelf_lifecycle_422.py --self-test
	@python3 scripts/research/validate_cao_shelf_lifecycle_422.py
	@python3 scripts/research/regional_iceland_correction.py --self-test --runtime
	@python3 scripts/research/regional_iceland_correction.py --runtime
	@python3 scripts/research/regional_iceland_shelf_correction.py --self-test
	@python3 scripts/research/regional_iceland_shelf_correction.py
	@python3 scripts/research/regional_panama_correction.py --self-test
	@python3 scripts/research/regional_observed_land_omission_correction.py --self-test --runtime
	@python3 scripts/research/regional_observed_land_omission_correction.py --runtime
	@python3 scripts/research/regional_lake_void_correction.py --self-test --runtime
	@python3 scripts/research/regional_lake_void_correction.py --runtime
	@python3 scripts/research/validate_north_sea_restoration.py --self-test
	@python3 scripts/research/validate_north_sea_restoration.py
	@python3 -m unittest scripts/research/apply_cao_native_triangulation_repair_test.py
	@python3 scripts/research/apply_cao_native_triangulation_repair.py
	@python3 -m unittest scripts/research/apply_regional_panama_land_test.py
	@python3 scripts/research/apply_regional_panama_land.py
	@python3 scripts/research/apply_cao_modern_country_reference.py
	@python3 scripts/research/apply_cao_country_segment_bridge.py --self-test
	@python3 scripts/research/apply_cao_country_segment_bridge.py
	@python3 -m unittest scripts/research/apply_regional_iceland_shelf_test.py
	@python3 scripts/research/apply_regional_iceland_shelf.py --validate-applied
	@python3 scripts/research/validate_cao_requested_age_motion_tiles.py --self-test
	@python3 scripts/research/validate_palaeo_coastlines_runtime.py --self-test >/dev/null
	@python3 scripts/research/validate_palaeo_coastlines_runtime.py >/dev/null
	@$(MAKE) --no-print-directory check-palaeo-compile

# The palaeo-coastline compile oracle reads the Cao source zips and the offline
# compiled store through the pinned pyGPlates environment, none of which a bare
# checkout has. Where they are present it must pass; where they are not it says
# so by name instead of reporting a pass. The published bytes are gated
# unconditionally by validate_palaeo_coastlines_runtime.py above.
PALAEO_PYTHON ?= ../EarthHistory-data/palaeomap-study/verification/pygplates-venv/bin/python
check-palaeo-compile:
	@if [ -x "$(PALAEO_PYTHON)" ]; then \
		"$(PALAEO_PYTHON)" scripts/research/palaeo_coastlines_correction.py --self-test >/dev/null \
		&& echo "palaeo_coastlines_correction --self-test: pass"; \
	else \
		echo "palaeo_coastlines_correction --self-test: not run, the pinned pyGPlates environment is absent ($(PALAEO_PYTHON))"; \
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

prune-build-cache:
	@python3 scripts/prune-build-cache.py --max-mb "$(BUILD_CACHE_MAX_MB)" --prune

# CLAUDE.md and .claude/skills are the authorities; adapters are generated.
sync-agents:
	@python3 scripts/sync_agents.py
