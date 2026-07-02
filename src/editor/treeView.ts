/**
 * editor/treeView.ts — Structure tree: selection, drag-reorder/reparent,
 * duplicate/delete/move, and a card-formatter affordance for customCardProps.
 *
 * Renders the ACTIVE document only (state.doc) — which formatter that is
 * (the view, or one of the column formatters) is chosen by the Left Edit
 * Pane's formatter tabs + document dropdown, not by headers in this tree.
 */

import type { SPElement, NodePath } from '../core/types';
import { state, samePath, CARD_SEGMENT } from './state';
import { cfrFieldName } from '../core/refs';
import { cfrBlastRadius } from './cfr';
import { paletteItemById } from './palette';
import { instantiate } from './presets';
import { openMenu } from './menu';
import { elementMenuItems } from './contextMenu';

const ELM_ICONS: Record<string, string> = {
  div: 'CubeShape', span: 'PlainText', a: 'Link', img: 'Photo2',
  button: 'ButtonControl', p: 'AlignLeft', svg: 'Puzzle', path: 'Puzzle',
  filepreview: 'PreviewLink',
};

function nodeHint(el: SPElement): string {
  let hint = '';
  if (typeof el.txtContent === 'string') hint = el.txtContent;
  else if (el.txtContent !== undefined) hint = '{AST expr}';
  else if (typeof el.attributes?.iconName === 'string') hint = `icon:${el.attributes.iconName}`;
  else if (typeof el.attributes?.class === 'string') hint = `.${el.attributes.class.split(/\s+/)[0]}`;
  if (hint.length > 26) hint = hint.slice(0, 26) + '…';
  return hint;
}

/**
 * Small colored chips for behaviors attached to the element. A host cell (one
 * carrying a columnFormatterReference) is marked by the opaque reference row
 * rendered in `renderNode`, not a chip here.
 */
function nodeChips(el: SPElement): HTMLElement[] {
  const chips: HTMLElement[] = [];
  const mk = (text: string, cls: string, title: string): HTMLElement => {
    const c = document.createElement('span');
    c.className = `wb-chip ${cls}`;
    c.textContent = text;
    c.title = title;
    chips.push(c);
    return c;
  };
  if (el.forEach) mk('⟳', 'wb-chip-loop', `Repeats per item: ${el.forEach}`);
  if (el.customRowAction) mk('▶', 'wb-chip-action', `Click action: ${el.customRowAction.action || '(no-op)'}`);
  if (el.customCardProps) mk('▣', 'wb-chip-card', 'Opens a hover/click card (nested below)');
  if (el.inlineEditField) mk('✎', 'wb-chip-edit', `Inline edit: ${el.inlineEditField}`);
  return chips;
}

/**
 * The structure tree of the active document, mounted into `host` (the Left
 * Edit Pane's tree body). Selection is shown by row highlight only —
 * click = select, Ctrl/Cmd/Shift-click = multi-select.
 */
