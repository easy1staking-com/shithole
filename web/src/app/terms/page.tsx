import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Terms & Conditions · S#!thole",
  description:
    "Use at your own risk. Funds at risk. Listing authorises a swap. The full list.",
};

export default function TermsPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-10 px-6 py-16">
      <header className="space-y-3">
        <Link
          href="/"
          className="text-xs uppercase tracking-widest text-zinc-500 hover:text-zinc-300"
        >
          ← back to the pits
        </Link>
        <h1 className="font-mono text-4xl font-semibold tracking-tight">
          terms &amp; conditions
        </h1>
        <p className="text-sm text-zinc-400">
          The short, sarcastic version is on the{" "}
          <Link href="/about" className="underline hover:text-zinc-100">
            about page
          </Link>
          . Below is the boring-but-actually-load-bearing version. Read it
          before you click anything that costs ADA.
        </p>
      </header>

      <section className="space-y-3 text-zinc-300">
        <h2 className="text-xl font-semibold text-zinc-100">use at your own risk</h2>
        <p>
          Shithole is experimental open-source software running on the
          Cardano mainnet. Interacting with it means signing transactions
          that move real assets — NFTs and ADA — out of your wallet under
          rules enforced by Plutus scripts. You alone are responsible for
          what you sign, and for the consequences.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold text-zinc-100">
          funds can be lost or permanently locked
        </h2>
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-100">
          <p className="font-semibold">
            Smart-contract bugs, malicious metadata, indexer failure,
            wallet misbehaviour, or simple user error can all result in
            losses you cannot recover.
          </p>
          <p className="mt-2">
            Cardano UTxOs governed by validator scripts can become
            permanently locked if the validator&apos;s spending conditions
            stop being satisfiable. There is no admin override, no
            customer support, and no chargeback. If a bug locks your
            assets, they are gone.
          </p>
        </div>
        <p className="text-zinc-300">
          The contracts have been reviewed and tested, but no review
          eliminates risk. Do not interact with funds you cannot afford
          to lose.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold text-zinc-100">
          listing = authorising a swap
        </h2>
        <div className="rounded-md border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-100">
          <p className="font-semibold">
            When you list an NFT in a pit, you authorise any other user to
            swap that NFT out for a different NFT from the same
            collection.
          </p>
          <p className="mt-2">
            You will <em>not</em> get your original NFT back unless
            somebody else later swaps it back into the same pit. This may
            never happen.
          </p>
          <p className="mt-2 font-semibold">
            Do not list any NFT you are unwilling to part with permanently.
          </p>
        </div>
        <p className="text-zinc-300">
          The lister fee that accrues on your listing is your
          compensation for that authorisation. The protocol does not, and
          cannot, return a specific NFT to its original lister.
        </p>
      </section>

      <section className="space-y-3 text-zinc-300">
        <h2 className="text-xl font-semibold text-zinc-100">no tracking</h2>
        <p>
          We do not run analytics, set tracking cookies, or store IP
          addresses or wallet addresses on our servers beyond what is
          strictly necessary to serve the page. The only durable record
          of your swap is the swap transaction itself, which is recorded
          on the Cardano blockchain — public by design, with or without
          us.
        </p>
        <p>
          Our backend indexer reads on-chain data to render pit state and
          history. That data is the same data anyone can query from a
          Cardano node. We don&apos;t correlate it with off-chain
          identity, because we don&apos;t collect any.
        </p>
      </section>

      <section className="space-y-3 text-zinc-300">
        <h2 className="text-xl font-semibold text-zinc-100">
          fees can change
        </h2>
        <p>
          Each curated collection has its own protocol fee and lister
          fee, set by the collection&apos;s admin in the on-chain config
          UTxO. The admin can update those values at any time. The fees
          shown on a pit&apos;s swap page are the live values at render
          time; you should review them before submitting a transaction.
        </p>
      </section>

      <section className="space-y-3 text-zinc-300">
        <h2 className="text-xl font-semibold text-zinc-100">no warranty</h2>
        <p>
          Shithole is provided <em>as is</em>, without warranty of any
          kind, express or implied, including but not limited to the
          warranties of merchantability, fitness for a particular purpose,
          and non-infringement. In no event shall the authors,
          contributors, or operators be liable for any claim, damages, or
          other liability, whether in an action of contract, tort, or
          otherwise, arising from, out of, or in connection with the
          software or the use or other dealings in the software.
        </p>
      </section>

      <section className="space-y-3 text-zinc-300">
        <h2 className="text-xl font-semibold text-zinc-100">
          not financial advice
        </h2>
        <p>
          Nothing on this site constitutes financial, investment, legal,
          or tax advice. The NFTs traded here are typically illiquid and
          statistically worthless. Do not interpret the existence of a
          marketplace as an endorsement of value.
        </p>
      </section>

      <section className="space-y-3 text-zinc-300">
        <h2 className="text-xl font-semibold text-zinc-100">
          your responsibility
        </h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            You confirm you have authority to transact with the NFTs you
            list or swap.
          </li>
          <li>
            You are responsible for compliance with the laws of your
            jurisdiction, including tax reporting on any gains or losses.
          </li>
          <li>
            You are responsible for protecting the seed phrase and keys
            that control your wallet. We never see them, and we cannot
            help you recover them.
          </li>
        </ul>
      </section>

      <section className="space-y-3 text-zinc-300">
        <h2 className="text-xl font-semibold text-zinc-100">changes</h2>
        <p>
          These terms may be updated as the protocol evolves. The
          authoritative version is whichever is currently published at{" "}
          <code className="rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-sm">
            shithole.app/terms
          </code>
          . Continued use after an update means you accept the updated
          terms.
        </p>
      </section>

      <section className="space-y-3 text-zinc-300">
        <h2 className="text-xl font-semibold text-zinc-100">
          contact
        </h2>
        <p>
          For bug reports, curation requests, or anything else, find us
          on{" "}
          <a
            href="https://x.com/Shithole_App"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-zinc-100"
          >
            X (@Shithole_App)
          </a>{" "}
          or open an issue on{" "}
          <a
            href="https://github.com/easy1staking-com/shithole"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-zinc-100"
          >
            GitHub
          </a>
          .
        </p>
      </section>
    </main>
  );
}
