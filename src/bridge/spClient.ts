// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sam Yost. FormatFX is dual-licensed: AGPL-3.0-only (see LICENSE) or a commercial license (see LICENSING.md).

/**
 * bridge/spClient.ts — the runtime the companion extension injects into a
 * SharePoint list page (MAIN world). It does, as real functions, exactly
 * what the pasted Tier-0 snippets bake as strings: a GET-only capture into
 * a List Snapshot, and a confirm-echo-then-MERGE apply of one or more
 * formatters. The snippets stay standalone for devtools auditability (house
 * rule); this is the importable sibling the extension bundles.
 *
 * Same auth model as the snippets and no other: the page's own cookies
 * (`credentials: 'same-origin'`) plus a form digest from
 * `POST /_api/contextinfo`. Dependency-free; node-tested with the same
 * stubbed fetch/_spPageContextInfo/clipboard harness as bridge.test.ts.
 */

import { LIST_SNAPSHOT_VERSION } from '../core/schemaImport';
import type { ApplyPayload } from './applyPayload';

/** SPO rejects queries expanding more lookup/person columns than this. */
export const EXPAND_CAP = 12;

/** A GUID-shaped LookupList marks a *real* relational column. System
 *  pseudo-lookups (ItemChildCount, _Compliance*, AppAuthor → 'AppPrincipals')
 *  carry none or a non-GUID name and are NOT $expand-able on /items. */
const GUID_RE = /^\{?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\}?$/i;

/** Field types that appear in /fields but cannot be $select'd on /items.
 *  OData is all-or-nothing: one of these in the query 400s the whole request. */
const UNQUERYABLE_TYPES = new Set(['Computed', 'Attachments']);

interface FieldQuery {
  /** $select fragments to add for this field. */
  select: string[];
  /** internal name to $expand, when the field is a real person/lookup column. */
  expand?: string;
}

/**
 * How (if at all) to ask /items for one field's data:
 *  - genuine person/lookup columns expand (and select their projected props);
 *  - plain scalar columns select by name;
 *  - un-queryable system columns (Computed, Attachments, pseudo-lookups)
 *    return null and are skipped — the import gap-fills them with samples.
 * Pure; the inverse of the field-types /items rejects.
 */
export function fieldQuery(f: SnapshotField): FieldQuery | null {
  const t = f.type || '';
  if (t === 'User' || t === 'UserMulti') {
    return { select: [f.internalName + '/Title', f.internalName + '/EMail', f.internalName + '/Id'], expand: f.internalName };
  }
  if (t === 'Lookup' || t === 'LookupMulti') {
    if (!f.lookupList || !GUID_RE.test(f.lookupList)) return null; // pseudo-lookup → not expandable
    return { select: [f.internalName + '/Id', f.internalName + '/' + (f.lookupColumn || 'Title')], expand: f.internalName };
  }
  if (UNQUERYABLE_TYPES.has(t)) return null;
  return { select: [f.internalName] };
}

export interface SpPageContext {
  webAbsoluteUrl: string;
  pageListId?: string;
  listTitle?: string;
}

export interface SnapshotField {
  internalName: string;
  displayName: string;
  type: string;
  choices?: string[];
  lookupList?: string;
  lookupColumn?: string;
  readOnly: boolean;
  hidden: boolean;
  customFormatter?: string;
}

export interface SnapshotView {
  title: string;
  id?: string;
  isDefault: boolean;
  viewFields: string[];
  customFormatter?: string;
}

export interface ListSnapshot {
  formatfx: 'list-snapshot';
  version: number;
  capturedAt: string;
  siteUrl: string;
  list?: string;
  listId?: string;
  fields: SnapshotField[];
  views: SnapshotView[];
  rows: Record<string, unknown>[];
  /** The view the page is showing (from ?viewid=, else the default view). */
  currentViewId?: string;
  /**
   * Why `rows` is empty, when the items GET failed (vs. a genuinely empty
   * list). Set only on a real fetch error so a failed capture can be flagged
   * instead of silently showing synthetic sample data. Absent on success and
   * when data was opted out.
   */
  rowsError?: string;
}

/** Read SharePoint's page context, or null when not on an SP page. */
export function readPageContext(): SpPageContext | null {
  const ctx = (globalThis as Record<string, unknown>)['_spPageContextInfo'] as SpPageContext | undefined;
  if (!ctx || !ctx.webAbsoluteUrl) return null;
  return ctx;
}

