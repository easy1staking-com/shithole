import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "How it works · S#!thole",
  description:
    "S#!thole carries worthlessness in circles within one collection. Here's how the swap, the listings, and the fees actually work.",
};

export default function AboutPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-12 px-6 py-16">
      <header className="space-y-3">
        <Link
          href="/"
          className="text-xs uppercase tracking-widest text-zinc-500 hover:text-zinc-300"
        >
          ← back to the pits
        </Link>
        <h1 className="font-mono text-4xl font-semibold tracking-tight">
          how it works
        </h1>
        <p className="text-sm text-zinc-400">
          Wormhole carries value across chains. S#!thole carries
          worthlessness in circles within one collection.
        </p>
      </header>

      {/* The pitch */}
      <section className="space-y-3 text-zinc-300">
        <h2 className="text-xl font-semibold text-zinc-100">the pitch</h2>
        <p>
          You bought into a collection that promised the moon and delivered
          a flat tyre. The team is gone, the floor is dust, and your JPEG
          still costs more in storage than it&apos;s worth in trades.
          Shithole accepts your situation and turns it into a game: trade
          your worthless NFT for a different worthless NFT from the same
          collection. Pure peer-to-peer, on chain, no mints, no burns,
          supply unchanged.
        </p>
      </section>

      {/* How a swap works */}
      <section className="space-y-3 text-zinc-300">
        <h2 className="text-xl font-semibold text-zinc-100">
          how a swap works
        </h2>
        <ol className="list-decimal space-y-2 pl-5">
          <li>You pick a curated pit (collection) from the home page.</li>
          <li>
            You choose one NFT from your wallet to drop in. It must belong
            to the same collection as the pit — no cross-collection
            laundering.
          </li>
          <li>
            You pay two small ADA fees (more on those below) and submit the
            transaction.
          </li>
          <li>
            The contract gives you back a different NFT from the pit&apos;s
            current stash. There is an element of randomness in which one
            you end up with — it&apos;s not first-come-first-served, and
            the result is bound to your specific transaction so nobody can
            game it after the fact.
          </li>
        </ol>
        <p className="text-sm text-zinc-400">
          The protocol is designed so many people can swap from the same
          pit at the same time without stepping on each other. No queues,
          no lock-step. Submit when you want, your tx settles on its own.
        </p>
      </section>

      {/* For listers — the loud warning */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-zinc-100">
          for listers — read this twice
        </h2>

        <div className="rounded-md border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-100">
          <p className="font-semibold">
            Listing an NFT means authorising anyone to swap it out for a
            different NFT from the same collection.
          </p>
          <p className="mt-2">
            Once swapped, you will <em>not</em> get your original NFT back
            unless somebody else later swaps it back into the pit. That may
            never happen.
          </p>
          <p className="mt-2 font-semibold">
            If you&apos;re emotionally or financially attached to a
            specific NFT, do not list it. There is no undo button.
          </p>
        </div>

        <div className="space-y-3 text-zinc-300">
          <p>
            Listing is for NFTs you&apos;ve made peace with losing. In
            return, every swap that lands on your listing accrues a small
            ADA tip (the lister fee, see below) on the listing UTxO
            itself. Cancel the listing whenever you want and the accrued
            ADA flows back to you in one transaction.
          </p>
          <h3 className="pt-2 text-base font-semibold text-zinc-100">
            list, unlist, collect
          </h3>
          <ul className="list-disc space-y-2 pl-5 text-sm">
            <li>
              <strong className="text-zinc-100">list</strong> — open a pit,
              select one or more NFTs from your stash, confirm. Each NFT
              goes into its own listing UTxO. You stay the lister of
              record.
            </li>
            <li>
              <strong className="text-zinc-100">earn</strong> — every time
              someone swaps an NFT against your listing, the lister fee
              piles up on the listing UTxO. You can leave the listing
              indefinitely.
            </li>
            <li>
              <strong className="text-zinc-100">cancel / collect</strong>{" "}
              — head to <Link href="/me" className="underline">/me</Link>,
              click cancel on the listing. Whatever NFT is currently
              sitting in that UTxO plus all the accrued ADA returns to
              your wallet in one tx.
            </li>
            <li>
              <strong className="text-zinc-100">relist</strong> — if you
              just want the accrued ADA but you&apos;re happy to keep
              earning, cancel and immediately list again. Two
              transactions, one user action.
            </li>
          </ul>
        </div>
      </section>

      {/* P2P — the v3 mechanic */}
      <section className="space-y-3 text-zinc-300">
        <h2 className="text-xl font-semibold text-zinc-100">
          the p2p side — find another idiot directly
        </h2>
        <p>
          The pit gives you <em>random</em> worthlessness back. The p2p
          side lets you be picky: you lock one of your NFTs together with
          an ADA deposit at a script, declaring that you&apos;ll accept
          any NFT from delegators of a specific Cardano stake pool. Anyone
          holding a qualifying NFT — including, transparently, a bot we
          run — can take the deal and the contract atomically swaps the
          two. If nobody takes it, you reclaim. Nothing expires on its
          own.
        </p>
        <p className="text-sm text-zinc-400">
          The &quot;deposit&quot; isn&apos;t what you spend — about 1.4
          ADA flows back to your wallet attached to the incoming NFT.
          The create-listing flow shows the live breakdown.{" "}
          <Link href="/terms" className="underline hover:text-zinc-100">
            terms &amp; conditions
          </Link>{" "}
          has the full risk picture, including the bot and how the
          curated pool list works.
        </p>
      </section>

      {/* Fees */}
      <section className="space-y-3 text-zinc-300">
        <h2 className="text-xl font-semibold text-zinc-100">fees</h2>
        <p>
          Fees are not fixed. Each curated collection has its own numbers,
          set by the collection&apos;s admin in the on-chain config, and{" "}
          <strong className="text-zinc-100">they can change over time</strong>{" "}
          as the admin updates the config. The actual numbers for a given
          pit are always visible on its swap page before you confirm.
        </p>
        <p>There are two fees on every swap:</p>
        <ul className="list-disc space-y-2 pl-5 text-sm">
          <li>
            <strong className="text-zinc-100">protocol fee</strong> — goes
            to the project treasury. Pays for indexer hosting, mainnet
            chain costs, and the occasional pizza.
          </li>
          <li>
            <strong className="text-zinc-100">lister fee</strong> —
            accrues on the listing UTxO that your swap touches. Claimable
            by whoever originally listed that NFT. Minimum 1 ADA, but the
            actual amount depends on the collection.
          </li>
        </ul>
      </section>

      {/* Mobile */}
      <section className="space-y-3 text-zinc-300">
        <h2 className="text-xl font-semibold text-zinc-100">on mobile</h2>
        <p>
          Shithole works on phones. Open your wallet&apos;s in-app dApp
          browser — Eternl, Vespr, and Lace all have one — and type{" "}
          <code className="rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-sm">
            shithole.app
          </code>{" "}
          in the address bar. Your wallet connects automatically. No
          QR-code dance, no second device.
        </p>
      </section>

      {/* Curation */}
      <section className="space-y-3 text-zinc-300">
        <h2 className="text-xl font-semibold text-zinc-100">
          your favourite rug isn&apos;t here yet?
        </h2>
        <p>
          Curation is intentionally human. We&apos;re not going to let
          someone list a CNFT-shaped Trojan horse just because the
          policy ID is valid. If you want a collection added:
        </p>
        <ul className="list-disc space-y-1 pl-5 text-sm">
          <li>
            DM us on X:{" "}
            <a
              href="https://x.com/Shithole_App"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-zinc-100"
            >
              @Shithole_App
            </a>
          </li>
          <li>
            Or open a GitHub issue:{" "}
            <a
              href="https://github.com/easy1staking-com/shithole/issues"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-zinc-100"
            >
              easy1staking-com/shithole
            </a>
          </li>
        </ul>
      </section>

      {/* Open source */}
      <section className="space-y-3 text-zinc-300">
        <h2 className="text-xl font-semibold text-zinc-100">open source</h2>
        <p>
          Contracts, indexer, and frontend are all on GitHub:{" "}
          <a
            href="https://github.com/easy1staking-com/shithole"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-zinc-100"
          >
            easy1staking-com/shithole
          </a>
          . Two Aiken validators back the protocol: a multi-handler{" "}
          <code className="rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-xs">
            config
          </code>{" "}
          validator that guards the per-collection parameters, and a{" "}
          <code className="rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-xs">
            listing
          </code>{" "}
          validator that enforces every swap and cancel. Both are
          parameterised per collection — the on-chain address you interact
          with on each pit is derived from the collection&apos;s config NFT
          policy.
        </p>
        <p className="text-sm text-zinc-400">
          Before you click anything, read the{" "}
          <Link href="/terms" className="underline hover:text-zinc-100">
            terms &amp; conditions
          </Link>
          . Smart contracts are real software. Funds at risk.
        </p>
      </section>
    </main>
  );
}
