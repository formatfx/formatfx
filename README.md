# <img src="public/favicon.svg" width="30" alt="" valign="middle"> FormatFX

[![CI](https://github.com/formatfx/formatfx/actions/workflows/ci.yml/badge.svg)](https://github.com/formatfx/formatfx/actions/workflows/ci.yml)

**A visual IDE for SharePoint list formatting. Click or code—both are first-class.**

[**Try it: formatfx.dev**](https://formatfx.dev) — no sign-in, no install. Fully client-side.

---

### What you get

- **Visual & JSON, side-by-side.** Format cells dialog for clicking. Live JSON editor for typing. Both feed the same preview; changes in one reflect instantly in the other.
- **SharePoint JSON that actually works.** The editor knows SP's expression syntax, allow-lists, quirks, and silent-failure gotchas. Type a formula; it auto-compiles to SharePoint AST or Excel-string form. Paste community JSON; it decompiles back to something you can read and edit.
- **Your list, not a demo.** Import your real SharePoint list in seconds. Edit columns and rows you recognize. Every choice, every theme, every formatter synced live from your actual data.
- **Linter + stress test + explainer.** Catch silent-failure quirks before you ship. Stress-test against null dates, boundary numbers, crowded multi-values. Paste any formatter and get plain-English breakdown of what it does.
- **One gesture to deploy.** One-click Deploy snippet from your own list page. Or copy the JSON straight into SharePoint. A companion browser extension makes the round-trip automatic.

---

### Why it matters

SharePoint lists are a real database with auth and permissions already solved. But formatting them meant choosing: learn raw JSON in a sidebar, or give up on polish. FormatFX collapses that choice. Build in the UI when it's faster. Drop into the editor when you need precision. The linter and stress-test run either way—you never ship something that silently fails. And because the editor understands SharePoint's JSON dialects and limits, what you write is guaranteed schema-valid and tested against real SharePoint behavior.

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

The UI-free engine ships as [**`formatfx`**](https://www.npmjs.com/package/formatfx) on npm — the teaching linter, expression engine, and SharePoint JSON tools, headless and dependency-free:

```bash
npx formatfx lint my-formatter.json        # the silent-failure quirks, explained
npx formatfx lint *.json --strict --json   # CI-friendly: warnings fail, JSON out
npx formatfx validate my-formatter.json    # shape check only
```

```ts
import { importJson, lintDocument, evaluate, buildExtractSnippet } from 'formatfx';
```

The package exports the schema types, JSON ⇄ document serializer, expression engine (both SharePoint syntaxes), allow-lists, schema importer, and connectivity snippet builders. The renderer is deliberately not part of the headless surface — the sandbox at formatfx.dev *is* the renderer.

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


© 2026 Sam Yost.
