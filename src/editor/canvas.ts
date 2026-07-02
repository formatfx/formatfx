/**
 * editor/canvas.ts — Interactive preview surface. Renders the formatter
 * against every mock row in a context matching the document kind (column
 * cell, full-width row, or gallery tile), supports click-to-select (incl.
 * inside customCardProps flyouts), per-element drop targeting with live
 * highlight, columnFormatterReference resolution from the registry, an
 * inspect-outlines mode, and surfaces runtime evaluation issues.
 */

import { state } from './state';
import { renderElement, closeFlyout, type RenderIssue } from '../core/renderer';
import type { EvalContext } from '../core/expressions';
import { paletteItemById } from './palette';
import { instantiate } from './presets';
import { renderGrid } from './gridView';
import { installPreviewContextMenu } from './contextMenu';
import type { NodePath, SPElement } from '../core/types';
import { cfrFieldName } from '../core/refs';
import { rowDensityOf, DENSITY_LABEL, type RowDensity } from './areas';
import { openTemplateModal } from './templateModal';
import { styleBannerLabel } from './styleScope';
import { cfrBlastRadius } from './cfr';

/** The Stage-3 row-view toolbar: density (Roomy/Compact) + back to the grid.
 *  Per-area sizing lives on each area's right-click menu (independent weights). */
function rowViewToolbar(onToast: (m: string) => void): HTMLElement {
  const bar = document.createElement('div');
  bar.className = 'wb-rowview-bar';
  const label = document.createElement('span');
  label.className = 'wb-rowview-bar-label';
  label.textContent = state.doc.kind === 'tile' ? 'Tile layout' : 'Row view';
  bar.appendChild(label);

  const density = rowDensityOf(state.doc.root);
  const group = document.createElement('span');
  group.className = 'wb-rowview-density';
  group.append('Density:');
  for (const d of ['roomy', 'compact'] as RowDensity[]) {
    const b = document.createElement('button');
    b.className = 'wb-rowview-bar-btn' + (density === d ? ' active' : '');
    b.textContent = DENSITY_LABEL[d];
    b.title = `${DENSITY_LABEL[d]} spacing for the whole row (a separate knob from per-area sizing)`;
    b.addEventListener('click', () => { state.setRowDensity(d); onToast(`Row density: ${DENSITY_LABEL[d]}`); });
    group.appendChild(b);
  }
  bar.appendChild(group);

  const templates = document.createElement('button');
  templates.className = 'wb-rowview-bar-btn wb-rowview-templates';
  templates.textContent = '▤ Templates…';
  templates.title = 'Start from a pre-built row layout (skeleton + stackable styles)';
  templates.addEventListener('click', () => openTemplateModal(onToast));
  bar.appendChild(templates);

  const hint = document.createElement('span');
  hint.className = 'wb-rowview-bar-hint';
  hint.textContent = 'right-click an area to size it';
  bar.appendChild(hint);

  const back = document.createElement('button');
  back.className = 'wb-rowview-bar-btn wb-rowview-back';
  back.textContent = '◧ Back to grid';
  back.title = 'Return to the column grid — the same elements, shown column by column';
  back.addEventListener('click', () => { state.setKind('grid'); onToast('Back to the grid'); });
  bar.appendChild(back);
  return bar;
}

export interface CanvasApi {
  getRuntimeIssues: () => RenderIssue[];
  setOutlines: (on: boolean) => void;
  /** Show/hide the Title context column in the column-formatter preview. */
  setTitleColumn: (show: boolean) => void;
}

function pathFromAttr(raw: string | undefined): NodePath | undefined {
  if (raw === undefined) return undefined;
  return raw === '' ? [] : raw.split('.').map(Number);
}

/** Short human label for a node, for drop/select feedback. */
function describeNode(el: SPElement | null): string {
  if (!el) return 'canvas';
  const txt = typeof el.txtContent === 'string' ? ` "${el.txtContent.slice(0, 18)}"` : '';
  return `<${el.elmType}>${txt}`;
}

