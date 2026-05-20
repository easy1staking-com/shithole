"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

/**
 * localStorage key holding the user's most recent acceptance record.
 *
 * Note: the trailing `-v1` is historical — the key has never been
 * rotated, and the version we check against is stored *inside* the
 * JSON record under {@code version}, not in the key suffix. Renaming
 * the key would orphan existing acceptances; leaving it as-is means
 * a v1-accepting user's record is read correctly on the next visit,
 * its {@code version} compared against the current {@link TERMS_VERSION},
 * and the gate re-shows naturally when the constants disagree.
 *
 * In short: don't rename this. The {@link TERMS_VERSION} constant is
 * the only knob you need to turn for a forced re-acceptance.
 */
const STORAGE_KEY = "shithole:terms-v1";
/**
 * Bumping this re-shows the gate to every previously-consenting user on
 * their next visit (we compare against {@link AcceptedRecord.version}
 * stored in {@link STORAGE_KEY}).
 *
 * Bump procedure for a material T&C change:
 *   1. Edit {@code web/src/app/terms/page.tsx} with the new copy.
 *   2. Update the bullet list inside this component to mention any
 *      *new* high-impact behaviour the user is now consenting to.
 *   3. Increment {@link TERMS_VERSION} by 1 here.
 *   4. Ship. On next visit, every user with a stored acceptance whose
 *      {@code version} is lower than the new one will see the modal.
 *
 * Version history:
 *   - 1 (initial mainnet release): random-swap pits only.
 *   - 2 (v3 launch, 2026-05-20): added p2p wanted-listing flow. New
 *     consent dimensions: locking ADA + NFT at a permissionless script
 *     address open to any counterparty (human or automated), the
 *     "deposit" terminology + math, reclaim-is-user's-job.
 *
 * The {@link AcceptedRecord.acceptedAt} timestamp stored in localStorage
 * is per-user audit metadata — it tells us when *this device* accepted
 * *this version*. We do not currently mirror acceptances to the BE. If
 * we ever need server-side proof of acceptance (regulatory ask, dispute
 * defence), the natural extension is a `POST /api/legal/accept` taking
 * `{wallet_pkh, version, acceptedAt}` signed CIP-8. Out of scope for v3.
 */
const TERMS_VERSION = 2;
const BYPASS_PARAM = "from=gate";

type AcceptedRecord = {
  version: number;
  acceptedAt: string;
};

/**
 * First-visit T&C consent gate.
 *
 * Renders a hard-block modal over the app until the user acknowledges
 * the terms. The {@link TERMS_VERSION} constant gates re-acceptance on
 * a material T&C change; see the doc comment above the constant for
 * the bump procedure.
 *
 * The T&C link opens in a new tab so users can read the full terms
 * before agreeing without fighting the modal.
 */
