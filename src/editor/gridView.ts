/**
 * editor/gridView.ts — The grid-first workspace canvas context (kind 'grid').
 *
 * Renders the document as a Microsoft-Lists-style grid: one column per root
 * child, real column headers, each cell rendered with the column's current
 * formatter (CFR cells resolve from the registry). Header interactions are
 * the on-ramp to row formatting:
 *   · click a header        → per-column menu (format / style / copy / hide)
 *   · drag header L/R edges → reorder columns
 *   · drop ONTO a header    → group both columns into row-formatter
 *                             scaffolding ("Status + DueDate group")
 * Every grid mutation maps to ONE undoable document mutation (state methods
 * moveNodeTo/groupNodes/unwrapNode/insertNode/removeNode).
 */

import { state } from './state';
import { renderElement, type RenderOptions } from '../core/renderer';
import { parseForEach, evaluateForEachList, type EvalContext, type SPValue } from '../core/expressions';
import { exportJson } from '../core/serializer';
import { openElementPlayground } from './playground';
import { openCondFormat } from './condFormat';
import { openFormatCells } from './formatCells';
import { openMenu, closeMenu, openRenamePopover, type MenuItem } from './menu';
import {
  gridCellForField, defaultColumnFormatter, gridColumnField, gridColumnLabel,
  groupName, unplacedFields, fieldLabel,
} from './gridScaffold';
import { cfrBlastRadius } from './cfr';
import {
  subtypesForType, bakeSubtype, coerceKnob, knobError, saveSubtype, deleteSubtype,
  subtypeFromColumn, isBuiltinSubtype, extractLiterals, promoteLiteral, demoteLiteral,
  isPromoted, forkSubtype,
} from './subtypes';
import { paletteItemById } from './palette';
import { createOverlay } from './overlay';
import { FIELD_TYPE_OPTIONS } from '../core/schemaImport';
import { cfrFieldName } from '../core/refs';
import type { SPElement, NodePath, MockField, Subtype, Knob, KnobType } from '../core/types';

interface GridDeps {
  opts: RenderOptions;
  ctxForRow: (rowIndex: number) => EvalContext;
  onToast: (msg: string) => void;
}

interface GridColumn {
  el: SPElement;
  path: NodePath;
}

// ─── per-column actions ──────────────────────────────────────────────────────

/** "Format this column": register a starter formatter (if none), make the
 *  grid cell render it via CFR (ONE document mutation), then open it. */
function formatColumn(col: GridColumn, field: MockField, onToast: (m: string) => void): void {
  const name = field.name;
  const existed = name in state.columnRefs;
  if (!existed) state.columnRefs[name] = defaultColumnFormatter(field);
  if (!col.el.columnFormatterReference && col.path.length > 0) {
    const p = state.parentOf(col.path);
    if (p?.parent.children) {
      state.mutateDocument(() => {
        const cell = gridCellForField(field, state.columnRefs);
        if (col.el._elmName) cell._elmName = col.el._elmName;
        p.parent.children![p.index] = cell;
      });
    }
  }
  state.openColumnRef(name);
  onToast(existed
    ? `Editing the ${name} style — switch back via the topbar or Structure pane`
    : `Started a formatter for ${name} — you're editing it now; the grid renders it live`);
}

/** Register `tree` as the column's formatter, CFR-wire the grid cell (ONE
 *  document mutation), then open it for editing. Shared by every "Format this
 *  column" path — the manual default and each preset. */
function applyColumnFormatter(col: GridColumn, field: MockField, tree: SPElement, onToast: (m: string) => void, msg: string): void {
  state.columnRefs[field.name] = tree;
  if (!col.el.columnFormatterReference && col.path.length > 0) {
    const p = state.parentOf(col.path);
    if (p?.parent.children) {
      state.mutateDocument(() => {
        const cell = gridCellForField(field, state.columnRefs);
        if (col.el._elmName) cell._elmName = col.el._elmName;
        p.parent.children![p.index] = cell;
      });
    }
  }
  state.openColumnRef(field.name);
  onToast(msg);
}

/** Icon for a subtype entry: the palette icon for a preset-derived seed, else a
 *  sensible fallback (Money / a star for a maker's custom). */
function subtypeIcon(st: Subtype): string {
  return paletteItemById(st.id)?.icon ?? (st.id === 'money' ? 'AllCurrency' : 'Tag');
}

/** Bake `args` into the subtype and snapshot-apply it to the column, staying on
 *  the grid (so the cell renders it and a single Ctrl+Z reverts). */
function commitSubtype(col: GridColumn, field: MockField, st: Subtype, args: Record<string, string | number | boolean>, onToast: (m: string) => void): void {
  const baked = bakeSubtype(st, args);
  baked._elmName = `${fieldLabel(field)} — ${st.name}`;
  state.applyColumnSubtype(field.name, baked, st.id, args, col.path);
  onToast(`Applied ${st.name} to ${field.name} — the grid renders it. Ctrl+Z to undo.`);
}

/** Pick a subtype: zero-knob applies in one click; a knob-bearing subtype opens
 *  the apply-time form first. */
function applySubtype(col: GridColumn, field: MockField, st: Subtype, onToast: (m: string) => void): void {
  if (st.knobs.length === 0) { commitSubtype(col, field, st, {}, onToast); return; }
  openKnobForm(col, field, st, onToast);
}

