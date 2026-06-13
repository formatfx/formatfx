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
    // basic mode shows only `basic` items; groups with none disappear whole.
    // The label + grid live in one wrapper so the ribbon (basic) can stack
    // them as a labelled group, and so an all-advanced group hides entirely.
    const groupHasBasic = items.some((i) => i.basic);
    const wrap = document.createElement('div');
    wrap.className = 'wb-palette-group-wrap' + (groupHasBasic ? '' : ' wb-adv');
    const h = document.createElement('div');
    h.className = 'wb-palette-group';
    h.textContent = group;
    wrap.appendChild(h);
    const grid = document.createElement('div');
    grid.className = 'wb-palette-grid';
    for (const item of items) {
      const btn = document.createElement('button');
      btn.className = 'wb-palette-item' + (item.basic ? '' : ' wb-adv');
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
    wrap.appendChild(grid);
    host.appendChild(wrap);
  }
}

export function paletteItemById(id: string): PaletteItem | undefined {
  return PALETTE.find((p) => p.id === id);
}
