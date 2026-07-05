/**
 * editor/viewStrip.ts — the left VIEW STRIP (FLOOR-AND-SHEETS Stage 2, as
 * amended by the owner 2026-07-05).
 *
 * The workbook's sheet tabs, on the left with the other view actions: one
 * chip per named sheet and a ＋ on-ramp to the template builder. There is
 * deliberately NO grid/floor chip — the grid IS the COLUMNS tab's canvas
 * (no flip-flop button; clicking COLUMNS drops to the grid). Clicking a
 * chip is NAVIGATION (openView — never a mutation, never an undo step) and
 * works while drilled into a column formatter: the surface underneath
 * switches, the drill stays put (§2.2's owner requirement). Double-click a
 * sheet chip to rename it inline (one renameView — project metadata, off
 * the undo stack, same semantics as the View Formatters menu). This strip
 * supersedes the row-view toolbar's "◧ Back to grid" button and the grid's
 * "⟳ Reopen" bar.
 */

import { state } from './state';
import { openMenu } from './menu';
import { openTemplateModal } from './templateModal';

export function mountViewStrip(host: HTMLElement, onToast: (m: string) => void): void {
  host.classList.add('wb-viewstrip');
  host.setAttribute('role', 'tablist');
  host.setAttribute('aria-label', 'Views');

  /** Swap a sheet chip for an inline rename input (Enter commits, Esc cancels,
   *  blur commits — the viewMenu convention). */
  const startRename = (chip: HTMLButtonElement, viewId: string): void => {
    const view = state.viewById(viewId);
    if (!view) return;
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'wb-viewstrip-input';
    input.value = view.name;
    input.setAttribute('aria-label', `Rename the ${view.name} view`);
    chip.replaceWith(input);

    let done = false;
    const commit = (): void => {
      if (done) return;
      done = true;
      state.renameView(viewId, input.value); // emits 'data' → the strip re-renders
      const now = state.viewById(viewId)?.name ?? view.name;
      if (now !== view.name) onToast(`View renamed to “${now}”`);
      else render();
    };
    const cancel = (): void => {
      if (done) return;
      done = true;
      render();
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); commit(); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancel(); }
    });
    input.addEventListener('blur', commit);
    input.focus();
    input.select();
  };

  const render = (): void => {
    host.replaceChildren();

    // ── the sheets: one chip per named view ──────────────────────────────────
    for (const view of state.views) {
      const active = state.activeViewId === view.id;
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'wb-viewstrip-chip wb-viewstrip-sheet' + (active ? ' active' : '');
      chip.setAttribute('role', 'tab');
      chip.setAttribute('aria-selected', String(active));
      chip.textContent = view.name;
      chip.title = (active
        ? 'This view is on the canvas'
        : `Open “${view.name}” (${view.doc.kind === 'tile' ? 'tile' : 'row'} view)`)
        + ' — double-click to rename';
      chip.addEventListener('click', () => {
        if (state.activeViewId === view.id) return;
        state.openView(view.id);
        onToast(`Opened “${view.name}”`);
      });
      chip.addEventListener('dblclick', () => startRename(chip, view.id));
      host.appendChild(chip);
    }

    // ── ＋: the template-builder on-ramps (same pair as the view menu) ────────
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'wb-viewstrip-add';
    add.textContent = '＋';
    add.setAttribute('aria-label', 'New view');
    add.title = 'New view — start a row or tile layout from a pre-built template';
    add.addEventListener('click', (e) => {
      e.stopPropagation();
      openMenu(add, 'New view', [
        {
          icon: 'ViewList', label: 'New rowview…',
          title: 'Start a new row view from a pre-built template — it becomes its own named view',
          fn: () => openTemplateModal(onToast, { target: 'row', createNew: true }),
        },
        {
          icon: 'Tiles', label: 'New tileview…',
          title: 'Start a tile (gallery) layout from a pre-built template — it becomes its own named view',
          fn: () => openTemplateModal(onToast, { target: 'tile', createNew: true }),
        },
      ]);
    });
    host.appendChild(add);
  };

  const hostAny = host as unknown as { _unsub?: () => void };
  hostAny._unsub?.();
  hostAny._unsub = state.subscribe((reason) => {
    // 'load' = navigation/doc switch, 'data' = rename/registry, 'kind' = a
    // sheet's row⇄tile flip (retitles its chip tooltip)
    if (reason === 'load' || reason === 'data' || reason === 'kind') render();
  });
  render();
}
