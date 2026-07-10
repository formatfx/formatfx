// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sam Yost. FormatFX is dual-licensed: AGPL-3.0-only (see LICENSE) or a commercial license (see LICENSING.md).

/**
 * core/schemaImport.ts — Import real list schemas into the sandbox.
 *
 * Two input formats, auto-detected:
 *
 * 1. JSON — output of tools/Export-ListSchema.ps1 (PnP PowerShell):
 *    {
 *      "list": "Tasks",
 *      "fields": [
 *        { "internalName": "Title", "displayName": "Task name", "type": "Text" },
 *        { "internalName": "Project", "type": "Lookup",
 *          "lookupList": "Projects", "lookupColumn": "Title" },
 *        { "internalName": "ID", "type": "Counter", "readOnly": true }
 *      ],
 *      "sampleRows": [ { "Title": "...", "Project": { "lookupId": 3, "lookupValue": "Apollo" } } ]
 *    }
 *
 * 2. CSV — hand-writable, one field per line (header row optional):
 *    InternalName,Type,DisplayName,LookupList,LookupColumn,Protected,Choices
 *    Title,text,Task name
 *    Status,choice,,,,,"Not started|In progress|Done"
 *    Project,lookup,Project,Projects,Title
 *    ID,number,,,,yes
 *
 * SP field type names (TypeAsString) are mapped to sandbox types, so the CSV
 * also accepts e.g. "User", "DateTime", "MultiChoice", "URL".
 */

import type { MockField, MockRow, FieldType, CellValue, PersonValue, LookupValue, SPElement } from './types';

/** A view captured by the live-extract snippet (formatter kept as raw text). */
export interface ImportedView {
  title: string;
  id?: string;
  isDefault?: boolean;
  viewFields?: string[];
  /** Raw CustomFormatter JSON string — parsed at load time so capture is faithful. */
  customFormatter?: string;
}

/**
 * A Rule / Quick Step captured by a List Snapshot (docs/QUICK-STEPS.md §3.1).
 * Carried INERT — imported and stored, no app UI interprets these yet (#214).
 * `actionParams` stays the raw escaped-JSON string, like customFormatter.
 */
export interface ImportedRule {
  id: string;
  ruleTemplateId?: string;
  title?: string;
  condition?: string;
  triggerType: number;
  actionType: number;
  actionParams?: string;
  outcome?: string;
  isActive?: boolean;
}

export interface ImportedSchema {
  listName?: string;
  fields: MockField[];
  rows?: MockRow[];
  /** Live column formatters recovered from the export (internal name → tree). */
  columnFormatters?: Record<string, SPElement>;
  /** Views captured by a List Snapshot (view formatters arrive here). */
  views?: ImportedView[];
  /** Rules & Quick Steps captured by a List Snapshot — inert metadata. */
  rules?: ImportedRule[];
  /** The list's raw QuickstepsProperties bag (button colors/order) — inert. */
  quickstepsProperties?: string;
  siteUrl?: string;
  listId?: string;
}

export const FIELD_TYPE_OPTIONS: Array<{ value: FieldType; label: string }> = [
  { value: 'text', label: 'Single line of text' },
  { value: 'note', label: 'Multiple lines of text' },
  { value: 'number', label: 'Number' },
  { value: 'currency', label: 'Currency' },
  { value: 'choice', label: 'Choice' },
  { value: 'choiceMulti', label: 'Choice (multi)' },
  { value: 'date', label: 'Date and time' },
  { value: 'person', label: 'Person' },
  { value: 'personMulti', label: 'Person (multi)' },
  { value: 'boolean', label: 'Yes/No' },
  { value: 'hyperlink', label: 'Hyperlink' },
  { value: 'lookup', label: 'Lookup' },
  { value: 'lookupMulti', label: 'Lookup (multi)' },
];

