/**
 * FluidTokens get-oracle-tokens client. Mirrors ADAwatch's
 * {@code FluidOracleService} (Java/Spring) one-for-one but as a pure
 * async function — no scheduler, no Spring lifecycle, just fetch +
 * parse. Consumers are responsible for caching / refresh cadence.
 *
 * <p>The public endpoint refreshes its signed feeds every ~30 seconds;
 * each entry's {@code validFrom..validTo} window is typically ~3000 s
 * (50 min). Tx-build callers should pull a fresh response right before
 * tx assembly so the embedded signature is well within validity.
 */

import {
  ORACLE_TOKENS_URL,
  type OracleTokenEntry,
  type SupportedOracleEntry,
} from "./types";

/**
 * Live, parsed entry for one tracked token. {@link priceInLovelaces} +
 * {@link denominator} give the oracle's spot rate; the tank's
 * {@code amount/divider} markup is applied on top of this when
 * computing required token payment.
 *
 * <p>{@code signatures} is the multisig payload we embed into the
 * on-chain {@code OracleRedeemer} when constructing a tank consume tx.
 * Empty for non-multisig oracle backends (Charlie3 / Orcfax) — those
 * paths are out of scope for the babel-fee feature.
 */
export type LiveOraclePrice = {
  /** Token unit ({@code policyId+assetName} lowercase hex). */
  unit: string;
  decimals: number;
  symbol: string;
  name: string;
  /** Which backend supplied the price ("multisig", "c3", "fluid", …). */
  source: string;
  priceInLovelaces: bigint;
  denominator: bigint;
  /** Inclusive lower bound for the tx's validity range. */
  validFrom: bigint;
  /** Inclusive upper bound for the tx's validity range. */
  validTo: bigint;
  /** Signed multisig payload — empty for non-multisig sources. */
  signatures: { publicKey: string; signature: string }[];
  /** UTxO carrying the oracle NFT, ref-input on every tank consume. */
  oracleRefInput: string; // "txHash#idx"
  /** Stake address the {@code withdraw 0 lovelace} cert targets. */
  oracleWithdrawAddress: string;
  /** Raw entry kept around for any caller that needs the full shape. */
  raw: OracleTokenEntry;
};

/**
 * Hit the public registry, parse, return everything {@link active === true}.
 * Throws on network error / non-JSON response so callers know to retry.
 *
 * <p>Tag: tx-build code paths should call this right before assembling
 * the consume tx — the embedded signature has a finite validity window.
 */
export async function fetchOracleTokens(signal?: AbortSignal): Promise<LiveOraclePrice[]> {
  const resp = await fetch(ORACLE_TOKENS_URL, {
    method: "GET",
    headers: { accept: "application/json" },
    signal,
  });
  if (!resp.ok) {
    throw new Error(
      `fluidtokens oracle fetch failed: HTTP ${resp.status} ${resp.statusText}`,
    );
  }
  const body = (await resp.json()) as unknown;
  if (!Array.isArray(body)) {
    throw new Error("fluidtokens oracle response is not an array");
  }
  const out: LiveOraclePrice[] = [];
  for (const entry of body) {
    const parsed = parseEntry(entry as OracleTokenEntry);
    if (parsed) out.push(parsed);
  }
  return out;
}

/**
 * Look up a single token's live price by {@code policy+name} unit hex.
 * Returns {@code null} when the token isn't tracked, the entry is
 * inactive, or no oracle data is currently available.
 *
 * <p>Convenience wrapper around {@link fetchOracleTokens} — fine for
 * one-off lookups, but tx-builder paths that need several tokens should
 * call {@link fetchOracleTokens} once and index locally.
 */
export async function fetchOraclePrice(
  unitHex: string,
  signal?: AbortSignal,
): Promise<LiveOraclePrice | null> {
  const all = await fetchOracleTokens(signal);
  const lower = unitHex.toLowerCase();
  return all.find((p) => p.unit === lower) ?? null;
}

/* -------------------------------------------------------------------------- */
/* Parsing                                                                    */
/* -------------------------------------------------------------------------- */

function parseEntry(entry: OracleTokenEntry): LiveOraclePrice | null {
  if (!entry.active) return null;
  const token = entry.token;
  if (!token?.policyId) return null;

  const unit = (token.policyId + (token.assetName ?? "")).toLowerCase();
  const preferred = entry.preferredOracle;
  if (!preferred) return null;

  const supported: SupportedOracleEntry | undefined =
    entry.supportedOracle?.[preferred];
  if (!supported) return null;

  let priceInLovelaces: bigint;
  let denominator: bigint;
  try {
    priceInLovelaces = toBigInt(supported.tokenPriceInLovelaces);
    denominator = toBigInt(supported.tokenPriceDenominator);
  } catch {
    return null;
  }
  if (denominator === 0n) return null;

  const signatures = supported.multisigOracle?.signatures ?? [];

  return {
    unit,
    decimals: token.decimals ?? 0,
    symbol: token.symbol ?? "",
    name: token.name ?? "",
    source: preferred,
    priceInLovelaces,
    denominator,
    validFrom: BigInt(supported.validFrom),
    validTo: BigInt(supported.validTo),
    signatures,
    oracleRefInput: entry.fluidOracle?.referenceInput ?? "",
    oracleWithdrawAddress: entry.fluidOracle?.rewardAddress ?? "",
    raw: entry,
  };
}

/**
 * JSON serialisers vary: small ints come back as {@code number}, big
 * ones some implementations stringify. Accept both, fail loudly on
 * anything else.
 */
function toBigInt(v: unknown): bigint {
  if (typeof v === "bigint") return v;
  if (typeof v === "string") return BigInt(v);
  if (typeof v === "number") {
    if (!Number.isSafeInteger(v)) {
      throw new Error(`unsafe-int conversion: ${v}`);
    }
    return BigInt(v);
  }
  throw new Error(`cannot convert ${typeof v} to bigint`);
}
