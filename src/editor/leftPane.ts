/**
 * editor/leftPane.ts — the Claude-style Left Edit Pane container.
 *
 * Builds and wires the whole left column, top to bottom: the FORMATTERS bar
 * (the ← back + 🕘 snapshot buttons leading the VIEWS / COLUMNS / COMPONENTS
 * tabs — no visible "Formatters" label; the tablist carries that name via
 * aria-label instead), the VIEW STRIP (the workbook's sheet tabs: the grid
 * floor + one chip per named view + ＋ — FLOOR-AND-SHEETS Stage 2), the
 * document dropdown (the pill
 * naming what's on the canvas — its menu browses/renames views or the
 * formatted-columns gallery), the structure tree, a drag splitter, the
 * Simple/Pro/Code lens tabs, the draw toolbar (Select / Text / Frame / Icon /
 * Undo / Redo + a palette overflow popover), and the lower workspace that
 * swaps between the inspector (Simple/Pro) and the Code declarations box.
 */

import { state, type EditorLens } from './state';
import { mountViewStrip } from './viewStrip';
import { mountTree } from './treeView';
import { mountInspector } from './inspector';
import { mountCodeEditor } from './codeEditor';
import { mountPalette } from './palette';
import { openIconPicker } from './iconPicker';
import { openViewMenu } from './viewMenu';
import { openColumnGallery } from './columnGallery';
import { openSnapMenu } from './snapMenu';
import { renderComponentLibrary } from './componentLibrary';
import type { FieldType, SPElement } from '../core/types';

export interface LeftPaneOptions {
  toast: (msg: string) => void;
}

const LENSES: Array<{ id: EditorLens; label: string }> = [
  { id: 'simple', label: 'Simple' },
  { id: 'pro', label: 'Pro' },
  { id: 'code', label: 'Code' },
];

/** Subtle schema tag for the view dropdown — which wrapper this view compiles
 *  to. Only read in view mode, where the main doc is on the canvas: grid and
 *  row layouts both ship as the list's row schema; tile is its own schema. */
function viewSchemaLabel(): string {
  return state.doc.kind === 'tile' ? 'tile schema' : 'list row schema';
}

/** Subtle column-type tag for the column dropdown, e.g. "person column". */
const FIELD_TYPE_LABEL: Record<FieldType, string> = {
  text: 'text', note: 'multiline text', number: 'number', currency: 'currency',
  choice: 'choice', choiceMulti: 'multi-choice', date: 'date',
  person: 'person', personMulti: 'multi-person', boolean: 'yes/no',
  hyperlink: 'hyperlink', lookup: 'lookup', lookupMulti: 'multi-lookup',
};
function columnTypeLabel(fieldName: string): string {
  const field = state.fields.find((f) => f.name === fieldName);
  return field ? `${FIELD_TYPE_LABEL[field.type] ?? field.type} column` : 'column';
}