// ─── Refine modal (custom subtype editor) ────────────────────────────────────

const KNOB_TYPES: KnobType[] = ['text', 'number', 'bool', 'color', 'choice'];
const elc = (tag: string, cls: string, text?: string): HTMLElement => {
  const e = document.createElement(tag);
  e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

/** A removable-chip editor over a string list (vocab refs / values), click-safe. */
function chipEditor(values: string[], placeholder: string, onChange: (next: string[]) => void): HTMLElement {
  const wrap = elc('div', 'wb-refine-chips');
  const render = (): void => {
    wrap.innerHTML = '';
    for (const v of values) {
      const chip = elc('span', 'wb-refine-chip');
      chip.textContent = v;
      const x = elc('button', 'wb-refine-chip-x', '×');
      x.title = `Remove ${v}`;
      x.addEventListener('click', () => { values = values.filter((u) => u !== v); onChange([...values]); render(); });
      chip.appendChild(x);
      wrap.appendChild(chip);
    }
    const input = document.createElement('input');
    input.className = 'wb-refine-chip-add';
    input.placeholder = placeholder;
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const v = input.value.trim();
      if (v && !values.includes(v)) { values = [...values, v]; onChange([...values]); render(); }
    });
    wrap.appendChild(input);
  };
  render();
  return wrap;
}

/**
 * The refine modal: edit a CUSTOM subtype in place (rename, baseTypes, vocab,
 * delete, fork) and promote/demote its literals to typed knobs via a checklist
 * — all click-only (no raw JSON). Edits persist to wb-subtypes on Save and do
 * NOT touch columns already using the subtype (their formatter was baked at
 * apply time; US-7 push is the opt-in way to propagate).
 */
