/**
 * FluidTokens Aquarium — TypeScript mirrors of the on-chain Aiken types
 * we need to construct + decode at tx-build time. Source of truth:
 * {@code https://github.com/FluidTokens/ft-cardano-aquarium-sc}
 * (cloned to /tmp/ft-aquarium during build-out).
 *
 * <p>Field order MUST match the Aiken definitions verbatim — CBOR
 * encoding of Plutus Constr is positional.
 *
 * <p>This module is pure types + constants. The CBOR encoder lives in
 * a separate file that uses these as its schema.
 */

/* -------------------------------------------------------------------------- */
/* On-chain constants (verbatim from lib/constants.ak)                        */
/* -------------------------------------------------------------------------- */

/**
 * Maximum span (validTo − validFrom) the oracle signature can cover, in
 * milliseconds. Aquarium rejects feeds with a window wider than this.
 * From {@code constants.ak}.
 */
export const MAX_ORACLE_VALIDITY_RANGE_MS = 3_600_000n; // 1 hour

/** Minimum lovelace the validator allows in `ada_used`. Below this → fail. */
export const MIN_ADA_SPENDABLE = 300_000n; // 0.3 ADA

/**
 * Maximum lovelace in `ada_used`, BUT only enforced when
 * {@code payingToken.amount == 0} (free tank). For any tank with a
 * non-zero markup multiplier, there is NO upper bound on `ada_used`.
 */
export const MAX_ADA_SPENDABLE_FREE_TANKS = 5_000_000n; // 5 ADA

/** Asset name carried by the singleton Parameters NFT. */
export const PARAMETERS_ASSET_NAME = "parameters";

/** The Aquarium tank validator's payment-credential script hash (mainnet). */
export const AQUARIUM_TANK_SCRIPT_HASH =
  "f9724c47299e745cb4f50f9d36cbbadcdf87e015a9d99d927dc4e866";

/** The Aquarium tank script's stake-credential hash (mainnet). */
export const AQUARIUM_TANK_STAKE_HASH =
  "93aa4f7faea6ae99b3defdc9b409ec74787ca69720b214f9df064308";

/**
 * The Parameters validator's policy id (carries the "parameters" NFT
 * that gates every non-Withdraw tank action). Stable per deployment.
 */
export const AQUARIUM_PARAMETERS_POLICY_ID =
  "f0e403df77b2bfee7c0799ef927b3763165033cbe38bddc802934883";

/**
 * Public API the off-chain layer hits for the multisig-signed oracle
 * feed. Same URL ADAwatch's FluidOracleService uses.
 */
export const ORACLE_TOKENS_URL = "https://api.fluidtokens.com/get-oracle-tokens";

/* -------------------------------------------------------------------------- */
/* lib/types/general.ak                                                       */
/* -------------------------------------------------------------------------- */

/**
 * On-chain {@code Asset { policyId: PolicyId, assetName: AssetName }}.
 * Both fields are hex strings on the wire.
 */
export type Asset = {
  policyId: string;
  assetName: string;
};

/**
 * On-chain {@code CardanoToken {policyId, assetName, amount, divider, oracle}}.
 *
 * <p>Markup formula (when oracle is set): the tx-builder pays at least
 * {@code ceil(ada_used / oracle_price) * amount / divider} of this
 * token. So {@code amount/divider} is the multiplier on top of the
 * oracle's spot rate — the tank owner's margin.
 */
export type CardanoToken = {
  policyId: string;
  assetName: string;
  amount: bigint;
  divider: bigint;
  oracle: Asset | null;
};

/* -------------------------------------------------------------------------- */
/* lib/types/datum.ak                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Parameters UTxO datum. Singleton on-chain. The {@code min_ada} field
 * caps the lovelace each spend may leave on the payment-to-tankOwner
 * output ({@code max_min_ada} in the validator).
 *
 * <p>{@code min_to_stake} = FLDT required to register as an Aquarium node
 * (irrelevant to babel-fee use); {@code address_rewards} = scheduled-tx
 * treasury (also irrelevant for babel-fee).
 */
export type DatumParameters = {
  minToStake: bigint;
  owner: string;
  addressRewards: OnChainAddress;
  minAda: bigint;
};

