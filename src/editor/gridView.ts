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
import { cfrBlastRadius, toColumnFormatter } from './cfr';
import { bindComponentInstance, isSingleColumnComponent } from './components';
import { customComponents, openSaveColumnAsComponent } from './componentLibrary';
import {
  subtypesForType, bakeSubtype, coerceKnob, knobError,
} from './subtypes';
import { paletteItemById } from './palette';
import { createOverlay } from './overlay';
import { groupForField, GROUP_COLORS, type ColumnGroup } from './colGroups';
import { cfrFieldName } from '../core/refs';
import type { SPElement, NodePath, MockField, Subtype, Knob } from '../core/types';

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

/** The tab-group pill menu: collapse/expand, rename, recolor, ungroup — every
 *  action is project metadata (the renameView rule: off the undo stack,
 *  autosaved; the floor document is never touched). */
function groupMenu(group: ColumnGroup, anchor: HTMLElement, onToast: (m: string) => void): void {
  const r = anchor.getBoundingClientRect();
  openMenu(anchor, `${group.name} — column group`, [
    {
      icon: group.collapsed ? 'ChevronDown' : 'ChevronUp',
      label: group.collapsed ? 'Expand' : 'Collapse',
      title: 'Collapsed columns wait intact — nothing leaves the document',
      fn: () => {
        const collapsing = !group.collapsed;
        state.toggleGroupCollapsed(group.id);
        onToast(collapsing
          ? `Collapsed “${group.name}” — its columns wait intact behind the chip`
          : `Expanded “${group.name}”`);
      },
    },
    {
      icon: 'Rename', label: 'Rename group…',
      fn: () => openRenamePopover({ x: r.left, y: r.bottom + 4 }, 'Rename group', group.name, (v) => {
        state.renameGroup(group.id, v);
        onToast(`Group renamed to “${state.floorGroups.find((g) => g.id === group.id)?.name ?? group.name}”`);
      }),
    },
    {
      icon: 'Color', label: 'Color…',
      fn: () => openMenu({ x: r.left, y: r.bottom + 4 }, `Color for “${group.name}”`, GROUP_COLORS.map((c) => ({
        icon: 'CircleFill',
        label: c.name + (group.color === c.color ? ' — current' : ''),
        fn: () => state.setGroupColor(group.id, c.color),
      }))),
    },
    {
      icon: 'Clear', label: 'Ungroup',
      title: 'Dissolve the group — the columns themselves stay exactly where they are',
      fn: () => {
        state.ungroupColumns(group.id);
        onToast(`Ungrouped “${group.name}” — the columns are untouched`);
      },
    },
  ]);
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

/** "Format this column" → the type-filtered catalog: built-in seeds (the
 *  subtype engine, knobs included) + YOUR components that fit (single-slot,
 *  type-compatible — the one "yours" concept; the old custom-subtype save was
 *  swallowed by Save as component…), then "format manually". */
function openFormatColumnMenu(col: GridColumn, field: MockField, header: HTMLElement, onToast: (m: string) => void): void {
  const catalog = subtypesForType(field.type).filter((st) => st.origin === 'builtin');
  const yours = customComponents().filter((c) => isSingleColumnComponent(c, field.type));
  const manual = (): void => applyColumnFormatter(col, field, defaultColumnFormatter(field), onToast,
    `Started a formatter for ${field.name} — you're editing it now; the grid renders it live`);
  if (catalog.length === 0 && yours.length === 0) { manual(); return; }
  const items: MenuItem[] = catalog.map((st) => ({
    icon: subtypeIcon(st),
    label: st.name,
    badge: 'Built-in',
    title: `Apply the built-in ${st.name} look to ${field.name}`,
    fn: () => applySubtype(col, field, st, onToast),
  }));
  for (const def of yours) {
    items.push({
      icon: 'Package',
      label: def.name,
      badge: 'Yours',
      title: `Apply your ${def.name} component to ${field.name} — registers a copy as this column's format`,
      fn: () => {
        // same snapshot-apply semantics as a built-in seed: stay on the grid,
        // one Ctrl+Z reverts (the recipe tag is the component id — harmless
        // to the vocab lookup, which optional-chains unknown ids). The bound
        // root is STAMPED so the ⬡ inventory sees the instance too (the scan
        // dedupes it against the subtype tag — one usage per column).
        const bound = bindComponentInstance(def, { [def.slots[0].key]: field.name });
        const baked = toColumnFormatter(bound, field.name);
        baked._elmName = `${fieldLabel(field)} — ${def.name}`;
        state.applyColumnSubtype(field.name, baked, def.id, {}, col.path);
        onToast(`Applied your ${def.name} component to ${field.name} — the grid renders it. Ctrl+Z to undo.`);
      },
    });
  }
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
        icon: 'Package',
        label: 'Save as component…',
        title: `Package ${fieldLabel(field)}'s current format as a reusable component — apply it to other ${field.type} columns from "Format this column", or map it anywhere from the ⬡ Components tab`,
        fn: () => openSaveColumnAsComponent(field, onToast),
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

  // ── the tab-group lens (owner brief 2026-07-05) ────────────────────────────
  // Which group each column belongs to, and the render ENTRIES: every visible
  // column, plus ONE slim chip track per collapsed group (at its leftmost
  // member's spot). Collapsed columns stay in the document untouched — the
  // grid just stops drawing them; data-col keeps the ORIGINAL column index so
  // selection/drag/drop indices stay valid either way.
  const groupOf = (col: GridColumn): ColumnGroup | undefined => {
    if (col.path.length === 0) return undefined;
    const field = gridColumnField(col.el);
    return field ? groupForField(state.floorGroups, field) : undefined;
  };
  type GridEntry = { col: GridColumn; i: number; group?: ColumnGroup } | { collapsed: ColumnGroup };
  const entries: GridEntry[] = [];
  {
    const chipped = new Set<string>();
    cols.forEach((col, i) => {
      const g = groupOf(col);
      if (g?.collapsed) {
        if (!chipped.has(g.id)) { chipped.add(g.id); entries.push({ collapsed: g }); }
        return;
      }
      entries.push({ col, i, group: g });
    });
  }
  /** A collapsed group's slim cell — click to expand. The HEADER cell is a
   *  real button (focusable, Enter/Space work natively); the body-row cells
   *  keep the pointer convenience but hide from AT so a screen reader hears
   *  ONE expand control per group, not one per mock row. */
  const collapsedCell = (g: ColumnGroup, header: boolean): HTMLElement => {
    const c = document.createElement(header ? 'button' : 'div');
    c.className = (header ? 'wb-grid-header' : 'wb-grid-cell') + ' wb-grid-collapsed';
    c.style.setProperty('--wb-group-color', g.color);
    const label = `Expand “${g.name}” — its ${g.fields.length} column${g.fields.length > 1 ? 's' : ''} wait${g.fields.length > 1 ? '' : 's'} intact`;
    c.title = label;
    if (header) {
      (c as HTMLButtonElement).type = 'button';
      c.setAttribute('aria-label', label);
      c.textContent = '⋯';
    } else {
      c.setAttribute('aria-hidden', 'true');
    }
    c.addEventListener('click', () => {
      state.toggleGroupCollapsed(g.id);
      onToast(`Expanded “${g.name}”`);
    });
    return c;
  };

  const grid = document.createElement('div');
  grid.className = 'wb-grid';
  const template = entries
    .map((e) => ('collapsed' in e ? '36px' : 'minmax(140px, 1fr)'))
    .join(' ') + (unplaced.length ? ' 108px' : '');
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
    // tab-group the selection (owner brief 2026-07-05) — single-field columns
    // only: a group is addressed by field names, so a composite has no home
    const selFields = [...gridSel].sort((a, b2) => a - b2)
      .map((i2) => (cols[i2] ? gridColumnField(cols[i2].el) : null));
    if (selFields.every((f): f is string => f !== null)) {
      const groupBtn = document.createElement('button');
      groupBtn.className = 'wb-areas-bar-btn wb-areas-bar-group';
      groupBtn.textContent = '⬒ Group columns';
      groupBtn.title = 'Group the selected columns like browser tabs — name, color, collapse. Display-only: the exported formatter is unchanged.';
      groupBtn.addEventListener('click', () => {
        gridSel.clear();
        const g = state.groupColumns(selFields);
        if (g) onToast(`Grouped ${selFields.length} column${selFields.length > 1 ? 's' : ''} as “${g.name}” — click its pill to rename, recolor, or collapse`);
      });
      bar.appendChild(groupBtn);
    }
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

  // ── the tab-group ribbon: one colored pill per contiguous group run ───────
  if (state.floorGroups.length) {
    const ribbon = document.createElement('div');
    ribbon.className = 'wb-grid-groupbar';
    let run: { group: ColumnGroup; start: number; len: number; collapsed: boolean } | null = null;
    const flush = (): void => {
      if (!run) return;
      const { group: g, start, len, collapsed } = run;
      run = null;
      const pill = document.createElement('button');
      pill.type = 'button';
      pill.className = 'wb-grid-grouppill' + (collapsed ? ' wb-grid-grouppill-collapsed' : '');
      pill.style.gridColumn = `${start + 1} / span ${len}`;
      pill.style.setProperty('--wb-group-color', g.color);
      pill.textContent = collapsed ? `▸ ${g.name}` : g.name;
      pill.title = collapsed
        ? `“${g.name}” is collapsed — its ${g.fields.length} column${g.fields.length > 1 ? 's' : ''} wait intact. Click for group actions.`
        : `Column group “${g.name}” — click to rename, recolor, collapse, or ungroup`;
      pill.addEventListener('click', (e) => {
        e.stopPropagation();
        groupMenu(g, pill, onToast);
      });
      ribbon.appendChild(pill);
    };
    entries.forEach((e, idx) => {
      const isCollapsed = 'collapsed' in e;
      const g = isCollapsed ? e.collapsed : e.group;
      if (!g) { flush(); return; }
      if (run && run.group.id === g.id && !run.collapsed && !isCollapsed && run.start + run.len === idx) {
        run.len++;
        return;
      }
      flush();
      run = { group: g, start: idx, len: 1, collapsed: isCollapsed };
    });
    flush();
    grid.appendChild(ribbon);
  }

  // header row
  const headrow = document.createElement('div');
  headrow.className = 'wb-grid-headrow';
  entries.forEach((entry) => {
    if ('collapsed' in entry) {
      headrow.appendChild(collapsedCell(entry.collapsed, true));
      return;
    }
    const { col, i, group: colGroup } = entry;
    const h = document.createElement('div');
    h.className = 'wb-grid-header';
    h.dataset.col = String(i);
    if (colGroup) {
      h.classList.add('wb-grid-header-grouped');
      h.style.setProperty('--wb-group-color', colGroup.color);
      h.dataset.group = colGroup.id;
    }
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
    // the count answers "where the heck is that column" at a glance — hidden
    // and never-placed fields both wait here (formatted ones stay formatted)
    add.textContent = `+ column · ${unplaced.length}`;
    add.title = `${unplaced.length} column${unplaced.length > 1 ? 's' : ''} from your schema ${unplaced.length > 1 ? 'aren’t' : 'isn’t'} shown in this grid — click to bring one back`;
    add.addEventListener('click', () => {
      openMenu(add, 'Columns not shown', unplaced.map((f) => ({
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
    entries.forEach((entry) => {
      if ('collapsed' in entry) {
        rowEl.appendChild(collapsedCell(entry.collapsed, false));
        return;
      }
      const { col, i } = entry;
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
          // tree's inert unregistered "reference" tag.
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
