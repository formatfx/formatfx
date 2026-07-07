/**
 * editor/canvas.ts — Interactive preview surface. Renders the formatter
 * against every mock row in a context matching the document kind (columns
 * grid, full-width row, or gallery tile), supports click-to-select (incl.
 * inside customCardProps flyouts), per-element drop targeting with live
 * highlight, an inspect-outlines mode, and surfaces runtime evaluation
 * issues.
 */

import { state } from './state';
import { renderElement, closeFlyout, type RenderIssue } from '../core/renderer';
import type { EvalContext } from '../core/expressions';
import { paletteItemById } from './palette';
import { instantiate } from './presets';
import { renderGrid } from './gridView';
import { installPreviewContextMenu } from './contextMenu';
import { COMPONENT_MIME, componentById, openComponentMapper } from './componentLibrary';
import { bestGuessMapping, mappingComplete, bindComponentInstance } from './components';
import type { NodePath, SPElement } from '../core/types';
import { rowDensityOf, DENSITY_LABEL, type RowDensity } from './areas';
import { openTemplateModal } from './templateModal';
import { HOVER_CHILD_CLASS } from './hoverReveal';

/** The Stage-3 row-view toolbar: density (Roomy/Compact) + Templates.
 *  Area/zone sizing lives in the template builder's inspector (the old
 *  right-click Area width entries were retired — FLOOR-AND-SHEETS Stage 0);
 *  "◧ Back to grid" retired with Stage 2 — minimizing lives on the LEFT,
 *  in the view strip, with the other view actions. */
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
  templates.title = state.doc.kind === 'tile'
    ? 'Start from a pre-built tile layout (skeleton + stackable styles)'
    : 'Start from a pre-built row layout (skeleton + stackable styles)';
  templates.addEventListener('click', () => openTemplateModal(onToast));
  bar.appendChild(templates);

  return bar;
}

/** Stage 3: the Select/Live segmented toggle — shared canvas chrome on every
 *  surface (floor and sheets). Select = clicks pick elements for
 *  editing; Live = clicks behave like real SharePoint (customRowAction fires,
 *  nothing selects). The builder preview ships its own always-live rows —
 *  the same idea, already built in. */
function canvasModeBar(onToast: (m: string) => void): HTMLElement {
  const bar = document.createElement('div');
  bar.className = 'wb-canvas-modebar';
  const seg = document.createElement('div');
  seg.className = 'wb-canvas-modeseg';
  seg.setAttribute('role', 'group');
  seg.setAttribute('aria-label', 'Canvas mode');
  const mk = (mode: 'select' | 'live', label: string, title: string): void => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'wb-canvas-mode' + (state.canvasMode === mode ? ' active' : '');
    b.setAttribute('aria-pressed', String(state.canvasMode === mode));
    b.textContent = label;
    b.title = title;
    b.addEventListener('click', () => {
      if (state.canvasMode === mode) return;
      state.setCanvasMode(mode);
      onToast(mode === 'live'
        ? 'Live canvas — clicks behave like real SharePoint: buttons run their actions, nothing gets selected. Flip back to Select to edit by clicking.'
        : 'Select canvas — clicking an element selects it for editing.');
    });
    seg.appendChild(b);
  };
  mk('select', 'Select', 'Clicking an element selects it for editing (the default)');
  mk('live', '⚡ Live', 'Clicks behave like real SharePoint — action buttons fire, cards open, nothing gets selected');
  bar.appendChild(seg);

  // Simulate-hover pin (issue #203): a hidden-on-hover element is invisible in
  // the preview, which makes it unselectable/uneditable — the pin force-reveals
  // every sp-card-showOnHoverChild while editing. Only offered when the
  // document actually uses the class; Live mode always behaves like real SP.
  if (usesHoverReveal(state.doc.root)) {
    const pin = document.createElement('button');
    pin.type = 'button';
    pin.className = 'wb-canvas-hoverpin' + (state.simulateHover ? ' active' : '');
    pin.setAttribute('aria-pressed', String(state.simulateHover));
    pin.textContent = '👁 Show hover-only';
    pin.disabled = state.canvasMode === 'live';
    pin.title = state.canvasMode === 'live'
      ? 'Live mode behaves like real SharePoint — hover the parent to reveal. Switch to Select to pin hidden elements visible.'
      : 'Pin every hide-until-hover element visible so you can select and edit it. Preview-only — the shipped formatter is unchanged.';
    pin.addEventListener('click', () => {
      state.setSimulateHover(!state.simulateHover);
      onToast(state.simulateHover
        ? 'Hover-only elements pinned visible (dashed outline) so you can click and edit them. Preview-only.'
        : 'Hover-only elements hidden again — hover their container to reveal, like real SharePoint.');
    });
    bar.appendChild(pin);
  }
  return bar;
}

