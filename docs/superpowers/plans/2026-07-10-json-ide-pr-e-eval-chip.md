# PR E — live eval chip + list-formatting extras (spec §6)

Spec: `docs/superpowers/specs/2026-07-09-json-pane-ide-design.md` §6. The last
PR of the JSON-pane IDE sequence. Branch: `claude/pr-d-e-handoff-ayz0hn`
(session-designated; the spec table's `claude/json-ide-eval-chip` name predates
the session naming scheme). Stacked on PR D (#272) — rebase onto main when D
merges.

## Pieces

1. **`editor/exprPreview.ts` (pure)** — `evalChipAt(text, caret, ctx)`:
   caret inside any live string (or a `forEach` value) → evaluate through the
   REAL engine against the sample row (`evaluate` / `parseForEach` +
   `evaluateForEachList`, same `ctxForRow(0)` source as completions; upgrade
   hook to the canvas's active row noted in the code). Returns
   `{ text, kind: value|list|error, type? }` — value part truncated ~48 chars,
   type-badged. Works mid-edit: the tolerant JSON lexer finds the string, the
   engine's own error becomes the `⚠` chip. No ctx (no rows) → no chip.
   - UI: appends to the existing signature strip (`.wb-json-sighint`) in
     jsonIde — `→ "3 days overdue"`, `→ 3 items: Red, Green, …`, `⚠ message`.
     The strip now shows when there's a hint OR a chip.

2. **Occurrence highlighting** — caret on an `xfield`/`xtoken` softly lights
   every same-text occurrence. Pure: `occurrenceTargetAt` in jsonHighlight;
   `renderJsonHtml` gains an `occurrence` param and stamps `wb-tok-occ` on
   matching sub-tokens. Overlay class only, no behavior.

3. **Color chips** — string values (JSON `str` under color-ish keys, `xstr`
   literals inside expressions) matching `#hex` / `rgb()/hsl()` / a curated
   named-color list get a swatch: `wb-tok-color` + `--wb-chip` custom property
   on the span, swatch drawn by an absolutely-positioned `::before` OVER the
   opening quote glyph (zero metric impact — the four layers' alignment stays
   arithmetic). Named colors only chip under keys matching
   /color|fill|stroke|background|border|outline/i (a plain `"red"` under
   `txtContent` is data, not a color); unambiguous formats chip anywhere.

4. **Size meter** — right edge of the breadcrumb strip (`#wb-json-size` in a
   new `.wb-json-crumbrow` flex row; the crumbs' hidden-contract is untouched):
   live byte count of what Copy produces with the CURRENT toggles (sanitize +
   names). No threshold judgment: the SP docs (column-formatting,
   view-formatting, syntax reference) document **no** JSON size cap — verified
   via Microsoft Learn 2026-07-10 per the spec's condition.

5. **iconName glyphs in hover** (the spec's "if cheap" checkpoint — it is:
   the Fabric icon font is already loaded): hovering an `iconName` value shows
   the glyph + verifies the name against iconData's verified-on-SP set.
   Completions keep their text-only rendering (acMenu is shared chrome —
   out of scope).

6. **Bonus (owner ask): syntax color mapper** — kebab → "Syntax colors…"
   panel: a color input per `--wb-syn-x*` slot for the CURRENT theme,
   overrides stored per-theme in localStorage (`wb-syn-colors`, a NEW key —
   nothing renamed), applied as inline custom properties on `<body>` (wins
   over both theme blocks), re-applied on theme switch. Reset per theme.
   Pure decisions in `editor/synPalette.ts` (load/save/apply), pinned by
   `synPalette.test.ts`.

## Tests

- `exprPreview.test.ts` (pure): formula/bare-ref/@token values, forEach lists,
  engine errors, truncation, no-ctx, caret-outside cases.
- `jsonHighlight.test.ts` additions: occurrence stamping, color-chip classes +
  `--wb-chip` values, named-color key gating.
- `jsonHover.test.ts` additions: iconName glyph info.
- `synPalette.test.ts`: round-trip, malformed storage, apply/remove.
- `jsonIdeExtras.dom.test.ts`: chip in the strip through the real panel,
  size meter live + toggle-reactive, occurrence class end-to-end, syn panel
  wiring.
