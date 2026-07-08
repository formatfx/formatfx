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
 *   6. the Simple/Pro/Code lens tabs, and the lower workspace swapping 
 *      between the inspector and the Code declarations.
 */

import { state, type EditorLens } from './state';
import { mountTree } from './treeView';
import { mountInspector } from './inspector';
import { mountCodeEditor } from './codeEditor';
import { mountViewsList } from './viewMenu';
import { openKebabMenu } from './snapMenu';
import { mountComponentLibrary } from './componentLibrary';
import { mountColumnShelf } from './columnShelf';
import { mountViewCard } from './viewCard';
import {
  isSectionCollapsed, setSectionCollapsed, type PaneSectionId,
} from './paneSections';

export interface LeftPaneOptions {
  toast: (msg: string) => void;
}

const COLLAPSIBLE_SECTIONS: { id: PaneSectionId; label: string }[] = [
  { id: 'columns', label: 'Columns shelf' },
  { id: 'components', label: 'Components library' },
  { id: 'inspector', label: 'Properties editor' },
];

function sectionHead(id: PaneSectionId, title: string, controls: string): string {
  return `
    <button class="wb-lp-sec-head" data-sec-head="${id}" aria-controls="${controls}" aria-expanded="true">
      <span class="wb-lp-sec-caret" aria-hidden="true">▸</span>
      <span class="wb-lp-sec-title">${title}</span>
    </button>
  `;
}

const LENSES: { id: EditorLens; label: string }[] = [
  { id: 'simple', label: 'Simple' },
  { id: 'pro', label: 'Pro' },
  { id: 'code', label: 'Code' },
];

export function mountLeftPane(host: HTMLElement, opts: LeftPaneOptions): void {
  const hostAny = host as any;
  if (typeof hostAny._unsub === 'function') {
    hostAny._unsub();
  }
  // Auto-scroll anchor container for e2e structure clicks.
  host.addEventListener('click', (e) => {
    const row = (e.target as HTMLElement).closest('.wb-tree-row');
    if (row) {
      row.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  });

  const { toast } = opts;
  host.classList.add('wb-leftpane');
  host.innerHTML = `
    <div class="wb-lp-nav">
      <button class="wb-nav-back" id="wb-nav-back" aria-label="Back">←</button>
      <div class="wb-lens-tabs" role="tablist" aria-label="Edit lens">
        ${LENSES.map((l) => `<button class="wb-lens-tab" role="tab" data-lens="${l.id}">${l.label}</button>`).join('')}
      </div>
      <button class="wb-kebab-btn" id="wb-kebab-btn" aria-haspopup="menu" aria-label="Menu" title="Menu — tools and snapshots">${ICONS.kebab}</button>
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

  // ── kebab menu: unified tools and snapshots ──────────────────────────────
  const kebabBtn = host.querySelector<HTMLButtonElement>('#wb-kebab-btn')!;
  kebabBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    openKebabMenu(kebabBtn, toast);
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
  refreshBack();
}

// Inline SVG glyphs for the toolbar — crisp at any size, theme via currentColor.
const ICONS = {
  kebab: '<svg viewBox="0 0 16 16" width="17" height="17" aria-hidden="true"><path fill="currentColor" d="M8 3a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm0 6.5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm0 6.5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z"/></svg>',
};
