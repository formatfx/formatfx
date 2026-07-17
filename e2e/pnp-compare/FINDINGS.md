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

## Fix status (2026-07-17 fix pass, same PR)

Findings 1–4, 8, 10–13 are **FIXED** in this PR (test-first; affected
samples re-captured and re-compared). 5 is partially fixed. 6, 9, 14–16
are owner calls / model extensions; 17–20 await live-tenant verification.
Finding 21 (lookDialect) was found *by* the fix pass and is fixed.

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
   **FIXED**: `.length` resolves on strings (multi-choice `;#` strings
   count choices) and arrays. Fixing it exposed finding 21 (the dialect
   converter was breaking the same expression a second way); with both
   fixed, the pills render computed rgba colors + borders.

3. **`forEach` over a multi-choice value doesn't split.**
   Mock choiceMulti cells store `'A;#B;#C'`; `evaluateForEachList`
   (expressions.ts:628) wraps any non-array scalar as `[value]`, so
   `multi-choice-foreach` renders ONE 16px box containing the raw `;#`
   string (clipped to "A;#") instead of one box per choice. Same root
   cause makes `length([$MultiChoice])` return string length (7) instead
   of choice count (3) (expressions.ts:409-410 falls through to
   `toStr(v).length`). Fix candidates: split `';#'` strings in
   evaluateForEachList + length(), or store choiceMulti rows as arrays.
   **FIXED** (split in evaluateForEachList + length()): the sample now
   renders one box per choice, matching SP.

4. **`toLocaleString(number)` renders a date.**
   `=toLocaleString(12.5)` → `"12/5/2001, 12:00:00 AM"`. SP produces a
   locale-formatted *number* ("12.5") for numeric input. Probe-only finding
   (the sampled formatters didn't hit it, `number-localization` in the pnp
   repo does). **FIXED**: numbers now format as locale numbers.

