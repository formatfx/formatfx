/**
 * editor/leftPane.ts — the Claude-style Left Edit Pane container.
 *
 * Builds and wires the whole left column: the action header (Edit / Discard /
 * Save), the Simple/Pro/Code lens tabs, the structure tree (Pro/Code only), a
 * drag splitter, the draw toolbar (Select / Text / Frame / Icon / Undo / Redo +
 * a palette overflow popover), and the lower workspace that swaps between the
 * inspector (Simple/Pro) and the Code declarations box.
 *
 * It mounts the existing tree and inspector into the new geometry, so the
 * lens-aware property split (inspector) and tree multi-select land as follow-on
 * changes without re-plumbing the shell.
 */

import { state, type EditorLens } from './state';
import { mountTree } from './treeView';
import { mountInspector } from './inspector';
import { mountCodeEditor } from './codeEditor';
import { mountPalette } from './palette';
import { openIconPicker } from './iconPicker';
import { exportJson } from '../core/serializer';
import type { SPElement } from '../core/types';

export interface LeftPaneOptions {
  toast: (msg: string) => void;
}

const LENSES: Array<{ id: EditorLens; label: string }> = [
  { id: 'simple', label: 'Simple' },
  { id: 'pro', label: 'Pro' },
  { id: 'code', label: 'Code' },
];

export function mountLeftPane(host: HTMLElement, opts: LeftPaneOptions): void {
  const { toast } = opts;
  host.classList.add('wb-leftpane');
  host.innerHTML = `
    <div class="wb-lp-header">
      <span class="wb-lp-title">Edit</span>
      <div class="wb-lp-actions">
        <button class="wb-lp-discard" title="Revert every change back to the last Save checkpoint">Discard</button>
        <button class="wb-lp-save" title="Confirm &amp; copy this formatter's JSON to the clipboard, and set the Discard checkpoint">Save</button>
      </div>
    </div>
    <div class="wb-lens-tabs" role="tablist" aria-label="Edit lens">
      ${LENSES.map((l) => `<button class="wb-lens-tab" role="tab" data-lens="${l.id}">${l.label}</button>`).join('')}
    </div>
    <div class="wb-lp-tree" id="wb-lp-tree">
      <section class="wb-tree-sec">
        <div class="wb-tree-sec-head">View formatter</div>
        <div class="wb-tree-sec-body" id="wb-tree-view"></div>
      </section>
      <section class="wb-tree-sec">
        <div class="wb-tree-sec-head">Column formatters</div>
        <div class="wb-tree-sec-body" id="wb-tree-cols"></div>
      </section>
    </div>
    <div class="wb-lp-splitter" id="wb-lp-splitter" title="Drag to resize the structure tree"></div>
    <div class="wb-drawbar" role="toolbar" aria-label="Draw tools">
      <button class="wb-tool wb-tool-select active" data-tool="select" title="Select elements on the canvas" aria-label="Select">${ICONS.select}</button>
      <span class="wb-tool-sep" aria-hidden="true"></span>
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
  mountTree(
    host.querySelector<HTMLElement>('#wb-tree-view')!,
    host.querySelector<HTMLElement>('#wb-tree-cols')!,
    (name) => revealColumn(host, name),
  );
  mountInspector(host.querySelector<HTMLElement>('#wb-lp-inspector')!);
  mountCodeEditor(host.querySelector<HTMLElement>('#wb-lp-code')!);

  // ── action header: Discard / Save ──────────────────────────────────────────
  const discardBtn = host.querySelector<HTMLButtonElement>('.wb-lp-discard')!;
  const saveBtn = host.querySelector<HTMLButtonElement>('.wb-lp-save')!;
  discardBtn.addEventListener('click', () => {
    if (!state.isDirtySinceSave) { toast('Nothing to discard — no changes since the last save'); return; }
    state.discardToSavepoint();
    toast('Reverted to the last saved checkpoint');
  });
  saveBtn.addEventListener('click', async () => {
    state.markSavepoint();
    try {
      await navigator.clipboard.writeText(exportJson(state.doc, { sanitizeWhitespace: true }));
      toast('Saved — JSON copied to the clipboard');
    } catch {
      toast('Saved (clipboard unavailable — copy from the JSON pane)');
    }
    refreshActionHeader();
  });
  const refreshActionHeader = (): void => {
    discardBtn.disabled = !state.isDirtySinceSave;
    saveBtn.classList.toggle('wb-dirty', state.isDirtySinceSave);
  };

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
    if (!palettePop.hidden && !palettePop.contains(e.target as Node) && e.target !== paletteBtn) {
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
  state.subscribe((reason) => {
    if (reason === 'lens') applyLens();
    if (reason === 'document' || reason === 'load' || reason === 'kind') refreshUndoRedo();
    if (reason !== 'selection' && reason !== 'lens' && reason !== 'theme') refreshActionHeader();
  });
  applyLens();
  refreshUndoRedo();
  refreshActionHeader();
}

/** Clicking a ⤷ CFR chip opens that column; scroll the cols section to it. */
function revealColumn(host: HTMLElement, name: string): void {
  requestAnimationFrame(() => {
    const cols = host.querySelector<HTMLElement>('#wb-tree-cols');
    if (!cols) return;
    const active = cols.querySelector<HTMLElement>('.wb-doc-header.active');
    if (active) { active.scrollIntoView({ block: 'nearest' }); return; }
    const missing = [...cols.querySelectorAll<HTMLElement>('.wb-doc-missing')]
      .find((el) => el.dataset.missingRef === name);
    if (missing) {
      missing.scrollIntoView({ block: 'nearest' });
      missing.classList.add('wb-flash');
      setTimeout(() => missing.classList.remove('wb-flash'), 1000);
    }
  });
}

// Inline SVG glyphs for the draw toolbar — crisp at any size, theme via currentColor.
const ICONS = {
  select: '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M3 2l9 5-3.6 1.2L10 12l-1.4.6L7 9 4 11z"/></svg>',
  text: '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M3 3h10v2.2h-1.1V4.1H8.6v7.8H10V13H6v-1.1h1.4V4.1H4.1v1.1H3z"/></svg>',
  frame: '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><rect x="2.5" y="3.5" width="11" height="9" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>',
  icon: '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M8 2.2l1.6 3.4 3.7.4-2.8 2.5.8 3.6L8 10.7 4.7 12.6l.8-3.6L2.7 6l3.7-.4z"/></svg>',
  more: '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M4 7h2v2H4zm3.5 0h2v2h-2zM11 7h2v2h-2z"/></svg>',
  undo: '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.3" d="M6 5H10a3 3 0 0 1 0 6H6m0-6L3.5 5 6 7"/></svg>',
  redo: '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.3" d="M10 5H6a3 3 0 0 0 0 6h4m0-6l2.5 0L10 7"/></svg>',
};