/** SharePoint TypeAsString (and friendly aliases) → sandbox FieldType. */
export function mapSpFieldType(raw: string): FieldType {
  const t = raw.trim().toLowerCase();
  const map: Record<string, FieldType> = {
    'text': 'text', 'single line of text': 'text', 'calculated': 'text',
    'note': 'note', 'multiple lines of text': 'note',
    'number': 'number', 'counter': 'number', 'integer': 'number',
    'currency': 'currency',
    'choice': 'choice', 'multichoice': 'choiceMulti', 'choicemulti': 'choiceMulti',
    'datetime': 'date', 'date': 'date', 'date and time': 'date',
    'user': 'person', 'person': 'person', 'person or group': 'person',
    'usermulti': 'personMulti', 'personmulti': 'personMulti',
    'boolean': 'boolean', 'yes/no': 'boolean', 'attachments': 'boolean',
    'url': 'hyperlink', 'hyperlink': 'hyperlink', 'hyperlink or picture': 'hyperlink',
    'lookup': 'lookup', 'lookupmulti': 'lookupMulti',
    'taxonomyfieldtype': 'text', 'taxonomyfieldtypemulti': 'text',
    'thumbnail': 'hyperlink', 'guid': 'text', 'file': 'text', 'computed': 'text',
    'contenttypeid': 'text', 'modstat': 'choice',
  };
  return map[t] ?? 'text';
}

/** Generate a plausible sample value for a field (used when no data imported). */
export function sampleValue(field: MockField, rowIndex: number): CellValue {
  const person = (n: string): PersonValue => ({
    title: n, email: `${n.toLowerCase().replace(/\s+/g, '.')}@contoso.com`,
  });
  const lookup = (n: string, id: number): LookupValue => ({ lookupId: id, lookupValue: n });
  const names = ['Ada Lovelace', 'Grace Hopper', 'Mark Otto', 'Linus T'];
  switch (field.type) {
    case 'text': return `Sample ${field.name} ${rowIndex + 1}`;
    case 'note': return `Longer ${field.name} content for row ${rowIndex + 1}.`;
    case 'number': return (rowIndex + 1) * 21 % 100;
    case 'currency': return (rowIndex + 1) * 149.5;
    case 'choice': return (field.choices?.length ? field.choices : ['Not started', 'In progress', 'Done'])[rowIndex % (field.choices?.length || 3)];
    case 'choiceMulti': {
      const opts = field.choices?.length ? field.choices : ['Red', 'Green', 'Blue'];
      return opts.slice(0, (rowIndex % opts.length) + 1).join(';#');
    }
    case 'date': {
      const d = new Date();
      d.setDate(d.getDate() + (rowIndex - 1) * 7);
      return d.toISOString().slice(0, 10);
    }
    case 'person': return person(names[rowIndex % names.length]);
    case 'personMulti': return names.slice(0, (rowIndex % 3) + 1).map(person);
    case 'boolean': return rowIndex % 2 === 0;
    case 'hyperlink': return 'https://contoso.sharepoint.com';
    case 'lookup': return lookup(`${field.lookup?.list ?? 'Item'} ${rowIndex + 1}`, rowIndex + 1);
    case 'lookupMulti': return [lookup(`${field.lookup?.list ?? 'Item'} A`, 1), lookup(`${field.lookup?.list ?? 'Item'} B`, 2)].slice(0, (rowIndex % 2) + 1);
  }
}

export function buildSampleRows(fields: MockField[], count = 3): MockRow[] {
  return Array.from({ length: count }, (_, i) => {
    const row: MockRow = {};
    for (const f of fields) row[f.name] = sampleValue(f, i);
    return row;
  });
}

// ─── JSON import (Export-ListSchema.ps1 output) ──────────────────────────────

interface JsonField {
  internalName: string;
  displayName?: string;
  type?: string;
  lookupList?: string;
  lookupColumn?: string;
  readOnly?: boolean;
  choices?: string[];
}

function importSchemaJson(parsed: Record<string, unknown>): ImportedSchema {
  const rawFields = parsed.fields;
  if (!Array.isArray(rawFields)) throw new Error('Schema JSON must contain a "fields" array.');
  const fields: MockField[] = rawFields.map((rf) => {
    const f = rf as JsonField;
    if (!f.internalName) throw new Error('Every field needs an "internalName".');
    const type = mapSpFieldType(f.type ?? 'text');
    return {
      name: f.internalName,
      ...(f.displayName && f.displayName !== f.internalName ? { displayName: f.displayName } : {}),
      type,
      ...(type === 'lookup' || type === 'lookupMulti'
        ? { lookup: { list: f.lookupList ?? '?', column: f.lookupColumn ?? 'Title' } }
        : {}),
      ...(f.readOnly ? { protected: true } : {}),
      ...(f.choices?.length ? { choices: f.choices } : {}),
    };
  });
  let rows: MockRow[] | undefined;
  if (Array.isArray(parsed.sampleRows) && parsed.sampleRows.length) {
    rows = (parsed.sampleRows as MockRow[]).map((r) => {
      const row: MockRow = {};
      for (const f of fields) row[f.name] = (r[f.name] ?? sampleValue(f, 0)) as CellValue;
      return row;
    });
  }
  return { listName: typeof parsed.list === 'string' ? parsed.list : undefined, fields, rows };
}

