/**
 * editor/gridView.ts — The grid-first workspace canvas context (kind 'grid').
 *
 * Renders the document as a Microsoft-Lists-style grid: one column per root
 * child, real column headers, each cell rendering its EMBEDDED content — a
 * look-carrying column's cell IS a baked clone of the ⬡ component applied to
 * it (no references to resolve). "Format this column" is not a gesture: a
 * column gets its look by having a COMPONENT applied to it.
 *   · click/right-click a header → per-column menu: apply / change / remove
 *     the component look, save it as a component, copy the compiled column
 *     JSON, hide the column
 *   · drop a ⬡ component onto a header or any body cell of a single-field
 *     column → apply it as the column's look (the mapper opens on holes;
 *     refuse-and-teach when no slot fits the column's type)
 *   · drag header L/R edges → reorder columns
 *   · drop ONTO a header    → group both columns into row-formatter
 *                             scaffolding ("Status + DueDate group")
 * Every grid mutation maps to ONE undoable document mutation (state methods
 * applyComponentToColumn/removeColumnLook/moveNodeTo/groupNodes/unwrapNode/
 * insertNode/removeNode).
 */

import { state } from './state';
import { renderElement, type RenderOptions } from '../core/renderer';
import { parseForEach, evaluateForEachList, type EvalContext, type SPValue } from '../core/expressions';
import { exportJson } from '../core/serializer';
import { openElementPlayground } from './playground';
import { openMenu, closeMenu, openRenamePopover, type MenuItem } from './menu';
import {
  gridCellForField, gridColumnField, gridColumnLabel,
  groupName, unplacedFields, fieldLabel,
} from './gridScaffold';
import { toColumnFormatter } from './lookDialect';
import {
  BUILTIN_COMPONENTS, bestGuessMapping, mappingComplete,
  isSingleColumnComponent, componentKind, flattenComponent, type ComponentDef,
} from './components';
import {
  customComponents, openSaveColumnAsComponent,
  openComponentMapper, componentById, COMPONENT_MIME,
} from './componentLibrary';
import { paletteComponents } from './paletteComponents';
import { groupForField, GROUP_COLORS, type ColumnGroup } from './colGroups';
import type { SPElement, NodePath, MockField, FieldType } from '../core/types';

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

/** Human name for a column type in teaching copy ("multi-person", "yes/no"). */
const TYPE_NAMES: Partial<Record<FieldType, string>> = {
  note: 'multiline', choiceMulti: 'multi-choice', personMulti: 'multi-person',
  boolean: 'yes/no', lookupMulti: 'multi-lookup',
};
function typeName(t: FieldType): string {
  return TYPE_NAMES[t] ?? t;
}

/** Every offered element component whose single slot fits a `type` column —
 *  the "Apply a component…" catalog (multi-slot defs arrive by DROP, where
 *  the mapper can fill their remaining slots). Defs resolve (inline-flatten,
 *  #225) FIRST, so the single-slot test and the eventual bind both see what
 *  an embed-carrying component really asks for. */
function fittingComponents(type: FieldType): ComponentDef[] {
  const all = [...BUILTIN_COMPONENTS, ...paletteComponents(), ...customComponents()];
  return all.map((def) => flattenComponent(def, all))
    .filter((def) => isSingleColumnComponent(def, type));
}

/**
 * Apply `def` to `field` as its look — the ONE way a column gets formatting.
 * The first slot fitting the column's type is forced to this field, the rest
 * best-guessed; a complete mapping applies immediately (ONE undoable step via
 * state.applyComponentToColumn), any hole opens the mapper aimed at the
 * column. No fitting slot = refuse and teach.
 */
function applyComponentAsLook(def: ComponentDef, field: MockField, onToast: (m: string) => void): void {
  const slot = componentKind(def) === 'element'
    ? def.slots.find((s) => s.types.includes(field.type))
    : undefined;
  if (!slot) {
    onToast(`"${def.name}" has no slot that takes a ${typeName(field.type)} column`);
    return;
  }
  const mapping = bestGuessMapping(def, state.fields);
  mapping[slot.key] = field.name;
  if (mappingComplete(def, mapping)) {
    state.applyComponentToColumn(field.name, def, mapping);
    onToast(`Applied ${def.name} to ${fieldLabel(field)} — Ctrl+Z undoes`);
  } else {
    openComponentMapper(def, onToast, { applyToColumn: field.name });
  }
}

/** The "Apply a component…" submenu: single-slot element components fitting
 *  the column's type — picking one applies it as the look in one step. */
