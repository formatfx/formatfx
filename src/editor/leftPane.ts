// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sam Yost. FormatFX is dual-licensed: AGPL-3.0-only (see LICENSE) or a commercial license (see LICENSING.md).

/**
 * editor/leftPane.ts — the Claude-style Left Edit Pane container, rebuilt to
 * COLUMNS-COMPONENTS-VIEWS §3 (Mockup B, approved). Top to bottom:
 *
 *   1. the NAV ROW — ← back (retrace) + 🕘 snapshots. Navigation between
 *      surfaces lives in the CANVAS TAB STRIP now; the old formatter tablist
 *      and the document pill died with the drill-in model.
 *   2. the THIS VIEW card (viewCard.ts) — the active view's name/kind and its
 *      view-scoped behaviors & properties; a def card while a component
 *      workshop tab is up; hidden on the grid.
 *   3. the STRUCTURE TREE — always mounted, rendering the active SURFACE
 *      (state.doc — the v1 constraint: a workshop tab never re-targets it).
 *      Drag splitter below (kept).
 *   4. the COLUMNS SHELF (columnShelf.ts) — "Columns — your data": typed
 *      chips, drag (FIELD_MIME) or click-to-insert. Data only.
 *   5. the COMPONENTS library — always visible (the old tab-swap mode died),
 *      then the VIEWS list (viewMenu.ts) — composition last, the owner's
 *      left-to-right mental model.
 *   6. the Simple/Pro/Code lens tabs, the draw toolbar (Select / Text /
 *      Frame / Icon / Undo / Redo + palette overflow), and the lower
 *      workspace swapping between the inspector and the Code declarations.
 */

import { state, type EditorLens } from './state';
import { mountTree } from './treeView';
import { mountInspector } from './inspector';
import { mountCodeEditor } from './codeEditor';
import { mountPalette } from './palette';
import { openIconPicker } from './iconPicker';
import { mountViewsList } from './viewMenu';
import { openSnapMenu } from './snapMenu';
import { mountComponentLibrary } from './componentLibrary';
import { mountColumnShelf } from './columnShelf';
import { mountViewCard } from './viewCard';
import {
  isSectionCollapsed, setSectionCollapsed, type PaneSectionId,
} from './paneSections';
import type { SPElement } from '../core/types';

export interface LeftPaneOptions {
  toast: (msg: string) => void;
}

const LENSES: Array<{ id: EditorLens; label: string }> = [
  { id: 'simple', label: 'Simple' },
  { id: 'pro', label: 'Pro' },
  { id: 'code', label: 'Code' },
];

/** The three big pane sections that fold away (issue #236). Order/label only —
 *  the DOM lives in the mountLeftPane template; wiring is wireSection(). */
const COLLAPSIBLE_SECTIONS: Array<{ id: PaneSectionId; label: string }> = [
  { id: 'columns', label: 'Columns' },
  { id: 'components', label: 'Components' },
  // id stays 'inspector' (frozen persist key / aria); only the label reads
  // "Properties" — the property editor for the selected element.
  { id: 'inspector', label: 'Properties' },
];

/** A section's clickable header: a real <button> (Enter/Space + focus for free),
 *  a chevron whose glyph is CSS-driven off .wb-collapsed, and the title. */
