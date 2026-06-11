/**
 * editor/palette.ts — Element palette. Click inserts into the selected
 * container; items are also draggable onto the canvas / tree.
 */

import { PALETTE, instantiate, type PaletteItem } from './presets';
import { state } from './state';

export function mountPalette(host: HTMLElement): void {
  host.innerHTML = '';
  const groups = new Map<string, PaletteItem[]>();
  for (const item of PALETTE) {
    if (!groups.has(item.group)) groups.set(item.group, []);
    groups.get(item.group)!.push(item);
  }
  for (const [group, items] of groups) {
    const h = document.createElement('div');
    h.className = 'wb-palette-group';
    h.textContent = group;
    host.appendChild(h);
    const grid = document.createElement('div');
    grid.className = 'wb-palette-grid';
    for (const item of items) {
      const btn = document.createElement('button');
      btn.className = 'wb-palette-item';
      btn.title = `${item.label} — ${item.description}`;
      btn.draggable = true;
      btn.innerHTML = `<i class="ms-Icon ms-Icon--${item.icon}" aria-hidden="true"></i><span>${item.label}</span>`;
      btn.addEventListener('click', () => {
        state.insertNode(instantiate(item, state.fields));
      });
      btn.addEventListener('dragstart', (e) => {
        e.dataTransfer?.setData('application/x-wb-palette', item.id);
        e.dataTransfer!.effectAllowed = 'copy';
      });
      grid.appendChild(btn);
    }
    host.appendChild(grid);
  }
}

export function paletteItemById(id: string): PaletteItem | undefined {
  return PALETTE.find((p) => p.id === id);
}
