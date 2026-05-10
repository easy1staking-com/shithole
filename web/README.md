# shithole/web

Next.js 16 + Tailwind 4 + Evolution SDK (added in Phase 4) frontend for the Shithole protocol.

## Stack

- Next.js 16 (app router, src/ layout, Turbopack)
- React 19
- TypeScript 5
- Tailwind CSS 4
- ESLint 9
- (Phase 4+) Evolution SDK + CIP-30 wallets (Eternl → Vespr → Lace)

## Commands

```sh
npm run dev      # local dev server on :3000
npm run build    # production build
npm run start    # serve production build
npm run lint     # eslint
```

Or via the root Makefile:

```sh
make web-dev / web-build / web-test
```

## Status

Phase 1 scaffold only. Wallet integration, Evolution SDK, mud-pit UX all land in Phases 4-6 per `/Users/giovanni/.claude/plans/snug-herding-penguin.md`.
