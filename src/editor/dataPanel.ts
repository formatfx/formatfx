// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sam Yost. FormatFX is dual-licensed: AGPL-3.0-only (see LICENSE) or a commercial license (see LICENSING.md).

/**
 * editor/dataPanel.ts — Mock data editor.
 *
 * - Fields with full SP type coverage (incl. lookup w/ target list+column,
 *   protected/read-only system columns, choice options).
 * - Add-field form (name + type dropdown + lookup config + protected).
 * - Schema import: paste the JSON from tools/Export-ListSchema.ps1 or a
 *   hand-written CSV (auto-detected); the PS script is downloadable in-app.
 * - Row values feed the expression engine. Person cells take
 *   "Name <email>; ..." — lookup cells take "Value (id); ...".
 */

import { state } from './state';
import { importSchema, buildSampleRows, sampleValue, FIELD_TYPE_OPTIONS, CSV_HELP } from '../core/schemaImport';
import { buildGridRoot, isPureGrid } from './gridScaffold';
import { inlineColumnFormatter } from './lookDialect';
import { importJson } from '../core/serializer';
import { parseThemeJson } from '../core/theme';
import { buildExtractSnippet } from '../bridge/extractSnippet';
import { onSpTabs, getSpTabs, getDetectedVersion, requestSnapshotFromExtension } from './extensionBridge';
import type { SpTabInfo } from '../bridge/extChannel';
import type { CellValue, FieldType, MockField, PersonValue, LookupValue } from '../core/types';
import type { FormatterDocument } from '../core/types';
import exportScript from '../../tools/Export-ListSchema.ps1?raw';

/**
 * Apply an imported schema / List Snapshot (raw JSON or CSV text) into the
 * app state. Shared by the Data-tab import form and the companion-extension
 * push handler. Returns true on success. On a fresh, untouched grid it loads
 * the snapshot's default-view row formatting (the extraction magic moment)
 * under the pure-grid guard; otherwise it rebuilds the grid around the new
 * schema — never clobbering someone's layout work, always one undo step.
 */
export function applyImportedSchema(
  raw: string,
  toast: (m: string) => void,
  opts: { dropColumnFormatters?: string[] } = {},
): boolean {
  try {
    const schema = importSchema(raw);
    state.fields = schema.fields;
    state.rows = schema.rows ?? buildSampleRows(schema.fields, 3);
    const drop = new Set(opts.dropColumnFormatters ?? []);
    for (const name of drop) delete state.columnLooks[name];
    if (schema.columnFormatters) {
      for (const [name, tree] of Object.entries(schema.columnFormatters)) {
        // a live CustomFormatter speaks @currentField — register it as an
        // explicit-dialect LOOK (unstamped: imports are one "Save as
        // component" gesture from editability, never silently editable)
        if (!drop.has(name)) state.columnLooks[name] = inlineColumnFormatter(tree, name);
      }
    }
    state.importedViews = schema.views ?? [];
    // Rules/Quick Steps ride along INERT (#214): stored so the captured list
    // is whole; no UI interprets them yet.
    state.importedRules = schema.rules ?? [];
    if (!state.fields.some((f) => f.name === state.currentFieldName)) {
      state.currentFieldName = state.fields.find((f) => !f.protected)?.name ?? state.fields[0].name;
    }
    // Rebuild the FLOOR from the imported schema while it's still pure
    // scaffolding — never clobber a grid someone has started shaping. A
    // default view's row/tile formatting becomes its own named SHEET (the
    // floor never renders a view layout — FLOOR-AND-SHEETS Stage 1).
    let loadedView: string | null = null;
    if (isPureGrid(state.floorDoc.root)) {
      state.mutateDocument(() => {
        state.floorDoc.root = buildGridRoot(state.fields, state.columnLooks);
      });
    }
    const dv = schema.views?.find((v) => v.isDefault && v.customFormatter);
    if (dv) {
      let viewDoc: FormatterDocument | null = null;
      try { viewDoc = importJson(dv.customFormatter!); } catch { /* leave the floor up */ }
      if (viewDoc && (viewDoc.kind === 'row' || viewDoc.kind === 'tile')) {
        state.loadViewDocument(viewDoc, dv.title);
        loadedView = dv.title;
      }
    }
    state.emit('data');
    const cfCount = Object.keys(schema.columnFormatters ?? {}).filter((n) => !drop.has(n)).length;
    const vCount = schema.views?.length ?? 0;
    toast(`Imported ${schema.fields.length} fields${schema.listName ? ` from "${schema.listName}"` : ''}`
      + `${schema.rows ? ` + ${schema.rows.length} rows` : ''}`
      + `${cfCount ? ` + ${cfCount} column look${cfCount === 1 ? '' : 's'}` : ''}`
      + `${vCount ? ` + ${vCount} views` : ''}`
      + `${loadedView ? ` — "${loadedView}" opened as its own view (Ctrl+Z removes it; the grid is untouched)` : ''}`);
    return true;
  } catch (e) {
    toast(`Schema import failed: ${(e as Error).message}`);
    return false;
  }
}

