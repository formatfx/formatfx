/**
 * editor/contextMenu.ts — right-click on anything in the preview pane and
 * get the actions that apply to nearly every element, column or group —
 * no trip to the Structure pane or inspector required. Grid headers keep
 * their richer column menu (gridView wires right-click to it); everything
 * else with a data-sp-path gets this one. Every action is click-only and
 * undoable, so the menu works in basic mode too.
 */

import type { NodePath, SPElement } from '../core/types';
import { state, CARD_SEGMENT } from './state';
import { openMenu, type MenuItem } from './menu';
import { openElementPlayground } from './playground';
import { openCondFormat } from './condFormat';

const nameOf = (el: SPElement): string => el._elmName ?? `<${el.elmType}>`;

/** The shared "works on most things" action set for one element. */
export function elementMenuItems(path: NodePath, onToast: (m: string) => void): MenuItem[] {
  const node = state.nodeAt(path);
  if (!node) return [];
  const label = nameOf(node);
  // card roots live inside customCardProps — no sibling list to mutate
  const inSiblingList = path.length > 0 && path[path.length - 1] !== CARD_SEGMENT;
  const items: MenuItem[] = [];

  items.push({
    icon: 'Color',
    label: 'Restyle in playground',
    title: 'Open this element — with its parent, children and live data — in the consequence-free playground',
    fn: () => { state.select(path); openElementPlayground(path); },
  });
  items.push({
    icon: 'LightningBolt',
    label: 'Conditional formatting…',
    title: 'Paint this element by a field\'s value — pick conditions and looks, Excel-style without the dialog maze',
    fn: () => { state.select(path); openCondFormat({ kind: 'element', path }, onToast); },
  });
  items.push({
    icon: 'Rename',
    label: 'Rename…',
    title: 'Name this element — shows in the Structure pane, cosmetic only',
    fn: () => {
      const v = prompt(`Name this element (shows in the Structure pane):`, node._elmName ?? '');
      if (v === null) return;
      state.mutateDocument(() => {
        const t = v.trim();
        if (t) node._elmName = t; else delete node._elmName;
      });
    },
  });
  items.push({
    icon: 'GroupObject',
    label: 'Wrap in a container',
    title: 'Add a flex parent around this element (works on the root too)',
    fn: () => {
      state.wrapNode(path);
      onToast(`${label} wrapped in a new container — Ctrl+Z undoes`);
    },
  });
  if (inSiblingList && node.children?.length) {
    items.push({
      icon: 'Separator',
      label: 'Ungroup (keep children)',
      title: 'Dissolve this container — its children take its place (one undo step)',
      fn: () => {
        state.unwrapNode(path);
        onToast(`"${label}" ungrouped — Ctrl+Z to regroup`);
      },
    });
  }
  if (inSiblingList) {
    items.push({
      icon: 'Copy',
      label: 'Duplicate',
      fn: () => {
        state.duplicateNode(path);
        onToast(`${label} duplicated — the copy is selected`);
      },
    });
  }
  items.push({
    icon: 'Code',
    label: 'Copy element JSON',
    title: 'This element subtree as JSON — paste into a children array or keep as a snippet',
    fn: () => {
      navigator.clipboard.writeText(JSON.stringify(node, null, 2)).then(() =>
        onToast(`${label} JSON copied`));
    },
  });
  if (inSiblingList) {
    items.push({
      icon: 'Delete',
      label: 'Remove',
      title: 'Remove this element — Ctrl+Z brings it back',
      fn: () => {
        state.removeNode(path);
        onToast(`${label} removed — Ctrl+Z to undo`);
      },
    });
  }
  return items;
}

function pathFromAttr(raw: string | undefined): NodePath | undefined {
  if (raw === undefined) return undefined;
  return raw === '' ? [] : raw.split('.').map(Number);
}

function openFor(e: MouseEvent, pathTarget: HTMLElement, onToast: (m: string) => void): void {
  const path = pathFromAttr(pathTarget.dataset.spPath);
  if (path === undefined) return;
  const node = state.nodeAt(path);
  if (!node) return;
  e.preventDefault();
  state.select(path);
  openMenu({ x: e.clientX, y: e.clientY }, nameOf(node), elementMenuItems(path, onToast));
}

/** Wire right-click on the canvas (and card flyouts, which live on <body>). */
export function installPreviewContextMenu(host: HTMLElement, onToast: (m: string) => void): void {
  host.addEventListener('contextmenu', (e) => {
    const hit = (e.target as HTMLElement).closest('[data-sp-path]') as HTMLElement | null;
    if (hit) { openFor(e, hit, onToast); return; }
    // grid cells: the padding around a column's content still means the column
    const cell = (e.target as HTMLElement).closest('.wb-grid-cell') as HTMLElement | null;
    if (cell?.dataset.col !== undefined && state.doc.kind === 'grid') {
      const i = Number(cell.dataset.col);
      const path: NodePath = state.doc.root.children?.length ? [i] : [];
      const node = state.nodeAt(path);
      if (!node) return;
      e.preventDefault();
      state.select(path);
      openMenu({ x: e.clientX, y: e.clientY }, nameOf(node), elementMenuItems(path, onToast));
    }
  });
  document.addEventListener('contextmenu', (e) => {
    const flyout = (e.target as HTMLElement).closest?.('.wb-flyout');
    if (!flyout) return;
    const hit = (e.target as HTMLElement).closest('[data-sp-path]') as HTMLElement | null;
    if (hit) openFor(e, hit, onToast);
  });
}
