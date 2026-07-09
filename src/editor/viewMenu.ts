// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sam Yost. FormatFX is dual-licensed: AGPL-3.0-only (see LICENSE) or a commercial license (see LICENSING.md).

/**
 * editor/viewMenu.ts — the VIEWS LIST section of the Left Edit Pane
 * (COLUMNS-COMPONENTS-VIEWS §2-3: "viewMenu becomes the views list in the
 * pane"). The old anchored popover (reached from the retired document pill)
 * is now a standing section: one row per named sheet — clicking one opens
 * (or focuses) its canvas tab, NAVIGATION only, never a mutation; ✎/dblclick
 * renames inline (one `state.renameView` — project metadata, off the undo
 * stack); the ＋ on-ramps start a new row/tile view from the template
 * builder. The composition section sits LAST in the pane, after the columns
 * and components it's built from (the owner's left-to-right mental model).
 */

import { state } from './state';
import { openTemplateModal } from './templateModal';

export function mountViewsList(host: HTMLElement, onToast: (m: string) => void): void {
  host.classList.add('wb-viewslist');
  // rename-in-progress, by view id — render state, because any 'data' emit
  // (the rename itself included) re-renders the whole list
  let renameId: string | null = null;

  const startRename = (viewId: string): void => {
    renameId = viewId;
    render();
    const input = host.querySelector<HTMLInputElement>('.wb-viewslist-input');
    if (input) { input.focus(); input.select(); }
  };

  const renameInput = (viewId: string): HTMLInputElement => {
    const view = state.viewById(viewId)!;
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'wb-viewslist-input';
    input.value = view.name;
    input.setAttribute('aria-label', `Rename the ${view.name} view`);
    let done = false;
    const commit = (): void => {
      if (done) return;
      done = true;
      renameId = null;
      state.renameView(viewId, input.value); // emits 'data' → the list re-renders
      const now = state.viewById(viewId)?.name ?? view.name;
      if (now !== view.name) onToast(`View renamed to “${now}”`);
      else render();
    };
    const cancel = (): void => {
      if (done) return;
      done = true;
      renameId = null;
      render();
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); commit(); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancel(); }
    });
    input.addEventListener('blur', commit);
    return input;
  };

  const render = (): void => {
    host.replaceChildren();
    // (no title row here — leftPane's collapsible "Views" section header
    // carries the title since 2026-07-09)

    for (const view of state.views) {
      const row = document.createElement('div');
      // the tab is "active" only when its surface is actually SHOWING — a
      // workshop covering the canvas unmarks the view row underneath
      const active = state.activeTabKey === `view:${view.id}`;
      row.className = 'wb-tree-row wb-viewslist-row' + (active ? ' selected' : '');

      if (renameId === view.id) {
        row.appendChild(renameInput(view.id));
        host.appendChild(row);
        continue;
      }

      const open = document.createElement('button');
      open.type = 'button';
      open.className = 'wb-viewslist-open';
      if (active) open.setAttribute('aria-current', 'true');
      const mark = document.createElement('span');
      mark.className = 'wb-viewslist-mark';
      mark.textContent = view.doc.kind === 'tile' ? '▤' : '☰';
      mark.setAttribute('aria-hidden', 'true');
      const name = document.createElement('span');
      name.className = 'wb-viewslist-name';
      name.textContent = view.name;
      const kind = document.createElement('span');
      kind.className = 'wb-tree-elmtype-dim';
      kind.textContent = view.doc.kind === 'tile' ? 'tile' : 'row';
      open.append(mark, name, kind);
      open.title = (active
        ? 'This view is on the canvas'
        : `Open “${view.name}” in its canvas tab`) + ' — double-click to rename';
      open.addEventListener('click', () => {
        const navigates = state.activeTabKey !== `view:${view.id}`;
        state.openView(view.id); // opens/focuses the tab; uncovers a workshop
        if (navigates) onToast(`Opened “${view.name}”`);
      });
      open.addEventListener('dblclick', () => startRename(view.id));
      row.appendChild(open);

      const actions = document.createElement('span');
      actions.className = 'wb-tree-actions';
      const rename = document.createElement('button');
      rename.type = 'button';
      rename.textContent = '✎';
      rename.title = `Rename ${view.name} — Enter commits, Esc cancels`;
      rename.setAttribute('aria-label', rename.title);
      rename.addEventListener('click', (e) => {
        e.stopPropagation();
        startRename(view.id);
      });
      actions.appendChild(rename);
      row.appendChild(actions);
      host.appendChild(row);
    }

    if (!state.views.length) {
      const none = document.createElement('div');
      none.className = 'wb-viewslist-empty';
      none.textContent = 'No views yet — a view is a whole-row layout built from your columns and components. Start one from a template below.';
      host.appendChild(none);
    }

    // ＋ on-ramps: both open the SAME builder; tileview leads with the tiles
    const newRow = document.createElement('button');
    newRow.type = 'button';
    newRow.className = 'wb-viewslist-new wb-viewslist-newrow';
    newRow.textContent = '＋ New rowview…';
    newRow.title = 'Start a new row view from a pre-built template — it becomes its own named view';
    newRow.addEventListener('click', () => openTemplateModal(onToast, { target: 'row', createNew: true }));
    host.appendChild(newRow);

    const newTile = document.createElement('button');
    newTile.type = 'button';
    newTile.className = 'wb-viewslist-new wb-viewslist-newtile';
    newTile.textContent = '＋ New tileview…';
    newTile.title = 'Start a tile (gallery) layout from a pre-built template — it becomes its own named view';
    newTile.addEventListener('click', () => openTemplateModal(onToast, { target: 'tile', createNew: true }));
    host.appendChild(newTile);
  };

  const hostAny = host as unknown as { _unsub?: () => void };
  hostAny._unsub?.();
  hostAny._unsub = state.subscribe((reason) => {
    // 'load' = navigation, 'data' = tab/rename/registry, 'kind' = row⇄tile
    // flips (a row's mark + tag)
    if (reason === 'load' || reason === 'data' || reason === 'kind') render();
  });
  render();
}
