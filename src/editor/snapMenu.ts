// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sam Yost. FormatFX is dual-licensed: AGPL-3.0-only (see LICENSE) or a commercial license (see LICENSING.md).

/**
 * editor/snapMenu.ts — the snapshot menu (issue #140), anchored under the 🕘
 * history button on the Left Edit Pane's Formatters bar.
 *
 * Snapshots are full-workspace-only (owner decision, 2026-07-03): the ONE
 * take action always captures scope { kind: 'all' } — the floor grid, every
 * named view sheet, and every registered column formatter together. Legacy
 * column-scoped captures stay restorable under a collapsed "Older, scoped
 * snapshots" group (their shape is unchanged); captures whose shape predates
 * FLOOR-AND-SHEETS Stage 1 are dropped by the store's load guard, per the
 * no-migration rule. Every restore is one undoable step.
 *
 * Persistence: localStorage under snapshots.STORAGE_KEY ('wb-snapshots.v1',
 * additive — the frozen project/prefs keys stay untouched). The store brain
 * (caps, scope keys, eviction) is the pure snapshots.ts; this module only
 * renders it and calls state.captureSnapshot / state.applySnapshot.
 */

import { state } from './state';
import {
  STORAGE_KEY, loadStore, serializeStore, addSnapshot, removeSnapshot,
  snapshotsFor, relativeTime,
  type Snapshot, type SnapshotStore,
} from './snapshots';
import { openIconPicker } from './iconPicker';
import { mountPalette } from './palette';
import type { SPElement } from '../core/types';

function readStore(): SnapshotStore {
  try {
    return loadStore(localStorage.getItem(STORAGE_KEY));
  } catch {
    return { version: 1, snapshots: [] };
  }
}

function writeStore(store: SnapshotStore): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, serializeStore(store));
    return true;
  } catch {
    return false; // quota/private mode — the caller toasts
  }
}

const MENU_ICONS = {
  text: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" style="color: currentColor;"><path fill="currentColor" d="M3 3h10v2.2h-1.1V4.1H8.6v7.8H10V13H6v-1.1h1.4V4.1H4.1v1.1H3z"/></svg>',
  frame: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" style="color: currentColor;"><rect x="2.5" y="3.5" width="11" height="9" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>',
  icon: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" style="color: currentColor;"><path fill="currentColor" d="M8 2.2l1.6 3.4 3.7.4-2.8 2.5.8 3.6L8 10.7 4.7 12.6l.8-3.6L2.7 6l3.7-.4z"/></svg>',
  more: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" style="color: currentColor;"><path fill="currentColor" d="M4 7h2v2H4zm3.5 0h2v2h-2zM11 7h2v2h-2z"/></svg>',
  undo: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" style="color: currentColor;"><path fill="none" stroke="currentColor" stroke-width="1.3" d="M6 5H10a3 3 0 0 1 0 6H6m0-6L3.5 5 6 7"/></svg>',
  redo: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" style="color: currentColor;"><path fill="none" stroke="currentColor" stroke-width="1.3" d="M10 5H6a3 3 0 0 0 0 6h4m0-6l2.5 0L10 7"/></svg>',
  back: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" style="color: currentColor;"><path fill="none" stroke="currentColor" stroke-width="1.3" d="M13 8H3.5m0 0L7 4.5M3.5 8L7 11.5"/></svg>',
};

let openPanel: { panel: HTMLElement; cleanup: () => void } | null = null;
let openPaletteEl: { el: HTMLElement; cleanup: () => void } | null = null;

export function closeSnapMenu(): void {
  if (!openPanel) return;
  openPanel.cleanup();
  openPanel.panel.remove();
  openPanel = null;
}

export function closePalettePop(): void {
  if (!openPaletteEl) return;
  openPaletteEl.cleanup();
  openPaletteEl.el.remove();
  openPaletteEl = null;
}