/** The document uses the hover-reveal child class anywhere (incl. card bodies). */
function usesHoverReveal(el: SPElement): boolean {
  const c = el.attributes?.class;
  if (typeof c === 'string' && c.includes(HOVER_CHILD_CLASS)) return true;
  if (el.customCardProps?.formatter && usesHoverReveal(el.customCardProps.formatter)) return true;
  return (el.children ?? []).some(usesHoverReveal);
}

export interface CanvasApi {
  getRuntimeIssues: () => RenderIssue[];
  setOutlines: (on: boolean) => void;
  /** Toggles the wb-no-titlecol class (a CSS-only preference the topbar wires). */
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
    host.classList.toggle('wb-canvas-live', state.canvasMode === 'live');
    // simulate-hover pin: Select mode only — Live must behave like real SP
    host.classList.toggle('wb-simulate-hover', state.simulateHover && state.canvasMode === 'select');
    const issues: RenderIssue[] = [];
    const opts = {
      issues,
      tagPaths: true,
      // Stage 3: in Select mode the renderer skips the customRowAction
      // handlers, so those clicks select instead of firing
      interactive: state.canvasMode === 'live',
      onAction: (_el: unknown, summary: string) => onToast(summary),
    };
    host.appendChild(canvasModeBar(onToast));

    const kind = state.doc.kind;
    if (kind === 'grid') {
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

  // click-to-select — flyouts are appended to <body>, so listen there too.
  // Live mode routes clicks through the real behaviors instead (Stage 3):
  // nothing selects, so the canvas feels like the list it will become.
  const selectFrom = (e: MouseEvent, scope: HTMLElement | Document) => {
    if (state.canvasMode === 'live') return false;
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
    const types = e.dataTransfer?.types;
    if (!types?.includes('application/x-wb-palette') && !types?.includes(COMPONENT_MIME)) return;
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
    const compId = e.dataTransfer?.getData(COMPONENT_MIME);
    const target = (e.target as HTMLElement).closest('[data-sp-path]') as HTMLElement | null;
    clearDropHighlight();
    // a ⬡ component card dropped where it should live: bind with the best
    // guess and insert right there (ONE undoable step, provenance-stamped so
    // the ⬡ inventory counts it); a guess with a hole opens the typed mapper
    // instead — refuse-and-teach, never a wrong-typed bind.
    if (compId) {
      e.preventDefault();
      const def = componentById(compId);
      if (!def) return;
      const guess = bestGuessMapping(def, state.fields);
      if (!mappingComplete(def, guess)) {
        onToast(`"${def.name}" needs a column pick your schema can't auto-fill — map its slots first`);
        openComponentMapper(def, onToast);
        return;
      }
      const path = pathFromAttr(target?.dataset.spPath);
      const container = path !== undefined ? state.nodeAt(path) : null;
      const insertedAt = state.insertNode(bindComponentInstance(def, guess), path);
      onToast(`Added "${def.name}" into ${describeNode(container)} — now selected (depth ${insertedAt.length})`);
      return;
    }
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
  };
  render();

  return {
    getRuntimeIssues: () => runtimeIssues,
    setOutlines: (on: boolean) => host.classList.toggle('wb-outlines', on),
    setTitleColumn: (show: boolean) => host.classList.toggle('wb-no-titlecol', !show),
  };
}
