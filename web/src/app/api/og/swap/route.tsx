/**
 * Open Graph swap card. Renders a 1200×630 PNG via {@link ImageResponse}
 * (Next/Satori) showing the deposited NB next to the surfaced NA, the
 * collection display name, and the s#!thole wordmark + tagline.
 *
 * <p>Crawlers (Twitter, Discord, Telegram, Slack) hit this route when
 * resolving the {@code og:image} meta on the {@code /share/swap} page,
 * so every shared swap becomes a meme-able card in users' feeds.
 *
 * <p>Query params (all url-encoded):
 * <ul>
 *   <li>{@code slug} — pit slug (e.g. {@code hosky-real}). Drives the URL caption.</li>
 *   <li>{@code na} — full unit hex of the NFT that came out (NA).</li>
 *   <li>{@code nb} — full unit hex of the NFT that went in (NB).</li>
 *   <li>{@code display_name} — collection display name for the caption.</li>
 *   <li>{@code na_name}, {@code nb_name} — optional pretty names for the cards.</li>
 *   <li>{@code na_img}, {@code nb_img} — already-resolved HTTPS image URLs
 *       (e.g. {@code https://ipfs.io/ipfs/Qm…}). The FE caller has these
 *       in memory from the NFT metadata cache, so passing them avoids a
 *       server-side fetch from the OG route to the BE. If omitted, the
 *       OG route fetches {@code GET /api/nft/{unit}} to resolve.</li>
 *   <li>{@code accent} — hex color (no leading #) for the accent overlay.</li>
 * </ul>
 */

import { ImageResponse } from "next/og";

export const contentType = "image/png";
// Cache for an hour on the CDN — the inputs are fully encoded in the
// URL so a fresh swap gets a fresh card without invalidation.
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
async function resolveImageUrl(apiBase: string, unit: string): Promise<string | null> {
  try {
    const resp = await fetch(`${apiBase}/api/nft/${unit}`, {
      // Cache per-unit at the edge so back-to-back OG renders for the
      // same swap don't re-hit the BE.
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
  const slug = sp.get("slug") || "";
  const na = sp.get("na") || "";
  const nb = sp.get("nb") || "";
  const displayName = sp.get("display_name") || "shithole";
  const naName = sp.get("na_name") || utf8FromHexTail(na);
  const nbName = sp.get("nb_name") || utf8FromHexTail(nb);
  const accentParam = sp.get("accent") || "f5c518";
  const accent = `#${accentParam}`;

  // Prefer image URLs passed in the query (the FE has them in memory
  // from the React Query cache). Fall back to a BE fetch for callers
  // that only know the unit hex.
  const apiBase =
    process.env.OG_BE_INTERNAL_URL ||
    process.env.NEXT_PUBLIC_API_BASE_URL ||
    "http://localhost:8080";
  let naImg = sp.get("na_img") || null;
  let nbImg = sp.get("nb_img") || null;
  if (!naImg && na) naImg = await resolveImageUrl(apiBase, na);
  if (!nbImg && nb) nbImg = await resolveImageUrl(apiBase, nb);

  return new ImageResponse(
    (
      <div
        style={{
          width: 1200,
          height: 630,
          display: "flex",
          flexDirection: "column",
          background: "linear-gradient(135deg, #0a0a0c 0%, #18181b 60%, #1c1917 100%)",
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
              /pit/{slug}
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
            {trim(displayName, 32)}
          </div>
        </div>

        {/* Main card row */}
        <div
          style={{
            display: "flex",
            flex: 1,
            alignItems: "center",
            justifyContent: "center",
            gap: 32,
            marginTop: 24,
            zIndex: 1,
          }}
        >
          <SwapCard
            label="dumped"
            unit={nb}
            name={trim(nbName, 18)}
            img={nbImg}
            accent={accent}
          />
          <div
            style={{
              fontSize: 88,
              color: accent,
              display: "flex",
              filter: `drop-shadow(0 0 16px ${accent}88)`,
            }}
          >
            ↔
          </div>
          <SwapCard
            label="fished out"
            unit={na}
            name={trim(naName, 18)}
            img={naImg}
            accent={accent}
          />
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

function SwapCard({
  label,
  name,
  img,
  accent,
}: {
  label: string;
  /** Full unit hex — for fallback tile when no image. */
  unit: string;
  name: string;
  img: string | null;
  accent: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        width: 320,
      }}
    >
      <div
        style={{
          width: 280,
          height: 280,
          borderRadius: 20,
          background: "#27272a",
          border: `4px solid ${accent}`,
          boxShadow: `0 16px 48px ${accent}66`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
        }}
      >
        {img ? (
          // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
          <img
            src={img}
            width={280}
            height={280}
            style={{ objectFit: "cover", width: 280, height: 280 }}
          />
        ) : (
          <div
            style={{
              color: accent,
              fontSize: 64,
              display: "flex",
            }}
          >
            ?
          </div>
        )}
      </div>
      <div
        style={{
          fontSize: 14,
          color: "#a1a1aa",
          textTransform: "uppercase",
          letterSpacing: "0.25em",
          marginTop: 16,
          display: "flex",
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 28,
          fontWeight: 600,
          color: "#fafafa",
          marginTop: 4,
          display: "flex",
        }}
      >
        {name}
      </div>
    </div>
  );
}
