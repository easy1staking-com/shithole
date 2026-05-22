# Marketplace bring-up

The marketplace contracts live in `contracts/validators/jar.ak` +
`contracts/validators/marketplace.ak`. Both are pure spend validators —
nothing to "deploy" in the literal sense; you just need:

1. A test fungible to trade (a HOSKY-shaped CIP-26 token mints fine for
   dev).
2. An initial jar UTxO seeded at the parameterised jar address so the
   first Buy has somewhere to deposit its fee.
3. The FE manifest at `web/src/lib/market/manifest.json` populated with
   the derived addresses for the network you're on.

## 1. Derive addresses

Easiest path: open the FE (`pnpm --filter web dev`), connect a wallet
on the target network, navigate to **/market/dev-tools** (only visible
when `NEXT_PUBLIC_FEATURE_MARKETPLACE=on`). Hit *derive addresses* —
the page compiles `jar.jar.spend` with the connected wallet's pkh as
the `admin_pkh` parameter and `marketplace.marketplace.spend` with the
resulting jar script hash. Copy the JSON into
`web/src/lib/market/manifest.json` and commit (or hit *stage in
localStorage* for a solo browser session).

## 2. Mint test HOSKY

For preprod testing you want a fungible with a recognisable shape. The
simplest path is the existing Cardano CLI native-script minting recipe:

```bash
# 1. one-shot native script bound to your payment pkh + a tight time bound
cat > policy.json <<EOF
{ "type": "all", "scripts": [
    { "type": "sig", "keyHash": "<your-payment-pkh-hex>" },
    { "type": "before", "slot": <some_slot_far_in_the_future> }
] }
EOF

# 2. compute the policy id
cardano-cli transaction policyid --script-file policy.json

# 3. build + submit a mint tx for 1_000_000_000 of asset name "HOSKY" (hex 484f534b59)
#    -- standard cardano-cli mint flow, omitted here for brevity. The
#    Cardano Foundation has an end-to-end guide; any "native token mint"
#    walkthrough from preprod will work.
```

If you'd rather mint via the FE wallet, the open follow-up is to wire
a Native-Script-aware minter on `/market/dev-tools` — Evolution's
`attachScript` + `mintAssets` accept a native-script-shaped CoreScript;
we just haven't written the JSON-to-CoreScript glue yet.

For CIP-26 registry submission (the off-chain metadata side of the real
HOSKY token: ticker, logo, etc.) see
<https://developers.cardano.org/docs/native-tokens/cardano-token-registry/>.
Optional for preprod dev — the registry only affects display in wallets
and dApp metadata viewers.

## 3. Seed the initial jar UTxO

The jar validator runs on every spend, but its first UTxO is a plain
pay-to-script — no validator runs on output creation. From the connected
wallet (admin), send a small UTxO to the jar address with an inline
`JarDatum { update_ref: ByteArray }` where `update_ref` can be any
bytes — the first Deposit overwrites it.

CLI sketch:

```bash
cardano-cli transaction build \
  --tx-in <your_funding_utxo> \
  --tx-out "<jar_address>+2000000" \
  --tx-out-inline-datum-value '{"constructor":0,"fields":[{"bytes":"00"}]}' \
  --change-address <your_address> \
  --out-file seed.draft

# sign + submit per standard flow
```

After this, `/market` is functional: list, buy, cancel.

## 4. Flip the feature flag

`web/.env.dev` (or `.env.local`): `NEXT_PUBLIC_FEATURE_MARKETPLACE=on`.

In prod: leave it unset. The /market routes 404 + the nav entry is
hidden.

## Known follow-ups

- Bulk-buy FE: the on-chain validator + tests cover N-listing bulk with
  leader-pattern aggregate, but `/market` only wires single-listing buy
  in v1.
- FE-side native-script HOSKY mint (replace step 2's CLI section).
- BE indexer: `/market` polls Blockfrost directly. Move to a Yaci-Store
  table once volume warrants.
