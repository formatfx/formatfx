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
import { importJson, exportJson } from '../core/serializer';
import { parseThemeJson } from '../core/theme';
import type { CellValue, FieldType, MockField, PersonValue, LookupValue, SPElement } from '../core/types';
import exportScript from '../../tools/Export-ListSchema.ps1?raw';

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
    host.appendChild(columnRefsSection());
    host.appendChild(tenantThemeSection());
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
      try {
        const schema = importSchema(raw);
        state.fields = schema.fields;
        state.rows = schema.rows ?? buildSampleRows(schema.fields, 3);
        if (schema.columnFormatters) {
          Object.assign(state.columnRefs, schema.columnFormatters);
        }
        if (!state.fields.some((f) => f.name === state.currentFieldName)) {
          state.currentFieldName = state.fields.find((f) => !f.protected)?.name ?? state.fields[0].name;
        }
        // grid-first: an untouched grid (every column still column-ish)
        // rebuilds around the imported schema so the user sees THEIR list —
        // imported formatters render as pills etc. immediately. A grid with
        // groups is someone's layout work; never clobber it (one undo step
        // covers the rebuild case anyway).
        if (state.activeDocKey === 'main' && state.doc.kind === 'grid' && isPureGrid(state.doc.root)) {
          state.mutateDocument(() => {
            state.doc.root = buildGridRoot(state.fields, state.columnRefs);
          });
        }
        done();
        state.emit('data');
        const cfCount = Object.keys(schema.columnFormatters ?? {}).length;
        toast(`Imported ${schema.fields.length} fields${schema.listName ? ` from "${schema.listName}"` : ''}${schema.rows ? ` + ${schema.rows.length} rows` : ''}${cfCount ? ` + ${cfCount} live column formatters (registered as references)` : ''}`);
      } catch (e) {
        toast(`Schema import failed: ${(e as Error).message}`);
      }
    };

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
    form.append(fileBtn, text, row, help);
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