export function TermsGate() {
  // null = not yet hydrated; true = show modal; false = already accepted.
  // Starts null to avoid a flash on SSR hydration.
  const [needsConsent, setNeedsConsent] = useState<boolean | null>(null);
  // True if this tab was opened from the gate's terms link (carries
  // ?from=gate). Detected once on mount; deliberately doesn't react to
  // search-param changes so we keep the route statically renderable.
  const [hasGateBypass, setHasGateBypass] = useState(false);
  const pathname = usePathname();
  const dialogRef = useRef<HTMLDivElement>(null);
  const acceptButtonRef = useRef<HTMLButtonElement>(null);

  // Bypass: if the user lands on /terms?from=gate (the link inside the
  // gate itself), don't show the modal on that route — they're reading
  // the very document we're asking them to accept. The bypass only
  // suppresses the modal on /terms; if they navigate elsewhere in the
  // same tab without having accepted, the modal returns.
  const onTermsBypass = pathname === "/terms" && hasGateBypass;

  useEffect(() => {
    // Detect ?from=gate once. Reading window.location.search instead of
    // useSearchParams() keeps every page statically renderable.
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      // setState-in-effect is the right pattern here: window.location is
      // unavailable during SSR, so we can't lazy-init this from the
      // server-render. The mount-once read + setState bridges the
      // server/client gap.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (params.get("from") === "gate") setHasGateBypass(true);
    }

    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        setNeedsConsent(true);
        return;
      }
      const parsed = JSON.parse(raw) as AcceptedRecord;
      setNeedsConsent(parsed?.version !== TERMS_VERSION);
    } catch {
      // Bad JSON or storage unavailable → re-prompt to be safe.
      setNeedsConsent(true);
    }
  }, []);

  useEffect(() => {
    if (needsConsent !== true || onTermsBypass) return;

    // Scroll-lock the body while the gate is up so users can't fiddle
    // with the app behind it.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    // Drop focus on the agree button for keyboard users.
    acceptButtonRef.current?.focus();

    // Focus trap: cycle Tab within the dialog so focus can't escape
    // back into the (inert) app.
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusable = dialog.querySelectorAll<HTMLElement>(
        'a, button, [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [needsConsent, onTermsBypass]);

  const accept = () => {
    const record: AcceptedRecord = {
      version: TERMS_VERSION,
      acceptedAt: new Date().toISOString(),
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
    } catch {
      // If storage is unavailable (private mode, blocked, etc.) we
      // still let the user proceed for this session.
    }
    setNeedsConsent(false);
  };

  if (needsConsent !== true || onTermsBypass) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="terms-gate-title"
      aria-describedby="terms-gate-body"
      className="fixed inset-0 z-50 flex items-center justify-center px-4 py-8"
    >
      <div
        className="absolute inset-0 bg-zinc-950/85 backdrop-blur-sm"
        aria-hidden
      />
      <div
        ref={dialogRef}
        className="relative z-10 w-full max-w-lg rounded-lg border border-zinc-800 bg-zinc-950 p-6 shadow-2xl sm:p-8"
      >
        <div className="flex items-center gap-3 pb-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/brand/logo-v8-pixel-poop.svg"
            alt=""
            width={32}
            height={32}
            className="h-8 w-8"
            aria-hidden
          />
          <h2
            id="terms-gate-title"
            className="font-mono text-xl font-semibold text-zinc-100"
          >
            Read this first
          </h2>
        </div>

        <p id="terms-gate-body" className="text-sm text-zinc-300">
          By using Shithole, you agree to the following. Shithole moves
          real assets on the Cardano mainnet:
        </p>

        <ul className="mt-4 space-y-2 text-sm text-zinc-300">
          <li className="flex gap-2">
            <span aria-hidden className="text-zinc-500">
              ·
            </span>
            <span>Use at your own risk. You may lose funds.</span>
          </li>
          <li className="flex gap-2">
            <span aria-hidden className="text-zinc-500">
              ·
            </span>
            <span>
              Listing an NFT in a pit authorises anyone to swap it. You
              may never get your original NFT back.
            </span>
          </li>
          <li className="flex gap-2">
            <span aria-hidden className="text-zinc-500">
              ·
            </span>
            <span>
              A p2p offer locks your NFT + ADA at a script open to any
              counterparty — human or automated. Reclaim is on you;
              nothing auto-expires.
            </span>
          </li>
          <li className="flex gap-2">
            <span aria-hidden className="text-zinc-500">
              ·
            </span>
            <span>
              Smart contracts can have bugs. Funds may be permanently
              locked with no recovery.
            </span>
          </li>
          <li className="flex gap-2">
            <span aria-hidden className="text-zinc-500">
              ·
            </span>
            <span>
              We don&apos;t track you, but every swap lives on-chain
              forever.
            </span>
          </li>
        </ul>

        <p className="mt-4 text-xs text-zinc-400">
          The full version lives in the{" "}
          <a
            href={`/terms?${BYPASS_PARAM}`}
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-zinc-100"
          >
            terms &amp; conditions ↗
          </a>
          .
        </p>

        <div className="mt-6">
          <button
            ref={acceptButtonRef}
            type="button"
            onClick={accept}
            className="w-full rounded-md bg-zinc-100 px-4 py-2.5 text-sm font-semibold text-zinc-900 transition-colors hover:bg-white focus:outline-none focus:ring-2 focus:ring-zinc-400 focus:ring-offset-2 focus:ring-offset-zinc-950"
          >
            I understand and agree
          </button>
        </div>
      </div>
    </div>
  );
}