// ─── CSV import ──────────────────────────────────────────────────────────────

/** Minimal CSV line splitter with double-quote support. */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') inQ = false;
      else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

const TRUTHY = new Set(['yes', 'true', '1', 'y', 'protected', 'readonly']);

function importSchemaCsv(text: string): ImportedSchema {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  if (lines.length === 0) throw new Error('CSV is empty.');
  const fields: MockField[] = [];
  for (const line of lines) {
    const [name, type, displayName, lookupList, lookupColumn, protectedFlag, choices] = splitCsvLine(line);
    if (!name) continue;
    // skip a header row
    if (/^internal[ _]?name$/i.test(name)) continue;
    if (/\s/.test(name)) throw new Error(`"${name}" — internal names cannot contain spaces (SP encodes them as _x0020_).`);
    const mapped = mapSpFieldType(type || 'text');
    fields.push({
      name,
      ...(displayName ? { displayName } : {}),
      type: mapped,
      ...(mapped === 'lookup' || mapped === 'lookupMulti'
        ? { lookup: { list: lookupList || '?', column: lookupColumn || 'Title' } }
        : {}),
      ...(protectedFlag && TRUTHY.has(protectedFlag.toLowerCase()) ? { protected: true } : {}),
      ...(choices ? { choices: choices.split('|').map((c) => c.trim()).filter(Boolean) } : {}),
    });
  }
  if (fields.length === 0) throw new Error('No fields found in CSV.');
  return { fields };
}

// ─── SharePoint "Export to CSV (with schema)" ───────────────────────────────
// Line 1: ListSchema={"schemaXmlList":["<Field Type=... Name=... CustomFormatter=... />", ...]}
// Then a normal CSV: header row of DISPLAY names, then data rows.

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

function xmlAttrs(fieldXml: string): Record<string, string> {
  const openTag = fieldXml.match(/<Field\b[^>]*>/)?.[0] ?? fieldXml;
  const attrs: Record<string, string> = {};
  for (const m of openTag.matchAll(/([A-Za-z0-9_:]+)="([^"]*)"/g)) {
    attrs[m[1]] = decodeXmlEntities(m[2]);
  }
  return attrs;
}