function openRefineModal(subtype: Subtype, onToast: (m: string) => void): void {
  let working: Subtype = JSON.parse(JSON.stringify(subtype)) as Subtype;
  const handle = createOverlay('wb-refine-overlay', () => handle.close());
  const panel = elc('div', 'wb-refine');
  handle.overlay.appendChild(panel);

  const head = elc('div', 'wb-refine-head');
  head.append(elc('span', 'wb-refine-title', `Refine ${subtype.name}`),
    elc('span', 'wb-refine-sub', 'Edits save to your library; columns already using it are unchanged.'));
  panel.appendChild(head);

  // — rename —
  const nameRow = elc('label', 'wb-refine-row');
  nameRow.appendChild(elc('span', 'wb-refine-rowlab', 'Name'));
  const nameInput = document.createElement('input');
  nameInput.className = 'wb-refine-name';
  nameInput.value = working.name;
  nameInput.addEventListener('input', () => { working.name = nameInput.value; });
  nameRow.appendChild(nameInput);
  panel.appendChild(nameRow);

  // — base types —
  const typesRow = elc('div', 'wb-refine-row');
  typesRow.appendChild(elc('span', 'wb-refine-rowlab', 'Fits column types'));
  const typesWrap = elc('div', 'wb-refine-types');
  for (const opt of FIELD_TYPE_OPTIONS) {
    const lab = elc('label', 'wb-refine-type');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.dataset.basetype = opt.value;
    cb.checked = working.baseTypes.includes(opt.value);
    cb.addEventListener('change', () => {
      if (cb.checked) working.baseTypes = [...new Set([...working.baseTypes, opt.value])];
      else if (working.baseTypes.length > 1) working.baseTypes = working.baseTypes.filter((t) => t !== opt.value);
      else { cb.checked = true; onToast('A subtype must fit at least one column type.'); } // refuse the empty set
    });
    lab.append(cb, document.createTextNode(' ' + opt.label));
    typesWrap.appendChild(lab);
  }
  typesRow.appendChild(typesWrap);
  panel.appendChild(typesRow);

  // — vocab —
  const vocabRow = elc('div', 'wb-refine-row');
  vocabRow.appendChild(elc('span', 'wb-refine-rowlab', 'fx-bar vocabulary'));
  const vocabBody = elc('div', 'wb-refine-vocab');
  vocabBody.append(elc('span', 'wb-refine-sublab', 'References'),
    chipEditor(working.vocab.refs, 'add a reference…', (next) => { working.vocab = { ...working.vocab, refs: next }; }),
    elc('span', 'wb-refine-sublab', 'Values'),
    chipEditor(working.vocab.values, 'add a value…', (next) => { working.vocab = { ...working.vocab, values: next }; }));
  vocabRow.appendChild(vocabBody);
  panel.appendChild(vocabRow);

  // — extracted-literals checklist (promote/demote to knobs, by value) —
  const litRow = elc('div', 'wb-refine-row');
  litRow.appendChild(elc('span', 'wb-refine-rowlab', 'Parameters (knobs)'));
  const litBody = elc('div', 'wb-refine-lits');
  litRow.appendChild(litBody);
  panel.appendChild(litRow);

  const candidates = extractLiterals(working.formatter);
  if (candidates.length === 0) {
    litBody.appendChild(elc('span', 'wb-refine-sublab', 'No literals to parameterize.'));
  }
  for (const cand of candidates) {
    const row = elc('div', 'wb-refine-lit');
    row.dataset.lit = cand.value;
    const existing = working.knobs.find((k) => k.path === cand.value);
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'wb-refine-lit-cb';
    cb.checked = isPromoted(working, cand.value);
    const valLab = elc('span', 'wb-refine-lit-val', cand.value);

    // the knob editor is always present; shown only while the literal is promoted
    const editor = elc('div', 'wb-refine-knob');
    const lblIn = document.createElement('input');
    lblIn.className = 'wb-refine-knob-label';
    lblIn.placeholder = 'label';
    lblIn.value = existing ? existing.label : defaultKnobLabel(cand.value);
    const typeSel = document.createElement('select');
    typeSel.className = 'wb-refine-knob-type';
    // the refine modal can't author a choice list, so 'choice' is only offered
    // for a knob that already has one (preserving it); a plain literal can't
    // become an unusable choice knob (refuse-don't-guess)
    for (const t of KNOB_TYPES) {
      if (t === 'choice' && existing?.type !== 'choice') continue;
      const o = document.createElement('option'); o.value = t; o.textContent = t; typeSel.appendChild(o);
    }
    typeSel.value = existing ? existing.type : cand.suggestedType;
    const defIn = document.createElement('input');
    defIn.className = 'wb-refine-knob-default';
    defIn.placeholder = 'default';
    defIn.value = String(existing ? existing.default : cand.value);
    editor.append(lblIn, typeSel, defIn);
    editor.hidden = !existing;

    // match the apply-time coercion (coerceKnob): a blank number is NaN, not 0,
    // so it is refused at Save/Push rather than silently baked as zero
    const coerceDefault = (type: KnobType, raw: string): string | number | boolean =>
      type === 'number' ? (raw.trim() === '' ? NaN : Number(raw)) : type === 'bool' ? raw === 'true' : raw;
    const sync = (): void => {
      const type = typeSel.value as KnobType;
      working = promoteLiteral(working, cand.value, {
        label: lblIn.value || cand.value,
        type,
        default: coerceDefault(type, defIn.value),
        ...(type === 'choice' && existing?.choices ? { choices: existing.choices } : {}), // never drop a choice knob's options
      });
    };
    defIn.addEventListener('input', () => { if (cb.checked) sync(); });
    cb.addEventListener('change', () => {
      if (cb.checked) { sync(); editor.hidden = false; }
      else { working = demoteLiteral(working, cand.value); editor.hidden = true; }
    });
    lblIn.addEventListener('input', () => { if (cb.checked) sync(); });
    typeSel.addEventListener('change', () => { if (cb.checked) sync(); });

    row.append(cb, valLab, editor);
    litBody.appendChild(row);
  }

  // refuse-and-teach before persisting: a name + every knob default must be
  // valid (same rules as the apply-time form). Returns true when OK to save.
  const validate = (): boolean => {
    if (!working.name.trim()) { onToast('A subtype needs a name.'); return false; }
    for (const k of working.knobs) {
      const err = knobError(k, k.default);
      if (err) { onToast(err); return false; }
    }
    return true;
  };

  // — footer —
  const foot = elc('div', 'wb-refine-foot');
  const del = elc('button', 'wb-refine-delete', 'Delete');
  del.addEventListener('click', () => { deleteSubtype(working.id); handle.close(); onToast(`Deleted "${subtype.name}".`); });
  const fork = elc('button', 'wb-refine-fork', 'Fork');
  fork.addEventListener('click', () => { if (!validate()) return; const f = forkSubtype(working); saveSubtype(f); handle.close(); onToast(`Forked into "${f.name}".`); });
  const spacer = elc('div', 'wb-refine-foot-spacer');
  const cancel = elc('button', 'wb-refine-cancel', 'Cancel');
  cancel.addEventListener('click', () => handle.close());
  const save = elc('button', 'wb-refine-save', 'Save');
  save.addEventListener('click', () => {
    if (!validate()) return;
    saveSubtype(working);
    handle.close();
    onToast(`Saved "${working.name}".`);
  });
  foot.append(del, fork, spacer, cancel, save);

  // — opt-in push-update (US-7): re-bake the columns already using this —
  const usingCount = state.columnsUsingSubtype(subtype.id).length;
  if (usingCount > 0) {
    const n = usingCount;
    const push = elc('button', 'wb-refine-push', `Save & update ${n} column${n > 1 ? 's' : ''}`);
    push.title = `Save, then re-bake the ${n} column${n > 1 ? 's' : ''} already using ${subtype.name} from their saved settings (overwrites hand-edits). One Ctrl+Z reverts all.`;
    push.addEventListener('click', () => {
      if (!validate()) return;
      saveSubtype(working);
      const pushed = state.pushSubtypeUpdate(working.id, (args) => bakeSubtype(working, args));
      handle.close();
      onToast(`Saved and updated ${pushed} column${pushed > 1 ? 's' : ''} using "${working.name}". Ctrl+Z reverts all.`);
    });
    foot.append(push);
  }
  panel.appendChild(foot);

  document.body.appendChild(handle.overlay);
  nameInput.focus();
}