/**
 * On-chain {@code DatumTank}. Each tank UTxO carries one of these.
 * Field order is load-bearing — the validator's `expect Some(payingToken) =
 * list.at(datum.allowedTokens, payingTokenIndex)` etc. read positionally.
 *
 * <p>{@code destionationaAddress} is the typo verbatim from the Aiken
 * source — keep it so the CBOR encoder lines up.
 */
export type DatumTank = {
  allowedTokens: CardanoToken[];
  tankOwner: OnChainAddress;
  whitelistedAddresses: OnChainAddress[];
  executionTime: bigint;
  destionationaAddress: OnChainAddress;
  scheduledAmount: CardanoToken;
  reward: CardanoToken;
};

/**
 * Lightweight wrapper around the on-chain {@code cardano/address.Address}
 * Constr 0 { payment_credential, stake_credential }. The encoder + decoder
 * convert between this and bech32 against the active network.
 */
export type OnChainAddress = {
  paymentCredential: Credential;
  /**
   * Some(Inline(cred)) on the wire = `{ kind: "inline", credential }`.
   * Pointer addresses are unsupported (rare in practice). None = null.
   */
  stakeCredential: { kind: "inline"; credential: Credential } | null;
};

/** Aiken {@code cardano/address.Credential}: VerificationKey | Script. */
export type Credential =
  | { kind: "verificationKey"; hash: string }
  | { kind: "script"; hash: string };

/* -------------------------------------------------------------------------- */
/* lib/types/redeemer.ak                                                      */
/* -------------------------------------------------------------------------- */

/** Common shape every {@link OraclePriceFeed} variant carries up front. */
export type CommonFeedData = {
  validFrom: bigint;
  validTo: bigint;
  token: Asset;
};

/**
 * Five oracle feed variants. FluidTokens' own multisig oracle uses
 * {@link OraclePriceFeedAggregated} (matched against `Aggregated` in
 * the validator's `retrieve_oracle_data`).
 */
export type OraclePriceFeed =
  | OraclePriceFeedAggregated
  | OraclePriceFeedPooled
  | OraclePriceFeedDedicated
  | OraclePriceFeedPriceDataCharlie
  | OraclePriceFeedPriceDataOrcfax;

/** Aggregated — FluidTokens' own multisig oracle path. Constructor index 0. */
export type OraclePriceFeedAggregated = {
  kind: "aggregated";
  common: CommonFeedData;
  tokenPriceInLovelaces: bigint;
  denominator: bigint;
};

/** Pooled — AMM-derived price. Constructor index 1. */
export type OraclePriceFeedPooled = {
  kind: "pooled";
  common: CommonFeedData;
  tokenAAmount: bigint;
  tokenBAmount: bigint;
};

/** Dedicated — custom oracle. Constructor index 2. */
export type OraclePriceFeedDedicated = {
  kind: "dedicated";
  common: CommonFeedData;
  priceInLovelaces: bigint;
  denominator: bigint;
};

/** Charlie3 indirection — constructor index 3. */
export type OraclePriceFeedPriceDataCharlie = {
  kind: "priceDataCharlie";
  providerRefInputIndex: bigint;
  common: CommonFeedData;
  priceInLovelaces: bigint;
  priceDenominator: bigint;
};

/** Orcfax indirection — constructor index 4. */
export type OraclePriceFeedPriceDataOrcfax = {
  kind: "priceDataOrcfax";
  pointerRefInputIndex: bigint;
  providerRefInputIndex: bigint;
  common: CommonFeedData;
  priceInLovelaces: bigint;
  priceDenominator: bigint;
};

/** One ed25519 signature over the {@link OraclePriceFeed} payload. */
export type Signature = {
  signature: string; // 64-byte hex
  keyPosition: bigint;
};

/**
 * The redeemer attached to the oracle stake-validator's
 * {@code withdraw 0 lovelace} certificate. The tank validator reads
 * the {@code data} field via {@code retrieve_oracle_data}; the oracle
 * validator verifies the multisig signatures.
 */