/** `'` doubles inside SP REST string literals; the rest percent-encodes. */
function restTitleSegment(title: string): string {
  return encodeURIComponent(title.replace(/'/g, "''"));
}

const normalizeGuid = (g: string): string => g.replace(/[{}]/g, '').toLowerCase();

/**
 * Which view is the page showing? Best-effort: the `viewid` in the URL (how
 * SharePoint marks a non-default view), matched against the captured views;
 * otherwise the default view. Node-safe (no URL → default).
 */
export function detectCurrentViewId(views: SnapshotView[]): string | undefined {
  const search = (globalThis as { location?: { search?: string } }).location?.search;
  if (search) {
    const raw = new URLSearchParams(search).get('viewid');
    if (raw) {
      const want = normalizeGuid(decodeURIComponent(raw));
      const hit = views.find((v) => v.id && normalizeGuid(v.id) === want);
      if (hit) return hit.id;
    }
  }
  return views.find((v) => v.isDefault)?.id ?? views[0]?.id;
}

function listPathFor(ctx: SpPageContext, listTitle?: string): string {
  const web = ctx.webAbsoluteUrl;
  if (listTitle) {
    return web + "/_api/web/lists/getByTitle('" + restTitleSegment(listTitle) + "')";
  }
  if (ctx.pageListId) {
    return web + "/_api/web/lists(guid'" + ctx.pageListId.replace(/[{}]/g, '') + "')";
  }
  throw new Error('FormatFX: no list on this page — open the list itself (not a site home page), or pick a target list in FormatFX.');
}

function explainStatus(status: number): string {
  if (status === 401 || status === 403) {
    return 'you need Edit on this list (formatters require "Manage Lists", part of the default Edit level). Ask the site owner.';
  }
  if (status === 404) {
    return 'target not found — columns go by INTERNAL name (no spaces, what FormatFX shows), views by their exact title.';
  }
  if (status === 412) {
    return 'the request digest went stale — try again.';
  }
  return 'unexpected HTTP ' + status + ' — check the Network tab for the response body.';
}

async function getJson(url: string): Promise<Record<string, unknown>> {
  const r = await fetch(url, {
    headers: { Accept: 'application/json;odata=nometadata' },
    credentials: 'same-origin',
  });
  if (!r.ok) throw new Error('FormatFX: GET failed (' + explainStatus(r.status) + ')');
  return r.json();
}

/** SharePoint 400s that name an un-queryable field, e.g. `_ColorTag` (a Text
 *  system column that exists in /fields but not on /items). The named field is
 *  pruned and the query retried. */
const FIELD_ERR_RE = /field or property '([^']+)' does not exist|query to field '([^']+)' is not valid/i;

/** Safety cap on prune retries (each removes one field SharePoint rejected). */
const PRUNE_LIMIT = 24;

/**
 * GET up to 10 sample rows, self-healing against system columns /items can't
 * query. A type allow-list can't enumerate them all (`_ColorTag` is plain
 * Text), so when SharePoint 400s naming a field we drop it and retry — the
 * query converges on exactly the queryable columns, GET-only. Throws on a real
 * error (403, etc.) so the caller can record why rows are empty.
 */
async function fetchSampleRows(listPath: string, fields: SnapshotField[]): Promise<Record<string, unknown>[]> {
  let selects: string[] = [];
  let expands: string[] = [];
  for (const f of fields) {
    const q = fieldQuery(f);
    if (!q) continue;                                  // un-queryable by type → skip, gap-filled at import
    if (q.expand) {
      if (expands.length >= EXPAND_CAP) continue;      // beyond the expand cap → skip, gap-filled at import
      expands.push(q.expand);
    }
    selects.push(...q.select);
  }

  for (let attempt = 0; attempt < PRUNE_LIMIT; attempt++) {
    const r = await fetch(listPath + '/items?$top=10&$select=' + selects.join(',')
      + (expands.length ? '&$expand=' + expands.join(',') : ''), {
      headers: { Accept: 'application/json;odata=nometadata' },
      credentials: 'same-origin',
    });
    if (r.ok) return ((await r.json()).value as Record<string, unknown>[]) || [];
    const m = FIELD_ERR_RE.exec(await r.text());
    const bad = m && (m[1] || m[2]);
    if (!bad) throw new Error('FormatFX: GET failed (' + explainStatus(r.status) + ')');
    selects = selects.filter((s) => s !== bad && !s.startsWith(bad + '/'));
    expands = expands.filter((e) => e !== bad);
  }
  throw new Error('FormatFX: could not read this list’s rows after pruning system columns.');
}

/**
 * GET-only capture of the list the tab shows (or a named list on the same
 * web) into a List Snapshot. Mirrors the extract snippet, expands capped.
 */
export async function captureSnapshot(opts: { listTitle?: string; includeData?: boolean } = {}): Promise<ListSnapshot> {
  const ctx = readPageContext();
  if (!ctx) throw new Error('FormatFX: this does not look like a SharePoint page. Open your list page first.');
  const listPath = listPathFor(ctx, opts.listTitle);

  const fieldsRes = await getJson(listPath + '/fields?$filter=Hidden eq false'
    + '&$select=InternalName,Title,TypeAsString,Choices,CustomFormatter,LookupList,LookupField,ReadOnlyField,Hidden');
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

  const viewsRes = await getJson(listPath + '/views?$expand=ViewFields'
    + '&$select=Title,Id,DefaultView,CustomFormatter,ViewFields/Items');
  const views: SnapshotView[] = ((viewsRes.value as Record<string, unknown>[]) || []).map((v) => ({
    title: v.Title as string,
    id: v.Id as string,
    isDefault: !!v.DefaultView,
    viewFields: ((v.ViewFields as Record<string, unknown>)?.Items as string[]) || [],
    customFormatter: (v.CustomFormatter as string) || undefined,
  }));

  let rows: Record<string, unknown>[] = [];
  let rowsError: string | undefined;
  if (opts.includeData !== false) {
    try {
      rows = await fetchSampleRows(listPath, fields);
    } catch (e) {
      // rows are best-effort: fields + formatters still captured, sample rows
      // filled at import — but record WHY so the failure isn't silent.
      rows = [];
      rowsError = e instanceof Error ? e.message : String(e);
    }
  }

  return {
    formatfx: 'list-snapshot',
    version: LIST_SNAPSHOT_VERSION,
    capturedAt: new Date().toISOString(),
    siteUrl: ctx.webAbsoluteUrl,
    list: ctx.listTitle || opts.listTitle || undefined,
    listId: ctx.pageListId ? ctx.pageListId.replace(/[{}]/g, '') : undefined,
    fields,
    views,
    rows,
    currentViewId: detectCurrentViewId(views),
    ...(rowsError ? { rowsError } : {}),
  };
}

/**
 * Narrow a captured snapshot to a user's picker choice (extract-push): keep
 * only the chosen columns (and their row cells), and — when asked — keep just
 * one view, flagged isDefault so it auto-loads as the main document on
 * arrival. Which view: `viewId` when given (the popup dashboard's per-view
 * grab), else the current view. With the view excluded, no views travel and
 * the columns import as a grid. Pure; node-tested.
 */
export function selectFromSnapshot(
  snap: ListSnapshot,
  opts: { fieldNames: string[]; includeCurrentView: boolean; dropFormatterFor?: string[]; viewId?: string },
): ListSnapshot {
  const keep = new Set(opts.fieldNames);
  const dropFmt = new Set(opts.dropFormatterFor ?? []);
  const fields = snap.fields
    .filter((f) => keep.has(f.internalName))
    // opt out of pulling a column's existing formatter without losing the column
    .map((f) => (dropFmt.has(f.internalName) && f.customFormatter ? { ...f, customFormatter: undefined } : f));
  const rows = snap.rows.map((r) => {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(r)) if (keep.has(k)) out[k] = r[k];
    return out;
  });
  let views: SnapshotView[] = [];
  if (opts.includeCurrentView) {
    const wanted = opts.viewId
      ? snap.views.find((v) => v.id && v.id === opts.viewId)
      : snap.views.find((v) => v.id && v.id === snap.currentViewId) ?? snap.views.find((v) => v.isDefault);
    if (wanted) views = [{ ...wanted, isDefault: true }];
  }
  return { ...snap, fields, rows, views };
}

/** One target's live formatter, as read before an apply. null = none set. */
export interface TargetFormatter {
  target: 'field' | 'view';
  name: string;
  formatter: string | null;
}

/**
 * Read-only: the current CustomFormatter of every target in a payload (the
 * same per-target GET applyFormatters does in its look-before-write step).
 * The extension's pre-apply backup is built from this. Never writes.
 */
export async function readTargetFormatters(payload: ApplyPayload): Promise<TargetFormatter[]> {
  const ctx = readPageContext();
  if (!ctx) throw new Error('FormatFX: this does not look like a SharePoint page. Open your list page first.');
  const listPath = listPathFor(ctx, payload.listTitle);
  const out: TargetFormatter[] = [];
  for (const t of payload.targets) {
    const r = await fetch(targetPath(listPath, t.target, t.name) + '?$select=CustomFormatter', {
      headers: { Accept: 'application/json;odata=nometadata' },
      credentials: 'same-origin',
    });
    if (!r.ok) throw new Error('FormatFX: could not read "' + t.name + '" (' + explainStatus(r.status) + ')');
    const current = ((await r.json()).CustomFormatter as string) || '';
    out.push({ target: t.target, name: t.name, formatter: current || null });
  }
  return out;
}

export interface ApplyOutcome {
  target: 'field' | 'view';
  name: string;
  applied: boolean;
  previousLength: number;
  newLength: number;
  error?: string;
}

export interface ApplyHooks {
  /** Shown once, listing every target — the single batched confirm. */
  confirm: (message: string) => boolean | Promise<boolean>;
}

function targetPath(listPath: string, target: 'field' | 'view', name: string): string {
  const seg = target === 'field'
    ? "/fields/getByInternalNameOrTitle('" + restTitleSegment(name) + "')"
    : "/views/getByTitle('" + restTitleSegment(name) + "')";
  return listPath + seg;
}

async function fetchDigest(web: string): Promise<string> {
  const res = await fetch(web + '/_api/contextinfo', {
    method: 'POST',
    headers: { Accept: 'application/json;odata=nometadata' },
    credentials: 'same-origin',
  });
  if (!res.ok) throw new Error('FormatFX: could not get a request digest (' + explainStatus(res.status) + ')');
  return (await res.json()).FormDigestValue as string;
}

/**
 * Apply one or more formatters: look before writing, ONE batched confirm
 * listing every target, then a MERGE per target (one shared form digest,
 * refreshed once on a 412). Per-target failures are reported, never thrown
 * past their sibling writes — a 403 on one column still lets the rest apply.
 */
export async function applyFormatters(payload: ApplyPayload, hooks: ApplyHooks): Promise<ApplyOutcome[]> {
  const ctx = readPageContext();
  if (!ctx) throw new Error('FormatFX: this does not look like a SharePoint page. Open your list page first.');
  const listPath = listPathFor(ctx, payload.listTitle);
  const listLabel = payload.listTitle || ctx.listTitle || 'this list';

  // 1) look before writing — current length of each target
  const pre: number[] = [];
  for (const t of payload.targets) {
    const r = await fetch(targetPath(listPath, t.target, t.name) + '?$select=CustomFormatter', {
      headers: { Accept: 'application/json;odata=nometadata' },
      credentials: 'same-origin',
    });
    if (!r.ok) throw new Error('FormatFX: could not read "' + t.name + '" (' + explainStatus(r.status) + ')');
    pre.push(((await r.json()).CustomFormatter as string || '').length);
  }

  // 2) one confirm, full echo of every write
  const lines = payload.targets.map((t, i) => {
    const what = t.target === 'field' ? 'column [' + t.name + ']' : 'view "' + t.name + '"';
    const state = pre[i] ? 'has a formatter (' + pre[i] + ' chars) → REPLACED' : 'currently none';
    // a v2 clear target removes the formatter instead of setting one
    const to = t.clear ? 'REMOVED' : t.formatterJson.length + ' chars';
    return '  • ' + what + ': ' + state + ' → ' + to;
  });
  const msg = 'FormatFX apply to ' + listLabel + '\n'
    + payload.targets.length + ' formatter(s) will be written:\n\n' + lines.join('\n') + '\n\nApply?';
  if (!(await hooks.confirm(msg))) {
    return payload.targets.map((t, i) => ({
      target: t.target, name: t.name, applied: false, previousLength: pre[i], newLength: pre[i],
    }));
  }

  // 3) one digest for the batch, refreshed once if it goes stale mid-run
  let digest = await fetchDigest(ctx.webAbsoluteUrl);
  const outcomes: ApplyOutcome[] = [];
  for (let i = 0; i < payload.targets.length; i++) {
    const t = payload.targets[i];
    const url = targetPath(listPath, t.target, t.name);
    const write = async (): Promise<Response> => fetch(url, {
      method: 'POST',
      headers: {
        'Accept': 'application/json;odata=nometadata',
        'Content-Type': 'application/json;odata=nometadata',
        'X-RequestDigest': digest,
        'IF-MATCH': '*',
        'X-HTTP-Method': 'MERGE',
      },
      credentials: 'same-origin',
      body: JSON.stringify({ CustomFormatter: t.formatterJson }),
    });
    try {
      let put = await write();
      if (put.status === 412) {
        digest = await fetchDigest(ctx.webAbsoluteUrl); // stale digest — refresh once and retry
        put = await write();
      }
      if (!put.ok) throw new Error(explainStatus(put.status));
      const verify = await fetch(url + '?$select=CustomFormatter', {
        headers: { Accept: 'application/json;odata=nometadata' },
        credentials: 'same-origin',
      });
      const now = verify.ok ? ((await verify.json()).CustomFormatter as string || '') : t.formatterJson;
      outcomes.push({ target: t.target, name: t.name, applied: true, previousLength: pre[i], newLength: now.length });
    } catch (e) {
      outcomes.push({
        target: t.target, name: t.name, applied: false, previousLength: pre[i], newLength: pre[i],
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return outcomes;
}
