// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sam Yost. FormatFX is dual-licensed: AGPL-3.0-only (see LICENSE) or a commercial license (see LICENSING.md).

/**
 * editor/columnShelf.ts — the COLUMNS SHELF (COLUMNS-COMPONENTS-VIEWS §3.4):
 * "Columns — your data". One typed chip per non-protected field. A column is
 * just DATA here — chips carry no formatter state, no ⬡ mark, no preview;
 * whether the column wears a look only shows where the look lives (the grid,
 * the inventory).
 *
 * Two gestures, both landing through the one look-aware cell generator
 * (gridCellForField — a look-wearing column arrives dressed, a bare one
 * arrives as the plain value):
 *   · DRAG a chip (FIELD_MIME, payload = the field name) onto the tree, the
 *     canvas, or a template-builder zone; view tabs in the canvas strip
 *     spring open under the drag (§5).
 *   · CLICK a chip to insert into the ACTIVE surface at the selection — on
 *     the grid it arrives as a new root column. One undoable step
 *     (state.insertNode). While a component workshop covers the canvas the
 *     click refuses and teaches — the staged def is not a surface.
 */

import { state } from './state';
import { FIELD_MIME } from './templateUi';
import { gridCellForField } from './gridScaffold';
import type { FieldType, MockField } from '../core/types';

// FIELD_MIME's single declaration lives in templateUi.ts (the template
// builder's chips shipped it first) — re-exported here so drop targets can
// name the shelf, its natural source, without caring about that history.
export { FIELD_MIME };

/** Dim type tag for a chip, e.g. "date" / "multi-person". */
export const FIELD_TYPE_LABEL: Record<FieldType, string> = {
  text: 'text', note: 'multiline', number: 'number', currency: 'currency',
  choice: 'choice', choiceMulti: 'multi-choice', date: 'date',
  person: 'person', personMulti: 'multi-person', boolean: 'yes/no',
  hyperlink: 'hyperlink', lookup: 'lookup', lookupMulti: 'multi-lookup',
};

export function mountColumnShelf(host: HTMLElement, onToast: (m: string) => void): void {
  host.classList.add('wb-colshelf');

  const insertField = (field: MockField): void => {
    if (state.activeComponentTab !== null) {
      // the workshop is covering the canvas — the staged def is not a
      // surface, so there is nowhere honest to land the cell
      onToast('A component workshop is open — switch to the Grid or a view tab first, then add the column there.');
      return;
    }
    const cell = gridCellForField(field, state.columnLooks);
    // on the grid, root children ARE the view columns — arrive as a new one;
    // on a view, insert at the selection like a palette click
    const at = state.doc.kind === 'grid' ? [] : undefined;
    state.insertNode(cell, at);
    onToast(`Added the ${field.displayName ?? field.name} column${state.doc.kind === 'grid' ? ' to the grid' : ''} — Ctrl+Z removes it`);
  };

  const render = (): void => {
    host.replaceChildren();

    // The "Columns" title + fold control live on the pane-section header
    // (leftPane.ts) now — a column is still just data; formatting lives in
    // components, not here.
    const rack = document.createElement('div');
    rack.className = 'wb-colshelf-rack';
    for (const field of state.fields.filter((f) => !f.protected)) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'wb-colchip';
      chip.title = `Insert the ${field.displayName ?? field.name} column into the open surface — or drag it where it should go`;

      const name = document.createElement('span');
      name.className = 'wb-colchip-name';
      name.textContent = field.displayName ?? field.name;
      const type = document.createElement('span');
      type.className = 'wb-colchip-type';
      type.textContent = FIELD_TYPE_LABEL[field.type] ?? field.type;
      chip.append(name, type);

      chip.draggable = true;
      chip.addEventListener('dragstart', (e) => {
        if (!e.dataTransfer) return;
        e.dataTransfer.setData(FIELD_MIME, field.name);
        e.dataTransfer.effectAllowed = 'copy';
      });
      chip.addEventListener('click', () => insertField(field));
      rack.appendChild(chip);
    }
    if (!rack.children.length) {
      const none = document.createElement('div');
      none.className = 'wb-colshelf-empty';
      none.textContent = 'No columns yet — add some in the Data panel below the canvas.';
      rack.appendChild(none);
    }
    host.appendChild(rack);
  };

  const hostAny = host as unknown as { _unsub?: () => void };
  hostAny._unsub?.();
  hostAny._unsub = state.subscribe((reason) => {
    // 'data' = schema edits (fields added/renamed/retyped); 'load' = a whole
    // new workspace. Looks/selection don't matter — chips carry neither.
    if (reason === 'data' || reason === 'load') render();
  });
  render();
}
