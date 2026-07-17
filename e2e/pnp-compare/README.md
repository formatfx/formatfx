# pnp-compare — render-fidelity harness against pnp/List-Formatting samples

Renders real community formatters from [pnp/List-Formatting](https://github.com/pnp/List-Formatting)
in the FormatFX app and compares the result against the screenshots those
samples ship — a broad fidelity sweep of the renderer/expression engine
against what real SharePoint painted for the exact same JSON.

**This never runs in CI** (it drives a dev server + Playwright by hand and
its reference images live in a clone of the pnp repo). It complements
`e2e/visual-compare/` (ground truth against a live tenant, needs auth):
this harness needs no tenant — the pnp screenshots ARE the SharePoint side.

## Layout

- `fixtures/*.json` — one per sampled community formatter: the sample's
  formatter JSON **verbatim** (MIT-licensed, from pnp/List-Formatting)
  plus mock `fields`/`rows` hand-matched to the sample's own screenshot,
  so the comparison is apples-to-apples. `kind` is column/row/tile;
  column fixtures name the `field` the formatter is applied to.
- `build-workspaces.mjs` — fixture → v3 project payload → `w1` share URL
  (deflate-raw + base64url, byte-compatible with `core/share.ts`). Uses
  the app's own `importJson` from `dist-lib` for wrapper detection, plus
  small ports of `inlineColumnFormatter`/`buildGridRoot`. Fixtures whose
  view JSON is `additionalRowClass`-only (no `rowFormatter`) fall back to
  a plain grid-scaffold row body carrying the class in `viewExtras` —
  the closest the editor model gets to SP's native-row + class behavior.
- `capture.mjs` — loads each share URL in chromium and screenshots the
  rendered surface (grid for column fixtures, canvas stage for views;
  `hoverCard` fixtures also click the card open and shoot the flyout).
  Console errors land in `capture-log.json`.
- `gen-icon-css.mjs` — builds a local `ms-Icon` CSS (font-face + glyph
  rules) from `@fluentui/font-icons-mdl2`'s shipped woffs, so iconName
  glyphs paint in CDN-blocked containers. Runtime test scaffolding only:
  the fonts stay under the Fluent assets license and are never committed.

## Running it

```sh
npm run build:lib                     # dist-lib for importJson
npx vite --port 5199 --strictPort &   # the app under test

S=/path/to/scratch
# Pinned to the commit the 2026-07-17 sweep ran against — the fixtures'
# embedded JSON and expected screenshots are frozen to it:
PNP_SHA=eddd4025886c0ad16243ecd55141447639ab0800
git clone https://github.com/pnp/List-Formatting.git $S/pnp \
  && git -C $S/pnp checkout $PNP_SHA

# optional, for offline icon + ms-* utility fidelity (subshell so the
# node commands below still run from the repo root). Versions are PINNED:
# fabric 11.0.0 is what index.html actually loads from the CDN, and
# gen-icon-css.mjs parses font-icons-mdl2's internal generated-file format:
(cd $S && npm pack office-ui-fabric-core@11.0.0 && tar xzf office-ui-fabric-core-*.tgz \
  && npm pack @fluentui/font-icons-mdl2@8.5.74 && mkdir -p mdl2 && tar xzf fluentui-font-icons-mdl2-*.tgz -C mdl2 --strip-components=1)
node e2e/pnp-compare/gen-icon-css.mjs $S/mdl2/lib $S/out/icons.css

node e2e/pnp-compare/build-workspaces.mjs e2e/pnp-compare/fixtures $S/out
PW_EXECUTABLE=/path/to/chrome FABRIC_CSS=$S/package/dist/css/fabric.min.css \
  node e2e/pnp-compare/capture.mjs $S/out
```

Then compare `$S/out/renders/<id>.png` against the pnp repo's
`<source dir>/assets/screenshot.png` per fixture — with eyes, not a diff
tool: the surfaces differ in chrome, width and font stack, so the check is
"same branches taken, same colors/shapes/icons/text", not pixels.

Findings from the 2026-07-17 sweep: `FINDINGS.md`.

## Reading the comparisons honestly

Expected artifacts that are NOT renderer bugs:

- Profile photos (`/_layouts/15/userphoto.aspx`) and other tenant/external
  images 404 in the sandbox — broken-image placeholders are expected.
- `ms-bgColor-themePrimary` etc. resolve to the app's stock theme, not the
  tenant theme the screenshot was taken on (shade drift is fine, color
  family should hold).
- Screenshot list chrome (column widths, row heights, SP toolbar) differs
  from the app's grid chrome.
- Without the icon CSS + `FABRIC_CSS` interception, iconName glyphs and
  `ms-fontSize-*`/`ms-fontWeight-*` utilities are missing offline (HANDOFF
  §4 — the app rides the Fabric CDN for those).
