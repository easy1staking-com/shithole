import { Suspense } from "react";
import Link from "next/link";

import { CreateListingForm } from "@/components/p2p/CreateListingForm";

/**
 * v3 P2P listing creator. URL state:
 *   ?collection=<slug>  — required after Stage 0; selects the pit
 *   ?pool=<ticker>      — optional; preselects the SPO pool (set after
 *                         the user picks one, so refresh + share work)
 *
 * The form itself is a client component (useSearchParams + wallet hooks).
 * Suspense boundary wraps it because Next 15 requires useSearchParams to
 * live under a Suspense boundary or the build flags it.
 */
export default function NewP2pListingPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-6 py-12">
      <nav className="text-xs uppercase tracking-widest text-zinc-500">
        <Link href="/me/p2p" className="hover:text-zinc-300">
          ← back to your offers
        </Link>
      </nav>
      <Suspense
        fallback={
          <p className="text-sm text-zinc-500">stirring the mud…</p>
        }
      >
        <CreateListingForm />
      </Suspense>
    </main>
  );
}
