# FormatFX Lite — the cards-only test page

> Status: **test version (spike)**, 2026-11-03. `lite.html` + `src/lite/`.
> It reuses the engine (`src/core`) and changes nothing in the main app.

## Why

Copilot in SharePoint can now make views: show or hide columns, sort,
filter and group. Microsoft's own docs say it does not yet do column order,
column width or conditional formatting, and the List Agent only creates new
lists.

Copilot will probably write formatter JSON soon. But words are a weak tool
for placement and small adjustments ("move the date to the top right and
make it a bit smaller"). A mouse does that in two seconds. Lite tests that
thesis: **Copilot makes the card. Lite makes it look right.**

## What it does

1. Start from a card (Task, Header, Blank) or paste gallery-card JSON.
2. Click a part. Drag it, resize it (8 handles), or nudge it with the arrow
   keys (1 px, or 10 px with Shift). Parts snap to the card edges, the card
   centre, the 16 px insets and the other parts. Hold Alt to stop snapping.
3. Change text size, bold, text color, fill, alignment, wrap and corners, or
   change which column a text part shows. Type a part's width and height
   (W, H) for exact sizes; that is also the keyboard way to resize.
4. See the card on every sample item at once ("Every item"): a very long
   title, an empty date, an empty project, 0 % and 100 %.
5. Copy JSON. The linter runs first. An error blocks the copy and gives a
   one-line reason.

There is no formula bar, JSON editor or tree. The main app keeps those.

## The free-layout convention

A Lite card is a normal gallery (tile) formatter with one convention:

- The root is `position: relative` at the exact tile size (its `width` and
  `height` match the wrapper's), with `overflow: hidden`.
- Each **part** is a direct child with `position: absolute` and literal px
  `left` / `top` / `width` / `height`.
- The first child is SharePoint's `sp-card-defaultClickButton` overlay
  (click the card to open the item), the verified pattern from
  `src/editor/presets.ts`. Lite pins it. It is not a part.

All of it is schema-valid, allow-listed JSON. SharePoint needs nothing
special to render it.

## Opening other cards (flatten)

`src/lite/flatten.ts` converts flow-layout cards (Copilot output, the
SharePoint card designer, community samples) to free layout. It renders the
card on each sample item (off screen, with the same renderer) and measures
where each element landed.

- **Units** become one part and keep their inner tree: content (text,
  picture, icon, button, link, column-formatter reference), loops
  (`forEach`), behaviors (row action, hover card, inline edit), anything a
  rule shows or hides, a container whose children a rule sizes (a progress
  fill), and a container with `opacity`.
- Containers that only arrange children dissolve. A painted container
  (fill, border, shadow) leaves a shape at its own position. Text styles it
  gave its children move down onto them, but never over a style the child
  sets itself (by class or inline; the browser measure reports these).
- Only flex-ITEM layout is stripped from a part; its own flex-container
  settings (`flex-direction` and the rest) stay.
- The root becomes the tile exactly (`margin: 0`). It stays whole, as one
  part, when it is content itself or when taking it apart would break a
  loop, a rule-computed size, or a rule that shows or hides the card.
- Box: left and top come from the first item that shows the element; width
  and height grow to cover the widest and tallest item.
- Nothing with content is dropped. A unit that never showed on a sample
  item goes over its container, and the notes name it.
- A list-row layout (`rowFormatter`) is refused with a reason. A bare column
  formatter opens as a one-part card.

## Small smarts that keep a tweak from breaking the look

- The lint judges text contrast against the part **under** it
  (`lintView`), not only the tree parent: white text on a blue header shape
  passes; move it off the shape and the warning comes back.
- Resizing a wrapping text part snaps its height to whole lines and updates
  its line clamp, so a box never shows a cut-off line.
- A one-line part whose line height equals its height (pills) stays
  vertically centred when resized.
- Changing text size scales the line height. Wrapping text keeps its line
  count, and the box follows.
- A run of arrow-key nudges is one undo step. A drag is one undo step.

## Files

| File | What it holds |
|---|---|
| `lite.html` | the page (a second Vite entry) |
| `src/lite/model.ts` | pure card model: parts, edits, starters, field binding, export + lint |
| `src/lite/snap.ts` | pure drag / resize / snap math (`chooseSnap` is the "feel") |
| `src/lite/flatten.ts` | pure flow → free conversion (the measure is injected) |
| `src/lite/measure.ts` | the DOM measure for flatten |
| `src/lite/sample.ts` | the sample list (same column names as the main app) |
| `src/lite/main.ts` | the UI |
| `src/lite/lite.css` | chrome only (`lt-` prefix; no reset on rendered content) |

Tests: `src/lite/*.test.ts` (unit) and `e2e/lite.spec.ts` (browser).

## Run and build

- `npm run dev`, then open `/lite.html`.
- `npm run build` builds both pages. Firebase's `cleanUrls` serves
  `dist/lite.html` at `/lite`.
- `npm run build:lite` makes one self-contained file,
  `dist-lite-single/lite.html`, to hand around.
- Lite autosaves to the localStorage key `formatfx-lite:v1`, apart from
  the main app's keys.

## Not yet (open questions)

- Real data: import a list (the main app's schema import or the extension)
  so "Every item" shows real rows.
- A hand-off to the main app ("Open in full editor" through a share link).
- Per-value colors for a rule. Today a rule shows as "set by a rule", and
  a picked color replaces it.
- Right and bottom anchoring for `fillHorizontally` cards.
- Multi-select, align / distribute, and grouping.
- Check the free-layout output on a real tenant with `npm run visual:compare`.
