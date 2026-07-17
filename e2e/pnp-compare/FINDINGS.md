# Renderer-fidelity findings — pnp/List-Formatting sweep, 2026-07-17

29 community samples (16 column, 11 row/view, 2 tile) from pnp/List-Formatting
were rendered in the app via the share-URL harness in this directory and
compared, by eye, against the screenshots those samples ship — i.e. against
what real SharePoint painted for the same JSON. Mock rows were hand-matched
to each sample's screenshot. Environment caveats excluded from findings:
tenant/external images 404 offline (broken-image placeholders), tenant theme
≠ stock theme (shade drift tolerated), and iconName glyphs ride a locally
generated MDL2 font shim (lowercase icon aliases like `info`/`warning` don't
resolve in the shim — an artifact, not a renderer gap).

Every code claim below was re-verified headlessly against `dist-lib` (the
probes are quoted). SP-side claims rest on the samples' own screenshots —
they worked on a real tenant. HANDOFF §3 closed topics were checked first;
nothing below contradicts a pinned date/lookup/person blank-semantics test.

## A. Engine (expressions.ts) — confirmed divergences

1. **`Number(dateString)` / date arithmetic returns garbage, not epoch ms.**
   `Number('2026-07-10')` → `2026` (parseFloat), `[$A]-[$B]` on two dates →
   `0`. The classic SP idiom `floor((Number([$Died])-Number([$Born]))/86400000)`
   silently yields 0. Date *functions* (`getMonth`, `toLocaleDateString`,
   `<=` comparisons vs `@now`) handle ISO strings fine — only numeric
   coercion doesn't. Evidence: `date-difference` renders Age 0 for every row
   (SP: 20/24/18/89/27/36). In `date-range-rag` the *class* branches still
   evaluate (`<=` works, so overdue → severeWarning and the elapsed
   fraction picks warning for the rest — per-row probe), but the bar
   *widths* come out `Infinity%` / `178428959797400%` (zero/garbage
   denominators from string date subtraction) and are dropped as invalid
   CSS; the reason no tint is VISIBLE either is recorded under finding 17
   (the tinted bar collapses to 0px height — `min-height: inherit` has no
   cell min-height to inherit in our grid; DOM probe: class present,
   height 0). Note the existing contract
   test only pins the `Number(Date([$X]))` form (core.test.ts:41) — the
   bare `Number([$X])` form real samples use is the gap. Suggested fix:
   `toNumber` should treat ISO-date-shaped strings (and Date values) as
   epoch ms, test-first in core.test.ts.

2. **`.length` property accessor unsupported on strings.**
   `=@currentField.lookupValue.length` → `''`. SP supports it (the
   `generic-dynamic-colored-pills` sample derives its whole rgba palette
   from it and works on SP). Ours: `rgba(NaN,…)` → invalid → dropped → white
   pills instead of vivid per-vendor colors. Culprit: the dotted-prop path
   in `resolveFieldRef`/property access (expressions.ts:323 area) knows
   person/lookup props but not `length`.

3. **`forEach` over a multi-choice value doesn't split.**
   Mock choiceMulti cells store `'A;#B;#C'`; `evaluateForEachList`
   (expressions.ts:628) wraps any non-array scalar as `[value]`, so
   `multi-choice-foreach` renders ONE 16px box containing the raw `;#`
   string (clipped to "A;#") instead of one box per choice. Same root
   cause makes `length([$MultiChoice])` return string length (7) instead
   of choice count (3) (expressions.ts:409-410 falls through to
   `toStr(v).length`). Fix candidates: split `';#'` strings in
   evaluateForEachList + length(), or store choiceMulti rows as arrays.

4. **`toLocaleString(number)` renders a date.**
   `=toLocaleString(12.5)` → `"12/5/2001, 12:00:00 AM"`. SP produces a
   locale-formatted *number* ("12.5") for numeric input. Probe-only finding
   (the sampled formatters didn't hit it, `number-localization` in the pnp
   repo does).

5. **`.displayValue` on number/date fields returns `''`.**
   `number-battery` loses both its fill width and its "90%" labels;
   `number-star-rating` loses its trailing "3.6" label. On SP,
   `@currentField.displayValue` is the locale display string of the field.
   The mock model has no display-string channel; emulating "number → short
   locale string, date → locale date string" would cover the common cases.

