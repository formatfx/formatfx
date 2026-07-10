# FormatFX companion (Tier 1 — browser extension)

The context-aware go-between for FormatFX and SharePoint: **extract** a list's
formatting into FormatFX, **apply** formatters back onto its columns and views,
and — on sites you explicitly **connect** — a live badge and refresh channel.
No devtools, no "allow pasting".

This is its own package (own `package.json`, esbuild build), exempt from the
app's zero-runtime-dependency rule. See `docs/CONNECTIVITY.md` §4 for where it
sits in the plan and §1 for *why it must be an extension* (the page session is
the only app-registration-free auth left).

## The permission model (per-site opt-in)

A fresh install has **zero standing access**: `activeTab` + `scripting` mean
your toolbar click authorizes exactly the tab you're looking at, nothing else.

Clicking **Connect this site** in the popup grants a standing host permission
for **that one tenant origin** (e.g. `https://contoso.sharepoint.com/*`, within
the manifest's `optional_host_permissions`). Connected sites get the
context-aware experience — the badge, page context, and the app-side refresh
channel. Disconnect from the popup (or `chrome://extensions` → Site access) at
any time; the connected list is *derived from the granted permissions*, never
stored, so a revoke is instantly authoritative.

Reads on a connected site never mutate anything (CONNECTIVITY §8). **Writes
always stay behind your click and a batched confirm**, connected or not.

Sovereign clouds (`*.sharepoint.us`, `*.sharepoint.de`) are a documented
follow-up: the optional pattern stays `*.sharepoint.com` until there's a
verified need.

## How it works

Same auth and the same small set of REST endpoints as the Tier-0 snippets:

- **Extract** runs a read-only capture (`src/bridge/spClient.ts →
  captureSnapshot`) in the page's MAIN world → a **List Snapshot** pushed to a
  fresh formatfx.dev tab or copied to your clipboard.
- **Apply** reads a FormatFX **apply payload** (`src/bridge/applyPayload.ts`)
  and writes each formatter with a single batched confirm, then a `MERGE` per
  target (`spClient.ts → applyFormatters`).

All the REST/protocol logic lives in `src/bridge/` in the main repo — audited
and node-tested in `src/bridge/bridge.test.ts` (the same executed-round-trip
harness the snippets use). The files here are thin shells over pure modules,
and every pure module is unit-tested from the root suite:

| File | Role |
|---|---|
| `manifest.json` | MV3. `activeTab` + `scripting` + `storage` + clipboard; `optional_host_permissions` for per-site Connect. |
| `src/popup.ts` / `popup.html` | The toolbar UI: extract picker, apply, staged apply, grab, Connect/Disconnect. |
| `src/inject.ts` | The MAIN-world worker: a `postMessage` request/response bridge to the `src/bridge` runtime. |
| `src/web.ts` | Content script on **formatfx.dev only** — the extension's half of the page channel (`src/bridge/extChannel.ts`). |
| `src/background.ts` | MV3 service worker: storage migration, per-tab badge, message routing. Thin — no business logic. |
| `src/pageKind.ts` | Pure URL classifier: `sharepoint` (list/library view) / `sharepoint-site` / `formatfx` / `other`. |
| `src/connections.ts` | Pure per-site opt-in helpers: URL → origin pattern, granted-origins display. |
| `src/badge.ts` | Pure badge mapping table (state → text/color/title). |
| `src/staging.ts` | The versioned `chrome.storage.local` schema (staged applies, pushed snapshots, backups). |
| `src/bgProtocol.ts` | Pure popup/web ⇄ background message vocabulary. |
| `src/context.ts` | Pure popup-dashboard view-model (formatted columns/views, grab field sets). |
| `src/backups.ts` | Pure pre-apply backup & restore logic (bounded history, clear-target restores). |
| `src/pageCall.ts` | The shared inject-into-MAIN-world + postMessage call dance (popup + background). |
| `src/chrome.d.ts` | Minimal hand-written API types (no `@types/chrome`). |

## Build & load

```bash
cd extension
npm install
npm run typecheck   # tsc, no emit
npm run build       # → dist/
```

Then in Chrome/Edge: `chrome://extensions` → enable **Developer mode** →
**Load unpacked** → pick `extension/dist`. (CI typechecks and builds this
package on every PR.)

## Verifying (the part CI can't reach)

Like the Tier-0 deploy snippet, the live write path can only be confirmed on a
real tenant. One-time checklist on a list you can edit:

- [ ] Fresh install: no badge anywhere, no permission prompts; the popup shows
      the right panel on a random site / SP site page / SP list page / formatfx.dev.
- [ ] Extract on a real list page → picker → snapshot imports into FormatFX.
- [ ] Copy an apply payload from FormatFX → Apply → the batched confirm echoes every target.
- [ ] After confirm, the formatter is live on the column/view after a refresh.
- [ ] A multi-column payload applies all targets; a 403 on one is reported without blocking the rest.
- [ ] On a non-list page, both buttons teach instead of failing silently.
- [ ] Connect a site → badge dot on its list pages, tracks SPA navigation;
      other tenants unaffected. Disconnect → badge gone, no site access listed.
- [ ] Dashboard lists the formatted columns/views; a per-column Grab opens
      FormatFX with that column + formatter loaded.
- [ ] Apply → a Backups entry appears; Restore echoes REPLACED/REMOVED in the
      confirm; restoring a previously-empty target clears it on-tenant.
- [ ] Extract on a list with a Quick Step → the snapshot carries `rules`
      (+ `quickstepsProperties`); a plain list → no `rules` key (#214).
- [ ] With the site connected and the list open in a tab: the app's Data tab
      shows the live section; "Pull list"/"Rows only" refresh from the tab;
      disconnected → a teaching error names the Connect button.

## The page channel (clipboard-free apply)

A content script on **formatfx.dev** (`src/web.ts`, the app's own origin — not
a tenant) lets FormatFX hand a payload to the extension without the clipboard:

- In FormatFX: JSON tab → Deploy… → **Send to extension** — stages the apply
  payload into `chrome.storage.local` (protocol: `src/bridge/extChannel.ts`,
  re-validated on arrival).
- On your list tab: open the popup → **Apply staged** — the same gesture-bound
  write as the clipboard path, just sourced from the channel instead.

The channel only *stages*; it never writes. The write stays under `activeTab`
on the list tab, so click-only safety holds. When the extension isn't
installed, FormatFX hides the button and behaves exactly as before.

## Extract-push (clipboard-free capture)

Extract opens a **column/view picker** (all columns + the current view
pre-checked). **Open in FormatFX** filters the capture, stashes it, and opens a
fresh formatfx.dev tab that **auto-loads** it — `web.ts` hands the snapshot to
the page and the app imports it through its normal guarded path (a fresh tab
has nothing to clobber). **Copy to clipboard** remains as a fallback. The
current view is detected from the page URL (`?viewid=`), falling back to the
list's default view, and rides along flagged so it loads as the main document.

## Status

**v0.2 — the context-aware companion** (CONNECTIVITY §4). On top of v0.1's
Extract (picker → push or clipboard) and Apply (page channel or clipboard,
one batched confirm):

- **Per-site opt-in Connect** + per-tab badge (connected list ● /
  staged-apply count / FX; silent everywhere else).
- **Popup dashboard**: list, view, which columns/views carry formatters,
  one-click per-item Grab into FormatFX.
- **Pre-apply backup & restore**: every apply files what it overwrote
  (bounded local history); Restore is the same confirm-first apply, and a
  previously-empty target restores as a `clear` (apply payload v2).
- **Rules/Quick Steps capture** (#214): `GetAllRules()` read-POST rides the
  snapshot as additive keys, inert.
- **Channel v2**: live presence (the app sees which connected list tabs are
  open) + read-only refresh (the app pulls a fresh capture — full replace
  behind a confirm, or rows-only).

Deliberately NOT here: sp-formatter-style in-page live preview (it
monkey-patches SharePoint's undocumented internal renderer — fragile and
unauditable; the live-linked refresh above is the chosen alternative), and
`*.sharepoint.us`/sovereign-cloud connect (waits for a verified need).
