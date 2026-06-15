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
import { importJson, exportJson, treeHasNames } from '../core/serializer';
import { parseThemeJson } from '../core/theme';
import { buildExtractSnippet } from '../bridge/extractSnippet';
import type { CellValue, FieldType, MockField, PersonValue, LookupValue, SPElement } from '../core/types';
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
export function applyImportedSchema(raw: string, toast: (m: string) => void): boolean {
  try {
    const schema = importSchema(raw);
    state.fields = schema.fields;
    state.rows = schema.rows ?? buildSampleRows(schema.fields, 3);
    if (schema.columnFormatters) {
      Object.assign(state.columnRefs, schema.columnFormatters);
    }
    state.importedViews = schema.views ?? [];
    if (!state.fields.some((f) => f.name === state.currentFieldName)) {
      state.currentFieldName = state.fields.find((f) => !f.protected)?.name ?? state.fields[0].name;
    }
    let loadedView: string | null = null;
    if (state.activeDocKey === 'main' && state.doc.kind === 'grid' && isPureGrid(state.doc.root)) {
      const dv = schema.views?.find((v) => v.isDefault && v.customFormatter);
      let viewDoc: FormatterDocument | null = null;
      if (dv) {
        try { viewDoc = importJson(dv.customFormatter!); } catch { /* fall back to the grid rebuild */ }
      }
      if (viewDoc) {
        state.loadDocument(viewDoc);
        loadedView = dv!.title;
      } else {
        state.mutateDocument(() => {
          state.doc.root = buildGridRoot(state.fields, state.columnRefs);
        });
      }
    }
    state.emit('data');
    const cfCount = Object.keys(schema.columnFormatters ?? {}).length;
    const vCount = schema.views?.length ?? 0;
    toast(`Imported ${schema.fields.length} fields${schema.listName ? ` from "${schema.listName}"` : ''}`
      + `${schema.rows ? ` + ${schema.rows.length} rows` : ''}`
      + `${cfCount ? ` + ${cfCount} live column formatters (registered as references)` : ''}`
      + `${vCount ? ` + ${vCount} views` : ''}`
      + `${loadedView ? ` — "${loadedView}" row formatting loaded as the main document (Ctrl+Z restores the grid)` : ''}`);
    return true;
  } catch (e) {
    toast(`Schema import failed: ${(e as Error).message}`);
    return false;
  }
}

