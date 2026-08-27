// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Sam Yost

/**
 * editor/sideDocSwitcher.ts — the side pane's doc switcher: a compact
 * "current doc" button in the side-pane head (beside JSON ⇄ Explain) that
 * names what the pane is describing and, on click, lists every open canvas
 * tab. Picking one NAVIGATES through the exact chokepoints the canvas strip
 * uses (minimizeView / openView / openComponentTab) — both renderers are
 * stateless projections of state.openTabs + activeTabKey, so they can never
 * disagree and no second tab state exists. It matters most with the JSON
 * pane maximized: the canvas strip is covered, and this button is the only
 * visible "where am I" and way to switch.
 *
 * Dirty component tabs wear the same unsaved marker as the strip's dot,
 * read from the shared state.workshopDirty registry.
 */

import { state, tabKey, type CanvasTab } from './state';
import { componentById } from './componentLibrary';
import { openMenu, type MenuItem } from './menu';

export function mountSideDocSwitcher(host: HTMLElement, onToast: (m: string) => void): void {
  host.classList.add('wb-side-doc');
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'wb-side-doc-btn';
  btn.setAttribute('aria-haspopup', 'menu');
  const mark = document.createElement('span');
  mark.className = 'wb-side-doc-mark';
  mark.setAttribute('aria-hidden', 'true');
  const name = document.createElement('span');
  name.className = 'wb-side-doc-name';
  const caret = document.createElement('span');
  caret.className = 'wb-side-doc-caret';
  caret.setAttribute('aria-hidden', 'true');
  caret.textContent = '▾';
  btn.append(mark, name, caret);
  host.appendChild(btn);

  /** The strip's face conventions, verbatim: ▦ Grid, ☰ row / ▤ tile views,
   *  ⬡ component workshops (plus the matching menu icons). */
  const tabFace = (t: CanvasTab): { mark: string; name: string; icon: string } => {
    if (t.kind === 'grid') return { mark: '▦', name: 'Grid', icon: 'GridViewMedium' };
    if (t.kind === 'view') {
      const v = state.viewById(t.id);
      const tile = v?.doc.kind === 'tile';
      return { mark: tile ? '▤' : '☰', name: v?.name ?? t.id, icon: tile ? 'Tiles' : 'AlignLeft' };
    }
    return { mark: '⬡', name: componentById(t.defId)?.name ?? t.defId, icon: 'CubeShape' };
  };

  const itemFor = (t: CanvasTab, activeKey: string): MenuItem => {
    const key = tabKey(t);
    const face = tabFace(t);
    const dirty = t.kind === 'component' && state.workshopDirty(t.defId);
    return {
      icon: face.icon,
      label: face.name,
      ...(dirty ? { badge: '● unsaved' } : {}),
      current: key === activeKey,
      title: t.kind === 'grid'
        ? 'Back to the columns grid — any open view waits in its tab'
        : t.kind === 'view'
          ? `Open the “${face.name}” view`
          : `Open the ${face.name} workshop — the JSON tab shows its staged JSON`,
      fn: () => {
        if (key === state.activeTabKey) return;
        if (t.kind === 'grid') {
          state.minimizeView();
        } else if (t.kind === 'view') {
          state.openView(t.id);
          onToast(`Opened “${state.viewById(t.id)?.name ?? t.id}”`);
        } else {
          state.openComponentTab(t.defId);
        }
      },
    };
  };

  btn.addEventListener('click', () => {
    const activeKey = state.activeTabKey;
    openMenu(btn, 'On the canvas', state.openTabs.map((t) => itemFor(t, activeKey)));
  });

  const render = (): void => {
    const t = state.openTabs.find((x) => tabKey(x) === state.activeTabKey)
      ?? { kind: 'grid' as const };
    const face = tabFace(t);
    mark.textContent = face.mark;
    name.textContent = face.name;
    // claims the active TAB, never "what this pane shows" — the Explain tab
    // keeps describing the underlying surface while a workshop is active
    btn.title = `Active canvas tab: “${face.name}” — click to switch between the open tabs`;
    btn.setAttribute('aria-label', `Canvas tab switcher — ${face.name} is active`);
  };

  const hostAny = host as unknown as { _unsub?: () => void };
  hostAny._unsub?.();
  // same re-render reasons as the canvas strip: navigation ('load'), tab /
  // rename / dirty-registry changes ('data'), a sheet's row⇄tile flip ('kind')
  hostAny._unsub = state.subscribe((reason) => {
    if (reason === 'load' || reason === 'data' || reason === 'kind') render();
  });
  render();
}
