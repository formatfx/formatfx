/**
 * targetIo.ts — the list as the panel sees it (fields + views with their
 * formatters, spec §2.4) and the two target operations the apply flow needs
 * (§7.1 read, §7.5 write). Field/view mapping mirrors src/bridge/spClient's
 * captureSnapshot so the tree and the editor's lint see the same shape the
 * extension captures. Views additionally carry their page url (§2.4: picking
 * a view navigates the page).
 */
import type { SpRest } from './rest';
import type { TargetRef } from './journal';
import type { SnapshotField, SnapshotView } from '../../../src/bridge/spClient';
import { decodeXmlEntities } from '../../../src/core/schemaImport';

export interface ShapeView extends SnapshotView { id: string; url: string }
export interface ListShape { fields: SnapshotField[]; views: ShapeView[] }

export function normalizeGuid(g: string): string { return g.replace(/[{}]/g, '').toLowerCase(); }

/**
 * A formatter as SharePoint hands it back. SharePoint keeps CustomFormatter
 * inside the target's schema XML: formatters authored in its own pane come
 * back with HTML entities (`&gt;`, `&quot;`…) that the native editor decodes
 * for display and the renderer decodes at run time (owner smoke 2026-09-17:
 * every comparison showed as &gt; and tripped the entity lint), and
 * formatters this panel wrote come back with the JSON escapes xmlSafeText
 * sent. Both are undone here so the panel edits what the person sees and
 * the verify-after-write compares equal.
 */
function formatterText(v: unknown): string | undefined {
  return typeof v === 'string' && v !== '' ? unescapeJsonUnicode(decodeXmlEntities(v)) : undefined;
}

/**
 * The formatter as the panel writes it. A raw `&` (`&&` in any expression)
 * or `<` in the MERGE body fails with System.Xml.XmlException "An error
 * occurred while parsing EntityName" (owner smoke 2026-09-17, v1.0.2.0) —
 * the value lands in schema XML unescaped. `\u0026` / `\u003c` are the same
 * JSON value with no XML-significant character (the serializer's csomSafe
 * rule), so SharePoint's own JSON parse sees `&` / `<` again.
 */
function xmlSafeText(formatter: string): string {
  return formatter.replace(/&/g, '\\u0026').replace(/</g, '\\u003c');
}

/** Undo xmlSafeText (and `\u003e`): a `\uXXXX` preceded by an even number of
 *  backslashes is an escape; an odd count means a literal backslash + "uXXXX". */
function unescapeJsonUnicode(s: string): string {
  const CHARS: Record<string, string> = { '0026': '&', '003c': '<', '003e': '>' };
  return s.replace(/(\\*)\\u(0026|003c|003e)/gi, (m, bs: string, code: string) =>
    (bs.length % 2 === 0 ? bs + CHARS[code.toLowerCase()] : m));
}
const q = (s: string): string => s.replace(/'/g, "''");

export function listPath(listId: string): string { return `/_api/web/lists(guid'${normalizeGuid(listId)}')`; }

export function targetPath(listId: string, t: TargetRef): string {
  return listPath(listId) + (t.kind === 'Field'
    ? `/fields/getbyinternalnameortitle('${q(t.id)}')`
    : `/views(guid'${normalizeGuid(t.id)}')`);
}

const FIELDS_Q = '/fields?$filter=Hidden eq false&$select=InternalName,Title,TypeAsString,Choices,CustomFormatter,LookupList,LookupField,ReadOnlyField,Hidden';
const VIEWS_Q = '/views?$expand=ViewFields&$select=Title,Id,DefaultView,CustomFormatter,ServerRelativeUrl,ViewFields/Items';

export async function loadListShape(rest: SpRest, listId: string): Promise<ListShape> {
  const base = listPath(listId);
  const fieldsRes = await rest.getJson(base + FIELDS_Q);
  const fields: SnapshotField[] = ((fieldsRes.value as Record<string, unknown>[]) || []).map((f) => ({
    internalName: f.InternalName as string,
    displayName: f.Title as string,
    type: f.TypeAsString as string,
    choices: Array.isArray(f.Choices) && f.Choices.length ? (f.Choices as string[]) : undefined,
    lookupList: f.LookupList ? String(f.LookupList).replace(/[{}]/g, '') : undefined,
    lookupColumn: (f.LookupField as string) || undefined,
    readOnly: !!f.ReadOnlyField,
    hidden: !!f.Hidden,
    customFormatter: formatterText(f.CustomFormatter),
  }));
  const viewsRes = await rest.getJson(base + VIEWS_Q);
  const views: ShapeView[] = ((viewsRes.value as Record<string, unknown>[]) || []).map((v) => ({
    title: v.Title as string,
    id: normalizeGuid(String(v.Id)),
    isDefault: !!v.DefaultView,
    viewFields: ((v.ViewFields as Record<string, unknown>)?.Items as string[]) || [],
    customFormatter: formatterText(v.CustomFormatter),
    url: String(v.ServerRelativeUrl ?? ''),
  }));
  return { fields, views };
}

export async function readFormatter(rest: SpRest, listId: string, t: TargetRef): Promise<string | null> {
  const res = await rest.getJson(targetPath(listId, t) + '?$select=CustomFormatter');
  return formatterText(res.CustomFormatter) ?? null;
}

export async function writeFormatter(rest: SpRest, listId: string, t: TargetRef, formatter: string | null): Promise<void> {
  await rest.merge(targetPath(listId, t), { CustomFormatter: formatter === null ? '' : xmlSafeText(formatter) });
}
