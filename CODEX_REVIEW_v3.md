# Adversarial Review of Shithole SPEC v0.3

## Overall

No new security findings in `SPEC.md` v0.3. The v0.3 edits materially address the v0.2 concerns I raised, and I did not find a new exploit or a regression introduced by the UA-seed redesign, the indexer-filter requirement, the treasury note, the bucket-math correction, the cancel-and-relist documentation, or the CCL blueprint note.

## Findings

No new findings.

### Explicit no-findings notes

- **UA seed redesign:** I did not find a new grinding axis in `nb_input_index` as specified in [SPEC.md](/Users/giovanni/Development/workspace/shithole/SPEC.md:242). Because native assets are conserved, there is only one regular input in `tx.inputs` that can physically contain the unique `NB` unit at spend time, so the swapper does not gain a free “choose among many NB inputs” axis. The `Cancel + Swap` same-tx case in [SPEC.md](/Users/giovanni/Development/workspace/shithole/SPEC.md:207) is consistent with that model.
- **NB-input substitution:** Pointing `nb_input_index` at an unrelated input only works if that input actually contains the exact `NB` unit, which collapses back to “that input really is UA.” I did not find a way to use “another listing that also holds NB” as a second seed choice, because the same NFT cannot be present in multiple consumed inputs.
- **UA containing extra assets / both NA and NB:** S3 only requires that UA contain `NB`, not that UA be single-asset, and I do not see a new exploit from that. The seed is `ua.outRef`, not `ua.value`, so carrying extra assets in UA does not create another controllable axis.
- **CBOR encoding mismatch:** The spec now names `cbor.serialise(ua.outRef)` directly in [SPEC.md](/Users/giovanni/Development/workspace/shithole/SPEC.md:254) and the local Evolution docs explicitly expose Aiken-compatible CBOR options matching `cbor.serialise()` ([CBOR.ts.md](/Users/giovanni/Development/workspace/cardano-dev-skills/docs/sources/evolution-sdk-packages/evolution/docs/modules/CBOR.ts.md:95)). I do not see a spec-level ambiguity here, assuming the FE/BE use Aiken-compatible encoding and keep the planned golden/property tests in [SPEC.md](/Users/giovanni/Development/workspace/shithole/SPEC.md:451).
- **Indexer filter sufficiency:** The new six-rule filter in [SPEC.md](/Users/giovanni/Development/workspace/shithole/SPEC.md:397) is sufficient for the specific problem it is meant to solve: excluding malformed/junk address residents from FE discovery and from `N`. I did not find an additional on-chain invariant that the filter is silently depending on.
- **Listing-shaped malicious outputs from swap txs:** A swapper can still emit extra outputs at `self.address`, as admitted in [SPEC.md](/Users/giovanni/Development/workspace/shithole/SPEC.md:256), but the filter is strong enough to exclude the malformed ones from FE/indexer state. A correctly shaped extra output is not a new exploit by itself; at that point it is just another permissionlessly created listing, which is already part of the accepted model.
- **Admin/indexer disagreement on N:** `N` is operationally well-defined as “the BE’s count of well-formed listings under the published filter,” per [SPEC.md](/Users/giovanni/Development/workspace/shithole/SPEC.md:318) and [project_backend.md](/Users/giovanni/.claude/projects/-Users-giovanni-Development-workspace-shithole/memory/project_backend.md:12). I do not see a protocol-level ambiguity beyond normal operational dependence on one canonical indexer implementation.
- **Treasury min-UTxO with `protocol_fee = 0`:** The note in [SPEC.md](/Users/giovanni/Development/workspace/shithole/SPEC.md:376) is consistent with S11 (`>= cfg.protocol_fee`) in [SPEC.md](/Users/giovanni/Development/workspace/shithole/SPEC.md:253). No issue.
- **CCL blueprint generation:** I do not see a new spec-level risk here. If anything, grounding Java models in `plutus.json` reduces type-drift risk, and CIP-57 is an active standard for blueprint shape ([CIP-0057](/Users/giovanni/Development/workspace/cardano-dev-skills/docs/sources/cips/CIP-0057/README.md:1)).

## Verdict on v0.2 → v0.3 changes

1. **New invariant S3 + `nb_input_index`:** Yes, this addresses the original free-grinding concern. It narrows the entropy source from “whatever sorts first in the whole tx” to “the actual NB-holding input,” which restores the intended per-attempt relocation cost.
2. **Indexer filter as protocol requirement:** Yes, this addresses the original poisoned-listing discovery concern. The spec now clearly states that listing-address residency is not enough and that FE/N must be derived from the strict shape filter.
3. **`treasury_addr` script-credential footgun documented:** Yes. This was always mainly an operational hazard, and the spec now documents it clearly enough for curation/BE hygiene to own it.
4. **Bucket coverage table corrected:** Yes. The numbers and approximation language are now internally consistent.
5. **Cancel-and-relist documented as lister-fee management:** Yes. This closes the “missing path / ambiguous intended flow” concern without adding validator surface.
6. **CCL blueprint generation added to BE:** Yes, for the intended purpose. It is a reasonable implementation note and not a new protocol risk.

Clean second pass. Residual risks are the ones already explicitly accepted in v0.3.
