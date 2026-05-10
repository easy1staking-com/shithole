# shithole/api

Spring Boot 3.3 + Java 21 + Yaci Store + Postgres backend.

## Roles

- Indexer of curated config UTxOs and listing UTxOs (via Yaci Store + extended `UtxoRepository`)
- Strict listing-shape filter (per SPEC §10.2) — junk UTxOs at the listing address are observed but not promoted
- NFT metadata cache (CIP-25 / CIP-68) with multi-tier thumbnails
- Curation registry exposed via REST
- Optional tx-build helper endpoints for the FE

## Stack

- Spring Boot 3.3.4 (`build.gradle.kts`)
- Java 21
- Yaci Store 0.1.6 (auto-indexes UTxOs into our Postgres)
- Cardano Client Lib (CCL) 0.7.1 + annotation processor for blueprint-driven model generation from `../contracts/plutus.json`
- Postgres 16 + Flyway

## Commands

```sh
./gradlew build         # compile + test
./gradlew bootRun       # run locally
./gradlew compileJava   # also runs CCL annotation processor against ../contracts/plutus.json
```

## Reference

Mirrors `/Users/giovanni/Development/workspace/ada-watch/` — same Spring Boot + Yaci Store + CCL pattern, minus the telegram/discord/scalus deps. We extend `UtxoRepository` (per ada-watch's `MyUtxoRepository`) rather than writing custom Yaci Store processors.