6. **Blank-cell `== ''` nuance for null non-date cells.** A `null` cell
   compares `== ''` → false, while a *missing* key → true. For dates that
   null behavior is the live-verified §3 contract (untouchable). But
   `yesno-checkmark-format` shows SP takes the `@currentField == ''`
   branch for a blank yes/no cell (red ⊗ pill in their screenshot); ours
   falls through to the false/low branch. If mock "blank" for non-date
   fields is represented as null, those cells diverge from SP. Needs an
   owner call: either represent blank non-date cells as `''`/absent in the
   mock model, or scope the null≠'' rule to date/lookup/person types.
   (Related, lower-confidence: `event-tiles` compares
   `[$fAllDayEvent]=='Yes'` and works on SP — suggesting SP matches
   boolean display strings; ours doesn't. Needs live verification.)

## B. Renderer / canvas — confirmed divergences

7. **`viewExtras.additionalRowClass` is never applied to canvas rows.**
   canvas.ts's row/tile loops (~line 385) render `state.doc.root` per row
   and ignore the wrapper class; only templatePreview.ts has an
   `applyRowClass`. All three rowclass samples (`alternating-rows`,
   `overdue-rowclass`, `status-rowclass`) render with zero row tinting —
   on SP they zebra-stripe / tint overdue rows / tint by status. This is
   the whole point of those formatters, and the class is already carried
   in viewExtras. Fix: evaluate the class expression per row (same
   EvalContext) and add it to `.wb-mock-viewrow`.

8. **The app's global `* { box-sizing: border-box }` reset leaks into
   rendered formatter content** (style.css:109). SP's default is
   content-box. Live probe: `generic-svgicon-format`'s 13×13 svg with
   `padding-right: 6px` keeps only a 7px drawing area in ours → every
   glyph is clipped ~40%; on SP the box is 13px content + 6px padding.
   Any sample mixing explicit width/height with padding drifts the same
   way. Fix: reset `box-sizing: content-box` on the preview subtree
   (canvas + flyout + grid cells), letting formatters opt back in like
   `number-data-bar` explicitly does.

9. **Grid column looks override the formatter's own root `width`** —
   `gridCellForField` merges `flex: 1; min-width: 0` onto the look's root
   (gridScaffold.ts:78), and `flex: 1` (basis 0, grow 1) makes the
   browser ignore the root's `width` property. `number-data-bar` renders
   every bar full-column-width (SP: 35%/20%/50%/5%/0/100%/70% — the whole
   point of a data bar). Deliberate design (HANDOFF §2) but it breaks
   width-driven formatters; `flex: 0 1 auto` + `width` passthrough, or
   wrapping looks in a host cell div instead of style-merging, would keep
   both. Needs an owner call since the merge is a documented invariant.

## C. Theme CSS (theme.ts) — confirmed divergences

10. **`sp-field-severity--low` paints amber; real SP paints none/white.**
    theme.ts:133 gives `--low` the same `#fff4ce` as `--warning`. Both the
    `yesno-checkmark-format` and `text-conditional-format` screenshots
    show SP rendering `--low` cells untinted white ("false" rows, "In
    progress" rows). Ours tints them amber, which also makes blank-vs-
    false rows indistinguishable in the yesno sample.

11. **`sp-field-dataBars` colors are inverted.** theme.ts:137 paints solid
    `themePrimary` background with white text; SP paints the light tint
    (themeLighter-family, ~#c7e0f4 stock) with dark text and a thin
    primary top edge. See the `number-data-bar` screenshot.

12. **The `sp-row-*` family is mostly missing.** Only `sp-row-card` exists
    (theme.ts:131) and it lacks SP's padding/margin, so `multi-line-view`
    renders as flat full-width text instead of card rows; `sp-row-title`
    (title weight/size), `sp-row-listPadding` and `sp-row-button` have no
    rules at all. (The sample's @me-conditional button logic — AST syntax
    — evaluated perfectly; this is purely the class CSS.)

## D. Import / document model gaps

13. **The modern `tileProps` wrapper is rejected by importJson**
    (serializer.ts:57 only detects the legacy bare
    `{formatter, height, width}` shape). `event-tiles-only.json` — the
    documented current tile syntax `{$schema, tileProps: {…}}` — throws
    "Unrecognized formatter shape". The harness unwraps it as a workaround;
    the serializer should detect it (and export it back).

14. **`additionalRowClass`-only view JSON is rejected** ("Unrecognized
    formatter shape") — `overdue-rowclass` et al are real, popular
    formatters with no `rowFormatter` key. SP keeps native row rendering
    and adds the class. Import could accept it as a row doc with an
    empty/default root (or the grid scaffold) + viewExtras.

15. **Hyperlink cells have no description channel** — `@currentField.desc`
    always falls to the fallback branch ('No alternative text' in
    `hyperlink-display-url`; SP shows the link's set description). Mock
    hyperlink values are plain strings; an optional `{url, desc}` shape
    would close it.

16. **No image-column type** — `[$Image].serverRelativeUrl`-style fields
    (picture-link-tiles) can only be mocked as untyped objects, and
    `getThumbnailImage` returns `JSON.stringify(obj)` instead of a usable
    URL (probe). A thumbnail emulation (serve the serverRelativeUrl or a
    placeholder data-URI) would make these samples renderable.

## E. Candidates needing live-tenant verification (visual-compare harness)

17. **Root/child layout context: block children stack in ours, sit in a
    row on SP.** Three independent samples suggest SP gives rendered
    formatter roots a layout default ours doesn't have:
    `multi-person-facepile` (root plain div, 32px child divs — SP:
    horizontal facepile, ours: vertical stack), `to-do` (circle/text/icons
    stack instead of one row), `picture-link-tiles` (root `a` with
    width/height but no display — SP sizes it as a 230×180 card, ours
    treats it as inline so width/height are ignored). A fourth signal:
    `date-range-rag`'s bar div uses `min-height: inherit`, which resolves
    to nothing in our grid cell but picks up SP's native cell min-height
    on a real list (DOM probe: class applied, height 0). Hypothesis: SP's
    cell/tile container renders the root with `display:flex` (list cells)
    or at least block-level sizing plus a cell min-height. Verify against
    a live tenant before changing the renderer default.

18. **`chevron-shape-format` renders visibly off, but offline evidence is
    inconclusive.** (An earlier draft of this report blamed `clip-path`;
    that was wrong — the sample builds its chevrons from CSS *border
    triangles* over absolutely-positioned children, no clip-path anywhere.
    schema.ts:74's "clip-path: not supported" entry is untested by this
    sweep either way.) The divergence we see — labels landing below the
    200×120 box instead of centered, shapes reading as rectangles — is
    entangled with the site-relative images being offline and with the
    absolute-positioning static-offset context, so it needs a live-tenant
    look before any code is blamed.

19. **Icon-overlay metrics**: `custom-hover-card`'s two-icon overlay
    (16px + margin-left:-16px) misaligns slightly in ours — glyph advance
    widths differ from SP's font rendering. Cosmetic; check on tenant
    before tuning.

20. **`bar-graph` axis decorations** (the IsLastItem row's absolutely
    positioned axis labels "Fruits"/"Votes") don't appear. Everything else
    in that sample matches. Likely interaction between position:absolute
    and the row host's overflow/position context.

## Clean passes (same branches, colors, shapes, text as the SP screenshots)

`currency-symbol-concatenation` (green/red budget compare), `generic-action-buttons`
(all four enabled/disabled state combos), `generic-traffic-light-status`
(full CSS-art traffic light), `number-piechart` (arc geometry incl. the
large-arc flip), `number-star-rating` stars (incl. fractional clipping),
`announcements` (card colors/icons/layout), `bar-graph` bars/thresholds,
`to-do` branch logic (overdue red / Today blue / strikethrough / stars),
`event-tiles` date badges & time composition — *except* its all-day branch,
which takes the timed-event path in ours (`[$fAllDayEvent]=='Yes'` vs a
boolean cell — the finding-6 display-string nuance), `custom-hover-card` flyout
content, `multi-line-view` @me logic (AST syntax), `text-conditional-format`
& `yesno-checkmark-format` apart from the findings above, `faq-accordion`
row bodies (question pills are group headers — the known groupProps
emulation gap, HANDOFF §4).
