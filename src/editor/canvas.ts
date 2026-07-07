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
import { FIELD_MIME } from './columnShelf';
import { gridCellForField, fieldTextToken } from './gridScaffold';
import { isTextCapable } from './fxSlots';
import { bestGuessMapping, mappingComplete, bindComponentInstance } from './components';
import type { NodePath, SPElement } from '../core/types';
import { rowDensityOf, DENSITY_LABEL, type RowDensity } from './areas';
import { openTemplateModal } from './templateModal';
import { HOVER_CHILD_CLASS } from './hoverReveal';
import {
  ZOOM_MIN, ZOOM_MAX, clampZoom, stepZoom, zoomLabel,
  VIEWPORT_PRESETS, clampDragWidth, commitDragWidth, sanitizeViewPrefs,
  type CanvasViewPrefs,
} from './viewport';

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

/** How the canvas reads/writes its persisted view prefs (#216) — main.ts
 *  backs this with ADDITIVE fields inside the frozen `wb-ui-prefs` blob.
 *  Pure view state: no undo entry, no document autosave, ever. */
export interface CanvasViewPrefsIO {
  /** The raw persisted value (mountCanvas sanitizes — never trust the blob). */
  get(): unknown;
  set(prefs: CanvasViewPrefs): void;
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

export function mountCanvas(host: HTMLElement, onToast: (msg: string) => void, viewPrefs?: CanvasViewPrefsIO): CanvasApi {
  let runtimeIssues: RenderIssue[] = [];

  // ── #216/#224 view controls: zoom (magnify) ⊥ viewport width (reflow) ─────
  // Both are READ-ONLY view knobs. Zoom is CSS transform scale on the zoom
  // box wrapping everything the canvas renders (toolbars stay outside —
  // chrome never zooms); the viewport width constrains the STAGE's layout
  // width inside it so real CSS reflow happens. Direct style writes, no
  // state.emit: changing either re-renders nothing and mutates nothing —
  // no undo entry, no document autosave (persisted via wb-ui-prefs only).
  const view = sanitizeViewPrefs(viewPrefs?.get());
  let zoomBox: HTMLElement | null = null;
  let stageEl: HTMLElement | null = null;
  let viewBar: {
    out: HTMLButtonElement; pct: HTMLButtonElement; zin: HTMLButtonElement;
    presets: HTMLButtonElement[]; px: HTMLElement;
  } | null = null;
  const persistView = (): void => viewPrefs?.set({ ...view });

  const refreshViewBar = (): void => {
    if (!viewBar) return;
    viewBar.pct.textContent = zoomLabel(view.zoom);
    viewBar.pct.title = view.zoom === 1
      ? 'Zoom 100% — Ctrl+scroll over the preview also zooms'
      : 'Reset zoom to 100%';
    viewBar.out.disabled = view.zoom <= ZOOM_MIN;
    viewBar.zin.disabled = view.zoom >= ZOOM_MAX;
    for (const b of viewBar.presets) {
      const on = b.dataset.viewportWidth === String(view.viewportWidth);
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', String(on));
    }
    // the ≈ readout keeps the honesty on screen: simulated width, not gospel
    viewBar.px.textContent = view.viewportWidth === null ? '' : `≈${view.viewportWidth}px`;
  };

  /** Paint the current zoom + viewport onto the wrappers + toolbar (no re-render). */
  const applyView = (): void => {
    if (!zoomBox || !stageEl) return;
    zoomBox.style.transform = view.zoom === 1 ? '' : `scale(${view.zoom})`;
    // inverse-scale helper for chrome INSIDE the zoom box (the width handle)
    zoomBox.style.setProperty('--wb-canvas-zoom', String(view.zoom));
    const w = view.viewportWidth;
    stageEl.classList.toggle('wb-canvas-stage--framed', w !== null);
    stageEl.style.width = w === null ? '' : `${w}px`;
    refreshViewBar();
  };

  const setZoom = (z: number): void => {
    view.zoom = clampZoom(z);
    applyView();
    persistView();
  };

  const setViewportWidth = (w: number | null): void => {
    view.viewportWidth = w;
    applyView();
    persistView();
  };

  /** The view-controls cluster on the canvas toolbar: zoom (− / % / ＋) and
   *  the clearly-separated Width presets — zoom magnifies, width reflows. */
  const viewControlsBar = (): HTMLElement => {
    const bar = document.createElement('div');
    bar.className = 'wb-canvas-viewbar';
    const mk = (seg: HTMLElement, cls: string, text: string, title: string, fn: () => void): HTMLButtonElement => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = cls;
      b.textContent = text;
      b.title = title;
      b.addEventListener('click', fn);
      seg.appendChild(b);
      return b;
    };

    const zoomSeg = document.createElement('div');
    zoomSeg.className = 'wb-canvas-zoomseg';
    zoomSeg.setAttribute('role', 'group');
    zoomSeg.setAttribute('aria-label', 'Preview zoom (magnifies pixels only)');
    const out = mk(zoomSeg, 'wb-canvas-zoombtn', '−',
      'Zoom out (Ctrl+scroll) — shrinks pixels only, the layout never reflows',
      () => setZoom(stepZoom(view.zoom, -1)));
    out.dataset.zoom = 'out';
    const pct = mk(zoomSeg, 'wb-canvas-zoompct', zoomLabel(view.zoom), '', () => setZoom(1));
    const zin = mk(zoomSeg, 'wb-canvas-zoombtn', '＋',
      'Zoom in (Ctrl+scroll) — magnifies pixels only, the layout never reflows',
      () => setZoom(stepZoom(view.zoom, 1)));
    zin.dataset.zoom = 'in';
    bar.appendChild(zoomSeg);

    // #224: the viewport WIDTH presets — a separate, labeled control so
    // "small because zoomed out" never masquerades as "small because narrow"
    const vpSeg = document.createElement('div');
    vpSeg.className = 'wb-canvas-vpseg';
    vpSeg.setAttribute('role', 'group');
    vpSeg.setAttribute('aria-label', 'Preview width — reflows the layout like a real screen (approximate)');
    const vpLabel = document.createElement('span');
    vpLabel.className = 'wb-canvas-vplabel';
    vpLabel.textContent = 'Width';
    vpLabel.title = 'Constrain the preview\'s layout width so wrapping and truncation happen for real — approximate device room, not a pixel-perfect tenant';
    vpSeg.appendChild(vpLabel);
    const presets = VIEWPORT_PRESETS.map((p) => {
      const b = mk(vpSeg, 'wb-canvas-vpbtn', p.label, p.hint, () => setViewportWidth(p.width));
      b.dataset.viewport = p.id;
      b.dataset.viewportWidth = String(p.width);
      return b;
    });
    const px = document.createElement('span');
    px.className = 'wb-canvas-vppx';
    px.title = 'Approximate — the sandbox squeezes layout width; real tenant chrome differs (see the preset tooltips)';
    vpSeg.appendChild(px);
    bar.appendChild(vpSeg);

    viewBar = { out, pct, zin, presets, px };
    refreshViewBar();
    return bar;
  };

