# P2P Matcher Bot

Autonomous bot that detects two-cycle pairs of active wanted-listings and
submits a single atomic tx fulfilling both. Off by default
(`shithole.p2p.matcher.enabled=false`).

## Trigger

`@EventListener` on Yaci Store's `AddressUtxoEvent` (same pattern as
`ListingEventsIndexer` / `WantedListingEventsIndexer`). The matcher runs
*after* the indexer's `@Transactional` handler in the same Spring event
phase — by the time the matcher reads, the new listings from that block
are already committed to `wanted_listing_events`. No polling, no cron.

## Pair-detection algorithm

A pair `(A, B)` is matchable iff:
- `B.offered_nft_unit`'s asset_name is a leaf in `A.accepted_merkle_root`'s
  tree (so A is fulfillable by B's offered NFT), AND
- `A.offered_nft_unit`'s asset_name is a leaf in `B.accepted_merkle_root`'s
  tree (so B is fulfillable by A's offered NFT).

```
let active = wantedListingEventRepository.findAllActive(...)
// Same-collection only (v1 constraint): index by configNftPolicy.
let byCollection = active.groupBy(l => l.configNftPolicy)
let pairs = []
for collection in byCollection.values():
    // Index by offered asset_name for O(1) "does L accept this NFT" lookups.
    // Tag each listing with the SET of merkle roots whose tree contains its
    // own offered asset_name — precomputed once per listing.
    let acceptingRoots: assetNameHex -> Set<merkleRootHex> = {}
    for L in collection:
        let key = assetNameHexOf(L.offered_nft_unit)
        // (acceptingRoots step is just a self-lookup; the matchability test
        // is "is L1.offered in L2.root's tree?" via PoolMerkleService)
    for i, L1 in collection:
        for j > i, L2 in collection:
            if PoolMerkleService.isMatchableBoth(
                    L1.acceptedMerkleRoot, assetNameOf(L2.offered),
                    L2.acceptedMerkleRoot, assetNameOf(L1.offered)):
                pairs.push(MatchedPair{L1, L2, estimateNet(L1, L2)})
sort pairs desc by estimateNet
return pairs
```

The brute O(n^2) is bounded by the number of active listings *per collection*
(currently ≤ tens, realistically ≤ hundreds at mainnet steady-state).
Hash-grouped first (`groupBy(configNftPolicy)`), then pair-walked within
each group, so cross-collection pairs are never considered (v1
single-collection invariant).

`estimateNet(A, B) = A.lovelace + B.lovelace - 2*protocol_fee
                     - 2*BUYER_OUTPUT_MIN_UTXO - TX_FEE_ESTIMATE`
(both listings share the same collection in v1, so `protocol_fee` is
constant; the bot's profit is just the bounty surplus over the four output
floors and the on-chain tx fee).

The matcher now treats `estimateNet <= 0` as ineligible. This is a
fail-closed mainnet guard: even if the listing validator floor or min-UTxO
assumptions drift, the bot will not intentionally submit a loss-making pair.

## Tx construction outline

Per `MatchedPair{A, B}`:
1. Reference input: the collection's config UTxO (sole shared cfg; v1
   same-collection constraint).
2. Inputs: A.outref + B.outref, each with its own `Fulfill` redeemer
   carrying the merkle proof for the *other* listing's offered asset name.
3. Outputs:
   - `[0]` Buyer-output for A: NFT_X (= B.offered) → A.buyer_address,
     inline datum = `compute_output_tag(A.outref)` (anti-double-sat tag).
   - `[1]` Treasury output for A (if `protocol_fee > 0`), inline datum =
     `compute_output_tag(A.outref)`.
   - `[2]` Buyer-output for B: NFT_Y (= A.offered) → B.buyer_address,
     inline datum = `compute_output_tag(B.outref)`.
   - `[3]` Treasury output for B (if `protocol_fee > 0`), inline datum =
     `compute_output_tag(B.outref)`.
   - Change → bot's address (the bot's profit lives here).
4. `Fulfill` redeemer for A carries `treasury_output_index=Some(1)` (or
   None when fee=0); for B `Some(3)` (or None).
5. Bot signs as fee-payer + collateral-payer.

The validator runs *twice* in this tx (once per Fulfill input), each
invocation checking W1-W7 independently against its own `own_ref` and
own buyer output. The anti-double-sat tag binding makes this safe: each
listing's W3 buyer-output is uniquely identified by the
`(buyer_address, InlineDatum(own_tag))` pair, which only matches one
output even when both listings share the same buyer_address.

`compute_output_tag(oref) = blake2b_256(cbor.serialise(oref))` with
indefinite-length CBOR — reuses `PreprodSwapTool.computeOutputTag` /
`serializeOutRef` verbatim (Aiken-compatible encoder; matches FE's
`bucketMath.ts:serialiseOutputReference`).

## Wallet & secrets

- Single dedicated hot wallet. Mnemonic loaded from
  `SHITHOLE_MATCHER_MNEMONIC` env at boot via `MatcherHotWallet`.
