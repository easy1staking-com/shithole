/**
 * Open Graph buy card. Renders a 1200×630 PNG via {@link ImageResponse}
 * (Next/Satori) showing the single NFT a buyer just fished out of the
 * marketplace, its name + price, and the s#!thole wordmark + tagline.
 *
 * <p>Sibling to {@code /api/og/swap} — that one is a two-NFT swap pair,
 * this is a single purchased NFT. Crawlers (Twitter, Discord, Telegram,
 * Slack) hit this route when resolving the {@code og:image} meta on the
 * {@code /share/buy} page, so every shared buy becomes a card in feeds.
 *
 * <p>Query params (all url-encoded):
 * <ul>
 *   <li>{@code unit} — full unit hex of the bought NFT.</li>
 *   <li>{@code name} — optional pretty name (falls back to the asset-name hex tail).</li>
 *   <li>{@code img} — already-resolved HTTPS image URL (the FE has it in
 *       memory from the NFT metadata cache). If omitted, the route fetches
 *       {@code GET /api/nft/{unit}} to resolve.</li>
 *   <li>{@code price} — optional human-readable price string incl. ticker
 *       (e.g. {@code "12,000 HOSKY"}). Rendered as a chip when present.</li>
 *   <li>{@code slug} — optional pit slug for the caption.</li>
 *   <li>{@code accent} — hex color (no leading #) for the accent overlay.</li>
 * </ul>
 */

import { ImageResponse } from "next/og";

export const contentType = "image/png";
// Force dynamic — the response depends on query params + a possible
// runtime fetch to the BE. Without this, Next 16 may try to evaluate the
// handler at build time and fail when the BE is unreachable.
export const dynamic = "force-dynamic";
// Cache for an hour on the CDN — the inputs are fully encoded in the URL
// so a fresh buy gets a fresh card without invalidation.
export const revalidate = 3600;

function trim(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}

/**
 * Best-effort fetch of the BE's NFT metadata for a unit, returning the
 * already-resolved {@code image_url} (an HTTPS IPFS gateway URL the BE
 * computed from the CIP-25 {@code ipfs://} URI). Returns null on any
 * failure — the OG render gracefully degrades to the placeholder frame.
 */
async function resolveImageUrl(
  apiBase: string,
  unit: string,
): Promise<string | null> {
  try {
    const resp = await fetch(`${apiBase}/api/nft/${unit}`, {
      next: { revalidate: 300 },
    });
    if (!resp.ok) return null;
    const data = (await resp.json()) as { image_url?: string };
    return data.image_url ?? null;
  } catch {
    return null;
  }
}

