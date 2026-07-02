# Smoother formatter round-trip — design

Date: 2026-06-29

Two independent, cohesive improvements to how column/view formatters move
between SharePoint, FormatFX, and the companion extension.

## Feature 1 — Per-column formatter opt-out (capture + import)

The extract path captures every column's `customFormatter`, and import
registered **all** of them unconditionally. Users want to choose which
formatters to pull in. Chosen location: **both** the extension picker
(capture-time) and the app import (load-time).

### 1a. Extension picker (capture-time filter)
- In `renderPicker`, every field that has a `customFormatter` gets a secondary
  **"formatter"** checkbox beside its column checkbox (default checked).
  Columns without a formatter show nothing extra.
- `selectFromSnapshot` gains a pure `dropFormatterFor?: string[]` option that
  strips `customFormatter` from those fields (the column and its data still
  travel). `selectedSnapshot()` collects the unchecked formatter boxes.

### 1b. App import review step (paste/file path only)
- `applyImportedSchema` gains `opts.dropColumnFormatters?: string[]`; it
  registers only the column formatters not in that set.
- The Data-tab import parses first; if the snapshot carries column formatters,
  it shows a **checklist of just those columns** (all checked) + **Import**.
  Nothing applies until confirmed. No formatters → import immediately (today's
  behaviour).
- The extension **push** path (`onPushedSnapshot`) stays auto-load — already
  filtered by the picker, so a second dialog would be redundant.

## Feature 2 — Pull the current formatter with one gesture

Today the deploy hand-off hides under Advanced → Send to extension. Two new
entry points, sharing one core.

### Shared core — `editor/deployPayload.ts`
`buildCurrentApplyPayload()` builds the current formatter into a one-target
apply payload, lint-gated, DOM-free (reads `state`, optional view/list titles).
Extracted from the `jsonPanel` closure; the Advanced buttons now call it too.

### 2a. Top-level app button
A **"Send to extension"** button in the topbar, hidden until the extension
announces itself (`onExtensionReady`), staging via the existing channel.

### 2b. Extension "Grab this formatter" button
On a formatfx.dev tab the popup gains **"Grab this formatter."** Flow:
1. popup → `chrome.tabs.sendMessage(tabId, { action: 'grabFormatter' })`
2. `web.ts` content script → posts `ext→page` `requestFormatter`
3. app (`extensionBridge`, via `onFormatterRequest`) replies `page→ext`
   `formatter` with the payload or a lint/empty error
4. `web.ts` relays the reply; popup re-validates and writes `STAGE_KEY`
5. user switches to the list tab → **Apply staged** (unchanged)

New `extChannel` message kinds: `requestFormatter` (ext→page),
`formatter` (page→ext). Both get guards + builders, node-tested.

## Error handling
- Lint errors / empty doc → teaching error surfaced at the click site.
- No app/extension response → timeout message (4 s).
- Off-the-wire payloads re-validated with `parseApplyPayload` on arrival.

## Testing
- `selectFromSnapshot` `dropFormatterFor` — pure, unit-tested.
- New `extChannel` guards/builders — unit-tested like the existing ones.
- `buildCurrentApplyPayload` exercised via the shared callers.
- Full suite: 494 unit tests pass; app + extension builds + typechecks clean.
