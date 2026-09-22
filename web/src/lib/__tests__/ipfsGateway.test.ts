import { describe, expect, it } from "vitest";
import { buildCandidates } from "@/components/NftImage";
import { IPFS_GATEWAY, ipfsGatewayUrl, rewriteDeadGateway } from "@/lib/ipfsGateway";

const CID = "QmSX5bMFC75Pc584DHsYMFifqyuJ9QT6Ba32E8DjFPpoEA";
const LIVE = `https://${IPFS_GATEWAY}/ipfs/${CID}`;

describe("rewriteDeadGateway", () => {
  it.each(["ipfs.io", "dweb.link", "w3s.link", "cloudflare-ipfs.com", "nftstorage.link"])(
    "rewrites sunset host %s",
    (host) => {
      expect(rewriteDeadGateway(`https://${host}/ipfs/${CID}`)).toBe(LIVE);
    },
  );

  it("keeps sub-paths", () => {
    expect(rewriteDeadGateway(`https://ipfs.io/ipfs/${CID}/1.png`)).toBe(`${LIVE}/1.png`);
  });

  it.each([
    LIVE,
    "https://arweave.net/abc",
    "https://evil.example/ipfs.io/ipfs/x", // host must match, not substring
    "https://notipfs.io/ipfs/x",
    "/mocks/fixtures/1.png",
    "data:image/png;base64,AAAA",
  ])("leaves %s untouched", (url) => {
    expect(rewriteDeadGateway(url)).toBe(url);
  });

  it("passes null/undefined/empty through", () => {
    expect(rewriteDeadGateway(null)).toBeNull();
    expect(rewriteDeadGateway(undefined)).toBeUndefined();
    expect(rewriteDeadGateway("")).toBe("");
  });
});

describe("buildCandidates", () => {
  it("never emits a sunset gateway", () => {
    const out = buildCandidates(`ipfs://${CID}`, `https://ipfs.io/ipfs/${CID}`);
    expect(out).toEqual([LIVE]);
  });

  it("handles the legacy ipfs://ipfs/CID form", () => {
    expect(buildCandidates(`ipfs://ipfs/${CID}`, null)).toEqual([ipfsGatewayUrl(CID)]);
  });

  it("rewrites a dead-gateway url when there is no ipfs:// uri", () => {
    expect(buildCandidates(null, `https://dweb.link/ipfs/${CID}`)).toEqual([LIVE]);
  });

  it("keeps non-IPFS images as the sole candidate", () => {
    expect(buildCandidates(null, "https://arweave.net/abc")).toEqual(["https://arweave.net/abc"]);
  });
});