export function openPalettePop(anchor: HTMLElement): void {
  closePalettePop();
  const pop = document.createElement('div');
  pop.className = 'wb-palette-pop wb-esc-owner';
  mountPalette(pop);
  document.body.appendChild(pop);

  const r = anchor.getBoundingClientRect();
  // Keep the palette inside the left pane so it never covers the canvas. The
  // canvas is the drop zone for dragging elements in; a palette overlapping it
  // would intercept the drop (the old drawbar palette lived in the pane too).
  const pane = anchor.closest('.wb-leftpane');
  const paneRight = pane ? pane.getBoundingClientRect().right : window.innerWidth;
  const w = pop.offsetWidth || 320;
  pop.style.position = 'fixed';
  pop.style.top = `${Math.min(r.bottom + 6, Math.max(8, window.innerHeight - 370))}px`;
  pop.style.left = `${Math.max(8, Math.min(r.left, paneRight - w - 8))}px`;

  let done = false;
  const close = (): void => { if (!done) { done = true; closePalettePop(); } };
  const onOutside = (e: PointerEvent): void => {
    if (!pop.contains(e.target as Node) && !anchor.contains(e.target as Node)) close();
  };
  const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') close(); };
  const onClick = (e: Event): void => {
    if ((e.target as HTMLElement).closest('.wb-palette-item')) close();
  };

  pop.addEventListener('click', onClick);
  const armTimer = window.setTimeout(() => document.addEventListener('pointerdown', onOutside), 0);
  document.addEventListener('keydown', onKey);
  const cleanup = (): void => {
    window.clearTimeout(armTimer);
    document.removeEventListener('pointerdown', onOutside);
    document.removeEventListener('keydown', onKey);
  };
  openPaletteEl = { el: pop, cleanup };
}

