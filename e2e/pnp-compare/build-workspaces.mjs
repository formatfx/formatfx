/**
 * e2e/pnp-compare/build-workspaces.mjs — turn pnp/List-Formatting sample
 * fixtures into loadable FormatFX share URLs.
 *
 * Each fixture (fixtures/*.json) carries a community sample's formatter JSON
 * verbatim plus mock fields/rows matching the sample's own screenshot. This
 * script builds a v3 project payload per fixture — using the app's REAL
 * importJson (dist-lib) for wrapper detection — encodes it with the w1 share
 * scheme (deflate-raw + base64url, byte-identical to core/share.ts), and
 * writes <out>/workspaces.json for capture.mjs.
 *
 * Usage: node e2e/pnp-compare/build-workspaces.mjs <fixturesDir> <outDir> [baseUrl]
 * Requires: npm run build:lib (for dist-lib), node >= 20.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { importJson } from '../../dist-lib/core/serializer.js';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = process.argv[2] ?? path.join(DIR, 'fixtures');
const outDir = process.argv[3] ?? path.join(DIR, 'out');
const baseUrl = process.argv[4] ?? 'http://localhost:5199/';

/* ── ports of the two tiny editor brains the lib build doesn't ship ──────── */

/** editor/lookDialect.ts inlineColumnFormatter: @currentField → [$Field]. */
function mapExpr(value, fn) {
  if (typeof value === 'string') return fn(value);
  if (Array.isArray(value)) return value.map((v) => mapExpr(v, fn));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = mapExpr(v, fn);
    return out;
  }
  return value;
}
function transformRefs(tree, fn) {
  const clone = JSON.parse(JSON.stringify(tree));
  const visit = (node) => {
    if (node.txtContent !== undefined) node.txtContent = mapExpr(node.txtContent, fn);
    if (node.style) node.style = mapExpr(node.style, fn);
    if (node.attributes) node.attributes = mapExpr(node.attributes, fn);
    if (node.forEach !== undefined) node.forEach = mapExpr(node.forEach, fn);
    if (node.customRowAction?.actionInput !== undefined) {
      node.customRowAction.actionInput = mapExpr(node.customRowAction.actionInput, fn);
    }
    node.children?.forEach(visit);
    if (node.customCardProps?.formatter) visit(node.customCardProps.formatter);
  };
  visit(clone);
  return clone;
}
function inlineColumnFormatter(tree, field) {
  return transformRefs(tree, (s) =>
    s.replace(/@currentField(\.[A-Za-z0-9_]+)?/g, (_m, prop) => `[$${field}${prop ?? ''}]`));
}

/** editor/gridScaffold.ts buildGridRoot/gridCellForField, minus look layering
 *  we don't need beyond flex/min-width. */
function plainCellContent(field) {
  const n = field.name;
  const ref = (prop) => (prop ? `[$${n}.${prop}]` : `[$${n}]`);
  switch (field.type) {
    case 'date': return { txtContent: `=toLocaleDateString(${ref()})` };
    case 'boolean': return { txtContent: `=if(${ref()},'Yes','No')` };
    case 'person': return { txtContent: ref('title') };
    case 'personMulti': return { txtContent: `=join(${ref('title')},', ')` };
    case 'lookup': return { txtContent: ref('lookupValue') };
    case 'lookupMulti': return { txtContent: `=join(${ref('lookupValue')},', ')` };
    case 'hyperlink': return { txtContent: ref(), attributes: { href: ref() } };
    default: return { txtContent: ref() };
  }
}
function gridCellForField(field, columnLooks) {
  const look = Object.hasOwn(columnLooks, field.name) ? columnLooks[field.name] : undefined;
  if (look) {
    const cell = JSON.parse(JSON.stringify(look));
    cell._field = field.name;
    cell.style = { ...cell.style, 'flex': '1', 'min-width': '0' };
    cell._elmName = cell._elmName ?? (field.displayName ?? field.name);
    return cell;
  }
  return {
    elmType: field.type === 'hyperlink' ? 'a' : 'div',
    _elmName: field.displayName ?? field.name,
    _field: field.name,
    style: { 'flex': '1', 'min-width': '0' },
    ...plainCellContent(field),
  };
}
function buildGridRoot(fields, columnLooks) {
  return {
    elmType: 'div',
    _elmName: 'Row layout',
    style: { 'display': 'flex', 'align-items': 'center', 'width': '100%', 'gap': '12px' },
    children: fields.filter((f) => !f.protected).map((f) => gridCellForField(f, columnLooks)),
  };
}

