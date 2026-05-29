import { notFound } from "next/navigation";

import { BabelTestPanel } from "@/components/babel/BabelTestPanel";
import { isBabelFeeEnabled } from "@/lib/fluidtokens/feature";

export const metadata = {
  title: "babel-fee sanity test — shithole",
  description: "End-to-end smoke test for the FluidTokens babel-fee pipeline.",
};

/**
 * /babel-test — gated by NEXT_PUBLIC_FEATURE_BABEL_FEE. Returns a 404
 * in any environment where the flag isn't set (prod by default),
 * mirroring how /market is gated by NEXT_PUBLIC_FEATURE_MARKETPLACE.
 *
 * <p>The page itself is a dev-only verification surface: it exercises
 * the FluidTokens oracle API client, the tank UTxO fetcher, the datum
 * decoder, and the {@code requiredTokenPayment} math against a real
 * mainnet tank. No tx submission — observation only.
 */
export default function BabelTestPage() {
  if (!isBabelFeeEnabled()) notFound();
  return <BabelTestPanel />;
}
