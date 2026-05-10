# Shithole

Cardano dApp for swapping dead / rugpulled NFT collections within their own collection. Sarcastic counterpart to Wormhole.

See `SPEC.md` for the protocol specification (v0.3 LOCKED) and `CLAUDE.md` for the project framing and code-review process.

## Layout

```
shithole/
├── contracts/      # Aiken smart contracts (config validator + listing validator)
├── web/            # Next.js + Evolution SDK frontend
├── api/            # Spring Boot 3.3 + Yaci Store + Postgres backend
├── compose.yaml    # local Postgres
├── Makefile        # top-level orchestration
├── SPEC.md         # protocol specification
└── CLAUDE.md       # project framing + AI session guidance
```

## Prerequisites

- **Aiken** ≥ 1.1.21 — `https://aiken-lang.org`
- **Java 21** — Temurin / Adoptium recommended
- **Gradle** ≥ 8 (or use the wrapper)
- **Node** ≥ 20 + npm (or pnpm)
- **Docker** + Docker Compose
- **Yaci DevKit** — install via `curl --proto '=https' --tlsv1.2 -LsSf https://devkit.yaci.xyz/install.sh | bash`

## Quick start

```sh
# 1. Start dependencies
make compose-up        # Postgres on :5432
make devkit-start      # Yaci DevKit (Cardano node + Yaci Store + ports)

# 2. Build everything
make build

# 3. Run tests
make test

# 4. Bring up the app stack (in separate terminals)
make api-run           # Spring Boot on :8080
make web-dev           # Next.js on :3000
```

## Subproject docs

- `contracts/README.md` — Aiken project layout, validator structure, test conventions
- `api/README.md` — BE configuration, Yaci Store integration, CCL annotation processor
- `web/README.md` — wallet integration, Evolution SDK setup, theme system

## Status

**SPEC.md v0.3 LOCKED** (2026-05-10) — clean second Codex adversarial review. Currently scaffolding (Phase 1). See `/Users/giovanni/.claude/plans/snug-herding-penguin.md` for the build plan.
