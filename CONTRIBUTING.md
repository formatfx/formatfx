# Contributing

## Setup

Node 20+ (CI uses 22).

```sh
npm ci
npm run dev      # editor at localhost:5173
npm test         # vitest unit suite — fast, headless
npm run build    # typecheck + vite build
npm run test:ui  # Playwright e2e (uses installed Edge by default;
                 # PW_CHANNEL=bundled for CI parity)
```

## House rules

- **Zero runtime dependencies.** Vanilla TypeScript + Vite; devDependencies are fine.
- **Test files are contracts.** For engine or generated-expression semantics
  (`core.test.ts`, `condRules.test.ts`), change the test first, then the code.
- **Generated formatters must work on real SharePoint.** Schema-valid always, and
  never a standalone `!` — SharePoint has no logical NOT (`!=` is fine).
- **Never rename localStorage keys or `wb-` CSS classes.** Renames silently wipe
  people's autosaved work.
- **One user gesture = one undoable mutation.**
- **`src/bridge/` stays self-contained and auditable** — no dependencies, every
  line readable by a maker's IT department, extraction is GET-only.

Architecture, invariants, and verified SharePoint semantics live in
[docs/HANDOFF.md](docs/HANDOFF.md).

## PRs

Branch off `main`, keep it green (`npm test` + `npm run build`), open a PR.
CI runs unit tests, the lib/CLI build, and the Playwright suite; both checks
are required to merge.
