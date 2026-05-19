import Link from "next/link";

import { FulfillForm } from "@/components/p2p/FulfillForm";

/**
 * Fulfill page for one wanted-listing. Path: /p2p/[txHash]/[outputIndex].
 *
 * <p>Next 15 makes route params async. We unwrap them in the page
 * component (which is async by default for app router pages).
 */
export default async function FulfillPage({
  params,
}: {
  params: Promise<{ txHash: string; outputIndex: string }>;
}) {
  const { txHash, outputIndex } = await params;
  const idx = Number.parseInt(outputIndex, 10);
  if (!Number.isFinite(idx)) {
    return (
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-6 py-12">
        <p className="text-sm text-red-400" role="alert">
          invalid output index: {outputIndex}
        </p>
        <Link href="/p2p" className="text-xs text-zinc-400 hover:text-zinc-200">
          ← back to open listings
        </Link>
      </main>
    );
  }
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-6 py-12">
      <nav className="text-xs uppercase tracking-widest text-zinc-500">
        <Link href="/p2p" className="hover:text-zinc-300">
          ← back to open listings
        </Link>
      </nav>
      <FulfillForm txHash={txHash} outputIndex={idx} />
    </main>
  );
}
