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

export interface ShapeView extends SnapshotView { id: string; url: string }
export interface ListShape { fields: SnapshotField[]; views: ShapeView[] }

export function normalizeGuid(g: string): string { return g.replace(/[{}]/g, '').toLowerCase(); }
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
    customFormatter: (f.CustomFormatter as string) || undefined,
  }));
  const viewsRes = await rest.getJson(base + VIEWS_Q);
  const views: ShapeView[] = ((viewsRes.value as Record<string, unknown>[]) || []).map((v) => ({
    title: v.Title as string,
    id: normalizeGuid(String(v.Id)),
    isDefault: !!v.DefaultView,
    viewFields: ((v.ViewFields as Record<string, unknown>)?.Items as string[]) || [],
    customFormatter: (v.CustomFormatter as string) || undefined,
    url: String(v.ServerRelativeUrl ?? ''),
  }));
  return { fields, views };
}

export async function readFormatter(rest: SpRest, listId: string, t: TargetRef): Promise<string | null> {
  const res = await rest.getJson(targetPath(listId, t) + '?$select=CustomFormatter');
  const f = res.CustomFormatter;
  return typeof f === 'string' && f !== '' ? f : null;
}

export async function writeFormatter(rest: SpRest, listId: string, t: TargetRef, formatter: string | null): Promise<void> {
  await rest.merge(targetPath(listId, t), { CustomFormatter: formatter ?? '' });
}
