/**
 * Build-time feature flag for the babel-fee work in progress. Mirrors
 * the {@code isMarketplaceEnabled} pattern in {@code @/lib/market/config}.
 *
 * <p>{@code NEXT_PUBLIC_FEATURE_BABEL_FEE} is read at build time;
 * empty / "off" / "false" / "0" → disabled, anything else → enabled.
 *
 * <p>The flag gates BOTH the test page at {@code /babel-test} and the
 * "enable babel fee" checkbox on the listing detail page, so prod can
 * ship dark while we iterate on dev.
 */

export function isBabelFeeEnabled(): boolean {
  const v = process.env.NEXT_PUBLIC_FEATURE_BABEL_FEE;
  if (!v) return false;
  const norm = v.toLowerCase().trim();
  return norm !== "off" && norm !== "false" && norm !== "0";
}