// ─── cell value ⇄ text ───────────────────────────────────────────────────────

function personToText(v: CellValue): string {
  const arr = Array.isArray(v) ? v : v ? [v] : [];
  return arr.map((p) => (typeof p === 'object' && p && 'email' in p ? `${p.title} <${p.email}>` : '')).filter(Boolean).join('; ');
}

function textToPeople(text: string): PersonValue[] {
  return text.split(';').map((s) => s.trim()).filter(Boolean).map((s) => {
    const m = s.match(/^(.*?)\s*<([^>]+)>$/);
    if (m) return { title: m[1], email: m[2] };
    return { title: s, email: `${s.toLowerCase().replace(/\s+/g, '.')}@contoso.com` };
  });
}

function lookupToText(v: CellValue): string {
  const arr = Array.isArray(v) ? v : v ? [v] : [];
  return arr.map((l) => (typeof l === 'object' && l && 'lookupValue' in l ? `${l.lookupValue} (${l.lookupId})` : '')).filter(Boolean).join('; ');
}

function textToLookups(text: string): LookupValue[] {
  return text.split(';').map((s) => s.trim()).filter(Boolean).map((s, i) => {
    const m = s.match(/^(.*?)\s*\((\d+)\)$/);
    if (m) return { lookupValue: m[1], lookupId: Number(m[2]) };
    return { lookupValue: s, lookupId: i + 1 };
  });
}

function cellToText(v: CellValue, type: FieldType): string {
  if (type === 'person' || type === 'personMulti') return personToText(v);
  if (type === 'lookup' || type === 'lookupMulti') return lookupToText(v);
  if (v === null || v === undefined) return '';
  return String(v);
}

function textToCell(text: string, type: FieldType): CellValue {
  switch (type) {
    case 'number': case 'currency': return text === '' ? '' : Number(text);
    case 'date': return text === '' ? null : text; // empty date = null (SP =='' semantics)
    case 'boolean': return text === 'true' || text === '1' || text === 'yes';
    case 'person': return textToPeople(text)[0] ?? null;
    case 'personMulti': return textToPeople(text);
    case 'lookup': return textToLookups(text)[0] ?? null;
    case 'lookupMulti': return textToLookups(text);
    default: return text;
  }
}

// ─── panel ───────────────────────────────────────────────────────────────────

