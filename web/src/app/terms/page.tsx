import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Terms & Conditions · S#!thole",
  description:
    "Use at your own risk. Funds at risk. Listing authorises a swap. Peer-to-peer offers may be filled by a bot. The full list.",
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
        <p className="text-xs uppercase tracking-widest text-zinc-500">
          last updated: 2026-05-20 · version 2
        </p>
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
        <h2 className="text-xl font-semibold text-zinc-100">
          peer-to-peer offers (the &quot;p2p&quot; pages)
        </h2>
        <p>
          Alongside the random-swap pits, Shithole exposes a peer-to-peer
          flow at <code className="rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-sm">/p2p</code>{" "}
          where a <em>buyer</em> locks one of their NFTs together with an ADA
          deposit at a Plutus script, declaring that they will accept any
          NFT whose asset name is in a curated merkle tree (a list of NFTs
          delegating to a specific Cardano stake pool). A separate party — a{" "}
          <em>seller</em> — can then provide a matching NFT plus a merkle
          proof; the contract atomically delivers the buyer&apos;s NFT to
          the seller and the seller&apos;s NFT to the buyer, and routes the
          ADA according to its rules.
        </p>
        <p>
          When you create a p2p listing you are signing a transaction that
          locks both an NFT <em>and</em> ADA at a script address. Anyone in
          the world holding a qualifying NFT can spend that UTxO at any
          time without further consent from you. Do not lock NFTs or ADA
          you are not prepared to part with on a stranger&apos;s schedule.
        </p>
        <p>
          You can reclaim an unfilled listing — getting your NFT and the
          full locked ADA back — at any time, by signing a reclaim
          transaction. Reclaim is your responsibility: nothing happens
          automatically and there is no expiry timer. If you abandon a
          listing it stays locked at the script address indefinitely.
        </p>
      </section>

      <section className="space-y-3 text-zinc-300">
        <h2 className="text-xl font-semibold text-zinc-100">
          your counterparty may be a bot
        </h2>
        <p>
          To keep the p2p surface lively, the project operates an{" "}
          <em>auto-fulfiller</em> — a backend process holding a hot wallet
          that watches for open listings and submits fulfill transactions
          on its own initiative. If you post a listing, the party that
          fills it may be another human, or it may be this bot. You have
          no way to tell up front, and the contract does not distinguish.
        </p>
        <p>
          The bot transacts under the same on-chain rules as any other
          user: it cannot deviate from the validator. Its presence,
          configuration, and continued operation are at the project&apos;s
          sole discretion and may stop, pause, or change behaviour at any
          time without notice. Do not rely on it.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold text-zinc-100">
          the deposit isn&apos;t what you spend
        </h2>
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-100">
          <p className="font-semibold">
            The &quot;deposit&quot; on a p2p listing is the total ADA you
            lock — not the amount it costs you.
          </p>
          <p className="mt-2">
            When the listing is filled, only part of that ADA flows to
            third parties. A non-trivial slice (around 1.4 ADA at current
            protocol parameters) is the minimum-UTxO that <em>returns to
            your wallet</em> attached to the NFT being delivered to you;
            another slice pays the network transaction fee; the remainder
            (minus the protocol fee) is the seller&apos;s incentive for
            taking the offer.
          </p>
          <p className="mt-2">
            The create-listing flow shows you the live breakdown — read
            the &quot;estimated swap cost to you&quot; line before
            confirming. The contract enforces a minimum deposit; below
            that floor the listing cannot be filled by anyone, and you
            would need to reclaim and re-list.
          </p>
        </div>
      </section>

      <section className="space-y-3 text-zinc-300">
        <h2 className="text-xl font-semibold text-zinc-100">
          not a marketplace · no price discovery
        </h2>
        <p>
          Shithole does not match orders by price, run an order book, set
          a floor, or hold custody of any assets. The deposit amount on a
          p2p listing is set by the buyer alone; whether anyone takes it
          is up to other users (and the bot). We do not provide escrow,
          dispute resolution, or buyer/seller protection of any kind. The
          smart contract is the only intermediary, and it does exactly
          what its code says — no more.
        </p>
      </section>

      <section className="space-y-3 text-zinc-300">
        <h2 className="text-xl font-semibold text-zinc-100">
          curated pool list · merkle roots
        </h2>
        <p>
          p2p listings reference Cardano stake pools by way of a merkle
          root committing to the set of NFTs whose stake addresses
          delegate to that pool. The set of pools shown in the UI, and
          the contents of their trees, are curated and computed
          server-side by the project. The admin can add, remove, or
          re-snapshot pools at any time; the on-chain validator does not
          police the pool list.
        </p>
        <p>
          Once a listing is created against a given merkle root, that
          root is baked into the listing&apos;s datum and remains
          redeemable forever against any NFT whose membership proof
          still validates — even if we later snapshot the pool or drop
          it from the catalog. Stale proofs against a stale root are
          still proofs.
        </p>
        <p>
          Listing a pool in the UI is not an endorsement of its
          operator, its delegators, or its on-chain behaviour. We don&apos;t
          vet stake pools beyond mechanical inclusion in the catalog.
        </p>
      </section>

      <section className="space-y-3 text-zinc-300">
        <h2 className="text-xl font-semibold text-zinc-100">
          fees are non-refundable
        </h2>
        <p>
          Once a swap (pit) or a fulfill (p2p) lands on chain, the
          protocol fee paid to the treasury is final. The Cardano
          network fee paid to whoever produces the block is final. There
          is no refund flow on either path, even if you regret the swap
          ten seconds later. Reclaim is only available on a p2p listing
          that has <em>not</em> yet been filled.
        </p>
      </section>

      <section className="space-y-3 text-zinc-300">
        <h2 className="text-xl font-semibold text-zinc-100">
          uptime is best-effort
        </h2>
        <p>
          The website, the indexer that renders the pits and the open
          p2p listings, and the auto-fulfiller bot are all run on
          best-effort by a small team. They may be unavailable, lag, or
          stop entirely. The contracts on chain do not depend on us:
          even if every part of our infrastructure disappears, you can
          still reclaim, swap, or cancel by interacting directly with
          the validators (the script hashes are in the site footer and
          on GitHub).
        </p>
        <p>
          Events beyond our reasonable control — Cardano network forks
          or outages, mempool stalls, third-party provider failures
          (Blockfrost, Ogmios, Vercel, our cluster host, etc.),
          regulatory action, force majeure — may impair or prevent any
          of these services from operating. We disclaim liability for
          any loss arising from such events. Your on-chain remedies
          remain available through the validators regardless.
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
        <p>
          What we <em>do</em> store server-side: the indexer&apos;s
          decoded view of public on-chain events (listings, swaps,
          spends, treasury outputs) and the operational logs needed to
          keep the service running. Logs are kept best-effort for
          short-term debugging and are not exported to third parties.
          On-chain history is permanent by design and outside our
          control — you cannot ask us to &quot;delete&quot; a swap that
          has landed, because we did not write it and we cannot unwrite
          it. If your jurisdiction grants you a right to deletion of
          off-chain personal data we hold about you, contact us; the
          most likely outcome is that we hold none.
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
            You confirm you have authority to transact with the NFTs and
            ADA you list, swap, or deposit.
          </li>
          <li>
            You are responsible for compliance with the laws of your
            jurisdiction, including tax reporting on any gains or losses,
            and including any applicable sanctions, securities, or
            anti-money-laundering rules. We do not perform KYC, we do not
            screen counterparties, and we do not record off-chain
            identity. If your jurisdiction requires those things of you,
            using Shithole does not relieve you of them.
          </li>
          <li>
            You are responsible for the contents of NFTs you list. Do not
            list anything that infringes a third party&apos;s rights, is
            illegal in your jurisdiction, or that you do not lawfully
            own.
          </li>
          <li>
            You are responsible for reclaiming any open p2p listing you
            no longer want filled. There is no automatic expiry.
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
