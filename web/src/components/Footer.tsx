import Link from "next/link";

const GITHUB_URL = "https://github.com/easy1staking-com/shithole";
const X_URL = "https://x.com/Shithole_App";
const BUILT_BY_URL = "https://easy1staking.com";
const PERSONAL_X_URL = "https://x.com/cryptojoe101";

const CONFIG_SCRIPT_HASH =
  "ab7d0b190a8a67ecebec6cd8b6a93d1109179deac831b39a6c078c1c";
const LISTING_SCRIPT_HASH =
  "c01f1473ff3275654a2171ad98f90b058cb124630f3e61c4f8884d39";

function shortHash(h: string): string {
  return `${h.slice(0, 8)}…${h.slice(-6)}`;
}

export function Footer() {
  return (
    <footer className="mt-16 border-t border-zinc-800/80 bg-zinc-950 text-zinc-400">
      <div className="mx-auto w-full max-w-6xl px-6 py-10">
        <div className="grid grid-cols-1 gap-8 sm:grid-cols-3">
          {/* Brand */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/brand/logo-v8-pixel-poop.svg"
                alt=""
                width={28}
                height={28}
                className="h-7 w-7"
                aria-hidden
              />
              <span className="font-mono text-lg font-semibold text-zinc-100">
                s#!thole
              </span>
            </div>
            <p className="text-xs text-zinc-500">
              give your dead NFTs a second life. sort of.
            </p>
          </div>

          {/* Links */}
          <div className="space-y-2">
            <p className="text-[0.6rem] uppercase tracking-widest text-zinc-500">
              the project
            </p>
            <ul className="space-y-1.5 text-sm">
              <li>
                <Link href="/about" className="hover:text-zinc-100">
                  how it works
                </Link>
              </li>
              <li>
                <Link href="/terms" className="hover:text-zinc-100">
                  terms &amp; conditions
                </Link>
              </li>
              <li>
                <a
                  href={GITHUB_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-zinc-100"
                >
                  github ↗
                </a>
              </li>
              <li>
                <a
                  href={X_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-zinc-100"
                >
                  @Shithole_App ↗
                </a>
              </li>
            </ul>
          </div>

          {/* Network */}
          <div className="space-y-2">
            <p className="text-[0.6rem] uppercase tracking-widest text-zinc-500">
              on chain
            </p>
            <p className="inline-flex items-center gap-1.5 text-xs">
              <span
                className="h-2 w-2 rounded-full bg-emerald-500"
                aria-hidden
              />
              <span className="text-zinc-300">live on Cardano mainnet</span>
            </p>
            <ul className="space-y-1.5 text-xs">
              <li>
                <a
                  href={`https://cexplorer.io/script/${LISTING_SCRIPT_HASH}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono hover:text-zinc-100"
                  title={`listing script: ${LISTING_SCRIPT_HASH}`}
                >
                  listing: {shortHash(LISTING_SCRIPT_HASH)} ↗
                </a>
              </li>
              <li>
                <a
                  href={`https://cexplorer.io/script/${CONFIG_SCRIPT_HASH}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono hover:text-zinc-100"
                  title={`config script: ${CONFIG_SCRIPT_HASH}`}
                >
                  config: {shortHash(CONFIG_SCRIPT_HASH)} ↗
                </a>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-8 flex flex-col items-start gap-1 border-t border-zinc-800/60 pt-6 text-[0.7rem] text-zinc-600 sm:flex-row sm:items-center sm:justify-between">
          <p>
            built by{" "}
            <a
              href={BUILT_BY_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-zinc-400 hover:text-zinc-200"
            >
              easy1staking.com
            </a>{" "}
            ·{" "}
            <a
              href={PERSONAL_X_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-zinc-400 hover:text-zinc-200"
            >
              @cryptojoe101
            </a>
          </p>
          <p className="text-zinc-700">
            a joke project. swapped NFTs are statistically worthless.
          </p>
        </div>
      </div>
    </footer>
  );
}
