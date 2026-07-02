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
    // The full palette shows everywhere now (Sheet keeps it in the far-left
    // pane, same as the studio). Label + grid share one wrapper.
    const wrap = document.createElement('div');
    wrap.className = 'wb-palette-group-wrap';
    const h = document.createElement('div');
    h.className = 'wb-palette-group';
    h.textContent = group;
    wrap.appendChild(h);
    const grid = document.createElement('div');
    grid.className = 'wb-palette-grid';
    for (const item of items) {
      const btn = document.createElement('button');
      btn.className = 'wb-palette-item';
      btn.title = `${item.label} — ${item.description}`;
      btn.draggable = true;
      const i = document.createElement('i');
      i.className = `ms-Icon ms-Icon--${item.icon}`;
      i.setAttribute('aria-hidden', 'true');
      const span = document.createElement('span');
      span.textContent = item.label;
      btn.append(i, span);
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
