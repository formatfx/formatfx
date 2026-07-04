/**
 * The workspace IS the fixture. A FormatFX share link carries the maker's
 * whole workspace — fields, data rows, column formatters, the view formatter
 * — so the harness decodes it with the app's own codec (core/share.ts, the
 * byte-exact-tested one) and derives a SharePoint provisioning plan from it.
 * No canned fixtures: you compare YOUR design.
 */
import { parseShareHash, decodeShareFragment } from '../../src/core/share';
import { exportJson } from '../../src/core/serializer';
import type { FormatterDocument, MockField, MockRow, SPElement } from '../../src/core/types';

export interface WorkspaceFixture {
  viewName: string;
  fields: MockField[];
  rows: MockRow[];
  doc: FormatterDocument;
  /** Registered column formatters, keyed by field internal name. */
  columnRefs: Record<string, SPElement>;
}

export async function decodeShareUrl(url: string): Promise<WorkspaceFixture> {
  const frag = parseShareHash(new URL(url).hash);
  if (!frag) throw new Error('Not a FormatFX share link — no workspace fragment in the URL hash.');
  const p = JSON.parse(await decodeShareFragment(frag));
  if (!p?.doc?.root?.elmType || !Array.isArray(p.fields) || !Array.isArray(p.rows)) {
    throw new Error('Share link decoded, but the payload is not a workspace (expected doc/fields/rows).');
  }
  return {
    viewName: (typeof p.viewName === 'string' && p.viewName.trim()) || 'View 1',
    fields: p.fields, rows: p.rows, doc: p.doc,
    columnRefs: (p.columnRefs && typeof p.columnRefs === 'object') ? p.columnRefs : {},
  };
}

/* ── provisioning plan ─────────────────────────────────────────────────── */

export interface ProvisionPlan {
  /** Fields to create, as CAML for createfieldasxml, in workspace order. */
  fieldsXml: { name: string; xml: string }[];
  /** Fields the harness cannot fabricate on a bare tenant, with the reason. */
  skipped: { name: string; reason: string }[];
  /** Item payloads for POST …/items (Title included; skipped fields omitted). */
  items: Record<string, unknown>[];
  /** Column-formatter writes: field internal name → exported SP JSON. */
  columnFormatters: { name: string; json: string }[];
  /** The view formatter (grid/row/tile docs all export as view formatting). */
  viewFormatterJson: string;
}

const xmlEscape = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** CAML for a creatable field type, or null when we can't fabricate it. */
function fieldXml(f: MockField): string | null {
  const attrs = `Name="${xmlEscape(f.name)}" DisplayName="${xmlEscape(f.displayName ?? f.name)}"`;
  const choices = (f.choices ?? []).map((c) => `<CHOICE>${xmlEscape(c)}</CHOICE>`).join('');
  switch (f.type) {
    case 'text': return `<Field Type="Text" ${attrs} />`;
    case 'note': return `<Field Type="Note" ${attrs} />`;
    case 'number': return `<Field Type="Number" ${attrs} />`;
    case 'currency': return `<Field Type="Currency" ${attrs} />`;
    case 'boolean': return `<Field Type="Boolean" ${attrs} />`;
    case 'date': return `<Field Type="DateTime" ${attrs} />`;
    case 'hyperlink': return `<Field Type="URL" ${attrs} />`;
    case 'choice': return `<Field Type="Choice" ${attrs}><CHOICES>${choices}</CHOICES></Field>`;
    case 'choiceMulti': return `<Field Type="MultiChoice" ${attrs}><CHOICES>${choices}</CHOICES></Field>`;
    // person/lookup columns need principals / target lists that a bare test
    // tenant doesn't have — the harness refuses rather than half-fabricates
    default: return null;
  }
}

/** An item-payload value for a creatable field, or undefined to omit. */
function itemValue(f: MockField, v: unknown): unknown {
  if (v == null || v === '') return undefined;
  switch (f.type) {
    case 'boolean': return Boolean(v);
    case 'number': case 'currency': return typeof v === 'number' ? v : Number(v);
    // ⚠ first-live-run watch spot #3: multi-choice item writes use the
    // { results: [...] } collection shape under odata=nometadata; some
    // tenants may still demand verbose metadata here.
    case 'choiceMulti': return { results: Array.isArray(v) ? v : String(v).split(/[;,]\s*/) };
    case 'hyperlink': return undefined; // URL values need verbose SP.FieldUrlValue — v1 leaves the column empty
    default: return typeof v === 'object' ? undefined : String(v);
  }
}

export function planProvision(ws: WorkspaceFixture, maxRows = 5): ProvisionPlan {
  const fieldsXml: ProvisionPlan['fieldsXml'] = [];
  const skipped: ProvisionPlan['skipped'] = [];
  const creatable = new Map<string, MockField>();

  for (const f of ws.fields) {
    if (f.name === 'Title') { creatable.set(f.name, f); continue; } // built into every list
    const xml = fieldXml(f);
    if (xml) { fieldsXml.push({ name: f.name, xml }); creatable.set(f.name, f); }
    else skipped.push({ name: f.name, reason: `type "${f.type}" needs tenant principals/lists the harness can't fabricate` });
  }

  const items = ws.rows.slice(0, maxRows).map((row: MockRow) => {
    const item: Record<string, unknown> = {};
    for (const [name, f] of creatable) {
      const v = f.name === 'Title' ? String(row.Title ?? '') : itemValue(f, row[name]);
      if (v !== undefined) item[name] = v;
    }
    return item;
  });

  const columnFormatters = Object.entries(ws.columnRefs)
    .filter(([name]) => creatable.has(name))
    .map(([name, root]) => ({
      name,
      json: exportJson({ kind: 'column', root } as FormatterDocument, { keepMeta: false, indent: 0 }),
    }));
  for (const name of Object.keys(ws.columnRefs)) {
    if (!creatable.has(name)) skipped.push({ name, reason: 'column formatter targets a field the harness skipped' });
  }

  return {
    fieldsXml, skipped, items, columnFormatters,
    viewFormatterJson: exportJson(ws.doc, { keepMeta: false, indent: 0 }),
  };
}