export function mountDataPanel(host: HTMLElement, onToast: (m: string) => void): void {
  let showImport = false;
  let showAddField = false;

  const render = () => {
    host.innerHTML = '';

    // toolbar
    const bar = document.createElement('div');
    bar.className = 'wb-data-toolbar';

    if (state.doc.kind === 'column') {
      const fieldSel = document.createElement('select');
      fieldSel.title = 'Which column this formatter is applied to — @currentField resolves to this field\'s value in the preview';
      for (const f of state.fields) {
        const o = document.createElement('option');
        o.value = f.name;
        o.textContent = `@currentField → ${f.name}`;
        if (f.name === state.currentFieldName) o.selected = true;
        fieldSel.appendChild(o);
      }
      fieldSel.addEventListener('change', () => {
        state.currentFieldName = fieldSel.value;
        state.emit('data');
      });
      bar.appendChild(fieldSel);
    }
    // row/tile formatters reference fields explicitly — no @currentField picker

    const mkBtn = (text: string, title: string, fn: () => void) => {
      const b = document.createElement('button');
      b.textContent = text;
      b.title = title;
      b.addEventListener('click', fn);
      bar.appendChild(b);
    };
    mkBtn('+ field', 'Add a column', () => { showAddField = !showAddField; render(); });
    mkBtn('+ row', 'Add a mock data row', () => {
      const row: Record<string, CellValue> = {};
      state.fields.forEach((f) => { row[f.name] = sampleValue(f, state.rows.length); });
      state.rows.push(row);
      state.emit('data');
    });
    mkBtn('Import schema…', 'Paste Export-ListSchema.ps1 JSON or a hand-written CSV', () => { showImport = !showImport; render(); });

    host.appendChild(bar);

    // channel v2 presence: connected SharePoint list tabs the extension sees
    const live = liveTabsSection();
    if (live) host.appendChild(live);

    if (showAddField) host.appendChild(addFieldForm(() => { showAddField = false; render(); }));
    // done re-renders so the form closes immediately (matching addFieldForm),
    // rather than relying on a later state.emit('data') to drop it.
    if (showImport) host.appendChild(importForm(onToast, () => { showImport = false; render(); }));

    host.appendChild(dataGrid());
    if (state.importedViews.length) host.appendChild(viewsSection());
    host.appendChild(tenantThemeSection());
  };

  // ── live context via the companion extension (channel v2 presence) ──
  // The extension pushes which CONNECTED list tabs are open (metadata only);
  // from here the user can pull a fresh read-only capture without touching
  // the SharePoint tab. Nothing renders for a v1 extension or none at all.
  const liveTabsSection = (): HTMLElement | null => {
    const tabs = getSpTabs();
    if (getDetectedVersion() < 2 || !tabs.length) return null;
    const wrap = document.createElement('div');
    wrap.className = 'wb-schema-form';
    const heading = document.createElement('div');
    heading.className = 'wb-data-fieldname';
    heading.textContent = `⚡ Live from your open SharePoint tab${tabs.length === 1 ? '' : 's'}`;
    heading.title = 'The companion extension sees these connected list tabs. Pulling is read-only — nothing is ever written from here.';
    wrap.appendChild(heading);

    const pull = async (tab: SpTabInfo, rowsOnly: boolean): Promise<void> => {
      try {
        onToast(`Reading "${tab.label}" from SharePoint…`);
        const text = await requestSnapshotFromExtension(tab.url);
        if (rowsOnly) {
          const schema = importSchema(text);
          if (!schema.rows?.length) { onToast('No rows came back — the list may be empty.'); return; }
          // swap data onto the CURRENT fields; captured cells win, gaps keep samples
          state.rows = schema.rows.map((r, i) => {
            const row: Record<string, CellValue> = {};
            for (const f of state.fields) row[f.name] = f.name in r ? r[f.name] : sampleValue(f, i);
            return row;
          });
          state.emit('data');
          onToast(`Refreshed ${state.rows.length} sample rows from "${tab.label}".`);
        } else {
          if (!window.confirm(`Replace the current fields, rows and imported views with a fresh capture of "${tab.label}"?`)) return;
          applyImportedSchema(text, onToast);
        }
      } catch (e) {
        onToast(`Refresh failed: ${(e as Error).message}`);
      }
    };

    for (const tab of tabs) {
      const row = document.createElement('div');
      row.className = 'wb-data-toolbar';
      const label = document.createElement('span');
      // defensive parse: presence arrives over postMessage — a malformed url
      // must cost the hostname suffix, never the whole Data panel render
      let host = '';
      try { host = new URL(tab.url).hostname; } catch { /* label alone */ }
      label.textContent = host ? `"${tab.label}" — ${host}` : `"${tab.label}"`;
      label.title = tab.url;
      row.appendChild(label);
      const mk = (text: string, title: string, rowsOnly: boolean): void => {
        const b = document.createElement('button');
        b.textContent = text;
        b.title = title;
        b.addEventListener('click', () => void pull(tab, rowsOnly));
        row.appendChild(b);
      };
      mk('⟳ Pull list', 'Fresh read-only capture: fields, formatters, views and rows replace the workspace (confirm first)', false);
      mk('↻ Rows only', 'Refresh just the sample data from the live list — fields and formatters stay as they are', true);
      wrap.appendChild(row);
    }
    return wrap;
  };

  // ── views captured by a List Snapshot ──
  const viewsSection = (): HTMLElement => {
    const wrap = document.createElement('div');
    wrap.className = 'wb-schema-form';
    const heading = document.createElement('div');
    heading.className = 'wb-data-fieldname';
    heading.textContent = `Views from your list (${state.importedViews.length})`;
    heading.title = 'Captured by the live-extract snippet. A view\'s formatter is the row formatting of THAT view — open one as its own named view to edit it.';
    wrap.appendChild(heading);

    for (const view of state.importedViews) {
      const row = document.createElement('div');
      row.className = 'wb-data-toolbar';
      const label = document.createElement('span');
      label.style.flex = '1';
      label.textContent = `${view.title}${view.isDefault ? ' · default' : ''}`
        + `${view.customFormatter ? ' · formatted' : ' · no row formatting'}`;
      row.appendChild(label);
      if (view.customFormatter) {
        const load = document.createElement('button');
        load.textContent = 'Open as a view';
        load.title = 'Parse this view\'s row formatting and open it as its own named view (one undo step; the grid is untouched)';
        load.addEventListener('click', () => {
          try {
            const doc = importJson(view.customFormatter!);
            if (doc.kind === 'row' || doc.kind === 'tile') {
              state.loadViewDocument(doc, view.title);
              onToast(`"${view.title}" opened as its own view — Ctrl+Z removes it again`);
            } else {
              // a column payload becomes the current field's LOOK — the grid
              // renders it embedded, with that column selected
              state.loadDocument(doc);
              onToast(`"${view.title}" holds a column formatter — applied as the ${state.currentFieldName} column's look (Ctrl+Z undoes)`);
            }
          } catch (e) {
            onToast(`Couldn't load "${view.title}": ${(e as Error).message}`);
          }
        });
        const copy = document.createElement('button');
        copy.textContent = 'copy';
        copy.title = 'Copy this view\'s raw formatter JSON';
        copy.addEventListener('click', async () => {
          try {
            await navigator.clipboard.writeText(view.customFormatter!);
            onToast(`"${view.title}" view formatter JSON copied`);
          } catch {
            onToast('Copy failed — clipboard access blocked (select the text and use Ctrl/Cmd+C)');
          }
        });
        row.append(load, copy);
      }
      wrap.appendChild(row);
    }

    const clear = document.createElement('button');
    clear.textContent = 'Clear captured views';
    clear.title = 'Forget this list — loaded documents and registered formatters stay';
    clear.addEventListener('click', () => {
      state.importedViews = [];
      state.emit('data');
    });
    wrap.appendChild(clear);
    return wrap;
  };

  // ── tenant theme palette ──
  const tenantThemeSection = (): HTMLElement => {
    const wrap = document.createElement('div');
    // advanced — but if a theme is active (e.g. from a project file), basic
    // users can still see why the preview looks different, and clear it
    wrap.className = 'wb-schema-form wb-adv' + (state.customTheme ? ' wb-adv-active' : '');

    const heading = document.createElement('div');
    heading.className = 'wb-data-fieldname';
    const count = state.customTheme ? Object.keys(state.customTheme).length : 0;
    heading.textContent = `Tenant theme ${count ? `(${count} tokens active)` : '(stock Fluent)'}`;
    heading.title = 'Make the preview wear YOUR site\'s theme. On the real list page, run JSON.stringify(window.__themeState__.theme) in the browser console (F12) and paste the result here — or pick a saved .json. Partial palettes merge over the stock light/dark base.';
    wrap.appendChild(heading);

    const applyThemeJson = (text: string) => {
      try {
        state.customTheme = parseThemeJson(text);
        state.emit('theme');
        state.emit('data');
        onToast(`Tenant theme applied — ${Object.keys(state.customTheme).length} tokens override the stock palette`);
      } catch (e) {
        onToast(`Theme import failed: ${(e as Error).message}`);
      }
    };

    const row = document.createElement('div');
    row.className = 'wb-data-toolbar';
    const file = document.createElement('button');
    file.textContent = '🎨 Choose theme file…';
    file.addEventListener('click', () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json,application/json';
      input.addEventListener('change', async () => {
        const f = input.files?.[0];
        if (f) applyThemeJson(await f.text());
      });
      input.click();
    });
    row.appendChild(file);
    if (state.customTheme) {
      const clear = document.createElement('button');
      clear.textContent = 'Back to stock Fluent';
      clear.addEventListener('click', () => {
        state.customTheme = null;
        state.emit('theme');
        state.emit('data');
        onToast('Stock Fluent palette restored');
      });
      row.appendChild(clear);
    }
    wrap.appendChild(row);

    const paste = document.createElement('textarea');
    paste.rows = 2;
    paste.placeholder = '…or paste theme JSON (window.__themeState__.theme / Fluent Theme Designer output)';
    paste.addEventListener('change', () => {
      if (paste.value.trim()) applyThemeJson(paste.value);
    });
    wrap.appendChild(paste);
    return wrap;
  };

  // ── add-field form ──
  const addFieldForm = (done: () => void): HTMLElement => {
    const form = document.createElement('div');
    form.className = 'wb-schema-form';

    const name = document.createElement('input');
    name.placeholder = 'InternalName (no spaces)';

    const type = document.createElement('select');
    for (const opt of FIELD_TYPE_OPTIONS) {
      const o = document.createElement('option');
      o.value = opt.value;
      o.textContent = opt.label;
      type.appendChild(o);
    }

    const lookupWrap = document.createElement('div');
    lookupWrap.className = 'wb-schema-lookup';
    lookupWrap.hidden = true;
    const lkList = document.createElement('input');
    lkList.placeholder = 'Target list (e.g. Projects)';
    const lkCol = document.createElement('input');
    lkCol.placeholder = 'Target column (e.g. Title)';
    lookupWrap.append(lkList, lkCol);
    type.addEventListener('change', () => {
      lookupWrap.hidden = !(type.value === 'lookup' || type.value === 'lookupMulti');
    });

    const protLabel = document.createElement('label');
    protLabel.className = 'wb-check';
    const prot = document.createElement('input');
    prot.type = 'checkbox';
    protLabel.append(prot, document.createTextNode(' protected (read-only)'));

    const add = document.createElement('button');
    add.textContent = 'Add field';
    add.addEventListener('click', () => {
      const n = name.value.trim();
      if (!n) return;
      if (/\s/.test(n)) { alert('Internal names cannot contain spaces (SP encodes them as _x0020_). Use the display-name column for pretty names.'); return; }
      if (state.fields.some((f) => f.name === n)) { alert(`Field ${n} already exists.`); return; }
      const field: MockField = {
        name: n,
        type: type.value as FieldType,
        ...(type.value === 'lookup' || type.value === 'lookupMulti'
          ? { lookup: { list: lkList.value.trim() || '?', column: lkCol.value.trim() || 'Title' } }
          : {}),
        ...(prot.checked ? { protected: true } : {}),
      };
      state.fields.push(field);
      state.rows.forEach((row, i) => { row[n] = sampleValue(field, i); });
      // a pure floor grows the new column right away, even while a sheet is up
      if (isPureGrid(state.floorDoc.root)) {
        state.mutateDocument(() => {
          state.floorDoc.root = buildGridRoot(state.fields, state.columnLooks);
        });
      }
      done();
      state.emit('data');
    });

    form.append(name, type, lookupWrap, protLabel, add);
    return form;
  };

  // ── schema import form ──
  const importForm = (toast: (m: string) => void, done: () => void): HTMLElement => {
    const form = document.createElement('div');
    form.className = 'wb-schema-form';

    // When a snapshot carries column formatters, let the user uncheck the ones
    // they don't want before anything is registered (the columns/data still
    // import). No formatters → import straight away, as before.
    const showFormatterReview = (raw: string, fmtCols: string[]): void => {
      const panel = document.createElement('div');
      panel.className = 'wb-schema-form';
      panel.id = 'wb-fmt-review';
      const head = document.createElement('div');
      head.className = 'wb-data-fieldname';
      head.textContent = `Pull in column formatters? (${fmtCols.length})`;
      head.title = 'Uncheck any column whose existing formatter you do NOT want to import. The columns and their data still import.';
      panel.appendChild(head);

      const boxes: HTMLInputElement[] = [];
      for (const name of fmtCols) {
        const lbl = document.createElement('label');
        lbl.className = 'wb-check';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = true;
        cb.value = name;
        boxes.push(cb);
        lbl.append(cb, document.createTextNode(` [$${name}]`));
        panel.appendChild(lbl);
      }

      const row = document.createElement('div');
      row.className = 'wb-data-toolbar';
      const imp = document.createElement('button');
      imp.id = 'wb-fmt-review-import';
      imp.textContent = 'Import';
      imp.addEventListener('click', () => {
        const dropColumnFormatters = boxes.filter((b) => !b.checked).map((b) => b.value);
        if (applyImportedSchema(raw, toast, { dropColumnFormatters })) done();
      });
      const cancel = document.createElement('button');
      cancel.textContent = 'Cancel';
      cancel.addEventListener('click', () => { panel.remove(); });
      row.append(imp, cancel);
      panel.appendChild(row);
      form.append(panel);
    };

    const applySchema = (raw: string): void => {
      // grid-first behaviour and teaching toasts live in the shared helper;
      // the form just closes itself on a successful import.
      let fmtCols: string[] = [];
      try {
        fmtCols = Object.keys(importSchema(raw).columnFormatters ?? {});
      } catch (e) {
        toast(`Schema import failed: ${(e as Error).message}`);
        return;
      }
      if (fmtCols.length) { showFormatterReview(raw, fmtCols); return; }
      if (applyImportedSchema(raw, toast)) done();
    };

    // zero-install live path: an auditable GET-only snippet run on the list
    // page captures fields + live column/view formatters + rows
    const live = document.createElement('div');
    live.className = 'wb-live-extract';
    const liveHead = document.createElement('div');
    liveHead.className = 'wb-data-fieldname';
    liveHead.textContent = '⚡ Live from SharePoint (no install)';
    const liveBtn = document.createElement('button');
    liveBtn.textContent = 'Copy live-extract snippet';
    liveBtn.title = 'A commented, read-only (GET-only) script — every line is meant to be read before you run it';
    liveBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(buildExtractSnippet());
        toast('Extract snippet copied — run it in the console (F12) on your list page, then paste the snapshot it captures below');
      } catch {
        toast('Copy failed — clipboard access blocked (select the text and use Ctrl/Cmd+C)');
      }
    });
    const liveSteps = document.createElement('div');
    liveSteps.className = 'wb-live-steps';
    liveSteps.textContent = '1 · open your SharePoint list page   2 · F12 → Console → paste the snippet & Enter '
      + '(Chrome may make you type "allow pasting" first — its safety prompt for pasted code; the snippet is plain readable GETs) '
      + '  3 · paste the copied snapshot below. Captures columns, choices, live column AND view formatters, and 10 real rows.';
    live.append(liveHead, liveBtn, liveSteps);

    // primary path: pick the exported file directly
    const fileBtn = document.createElement('button');
    fileBtn.textContent = '📄 Choose file… (Export to CSV with schema / .json)';
    fileBtn.title = 'In SharePoint: Export → Export to CSV, with "Include schema" — then pick that file here';
    fileBtn.addEventListener('click', () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.csv,.json,.txt,text/csv,application/json';
      input.addEventListener('change', async () => {
        const file = input.files?.[0];
        if (file) applySchema(await file.text());
      });
      input.click();
    });

    // secondary path: paste
    const text = document.createElement('textarea');
    text.rows = 5;
    text.placeholder = '…or paste the file contents / Export-ListSchema.ps1 JSON / hand-written CSV here';

    const help = document.createElement('details');
    const helpSummary = document.createElement('summary');
    helpSummary.textContent = 'Accepted formats & CSV syntax';
    helpSummary.className = 'wb-schema-help-summary';
    const helpPre = document.createElement('pre');
    helpPre.className = 'wb-schema-help';
    helpPre.textContent = CSV_HELP;
    help.append(helpSummary, helpPre);

    const row = document.createElement('div');
    row.className = 'wb-data-toolbar';

    const apply = document.createElement('button');
    apply.textContent = 'Import pasted text';
    apply.addEventListener('click', () => applySchema(text.value));

    const dl = document.createElement('button');
    dl.textContent = 'Download Export-ListSchema.ps1';
    dl.title = 'PnP PowerShell script — run it against your list to produce the JSON this panel imports';
    dl.addEventListener('click', () => {
      const blob = new Blob([exportScript], { type: 'text/plain' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'Export-ListSchema.ps1';
      a.click();
      URL.revokeObjectURL(a.href);
    });

    const cancel = document.createElement('button');
    cancel.textContent = 'Close';
    cancel.addEventListener('click', () => { done(); state.emit('data'); });

    row.append(apply, dl, cancel);
    form.append(live, fileBtn, text, row, help);
    return form;
  };

  // ── data grid ──
  const dataGrid = (): HTMLElement => {
    const table = document.createElement('table');
    table.className = 'wb-data-table';

    const thead = document.createElement('thead');
    const hr = document.createElement('tr');
    for (const field of state.fields) {
      const th = document.createElement('th');
      const name = document.createElement('div');
      name.className = 'wb-data-fieldname';
      name.textContent = (field.protected ? '🔒 ' : '') + field.name;
      const titleBits = [
        field.displayName && field.displayName !== field.name ? `display name: ${field.displayName}` : '',
        field.lookup ? `lookup → ${field.lookup.list}.${field.lookup.column}` : '',
        field.protected ? 'protected (read-only)' : '',
        'Double-click to remove this field',
      ].filter(Boolean);
      name.title = titleBits.join(' · ');
      name.addEventListener('dblclick', () => {
        if (!confirm(`Remove field ${field.name}?`)) return;
        state.fields = state.fields.filter((f) => f !== field);
        for (const row of state.rows) delete row[field.name];
        if (state.currentFieldName === field.name) {
          state.currentFieldName = state.fields.find((f) => !f.protected)?.name ?? state.fields[0]?.name ?? '';
        }
        if (isPureGrid(state.floorDoc.root)) {
          state.mutateDocument(() => {
            state.floorDoc.root = buildGridRoot(state.fields, state.columnLooks);
          });
        }
        state.emit('data');
      });

      const typeSel = document.createElement('select');
      for (const t of FIELD_TYPE_OPTIONS) {
        const o = document.createElement('option');
        o.value = t.value;
        o.textContent = t.value + (field.lookup && (t.value === 'lookup' || t.value === 'lookupMulti') ? ` → ${field.lookup.list}` : '');
        if (t.value === field.type) o.selected = true;
        typeSel.appendChild(o);
      }
      typeSel.addEventListener('change', () => {
        field.type = typeSel.value as FieldType;
        if ((field.type === 'lookup' || field.type === 'lookupMulti') && !field.lookup) {
          const list = prompt('Lookup target list:', 'Projects') ?? '?';
          const column = prompt('Lookup target column:', 'Title') ?? 'Title';
          field.lookup = { list, column };
        }
        state.rows.forEach((row, i) => { row[field.name] = sampleValue(field, i); });
        state.emit('data');
      });

      th.append(name, typeSel);
      hr.appendChild(th);
    }
    hr.appendChild(document.createElement('th'));
    thead.appendChild(hr);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    state.rows.forEach((row, ri) => {
      const tr = document.createElement('tr');
      for (const field of state.fields) {
        const td = document.createElement('td');
        const inp = document.createElement('input');
        inp.value = cellToText(row[field.name], field.type);
        if (field.protected) {
          inp.disabled = true;
          inp.title = 'Protected (read-only) column';
        }
        if (field.type === 'date') inp.placeholder = 'YYYY-MM-DD';
        if (field.type === 'person' || field.type === 'personMulti') inp.placeholder = 'Name <mail>; …';
        if (field.type === 'lookup' || field.type === 'lookupMulti') inp.placeholder = 'Value (id); …';
        inp.addEventListener('change', () => {
          row[field.name] = textToCell(inp.value, field.type);
          state.emit('data');
        });
        td.appendChild(inp);
        tr.appendChild(td);
      }
      const tdDel = document.createElement('td');
      const del = document.createElement('button');
      del.innerHTML = '<i class="ms-Icon ms-Icon--Delete"></i>';
      del.title = 'Delete row';
      del.setAttribute('aria-label', 'Delete row');
      del.addEventListener('click', () => {
        state.rows.splice(ri, 1);
        state.emit('data');
      });
      tdDel.appendChild(del);
      tr.appendChild(tdDel);
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    return table;
  };

  const hostAny = host as any;
  if (typeof hostAny._unsub === 'function') {
    hostAny._unsub();
  }
  hostAny._unsub = state.subscribe((reason) => {
    if (reason === 'data' || reason === 'load') render();
  });
  // presence changes (extension channel v2) re-render the live section; the
  // isConnected guard keeps a stale mount from painting a detached host
  onSpTabs(() => { if (host.isConnected) render(); });
  render();
}
