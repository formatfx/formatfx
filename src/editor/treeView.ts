/**
 * editor/treeView.ts — Structure tree: selection, drag-reorder/reparent,
 * duplicate/delete/move, and a card-formatter affordance for customCardProps.
 */

import type { SPElement, NodePath } from '../core/types';
import { state, samePath, CARD_SEGMENT } from './state';
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

/** Small colored chips for behaviors attached to the element. */
function nodeChips(el: SPElement): HTMLElement[] {
  const chips: HTMLElement[] = [];
  const mk = (text: string, cls: string, title: string) => {
    const c = document.createElement('span');
    c.className = `wb-chip ${cls}`;
    c.textContent = text;
    c.title = title;
    chips.push(c);
  };
  if (el.forEach) mk('⟳', 'wb-chip-loop', `Repeats per item: ${el.forEach}`);
  if (el.customRowAction) mk('▶', 'wb-chip-action', `Click action: ${el.customRowAction.action || '(no-op)'}`);
  if (el.customCardProps) mk('▣', 'wb-chip-card', 'Opens a hover/click card (nested below)');
  if (el.columnFormatterReference) mk('⤷', 'wb-chip-cfr', `Renders another column's formatter: ${el.columnFormatterReference}`);
  if (el.inlineEditField) mk('✎', 'wb-chip-edit', `Inline edit: ${el.inlineEditField}`);
  return chips;
}

export function mountTree(host: HTMLElement): void {
  const render = () => {
    host.innerHTML = '';
    const referenced = state.referencedColumns();

    // ── the workspace: main formatter + every column formatter ──
    host.appendChild(docHeader(
      'main',
      state.mainDocLabel(),
      state.activeDocKey === 'main',
      `${referenced.size} column reference${referenced.size === 1 ? '' : 's'}`,
    ));
    if (state.activeDocKey === 'main') {
      host.appendChild(renderNode(state.doc.root, []));
    }

    const names = Object.keys(state.columnRefs);
    if (names.length) {
      const group = document.createElement('div');
      group.className = 'wb-doc-group';
      group.textContent = 'Column formatters';
      host.appendChild(group);
      for (const name of names) {
        const badge = referenced.has(name) ? '⤷ in view' : 'unused';
        host.appendChild(docHeader(name, `[$${name}]`, state.activeDocKey === name, badge));
        if (state.activeDocKey === name) {
          host.appendChild(renderNode(state.doc.root, []));
        }
      }
    }
    // unresolved references the main formatter uses but the workspace lacks
    for (const name of referenced) {
      if (!(name in state.columnRefs)) {
        const miss = document.createElement('div');
        miss.className = 'wb-doc-missing';
        miss.textContent = `[$${name}] — referenced but not in the workspace`;
        miss.title = 'The main formatter has a columnFormatterReference to this column, but its formatter isn\'t registered. Import the list export or register it in the Data tab to render and edit it.';
        host.appendChild(miss);
      }
    }
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
    const typeName = document.createElement('span');
    typeName.className = 'wb-tree-elmtype';
    typeName.textContent = el.elmType ?? '?';
    label.append(typeIcon, typeName, ...nodeChips(el));
    const hint = nodeHint(el);
    if (hint) {
      const h = document.createElement('span');
      h.className = 'wb-tree-hint';
      h.textContent = hint;
      label.appendChild(h);
    }
    row.appendChild(label);

    const actions = document.createElement('span');
    actions.className = 'wb-tree-actions';
    const mk = (icon: string, title: string, fn: () => void) => {
      const b = document.createElement('button');
      b.title = title;
      b.innerHTML = `<i class="ms-Icon ms-Icon--${icon}"></i>`;
      b.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
      actions.appendChild(b);
    };
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