/** Full CSV parser: quoted fields may contain commas, doubled quotes and newlines. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cur = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') inQ = false;
      else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cur); cur = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else cur += c;
  }
  row.push(cur);
  if (row.length > 1 || row[0] !== '') rows.push(row);
  return rows;
}

function coerceCell(raw: string, field: MockField, rowIndex: number): CellValue {
  if (field.type === 'personMulti' || field.type === 'lookupMulti') {
    // SP's "Export to CSV with schema" writes an empty multi-value cell as the
    // literal string "[]" (HANDOFF §3.5); '' covers the hand-CSV case.
    if (raw === '' || raw === '[]') return [];
  }
  if (raw === '') {
    // empty Date cells are null, not '' — SP's =='' comparison distinguishes them
    if (field.type === 'date') return null;
    return '';
  }
  const person = (name: string): PersonValue => ({
    title: name, email: `${name.toLowerCase().replace(/[^a-z0-9]+/g, '.')}@contoso.com`,
  });
  switch (field.type) {
    case 'number': case 'currency': {
      const n = parseFloat(raw.replace(/[,$%\s]/g, ''));
      return Number.isNaN(n) ? raw : n;
    }
    case 'boolean': return /^(yes|true|1)$/i.test(raw);
    case 'person': return person(raw.split(';')[0].trim());
    case 'personMulti': return raw.split(';').map((s) => s.trim()).filter(Boolean).map(person);
    case 'lookup': return { lookupId: rowIndex + 1, lookupValue: raw } as LookupValue;
    case 'lookupMulti':
      return raw.split(';').map((s, i) => ({ lookupId: i + 1, lookupValue: s.trim() })).filter((l) => l.lookupValue) as LookupValue[];
    default: return raw;
  }
}

export function isListSchemaCsv(text: string): boolean {
  return text.replace(/^﻿/, '').startsWith('ListSchema=');
}

export function importListSchemaCsv(text: string): ImportedSchema {
  const clean = text.replace(/^﻿/, '');
  const jsonStart = clean.indexOf('=') + 1;
  // the ListSchema JSON object ends at the first newline that follows it —
  // find it by brace matching so embedded \n escapes don't confuse us
  let depth = 0, end = -1, inStr = false;
  for (let i = jsonStart; i < clean.length; i++) {
    const c = clean[i];
    if (inStr) {
      if (c === '\\') i++;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  if (end < 0) throw new Error('Malformed ListSchema header — could not find the end of the schema JSON.');
  let schemaList: string[];
  try {
    schemaList = JSON.parse(clean.slice(jsonStart, end)).schemaXmlList ?? [];
  } catch (e) {
    throw new Error(`Could not parse the ListSchema JSON: ${(e as Error).message}`);
  }

  const fields: MockField[] = [];
  const byDisplay = new Map<string, MockField>();
  const columnFormatters: Record<string, SPElement> = {};

  for (const fieldXml of schemaList) {
    const a = xmlAttrs(fieldXml);
    const name = a.Name ?? a.StaticName;
    if (!name) continue;
    if (a.Hidden === 'TRUE') continue;
    if (a.Type === 'Computed' || a.Type === 'Guid' || a.Type === 'Counter' && name !== 'ID') continue;
    const type = mapSpFieldType(a.Type ?? 'Text');
    const choices = [...fieldXml.matchAll(/<CHOICE>([^<]*)<\/CHOICE>/g)].map((m) => decodeXmlEntities(m[1]));
    const field: MockField = {
      name,
      ...(a.DisplayName && a.DisplayName !== name ? { displayName: a.DisplayName } : {}),
      type,
      ...(a.ReadOnly === 'TRUE' ? { protected: true } : {}),
      ...(choices.length ? { choices } : {}),
      ...(type === 'lookup' || type === 'lookupMulti'
        ? { lookup: { list: a.List ?? '?', column: a.ShowField ?? 'Title' } } : {}),
    };
    fields.push(field);
    byDisplay.set(a.DisplayName ?? name, field);
    byDisplay.set(name, field);
    if (a.CustomFormatter) {
      try {
        columnFormatters[name] = JSON.parse(a.CustomFormatter);
      } catch { /* ignore unparseable formatter */ }
    }
  }
  if (fields.length === 0) throw new Error('No usable fields found in the ListSchema header.');

  // CSV body: header row of display names, then data
  const body = clean.slice(end).replace(/^\r?\n/, '');
  const rows: MockRow[] = [];
  const csv = parseCsv(body);
  if (csv.length >= 2) {
    const header = csv[0].map((h) => h.trim());
    for (let r = 1; r < csv.length && rows.length < 10; r++) {
      const row: MockRow = {};
      header.forEach((h, c) => {
        const field = byDisplay.get(h);
        if (field) row[field.name] = coerceCell(csv[r][c] ?? '', field, r - 1);
      });
      // fill fields that weren't view columns
      for (const f of fields) if (!(f.name in row)) row[f.name] = sampleValue(f, r - 1);
      rows.push(row);
    }
  }

  return {
    fields,
    rows: rows.length ? rows : undefined,
    ...(Object.keys(columnFormatters).length ? { columnFormatters } : {}),
  };
}

// ─── FormatFX List Snapshot (the live-extract snippet's payload) ─────────────
// Versioned from day one: this format is also the future companion-extension
// wire protocol (docs/CONNECTIVITY.md §3.1). Formatters travel as raw JSON
// strings so capture is faithful; parse problems surface at import time.

export const LIST_SNAPSHOT_VERSION = 1;

export function isListSnapshot(parsed: unknown): parsed is Record<string, unknown> {
  return !!parsed && typeof parsed === 'object'
    && (parsed as Record<string, unknown>)['formatfx'] === 'list-snapshot';
}

interface SnapshotField {
  internalName: string;
  displayName?: string;
  type?: string;
  choices?: string[];
  lookupList?: string;
  lookupColumn?: string;
  readOnly?: boolean;
  hidden?: boolean;
  customFormatter?: string;
}