export type OracleRedeemer = {
  data: OraclePriceFeed;
  signatures: Signature[];
};

/**
 * Tank spend redeemer. Constructor indices follow Aiken declaration
 * order:
 *   0 = Consume, 1 = ConsumeAll, 2 = Withdraw,
 *   3 = ScheduledTransaction, 4 = ConsumeOracle, 5 = ConsumeAllOracle.
 */
export type RedeemerTank =
  | RedeemerTankConsume
  | RedeemerTankConsumeAll
  | RedeemerTankWithdraw
  | RedeemerTankScheduledTransaction
  | RedeemerTankConsumeOracle
  | RedeemerTankConsumeAllOracle;

export type RedeemerTankConsume = {
  kind: "consume";
  payingTokenIndex: bigint;
  inputTankIndex: bigint;
  receivers: bigint;
  referenceParamsIndex: bigint;
  whitelistIndex: bigint;
};

export type RedeemerTankConsumeAll = {
  kind: "consumeAll";
  payingTokenIndex: bigint;
  inputTankIndex: bigint;
  receivers: bigint;
  referenceParamsIndex: bigint;
  whitelistIndex: bigint;
};

export type RedeemerTankWithdraw = { kind: "withdraw" };

export type RedeemerTankScheduledTransaction = {
  kind: "scheduledTransaction";
  inputTankIndex: bigint;
  batcher: OnChainAddress;
  referenceStakingIndex: bigint;
  referenceParamsIndex: bigint;
  whitelistIndex: bigint;
};

/** The only path the babel-fee flow ever needs. */
export type RedeemerTankConsumeOracle = {
  kind: "consumeOracle";
  payingTokenIndex: bigint;
  inputTankIndex: bigint;
  receivers: bigint;
  oracleIndex: bigint;
  referenceParamsIndex: bigint;
  whitelistIndex: bigint;
};

export type RedeemerTankConsumeAllOracle = {
  kind: "consumeAllOracle";
  payingTokenIndex: bigint;
  inputTankIndex: bigint;
  receivers: bigint;
  oracleIndex: bigint;
  referenceParamsIndex: bigint;
  whitelistIndex: bigint;
};

/* -------------------------------------------------------------------------- */
/* api.fluidtokens.com/get-oracle-tokens response shape                       */
/* -------------------------------------------------------------------------- */

/**
 * One entry from {@code GET /get-oracle-tokens}. The API returns more
 * fields than this — we only model what the babel-fee tx-builder needs.
 * Mirrors ADAwatch's {@code FluidOracleService.parseEntry}.
 */
export type OracleTokenEntry = {
  /** Underlying token the oracle prices (e.g. HOSKY, USDM). */
  token: {
    policyId: string;
    assetName: string; // hex
    decimals: number;
    name: string;
    symbol: string;
  };
  /** The oracle NFT identifying THIS feed on chain. */
  fluidOracle: {
    policyId: string;
    assetName: string; // hex
    /** CIP-33 reference UTxO holding the oracle script bytes. */
    referenceScript: string; // "txHash#idx"
    /** The bech32 stake address of the oracle script (Withdraw target). */
    rewardAddress: string;
    /** UTxO carrying the oracle NFT (reference-input on every consume). */
    referenceInput: string; // "txHash#idx"
  };
  /** Preferred oracle backend (e.g. "multisig", "c3", "fluid"). */
  preferredOracle: string;
  active: boolean;
  /**
   * Per-backend data; the chosen backend's entry (keyed by
   * {@link preferredOracle}) carries the live price + signed feed.
   */
  supportedOracle: Record<string, SupportedOracleEntry>;
};

/**
 * One backend's live feed data. The {@code multisigOracle.signatures}
 * array is what we embed into the on-chain {@link OracleRedeemer}.
 */
export type SupportedOracleEntry = {
  validFrom: number; // ms epoch
  validTo: number; // ms epoch
  tokenPriceInLovelaces: string; // bigint as string from JSON
  tokenPriceDenominator: string; // bigint as string from JSON
  /** Only present on multisig-backed entries. */
  multisigOracle?: {
    signatures: { publicKey: string; signature: string }[];
    requiredSignatures: number;
  };
};