function openApplyComponentMenu(field: MockField, anchor: HTMLElement, onToast: (m: string) => void): void {
  openMenu(anchor, `Apply a component to ${fieldLabel(field)}`,
    fittingComponents(field.type).map((def) => ({
      icon: 'Package',
      label: def.name,
      badge: def.builtin ? 'Built-in' : 'Yours',
      title: def.description,
      fn: () => applyComponentAsLook(def, field, onToast),
    })));
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

/** Resolve a field to its placed grid column in the active main grid, or a
 *  synthetic unplaced column (path []), so callers outside the grid (search)
 *  can select and flash the column a field lives in. */
export function gridColumnForField(field: MockField): GridColumn {
  if (state.activeDocKey === 'main' && state.doc.kind === 'grid') {
    const children = state.doc.root.children ?? [];
    const i = children.findIndex((c) => gridColumnField(c) === field.name);
    if (i >= 0) return { el: children[i], path: [i] };
  }
  return { el: { elmType: 'div' }, path: [] };
}

/** Copy the column's SharePoint formatter JSON: a look compiles on demand
 *  (`[$Field]` → `@currentField` via toColumnFormatter); a plain cell copies
 *  as-is — a column-formatter starting point. */
async function copyColumnJson(col: GridColumn, fieldName: string | null, onToast: (m: string) => void): Promise<void> {
  const look = fieldName && Object.hasOwn(state.columnLooks, fieldName)
    ? state.columnLooks[fieldName] : undefined;
  const root = look && fieldName ? toColumnFormatter(look, fieldName) : col.el;
  const json = exportJson({ kind: 'column', root }, { sanitizeWhitespace: true });
  try {
    await navigator.clipboard.writeText(json);
    onToast(look
      ? `${fieldName} formatter JSON copied — paste into that column's Format pane`
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
    if (Object.hasOwn(state.columnLooks, field.name)) {
      // the column wears a look — a baked instance of a ⬡ component
      const look = state.columnLooks[field.name];
      const def = look._component ? componentById(look._component.id) : undefined;
      if (def) {
        items.push({
          icon: 'Package',
          label: 'Change the component…',
          title: `${fieldLabel(field)} wears the ${def.name} component — remap which columns fill its slots`,
          fn: () => openComponentMapper(def, onToast, { applyToColumn: field.name }),
        });
      }
      // an unstamped (imported) look has no def to reopen — "Save as
      // component…" below is its one step to editability (refuse-and-teach)
      items.push({
        icon: 'Clear',
        label: 'Remove the look',
        title: `Back to the plain ${fieldLabel(field)} value — one undoable step`,
        fn: () => {
          state.removeColumnLook(field.name);
          onToast(`Removed the look from ${fieldLabel(field)} — plain value again. Ctrl+Z restores it.`);
        },
      });
      items.push({
        icon: 'Package',
        label: 'Save as component…',
        title: `Package ${fieldLabel(field)}'s look as a reusable ⬡ component — apply it to other ${typeName(field.type)} columns, or map it anywhere from Components`,
        fn: () => openSaveColumnAsComponent(field, onToast),
      });
    } else if (fittingComponents(field.type).length > 0) {
      items.push({
        icon: 'Package',
        label: 'Apply a component…',
        title: `Give ${fieldLabel(field)} its look by applying a ⬡ component — one undoable step (you can also drop one straight onto the column)`,
        fn: () => openApplyComponentMenu(field, header, onToast),
      });
    } else {
      // nothing in the catalog fits — teach instead of hiding the concept
      items.push({
        icon: 'Package',
        label: `No component fits a ${typeName(field.type)} column yet`,
        title: `Build one in Components — a component with a slot that accepts a ${typeName(field.type)} column can be applied (or dropped) here`,
        fn: () => onToast(`No component fits a ${typeName(field.type)} column yet — build one in Components`),
      });
    }
  }
  if (isGroup) {
    items.push({
      icon: 'Color',
      label: 'Style this group',
      title: 'Open the style playground on this element — consequence-free until you Apply',
      fn: () => {
        state.select(col.path);
        openElementPlayground(col.path);
      },
    });
    if (col.path.length > 0) {
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

// ─── drag: reorder (edges) / group (drop onto) / ⬡ component (apply look) ────

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
  host.querySelectorAll('.wb-grid-drop-before, .wb-grid-drop-after, .wb-grid-drop-onto, .wb-grid-drop-look')
    .forEach((n) => n.classList.remove('wb-grid-drop-before', 'wb-grid-drop-after', 'wb-grid-drop-onto', 'wb-grid-drop-look'));
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

  /** The single field a column represents, as a MockField (undefined for
   *  composites/groups — they take no component drops). */
  const fieldOf = (col: GridColumn): MockField | undefined => {
    const name = gridColumnField(col.el);
    return name ? state.fields.find((f) => f.name === name) : undefined;
  };

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

  // ── ⬡ component drop = apply as the column's look ─────────────────────────
  // Headers AND body cells of single-field columns accept COMPONENT_MIME (the
  // library rows' drag payload) alongside the header-reorder MIME. The whole
  // column highlights while a component hovers it; the drop applies with the
  // exact "Apply a component…" semantics. stopPropagation everywhere so the
  // canvas-level generic component drop (insert as a NEW column) never
  // double-fires under a column-targeted drop.
  const clearLookMarks = (): void => {
    grid.querySelectorAll('.wb-grid-drop-look')
      .forEach((n) => n.classList.remove('wb-grid-drop-look'));
  };
  const attachLookDrop = (target: HTMLElement, field: MockField, i: number): void => {
    target.addEventListener('dragover', (e) => {
      if (!e.dataTransfer?.types.includes(COMPONENT_MIME)) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'copy';
      clearDropMarks(host);
      grid.querySelectorAll(`.wb-grid-header[data-col="${i}"], .wb-grid-cell[data-col="${i}"]`)
        .forEach((n) => n.classList.add('wb-grid-drop-look'));
    });
    // the drag source is a library row — its dragend never reaches the grid,
    // so leaving a target clears the highlight (the next dragover re-marks)
    target.addEventListener('dragleave', () => clearLookMarks());
    target.addEventListener('drop', (e) => {
      if (!e.dataTransfer?.types.includes(COMPONENT_MIME)) return;
      e.preventDefault();
      e.stopPropagation();
      clearDropMarks(host);
      const def = componentById(e.dataTransfer.getData(COMPONENT_MIME));
      if (!def) return;
      applyComponentAsLook(def, field, onToast);
    });
  };

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
    const colField = fieldOf(col);
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
    h.title = 'Click for column actions · drag left/right to reorder · drop onto another column to group them'
      + (colField ? ' · drop a ⬡ component to apply its look' : '');
    const label = document.createElement('span');
    label.className = 'wb-grid-header-label';
    label.textContent = gridColumnLabel(col.el, state.fields);
    h.append(label);
    // ⬡ look mark: this column wears a component (named when the look is a
    // stamped instance — an imported, unstamped look stays unmarked)
    if (colField && Object.hasOwn(state.columnLooks, colField.name)) {
      const tag = state.columnLooks[colField.name]._component;
      const lookDef = tag ? componentById(tag.id) : undefined;
      if (lookDef) {
        const mark = document.createElement('span');
        mark.className = 'wb-grid-look';
        mark.textContent = '⬡';
        mark.setAttribute('aria-hidden', 'true');
        mark.title = `This column wears the ${lookDef.name} component — right-click to change or remove`;
        h.append(mark);
      }
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
      if (colField) attachLookDrop(h, colField, i);
    }
    headrow.appendChild(h);
  });

  if (unplaced.length) {
    const add = document.createElement('button');
    add.className = 'wb-grid-addcol';
    // the count answers "where the heck is that column" at a glance — hidden
    // and never-placed fields both wait here (look-wearing ones keep it)
    add.textContent = `+ column · ${unplaced.length}`;
    add.title = `${unplaced.length} column${unplaced.length > 1 ? 's' : ''} from your schema ${unplaced.length > 1 ? 'aren’t' : 'isn’t'} shown in this grid — click to bring one back`;
    add.addEventListener('click', () => {
      openMenu(add, 'Columns not shown', unplaced.map((f) => ({
        icon: Object.hasOwn(state.columnLooks, f.name) ? 'Brush' : 'TripleColumn',
        label: fieldLabel(f) + (Object.hasOwn(state.columnLooks, f.name) ? ' · formatted' : ''),
        fn: () => {
          state.insertNode(gridCellForField(f, state.columnLooks), []);
          onToast(`${fieldLabel(f)} added to the grid${Object.hasOwn(state.columnLooks, f.name) ? ' — wearing its look' : ''}`);
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
      try {
        renderCellContent(cell, col, ctx, opts);
      } catch (err) {
        cell.textContent = `⚠ ${(err as Error).message}`;
        cell.classList.add('wb-render-error');
      }
      // a whole column is also a "drop onto" group target — and a single-field
      // column's cells take ⬡ component drops (apply as the look)
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
        const cellField = fieldOf(col);
        if (cellField) attachLookDrop(cell, cellField, i);
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
 *  forEach on children, and grid columns render directly). Cells render
 *  their EMBEDDED content — a look is baked into the cell, never resolved. */
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
