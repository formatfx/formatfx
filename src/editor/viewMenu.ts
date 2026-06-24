/**
 * editor/viewMenu.ts — the View Formatters menu, anchored under the breadcrumb
 * root crumb when the main (view) formatter is on the canvas.
 *
 * v1 is deliberately tiny: it lists the one view and lets you Rename it inline.
 * It is the shell the spec's future multi-view grows into — the menu already
 * frames "views" as a list with per-view actions, so "+ New view" / switching
 * is additive later. One Rename = one `state.setViewName` (project metadata,
 * off the undo stack).
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
  panel.className = 'wb-viewmenu';

  const head = document.createElement('div');
  head.className = 'wb-viewmenu-head';
  head.textContent = 'View Formatters';
  panel.appendChild(head);

  const row = document.createElement('div');
  row.className = 'wb-viewmenu-row';

  const name = document.createElement('span');
  name.className = 'wb-viewmenu-name';
  name.textContent = state.viewName;

  const rename = document.createElement('button');
  rename.type = 'button';
  rename.className = 'wb-viewmenu-rename';
  rename.textContent = 'Rename';
  rename.title = 'Rename this view — Enter to commit, Esc to cancel';

  row.append(name, rename);
  panel.appendChild(row);

  // Rename → inline input, prefilled with the current name.
  rename.addEventListener('click', () => {
    row.replaceChildren();
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'wb-viewmenu-input';
    input.value = state.viewName;
    row.appendChild(input);

    let committed = false;
    const commit = (): void => {
      if (committed) return;
      committed = true;
      state.setViewName(input.value);
      onToast(`View renamed to “${state.viewName}”`);
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

  // "+ New rowview" — start a fresh row view from a pre-built template, so the
  // feature is reachable from the landing screen, not only after entering Row View.
  const newRow = document.createElement('button');
  newRow.type = 'button';
  newRow.className = 'wb-viewmenu-newrow';
  newRow.textContent = '+ New rowview…';
  newRow.title = 'Start a new row view from a pre-built template';
  newRow.addEventListener('click', () => {
    closeViewMenu();
    openTemplateModal(onToast);
  });
  panel.appendChild(newRow);

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
