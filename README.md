# <img src="public/favicon.svg" width="30" alt="" valign="middle"> FormatFX

[![CI](https://github.com/formatfx/formatfx/actions/workflows/ci.yml/badge.svg)](https://github.com/formatfx/formatfx/actions/workflows/ci.yml)

**Build SharePoint list formatting visually. Export bulletproof JSON.**

[**Try it: formatfx.dev**](https://formatfx.dev) — no sign-in, no install. Fully client-side.

---

### What you get

- **Click, don't code.** Format cells dialog. Conditional rules built from your field type. Live preview against your actual data.
- **Your list, not a demo.** Import your real SharePoint list in seconds. Edit columns and rows you recognize. Every choice, every theme, every formatter synced live.
- **Bulletproof JSON.** The linter catches SharePoint's silent-failure quirks before they ship. Stress-test against null dates, boundary numbers, crowded multi-values. The exporter refuses to let you break it.
- **Teaching built-in.** Every rule, error, and style carries an explanation written for the person who owns the list, not the person who wrote the schema. Paste a community formatter and Explain decompiles it into English. One-click playground to poke at ideas risk-free.
- **Copy and ship.** One-click Deploy snippet from your own list page, using your permissions, showing exactly what it will replace. Or copy the JSON straight into SharePoint's Format pane. A companion browser extension turns the whole round-trip into one gesture.

---

### Why it matters

SharePoint lists are a real database with auth and permissions already solved. But the tool for formatting them—raw JSON in a narrow sidebar—leaves makers with a choice: learn to code or give up on polish. FormatFX gives you both: the visual sandbox and ribbon experience you already know, plus a JSON editor that knows SharePoint's quirks, dialects, and limits. What you build in the UI compiles into schema-valid, tested JSON. What you paste from the community, you actually understand.

---

## Roadmap

**Browser extension (in development):** Extract a list's columns and data into FormatFX in one click. Apply formatters back with a single confirm. Full workspace sync so you can share designs with teammates—one link carries schema, rows, and half-built formatters. Coming soon.

---

## Run it

```bash
npm install
npm run dev           # local dev server
npm test              # engine test suite (vitest + happy-dom)
npm run test:ui       # 146 Playwright e2e tests in your installed Edge
npm run build         # type-check + production bundle in dist/
npm run build:single  # everything inlined into one dist-single/index.html
```

`.github/workflows/ci.yml` runs the unit tests and Playwright suite on every push, builds, and deploys to GitHub Pages from `main`.

## The npm package

The UI-free engine ships as [**`formatfx`**](https://www.npmjs.com/package/formatfx) on npm — the teaching linter and expression engine, headless and dependency-free:

```bash
npx formatfx lint my-formatter.json        # the silent-failure quirks, explained
npx formatfx lint *.json --strict --json   # CI-friendly: warnings fail, JSON out
npx formatfx validate my-formatter.json    # shape check only
```

```ts
import { importJson, lintDocument, evaluate, buildExtractSnippet } from 'formatfx';
```

The package exports the schema types, JSON ⇄ document serializer, expression engine, allow-lists, schema importer, and connectivity snippet builders. The renderer is deliberately not part of the headless surface — the sandbox at formatfx.dev *is* the renderer.

## Contributing

Contributions are welcome — [`CONTRIBUTING.md`](CONTRIBUTING.md) has setup and terms; [`docs/HANDOFF.md`](docs/HANDOFF.md) has the architecture and verified SharePoint semantics. House rules:

- **Zero runtime dependencies.** Vanilla TypeScript + Vite; devDependencies are fine.
- **Test files are contracts.** Engine and generated-expression semantics change in the test first.
- **Generated formatters must work on real SharePoint** — schema-valid always, never a standalone `!`.
- **One user gesture = one undoable mutation.**
- **`src/bridge/` stays dependency-free and auditable** — extraction never changes user data.

## Disclaimer

The preview is an *emulation*, not the real SharePoint renderer. It is built to be pixel-plausible and quirk-faithful, but always verify the exported JSON on a real list before shipping. THIS CODE IS PROVIDED AS IS WITHOUT WARRANTY OF ANY KIND.

## License

FormatFX is **dual-licensed**: **AGPL-3.0-only** ([`LICENSE`](LICENSE)) or **commercial**. [`LICENSING.md`](LICENSING.md) has the full guide.

| You are… | Your track |
| --- | --- |
| Using [formatfx.dev](https://formatfx.dev) and exporting JSON | Free. The JSON is your own work product — use it anywhere. |
| Self-hosting, forking, or modifying the code | **AGPL-3.0** — serving a modified version over a network means offering its source under the same terms. |
| Embedding in a proprietary product or SaaS | **Commercial license** — also for private in-tenant deployment with SSO. |

**To purchase or ask which track fits**, open an issue or contact the author.

© 2026 Sam Yost.