export function mountTree(
  host: HTMLElement,
  onToast: (m: string) => void = () => {},
): void {
  // rename-in-progress, by path — part of render state (not a DOM patch),
  // because selecting a row re-renders the whole tree mid-double-click
  let renamePath: NodePath | null = null;

  // Open + select another column's formatter. If the column isn't registered,
  // openColumnRef is a no-op — the reference row for that case is inert.
  const jumpToColumn = (name: string) => {
    state.openColumnRef(name);
  };

  const render = () => {
    host.innerHTML = '';
    host.appendChild(renderNode(state.doc.root, []));
    // focus after attach — the rename input is created during the tree walk
    const renameInp = host.querySelector<HTMLInputElement>('.wb-tree-rename');
    if (renameInp) { renameInp.focus(); renameInp.select(); }
  };

  const renderNode = (el: SPElement, path: NodePath): HTMLElement => {
    const wrap = document.createElement('div');
    wrap.className = 'wb-tree-node';

    const row = document.createElement('div');
    row.className = 'wb-tree-row';
    if (state.isSelected(path)) row.classList.add('selected');
    if (el.style?.['display'] === 'none') row.classList.add('wb-tree-hidden');
    row.draggable = path.length > 0;
    row.tabIndex = 0;
    row.dataset.path = path.join('.');

    const label = document.createElement('span');
    label.className = 'wb-tree-label';
    label.style.paddingLeft = `${path.length * 12}px`;
    const typeIcon = document.createElement('i');
    typeIcon.className = `ms-Icon ms-Icon--${ELM_ICONS[el.elmType] ?? 'CubeShape'} wb-tree-elmicon`;
    label.appendChild(typeIcon);
    // _elmName (the throwaway-name convention SP ignores) is the primary
    // label when present; the elmType steps back to a dim suffix
    if (el._elmName) {
      const nm = document.createElement('span');
      nm.className = 'wb-tree-name';
      nm.textContent = el._elmName;
      label.appendChild(nm);
    }
    const typeName = document.createElement('span');
    typeName.className = 'wb-tree-elmtype' + (el._elmName ? ' wb-tree-elmtype-dim' : '');
    typeName.textContent = el.elmType ?? '?';
    label.append(typeName, ...nodeChips(el));
    const hint = el._elmName ? '' : nodeHint(el);
    if (hint) {
      const h = document.createElement('span');
      h.className = 'wb-tree-hint';
      h.textContent = hint;
      label.appendChild(h);
    }
    row.appendChild(label);

    // inline rename — double-click or the ✎ action; Enter/blur commits,
    // Esc cancels, empty clears the name. Cosmetic only: can't break the
    // formatter, so it works in basic mode too.
    if (renamePath && samePath(renamePath, path)) {
      const inp = document.createElement('input');
      inp.className = 'wb-tree-rename';
      inp.value = el._elmName ?? '';
      inp.placeholder = 'name this element…';
      label.replaceChildren(typeIcon, inp);
      row.draggable = false;
      let cancelled = false;
      inp.addEventListener('click', (e) => e.stopPropagation());
      inp.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') inp.blur();
        if (e.key === 'Escape') { cancelled = true; inp.blur(); }
      });
      inp.addEventListener('blur', () => {
        renamePath = null;
        if (cancelled) { render(); return; }
        const v = inp.value.trim();
        state.mutateDocument(() => {
          if (v) el._elmName = v; else delete el._elmName;
        });
      });
    }
    const startRename = () => { renamePath = path; render(); };
    row.addEventListener('dblclick', (e) => { e.stopPropagation(); startRename(); });
    row.title = 'Double-click to rename';

    const actions = document.createElement('span');
    actions.className = 'wb-tree-actions';
    const mk = (icon: string, title: string, fn: () => void) => {
      const b = document.createElement('button');
      b.title = title;
      // icon-only button: the glyph is decorative, so name the button itself
      b.setAttribute('aria-label', title);
      b.innerHTML = `<i class="ms-Icon ms-Icon--${icon}" aria-hidden="true"></i>`;
      b.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
      actions.appendChild(b);
    };
    mk('Rename', 'Name this element — shows in this tree, exported JSON stays clean (or double-click the row)', startRename);
    mk('GroupObject', 'Wrap in a new container (adds a parent — works on the root too)', () => state.wrapNode(path));
    if (path.length > 0 && path[path.length - 1] !== CARD_SEGMENT) {
      mk('Up', 'Move up', () => state.moveNode(path, -1));
      mk('Down', 'Move down', () => state.moveNode(path, 1));
      mk('Copy', 'Duplicate', () => state.duplicateNode(path));
      mk('Delete', 'Delete', () => state.removeNode(path));
    }
    // 👁 visibility toggle — flips display:none on the canvas for this node
    const eye = document.createElement('button');
    eye.className = 'wb-tree-eye';
    const hidden = el.style?.['display'] === 'none';
    eye.textContent = hidden ? '🚫' : '👁';
    eye.title = hidden ? 'Show on canvas' : 'Hide on canvas (display:none)';
    eye.setAttribute('aria-label', eye.title);
    eye.addEventListener('click', (e) => {
      e.stopPropagation();
      state.mutateDocument(() => {
        const n = state.nodeAt(path);
        if (!n) return;
        if (n.style?.['display'] === 'none') {
          delete n.style['display'];
          if (n.style && Object.keys(n.style).length === 0) delete n.style;
        } else {
          n.style = n.style ?? {};
          n.style['display'] = 'none';
        }
      });
    });
    row.appendChild(eye);
    row.appendChild(actions);

    // selection: plain click = single-select; Ctrl/Cmd/Shift = add/remove
    row.addEventListener('click', (e) => {
      if (e.ctrlKey || e.metaKey || e.shiftKey) state.toggleSelect(path);
      else state.select(path);
    });

    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        if (e.target !== row) return; // let buttons inside handle their own keys
        e.preventDefault();
        e.stopPropagation();
        if (e.ctrlKey || e.metaKey || e.shiftKey) state.toggleSelect(path);
        else state.select(path);
      }
    });

    // right-click: the node action menu (Copy/Paste/Group/Ungroup/Duplicate/…)
    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!state.isSelected(path)) state.select(path);
      openMenu(
        { x: e.clientX, y: e.clientY },
        el._elmName ?? `<${el.elmType}>`,
        elementMenuItems(path, onToast, { x: e.clientX, y: e.clientY }),
      );
    });

    // drag & drop reparent
    row.addEventListener('dragstart', (e) => {
      e.stopPropagation();
      e.dataTransfer?.setData('application/x-wb-node', path.join('.'));
      e.dataTransfer!.effectAllowed = 'move';
    });
    row.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
      row.classList.add('droptarget');
    });
    row.addEventListener('dragleave', () => row.classList.remove('droptarget'));
    row.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      row.classList.remove('droptarget');
      const paletteId = e.dataTransfer?.getData('application/x-wb-palette');
      if (paletteId) {
        const item = paletteItemById(paletteId);
        if (item) state.insertNode(instantiate(item, state.fields), path);
        return;
      }
      const from = e.dataTransfer?.getData('application/x-wb-node');
      if (from !== undefined && from !== '') {
        state.reparentNode(from.split('.').map(Number), path);
      } else if (from === '') {
        // root row dragged — ignore
      }
    });

    wrap.appendChild(row);

    // "violet = shared": the reference is a door, not a folder — one opaque,
    // non-expandable row naming the referenced column; opening it drills in
    // (same lesson as the canvas). Kept to the column name + the § mark so it
    // reads like the COLUMN FORMATTERS tab it links to.
    if (el.columnFormatterReference) {
      const name = cfrFieldName(el.columnFormatterReference);
      const registered = name in state.columnRefs;
      const display = state.fields.find((f) => f.name === name)?.displayName ?? name;
      const stub = document.createElement('div');
      stub.className = 'wb-tree-stylestub' + (registered ? '' : ' wb-tree-stylestub-missing');
      stub.style.paddingLeft = `${(path.length + 1) * 12 + 8}px`;
      const mark = document.createElement('span');
      mark.className = 'wb-style-mark';
      mark.textContent = '§';
      mark.setAttribute('aria-hidden', 'true');
      const nm = document.createElement('span');
      nm.className = 'wb-stub-name';
      nm.textContent = display;
      const tag = document.createElement('span');
      tag.className = 'wb-stub-tag';
      tag.textContent = 'column formatter reference';
      stub.append(mark, nm, tag);
      if (registered) {
        const blast = cfrBlastRadius(name, state.mainRootForScope, state.columnRefs);
        const places = Math.max(blast.count, 1);
        stub.title = `This element renders the shared ${display} column formatter (used in ${places} place${places === 1 ? '' : 's'}). Open it to edit — changes apply everywhere it's used.`;
        stub.setAttribute('role', 'button');
        stub.tabIndex = 0;
        const open = (e: Event) => { e.stopPropagation(); jumpToColumn(name); };
        stub.addEventListener('click', open);
        stub.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(e); }
        });
      } else {
        stub.title = `The formatter references [$${name}], but that column formatter isn't registered. Import the list export or register it in the Data tab.`;
      }
      wrap.appendChild(stub);
    }

    if (el.customCardProps?.formatter) {
      const cardNote = document.createElement('div');
      cardNote.className = 'wb-tree-cardnote';
      cardNote.style.paddingLeft = `${(path.length + 1) * 12}px`;
      cardNote.textContent = '▣ card formatter (flyout content):';
      wrap.appendChild(cardNote);
      // card formatter subtree is fully editable — addressed via CARD_SEGMENT
      wrap.appendChild(renderNode(el.customCardProps.formatter, [...path, CARD_SEGMENT]));
    }

    el.children?.forEach((child, i) => wrap.appendChild(renderNode(child, [...path, i])));
    return wrap;
  };

  const updateSelectionOnly = () => {
    host.querySelectorAll<HTMLElement>('.wb-tree-row').forEach((row) => {
      const pathStr = row.dataset.path;
      if (pathStr === undefined) return;
      const path = pathStr === '' ? [] : pathStr.split('.').map(Number);
      row.classList.toggle('selected', state.isSelected(path));
    });
  };

  if ((host as any)._unsub) {
    (host as any)._unsub();
  }
  const unsub = state.subscribe((reason) => {
    if (reason === 'selection') {
      updateSelectionOnly();
    } else if (reason === 'document' || reason === 'load' || reason === 'kind' || reason === 'data') {
      render();
    }
  });
  (host as any)._unsub = unsub;
  render();
}