/** One OData (nometadata) cell → the mock-data model. */
function coerceSnapshotCell(raw: unknown, field: MockField): CellValue {
  if (raw === null || raw === undefined) {
    if (field.type === 'personMulti' || field.type === 'lookupMulti') return [];
    if (field.type === 'date') return null; // blank dates stay null
    return '';
  }
  const person = (o: Record<string, unknown>): PersonValue => ({
    title: String(o.Title ?? o.title ?? ''),
    email: String(o.EMail ?? o.Email ?? o.email ?? ''),
  });
  const lookup = (o: Record<string, unknown>): LookupValue => {
    const id = Number(o.Id ?? o.ID ?? 0);
    const valueKey = Object.keys(o).find((k) => k !== 'Id' && k !== 'ID' && typeof o[k] !== 'object');
    return { lookupId: Number.isFinite(id) ? id : 0, lookupValue: String(valueKey ? o[valueKey] : '') };
  };
  const asArray = Array.isArray(raw) ? raw : [raw];
  switch (field.type) {
    case 'person': return typeof raw === 'object' ? person(asArray[0] as Record<string, unknown>) : '';
    case 'personMulti': return asArray.filter((x) => x && typeof x === 'object').map((x) => person(x as Record<string, unknown>));
    case 'lookup': return typeof raw === 'object' ? lookup(asArray[0] as Record<string, unknown>) : '';
    case 'lookupMulti': return asArray.filter((x) => x && typeof x === 'object').map((x) => lookup(x as Record<string, unknown>));
    case 'choiceMulti': return Array.isArray(raw) ? raw.map(String).join(';#') : String(raw);
    case 'boolean': return typeof raw === 'boolean' ? raw : /^(true|yes|1)$/i.test(String(raw));
    case 'number': case 'currency': {
      if (typeof raw === 'number') return raw;
      const n = parseFloat(String(raw));
      return Number.isNaN(n) ? String(raw) : n;
    }
    case 'hyperlink':
      return typeof raw === 'object' ? String((raw as Record<string, unknown>).Url ?? '') : String(raw);
    default:
      return typeof raw === 'object' ? '' : String(raw);
  }
}

