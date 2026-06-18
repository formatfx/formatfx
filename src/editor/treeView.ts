/**
 * editor/treeView.ts — Structure tree: selection, drag-reorder/reparent,
 * duplicate/delete/move, and a card-formatter affordance for customCardProps.
 */

import type { SPElement, NodePath } from '../core/types';
import { state, samePath, CARD_SEGMENT } from './state';
import { cfrFieldName } from '../core/refs';
import { paletteItemById } from './palette';
import { instantiate } from './presets';

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
 * Small colored chips for behaviors attached to the element. When `onCfr` is
 * given, the ⤷ "renders another column" chip becomes a link that jumps to —
 * and selects — that column's formatter in the bottom section of the pane.
 * Only the chip is clickable; the row's own select handler is untouched.
 */
function nodeChips(el: SPElement, onCfr?: (name: string) => void): HTMLElement[] {
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
  if (el.columnFormatterReference) {
    const name = cfrFieldName(el.columnFormatterReference);
    const chip = mk('⤷', 'wb-chip-cfr',
      onCfr
        ? `Renders ${el.columnFormatterReference} — click to open & select that column formatter below`
        : `Renders another column's formatter: ${el.columnFormatterReference}`);
    if (onCfr) {
      chip.classList.add('wb-chip-link');
      // stop the row's click from also firing — jump just for this one icon
      chip.addEventListener('click', (e) => { e.stopPropagation(); onCfr(name); });
    }
  }
  if (el.inlineEditField) mk('✎', 'wb-chip-edit', `Inline edit: ${el.inlineEditField}`);
  return chips;
}

/**
 * The Structure pane, split into two independently-collapsible sections that
 * share the pane's height (a draggable splitter between them lives in main.ts):
 *   • `viewHost`  — the view (main) formatter, exactly as shown before.
 *   • `colsHost`  — the column formatters, exactly as shown before.
 * `onRevealColumn` is called after a ⤷ chip opens a column, so the host can
 * un-minimize the bottom section and scroll the now-active column into view.
 */
export function mountTree(
  viewHost: HTMLElement,
  colsHost: HTMLElement,
  onRevealColumn?: (name: string) => void,
): void {
  // rename-in-progress, by path — part of render state (not a DOM patch),
  // because selecting a row re-renders the whole tree mid-double-click
  let renamePath: NodePath | null = null;

  // Open + select another column's formatter, then let the host reveal it.
  // If the column isn't registered, openColumnRef is a no-op and the host
  // scrolls to that name's "referenced but not in the workspace" row instead,
  // so the click always lands somewhere meaningful.
  const jumpToColumn = (name: string) => {
    state.openColumnRef(name);
    onRevealColumn?.(name);
  };

  const render = () => {
    viewHost.innerHTML = '';
    colsHost.innerHTML = '';
    const referenced = state.referencedColumns();

    // ── top section: the view (main) formatter ──
    viewHost.appendChild(docHeader(
      'main',
      state.mainDocLabel(),
      state.activeDocKey === 'main',
      `${referenced.size} column reference${referenced.size === 1 ? '' : 's'}`,
    ));
    if (state.activeDocKey === 'main') {
      viewHost.appendChild(renderNode(state.doc.root, []));
    }

    // ── bottom section: every column formatter ──
    const names = Object.keys(state.columnRefs);
    for (const name of names) {
      const badge = referenced.has(name) ? '⤷ in view' : 'unused';
      colsHost.appendChild(docHeader(name, `[$${name}]`, state.activeDocKey === name, badge));
      if (state.activeDocKey === name) {
        colsHost.appendChild(renderNode(state.doc.root, []));
      }
    }
    // unresolved references the main formatter uses but the workspace lacks
    for (const name of referenced) {
      if (!(name in state.columnRefs)) {
        const miss = document.createElement('div');
        miss.className = 'wb-doc-missing';
        miss.dataset.missingRef = name; // so a ⤷ jump can land on it
        miss.textContent = `[$${name}] — referenced but not in the workspace`;
        miss.title = 'The main formatter has a columnFormatterReference to this column, but its formatter isn\'t registered. Import the list export or register it in the Data tab to render and edit it.';
        colsHost.appendChild(miss);
      }
    }
    if (!names.length && !referenced.size) {
      const none = document.createElement('div');
      none.className = 'wb-doc-group';
      none.textContent = 'No column formatters registered.';
      colsHost.appendChild(none);
    }
    // focus after attach — the rename input is created during the tree walk
    const renameInp = (viewHost.querySelector<HTMLInputElement>('.wb-tree-rename')
      ?? colsHost.querySelector<HTMLInputElement>('.wb-tree-rename'));
    if (renameInp) { renameInp.focus(); renameInp.select(); }
  };

  const docHeader = (key: string, label: string, active: boolean, badge: string): HTMLElement => {
    const h = document.createElement('div');
    h.className = 'wb-doc-header' + (active ? ' active' : '');
    h.title = active
      ? 'Currently on the canvas'
      : 'Click to put this formatter on the canvas (your current edits are kept)';
    const caret = document.createElement('span');
    caret.textContent = active ? '▾' : '▸';
    const text = document.createElement('span');
    text.textContent = label;
    const b = document.createElement('span');
    b.className = 'wb-doc-badge';
    b.textContent = badge;
    h.append(caret, text, b);
    h.addEventListener('click', () => {
      if (key === 'main') state.openMain();
      else state.openColumnRef(key);
    });
    return h;
  };

  const renderNode = (el: SPElement, path: NodePath): HTMLElement => {
    const wrap = document.createElement('div');
    wrap.className = 'wb-tree-node';

    const row = document.createElement('div');
    row.className = 'wb-tree-row';
    if (state.selection && samePath(state.selection, path)) row.classList.add('selected');
    row.draggable = path.length > 0;
    row.tabIndex = 0;

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
    label.append(typeName, ...nodeChips(el, jumpToColumn));
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
      b.innerHTML = `<i class="ms-Icon ms-Icon--${icon}"></i>`;
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
    row.appendChild(actions);

    row.addEventListener('click', () => state.select(path));

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

  state.subscribe((reason) => {
    if (reason === 'document' || reason === 'selection' || reason === 'load' || reason === 'kind' || reason === 'data') render();
  });
  render();
}