- One payment address derived (`account.baseAddress()`); collateral and
  fee-funding UTxOs both come from this address.
- Wallet is `@ConditionalOnProperty("shithole.p2p.matcher.enabled")`:
  with `enabled=false` (default), no wallet component, no mnemonic ever
  touched.
- With `enabled=true` and missing mnemonic, boot fails fast with a clear
  message. *Never* silently disabled — operator must be explicit.
- Mnemonic never logged. `toString()` overrides omit it; only
  `wallet.getAddress()` is publicly exposed.

## Failure modes

- **Listing UTxO already spent between detection and submission**: the
  on-chain submit fails with `BadInputs`. Caught by the coordinator;
  the in-flight tracker drops the pair and the next block-event re-scans
  with the fresh listing set.
- **Validator rejects (e.g. proof drift, malformed datum)**: surfaces at
  Ogmios eval. Logged at ERROR with the pair's outrefs; the pair is added
  to a short-lived `recentlyFailedPairs` set (TTL ~5 blocks) so we don't
  hot-loop on the same bad pair.
- **No matching pairs**: detector returns an empty list. Coordinator
  records `last_scan_at` and returns.
- **Multiple high-value pairs collide on a listing UTxO**: we submit ONE
  pair per block (N=1 in v1). The losing pair drops out of the next scan
  automatically (its listing was consumed by the winning tx).
- **Bot wallet has no UTxOs for fee/collateral**: build fails. Logged at
  ERROR; the coordinator continues, picks up after the wallet is funded.
- **Ogmios endpoint down**: eval fails. Logged at WARN; next block retries.

## Observability

`GET /api/p2p/matcher/status` exposes:
- `enabled` — bot is wired in.
- `last_scan_at` — last block-event scan timestamp.
- `in_flight_tx_hash` — hash of the most recently submitted tx not yet
  observed as spent in `wanted_listing_events`.
- `last_match_at` — last successful submit.
- `lifetime_matches`, `lifetime_profit_lovelace` — in-memory counters
  (reset on restart; v2 could persist).

## What's NOT in v1

- Cross-collection matching (would require 2× config ref inputs +
  per-side treasury routing).
- Profit-floor configuration (per user: any match is profitable).
- Multi-pair tx (3-cycle, batch fulfill). Coordinator picks 1 per block.
- Persistent matcher state (history of past matches, profit ledger).
- Slack/PagerDuty alerts.

---

## Auto-fulfill loop

Sibling loop to the 2-cycle matcher. The matcher waits for a buyer to
*want* what the bot has — and *offer* something the bot also wants — in
the same block. The auto-fulfiller is the simpler case: as soon as the
bot's hot wallet holds an NFT whose asset_name is a leaf in some active
listing's `accepted_merkle_root`, submit a unilateral Fulfill tx.

The bot earns the listing's bounty, receives the buyer's offered NFT into
the same hot wallet (automatic restock — that NFT may unlock a later
listing in a future block), and pays only the protocol fee + tx fee +
buyer-output min-utxo. The detector computes a conservative `estimateNet`
and only submits candidates with `estimateNet > 0`; within that eligible
set, the estimate is used to rank candidates when there are more than
`max-per-block`.

Off by default (`shithole.p2p.auto-fulfill.enabled=false`). When enabled,
re-uses the matcher's `MatcherHotWallet` (same mnemonic env var) — the
two loops share a wallet by design.

### Trigger

`@EventListener` + `@Order(200)` on `AddressUtxoEvent`. Fires AFTER the
matcher's `@Order(100)` handler in the same Spring event-dispatch
sequence, so any pair the matcher reserved this block is already in the
shared `P2pInFlightTracker` by the time the auto-fulfiller scans.

### Eligibility algorithm

```
let inventory = walletReader.read()      // wallet UTxOs → BotWalletInventory
let active    = wantedListingRepo.findAllActive(cap=1000)
let candidates = []
for listing in active:
    if inFlightTracker.isInFlight(listing.outref): continue   // matcher took it
    let collectionPolicyHex = listing.offered_nft_unit[0..28]
    let nftsInWallet = inventory.forCollection(collectionPolicyHex)
    // First-hit pick — no min-utxo optimisation. Per user decision.
    for assetHex, depositUtxo in nftsInWallet:
        if PoolMerkleService.isMember(listing.accepted_merkle_root, assetBytes):
            candidates.push(FulfillCandidate{listing, assetBytes, depositUtxo,
                                              estimateNet(listing, protocolFee)})
            break
sort candidates desc by estimatedNetLovelace
return candidates[:max_per_block]   // default 3
```

The brute O(listings × wallet_nfts_per_collection) walk is bounded by
the same listing cap as the matcher (1k) and a realistic wallet size
(tens of NFTs). The `PoolMerkleService.isMember` predicate
short-circuits on miss (no proof materialisation in the false branch),
so the hot path is cheap.

### NFT-selection policy

