/**
 * Token-aware coin selection for Evolution SDK `.build()`.
 *
 * <p>Evolution's built-in `largest-first` sorts candidate UTxOs by LOVELACE
 * and greedily adds them until every required asset is covered. When the
 * required value includes a native token (e.g. a HOSKY-priced marketplace
 * listing), that is pathological: the selector walks down the ADA-sorted list
 * adding ADA-only UTxOs — which contribute ZERO of the required token — and
 * only stops once it finally reaches the token-bearing UTxOs near the bottom.
 * On a wallet with many UTxOs it drains almost all of them (observed: 16
 * inputs for a single HOSKY buy).
 *
 * <p>This selector sorts UTxOs that actually CARRY a required token first (by
 * required-token quantity, descending), then falls back to ADA-descending. So
 * the token requirement is satisfied with the fewest inputs and only a minimal
 * ADA top-up follows. For ADA-only requirements there are no token units, so
 * ordering degrades to plain largest-first — identical to the default, no
 * behaviour change for ADA-priced listings.
 *
 * <p>Signature matches Evolution's `CoinSelectionFunction`
 * (`(availableUtxos, requiredAssets) => { selectedUtxos }`), so it drops
 * straight into `build({ coinSelection })`.
 */

import { Assets } from "@evolution-sdk/evolution";
import type { UTxO } from "@evolution-sdk/evolution";

type CoinSelectionResult = { selectedUtxos: ReadonlyArray<UTxO.UTxO> };

export function tokenAwareLargestFirst(
  availableUtxos: ReadonlyArray<UTxO.UTxO>,
  requiredAssets: Assets.Assets,
): CoinSelectionResult {
  // getUnits returns "lovelace" + every "policyId.assetName" unit; we only
  // want the native-token requirements here.
  const requiredTokenUnits = Assets.getUnits(requiredAssets).filter(
    (u) => u !== "lovelace",
  );

  // How much of the required token(s) a UTxO can contribute.
  const tokenScore = (u: UTxO.UTxO): bigint =>
    requiredTokenUnits.reduce((sum, unit) => {
      const q = Assets.getByUnit(u.assets, unit);
      return sum + (q > 0n ? q : 0n);
    }, 0n);

  const sorted = [...availableUtxos].sort((a, b) => {
    const ta = tokenScore(a);
    const tb = tokenScore(b);
    if (ta !== tb) return tb > ta ? 1 : -1; // token-bearing first, qty desc
    const la = Assets.lovelaceOf(a.assets);
    const lb = Assets.lovelaceOf(b.assets);
    return lb > la ? 1 : lb < la ? -1 : 0; // then ADA desc
  });

  const selected: UTxO.UTxO[] = [];
  let acc = Assets.zero;
  for (const u of sorted) {
    if (Assets.covers(acc, requiredAssets)) break;
    selected.push(u);
    acc = Assets.merge(acc, u.assets);
  }
  return { selectedUtxos: selected };
}