/** A friendly default knob label from a literal (e.g. "#107c10" → "Color"). */
function defaultKnobLabel(value: string): string {
  if (/^#|^(rgb|hsl)/.test(value)) return 'Color';
  if (/^-?\d/.test(value)) return 'Number';
  return value.length <= 20 ? value : 'Value';
}

/** Save the column's current formatter as a reusable custom subtype (Save-as
 *  birth): opens an inline popover for the name (no browser prompt), derives
 *  the vocab, records the built-in it forks from (if any), and persists to
 *  wb-subtypes — it then shows as "Yours". */
function saveAsSubtype(field: MockField, header: HTMLElement, onToast: (m: string) => void): void {
  const formatter = state.columnRefs[field.name];
  if (!formatter) { onToast('Format this column first, then save it as a reusable subtype.'); return; }
  const r = header.getBoundingClientRect();
  openRenamePopover(
    { x: r.left, y: r.bottom + 4 },
    'Save as reusable subtype',
    `${fieldLabel(field)} style`,
    (name) => {
      const trimmed = name.trim();
      if (!trimmed) { onToast('A subtype needs a name.'); return; }
      const forkedFrom = field.subtype && isBuiltinSubtype(field.subtype) ? field.subtype : undefined;
      saveSubtype(subtypeFromColumn({ name: trimmed, formatter, field, forkedFrom }));
      onToast(`Saved "${trimmed}" as a reusable subtype (Yours) — it's in the Format menu for ${field.type} columns.`);
    },
  );
}

/** One typed widget for a knob, pre-filled with its default; returns a reader. */
function knobWidget(knob: Knob): { el: HTMLElement; read: () => string | boolean } {
  if (knob.type === 'bool') {
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.dataset.knob = knob.label;
    cb.checked = knob.default === true || knob.default === 'true';
    return { el: cb, read: () => cb.checked };
  }
  if (knob.type === 'choice') {
    const sel = document.createElement('select');
    sel.dataset.knob = knob.label;
    for (const c of knob.choices ?? []) {
      const o = document.createElement('option');
      o.value = c; o.textContent = c;
      if (String(knob.default) === c) o.selected = true;
      sel.appendChild(o);
    }
    return { el: sel, read: () => sel.value };
  }
  const inp = document.createElement('input');
  inp.type = knob.type === 'number' ? 'number' : knob.type === 'color' ? 'color' : 'text';
  inp.dataset.knob = knob.label;
  inp.value = String(knob.default);
  return { el: inp, read: () => inp.value };
}

/** The apply-time knob form: a dialog of typed widgets, refuse-and-teach
 *  validation (nothing bakes until valid), Apply = one undoable mutation. */
function openKnobForm(col: GridColumn, field: MockField, st: Subtype, onToast: (m: string) => void): void {
  const handle = createOverlay('wb-knobform-overlay', () => handle.close());
  const panel = document.createElement('div');
  panel.className = 'wb-knobform';
  handle.overlay.appendChild(panel);

  const head = document.createElement('div');
  head.className = 'wb-knobform-head';
  const title = document.createElement('span');
  title.className = 'wb-knobform-title';
  title.textContent = `Set up ${st.name} for ${fieldLabel(field)}`;
  const sub = document.createElement('span');
  sub.className = 'wb-knobform-sub';
  sub.textContent = 'Nothing changes until you Apply (then Ctrl+Z undoes).';
  head.append(title, sub);
  panel.appendChild(head);

  const rows: Array<{ knob: Knob; read: () => string | boolean; err: HTMLElement }> = [];
  for (const knob of st.knobs) {
    const row = document.createElement('label');
    row.className = 'wb-knobform-row';
    const lab = document.createElement('span');
    lab.className = 'wb-knobform-label';
    lab.textContent = knob.label;
    const widget = knobWidget(knob);
    const err = document.createElement('span');
    err.className = 'wb-knobform-err';
    row.append(lab, widget.el, err);
    panel.appendChild(row);
    rows.push({ knob, read: widget.read, err });
  }

  const foot = document.createElement('div');
  foot.className = 'wb-knobform-foot';
  const cancel = document.createElement('button');
  cancel.className = 'wb-knobform-cancel';
  cancel.textContent = 'Cancel';
  cancel.addEventListener('click', () => handle.close());
  const apply = document.createElement('button');
  apply.className = 'wb-knobform-apply';
  apply.textContent = 'Apply';
  apply.addEventListener('click', () => {
    const args: Record<string, string | number | boolean> = {};
    let ok = true;
    for (const { knob, read, err } of rows) {
      const value = coerceKnob(knob, read());
      const msg = knobError(knob, value);
      err.textContent = msg ?? '';
      if (msg) { ok = false; continue; }
      args[knob.path] = value; // key by the STABLE literal path, not the editable label
    }
    if (!ok) return; // refuse-and-teach: nothing bakes until every knob is valid
    handle.close();
    commitSubtype(col, field, st, args, onToast);
  });
  foot.append(cancel, apply);
  panel.appendChild(foot);

  document.body.appendChild(handle.overlay);
  (panel.querySelector('input, select') as HTMLElement | null)?.focus();
}

/** "Format this column" → the type-filtered subtype catalog (built-in seeds +
 *  the maker's customs, badged), then "format manually". Subtypes whose
 *  baseTypes exclude this column never appear; with none fitting, go straight to
 *  the manual blank formatter. */
function openFormatColumnMenu(col: GridColumn, field: MockField, header: HTMLElement, onToast: (m: string) => void): void {
  const catalog = subtypesForType(field.type);
  const manual = (): void => applyColumnFormatter(col, field, defaultColumnFormatter(field), onToast,
    `Started a formatter for ${field.name} — you're editing it now; the grid renders it live`);
  if (catalog.length === 0) { manual(); return; }
  const items: MenuItem[] = catalog.map((st) => ({
    icon: subtypeIcon(st),
    label: st.name,
    badge: st.origin === 'builtin' ? 'Built-in' : 'Yours',
    title: st.origin === 'builtin'
      ? `Apply the built-in ${st.name} look to ${field.name}`
      : `Apply your saved ${st.name} subtype to ${field.name}`,
    // only a maker's own subtypes can be refined (a built-in is forked, not edited)
    ...(st.origin === 'custom'
      ? { action: { icon: 'More', title: `Refine ${st.name}…`, fn: () => openRefineModal(st, onToast) } }
      : {}),
    fn: () => applySubtype(col, field, st, onToast),
  }));
  items.push({
    icon: 'Brush',
    label: 'Format this column manually',
    title: 'Start from the plain value and style it yourself',
    fn: manual,
  });
  openMenu(header, `Format ${fieldLabel(field)}`, items);
}

/** Resolve a field to its placed grid column in the active main grid, or a
 *  synthetic unplaced column (path []), so callers outside the grid (the
 *  Column Formatters menu) can reuse the header's Format-this-column flow for
 *  any field. An unplaced field's path-[] column makes applyColumnFormatter
 *  register + open without a grid mutation (the spec's "unplaced" branch). */
export function gridColumnForField(field: MockField): GridColumn {
  if (state.activeDocKey === 'main' && state.doc.kind === 'grid') {
    const children = state.doc.root.children ?? [];
    const i = children.findIndex((c) => gridColumnField(c) === field.name);
    if (i >= 0) return { el: children[i], path: [i] };
  }
  return { el: { elmType: 'div' }, path: [] };
}

/** Open the type-aware "Format this column" menu for a field that may be
 *  placed in the grid or only registered in the schema — the Column Formatters
 *  menu's "Not yet formatted" entry point. */
export function openColumnFormatMenuFor(field: MockField, anchor: HTMLElement, onToast: (m: string) => void): void {
  openFormatColumnMenu(gridColumnForField(field), field, anchor, onToast);
}

async function copyColumnJson(col: GridColumn, fieldName: string | null, onToast: (m: string) => void): Promise<void> {
  const registered = fieldName ? state.columnRefs[fieldName] : undefined;
  const root = registered ?? col.el;
  const json = exportJson({ kind: 'column', root }, { sanitizeWhitespace: true });
  try {
    await navigator.clipboard.writeText(json);
    onToast(registered
      ? `[$${fieldName}] formatter JSON copied — paste into that column's Format pane`
      : 'Column JSON copied (this cell as a column-formatter starting point)');
  } catch {
    onToast('Copy failed — clipboard access blocked (select the text and use Ctrl/Cmd+C)');
  }
}

function menuFor(col: GridColumn, header: HTMLElement, onToast: (m: string) => void): void {
  const fieldName = gridColumnField(col.el);
  const field = fieldName ? state.fields.find((f) => f.name === fieldName) : undefined;
  const label = gridColumnLabel(col.el, state.fields);
  const isGroup = !field && (col.el.children?.length ?? 0) > 0;
  const items: MenuItem[] = [];

  if (field) {
    const registered = field.name in state.columnRefs;
    const isLinked = !!col.el.columnFormatterReference;
    if (isLinked) {
      // a linked instance of the column's shared style (the Figma model):
      // edit the shared style for everyone, or detach a local copy into this view.
      const blast = cfrBlastRadius(field.name, state.doc.root, state.columnRefs);
      items.push({
        icon: 'Brush',
        label: `Edit the ${field.name} style`,
        badge: '§ shared',
        title: blast.count > 1
          ? `Edit the shared ${field.name} style — changes all ${blast.count} places it's used (${blast.places.join(', ')})`
          : `Edit the shared ${field.name} style — changes apply everywhere it's used`,
        fn: () => formatColumn(col, field, onToast),
      });
      items.push({
        icon: 'BranchFork2',
        label: 'Detach from style',
        title: `Format just this cell — a local copy that lives only in this view; the ${field.name} style everywhere else is untouched`,
        fn: () => { state.forkCfr(col.path); onToast(`"${label}" is detached from the ${field.name} style — edits stay in this view. Ctrl+Z to relink.`); },
      });
    } else if (registered) {
      items.push({
        icon: 'Edit',
        label: `Edit the ${field.name} style`,
        title: `Open the ${field.name} column style on the canvas`,
        fn: () => formatColumn(col, field, onToast),
      });
    } else {
      items.push({
        icon: 'Brush',
        label: 'Format this column',
        title: 'Pick a ready-made look that fits this column — or format it manually',
        fn: () => openFormatColumnMenu(col, field, header, onToast),
      });
      items.push({
        icon: 'Link',
        label: `Save as the ${field.name} column style`,
        title: `Register this cell's design as the ${field.name} column style and link this cell to it — reuse it anywhere via "+ column" or a reference`,
        fn: () => {
          const f = state.promoteToColumn(col.path);
          onToast(f
            ? `Saved as the ${f} column style — this cell now uses it. Ctrl+Z to undo.`
            : 'Could not save this cell as a column style.');
        },
      });
    }
    if (registered) {
      items.push({
        icon: 'Save',
        label: 'Save as reusable subtype…',
        title: `Save ${fieldLabel(field)}'s current format as a reusable subtype you can apply to other ${field.type} columns`,
        fn: () => saveAsSubtype(field, header, onToast),
      });
    }
    items.push({
      icon: 'LightningBolt',
      label: 'Conditional formatting…',
      title: `Color ${fieldLabel(field)} by its value — pick conditions and looks, see them on your rows, apply in one click`,
      fn: () => openCondFormat({ kind: 'column', fieldName: field.name, cellPath: col.path }, onToast),
    });
  }
  items.push({
    icon: 'Font',
    label: 'Format cells…',
    title: 'Font, borders, fill and alignment — the comfortable dialog; applies to every row of this column',
    fn: () => {
      state.select(col.path);
      openFormatCells(col.path, onToast);
    },
  });
  items.push({
    icon: 'Color',
    label: isGroup ? 'Style this group' : 'Style this cell',
    title: 'Open the style playground on this element — consequence-free until you Apply',
    fn: () => {
      state.select(col.path);
      openElementPlayground(col.path);
    },
  });
  if (isGroup && col.path.length > 0) {
    items.push({
      icon: 'Separator',
      label: 'Ungroup',
      title: 'Dissolve the group — its columns return to the grid (one undo step)',
      fn: () => {
        state.unwrapNode(col.path);
        onToast(`"${label}" ungrouped — Ctrl+Z to regroup`);
      },
    });
  }
  items.push({
    icon: 'Copy',
    label: 'Copy column JSON',
    fn: () => copyColumnJson(col, field?.name ?? null, onToast),
  });
  if (col.path.length > 0) {
    items.push({
      icon: 'Hide',
      label: 'Hide column',
      title: 'Remove this column from the layout — undo with Ctrl+Z, or re-add it via "+ column"',
      fn: () => {
        state.removeNode(col.path);
        onToast(`${label} hidden — Ctrl+Z to undo, or "+ column" to bring it back`);
      },
    });
  }
  openMenu(header, label, items);
}

// ─── drag: reorder (edges) / group (drop onto) ───────────────────────────────

const GRID_MIME = 'application/x-wb-grid-col';
let dragSourceIndex: number | null = null;

// Transient multi-selection of top-level grid columns — the "select columns →
// make a row view" build affordance. Never persisted, never undoable: it's a
// gesture in progress, not document state. Ctrl/Cmd-click a header to toggle.
const gridSel = new Set<number>();

type DropZone = 'before' | 'after' | 'onto';

function zoneFor(e: DragEvent, target: HTMLElement): DropZone {
  const r = target.getBoundingClientRect();
  const x = (e.clientX - r.left) / Math.max(1, r.width);
  return x < 0.25 ? 'before' : x > 0.75 ? 'after' : 'onto';
}

function clearDropMarks(host: HTMLElement): void {
  host.querySelectorAll('.wb-grid-drop-before, .wb-grid-drop-after, .wb-grid-drop-onto')
    .forEach((n) => n.classList.remove('wb-grid-drop-before', 'wb-grid-drop-after', 'wb-grid-drop-onto'));
}

function applyDrop(zone: DropZone, from: number, to: number, cols: GridColumn[], onToast: (m: string) => void): void {
  if (zone === 'onto') {
    const name = groupName(
      gridColumnLabel(cols[to].el, state.fields),
      gridColumnLabel(cols[from].el, state.fields),
    );
    state.groupNodes(cols[from].path, cols[to].path, name);
    onToast(`Grouped into "${name}" — that's row-formatter structure now (one undo step). Use its header menu or the alignment editor to shape it.`);
  } else {
    state.moveNodeTo(cols[from].path, zone === 'before' ? to : to + 1);
  }
}

// ─── render ──────────────────────────────────────────────────────────────────

export function renderGrid(host: HTMLElement, deps: GridDeps): void {
  closeMenu();
  const { opts, ctxForRow, onToast } = deps;
  const root = state.doc.root;
  const cols: GridColumn[] = root.children?.length
    ? root.children.map((el, i) => ({ el, path: [i] }))
    : [{ el: root, path: [] as NodePath }];
  const unplaced = root.children?.length ? unplacedFields(root, state.fields) : [];

  const grid = document.createElement('div');
  grid.className = 'wb-grid';
  const template = `repeat(${cols.length}, minmax(140px, 1fr))${unplaced.length ? ' 88px' : ''}`;
  grid.style.setProperty('--wb-grid-cols', template);

  // ── multi-select + "make a row view" bar ──────────────────────────────────
  // drop any selection that points past the current columns (e.g. after a hide)
  for (const i of [...gridSel]) if (i >= cols.length) gridSel.delete(i);

  const applySelClasses = (): void => {
    grid.querySelectorAll('.wb-grid-col-selected')
      .forEach((n) => n.classList.remove('wb-grid-col-selected'));
    gridSel.forEach((i) => {
      grid.querySelectorAll(`.wb-grid-header[data-col="${i}"], .wb-grid-cell[data-col="${i}"]`)
        .forEach((n) => n.classList.add('wb-grid-col-selected'));
    });
  };

  const bar = document.createElement('div');
  bar.className = 'wb-areas-bar';
  const refreshBar = (): void => {
    bar.innerHTML = '';
    const n = gridSel.size;
    bar.hidden = n === 0;
    if (n === 0) return;
    const count = document.createElement('span');
    count.className = 'wb-areas-bar-count';
    count.textContent = `${n} column${n > 1 ? 's' : ''} selected →`;
    bar.appendChild(count);
    const graduate = (kind: 'row' | 'tile', text: string, title: string): void => {
      const b = document.createElement('button');
      b.className = 'wb-areas-bar-btn';
      b.textContent = text;
      b.title = title;
      b.addEventListener('click', () => {
        const sel = [...gridSel].sort((a, b2) => a - b2);
        gridSel.clear();
        state.makeRowView(sel, kind);
        onToast(kind === 'row'
          ? `Made a row view from ${sel.length} column${sel.length > 1 ? 's' : ''} — they're areas now. Resize one from its right-click menu, set density in the toolbar, or go back to the grid.`
          : `Made a tile layout from ${sel.length} column${sel.length > 1 ? 's' : ''} — tile is an explicit layout choice. Set its size in the studio's Properties pane.`);
      });
      bar.appendChild(b);
    };
    graduate('row', '▤ Make a row view',
      'Turn the selected columns into a stacked row layout — each becomes a sizeable area (one undo step)');
    graduate('tile', '▦ Make a tile',
      'Turn the selected columns into a gallery tile — an explicit layout choice (it can never emerge on its own)');
    const clear = document.createElement('button');
    clear.className = 'wb-areas-bar-btn wb-areas-bar-clear';
    clear.textContent = 'Clear';
    clear.title = 'Deselect these columns';
    clear.addEventListener('click', () => clearGridSel());
    bar.appendChild(clear);
  };
  function toggleGridSel(i: number): void {
    if (gridSel.has(i)) gridSel.delete(i); else gridSel.add(i);
    applySelClasses();
    refreshBar();
  }
  function clearGridSel(): void {
    if (gridSel.size === 0) return;
    gridSel.clear();
    applySelClasses();
    refreshBar();
  }

  // header row
  const headrow = document.createElement('div');
  headrow.className = 'wb-grid-headrow';
  cols.forEach((col, i) => {
    const h = document.createElement('div');
    h.className = 'wb-grid-header';
    h.dataset.col = String(i);
    h.tabIndex = 0;
    h.setAttribute('role', 'button');
    h.setAttribute('aria-haspopup', 'menu');
    h.title = 'Click for column actions · drag left/right to reorder · drop onto another column to group them';
    const label = document.createElement('span');
    label.className = 'wb-grid-header-label';
    label.textContent = gridColumnLabel(col.el, state.fields);
    h.append(label);
    // § style mark: this column is a LINKED INSTANCE of a shared column format
    if (col.el.columnFormatterReference) {
      const linkField = cfrFieldName(col.el.columnFormatterReference);
      const blast = cfrBlastRadius(linkField, state.doc.root, state.columnRefs);
      const badge = document.createElement('span');
      badge.className = 'wb-cfr-link wb-style-mark';
      badge.textContent = '§';
      badge.setAttribute('aria-hidden', 'true');
      badge.title = blast.count > 1
        ? `Uses the ${linkField} style — shared with ${blast.count} places. "Edit the ${linkField} style" changes them all; "Detach from style" makes a copy for this view.`
        : `Uses the ${linkField} style. "Edit the ${linkField} style" changes the shared style; "Detach from style" makes a copy for this view.`;
      h.append(badge);
    }
    const caret = document.createElement('span');
    caret.className = 'wb-grid-header-caret';
    caret.textContent = '⌄';
    h.append(caret);

    h.addEventListener('click', (e) => {
      // Ctrl/Cmd-click multi-selects columns for "make a row view" — no menu
      if ((e.ctrlKey || e.metaKey) && col.path.length > 0) {
        toggleGridSel(i);
        return;
      }
      clearGridSel();
      state.select(col.path);
      menuFor(col, h, onToast);
    });
    // right-click = the same column menu (headers aren't elements, so the
    // canvas-level element context menu doesn't cover them)
    h.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      state.select(col.path);
      menuFor(col, h, onToast);
    });
    h.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        state.select(col.path);
        menuFor(col, h, onToast);
      }
    });

    if (col.path.length > 0) {
      h.draggable = true;
      h.addEventListener('dragstart', (e) => {
        dragSourceIndex = i;
        e.dataTransfer?.setData(GRID_MIME, String(i));
        e.dataTransfer!.effectAllowed = 'move';
      });
      h.addEventListener('dragend', () => {
        dragSourceIndex = null;
        clearDropMarks(host);
      });
      h.addEventListener('dragover', (e) => {
        if (!e.dataTransfer?.types.includes(GRID_MIME)) return;
        if (dragSourceIndex === null || dragSourceIndex === i) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'move';
        const zone = zoneFor(e, h);
        clearDropMarks(host);
        h.classList.add(`wb-grid-drop-${zone}`);
        if (zone === 'onto') {
          grid.querySelectorAll(`.wb-grid-cell[data-col="${i}"]`)
            .forEach((c) => c.classList.add('wb-grid-drop-onto'));
        }
      });
      h.addEventListener('drop', (e) => {
        if (!e.dataTransfer?.types.includes(GRID_MIME)) return;
        e.preventDefault();
        e.stopPropagation();
        const from = Number(e.dataTransfer.getData(GRID_MIME));
        clearDropMarks(host);
        if (!Number.isInteger(from) || from === i) return;
        applyDrop(zoneFor(e, h), from, i, cols, onToast);
      });
    }
    headrow.appendChild(h);
  });

  if (unplaced.length) {
    const add = document.createElement('button');
    add.className = 'wb-grid-addcol';
    add.textContent = '+ column';
    add.title = 'Add a column from your schema to the grid';
    add.addEventListener('click', () => {
      openMenu(add, 'Add a column', unplaced.map((f) => ({
        icon: f.name in state.columnRefs ? 'Brush' : 'TripleColumn',
        label: fieldLabel(f) + (f.name in state.columnRefs ? ' · formatted' : ''),
        fn: () => {
          state.insertNode(gridCellForField(f, state.columnRefs), []);
          onToast(`${fieldLabel(f)} added to the grid${f.name in state.columnRefs ? ' — rendering its formatter' : ''}`);
        },
      })));
    });
    headrow.appendChild(add);
  }
  grid.appendChild(headrow);

  // body: one CSS-grid row per mock row, same column template
  state.rows.forEach((_row, rowIndex) => {
    const rowEl = document.createElement('div');
    rowEl.className = 'wb-grid-row';
    const ctx = ctxForRow(rowIndex);
    cols.forEach((col, i) => {
      const cell = document.createElement('div');
      cell.className = 'wb-grid-cell';
      cell.dataset.col = String(i);
      if (col.el.columnFormatterReference) {
        const linkField = cfrFieldName(col.el.columnFormatterReference);
        const linkDisplay = state.fields.find((f) => f.name === linkField)?.displayName ?? linkField;
        const blast = cfrBlastRadius(linkField, state.doc.root, state.columnRefs);
        cell.classList.add('wb-cell-linked');
        cell.title = `${linkDisplay} style — double-click to edit (used in ${Math.max(blast.count, 1)} place${blast.count === 1 ? '' : 's'})`;
        const tag = document.createElement('span');
        tag.className = 'wb-style-nametag';
        tag.textContent = `${linkDisplay} style`;
        tag.setAttribute('aria-hidden', 'true');
        cell.appendChild(tag);
        cell.addEventListener('dblclick', (e) => {
          e.stopPropagation();
          const field = state.fields.find((f) => f.name === linkField);
          // Drill-in is navigation, never a mutation: only open an already-
          // registered style. formatColumn silently registers a default
          // formatter when the name isn't in state.columnRefs yet — the
          // header menu stays the one explicit creation path, mirroring the
          // tree's inert unregistered stub.
          if (!field || !(field.name in state.columnRefs)) return;
          formatColumn(col, field, onToast);
        });
      }
      try {
        renderCellContent(cell, col, ctx, opts);
      } catch (err) {
        cell.textContent = `⚠ ${(err as Error).message}`;
        cell.classList.add('wb-render-error');
      }
      // a whole column is also a "drop onto" group target
      if (col.path.length > 0) {
        cell.addEventListener('dragover', (e) => {
          if (!e.dataTransfer?.types.includes(GRID_MIME)) return;
          if (dragSourceIndex === null || dragSourceIndex === i) return;
          e.preventDefault();
          e.stopPropagation();
          e.dataTransfer.dropEffect = 'move';
          clearDropMarks(host);
          grid.querySelectorAll(`.wb-grid-header[data-col="${i}"], .wb-grid-cell[data-col="${i}"]`)
            .forEach((c) => c.classList.add('wb-grid-drop-onto'));
        });
        cell.addEventListener('drop', (e) => {
          if (!e.dataTransfer?.types.includes(GRID_MIME)) return;
          e.preventDefault();
          e.stopPropagation();
          const from = Number(e.dataTransfer.getData(GRID_MIME));
          clearDropMarks(host);
          if (!Number.isInteger(from) || from === i) return;
          applyDrop('onto', from, i, cols, onToast);
        });
      }
      rowEl.appendChild(cell);
    });
    grid.appendChild(rowEl);
  });

  if (state.rows.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'wb-grid-empty';
    empty.textContent = 'No mock rows yet — add some in the Data tab to see your columns render.';
    grid.appendChild(empty);
  }

  host.appendChild(bar);
  host.appendChild(grid);
  refreshBar();
  applySelClasses();
}