export function mountLeftPane(host: HTMLElement, opts: LeftPaneOptions): void {
  const hostAny = host as any;
  if (typeof hostAny._unsub === 'function') {
    hostAny._unsub();
  }
  host.querySelectorAll('*').forEach((el: any) => {
    if (typeof el._unsub === 'function') {
      el._unsub();
    }
  });

  const { toast } = opts;
  host.classList.add('wb-leftpane');
  host.innerHTML = `
    <div class="wb-fmt-tabs">
      <div class="wb-fmt-row">
        <div class="wb-nav-group">
          <button class="wb-nav-back" id="wb-nav-back" aria-label="Back">←</button>
          <button class="wb-snap-btn" id="wb-snap-btn" aria-haspopup="menu" aria-label="Snapshots" title="Snapshots — capture the whole workspace and restore any capture later">${ICONS.history}</button>
        </div>
        <div class="wb-fmt-tablist" role="tablist" aria-label="Formatters">
          <!-- Columns | Components | Views (owner, 2026-07-05): the mental
               model reads left to right — views are made up of columns and
               components, so the ingredients lead and the composition ends. -->
          <button class="wb-fmt-tab wb-fmt-tab-cols" role="tab" data-fmt="cols" title="Your columns on the grid, and their shared formatters — each one paints a single column, everywhere it's referenced"><span class="wb-fmt-mark" aria-hidden="true">§</span><span>Columns</span></button>
          <button class="wb-fmt-tab wb-fmt-tab-comp" role="tab" data-fmt="comp" title="Components — packaged formatting without a column to call home; add one and map your columns into its typed slots"><span class="wb-fmt-mark" aria-hidden="true">⬡</span><span>Components</span></button>
          <button class="wb-fmt-tab wb-fmt-tab-view" role="tab" data-fmt="view" title="Views — whole-row layouts built from your columns and components">${ICONS.view}<span>Views</span></button>
        </div>
      </div>
    </div>
    <div id="wb-viewstrip"></div>
    <div class="wb-lp-tree" id="wb-lp-tree">
      <div class="wb-doc-pill-row">
        <button class="wb-doc-pill" id="wb-doc-pill" aria-haspopup="menu">
          <span class="wb-doc-pill-name"></span>
          <span class="wb-doc-pill-type"></span>
          <span class="wb-doc-pill-caret" aria-hidden="true">▾</span>
        </button>
      </div>
      <div class="wb-tree-sec-body" id="wb-tree-body"></div>
      <div class="wb-tree-sec-body wb-complib" id="wb-lp-library" hidden></div>
    </div>
    <div class="wb-lp-splitter" id="wb-lp-splitter" title="Drag to resize the structure tree"></div>
    <div class="wb-lp-header">
      <div class="wb-lens-tabs" role="tablist" aria-label="Edit lens">
        ${LENSES.map((l) => `<button class="wb-lens-tab" role="tab" data-lens="${l.id}">${l.label}</button>`).join('')}
      </div>
    </div>
    <div class="wb-drawbar" role="toolbar" aria-label="Draw tools">
      <button class="wb-tool" data-tool="text" title="Insert a text element (span)" aria-label="Insert text">${ICONS.text}</button>
      <button class="wb-tool" data-tool="frame" title="Insert a container (div) with border and padding" aria-label="Insert frame">${ICONS.frame}</button>
      <button class="wb-tool" data-tool="icon" title="Insert a Fluent icon" aria-label="Insert icon">${ICONS.icon}</button>
      <button class="wb-tool wb-tool-palette" data-tool="palette" title="More elements — the full palette" aria-label="More elements">${ICONS.more}</button>
      <span class="wb-tool-sep" aria-hidden="true"></span>
      <button class="wb-tool wb-tool-undo" data-tool="undo" title="Undo (Ctrl+Z)" aria-label="Undo">${ICONS.undo}</button>
      <button class="wb-tool wb-tool-redo" data-tool="redo" title="Redo (Ctrl+Y)" aria-label="Redo">${ICONS.redo}</button>
      <div class="wb-palette-pop" id="wb-palette-pop" hidden></div>
    </div>
    <div class="wb-lp-props" id="wb-lp-props">
      <div class="wb-lp-inspector" id="wb-lp-inspector"></div>
      <div class="wb-lp-code" id="wb-lp-code"></div>
    </div>
  `;

  // ── mount the relocated panels ─────────────────────────────────────────────
  // The view strip is the workbook's sheet tabs (FLOOR-AND-SHEETS Stage 2) —
  // it sits above the tree region so it stays visible in every mode: on the
  // floor, on a sheet, drilled into a column formatter, or browsing the
  // component library. Flipping surfaces under a drill is an owner requirement.
  mountViewStrip(host.querySelector<HTMLElement>('#wb-viewstrip')!, toast);
  mountTree(host.querySelector<HTMLElement>('#wb-tree-body')!, toast);
  mountInspector(host.querySelector<HTMLElement>('#wb-lp-inspector')!);
  mountCodeEditor(host.querySelector<HTMLElement>('#wb-lp-code')!);

  // ── formatter tabs + document dropdown ─────────────────────────────────────
  // Which tab is active derives from workspace state. A drilled column ref
  // (or a kind-'column' doc) reads as COLUMNS; so does STANDING ON THE GRID —
  // the grid floor IS the Columns tab's canvas (owner call 2026-07-05, the
  // Stage-2 amendment: no flip-flop button, Columns mode opens the grid).
  // VIEWS is active exactly while a sheet is up and no column is drilled.
  const isColumnDoc = (): boolean =>
    state.activeDocKey !== 'main' || state.doc.kind === 'column';

  const viewTab = host.querySelector<HTMLButtonElement>('.wb-fmt-tab-view')!;
  const colsTab = host.querySelector<HTMLButtonElement>('.wb-fmt-tab-cols')!;
  const compTab = host.querySelector<HTMLButtonElement>('.wb-fmt-tab-comp')!;
  const libHost = host.querySelector<HTMLElement>('#wb-lp-library')!;
  const pill = host.querySelector<HTMLButtonElement>('#wb-doc-pill')!;
  const pillName = pill.querySelector<HTMLElement>('.wb-doc-pill-name')!;
  const pillType = pill.querySelector<HTMLElement>('.wb-doc-pill-type')!;

  // COMPONENTS is a library browser, not a document on the canvas — a local
  // UI mode that any doc navigation (tab click or canvas drill-in) exits
  let libraryOpen = false;

  const refreshFmtNav = (): void => {
    const drilled = isColumnDoc();
    const cols = !libraryOpen && (drilled || state.onFloor);
    const view = !libraryOpen && !drilled && !state.onFloor;
    host.classList.toggle('wb-lp-library-open', libraryOpen);
    libHost.hidden = !libraryOpen;
    compTab.classList.toggle('active', libraryOpen);
    compTab.setAttribute('aria-selected', String(libraryOpen));
    viewTab.classList.toggle('active', view);
    viewTab.setAttribute('aria-selected', String(view));
    colsTab.classList.toggle('active', cols);
    colsTab.setAttribute('aria-selected', String(cols));
    // the pill is violet only for an actual column DOCUMENT — standing on the
    // grid keeps the blue surface pill ("Grid · list row schema")
    pill.classList.toggle('wb-doc-pill-col', drilled);
    if (drilled) {
      const fieldName = state.activeDocKey !== 'main' ? state.activeDocKey : state.currentFieldName;
      pillName.textContent = state.fields.find((f) => f.name === fieldName)?.displayName ?? fieldName;
      pillType.textContent = columnTypeLabel(fieldName);
      pill.title = 'Browse the columns that have a formatter, or start one';
    } else {
      pillName.textContent = state.onFloor ? 'Grid' : state.activeViewName;
      pillType.textContent = viewSchemaLabel();
      pill.title = state.onFloor
        ? 'Browse the columns that have a formatter, or start one'
        : 'Your named views — open one, rename it, or start a new row/tile view';
    }
  };

  viewTab.addEventListener('click', () => {
    libraryOpen = false;
    const wasDrilled = state.activeDocKey !== 'main';
    if (wasDrilled) state.openMain(); // leave the drill → the surface below it
    if (!state.onFloor) {
      if (wasDrilled) toast(`Back to the ${state.activeViewName} view formatter`);
      refreshFmtNav();
      return;
    }
    // standing on the grid: the grid belongs to the COLUMNS tab now, so VIEWS
    // returns to the sheet last on the canvas (newest as the fallback) — and
    // with no sheets yet, the View Formatters menu is the "+ New …" on-ramp.
    const target = (state.lastOpenViewId ? state.viewById(state.lastOpenViewId) : undefined)
      ?? state.views[state.views.length - 1];
    if (target) {
      state.openView(target.id);
      toast(`Opened “${target.name}”`);
      refreshFmtNav();
    } else {
      refreshFmtNav();
      openViewMenu(pill, toast);
    }
  });
  colsTab.addEventListener('click', () => {
    const wasLibrary = libraryOpen;
    libraryOpen = false;
    // COLUMNS opens the GRID — the floor is columns mode's canvas (owner call
    // 2026-07-05). From a drill: back to the surface first; from a sheet:
    // minimize (navigation — the sheet waits in the strip). Clicking it when
    // the grid is already up browses the formatted-columns gallery instead.
    const wasDrilled = state.activeDocKey !== 'main';
    if (wasDrilled) state.openMain();
    if (!state.onFloor) {
      state.minimizeView();
      toast('Your columns grid — views wait in the strip on the left');
      refreshFmtNav();
      return;
    }
    if (wasDrilled) { toast('Back to the grid'); refreshFmtNav(); return; }
    refreshFmtNav();
    if (!wasLibrary) openColumnGallery(pill, toast);
  });
  compTab.addEventListener('click', () => {
    if (libraryOpen) return;
    libraryOpen = true;
    renderComponentLibrary(libHost, toast);
    refreshFmtNav();
  });
  pill.addEventListener('click', (e) => {
    e.stopPropagation();
    // the grid is columns mode, so its pill browses the column gallery; the
    // view menu is the pill's job only while a sheet is up
    if (isColumnDoc() || state.onFloor) openColumnGallery(pill, toast);
    else openViewMenu(pill, toast);
  });

  // ── navigation back (retrace doc switches — not undo) ──────────────────────
  const backBtn = host.querySelector<HTMLButtonElement>('#wb-nav-back')!;
  const backLabel = (key: string): string =>
    key === 'main'
      ? (state.onFloor ? 'the grid' : `the ${state.activeViewName} view`)
      : `the ${key} column formatter`;
  const refreshBack = (): void => {
    const target = state.backTarget;
    backBtn.disabled = target === null;
    backBtn.title = target === null
      ? 'Back — retrace where you were (nothing to go back to yet)'
      : `Back to ${backLabel(target)}`;
  };
  backBtn.addEventListener('click', () => {
    const landed = state.goBack();
    if (landed !== null) toast(`Back to ${backLabel(landed)}`);
  });

  // ── snapshots (issue #140): the history button beside the dropdown ─────────
  const snapBtn = host.querySelector<HTMLButtonElement>('#wb-snap-btn')!;
  snapBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    openSnapMenu(snapBtn, toast);
  });

  // ── lens tabs ──────────────────────────────────────────────────────────────
  for (const btn of host.querySelectorAll<HTMLButtonElement>('.wb-lens-tab')) {
    btn.addEventListener('click', () => state.setLens(btn.dataset.lens as EditorLens));
  }
  const applyLens = (): void => {
    const lens = state.activeLens;
    host.classList.toggle('wb-lens-simple', lens === 'simple');
    host.classList.toggle('wb-lens-pro', lens === 'pro');
    host.classList.toggle('wb-lens-code', lens === 'code');
    for (const btn of host.querySelectorAll<HTMLButtonElement>('.wb-lens-tab')) {
      btn.classList.toggle('active', btn.dataset.lens === lens);
      btn.setAttribute('aria-selected', String(btn.dataset.lens === lens));
    }
  };

  // ── draw toolbar ───────────────────────────────────────────────────────────
  const drawBtn = (tool: string) => host.querySelector<HTMLButtonElement>(`.wb-tool[data-tool="${tool}"]`)!;
  drawBtn('text').addEventListener('click', () => {
    const at = state.insertNode({ elmType: 'span', _elmName: 'Text', txtContent: 'Text' });
    state.select(at);
    toast('Inserted a text element');
  });
  drawBtn('frame').addEventListener('click', () => {
    const at = state.insertNode({
      elmType: 'div', _elmName: 'Frame',
      style: {
        'display': 'flex', 'align-items': 'center', 'padding': '8px',
        'border-width': '1px', 'border-style': 'solid', 'border-color': '#e1dfdd', 'border-radius': '4px',
      },
    });
    state.select(at);
    toast('Inserted a frame');
  });
  drawBtn('icon').addEventListener('click', () => {
    openIconPicker({
      anchor: drawBtn('icon'),
      title: 'Pick an icon to insert',
      onPick: (name: string) => {
        const node: SPElement = { elmType: 'span', _elmName: 'Icon', attributes: { iconName: name } };
        const at = state.insertNode(node);
        state.select(at);
        toast(`Inserted icon: ${name}`);
      },
    });
  });
  drawBtn('undo').addEventListener('click', () => state.undo());
  drawBtn('redo').addEventListener('click', () => state.redo());

  // palette overflow popover (collapsed palette, accessible from the toolbar)
  const palettePop = host.querySelector<HTMLDivElement>('#wb-palette-pop')!;
  let paletteMounted = false;
  const paletteBtn = drawBtn('palette');
  paletteBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!paletteMounted) { mountPalette(palettePop); paletteMounted = true; }
    palettePop.hidden = !palettePop.hidden;
    paletteBtn.classList.toggle('active', !palettePop.hidden);
  });
  document.addEventListener('pointerdown', (e) => {
    // contains() — not `!== paletteBtn` — so a click on the button's inner SVG
    // still counts as an inside-click (otherwise the toggle never closes).
    if (!palettePop.hidden && !palettePop.contains(e.target as Node) && !paletteBtn.contains(e.target as Node)) {
      palettePop.hidden = true;
      paletteBtn.classList.remove('active');
    }
  });
  // clicking a palette item inserts then closes the popover
  palettePop.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('.wb-palette-item')) {
      palettePop.hidden = true;
      paletteBtn.classList.remove('active');
    }
  });

  const refreshUndoRedo = (): void => {
    drawBtn('undo').disabled = !state.canUndo;
    drawBtn('redo').disabled = !state.canRedo;
  };

  // ── splitter: resize the tree region height ────────────────────────────────
  const treeRegion = host.querySelector<HTMLElement>('#wb-lp-tree')!;
  const splitter = host.querySelector<HTMLElement>('#wb-lp-splitter')!;
  splitter.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    splitter.setPointerCapture(e.pointerId);
    const startY = e.clientY;
    const startH = treeRegion.getBoundingClientRect().height;
    const move = (ev: PointerEvent) => {
      const next = Math.max(80, Math.min(host.clientHeight - 220, startH + (ev.clientY - startY)));
      treeRegion.style.height = `${next}px`;
    };
    const up = () => {
      splitter.removeEventListener('pointermove', move);
      splitter.removeEventListener('pointerup', up);
    };
    splitter.addEventListener('pointermove', move);
    splitter.addEventListener('pointerup', up);
  });

  // ── subscriptions ──────────────────────────────────────────────────────────
  const unsub = state.subscribe((reason) => {
    if (reason === 'lens') applyLens();
    if (reason === 'document' || reason === 'load' || reason === 'kind') refreshUndoRedo();
    // a doc switch (canvas drill-in, back button, …) exits the library browser
    if (reason === 'load') libraryOpen = false;
    if (reason === 'load' || reason === 'data' || reason === 'kind') { refreshFmtNav(); refreshBack(); }
  });
  hostAny._unsub = () => {
    unsub();
    host.querySelectorAll('*').forEach((el: any) => {
      if (typeof el._unsub === 'function') {
        el._unsub();
      }
    });
  };
  applyLens();
  refreshUndoRedo();
  refreshFmtNav();
  refreshBack();
}

