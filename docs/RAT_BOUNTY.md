# Rat Bounty — gamified extermination with $HOSKY prizes

Status: **PLANNING** (Stage 0 shipped on dev, 2026-07-23). This doc is
the working plan; expect redefinition before Stage 1 starts.

## Premise

Rats in the 3D gallery (`/market/gallery`) are shootable. Each kill is
worth **69,420 $HOSKY**. Client-side kill events are trivially
forgeable, so the design goal is NOT "detect cheating" — it's **cap
extraction server-side** so a perfect bot earns no more than a
dedicated human: the daily cap.

## Threat model

- Headless bots submitting kill events straight to the API (replay,
  scripted sessions). → server-issued rats + caps make this pointless.
- Sybil farms (many wallets). → per-IP caps + holder-gating raises the
  per-wallet cost above the prize value.
- Min-UTxO drain (claiming dust to farm the ~1.2 ADA rider). → the
  CLAIMER funds the min-UTxO via the multisig collect tx.
- Hot-wallet compromise. → faucet stash kept small; manual refills;
  kill-switch config flag.

## Flow (Stages 1-2)

1. **Session**: wallet opens a bounty session with a CIP-8 `signData`
   challenge (reuse the byte-identical CIP-8 canonical-payload infra
   from the admin register-config flow). Session id + expiry in DB.
2. **Rat tags**: while a session is active the BE issues **rat spawn
   tickets**: `{ tag (random nonce), sessionId, spawnAt, expiresAt
   (~15s), roomKey }`. In bounty mode the FE spawns rats only from
   tickets — the server decides how many rats exist and when.
3. **Kill**: FE submits the tag. Server accepts iff: session valid, tag
   issued to THIS session, unused, unexpired, and
   `killedAt - spawnAt ≥ ~1s` (no instant-kill scripts). Accepted tag
   hashes attach to the session; balance accrues in DB
   (+69,420 $HOSKY per rat).
4. **Claim** (once balance ≥ threshold): wallet sends a CIP-8-signed
   claim request → BE validates balance + caps → returns a **claim
   ticket** (single-use, expiring, amount-locked).
5. **Collect**: the ticket is redeemed by building a **multisig tx**:
   - faucet wallet contributes the $HOSKY input (co-signs),
   - the CLAIMER's wallet contributes the fee AND the ~1.2 ADA
     min-UTxO riding under the tokens (multisig exactly so the faucet
     never leaks ADA),
   - BE validates the tx outputs match the ticket before co-signing,
   - claimer signs + submits. Balance zeroed on confirmation
     (indexer-watched, not trust-the-client).

## Caps & knobs (all server-side config, no deploy to change)

- `bounty.per_rat` = 69,420 $HOSKY
- `bounty.max_rats_per_wallet_per_day` (start ~20 → 1.39M/day max)
- `bounty.max_rats_per_ip_per_day`
- `bounty.global_daily_emission` (total exposure ceiling)
- `bounty.claim_threshold` (e.g. 10 rats = 694,200 $HOSKY)
- `bounty.enabled` (kill-switch)
- `bounty.holder_gate` (see below)

## Holder-gating (recommended from Stage 1)

Only wallets holding ≥1 NFT from a whitelisted collection (CashGrab
et al.) can open bounty sessions. Kills sybil economics (a farm must
buy from the marketplace per wallet) and turns the hunt into a holder
perk that drives marketplace demand.

## Surprise requirement (Stage 0+, non-negotiable)

The rats are an **easter egg**. No marketing, no docs on the site, no
UI hint that rats are shootable — the ONLY breadcrumb is the crosshair
turning red + the "exterminate" focus card when someone actually aims
at one. The kill counter / bounty chip appears in the HUD only AFTER
the wallet's first kill (localStorage-gated). Discovery spreads by word
of mouth → rat season.

## Stages

- **Stage 0 — FE-only (DONE on dev)**: local kill COUNTER ONLY — no
  monetary display anywhere (a visible $HOSKY balance reads as an
  official payment promise before the program is funded/announced).
  localStorage; zero payout risk.
- **Stage 1 — BE accounting**: CIP-8 sessions, rat-tag issuance,
  kill validation + timing checks, accrued balances, leaderboard
  endpoint, holder-gate. Balances visible as "unclaimed worthless
  riches"; NO payouts yet — observe real traffic, tune caps.
- **Stage 2 — payouts**: faucet wallet + claim ticket + multisig
  collect tx (claimer pays fee + min-UTxO), funding runbook,
  kill-switch drills.
- **Stage 3 — hardening**: kill-interval anomaly detection, budget
  dials/alerts, and reuse the same rails for signed arcade (SNEK)
  leaderboards.

## Open questions (redefine before Stage 1)

- Faucet stash size + refill cadence (who funds, how often).
- Exact multisig shape: native script `all [faucet, claimer]`? Or
  faucet as plain co-signer on a BE-validated tx? (Native script adds
  an address; plain co-sign is simpler — BE output-validation is the
  real security either way.)
- Do rat tickets apply outside bounty sessions (ambient rats stay
  client-side + free, bounty rats visually distinct — e.g. golden
  rats?). Leaning: ambient rats always; GOLDEN rats only via tickets.
  Shooting a golden rat without a session shows "connect + hold a
  CashGrab to earn".
- Leaderboard: wallet-pseudonymous (truncated stake addr) vs opt-in
  handles.
- Claim expiry + what happens to expired tickets (balance returns).