5. **`.displayValue` on number/date fields returns `''`.**
   `number-battery` loses both its fill width and its "90%" labels;
   `number-star-rating` loses its trailing "3.6" label. On SP,
   `@currentField.displayValue` is the locale display string of the field.
   The mock model has no display-string channel; emulating "number → short
   locale string, date → locale date string" would cover the common cases.
   **PARTIALLY FIXED**: displayValue now approximates by type (number →
   locale number, date → locale date, boolean → Yes/No). Columns with SP
   display *settings* still differ — the battery sample shows "0.9" where
   SP shows "90%" (percent-format display isn't in the mock model), so its
   fill math stays off too.

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

7. **RETRACTED as a renderer bug — and it exposed a different one.** The
   original finding said the canvas should apply
   `viewExtras.additionalRowClass` per row. The MS syntax reference says
   the opposite: *"Using the rowFormatter property will override anything
   specified in the additionalRowClass property. They are mutually
   exclusive… If a rowFormatter is specified, then additionalRowClass is
   ignored."* A FormatFX row view always exports a rowFormatter, so the
   canvas IGNORING the class is faithful. The untinted rowclass renders in
   this sweep were a harness artifact (its fallback synthesizes a
   rowFormatter — exactly the combination SP ignores). What this actually
   surfaced: (a) the real gap is that `additionalRowClass`-ONLY JSON — the
   mode where the class works, riding native rows — can't be imported at
   all (finding 14); (b) **the row-view builder's zebra option exports
   `additionalRowClass` alongside a built rowFormatter, which real SP will
   silently ignore** — flagged to the owner, needs a live-tenant check and
   probably a builder change; (c) a new teaching lint rule
   `rowclass-with-rowformatter` (warning) now catches the dead combination
   for makers — and it fires on the builder's own zebra output, which is
   the point.

8. **The app's global `* { box-sizing: border-box }` reset leaks into
   rendered formatter content** (style.css:109). SP's default is
   content-box. Live probe: `generic-svgicon-format`'s 13×13 svg with
   `padding-right: 6px` keeps only a 7px drawing area in ours → every
   glyph is clipped ~40%; on SP the box is 13px content + 6px padding.
   Any sample mixing explicit width/height with padding drifts the same
   way. Fix: reset `box-sizing: content-box` on the preview subtree
   (canvas + flyout + grid cells), letting formatters opt back in like
   `number-data-bar` explicitly does.
   **FIXED**: `[data-sp-path]` subtrees + flyouts get `box-sizing:
   content-box` (a formatter's own inline box-sizing still wins).
   Re-captured: the svg glyphs render whole.

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
    **FIXED**: `--low` is untinted now (pinned in core.test.ts, both
    theme modes); re-captured yesno/text-conditional match the SP
    screenshots on this.

11. **`sp-field-dataBars` colors are inverted.** theme.ts:137 paints solid
    `themePrimary` background with white text; SP paints the light tint
    (themeLighter-family, ~#c7e0f4 stock) with dark text and a thin
    primary top edge. See the `number-data-bar` screenshot.
    **FIXED**: light theme tint + body text per palette mode (pinned in
    core.test.ts). Bar WIDTHS remain full-column — that's finding 9, the
    deferred flex-merge owner call.

12. **The `sp-row-*` family was mostly missing** — only a bare
    `sp-row-card` existed (no padding/margin), so `multi-line-view`
    rendered as flat full-width text instead of card rows, and
    `sp-row-title`/`sp-row-listPadding`/`sp-row-button` had no rules at
    all. (The sample's @me-conditional button logic — AST syntax —
    evaluated perfectly; this was purely class CSS.) **FIXED in this PR**:
    theme.ts now styles all four, calibrated against the sample's
    screenshot since SP doesn't document the pixel values (re-verified
    render matches; fine-tune later via the live visual-compare harness).

## D. Import / document model gaps

13. **The modern `tileProps` wrapper is rejected by importJson**
    (serializer.ts:57 only detects the legacy bare
    `{formatter, height, width}` shape). `event-tiles-only.json` — the
    documented current tile syntax `{$schema, tileProps: {…}}` — throws
    "Unrecognized formatter shape". ~~The harness unwraps it as a
    workaround~~ **FIXED**: importJson detects tileProps now (legacy bare
    shape still accepted; export unchanged — SP accepts both). The harness
    workaround is removed; event-tiles builds through the real path.

14. **`additionalRowClass`-only view JSON is rejected** ("Unrecognized
    formatter shape") — `overdue-rowclass` et al are real, popular
    formatters with no `rowFormatter` key. SP keeps native row rendering
    and adds the class — and per the MS syntax reference this is the ONLY
    mode where additionalRowClass works at all (finding 7), which makes
    accepting it more valuable than first thought: it can't be emulated by
    synthesizing a rowFormatter without changing its SP semantics. Owner
    call on the product shape (likely: a row doc flagged "native rows",
    rendered as the grid scaffold + per-row class in the canvas only).

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

## Aspects that matched the SP screenshots (pre-fix pass)

Not full-sample passes — several samples below also appear in the findings
(star-rating lost its label pre-fix, to-do stacks per finding 17,
bar-graph's axis decorations are finding 20, event-tiles' all-day branch
is finding 6). Listed per aspect:

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

## F. Found while fixing

21. **`inlineColumnFormatter` breaks multi-segment `@currentField` props.**
    The dialect regex captured only ONE dotted segment, so
    `@currentField.lookupValue.length` registered as
    `[$SoldTo.lookupValue].length` — a syntax error (27 runtime lint
    errors; the pills sample died a second way even after finding 2's
    engine fix — caught by the new runtime-lint capture in
    capture-log.json). Affects any pasted/imported column formatter using
    multi-segment props when it becomes a column look.
    **FIXED** in lookDialect.ts (`(\.[seg])*`, pinned in
    lookDialect.test.ts; the reverse `toColumnFormatter` already handled
    multi-segment props, so round-trips hold).

## Appendix — probe commands

Every engine claim above reproduces headlessly against `dist-lib`
(`npm run build:lib` first). The probe harness:

```sh
node --input-type=module -e "
import { evaluate, evaluateForEachList } from './dist-lib/core/expressions.js';
const ctx = (row, cf='F') => ({ row, currentFieldName: cf,
  me: {title:'S', email:'me@contoso.com'}, iterators:{}, iteratorIndex:{},
  displayNames:{}, now: new Date('2026-07-17T12:00:00') });
const t = (label, expr, row) => { try {
  console.log(label, '→', JSON.stringify(evaluate(expr, ctx(row))));
} catch(e) { console.log(label, '→ ERROR:', e.message); } };
// finding 1 — was 2026 / 0; now epoch ms / ms difference
t('Number(date)', '=Number([\$F])', { F: '2026-07-10' });
t('date minus date', '=[\$A]-[\$B]', { A: '2026-07-10', B: '2026-07-01' });
// finding 2 — was '' → rgba(NaN…); now 11
t('.length', '=[\$F.lookupValue.length]', { F: { lookupId: 3, lookupValue: 'Contoso Ltd' } });
// finding 3 — was ['A;#B;#C'] / 7; now ['A','B','C'] / 3
console.log('forEach', evaluateForEachList('[\$F]', ctx({ F: 'A;#B;#C' })));
t('length()', '=length([\$F])', { F: 'A;#B;#C' });
// finding 4 — was '12/5/2001, 12:00:00 AM'; now '12.5'
t('toLocaleString', '=toLocaleString(12.5)', {});
// finding 5 — was ''; now '64'
t('.displayValue', '=[\$F.displayValue]', { F: 64 });
// finding 6 (open) — null == '' is false; missing key == '' is true
t('null==\'\'', "=if([\$F] == '', 'BLANK', 'notblank')", { F: null });
t('missing==\'\'', "=if([\$F] == '', 'BLANK', 'notblank')", {});
"
```

The date-range-rag per-row class/width probe and the rendered-DOM
min-height probe (findings 1/17) are quoted in the PR discussion; both
just evaluate the fixture's own expressions with `evaluate()` per row and
dump the grid cell's DOM via Playwright.
