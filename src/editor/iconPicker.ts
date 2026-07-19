// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Sam Yost

/**
 * editor/iconPicker.ts — the Fluent icon gallery: a searchable, grouped grid of
 * every icon SharePoint's `iconName` actually renders (iconData.ts), each shown
 * with a live preview (the Fabric `ms-Icon` font). Used two ways:
 *   • inline (renderIconGrid) — embedded in the Field guide's icon reference;
 *   • floating (openIconPicker) — anchored next to the fx bar's Icon slot.
 *
 * Picking is click-only and refuse-proof: every name comes from the verified
 * list, so a choice can only ever be an icon that works on a real list.
 */

import { ICON_GROUPS, ALL_ICONS, NO_PREVIEW_ICONS } from './iconData';

export interface IconGridOptions {
  /** The currently chosen icon, highlighted and scrolled to on open. */
  current?: string;
  /** Called with the icon name when one is clicked. */
  onPick: (name: string) => void;
  /** Verb for the per-icon tooltip, e.g. 'Use' (default) or 'Copy'. */
  verb?: string;
}

/**
 * Fill `host` with a search box + a grouped, preview-rich icon grid. Returns a
 * focus helper for the search field. The grid is built once; searching toggles
 * visibility rather than rebuilding, so it stays instant across ~2,000 icons.
 */
export function renderIconGrid(host: HTMLElement, opts: IconGridOptions): { focus: () => void } {
  host.classList.add('wb-icongrid');
  host.innerHTML = '';

  const search = document.createElement('input');
  search.type = 'search';
  search.className = 'wb-icongrid-search';
  search.placeholder = `Search ${ALL_ICONS.length} icons…`;

  const count = document.createElement('div');
  count.className = 'wb-icongrid-count';

  const scroll = document.createElement('div');
  scroll.className = 'wb-icongrid-scroll';

  // build every group + item once; keep handles (grouped) for fast filtering
  interface GroupView { head: HTMLElement; grid: HTMLElement; cells: { btn: HTMLElement; lc: string }[]; }
  const groupViews: GroupView[] = [];
  let total = 0;
  for (const group of ICON_GROUPS) {
    const head = document.createElement('div');
    head.className = 'wb-icongrid-group';
    head.textContent = group.name;
    const grid = document.createElement('div');
    grid.className = 'wb-icongrid-cells';
    const cells: GroupView['cells'] = [];
    for (const name of group.icons) {
      const btn = document.createElement('button');
      btn.type = 'button';
      const noPreview = NO_PREVIEW_ICONS.has(name);
      btn.className = 'wb-iconcell' + (name === opts.current ? ' selected' : '') + (noPreview ? ' wb-iconcell-nopreview' : '');
      btn.title = noPreview ? `${opts.verb ?? 'Use'} ${name} (renders in SharePoint; no preview here)` : `${opts.verb ?? 'Use'} ${name}`;
      // a neutral glyph stands in where the bundled font has no preview
      const glyph = noPreview ? 'Picture' : name;
      btn.innerHTML = `<i class="ms-Icon ms-Icon--${glyph}" aria-hidden="true"></i><span>${name}</span>`;
      btn.addEventListener('click', () => opts.onPick(name));
      grid.appendChild(btn);
      cells.push({ btn, lc: name.toLowerCase() });
    }
    scroll.append(head, grid);
    groupViews.push({ head, grid, cells });
    total += cells.length;
  }

  const apply = () => {
    const q = search.value.trim().toLowerCase();
    let shown = 0;
    for (const g of groupViews) {
      let groupShown = 0;
      for (const cell of g.cells) {
        const hit = q === '' || cell.lc.includes(q);
        cell.btn.style.display = hit ? '' : 'none';
        if (hit) groupShown++;
      }
      // hide a group header+grid whose every cell is filtered out — counted
      // inline, no per-keystroke DOM querying or inline-style string matching
      const visible = groupShown > 0;
      g.head.style.display = visible ? '' : 'none';
      g.grid.style.display = visible ? '' : 'none';
      shown += groupShown;
    }
    count.textContent = q ? `${shown} match${shown === 1 ? '' : 'es'}` : `${total} icons · ${ICON_GROUPS.length} groups`;
  };
  search.addEventListener('input', apply);

  host.append(search, count, scroll);
  apply();

  // bring the current selection into view
  if (opts.current) {
    const sel = scroll.querySelector<HTMLElement>('.wb-iconcell.selected');
    sel?.scrollIntoView({ block: 'center' });
  }
  return { focus: () => search.focus() };
}

export interface IconPickerOptions extends IconGridOptions {
  /** Anchor element the floating panel is positioned beside. */
  anchor: HTMLElement;
  /** Title shown in the panel head. */
  title?: string;
}

/**
 * Open the gallery as a floating panel anchored near `anchor`. Picking calls
 * `onPick` and closes; Esc or an outside click closes too.
 */
export function openIconPicker(opts: IconPickerOptions): { close: () => void } {
  const panel = document.createElement('div');
  // wb-esc-owner: this picker closes itself on Escape (onKey below) —
  // see the convention comment in editor/overlay.ts.
  panel.className = 'wb-iconpicker wb-esc-owner';

  const head = document.createElement('div');
  head.className = 'wb-iconpicker-head';
  const title = document.createElement('span');
  title.textContent = opts.title ?? 'Pick an icon';
  const x = document.createElement('button');
  x.type = 'button';
  x.className = 'wb-iconpicker-x';
  x.textContent = '✕';
  x.title = 'Close (Esc)';
  x.setAttribute('aria-label', 'Close');
  head.append(title, x);

  const gridHost = document.createElement('div');
  panel.append(head, gridHost);
  document.body.appendChild(panel);

  let done = false;
  const close = (): void => {
    if (done) return;
    done = true;
    document.removeEventListener('pointerdown', onOutside);
    document.removeEventListener('keydown', onKey);
    panel.remove();
  };
  x.addEventListener('click', close);

  const { focus } = renderIconGrid(gridHost, {
    ...opts,
    onPick: (name) => { opts.onPick(name); close(); },
  });

  // position under the anchor, kept on-screen
  const r = opts.anchor.getBoundingClientRect();
  panel.style.top = `${Math.min(r.bottom + 6, Math.max(8, window.innerHeight - 380))}px`;
  panel.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - 380))}px`;

  const onOutside = (e: PointerEvent): void => {
    if (!panel.contains(e.target as Node) && e.target !== opts.anchor) close();
  };
  const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') { e.preventDefault(); close(); } };
  setTimeout(() => document.addEventListener('pointerdown', onOutside), 0);
  document.addEventListener('keydown', onKey);
  focus();

  return { close };
}
