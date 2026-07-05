/**
 * editor/viewMenu.ts — the View Formatters menu, anchored under the Left Edit
 * Pane's document dropdown. FLOOR-AND-SHEETS Stage 1 made this the real
 * multi-view list: every named sheet — click one to open it (NAVIGATION,
 * never a mutation), Rename it inline, or start a new row/tile view from a
 * template. One Rename = one `state.renameView` (project metadata, off the
 * undo stack). The old "◧ Grid" floor row is gone (Stage 2 follow-up): the
 * grid is the COLUMNS tab's canvas, so this menu is views-only — matching
 * the strip.
 */

import { state } from './state';
import { openTemplateModal } from './templateModal';

let openPanel: { panel: HTMLElement; cleanup: () => void } | null = null;

export function closeViewMenu(): void {
  if (!openPanel) return;
  openPanel.cleanup();
  openPanel.panel.remove();
  openPanel = null;
}

/** Open the View Formatters menu anchored under `anchor`. */
export function openViewMenu(anchor: HTMLElement, onToast: (m: string) => void): void {
  closeViewMenu();

  const panel = document.createElement('div');
  // wb-esc-owner: this menu closes itself on a document-level Escape (onKey
  // below) — see the convention comment in editor/overlay.ts. It was the one
  // self-closing popover missing the marker (found by the Stage-4 audit).
  panel.className = 'wb-viewmenu wb-esc-owner';

  const head = document.createElement('div');
  head.className = 'wb-viewmenu-head';
  head.textContent = 'View Formatters';
  panel.appendChild(head);

  // ── the sheets: one row per named view (the grid lives on COLUMNS) ───────
  for (const view of state.views) {
    const row = document.createElement('div');
    row.className = 'wb-viewmenu-row' + (state.activeViewId === view.id ? ' wb-viewmenu-active' : '');

    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'wb-viewmenu-open wb-viewmenu-name';
    open.textContent = view.name;
    open.title = state.activeViewId === view.id
      ? 'This view is on the canvas'
      : `Open “${view.name}” (${view.doc.kind === 'tile' ? 'tile' : 'row'} view)`;
    open.addEventListener('click', () => {
      closeViewMenu();
      if (state.activeViewId !== view.id) {
        state.openView(view.id);
        onToast(`Opened “${view.name}”`);
      }
    });

    const rename = document.createElement('button');
    rename.type = 'button';
    rename.className = 'wb-viewmenu-rename';
    rename.textContent = 'Rename';
    rename.title = 'Rename this view — Enter to commit, Esc to cancel';
    rename.addEventListener('click', () => {
      row.replaceChildren();
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'wb-viewmenu-input';
      input.value = view.name;
      row.appendChild(input);

      let committed = false;
      const commit = (): void => {
        if (committed) return;
        committed = true;
        state.renameView(view.id, input.value);
        onToast(`View renamed to “${state.viewById(view.id)?.name ?? view.name}”`);
        closeViewMenu();
      };
      const cancel = (): void => {
        if (committed) return;
        committed = true;
        closeViewMenu();
      };
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); commit(); }
        else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
      });
      input.addEventListener('blur', commit);
      input.focus();
      input.select();
    });

    row.append(open, rename);
    panel.appendChild(row);
  }

  if (!state.views.length) {
    const none = document.createElement('div');
    none.className = 'wb-viewmenu-empty';
    none.textContent = 'No views yet — a view is a whole-row layout built from your columns and components. Select columns on the grid or start from a template below.';
    panel.appendChild(none);
  }

  // "+ New rowview" / "+ New tileview" — start a fresh layout from a pre-built
  // template. Saving from the floor CREATES a new named view (nothing is ever
  // overwritten); both buttons open the SAME builder, tileview just leads its
  // gallery with the tile layouts.
  const newRow = document.createElement('button');
  newRow.type = 'button';
  newRow.className = 'wb-viewmenu-newrow';
  newRow.textContent = '+ New rowview…';
  newRow.title = 'Start a new row view from a pre-built template — it becomes its own named view';
  newRow.addEventListener('click', () => {
    closeViewMenu();
    openTemplateModal(onToast, { target: 'row', createNew: true });
  });
  panel.appendChild(newRow);

  const newTile = document.createElement('button');
  newTile.type = 'button';
  newTile.className = 'wb-viewmenu-newtile';
  newTile.textContent = '+ New tileview…';
  newTile.title = 'Start a tile (gallery) layout from a pre-built template — it becomes its own named view';
  newTile.addEventListener('click', () => {
    closeViewMenu();
    openTemplateModal(onToast, { target: 'tile', createNew: true });
  });
  panel.appendChild(newTile);

  document.body.appendChild(panel);

  // position under the anchor, kept on-screen
  const r = anchor.getBoundingClientRect();
  panel.style.top = `${Math.min(r.bottom + 6, Math.max(8, window.innerHeight - 160))}px`;
  panel.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - 240))}px`;

  let done = false;
  const close = (): void => { if (!done) { done = true; closeViewMenu(); } };
  const onOutside = (e: PointerEvent): void => {
    if (!panel.contains(e.target as Node) && e.target !== anchor) close();
  };
  const onKey = (e: KeyboardEvent): void => {
    // Esc closes the menu — unless the inline rename input is handling it
    if (e.key === 'Escape' && !panel.querySelector('.wb-viewmenu-input')) close();
  };
  // Defer arming the outside-close listeners so the opening click doesn't
  // close the menu it just opened. If the menu closes before this fires
  // (rapid open/close, test afterEach), cleanup clears the timer so the
  // listeners are never added — no leaked handlers.
  const armTimer = window.setTimeout(() => {
    document.addEventListener('pointerdown', onOutside);
    document.addEventListener('keydown', onKey);
  }, 0);
  const cleanup = (): void => {
    window.clearTimeout(armTimer);
    document.removeEventListener('pointerdown', onOutside);
    document.removeEventListener('keydown', onKey);
  };
  openPanel = { panel, cleanup };
}
