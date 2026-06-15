# FormatFX companion (Tier 1 — browser extension)

One-click version of the Tier-0 paste snippets: **extract** a SharePoint
list's formatting into FormatFX, or **apply** formatters from FormatFX back
onto its columns and views — no devtools, no "allow pasting".

This is its own package (own `package.json`, esbuild build), exempt from the
app's zero-runtime-dependency rule. See `docs/CONNECTIVITY.md` §4 for where it
sits in the plan and §1 for *why it must be an extension* (the page session is
the only app-registration-free auth left).

## How it works

Same auth and the same ~6 REST endpoints as the snippets, nothing more:

- **Extract** runs a GET-only capture (`src/bridge/spClient.ts → captureSnapshot`)
  in the page's MAIN world and copies a **List Snapshot** to your clipboard.
  Paste it into FormatFX → Data → Import schema.
- **Apply** reads a FormatFX **apply payload** (`src/bridge/applyPayload.ts`)
  from your clipboard and writes each formatter with a single batched confirm,
  then a `MERGE` per target (`spClient.ts → applyFormatters`). A "group of
  columns" is just a payload with many targets.

All the REST/protocol logic lives in `src/bridge/` in the main repo — audited
and node-tested in `src/bridge/bridge.test.ts` (the same executed-round-trip
harness the snippets use). The files here are a thin shell:

| File | Role |
|---|---|
| `manifest.json` | MV3. `activeTab` + `scripting` — your click authorizes the current tab; **no standing host permission**. `optional_host_permissions` reserved for the future live channel. |
| `src/popup.ts` / `popup.html` | The two buttons; clipboard read/write; status. |
| `src/inject.ts` | The MAIN-world worker: a `postMessage` request/response bridge to the `src/bridge` runtime. |
| `src/chrome.d.ts` | Minimal hand-written API types (no `@types/chrome`). |

## Build & load

```bash
cd extension
npm install
npm run typecheck   # tsc, no emit
npm run build       # → dist/
```

Then in Chrome/Edge: `chrome://extensions` → enable **Developer mode** →
**Load unpacked** → pick `extension/dist`.

## Verifying (the part CI can't reach)

Like the Tier-0 deploy snippet, the live write path can only be confirmed on a
real tenant. One-time checklist on a list you can edit:

- [ ] Extract on a real list page → clipboard has a snapshot → it imports into FormatFX.
- [ ] Copy an apply payload from FormatFX → Apply → the batched confirm echoes every target.
- [ ] After confirm, the formatter is live on the column/view after a refresh.
- [ ] A multi-column payload applies all targets; a 403 on one is reported without blocking the rest.
- [ ] On a non-list page, both buttons teach instead of failing silently.

## The page channel (clipboard-free apply)

A content script on **formatfx.dev** (`src/web.ts`, the app's own origin — not
a tenant) lets FormatFX hand a payload to the extension without the clipboard:

- In FormatFX: JSON tab → Deploy… → **Send to extension** — stages the apply
  payload into `chrome.storage.local` (protocol: `src/bridge/extChannel.ts`,
  re-validated on arrival).
- On your list tab: open the popup → **Apply staged** — the same gesture-bound
  write as the clipboard path, just sourced from the channel instead.

The channel only *stages*; it never writes. The write stays under `activeTab`
on the list tab, so there's still no standing tenant permission and click-only
safety holds. When the extension isn't installed, FormatFX hides the button and
behaves exactly as before.

## Status

v0.1 — Extract/Apply in the popup, clipboard **or** the page channel for apply,
one batched confirm. Follow-ups (CONNECTIVITY §4): extract-push (list tab → an
open FormatFX tab), the continuous live-preview channel, and an in-Data-tab
affordance.