/** Accept a bare element or any wrapper shape and return the element tree. */
function importSchemaJsonToTree(text: string): SPElement {
  return importJson(text).root;
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

    if (state.activeDocKey !== 'main') {
      // editing a column formatter — @currentField IS that column, not a choice
      const chip = document.createElement('span');
      chip.className = 'wb-current-chip';
      chip.textContent = `@currentField → ${state.currentFieldName} (the column being edited)`;
      chip.title = 'While a column formatter is open, @currentField always resolves to that column — exactly like on a real list. Switch back to the main formatter to change which field a column-kind preview targets.';
      bar.appendChild(chip);
    } else if (state.doc.kind === 'column') {
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

    if (showAddField) host.appendChild(addFieldForm(() => { showAddField = false; render(); }));
    if (showImport) host.appendChild(importForm(onToast, () => { showImport = false; }));

    host.appendChild(dataGrid());
    if (state.importedViews.length) host.appendChild(viewsSection());
    host.appendChild(columnRefsSection());
    host.appendChild(tenantThemeSection());
  };

  // ── views captured by a List Snapshot ──
  const viewsSection = (): HTMLElement => {
    const wrap = document.createElement('div');
    wrap.className = 'wb-schema-form';
    const heading = document.createElement('div');
    heading.className = 'wb-data-fieldname';
    heading.textContent = `Views from your list (${state.importedViews.length})`;
    heading.title = 'Captured by the live-extract snippet. A view\'s formatter is the row formatting of THAT view — load one as the main document to edit it.';
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
        load.textContent = 'Load as main document';
        load.title = 'Parse this view\'s row formatting and put it on the canvas (one undo step)';
        load.addEventListener('click', () => {
          try {
            const doc = importJson(view.customFormatter!);
            if (treeHasNames(state.doc.root) && !treeHasNames(doc.root)) {
              if (!confirm(`"${view.title}" has no element names (_elmName), but your current design is named.\n\nLoading it replaces the main document and drops those names from the Structure pane. Load anyway?`)) return;
            }
            state.openMain();
            state.loadDocument(doc);
            onToast(`"${view.title}" loaded as the main document — Ctrl+Z brings the previous design back`);
          } catch (e) {
            onToast(`Couldn't load "${view.title}": ${(e as Error).message}`);
          }
        });
        const copy = document.createElement('button');
        copy.textContent = 'copy';
        copy.title = 'Copy this view\'s raw formatter JSON';
        copy.addEventListener('click', async () => {
          await navigator.clipboard.writeText(view.customFormatter!);
          onToast(`"${view.title}" view formatter JSON copied`);
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

  // ── columnFormatterReference registry ──
  const columnRefsSection = (): HTMLElement => {
    const wrap = document.createElement('div');
    // advanced — but revealed in basic when the view references a column the
    // workspace doesn't have (the tree's "missing" note sends people here)
    const missingRef = [...state.referencedColumns()].some((n) => !(n in state.columnRefs));
    wrap.className = 'wb-schema-form wb-adv' + (missingRef ? ' wb-adv-active' : '');

    const heading = document.createElement('div');
    heading.className = 'wb-data-fieldname';
    heading.textContent = 'Column formatter references';
    heading.title = 'Register a column\'s formatter here and every columnFormatterReference to it renders inline on the canvas (on a real list the column just has to be in the view).';
    wrap.appendChild(heading);

    for (const [name, tree] of Object.entries(state.columnRefs)) {
      const row = document.createElement('div');
      row.className = 'wb-data-toolbar';
      const label = document.createElement('span');
      label.textContent = `[$${name}] → <${tree.elmType}> formatter`;
      label.style.flex = '1';
      const edit = document.createElement('button');
      edit.textContent = state.activeDocKey === name ? 'editing…' : 'edit';
      edit.title = 'Open this column formatter on the canvas (also in the topbar "Editing" switcher)';
      edit.disabled = state.activeDocKey === name;
      edit.addEventListener('click', () => state.openColumnRef(name));
      const copy = document.createElement('button');
      copy.textContent = 'copy';
      copy.title = "Copy this column formatter's JSON for SharePoint's Format pane";
      copy.addEventListener('click', async () => {
        const json = exportJson({ kind: 'column', root: state.activeDocKey === name ? state.doc.root : tree }, { sanitizeWhitespace: true });
        await navigator.clipboard.writeText(json);
        onToast(`[$${name}] formatter JSON copied`);
      });
      const del = document.createElement('button');
      del.textContent = 'remove';
      del.title = 'Remove this formatter from the workspace (asks first)';
      del.addEventListener('click', () => {
        if (!confirm(`Remove [$${name}] from the workspace?\n\nIts formatter JSON will be gone unless it's saved in a project file. CFRs to it will show a placeholder chip again.`)) return;
        if (state.activeDocKey === name) state.openMain();
        delete state.columnRefs[name];
        state.emit('data');
      });
      row.append(label, edit, copy, del);
      wrap.appendChild(row);
    }

    const name = document.createElement('input');
    name.placeholder = 'Column name (e.g. StatusUI)';
    const json = document.createElement('textarea');
    json.rows = 3;
    json.placeholder = "Paste that column's formatter JSON";
    const add = document.createElement('button');
    add.textContent = 'Register reference';
    add.addEventListener('click', () => {
      const n = name.value.trim().replace(/^\[\$?/, '').replace(/\]$/, '');
      if (!n) { onToast('Give the reference a column name first.'); return; }
      try {
        const doc = importSchemaJsonToTree(json.value);
        state.columnRefs[n] = doc;
        name.value = ''; json.value = '';
        state.emit('data');
        onToast(`Registered [$${n}] — CFRs to it now render on the canvas`);
      } catch (e) {
        onToast(`Couldn't parse formatter: ${(e as Error).message}`);
      }
    });
    wrap.append(name, json, add);
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

    const applySchema = (raw: string): void => {
      // grid-first behaviour and teaching toasts live in the shared helper;
      // the form just closes itself on a successful import.
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
      await navigator.clipboard.writeText(buildExtractSnippet());
      toast('Extract snippet copied — run it in the console (F12) on your list page, then paste the snapshot it captures below');
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

  state.subscribe((reason) => {
    if (reason === 'data' || reason === 'load') render();
  });
  render();
}