  /** The draggable right edge of the stage — the power-user path past the
   *  presets (#224): live-squeeze while dragging (direct style writes, no
   *  rerender churn), commit once on release; reaching full width dissolves
   *  the constraint. Shares its math with the template modal's scrubber
   *  handle (viewport.ts). */
  const widthHandle = (): HTMLElement => {
    const handle = document.createElement('div');
    handle.className = 'wb-canvas-widthhandle';
    handle.title = 'Drag to squeeze the preview and watch the layout reflow (double-click = full width)';
    handle.addEventListener('dblclick', () => setViewportWidth(null));
    handle.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      handle.setPointerCapture(e.pointerId);
      handle.classList.add('wb-dragging');
      const widthAt = (clientX: number): number => {
        // the stage lives INSIDE the zoom transform: rects come back in
        // visual (scaled) px, so divide by the scale factor to get layout px
        const rect = stageEl!.getBoundingClientRect();
        return clampDragWidth((clientX - rect.left) / view.zoom, zoomBox!.clientWidth);
      };
      const move = (ev: PointerEvent): void => {
        stageEl!.classList.add('wb-canvas-stage--framed');
        stageEl!.style.width = `${widthAt(ev.clientX)}px`;
      };
      const end = (ev: PointerEvent): void => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', end);
        handle.removeEventListener('pointercancel', end);
        handle.classList.remove('wb-dragging');
        // pointercancel carries no useful coordinates — commit what's on screen
        const w = ev.type === 'pointercancel'
          ? Math.round(stageEl!.getBoundingClientRect().width / view.zoom)
          : widthAt(ev.clientX);
        setViewportWidth(commitDragWidth(w, zoomBox!.clientWidth));
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', end);
      handle.addEventListener('pointercancel', end);
    });
    return handle;
  };

  // Ctrl/Cmd + mouse wheel over the preview zooms (and must NOT page-zoom
  // the whole app — hence cancelable + passive:false).
  const onWheel = (e: WheelEvent): void => {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    setZoom(stepZoom(view.zoom, e.deltaY < 0 ? 1 : -1));
  };
  host.addEventListener('wheel', onWheel, { passive: false });

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
    const modebar = canvasModeBar(onToast);
    modebar.prepend(viewControlsBar());
    host.appendChild(modebar);

    // #216/#224: everything the canvas renders lives inside the ZOOM BOX
    // (scale = magnify) wrapping the STAGE (width = reflow) — so the two
    // axes compose and work in every canvas mode (grid columns, row view,
    // tiles, components-in-cells). Toolbars stay outside — chrome never zooms.
    zoomBox = document.createElement('div');
    zoomBox.className = 'wb-canvas-zoombox';
    const stage = document.createElement('div');
    stage.className = 'wb-canvas-stage';
    stageEl = stage;
    zoomBox.appendChild(stage);
    zoomBox.appendChild(widthHandle());

    const kind = state.doc.kind;
    if (kind === 'grid') {
      // the grid-first workspace: root children as Lists-style view columns
      renderGrid(stage, { opts, ctxForRow, onToast });
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
        stage.appendChild(rowHost);
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
      stage.appendChild(deck);
    }
    host.appendChild(zoomBox);
    applyView();

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
    // accept-gated (§5): palette items, ⬡ component rows, column-shelf chips
    const types = e.dataTransfer?.types;
    if (!types?.includes('application/x-wb-palette') && !types?.includes(COMPONENT_MIME)
      && !types?.includes(FIELD_MIME)) return;
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
    const fieldName = e.dataTransfer?.getData(FIELD_MIME);
    const target = (e.target as HTMLElement).closest('[data-sp-path]') as HTMLElement | null;
    clearDropHighlight();
    // a column chip from the shelf (§5): the field lands as its look-aware
    // cell — dressed when the column wears a component, plain value otherwise.
    // Same insert semantics as a palette drop; ONE undoable step.
    if (fieldName) {
      e.preventDefault();
      const field = state.fields.find((f) => f.name === fieldName);
      if (!field) return;
      const path = pathFromAttr(target?.dataset.spPath);
      // Token drop (#217): a chip dropped ONTO a rendered text-bearing leaf
      // element re-binds that element's text to the column — txtContent
      // becomes the field's plain token, ONE undoable mutation. The grid
      // floor's top-level column cells keep the §5 "chips are columns"
      // grammar (drop = add a column), containers keep insert-into, and an
      // empty-canvas drop still just inserts at the root — the standing
      // behaviors are untouched.
      if (path !== undefined && !(state.doc.kind === 'grid' && path.length <= 1)) {
        const el = state.nodeAt(path);
        if (el && isTextCapable(el.elmType) && !el.children?.length) {
          const label = describeNode(el); // before the rebind — name what was hit
          state.mutateDocument(() => { el.txtContent = fieldTextToken(field); });
          state.select(path);
          onToast(`${label} now shows ${field.displayName ?? field.name} — Ctrl+Z undoes`);
          return;
        }
      }
      const container = path !== undefined ? state.nodeAt(path) : null;
      state.insertNode(gridCellForField(field, state.columnLooks), path);
      onToast(`Added the ${field.displayName ?? field.name} column into ${describeNode(container)} — now selected`);
      return;
    }
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
    host.removeEventListener('wheel', onWheel);
  };
  render();

  return {
    getRuntimeIssues: () => runtimeIssues,
    setOutlines: (on: boolean) => host.classList.toggle('wb-outlines', on),
    setTitleColumn: (show: boolean) => host.classList.toggle('wb-no-titlecol', !show),
  };
}
