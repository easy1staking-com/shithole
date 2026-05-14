/**
 * Convert the BE's {@link AddressView} (the JSON shape it serves for
 * decoded on-chain Address values) into a bech32 string usable as a
 * tx output target.
 *
 * <p>The BE serves {@code AddressView} as
 * {@code { payment_credential: { type, hash }, stake_credential: {…} | null }}.
 * Evolution SDK's {@code credentialToAddress(network, paymentCred, stakeCred?)}
 * does the bech32 encoding.
 */

import {
  credentialToAddress,
  keyHashToCredential,
  scriptHashToCredential,
  type Network,
} from "@lucid-evolution/lucid";

import type { AddressView } from "@/types/api";

export function addressViewToBech32(
  av: AddressView,
  network: Network,
): string {
  const paymentCred =
    av.payment_credential.type === "verification_key"
      ? keyHashToCredential(av.payment_credential.hash)
      : scriptHashToCredential(av.payment_credential.hash);
  const stakeCred = av.stake_credential
    ? av.stake_credential.type === "verification_key"
      ? keyHashToCredential(av.stake_credential.hash)
      : scriptHashToCredential(av.stake_credential.hash)
    : undefined;
  return credentialToAddress(network, paymentCred, stakeCred);
}