/* ── w1 share fragment (byte-identical to core/share.ts encodeShareFragment) ── */

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
function toBase64Url(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i], b1 = bytes[i + 1], b2 = bytes[i + 2];
    out += B64[b0 >> 2];
    out += B64[((b0 & 0b11) << 4) | ((b1 ?? 0) >> 4)];
    if (b1 === undefined) break;
    out += B64[((b1 & 0b1111) << 2) | ((b2 ?? 0) >> 6)];
    if (b2 === undefined) break;
    out += B64[b2 & 0b111111];
  }
  return out;
}
function shareUrl(projectJson) {
  const packed = zlib.deflateRawSync(Buffer.from(projectJson, 'utf8'));
  return `${baseUrl.split('#')[0]}#w1=${toBase64Url(packed)}`;
}

/* ── fixture → project ──────────────────────────────────────────────────── */

function projectFor(fx) {
  const fields = fx.fields;
  let floor, views = [], activeViewId = null, columnLooks = {};

  if (fx.kind === 'column') {
    const doc = importJson(JSON.stringify(fx.formatter));
    if (doc.kind !== 'column') throw new Error(`${fx.id}: expected a column formatter, importJson said ${doc.kind}`);
    const look = inlineColumnFormatter(doc.root, fx.field);
    look._elmName = `${fx.id} (pnp)`;
    columnLooks = { [fx.field]: look };
    floor = buildGridRoot(fields, columnLooks);
  } else {
    let doc;
    try {
      // The modern tile syntax nests everything under `tileProps` — importJson
      // doesn't recognize that wrapper today (FINDINGS.md); unwrap it here so
      // the render itself still gets compared.
      const raw = fx.formatter.tileProps
        ? { $schema: fx.formatter.$schema, hideSelection: fx.formatter.hideSelection, ...fx.formatter.tileProps }
        : fx.formatter;
      doc = importJson(JSON.stringify(raw));
    } catch (e) {
      // additionalRowClass-only view formatting (no rowFormatter): real SP
      // keeps native row rendering and adds the class; emulate with the grid
      // scaffold as the row body + the wrapper keys as viewExtras.
      const { $schema, ...extras } = fx.formatter;
      if (!('additionalRowClass' in extras)) throw e;
      doc = { kind: 'row', root: buildGridRoot(fields, {}), viewExtras: extras };
    }
    views = [{ id: 'v1', name: fx.id, doc }];
    activeViewId = 'v1';
    floor = buildGridRoot(fields, {});
  }

  return JSON.stringify({
    version: 3,
    floor: { kind: 'grid', root: floor },
    views,
    activeViewId,
    fields,
    rows: fx.rows,
    currentFieldName: fx.field ?? fields.find((f) => !f.protected)?.name ?? 'Title',
    columnLooks,
    themeMode: 'light',
    customTheme: null,
  });
}

/* ── main ───────────────────────────────────────────────────────────────── */

const fixtures = fs.readdirSync(fixturesDir).filter((f) => f.endsWith('.json')).sort();
fs.mkdirSync(outDir, { recursive: true });
const out = [];
for (const file of fixtures) {
  const fx = JSON.parse(fs.readFileSync(path.join(fixturesDir, file), 'utf8'));
  try {
    const url = shareUrl(projectFor(fx));
    out.push({
      id: fx.id, kind: fx.kind, field: fx.field ?? null, url,
      screenshot: fx.screenshot ?? null, hoverCard: Boolean(fx.hoverCard), notes: fx.notes ?? '',
    });
    console.log(`✓ ${fx.id} (${url.length} chars)`);
  } catch (e) {
    out.push({ id: fx.id, kind: fx.kind, error: String(e.message ?? e) });
    console.error(`✗ ${fx.id}: ${e.message}`);
  }
}
fs.writeFileSync(path.join(outDir, 'workspaces.json'), JSON.stringify(out, null, 2));
console.log(`\n${out.filter((o) => o.url).length}/${out.length} workspaces → ${path.join(outDir, 'workspaces.json')}`);
