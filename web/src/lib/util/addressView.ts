/**
 * Convert the BE's {@link AddressView} (the JSON shape it serves for
 * decoded on-chain Address values) into a bech32 string usable as a
 * tx output target.
 *
 * <p>Migrated from @lucid-evolution/lucid to @evolution-sdk/evolution.
 * Uses Evolution's {@code Credential.makeKeyHash}/{@code makeScriptHash}
 * + the {@code Address.Address} constructor + {@code Address.toBech32}.
 */

import { Address, Bytes, Credential } from "@evolution-sdk/evolution";

import type { AddressView } from "@/types/api";
import type { Network } from "@/lib/tx/swap";

function networkId(network: Network): 0 | 1 {
  return network === "Mainnet" ? 1 : 0;
}

function credFromView(c: AddressView["payment_credential"]): Credential.Credential {
  const bytes = Bytes.fromHex(c.hash);
  return c.type === "verification_key"
    ? Credential.makeKeyHash(bytes)
    : Credential.makeScriptHash(bytes);
}

export function addressViewToBech32(
  av: AddressView,
  network: Network,
): string {
  const paymentCredential = credFromView(av.payment_credential);
  const stakingCredential = av.stake_credential
    ? credFromView(av.stake_credential)
    : undefined;
  const addr = new Address.Address({
    networkId: networkId(network),
    paymentCredential,
    stakingCredential,
  });
  return Address.toBech32(addr);
}
