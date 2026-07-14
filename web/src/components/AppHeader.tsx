"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { NavMenu } from "@/components/NavMenu";
import { NetworkMismatchBanner } from "@/components/NetworkMismatchBanner";
import { isMarketplaceEnabled } from "@/lib/market/config";
import { WalletConnectButton } from "@/lib/wallet/WalletConnectButton";

/**
 * Persistent top header bar — same pattern on mobile + desktop.
 *
 * <p>Mounted once at the root layout above {@code children}; the layout
 * adds a top padding so page content sits below the bar. Always
 * visible: position-fixed with a backdrop-blur for the iOS-Safari
 * scroll-under feel.
 *
 * <p>Contents:
 * <ul>
 *   <li>Left: logo + name, links home. Same s#!thole identity the
 *       home-page hero uses, just smaller.</li>
 *   <li>Right: the wallet pill ({@link WalletConnectButton}) — connect
 *       button when disconnected, address pill + disconnect dropdown
 *       when connected.</li>
 * </ul>
 *
 * <p>Width: {@code max-w-5xl} centers + caps so it aligns with the
 * widest page container (/p2p, /me) and looks intentionally bounded on
 * desktop. The home page (max-w-4xl) gets a slightly wider header than
 * its content — acceptable: the header is global, the page content is
 * local.
 */
export function AppHeader() {
  const pathname = usePathname();
  // Admin sub-nav surfaces only when the user is already inside /admin.
  // Keeps the global header free of operator-only noise for normal users
  // while giving the admin a single landing spot for the related tooling
  // once they're in that flow.
  const showAdminMenu = pathname?.startsWith("/admin") ?? false;
  return (
    <header
      className="fixed inset-x-0 top-0 z-30 border-b border-zinc-900 bg-zinc-950/85 backdrop-blur"
      // Respect the iOS notch / dynamic island when the page is in PWA
      // mode — pads the bar's top edge down by the system safe area.
      style={{ paddingTop: "env(safe-area-inset-top)" }}
    >
      <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between gap-2 px-3 sm:gap-4 sm:px-6">
        <div className="flex items-center gap-2 sm:gap-3">
          <Link
            href="/"
            className="flex items-center gap-2 font-mono text-sm font-semibold text-zinc-100 hover:text-zinc-50"
            aria-label="s#!thole — home"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/brand/logo-v8-pixel-poop.svg"
              alt=""
              className="h-6 w-6"
              aria-hidden
            />
            {/* Hide the wordmark on small phones — the nav menus +
                wallet pill compete for horizontal real estate. The
                logo glyph alone is recognisable enough as a home link. */}
            <span className="hidden sm:inline">s#!thole</span>
          </Link>
          <nav className="flex items-center gap-0">
            <NavMenu
              label="pit"
              items={[
                { label: "the pits", href: "/" },
                { label: "your stash", href: "/me" },
              ]}
            />
            <NavMenu
              label="p2p"
              items={[
                { label: "open offers", href: "/p2p" },
                { label: "your offers", href: "/me/p2p" },
                { label: "make offer", href: "/p2p/new" },
              ]}
            />
            {isMarketplaceEnabled() ? (
              <NavMenu
                label="market"
                items={[
                  { label: "browse", href: "/market" },
                  { label: "list something", href: "/market/new" },
                  { label: "your listings", href: "/market/me" },
                ]}
              />
            ) : null}
            {/* Tools — read-only utilities: History (the unified feed) +
                Inspect (look up any CashGrab's traits / matching pools by
                serial number, no wallet needed). */}
            <NavMenu
              label="tools"
              items={[
                { label: "history", href: "/me/history" },
                { label: "inspect", href: "/inspect" },
              ]}
            />

            {showAdminMenu ? (
              <NavMenu
                label="admin"
                items={[
                  { label: "register config", href: "/admin/register-config" },
                  { label: "update config", href: "/admin/update-config" },
                  { label: "manage jars", href: "/admin/jars" },
                  { label: "market dev tools", href: "/market/dev-tools" },
                ]}
              />
            ) : null}
          </nav>
        </div>
        <WalletConnectButton />
      </div>
      <NetworkMismatchBanner />
    </header>
  );
}
