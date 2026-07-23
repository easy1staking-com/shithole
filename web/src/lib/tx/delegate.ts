/**
 * Stake delegation tx — the gallery's rug-pool levers. Builds either a
 * plain StakeDelegation certificate or, for a never-registered stake
 * key, RegCert + StakeDelegation in one tx (the 2 ADA key deposit is
 * added by the builder from protocol params).
 */

import { Credential, PoolKeyHash } from "@evolution-sdk/evolution";

import type { Cip30Api } from "@/lib/wallet/cip30";
import { makeClient } from "@/lib/tx/evolutionClient";
import { txHashHex } from "@/lib/tx/txAdapters";

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export async function submitDelegation(input: {
  walletApi: Cip30Api;
  /** bech32 pool id (pool1…). */
  poolIdBech32: string;
  /** Include a registration cert (fresh stake key, +deposit). */
  needsRegistration: boolean;
}): Promise<{ txHash: string }> {
  const client = await makeClient(input.walletApi);

  const rewards = await input.walletApi.getRewardAddresses();
  const rewardHex = rewards[0];
  if (!rewardHex) {
    throw new Error("this wallet exposes no reward (stake) address");
  }
  // Reward address = 1 header byte + 28-byte stake credential.
  const stakeCredential = Credential.makeKeyHash(hexToBytes(rewardHex.slice(2)));
  const poolKeyHash = PoolKeyHash.fromBech32(input.poolIdBech32);

  let builder = client.newTx();
  if (input.needsRegistration) {
    builder = builder.registerStake({ stakeCredential });
  }
  builder = builder.delegateToPool({ stakeCredential, poolKeyHash });

  const built = await builder.build();
  const signed = await built.sign();
  return { txHash: txHashHex(await signed.submit()) };
}