// Inline SVG glyphs for the toolbar + tabs — crisp at any size, theme via currentColor.
const ICONS = {
  view: '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.3" d="M2.5 3.5h11v9h-11zM2.5 6.5h11M2.5 9.5h11"/></svg>',
  history: '<svg viewBox="0 0 16 16" width="17" height="17" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.3" d="M3.2 8a4.8 4.8 0 1 0 1.4-3.4M3.2 2.8v2.4h2.4M8 5.4V8l1.9 1.4"/></svg>',
  text: '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M3 3h10v2.2h-1.1V4.1H8.6v7.8H10V13H6v-1.1h1.4V4.1H4.1v1.1H3z"/></svg>',
  frame: '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><rect x="2.5" y="3.5" width="11" height="9" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>',
  icon: '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M8 2.2l1.6 3.4 3.7.4-2.8 2.5.8 3.6L8 10.7 4.7 12.6l.8-3.6L2.7 6l3.7-.4z"/></svg>',
  more: '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M4 7h2v2H4zm3.5 0h2v2h-2zM11 7h2v2h-2z"/></svg>',
  undo: '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.3" d="M6 5H10a3 3 0 0 1 0 6H6m0-6L3.5 5 6 7"/></svg>',
  redo: '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.3" d="M10 5H6a3 3 0 0 0 0 6h4m0-6l2.5 0L10 7"/></svg>',
};
