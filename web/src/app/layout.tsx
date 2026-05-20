import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import { AppHeader } from "@/components/AppHeader";
import { Footer } from "@/components/Footer";
import { TermsGate } from "@/components/TermsGate";
import MaintenancePage from "./maintenance/page";
import { isMaintenanceMode } from "@/lib/maintenance";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Absolute base for any relative metadata URLs (og:image, twitter:image,
// canonical, etc.). X silently drops relative image URLs, so this MUST
// resolve to an absolute https URL by the time it hits the rendered HTML.
// Next 16 uses metadataBase to do that resolution for us.
//
// Use the canonical www host: the apex `shithole.app` 307-redirects to
// `www.shithole.app`, and Twitter/X's card scraper does NOT follow
// redirects on og:image / twitter:image — it just gives up and renders
// no card. Hard-coding the post-redirect URL avoids that.
const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.shithole.app";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "S#!thole",
  description:
    "Give your dead NFTs a second life. Sort of. Cardano dApp for swapping NFTs within rugged collections.",
  // Mobile browser chrome (address bar, splash) picks up theme-color.
  // Matches our dark zinc-950 background so mobile dApp browsers don't
  // flash a white system bar against our dark UI.
  themeColor: "#09090b",
  openGraph: {
    type: "website",
    siteName: "S#!thole",
    title: "S#!thole — give your dead NFTs a second life. Sort of.",
    description:
      "Cardano dApp for swapping NFTs within rugged collections. Wormhole carries value across chains. We don't.",
    url: SITE_URL,
    images: [{ url: "/og/landing.png", width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    site: "@Shithole_App",
    creator: "@Shithole_App",
    title: "S#!thole — give your dead NFTs a second life. Sort of.",
    description:
      "Cardano dApp for swapping NFTs within rugged collections. Wormhole carries value across chains. We don't.",
    images: ["/og/landing.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const maintenance = isMaintenanceMode();
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full bg-zinc-950 antialiased`}
    >
      <body className="min-h-full flex flex-col bg-zinc-950 text-zinc-100">
        <Providers>
          {maintenance ? (
            // Full lockdown: render only the WIP page; skip wallet,
            // footer, T&C gate. /maintenance route stays directly
            // reachable for designers/QA via its own page module.
            <MaintenancePage />
          ) : (
            <>
              <AppHeader />
              {/* pt-14 reserves vertical space for the fixed AppHeader
                  (h-14) so page content doesn't slide underneath it.
                  Pages don't need to add their own top padding for the
                  bar — they can keep using their existing py-* rhythm. */}
              <div className="flex-1 pt-14">{children}</div>
              <Footer />
              <TermsGate />
            </>
          )}
        </Providers>
      </body>
    </html>
  );
}
