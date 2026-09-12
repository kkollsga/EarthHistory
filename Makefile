.PHONY: gate gate-ci gate-full gate-full-ci typecheck test build test-e2e test-e2e-ci check-dev-docs check-corrections \
	check-build-cache check-app-artifacts check-agents self-test-gates \
	prune-build-cache sync-agents

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
	@python3 scripts/research/cao_material_corrections.py --self-test
	@python3 scripts/research/cao_material_corrections.py

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