`.find()`-style first-hit. The wallet's map iteration order picks the
NFT. No cost optimisation (we don't bother computing min-utxo deltas) and
no resale-value heuristics. Simpler, fast enough, and the received NFT
goes back to the same hot wallet — so the inventory rotates naturally.

### Tx construction outline

Per `FulfillCandidate`:
1. Reference input: the collection's config UTxO.
2. Inputs: the listing UTxO with a `Fulfill` redeemer carrying the merkle
   proof for the bot's chosen deposit asset_name, PLUS the bot's deposit
   UTxO forced in via `.collectFrom(List.of(depositUtxo))` (the same
   trick `PreprodFulfillP2pTool` uses to defend against the balancer
   leaving a negative-quantity multi-asset change — without this, CCL's
   balancer can pick an ADA-only UTxO and produce a tx that fails the
   value-preservation check).
3. Outputs:
   - `[0]` Buyer output: deposit NFT → listing.buyer_address, inline
     datum = `compute_output_tag(listing.outref)`.
   - `[1]` Treasury output (if `protocol_fee > 0`), inline datum =
     `compute_output_tag(listing.outref)`.
   - Change → bot's address. The buyer's offered NFT (which was in the
     listing UTxO's value) flows here automatically.
4. `Fulfill` redeemer: `Constr 0 [List<ProofItem>, Option<Int>]`. Reuses
   `P2pMatcherTxBuilder.buildFulfillRedeemer` to guarantee byte-identical
   encoding to the matcher path.
5. Bot signs as fee-payer + collateral-payer.

`compute_output_tag` reuses `matcher/OutputTags.computeOutputTag`
verbatim — the indefinite-length CBOR encoder pinned against the FE's
`bucketMath.ts:serialiseOutputReference` (see `OutputTagsTest` for the
test vectors). No duplicate serialiser.

### Max-per-block backpressure

`shithole.p2p.auto-fulfill.max-per-block` (default 3). If a busy block
drops 50 new listings the bot could fulfill, we submit the top-3 by
estimated-net and let the rest carry into the next block. The wallet
needs ~(3 × 2 ADA) of ADA inputs + collateral to sustain a 3-per-block
rate; the cap is a wallet-drain safety valve.

### Profitability invariant

For any eligible candidate:
```
net = bounty − protocol_fee − tx_fee − buyer_output_min_utxo
```
The on-chain `wanted_listing` validator enforces `bounty >=
min_seller_compensation + protocol_fee + buyer_output_min_utxo` at
listing-creation time (`min_seller_compensation = 2_000_000` lovelace).
A tx-fee of ~0.5 ADA should fit inside the `min_seller_compensation`
floor, but mainnet min-UTxO and treasury floors are enough of a moving
target that the bot also requires the detector's conservative
`estimateNet > 0` before submission. `TX_FEE_ESTIMATE_LOVELACE = 0.8 ADA`
is the guard band used for that fail-closed filter.

### Coordination with the matcher

We use the shared `P2pInFlightTracker` bean — a process-wide
`ConcurrentHashMap<String, Reservation>` keyed by outref (`txHash#index`),
owner-tagged and timestamped. Both coordinators register on submit success,
release on failure (via `finally`) or on indexer-observed spend. A
30-minute TTL is pruned on tracker access so a dropped mempool tx cannot
pin an outref forever or grow memory without bound. Each coordinator's
detector reads the tracker and SKIPS in-flight outrefs.

Tradeoff considered:
- **Merged coordinator (one P2pBotCoordinator)** — single tryLock,
  trivial ordering, but couples the two loops' enable flags. The
  user's intuition flagged this as "stupider and lets a single
  submit-and-await-confirmation queue serialise."
- **Separate coordinators + shared in-flight set (chosen)** — each loop
  has its own `@ConditionalOnProperty`, so an operator can run
  matcher-only or auto-fulfill-only without code changes. The shared
  `P2pInFlightTracker` plus `@Order(100)/(200)` on the event listeners
  gives the same serialisation property as a merged coordinator
  (matcher runs first, registers reservations, auto-fulfiller picks
  from the leftovers) without entangling the two loops' configs.

The decision can be re-evaluated if running both loops simultaneously
ever produces a UTxO-contention bug the in-flight set doesn't catch.

### Observability

`GET /api/p2p/auto-fulfill/status` exposes:
- `enabled`
- `last_scan_at`, `last_match_at`
- `inventory_count` — bot's wallet NFT count, refreshed each scan
- `lifetime_fulfilled`, `lifetime_profit_lovelace` (in-memory)
- `in_flight_count` — total outrefs currently held by EITHER loop in
  `P2pInFlightTracker` (cross-loop visibility for ops)

Sibling endpoint shape to `GET /api/p2p/matcher/status`; same
disabled-state behaviour (returns `enabled: false` with the full key
set so monitoring doesn't have to special-case the off-state).

### What's NOT in v1

- Auto-restock from the swap pit (operator pre-funds the wallet
  manually).
- Per-listing profit-floor (any positive net is submitted; estimate is
  ranking-only).
- NFT-selection heuristics (min-utxo cost, rarity-aware deposit
  picking).
- Persistent ledger of fulfilled listings + profit (in-memory only).
- Cross-collection support (same v1 invariant as the matcher).