function utf8FromHexTail(hex: string): string {
  if (!hex || hex.length < 56) return "";
  const tail = hex.slice(56);
  try {
    const bytes = new Uint8Array(
      (tail.match(/.{2}/g) ?? []).map((b) => parseInt(b, 16)),
    );
    const s = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c < 0x20 || c === 0x7f) return tail.slice(0, 12);
    }
    return s;
  } catch {
    return tail.slice(0, 12);
  }
}

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const sp = url.searchParams;
  const unit = sp.get("unit") || "";
  const name = sp.get("name") || utf8FromHexTail(unit) || "worthless s#!t";
  const price = sp.get("price") || "";
  const slug = sp.get("slug") || "";
  const accentParam = sp.get("accent") || "ff8c1a";
  const accent = `#${accentParam}`;

  // Shrink the title to fit the right-hand column (~656px wide). At a
  // fixed 64px a long CashGrab name like "HOSKYCashGrab000216939" (22
  // chars) overran the canvas edge. Bucket the font size by length so
  // short names stay punchy and long ones still fit on one line.
  const displayTitle = trim(name, 26);
  const titleFontSize =
    displayTitle.length <= 10
      ? 64
      : displayTitle.length <= 14
        ? 54
        : displayTitle.length <= 18
          ? 46
          : displayTitle.length <= 22
            ? 40
            : 34;

  // Prefer the image URL passed in the query (the FE has it in memory
  // from the React Query cache). Fall back to a BE fetch for callers
  // that only know the unit hex.
  const apiBase =
    process.env.OG_BE_INTERNAL_URL ||
    process.env.NEXT_PUBLIC_API_BASE_URL ||
    "http://localhost:8080";
  let img = sp.get("img") || null;
  if (!img && unit) img = await resolveImageUrl(apiBase, unit);

  return new ImageResponse(
    (
      <div
        style={{
          width: 1200,
          height: 630,
          display: "flex",
          flexDirection: "column",
          background:
            "linear-gradient(135deg, #0a0a0c 0%, #18181b 60%, #1c1917 100%)",
          color: "#fafafa",
          fontFamily: "sans-serif",
          padding: "48px 64px",
          position: "relative",
        }}
      >
        {/* Accent glow blob, top-right */}
        <div
          style={{
            position: "absolute",
            top: -120,
            right: -120,
            width: 480,
            height: 480,
            borderRadius: "50%",
            background: accent,
            opacity: 0.18,
            filter: "blur(40px)",
            display: "flex",
          }}
        />

        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            width: "100%",
            zIndex: 1,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            {/* Brand glyph as a tinted poop emoji rather than the SVG —
             *  Satori doesn't render the pixel-poop SVG's features, which
             *  left a blank gap on the live card. The emoji renders
             *  reliably and keeps the brand cue. */}
            <div style={{ fontSize: 48, display: "flex" }}>💩</div>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <div
                style={{
                  fontSize: 36,
                  fontWeight: 700,
                  letterSpacing: "-0.02em",
                  color: "#fafafa",
                  display: "flex",
                }}
              >
                s#!thole
              </div>
              <div
                style={{
                  fontSize: 18,
                  color: "#a1a1aa",
                  fontFamily: "monospace",
                  marginTop: 4,
                  display: "flex",
                }}
              >
                {slug ? `/pit/${slug}` : "marketplace"}
              </div>
            </div>
          </div>
          <div
            style={{
              fontSize: 16,
              color: accent,
              textTransform: "uppercase",
              letterSpacing: "0.2em",
              display: "flex",
            }}
          >
            fresh haul
          </div>
        </div>

        {/* Main row — NFT tile + details */}
        <div
          style={{
            display: "flex",
            flex: 1,
            alignItems: "center",
            gap: 48,
            marginTop: 24,
            zIndex: 1,
          }}
        >
          <div
            style={{
              width: 320,
              height: 320,
              borderRadius: 24,
              background: "#27272a",
              border: `4px solid ${accent}`,
              boxShadow: `0 16px 48px ${accent}66`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              overflow: "hidden",
              flexShrink: 0,
            }}
          >
            {img ? (
              // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
              <img
                src={img}
                width={320}
                height={320}
                style={{ objectFit: "cover", width: 320, height: 320 }}
              />
            ) : (
              <div style={{ color: accent, fontSize: 72, display: "flex" }}>
                ?
              </div>
            )}
          </div>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              flex: 1,
            }}
          >
            <div
              style={{
                fontSize: 16,
                color: "#a1a1aa",
                textTransform: "uppercase",
                letterSpacing: "0.25em",
                display: "flex",
              }}
            >
              just fished out
            </div>
            <div
              style={{
                fontSize: titleFontSize,
                fontWeight: 700,
                letterSpacing: "-0.02em",
                color: "#fafafa",
                marginTop: 8,
                lineHeight: 1.05,
                display: "flex",
              }}
            >
              {displayTitle}
            </div>
            {price ? (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  alignSelf: "flex-start",
                  marginTop: 24,
                  padding: "10px 20px",
                  borderRadius: 9999,
                  background: `${accent}22`,
                  border: `2px solid ${accent}`,
                  color: accent,
                  fontSize: 30,
                  fontWeight: 600,
                }}
              >
                {trim(price, 28)}
              </div>
            ) : null}
          </div>
        </div>

        {/* Tagline */}
        <div
          style={{
            fontSize: 22,
            color: "#a1a1aa",
            textAlign: "center",
            marginTop: 16,
            zIndex: 1,
            display: "flex",
            justifyContent: "center",
          }}
        >
          worthlessness, in circles, within one collection.
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
    },
  );
}
