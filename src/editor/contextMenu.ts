// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sam Yost. FormatFX is dual-licensed: AGPL-3.0 (see LICENSE) or a commercial license (see LICENSING.md).

/**
 * editor/contextMenu.ts — right-click on anything in the preview pane and
 * get the actions that apply to nearly every element, column or group —
 * no trip to the Structure pane or inspector required. Grid headers keep
 * their richer column menu (gridView wires right-click to it); everything
 * else with a data-sp-path gets this one. Every action is click-only and
 * undoable, so the menu works in basic mode too.
 */

import type { NodePath, SPElement } from '../core/types';
import { state, CARD_SEGMENT, samePath } from './state';
import { openMenu, openRenamePopover, type MenuItem } from './menu';
import { openCondFormat } from './condFormat';
import { openFormatCells } from './formatCells';
import { copyNodes, pasteNodes } from './clipboard';
import { openSaveAsComponent } from './componentLibrary';
import { elementRefChip } from './elmRef';

/** The element's user-facing name — its _elmName, else `<elmType>`. The single
 *  naming rule the menu header, the parent-crumb tooltip and the action toasts
 *  all share, so "Status" in the header never disagrees with "<div> removed"
 *  in a toast. */
const displayNameOf = (el: SPElement): string =>
  el._elmName ?? `<${el.elmType}>`;