function importListSnapshot(parsed: Record<string, unknown>): ImportedSchema {
  const version = Number(parsed.version ?? 0);
  if (version > LIST_SNAPSHOT_VERSION) {
    throw new Error(`This snapshot is version ${version}, newer than this app understands (v${LIST_SNAPSHOT_VERSION}) — refresh FormatFX, or re-copy the extract snippet from this version and capture again.`);
  }
  const rawFields = parsed.fields;
  if (!Array.isArray(rawFields)) throw new Error('Snapshot has no "fields" array — re-run the extract snippet on your list page.');

  const fields: MockField[] = [];
  const columnFormatters: Record<string, SPElement> = {};
  for (const rf of rawFields as SnapshotField[]) {
    if (!rf.internalName || rf.hidden) continue;
    const type = mapSpFieldType(rf.type ?? 'text');
    fields.push({
      name: rf.internalName,
      ...(rf.displayName && rf.displayName !== rf.internalName ? { displayName: rf.displayName } : {}),
      type,
      ...(type === 'lookup' || type === 'lookupMulti'
        ? { lookup: { list: rf.lookupList || '?', column: rf.lookupColumn || 'Title' } } : {}),
      ...(rf.readOnly ? { protected: true } : {}),
      ...(rf.choices?.length ? { choices: rf.choices } : {}),
    });
    if (typeof rf.customFormatter === 'string' && rf.customFormatter.trim()) {
      try {
        columnFormatters[rf.internalName] = JSON.parse(rf.customFormatter);
      } catch { /* unparseable formatter — the field still imports */ }
    }
  }
  if (fields.length === 0) throw new Error('No usable fields in the snapshot.');

  const views: ImportedView[] = Array.isArray(parsed.views)
    ? (parsed.views as Array<Record<string, unknown>>)
      .filter((v) => typeof v.title === 'string' && v.title)
      .map((v) => ({
        title: String(v.title),
        ...(typeof v.id === 'string' ? { id: v.id } : {}),
        ...(v.isDefault ? { isDefault: true } : {}),
        ...(Array.isArray(v.viewFields) ? { viewFields: v.viewFields.map(String) } : {}),
        ...(typeof v.customFormatter === 'string' && v.customFormatter.trim()
          ? { customFormatter: v.customFormatter } : {}),
      }))
    : [];

  let rows: MockRow[] | undefined;
  if (Array.isArray(parsed.rows) && parsed.rows.length) {
    rows = (parsed.rows as Array<Record<string, unknown>>).slice(0, 10).map((r, i) => {
      const row: MockRow = {};
      for (const f of fields) {
        // fields beyond the snippet's expand cap arrive absent — gap-fill,
        // exactly like the CSV import does for non-view columns
        row[f.name] = f.name in r ? coerceSnapshotCell(r[f.name], f) : sampleValue(f, i);
      }
      return row;
    });
  }

  // Rules/Quick Steps ride along inert (lenient: malformed entries are
  // skipped, never a failed import — the formatting capture is the product).
  const rules: ImportedRule[] = Array.isArray(parsed.rules)
    ? (parsed.rules as Array<Record<string, unknown>>)
      .filter((r) => r && typeof r === 'object' && typeof r.id === 'string' && r.id)
      .map((r) => ({
        id: String(r.id),
        ...(typeof r.ruleTemplateId === 'string' ? { ruleTemplateId: r.ruleTemplateId } : {}),
        ...(typeof r.title === 'string' ? { title: r.title } : {}),
        ...(typeof r.condition === 'string' ? { condition: r.condition } : {}),
        triggerType: Number(r.triggerType ?? 0),
        actionType: Number(r.actionType ?? 0),
        ...(typeof r.actionParams === 'string' ? { actionParams: r.actionParams } : {}),
        ...(typeof r.outcome === 'string' ? { outcome: r.outcome } : {}),
        ...(typeof r.isActive === 'boolean' ? { isActive: r.isActive } : {}),
      }))
    : [];

  return {
    listName: typeof parsed.list === 'string' ? parsed.list : undefined,
    siteUrl: typeof parsed.siteUrl === 'string' ? parsed.siteUrl : undefined,
    listId: typeof parsed.listId === 'string' ? parsed.listId : undefined,
    fields,
    rows,
    ...(Object.keys(columnFormatters).length ? { columnFormatters } : {}),
    ...(views.length ? { views } : {}),
    ...(rules.length ? { rules } : {}),
    ...(typeof parsed.quickstepsProperties === 'string' && parsed.quickstepsProperties
      ? { quickstepsProperties: parsed.quickstepsProperties } : {}),
  };
}

// ─── Entry point ─────────────────────────────────────────────────────────────

export function importSchema(text: string): ImportedSchema {
  if (isListSchemaCsv(text.trimStart())) return importListSchemaCsv(text.trimStart());
  const trimmed = text.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch (e) {
      throw new Error(`Invalid JSON: ${(e as Error).message}`);
    }
    if (isListSnapshot(parsed)) return importListSnapshot(parsed);
    if (Array.isArray(parsed)) return importSchemaJson({ fields: parsed });
    return importSchemaJson(parsed as Record<string, unknown>);
  }
  return importSchemaCsv(trimmed);
}

export const CSV_HELP = `Accepts (auto-detected):
1. A FormatFX List Snapshot — what the "⚡ Live from SharePoint" snippet above
   copies to your clipboard. The best path: fields, choices, live COLUMN and
   VIEW formatters, and up to 10 real rows, no file hop.
2. SharePoint's native "Export to CSV" with "Include schema" — paste the whole
   file. Recovers internal names, types, choices, read-only flags, your view's
   real rows AND any live column formatters (auto-registered as references).
   NOTE: SP's export OMITS calculated columns entirely — register those
   formatters by hand (Column formatter references section below).
3. Export-ListSchema.ps1 JSON (download below).
4. Hand-written CSV: one field per line — InternalName,Type,DisplayName,LookupList,LookupColumn,Protected,Choices
  Title,text,Task name
  Status,choice,,,,,"Not started|In progress|Done"
  Project,lookup,Project,Projects,Title
  AssignedTo,personMulti
  ID,number,,,,yes
Types: text note number currency choice choiceMulti date person personMulti boolean hyperlink lookup lookupMulti (SP names like User, DateTime, MultiChoice, URL also work)`;