/** Render one column's element into a cell — honoring a top-level forEach
 *  the way the exported row formatter would (the renderer only expands
 *  forEach on children, and grid columns render directly). */
function renderCellContent(cell: HTMLElement, col: GridColumn, ctx: EvalContext, opts: RenderOptions): void {
  const el = col.el;
  if (el.forEach) {
    const binding = parseForEach(el.forEach);
    if (binding) {
      let list: SPValue[] = [];
      try {
        list = evaluateForEachList(binding.listExpr, ctx);
      } catch (e) {
        opts.issues?.push({ path: col.path, message: `forEach list: ${(e as Error).message}` });
      }
      list.forEach((item, idx) => {
        const childCtx: EvalContext = {
          ...ctx,
          iterators: { ...ctx.iterators, [binding.iterator]: item },
          iteratorIndex: { ...ctx.iteratorIndex, [binding.iterator]: idx },
        };
        cell.appendChild(renderElement(el, childCtx, opts, col.path));
      });
      if (list.length === 0 && opts.tagPaths) {
        const ghost = document.createElement('span');
        ghost.className = 'wb-foreach-empty';
        ghost.dataset.spPath = col.path.join('.');
        ghost.textContent = '∅ forEach';
        ghost.title = `forEach "${el.forEach}" produced 0 items for this row`;
        cell.appendChild(ghost);
      }
      return;
    }
  }
  cell.appendChild(renderElement(el, ctx, opts, col.path));
}
