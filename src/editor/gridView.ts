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
import { openMenu, closeMenu, type MenuItem } from './menu';
import {
  gridCellForField, defaultColumnFormatter, gridColumnField, gridColumnLabel,
  groupName, unplacedFields, fieldLabel,
} from './gridScaffold';
import type { SPElement, NodePath, MockField } from '../core/types';

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
    ? `Editing the ${name} column formatter — switch back via the topbar or Structure pane`
    : `Started a formatter for ${name} — you're editing it now; the grid renders it live`);
}

function copyColumnJson(col: GridColumn, fieldName: string | null, onToast: (m: string) => void): void {
  const registered = fieldName ? state.columnRefs[fieldName] : undefined;
  const root = registered ?? col.el;
  const json = exportJson({ kind: 'column', root }, { sanitizeWhitespace: true });
  navigator.clipboard.writeText(json).then(() => {
    onToast(registered
      ? `[$${fieldName}] formatter JSON copied — paste into that column's Format pane`
      : 'Column JSON copied (this cell as a column-formatter starting point)');
  });
}

function menuFor(col: GridColumn, header: HTMLElement, onToast: (m: string) => void): void {
  const fieldName = gridColumnField(col.el);
  const field = fieldName ? state.fields.find((f) => f.name === fieldName) : undefined;
  const label = gridColumnLabel(col.el, state.fields);
  const isGroup = !field && (col.el.children?.length ?? 0) > 0;
  const items: MenuItem[] = [];

  if (field) {
    const registered = field.name in state.columnRefs;
    items.push({
      icon: registered ? 'Edit' : 'Brush',
      label: registered ? 'Edit its formatter' : 'Format this column',
      title: registered
        ? `Open the [$${field.name}] column formatter on the canvas`
        : 'Start a column formatter for this column and open it — the grid keeps rendering it live',
      fn: () => formatColumn(col, field, onToast),
    });
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
    const caret = document.createElement('span');
    caret.className = 'wb-grid-header-caret';
    caret.textContent = '⌄';
    h.append(label, caret);

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
