import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Be right back · S#!thole",
  description:
    "Shithole is offline while we ship a contract upgrade. Back soon.",
  robots: { index: false, follow: false },
};

/**
 * WIP / maintenance page.
 *
 * <p>Rendered automatically site-wide whenever the {@code MAINTENANCE_MODE}
 * env var is set to {@code "true"} (see {@code src/lib/maintenance.ts}
 * and the gate in {@code src/app/layout.tsx}). The page is also reachable
 * directly at {@code /maintenance} regardless of the flag — useful for
 * previewing the design before flipping the global switch.
 */
export default function MaintenancePage() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-center justify-center gap-6 px-6 py-16 text-center">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/brand/logo-v8-pixel-poop.svg"
        alt=""
        width={96}
        height={96}
        className="h-24 w-24"
        aria-hidden
      />
      <h1 className="font-mono text-4xl font-semibold tracking-tight text-zinc-100">
        be right back
      </h1>
      <p className="max-w-md text-sm text-zinc-400">
        We&apos;re plunging the pipes and rebuilding part of the protocol.
        Listings, swaps, and withdrawals are paused while we upgrade.
        Follow{" "}
        <a
          href="https://x.com/Shithole_App"
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:text-zinc-100"
        >
          @Shithole_App
        </a>{" "}
        for the all-clear.
      </p>
      <p className="text-xs uppercase tracking-widest text-zinc-600">
        no funds at risk · contract is non-custodial · NFTs are safe on chain
      </p>
    </main>
  );
}
