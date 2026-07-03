// tools/gen-chrome-icons.mjs — generate src/chromeIcons.css, self-hosted inline
// SVGs for formatfx's OWN chrome icons (tree, menus, palette, toolbar, theme
// toggle, the element-reference badge). This is what lets the app's chrome
// render with NO network: every `<i class="ms-Icon--X">` for a chrome glyph gets
// its ::before painted from a bundled SVG mask instead of the CDN Fluent font.
//
// Why a CSS mask and not <svg> nodes? The chrome icons live in dozens of static
// innerHTML strings (the whole app shell). A mask rule keyed on the existing
// `ms-Icon--Name` class covers every call site — static and dynamic — with zero
// markup changes, and `background-color: currentColor` keeps every icon
// recolouring exactly as the font did (tree dim, badge accent, selected rows…).
//
// The CDN Fluent font is still needed for ARBITRARY SharePoint iconName previews
// (the icon picker, the fx bar, and the canvas renderer). Those names simply
// have no rule here, so they fall through to the font as before — nothing
// regresses; the chrome just stops needing the network.
//
// Source: @fluentui/svg-icons (Fluent System Icons) — MIT-licensed, so the
// extracted outlines are safe to redistribute in this MIT repo. Install it as a
// throwaway before regenerating (it is NOT a project dependency):
//
//   npm i --no-save @fluentui/svg-icons
//   node tools/gen-chrome-icons.mjs

import fs from 'node:fs';
import path from 'node:path';

const ICONS_DIR = 'node_modules/@fluentui/svg-icons/icons';
const OUT = 'src/chromeIcons.css';

// MDL2 (Fabric) name -> ordered Fluent System base-name candidates. The first
// that resolves to a real SVG (across the size/style order below) wins. Chosen
// for visual equivalence to the MDL2 glyph the SharePoint-facing UI already
// names.
const MAP = {
  // element type icons (structure tree + reference badge)
  CubeShape: ['cube'], PlainText: ['text_description', 'text_t'], Link: ['link'],
  Photo2: ['image'], ButtonControl: ['control_button'], AlignLeft: ['text_align_left'],
  Puzzle: ['puzzle_piece', 'puzzle_cube'], PreviewLink: ['eye'],
  // tree row actions
  Rename: ['rename'], GroupObject: ['group'], Up: ['chevron_up'], Down: ['chevron_down'],
  Copy: ['copy'], Delete: ['delete'], Paste: ['clipboard_paste'],
  // toolbar / global chrome
  Undo: ['arrow_undo'], Redo: ['arrow_redo'], Save: ['save'], Share: ['share'],
  Code: ['code'], Info: ['info'], Cancel: ['dismiss'], More: ['more_horizontal'],
  Hide: ['eye_off'], Edit: ['edit'], OpenFolderHorizontal: ['folder_open'],
  EraseTool: ['eraser'], Brush: ['paint_brush'], Color: ['color'],
  Lightbulb: ['lightbulb'], Lightning: ['flash'], LightningBolt: ['flash'],
  // theme toggle
  ClearNight: ['weather_moon'], Sunny: ['weather_sunny'],
  // conditional formatting / format cells
  Font: ['text_font'], FitWidth: ['arrow_autofit_width'],
  ShieldAlert: ['shield_error', 'shield'],
  // data panel field-type icons
  Calendar: ['calendar_ltr', 'calendar'], People: ['people'],
  PeopleAdd: ['people_add', 'person_add'], Contact: ['person', 'contact_card'],
  ContactCard: ['contact_card', 'person_board'], Mail: ['mail'], Tag: ['tag'],
  Table: ['table'], Timer: ['timer'], CheckboxComposite: ['checkbox_checked'],
  Relationship: ['link_multiple', 'arrow_swap'], Emoji2: ['emoji'],
  FavoriteStarFill: ['star'], CircleFill: ['circle'], StatusCircleInner: ['circle', 'record'],
  Name: ['text_field', 'tag'], TouchPointer: ['cursor_click', 'cursor'],
  // components (⬡) — "package this as a reusable component"
  Package: ['box_multiple', 'box', 'cube_multiple'],
  // template / layout / chart icons
  GridViewMedium: ['grid'], GroupedList: ['group_list', 'apps_list', 'list'],
  BarChartHorizontal: ['data_bar_horizontal', 'data_histogram'], DonutChart: ['data_pie'],
  Flow: ['flowchart'], BranchFork2: ['branch_fork', 'branch'],
  DistributeDown: ['align_space_evenly_vertical'], DistributeRight: ['align_space_evenly_horizontal'],
  Separator: ['line'],
};

