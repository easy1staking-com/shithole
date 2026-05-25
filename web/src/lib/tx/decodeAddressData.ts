/**
 * Reverse of {@code addressData} (see {@code p2p.ts}). Decode an on-chain
 * {@code Address} Constr representation back to a bech32 string.
 *
 * <p>Aiken's address shape (and what the marketplace's {@code MarketDatum}
 * carries in its {@code seller_address} field):
 *
 * <pre>
 *   Address { payment_credential, stake_credential }
 *     Constr 0 [
 *       Credential paymentCred,         -- Constr 0 [bytes]  = VerificationKey
 *                                       -- Constr 1 [bytes]  = Script
 *       Option&lt;Referenced&lt;StakeCred&gt;&gt; stake
 *         Constr 0 [Referenced]          -- Some
 *           Constr 0 [Credential]        -- Inline
 *             Constr 0|1 [bytes]
 *         Constr 1 []                    -- None
 *     ]
 * </pre>
 *
 * <p>Pointer stake credentials are not handled (we don't produce them on
 * the build side either — see addressData in p2p.ts).
 */

import {
  Address,
  Credential,
  Data,
  type preprod,
  type mainnet,
  type preview,
} from "@evolution-sdk/evolution";

import type { Network } from "./swap";

/** Decode a {@link Data.Data} Address into a bech32 string. */
export function decodeAddressData(data: Data.Data, network: Network): string {
  if (!Data.isConstr(data)) {
    throw new Error("address data is not a Constr");
  }
  const outer = data as unknown as {
    index: bigint;
    fields: ReadonlyArray<unknown>;
  };
  if (outer.index !== 0n || outer.fields.length !== 2) {
    throw new Error(
      `address Constr has shape ${outer.index} / ${outer.fields.length}, expected Constr 0 with 2 fields`,
    );
  }
  const [paymentCredRaw, stakeOptionRaw] = outer.fields as [
    unknown,
    unknown,
  ];

  const paymentCredential = decodeCredential(paymentCredRaw);
  const stakingCredential = decodeStakeOption(stakeOptionRaw);

  const addr = new Address.Address({
    networkId: networkId(network),
    paymentCredential,
    ...(stakingCredential ? { stakingCredential } : {}),
  });
  return Address.toBech32(addr);
}

function networkId(network: Network): 0 | 1 {
  return network === "Mainnet" ? 1 : 0;
}

type DecodedCred =
  | ReturnType<typeof Credential.makeKeyHash>
  | ReturnType<typeof Credential.makeScriptHash>;

function decodeCredential(raw: unknown): DecodedCred {
  if (!isConstrRuntime(raw)) {
    throw new Error("credential is not a Constr");
  }
  if (raw.fields.length !== 1) {
    throw new Error(
      `credential Constr has ${raw.fields.length} fields, expected 1`,
    );
  }
  const bytes = raw.fields[0];
  if (!(bytes instanceof Uint8Array)) {
    throw new Error("credential field 0 is not bytes");
  }
  if (raw.index === 0n) return Credential.makeKeyHash(bytes);
  if (raw.index === 1n) return Credential.makeScriptHash(bytes);
  throw new Error(`credential Constr index ${raw.index} not in {0, 1}`);
}

function decodeStakeOption(raw: unknown): DecodedCred | null {
  if (!isConstrRuntime(raw)) {
    throw new Error("stake option is not a Constr");
  }
  if (raw.index === 1n) return null; // None
  if (raw.index !== 0n) {
    throw new Error(`stake Option Constr index ${raw.index} not in {0, 1}`);
  }
  if (raw.fields.length !== 1) {
    throw new Error("Some(referenced) must have exactly one field");
  }
  const referenced = raw.fields[0];
  if (!isConstrRuntime(referenced)) {
    throw new Error("stake `Referenced` is not a Constr");
  }
  if (referenced.index !== 0n) {
    throw new Error(
      `stake Referenced is Constr ${referenced.index} (pointer credentials not supported)`,
    );
  }
  if (referenced.fields.length !== 1) {
    throw new Error("Inline(credential) must have exactly one field");
  }
  return decodeCredential(referenced.fields[0]);
}

function isConstrRuntime(v: unknown): v is { index: bigint; fields: unknown[] } {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as { index?: unknown }).index === "bigint" &&
    Array.isArray((v as { fields?: unknown }).fields)
  );
}

// silence unused-import flags for the Network namespace tokens — they
// surface as type aliases that downstream code may reference.
void undefined as
  | typeof preprod
  | typeof mainnet
  | typeof preview
  | undefined;