/** The shared "works on most things" action set for one element. */
export function elementMenuItems(
  path: NodePath,
  onToast: (m: string) => void,
  pos?: { x: number; y: number },
): MenuItem[] {
  const node = state.nodeAt(path);
  if (!node) return [];
  const label = displayNameOf(node);
  // card roots live inside customCardProps — no sibling list to mutate
  const inSiblingList = path.length > 0 && path[path.length - 1] !== CARD_SEGMENT;
  const items: MenuItem[] = [];
  // group: only when the current selection is 2+ siblings of this node
  const sel = state.selections;
  const groupable = sel.length >= 2
    && sel.every((p) => p.length > 0 && p[p.length - 1] !== CARD_SEGMENT)
    && sel.every((p) => samePath(p.slice(0, -1), path.slice(0, -1)));

  items.push({
    icon: 'LightningBolt',
    label: 'Conditional formatting…',
    title: 'Paint this element by a field\'s value — pick conditions and looks, without the dialog maze',
    fn: () => { state.select(path); openCondFormat({ kind: 'element', path }, onToast); },
  });
  items.push({
    icon: 'Font',
    label: 'Format cells…',
    title: 'Font, borders, fill and alignment — the comfortable dialog; applies to every row',
    fn: () => { state.select(path); openFormatCells(path, onToast); },
  });
  items.push({
    icon: 'Rename',
    label: 'Rename…',
    title: 'Name this element — shows in the Structure pane, cosmetic only',
    fn: () => {
      openRenamePopover(
        pos ?? { x: window.innerWidth / 2 - 100, y: window.innerHeight / 2 - 40 },
        'Rename element',
        node._elmName ?? '',
        (v) => {
          state.mutateDocument(() => {
            const t = v.trim();
            if (t) node._elmName = t; else delete node._elmName;
          });
        },
      );
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
  if (groupable && sel.length === 2) {
    items.push({
      icon: 'GroupObject',
      label: 'Group selection',
      title: 'Wrap the two selected siblings in a new flex container',
      fn: () => {
        const [a, b] = [...sel].sort((p, q) => p[p.length - 1] - q[q.length - 1]);
        state.groupNodes(b, a, 'Group'); // onto = a (earlier, kept first), from = b
        onToast('Grouped the selection — Ctrl+Z to ungroup');
      },
    });
  }
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
    icon: 'Package',
    label: 'Save as component…',
    title: 'Package this element as a reusable component — anyone adding it maps their own columns into its typed slots (the ⬡ Components tab)',
    fn: () => openSaveAsComponent(path, onToast),
  });
  items.push({
    icon: 'Copy',
    label: sel.length > 1 && state.isSelected(path) ? `Copy ${sel.length} elements` : 'Copy element',
    title: 'Copy this element subtree (JSON) to the clipboard — paste into another container or keep as a snippet',
    fn: () => {
      const paths = state.isSelected(path) && sel.length > 1 ? sel : [path];
      void copyNodes(paths)
        .then((n) => onToast(`${n} element${n === 1 ? '' : 's'} copied`))
        .catch(() => onToast('Copy failed — clipboard access blocked (select the text and use Ctrl/Cmd+C)'));
    },
  });
  if (inSiblingList || node.children !== undefined || node.elmType === 'div') {
    items.push({
      icon: 'Paste',
      label: 'Paste',
      title: 'Paste the copied element(s) here (into this element, or beside it if it can\'t hold children)',
      fn: () => {
        void pasteNodes(path).then((n) => onToast(n ? `Pasted ${n} element${n === 1 ? '' : 's'}` : 'Nothing to paste'));
      },
    });
  }
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

/**
 * The menu header: the right-clicked element rendered like its Structure-tree
 * row, preceded (when it isn't the root) by a clickable parent crumb. Clicking
 * the crumb selects the parent and re-opens the menu on it — a breadcrumb that
 * walks the selection up a level at a time.
 */
function elementMenuTitle(
  path: NodePath,
  pos: { x: number; y: number },
  onToast: (m: string) => void,
): HTMLElement {
  const node = state.nodeAt(path)!;
  const head = document.createElement('div');
  head.className = 'wb-elmmenu-head';

  const parentPath = path.slice(0, -1);
  const parent = path.length > 0 ? state.nodeAt(parentPath) : null;
  if (parent) {
    const crumb = document.createElement('button');
    crumb.type = 'button'; // never a submit button, wherever the menu mounts
    crumb.className = 'wb-elmmenu-parent';
    crumb.appendChild(elementRefChip(parent));
    crumb.title = `Select the parent element (${displayNameOf(parent)})`;
    crumb.setAttribute('aria-label', crumb.title);
    crumb.addEventListener('click', (e) => {
      e.stopPropagation();
      state.select(parentPath);
      openElementMenu(parentPath, pos, onToast);
    });
    // a double-click on the crumb must not bubble to canvas/tree handlers
    crumb.addEventListener('dblclick', (e) => e.stopPropagation());
    const sep = document.createElement('span');
    sep.className = 'wb-elmmenu-sep';
    sep.textContent = '›';
    sep.setAttribute('aria-hidden', 'true');
    // keep "parent ›" together so a wrap breaks before the current element,
    // never orphaning the separator at the head of the next line
    const crumbWrap = document.createElement('span');
    crumbWrap.className = 'wb-elmmenu-crumb';
    crumbWrap.append(crumb, sep);
    head.append(crumbWrap);
  }
  head.appendChild(elementRefChip(node));
  return head;
}

/**
 * Open the shared element action menu for `path`, headed by the element's
 * tree-style reference and a clickable parent crumb. Callers own the initial
 * selection: the tree preserves a live multi-selection (so "Group"/"Copy N"
 * stay available), the canvas selects the clicked element first.
 */
export function openElementMenu(
  path: NodePath,
  pos: { x: number; y: number },
  onToast: (m: string) => void,
): void {
  const node = state.nodeAt(path);
  if (!node) return;
  openMenu(pos, elementMenuTitle(path, pos, onToast), elementMenuItems(path, onToast, pos));
}

function openFor(e: MouseEvent, pathTarget: HTMLElement, onToast: (m: string) => void): void {
  const path = pathFromAttr(pathTarget.dataset.spPath);
  if (path === undefined) return;
  const node = state.nodeAt(path);
  if (!node) return;
  e.preventDefault();
  state.select(path);
  openElementMenu(path, { x: e.clientX, y: e.clientY }, onToast);
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
      openElementMenu(path, { x: e.clientX, y: e.clientY }, onToast);
    }
  });
  document.addEventListener('contextmenu', (e) => {
    const flyout = (e.target as HTMLElement).closest?.('.wb-flyout');
    if (!flyout) return;
    const hit = (e.target as HTMLElement).closest('[data-sp-path]') as HTMLElement | null;
    if (hit) openFor(e, hit, onToast);
  });
}
