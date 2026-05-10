.PHONY: help dev build test clean fmt contracts-build contracts-test contracts-fmt api-build api-test api-run web-build web-test web-dev compose-up compose-down devkit-start devkit-stop

help:
	@echo "Top-level targets:"
	@echo "  make build          — build all three subprojects"
	@echo "  make test           — run all tests"
	@echo "  make fmt            — format all sources"
	@echo "  make clean          — remove all build artifacts"
	@echo "  make compose-up     — start local Postgres for the BE"
	@echo "  make compose-down   — stop local Postgres"
	@echo "  make devkit-start   — start Yaci DevKit (requires separate install)"
	@echo "  make devkit-stop    — stop Yaci DevKit"
	@echo ""
	@echo "Subproject targets:"
	@echo "  contracts-build / contracts-test / contracts-fmt"
	@echo "  api-build / api-test / api-run"
	@echo "  web-build / web-test / web-dev"

# Aggregate
build: contracts-build api-build web-build
test: contracts-test api-test web-test
fmt: contracts-fmt
clean:
	cd contracts && rm -rf build
	cd api && ./gradlew clean
	cd web && rm -rf .next node_modules/.cache

# Aiken contracts
contracts-build:
	cd contracts && aiken build

contracts-test:
	cd contracts && aiken check -D

contracts-fmt:
	cd contracts && aiken fmt

# Spring Boot API
api-build:
	cd api && ./gradlew build -x test

api-test:
	cd api && ./gradlew test

api-run:
	cd api && ./gradlew bootRun

# Next.js web
web-build:
	cd web && npm run build

web-test:
	cd web && npm test --if-present

web-dev:
	cd web && npm run dev

# Local infra
compose-up:
	docker compose up -d

compose-down:
	docker compose down

# Yaci DevKit (separately installed via curl install script)
devkit-start:
	@if command -v devkit >/dev/null 2>&1; then \
		devkit start; \
	elif [ -x "$$HOME/.yaci-devkit/bin/devkit.sh" ]; then \
		"$$HOME/.yaci-devkit/bin/devkit.sh" start; \
	else \
		echo "Yaci DevKit not installed. Run: curl --proto '=https' --tlsv1.2 -LsSf https://devkit.yaci.xyz/install.sh | bash"; \
		exit 1; \
	fi

devkit-stop:
	@if command -v devkit >/dev/null 2>&1; then \
		devkit stop; \
	elif [ -x "$$HOME/.yaci-devkit/bin/devkit.sh" ]; then \
		"$$HOME/.yaci-devkit/bin/devkit.sh" stop; \
	fi

# Convenience: full local dev stack (Postgres + DevKit + BE + FE in foreground)
dev:
	@echo "Bring up dependencies: make compose-up && make devkit-start"
	@echo "Then in separate terminals: make api-run; make web-dev"
