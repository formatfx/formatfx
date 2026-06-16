// Regenerates src/editor/iconData.ts — the SP-renderable Fluent icon catalog
// and the NO_PREVIEW_ICONS set (names the bundled Fabric font can't draw).
//
// Reproducible, not a one-off: the two inputs are (1) an icon export CSV with a
// "Renders In SP" column + a "Subcategory" grouping, and (2) the office-ui-
// fabric-core CSS whose `.ms-Icon--Name::before` rules define what previews.
// The Fabric version is read straight from index.html's CDN <link>, so the
// no-preview set always reflects the font the app actually loads — bump that
// URL, re-run this, and the data follows. Dependency-free (zero-dep repo).
//
//   npm i -D office-ui-fabric-core@<version-in-index.html>   # provides the CSS
//   node tools/gen-icons.mjs <icons.csv> [path/to/fabric.min.css]
//
import { readFileSync, writeFileSync } from 'node:fs';

const csvPath = process.argv[2];
if (!csvPath) {
  console.error('usage: node tools/gen-icons.mjs <icons.csv> [fabric.min.css]');
  process.exit(1);
}

// Fabric version comes from the same place the app loads it: index.html.
const indexHtml = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const verMatch = indexHtml.match(/office-ui-fabric-core\/([0-9.]+)\//);
const fabricVersion = verMatch ? verMatch[1] : 'unknown';

const fabricCssPath = process.argv[3]
  ?? new URL(`../node_modules/office-ui-fabric-core/dist/css/fabric.min.css`, import.meta.url);
let fabricCss;
try {
  fabricCss = readFileSync(fabricCssPath, 'utf8');
} catch {
  console.error(`Could not read Fabric CSS at ${fabricCssPath}.\n` +
    `Install the version index.html loads, e.g.  npm i -D office-ui-fabric-core@${fabricVersion}\n` +
    `or pass the CSS path as the second argument.`);
  process.exit(1);
}
const previewable = new Set();
for (const m of fabricCss.matchAll(/ms-Icon--([A-Za-z0-9]+)::?before/g)) previewable.add(m[1]);

// minimal CSV reader (quoted fields, embedded commas/newlines)
function parseCSV(text) {
  const rows = []; let cur = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; } else field += c; }
    else if (c === '"') q = true;
    else if (c === ',') { cur.push(field); field = ''; }
    else if (c === '\n') { cur.push(field); rows.push(cur); cur = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field.length || cur.length) { cur.push(field); rows.push(cur); }
  return rows;
}

const rows = parseCSV(readFileSync(csvPath, 'utf8').replace(/^﻿/, '')).filter((r) => r.length > 1);
const idx = {}; rows[0].forEach((h, i) => idx[h] = i);
const renders = rows.slice(1).filter((r) => r[idx['Renders In SP']] === 'True');

const groups = new Map();
const noPreview = new Set();
for (const r of renders) {
  const name = r[idx['IconName']].trim();
  if (!/^[A-Za-z0-9]+$/.test(name)) continue; // only clean Fabric tokens
  const group = (r[idx['Subcategory']] || 'Other').trim();
  if (!groups.has(group)) groups.set(group, new Set());
  groups.get(group).add(name);
  if (!previewable.has(name)) noPreview.add(name);
}

const groupNames = [...groups.keys()].sort();
let total = 0;
const wrap = (names, indent) => {
  let out = '';
  for (let i = 0; i < names.length; i += 6) out += `${indent}${names.slice(i, i + 6).map((n) => `'${n}'`).join(', ')},\n`;
  return out;
};

let out = `/**
 * editor/iconData.ts — the Fluent UI (MDL2) icon set that SharePoint's
 * \`iconName\` attribute actually renders, grouped by theme for the picker.
 *
 * GENERATED DATA — do not hand-edit. Regenerate with tools/gen-icons.mjs.
 * Source of truth: the icon export's "Renders In SP" column (every name here
 * is verified to render on a real list). Preview coverage is computed against
 * office-ui-fabric-core@${fabricVersion} (the version index.html loads); names it
 * can't draw are listed in NO_PREVIEW_ICONS and shown with a placeholder.
 * Names map 1:1 to the Fabric font class \`ms-Icon--<Name>\`.
 */

export interface IconGroup { name: string; icons: string[]; }

export const ICON_GROUPS: IconGroup[] = [
`;
for (const g of groupNames) {
  const names = [...groups.get(g)].sort();
  total += names.length;
  out += `  { name: ${JSON.stringify(g)}, icons: [\n${wrap(names, '    ')}  ] },\n`;
}
out += `];

/** Every renderable icon name, flattened (deduped, sorted). */
export const ALL_ICONS: string[] = [...new Set(ICON_GROUPS.flatMap((g) => g.icons))].sort();

/** SP-valid names the bundled Fabric font can't preview (shown with a placeholder). */
export const NO_PREVIEW_ICONS: ReadonlySet<string> = new Set([
${wrap([...noPreview].sort(), '  ')}]);
`;

const dest = new URL('../src/editor/iconData.ts', import.meta.url);
writeFileSync(dest, out);
console.log(`wrote ${total} icons across ${groupNames.length} groups; ` +
  `${noPreview.size} without a preview (fabric-core@${fabricVersion}).`);