// MDL2 glyphs that are solid/filled — prefer the filled Fluent variant.
const FILLED = new Set(['CircleFill', 'FavoriteStarFill', 'StatusCircleInner', 'CheckboxComposite']);

const REGULAR_ORDER = ['24_regular', '20_regular', '24_filled', '20_filled', '16_regular', '16_filled'];
const FILLED_ORDER = ['24_filled', '20_filled', '24_regular', '20_regular', '16_filled', '16_regular'];

function resolveFile(base, preferFilled) {
  for (const v of preferFilled ? FILLED_ORDER : REGULAR_ORDER) {
    const f = path.join(ICONS_DIR, `${base}_${v}.svg`);
    if (fs.existsSync(f)) return f;
  }
  return null;
}

/** Pull the inner <path> markup out of a Fluent SVG, preserving fill-rule. */
function innerPaths(svg) {
  const out = [];
  const re = /<path\b([^>]*?)\/?>/g;
  let m;
  while ((m = re.exec(svg))) {
    const d = /\sd="([^"]+)"/.exec(m[1])?.[1];
    if (!d) continue;
    const rule = /fill-rule="([^"]+)"/.exec(m[1])?.[1];
    out.push(`<path d='${d}'${rule ? ` fill-rule='${rule}'` : ''}/>`);
  }
  return out.join('');
}

/** Minimal, robust percent-encoding for an SVG data URI inside url("…"). */
const enc = (s) => s
  .replace(/%/g, '%25').replace(/</g, '%3C').replace(/>/g, '%3E')
  .replace(/#/g, '%23').replace(/"/g, "'").replace(/\s+/g, ' ').replace(/ /g, '%20');

const maskUrls = {};
const missing = [];
const provenance = {};
for (const [name, cands] of Object.entries(MAP)) {
  let file = null;
  for (const c of cands) { file = resolveFile(c, FILLED.has(name)); if (file) break; }
  if (!file) { missing.push(name); continue; }
  const svg = fs.readFileSync(file, 'utf8');
  const vb = /viewBox="([^"]+)"/.exec(svg)?.[1] ?? '0 0 24 24';
  const paths = innerPaths(svg);
  if (!paths) { missing.push(name); continue; }
  const data = enc(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='${vb}'>${paths}</svg>`);
  maskUrls[name] = `url("data:image/svg+xml,${data}")`;
  provenance[name] = path.basename(file);
}

const names = Object.keys(maskUrls).sort();
const sharedSelector = names.map((n) => `.ms-Icon.ms-Icon--${n}::before`).join(',\n');
const perIcon = names.map((n) =>
  `.ms-Icon.ms-Icon--${n}::before { -webkit-mask-image: ${maskUrls[n]}; mask-image: ${maskUrls[n]}; } /* ${provenance[n]} */`,
).join('\n');

const css = `/* chromeIcons.css — GENERATED, do not hand-edit. Regenerate with
   tools/gen-chrome-icons.mjs (see that file's header).

   Self-hosted inline-SVG masks for formatfx's own chrome icons (${names.length} glyphs),
   keyed on the MDL2/Fabric ms-Icon--<Name> class. Extracted from
   @fluentui/svg-icons (Fluent System Icons, MIT). The doubled .ms-Icon class
   raises specificity so these win over the CDN font's ::before regardless of
   stylesheet order; background-color:currentColor keeps every icon recolouring
   like the font did. Arbitrary SharePoint icons have no rule here and fall
   through to the CDN font. */

${sharedSelector} {
  content: "";
  display: inline-block;
  width: 1em;
  height: 1em;
  background-color: currentColor;
  vertical-align: -0.125em;
  -webkit-mask-repeat: no-repeat; mask-repeat: no-repeat;
  -webkit-mask-position: center; mask-position: center;
  -webkit-mask-size: contain; mask-size: contain;
}

${perIcon}
`;

fs.writeFileSync(OUT, css);
console.log(`wrote ${OUT} with ${names.length} icons`);
if (missing.length) console.log(`UNRESOLVED (stay on CDN font): ${missing.join(', ')}`);