/** Open the kebab menu anchored under `anchor`. */
export function openKebabMenu(anchor: HTMLElement, onToast: (m: string) => void): void {
  closeSnapMenu();
  closePalettePop();

  const panel = document.createElement('div');
  panel.className = 'wb-snapmenu wb-esc-owner';

  let legacyOpen = false;

  const render = (): void => {
    panel.replaceChildren();
    const store = readStore();

    // ── Back (retrace the last surface switch — navigation, not undo; the
    //    nav-row button moved under this ⋮, 2026-07-10) ───────────────────
    const backBtn = document.createElement('button');
    backBtn.type = 'button';
    backBtn.className = 'wb-kebab-item wb-tool-back';
    backBtn.disabled = state.backTarget === null;
    backBtn.title = state.backTarget === null
      ? 'Back — retrace where you were (nothing to go back to yet)'
      : 'Back — retrace your last surface switch';
    backBtn.innerHTML = `${MENU_ICONS.back}<span>Back — previous surface</span>`;
    backBtn.addEventListener('click', () => {
      closeSnapMenu();
      if (state.goBack() !== null) {
        onToast(`Back to ${state.onFloor ? 'the grid' : `the ${state.activeViewName} view`}`);
      }
    });
    panel.appendChild(backBtn);

    const sep0 = document.createElement('div');
    sep0.className = 'wb-kebab-sep';
    panel.appendChild(sep0);

    // ── Undo ───────────────────────────────────────────────────────────
    const undoBtn = document.createElement('button');
    undoBtn.type = 'button';
    undoBtn.className = 'wb-kebab-item wb-tool-undo';
    undoBtn.disabled = !state.canUndo;
    undoBtn.innerHTML = `${MENU_ICONS.undo}<span>Undo</span><span class="wb-kebab-shortcut">Ctrl+Z</span>`;
    undoBtn.addEventListener('click', () => {
      state.undo();
      closeSnapMenu();
    });
    panel.appendChild(undoBtn);

    // ── Redo ───────────────────────────────────────────────────────────
    const redoBtn = document.createElement('button');
    redoBtn.type = 'button';
    redoBtn.className = 'wb-kebab-item wb-tool-redo';
    redoBtn.disabled = !state.canRedo;
    redoBtn.innerHTML = `${MENU_ICONS.redo}<span>Redo</span><span class="wb-kebab-shortcut">Ctrl+Y</span>`;
    redoBtn.addEventListener('click', () => {
      state.redo();
      closeSnapMenu();
    });
    panel.appendChild(redoBtn);

    // ── Divider ──
    const sep1 = document.createElement('div');
    sep1.className = 'wb-kebab-sep';
    panel.appendChild(sep1);

    // ── Insert Text ──────────────────────────────────────────────────
    const textBtn = document.createElement('button');
    textBtn.type = 'button';
    textBtn.className = 'wb-kebab-item';
    textBtn.dataset.tool = 'text';
    textBtn.title = 'Insert a text element (span)';
    textBtn.innerHTML = `${MENU_ICONS.text}<span>Insert text element (span)</span>`;
    textBtn.addEventListener('click', () => {
      const at = state.insertNode({ elmType: 'span', _elmName: 'Text', txtContent: 'Text' });
      state.select(at);
      onToast('Inserted a text element');
      closeSnapMenu();
    });
    panel.appendChild(textBtn);

    // ── Insert Frame ──────────────────────────────────────────────────
    const frameBtn = document.createElement('button');
    frameBtn.type = 'button';
    frameBtn.className = 'wb-kebab-item';
    frameBtn.dataset.tool = 'frame';
    frameBtn.title = 'Insert a container (div) with border and padding';
    frameBtn.innerHTML = `${MENU_ICONS.frame}<span>Insert container (div)</span>`;
    frameBtn.addEventListener('click', () => {
      const at = state.insertNode({
        elmType: 'div', _elmName: 'Frame',
        style: {
          'display': 'flex', 'align-items': 'center', 'padding': '8px',
          'border-width': '1px', 'border-style': 'solid', 'border-color': '#e1dfdd', 'border-radius': '4px',
        },
      });
      state.select(at);
      onToast('Inserted a frame');
      closeSnapMenu();
    });
    panel.appendChild(frameBtn);

    // ── Insert Icon ──────────────────────────────────────────────────
    const iconBtn = document.createElement('button');
    iconBtn.type = 'button';
    iconBtn.className = 'wb-kebab-item';
    iconBtn.dataset.tool = 'icon';
    iconBtn.title = 'Insert a Fluent icon';
    iconBtn.innerHTML = `${MENU_ICONS.icon}<span>Insert Fluent icon</span>`;
    iconBtn.addEventListener('click', () => {
      closeSnapMenu();
      openIconPicker({
        anchor: anchor,
        title: 'Pick an icon to insert',
        onPick: (name: string) => {
          const node: SPElement = { elmType: 'span', _elmName: 'Icon', attributes: { iconName: name } };
          const at = state.insertNode(node);
          state.select(at);
          onToast(`Inserted icon: ${name}`);
        },
      });
    });
    panel.appendChild(iconBtn);

    // ── More Elements ────────────────────────────────────────────────
    const paletteBtn = document.createElement('button');
    paletteBtn.type = 'button';
    paletteBtn.className = 'wb-kebab-item wb-tool-palette';
    paletteBtn.dataset.tool = 'palette';
    paletteBtn.title = 'More elements — the full palette';
    paletteBtn.innerHTML = `${MENU_ICONS.more}<span>More elements (palette)</span>`;
    paletteBtn.addEventListener('click', () => {
      closeSnapMenu();
      openPalettePop(anchor);
    });
    panel.appendChild(paletteBtn);

    // ── Divider ──
    const sep2 = document.createElement('div');
    sep2.className = 'wb-kebab-sep';
    panel.appendChild(sep2);

    const head = document.createElement('div');
    head.className = 'wb-snapmenu-head';
    head.textContent = 'Snapshots';
    panel.appendChild(head);

    const take = document.createElement('button');
    take.type = 'button';
    take.className = 'wb-snap-take';
    take.textContent = 'Take a snapshot';
    take.title = 'Capture the whole workspace — the grid, every named view, and every column formatter — and restore it from this menu any time';
    take.addEventListener('click', () => {
      const snap = state.captureSnapshot({ kind: 'all' });
      if (!snap) { onToast('Nothing to snapshot yet'); return; }
      if (!writeStore(addSnapshot(readStore(), snap))) {
        onToast('Could not save the snapshot — browser storage is full or blocked');
        return;
      }
      onToast('Snapshot taken of the whole workspace');
      render();
    });
    panel.appendChild(take);

    const rowFor = (snap: Snapshot, restoreTitle: string): HTMLElement => {
      const row = document.createElement('div');
      row.className = 'wb-snap-row';

      const restore = document.createElement('button');
      restore.type = 'button';
      restore.className = 'wb-snap-restore';
      restore.title = restoreTitle;
      const name = document.createElement('span');
      name.className = 'wb-snap-label';
      name.textContent = snap.label;
      const when = document.createElement('span');
      when.className = 'wb-snap-when';
      when.textContent = relativeTime(snap.takenAt, new Date());
      when.title = new Date(snap.takenAt).toLocaleString();
      restore.append(name, when);
      restore.addEventListener('click', () => {
        if (!state.applySnapshot(snap)) {
          onToast('This snapshot could not be restored (its data is missing or corrupt)');
          return;
        }
        closeSnapMenu();
        onToast(`Restored ${snap.label} — Ctrl+Z brings back what you had`);
      });

      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'wb-snap-del';
      del.textContent = '✕';
      del.title = 'Delete this snapshot';
      del.setAttribute('aria-label', `Delete snapshot ${snap.label}`);
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        writeStore(removeSnapshot(readStore(), snap.id));
        render();
      });

      row.append(restore, del);
      return row;
    };

    const snaps = snapshotsFor(store, { kind: 'all' });
    if (!snaps.length) {
      const none = document.createElement('div');
      none.className = 'wb-snapmenu-empty';
      none.textContent = 'No snapshots yet — take one above before you experiment.';
      panel.appendChild(none);
    }
    for (const snap of snaps) {
      panel.appendChild(rowFor(
        snap,
        'Restore this snapshot — one undoable step (Ctrl+Z brings the current state back)',
      ));
    }

    const legacy = store.snapshots
      .filter((s) => s.scope.kind !== 'all')
      .sort((a, b) => b.takenAt.localeCompare(a.takenAt));
    if (legacy.length) {
      const details = document.createElement('details');
      details.className = 'wb-snap-legacy';
      details.open = legacyOpen;
      details.addEventListener('toggle', () => { legacyOpen = details.open; });
      const summary = document.createElement('summary');
      summary.className = 'wb-snapmenu-group';
      summary.textContent = `Older, scoped snapshots (${legacy.length})`;
      summary.title = 'Taken before snapshots covered the whole workspace — each restores only the column it captured';
      details.appendChild(summary);
      for (const snap of legacy) {
        details.appendChild(rowFor(
          snap,
          'Restore this older snapshot — it only covers the column it captured (one undoable step)',
        ));
      }
      panel.appendChild(details);
    }
  };

  render();
  document.body.appendChild(panel);

  const r = anchor.getBoundingClientRect();
  panel.style.top = `${Math.min(r.bottom + 6, Math.max(8, window.innerHeight - 440))}px`;
  panel.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - 300))}px`;

  let done = false;
  const close = (): void => { if (!done) { done = true; closeSnapMenu(); } };
  const onOutside = (e: PointerEvent): void => {
    if (!panel.contains(e.target as Node) && !anchor.contains(e.target as Node)) close();
  };
  const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') close(); };
  const armTimer = window.setTimeout(() => document.addEventListener('pointerdown', onOutside), 0);
  document.addEventListener('keydown', onKey);
  const cleanup = (): void => {
    window.clearTimeout(armTimer);
    document.removeEventListener('pointerdown', onOutside);
    document.removeEventListener('keydown', onKey);
  };
  openPanel = { panel, cleanup };
}

