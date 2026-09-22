/**
 * Single source of truth for the IPFS HTTP gateway the app renders NFT
 * images through.
 *
 * <p>History: the protocol-labs public gateways (ipfs.io, dweb.link,
 * w3s.link) were sunset on 2026-09-21 — they now answer every request with
 * 429 "switching to a service worker gateway only". cloudflare-ipfs.com
 * died before that. Do not add any of them back.
 *
 * <p>The BE persisted {@code image_url} rows as {@code https://ipfs.io/ipfs/…}
 * long before the sunset, and share links already in the wild carry the
 * same form, so every URL that crosses into the FE is passed through
 * {@link rewriteDeadGateway} rather than trusting it verbatim.
 */

/** NMKR's public gateway (courtesy of Patrick @ NMKR). */
export const IPFS_GATEWAY = "c-ipfs-gw.nmkr.io";

/** Hosts whose /ipfs/ paths are dead and must be redirected to {@link IPFS_GATEWAY}. */
const DEAD_GATEWAYS = ["ipfs.io", "dweb.link", "w3s.link", "cloudflare-ipfs.com", "nftstorage.link"];

const DEAD_GATEWAY_RE = new RegExp(
  `^https?://(?:${DEAD_GATEWAYS.map((h) => h.replace(/\./g, "\\.")).join("|")})/ipfs/`,
);

/** CID[/path] → gateway URL. */
export function ipfsGatewayUrl(path: string): string {
  return `https://${IPFS_GATEWAY}/ipfs/${path}`;
}

/**
 * Point a URL on a dead public gateway at {@link IPFS_GATEWAY}; anything
 * else (live hosts, arweave, data:, relative mock paths, null) is returned
 * unchanged.
 */
export function rewriteDeadGateway(url: string): string;
export function rewriteDeadGateway(url: string | null | undefined): string | null | undefined;
export function rewriteDeadGateway(url: string | null | undefined): string | null | undefined {
  if (!url) return url;
  return url.replace(DEAD_GATEWAY_RE, `https://${IPFS_GATEWAY}/ipfs/`);
}