const sectionHead = (id: PaneSectionId, label: string, bodyId: string): string =>
  `<button type="button" class="wb-lp-sec-head" data-sec-head="${id}" aria-controls="${bodyId}">
      <span class="wb-lp-sec-caret" aria-hidden="true"></span>
      <span class="wb-lp-sec-title">${label}</span>
    </button>`;

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
    <div class="wb-lp-nav">
      <div class="wb-nav-group">
        <button class="wb-nav-back" id="wb-nav-back" aria-label="Back">←</button>
        <button class="wb-snap-btn" id="wb-snap-btn" aria-haspopup="menu" aria-label="Snapshots" title="Snapshots — capture the whole workspace and restore any capture later">${ICONS.history}</button>
      </div>
    </div>
    <div id="wb-lp-viewcard"></div>
    <div class="wb-lp-tree" id="wb-lp-tree">
      <div class="wb-tree-sec-body" id="wb-tree-body"></div>
    </div>
    <div class="wb-lp-splitter" id="wb-lp-splitter" title="Drag to resize the structure tree"></div>
    <div class="wb-lp-shelves" id="wb-lp-shelves">
      <section class="wb-lp-sec" data-sec="columns">
        ${sectionHead('columns', 'Columns', 'wb-lp-shelf')}
        <div id="wb-lp-shelf" class="wb-lp-sec-body"></div>
      </section>
      <section class="wb-lp-sec" data-sec="components">
        ${sectionHead('components', 'Components', 'wb-lp-library')}
        <div class="wb-complib wb-lp-sec-body" id="wb-lp-library"></div>
      </section>
      <div id="wb-lp-views"></div>
    </div>
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
      <section class="wb-lp-sec wb-lp-sec-inspector" data-sec="inspector">
        ${sectionHead('inspector', 'Properties', 'wb-lp-inspector')}
        <div class="wb-lp-inspector wb-lp-sec-body" id="wb-lp-inspector"></div>
      </section>
      <div class="wb-lp-code" id="wb-lp-code"></div>
    </div>
  `;

  // ── mount the sections ─────────────────────────────────────────────────────
  mountViewCard(host.querySelector<HTMLElement>('#wb-lp-viewcard')!, toast);
  mountTree(host.querySelector<HTMLElement>('#wb-tree-body')!, toast);
  mountColumnShelf(host.querySelector<HTMLElement>('#wb-lp-shelf')!, toast);
  mountComponentLibrary(host.querySelector<HTMLElement>('#wb-lp-library')!, toast);
  mountViewsList(host.querySelector<HTMLElement>('#wb-lp-views')!, toast);
  mountInspector(host.querySelector<HTMLElement>('#wb-lp-inspector')!, { toast });
  mountCodeEditor(host.querySelector<HTMLElement>('#wb-lp-code')!);

  // ── collapsible sections (issue #236): Columns · Components · Inspector ─────
  // The .wb-collapsed class + the header live on the SECTION wrapper, which the
  // section's own mount never re-renders — so the fold survives every body
  // repaint and the handler is wired exactly once here (no re-binding on
  // re-render). State persists on its own frozen key (paneSections.ts).
  for (const { id, label } of COLLAPSIBLE_SECTIONS) {
    const sec = host.querySelector<HTMLElement>(`.wb-lp-sec[data-sec="${id}"]`);
    const head = host.querySelector<HTMLButtonElement>(`.wb-lp-sec-head[data-sec-head="${id}"]`);
    if (!sec || !head) continue;
    const apply = (collapsed: boolean): void => {
      sec.classList.toggle('wb-collapsed', collapsed);
      head.setAttribute('aria-expanded', String(!collapsed));
      head.title = collapsed ? `Show ${label}` : `Hide ${label}`;
    };
    apply(isSectionCollapsed(id));
    head.addEventListener('click', () => {
      const next = !sec.classList.contains('wb-collapsed');
      apply(next);
      setSectionCollapsed(id, next);
    });
  }

  // ── navigation back (retrace doc switches — not undo) ──────────────────────
  const backBtn = host.querySelector<HTMLButtonElement>('#wb-nav-back')!;
  const landedLabel = (): string =>
    state.onFloor ? 'the grid' : `the ${state.activeViewName} view`;
  const refreshBack = (): void => {
    backBtn.disabled = state.backTarget === null;
    backBtn.title = state.backTarget === null
      ? 'Back — retrace where you were (nothing to go back to yet)'
      : 'Back — retrace your last surface switch';
  };
  backBtn.addEventListener('click', () => {
    if (state.goBack() !== null) toast(`Back to ${landedLabel()}`);
  });

  // ── snapshots (issue #140): the history button beside back ─────────────────
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
    if (reason === 'load' || reason === 'data' || reason === 'kind') refreshBack();
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
  refreshBack();
}

// Inline SVG glyphs for the toolbar — crisp at any size, theme via currentColor.
const ICONS = {
  history: '<svg viewBox="0 0 16 16" width="17" height="17" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.3" d="M3.2 8a4.8 4.8 0 1 0 1.4-3.4M3.2 2.8v2.4h2.4M8 5.4V8l1.9 1.4"/></svg>',
  text: '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M3 3h10v2.2h-1.1V4.1H8.6v7.8H10V13H6v-1.1h1.4V4.1H4.1v1.1H3z"/></svg>',
  frame: '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><rect x="2.5" y="3.5" width="11" height="9" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>',
  icon: '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M8 2.2l1.6 3.4 3.7.4-2.8 2.5.8 3.6L8 10.7 4.7 12.6l.8-3.6L2.7 6l3.7-.4z"/></svg>',
  more: '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M4 7h2v2H4zm3.5 0h2v2h-2zM11 7h2v2h-2z"/></svg>',
  undo: '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.3" d="M6 5H10a3 3 0 0 1 0 6H6m0-6L3.5 5 6 7"/></svg>',
  redo: '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.3" d="M10 5H6a3 3 0 0 0 0 6h4m0-6l2.5 0L10 7"/></svg>',
};