export function mountCanvas(host: HTMLElement, onToast: (msg: string) => void): CanvasApi {
  let runtimeIssues: RenderIssue[] = [];

  const resolveColumnRef = (fieldRef: string): SPElement | null => {
    const name = cfrFieldName(fieldRef);
    return state.columnRefs[name] ?? null;
  };

  const ctxForRow = (rowIndex: number): EvalContext => ({
    row: state.rows[rowIndex] ?? {},
    rowIndex,
    currentFieldName: state.currentFieldName,
    me: state.me,
    iterators: {},
    iteratorIndex: {},
    displayNames: Object.fromEntries(state.fields.map((f) => [f.name, f.displayName ?? f.name])),
    now: new Date(),
  });

  const render = () => {
    closeFlyout();
    host.innerHTML = '';
    runtimeIssues = [];
    host.classList.toggle('wb-style-editing', state.doc.kind === 'column' && state.activeDocKey !== 'main');
    const issues: RenderIssue[] = [];
    const opts = {
      issues,
      tagPaths: true,
      resolveColumnRef,
      onAction: (_el: unknown, summary: string) => onToast(summary),
    };

    const kind = state.doc.kind;
    if (kind === 'column') {
      // drilled into a column formatter → the ribbon breadcrumb offers Back
      if (state.activeDocKey !== 'main') {
        const fieldName = state.activeDocKey;
        const display = state.fields.find((f) => f.name === fieldName)?.displayName ?? fieldName;
        const blast = cfrBlastRadius(fieldName, state.mainRootForScope, state.columnRefs);
        const banner = document.createElement('div');
        banner.className = 'wb-style-banner';
        const mark = document.createElement('span');
        mark.className = 'wb-style-mark';
        mark.textContent = '§';
        const text = document.createElement('span');
        text.textContent = styleBannerLabel(display, Math.max(blast.count, 1));
        const done = document.createElement('button');
        done.type = 'button';
        done.className = 'wb-style-done';
        done.textContent = 'Done';
        done.title = `Back to the ${state.viewName} view formatter`;
        done.addEventListener('click', () => { state.openMain(); onToast(`Back to the ${state.viewName} view formatter`); });
        banner.append(mark, text, done);
        host.appendChild(banner);
      }
      const table = document.createElement('div');
      table.className = 'wb-mock-list';
      const header = document.createElement('div');
      header.className = 'wb-mock-row wb-mock-header';
      const headTitle = document.createElement('div');
      headTitle.className = 'wb-mock-cell';
      headTitle.textContent = 'Title';
      const headFmt = document.createElement('div');
      headFmt.className = 'wb-mock-cell wb-mock-cell-fmt';
      // textContent, not innerHTML — currentFieldName is an imported internal
      // name and must never be parsed as HTML (matches the body cells below).
      headFmt.textContent = `${state.currentFieldName} (formatted)`;
      header.append(headTitle, headFmt);
      table.appendChild(header);
      state.rows.forEach((row, i) => {
        const tr = document.createElement('div');
        tr.className = 'wb-mock-row';
        const title = document.createElement('div');
        title.className = 'wb-mock-cell';
        title.textContent = String(row.Title ?? `Item ${i + 1}`);
        const cell = document.createElement('div');
        cell.className = 'wb-mock-cell wb-mock-cell-fmt';
        try {
          cell.appendChild(renderElement(state.doc.root, ctxForRow(i), opts));
        } catch (e) {
          cell.textContent = `⚠ ${(e as Error).message}`;
          cell.classList.add('wb-render-error');
        }
        tr.append(title, cell);
        table.appendChild(tr);
      });
      host.appendChild(table);
    } else if (kind === 'grid') {
      // the grid-first workspace: root children as Lists-style view columns
      renderGrid(host, { opts, ctxForRow, onToast });
    } else if (kind === 'row') {
      host.appendChild(rowViewToolbar(onToast));
      state.rows.forEach((_row, i) => {
        const rowHost = document.createElement('div');
        rowHost.className = 'wb-mock-viewrow';
        try {
          rowHost.appendChild(renderElement(state.doc.root, ctxForRow(i), opts));
        } catch (e) {
          rowHost.textContent = `⚠ ${(e as Error).message}`;
          rowHost.classList.add('wb-render-error');
        }
        host.appendChild(rowHost);
      });
    } else {
      host.appendChild(rowViewToolbar(onToast));
      const deck = document.createElement('div');
      deck.className = 'wb-mock-deck';
      state.rows.forEach((_row, i) => {
        const tile = document.createElement('div');
        tile.className = 'wb-mock-tile';
        tile.style.width = `${state.doc.tileWidth ?? 254}px`;
        tile.style.minHeight = `${state.doc.tileHeight ?? 220}px`;
        try {
          tile.appendChild(renderElement(state.doc.root, ctxForRow(i), opts));
        } catch (e) {
          tile.textContent = `⚠ ${(e as Error).message}`;
          tile.classList.add('wb-render-error');
        }
        deck.appendChild(tile);
      });
      host.appendChild(deck);
    }

    runtimeIssues = issues;
    highlightSelection();
  };

  const highlightSelection = () => {
    host.querySelectorAll('.wb-selected').forEach((n) => n.classList.remove('wb-selected'));
    state.selections.forEach((path) => {
      const key = path.join('.');
      host.querySelectorAll(`[data-sp-path="${CSS.escape(key)}"]`).forEach((n) => n.classList.add('wb-selected'));
    });
  };

  // click-to-select — flyouts are appended to <body>, so listen there too
  const selectFrom = (e: MouseEvent, scope: HTMLElement | Document) => {
    const target = (e.target as HTMLElement).closest('[data-sp-path]') as HTMLElement | null;
    if (!target) return false;
    if (scope instanceof HTMLElement && !scope.contains(target)) return false;
    const path = pathFromAttr(target.dataset.spPath);
    if (path === undefined) return false;
    if (e.ctrlKey || e.metaKey || e.shiftKey) state.toggleSelect(path);
    else state.select(path);
    return true;
  };
  host.addEventListener('click', (e) => selectFrom(e, host));
  const onDocClick = (e: MouseEvent) => {
    const inFlyout = (e.target as HTMLElement).closest?.('.wb-flyout');
    if (inFlyout) selectFrom(e, inFlyout as HTMLElement);
  };
  document.addEventListener('click', onDocClick);

  const onDocKeydown = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || state.activeDocKey === 'main') return;
    const t = e.target as HTMLElement;
    if (t.closest('input, textarea, select, [contenteditable], dialog')) return;
    // Convention: any overlay/popover that closes ITSELF on a document-level
    // Escape keydown carries the `wb-esc-owner` marker class on its root —
    // added either by the shared `createOverlay` chokepoint (overlay.ts) or,
    // for the handful of popovers that build their own root (grid menu,
    // fx float, column gallery, cond-format overlay, icon picker), by hand
    // at the point they set className. `.wb-flyout` deliberately does NOT
    // carry it — it has no Escape handler of its own, so it can't race with
    // this guard. If a document Escape would hit one of those owners first,
    // let it close on its own turn rather than also exiting the drilled
    // style — otherwise one Esc press does both at once. `:not([hidden])`
    // matters: owners that hide instead of removing themselves (the
    // inspector's doc cards) must stop owning Escape once dismissed.
    if (document.querySelector('.wb-esc-owner:not([hidden])')) return;
    state.openMain();
    onToast(`Back to the ${state.viewName} view formatter`);
  };
  document.addEventListener('keydown', onDocKeydown);

  // right-click an element (or a grid cell) for the common actions
  installPreviewContextMenu(host, onToast);

  // palette drag-drop with per-element target highlight
  let lastDropTarget: HTMLElement | null = null;
  const clearDropHighlight = () => {
    lastDropTarget?.classList.remove('wb-drop-target');
    lastDropTarget = null;
    host.classList.remove('wb-canvas-drop');
  };
  host.addEventListener('dragover', (e) => {
    if (!e.dataTransfer?.types.includes('application/x-wb-palette')) return;
    e.preventDefault();
    host.classList.add('wb-canvas-drop');
    const target = (e.target as HTMLElement).closest('[data-sp-path]') as HTMLElement | null;
    if (target !== lastDropTarget) {
      lastDropTarget?.classList.remove('wb-drop-target');
      lastDropTarget = target;
      target?.classList.add('wb-drop-target');
    }
  });
  host.addEventListener('dragleave', (e) => {
    if (!host.contains(e.relatedTarget as Node)) clearDropHighlight();
  });
  host.addEventListener('drop', (e) => {
    const id = e.dataTransfer?.getData('application/x-wb-palette');
    const target = (e.target as HTMLElement).closest('[data-sp-path]') as HTMLElement | null;
    clearDropHighlight();
    if (!id) return;
    e.preventDefault();
    const item = paletteItemById(id);
    if (!item) return;
    const path = pathFromAttr(target?.dataset.spPath);
    const container = path !== undefined ? state.nodeAt(path) : null;
    const insertedAt = state.insertNode(instantiate(item, state.fields), path);
    onToast(`Inserted "${item.label}" into ${describeNode(container)} — now selected (depth ${insertedAt.length})`);
  });

  if ((host as any)._unsub) {
    (host as any)._unsub();
  }
  const unsub = state.subscribe((reason) => {
    if (reason === 'selection') highlightSelection();
    else render();
  });
  (host as any)._unsub = () => {
    unsub();
    document.removeEventListener('click', onDocClick);
    document.removeEventListener('keydown', onDocKeydown);
  };
  render();

  return {
    getRuntimeIssues: () => runtimeIssues,
    setOutlines: (on: boolean) => host.classList.toggle('wb-outlines', on),
    setTitleColumn: (show: boolean) => host.classList.toggle('wb-no-titlecol', !show),
  };
}
