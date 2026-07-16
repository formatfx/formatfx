// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sam Yost. FormatFX is dual-licensed: AGPL-3.0-only (see LICENSE) or a commercial license (see LICENSING.md).

/**
 * editor/treeView.ts — Structure tree: selection, fold/collapse (synced with
 * the JSON pane through the shared foldState set — a tree chevron folds the
 * element's children:[ in the JSON, a JSON fold collapses the row here),
 * drag-reorder/reparent, duplicate/delete/move, and a card-formatter
 * affordance for customCardProps.
 *
 * Renders the ACTIVE document (state.doc) — which document that is is chosen
 * by the Left Edit Pane's navigation, not by headers in this tree — OR, while
 * a component WORKSHOP tab is up, the workshop's STAGED tree via
 * state.workshopCtx (spec §C, 2026-07-09 — supersedes the v1 "a workshop tab
 * never re-targets the tree" constraint). Workshop mode allows select +
 * rename: selection rides ctx.select, and rename rides ctx.commit (the
 * workshop's modal-undo, one gesture = one ↶ step); the structural gestures
 * (wrap/move/duplicate/delete, drag and
 * drop, the context menu) stay surface-only — the workshop never offered
 * them, and its Save remains the one app-level undo step.
 */

import type { SPElement, NodePath } from '../core/types';
import { state, samePath, CARD_SEGMENT, type WorkshopContext } from './state';
import { foldState, elmFoldKey, childrenFoldKey } from './foldState';
import { paletteItemById } from './palette';
import { instantiate } from './presets';
import { openElementMenu } from './contextMenu';
import { elmIconName } from './elmRef';
import { FIELD_MIME } from './columnShelf';
import { gridCellForField } from './gridScaffold';

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
 * Small colored chips for behaviors attached to the element. A bound component
 * instance is marked by the inline ⬡ mark and the right-aligned "← Column"
 * binding tag on its own row, not a chip here.
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

export interface TreeViewOptions {
  /** Preference read (☰ → Preferences): keep the selected row scrolled into
   *  view on selection changes. Absent = follow (the default behavior). */
  followSelection?: () => boolean;
}

/**
 * The structure tree of the active document, mounted into `host` (the Left
 * Edit Pane's tree body). Selection is shown by row highlight only —
 * click = select, Ctrl/Cmd/Shift-click = multi-select.
 */
export function mountTree(
  host: HTMLElement,
  onToast: (m: string) => void = () => {},
  treeOpts: TreeViewOptions = {},
): void {
  // rename-in-progress, by path — part of render state (not a DOM patch),
  // because selecting a row re-renders the whole tree mid-double-click.
  // renameRoot pins WHICH tree the rename began under: a numeric path means
  // nothing across a surface⇄workshop retarget, so a root change drops the
  // rename instead of letting it land on an unrelated node (PR #270 review).
  let renamePath: NodePath | null = null;
  let renameRoot: SPElement | null = null;
  let currentRoot: SPElement | null = null;

  // Workshop-only fold memory: staged paths mean nothing to the JSON pane's
  // offset map, so workshop collapses stay LOCAL (session-only, dropped on
  // retarget) instead of riding the shared foldState.
  const workshopFolds = new Set<string>();
  let foldRoot: SPElement | null = null;

  /** The tree's editing seams, resolved per render: the app document, or the
   *  workshop's staged tree while its tab covers the canvas. */
  interface TreeOps {
    isSelected(p: NodePath): boolean;
    select(p: NodePath): void;
    toggleSelect(p: NodePath): void;
    /** Rename — the non-structural node edit both modes allow. */
    commitNode(p: NodePath, fn: (n: SPElement) => void): void;
    /** Structural gestures (wrap/move/dup/delete/dnd/menu) offered? */
    structural: boolean;
    /** Workshop only: an embed placeholder's component name (read-only row). */
    embedNameOf?(el: SPElement): string | null;
    /** Fold seam (2026-07-16, synced with the JSON pane): how much of this
     *  node's subtree is hidden. 'children' = the children:[ fold (child rows
     *  hidden, a card subtree stays); 'elm' = the whole-element fold from the
     *  JSON side (card hidden too — the JSON elides it as well). */
    foldStateOf(p: NodePath): 'open' | 'children' | 'elm';
    /** Chevron toggle. Collapse folds the children:[ level (the element's own
     *  properties stay visible in the JSON); expand clears BOTH fold kinds so
     *  it always works, whichever surface folded the node. */
    toggleCollapsed(p: NodePath, hasChildren: boolean): void;
    /** Every live selection path — for marking collapsed rows that hide one. */
    heldSelections(): NodePath[];
  }
  const surfaceOps: TreeOps = {
    isSelected: (p) => state.isSelected(p),
    select: (p) => state.select(p),
    toggleSelect: (p) => state.toggleSelect(p),
    commitNode: (p, fn) => state.mutateDocument(() => {
      const n = state.nodeAt(p);
      if (n) fn(n);
    }),
    structural: true,
    foldStateOf: (p) => (foldState.has(elmFoldKey(p)) ? 'elm'
      : foldState.has(childrenFoldKey(p)) ? 'children' : 'open'),
    toggleCollapsed: (p, hasChildren) => {
      const cKey = childrenFoldKey(p);
      const eKey = elmFoldKey(p);
      foldState.update('tree', (set) => {
        if (set.has(cKey) || set.has(eKey)) {
          set.delete(cKey);
          set.delete(eKey);
        } else {
          // card-only nodes have no children:[ to fold — fold the element
          // object instead (never the root: that would elide the whole doc)
          set.add(hasChildren || p.length === 0 ? cKey : eKey);
        }
      });
      // no render() here — the foldState subscription below re-renders once
    },
    heldSelections: () => state.selections,
  };
  const workshopOps = (ctx: WorkshopContext): TreeOps => ({
    isSelected: (p) => samePath(ctx.selection(), p),
    select: (p) => ctx.select(p),
    toggleSelect: (p) => ctx.select(p), // staged selection is single-only
    commitNode: (p, fn) => ctx.commit(() => {
      const n = ctx.nodeAt(p);
      if (n) fn(n);
    }),
    structural: false,
    embedNameOf: (el) => ctx.embedNameOf(el),
    // purely local: nothing to mirror in the JSON pane, so a collapse hides
    // the whole subtree (children AND card rows)
    foldStateOf: (p) => (workshopFolds.has(childrenFoldKey(p)) ? 'elm' : 'open'),
    toggleCollapsed: (p) => {
      const k = childrenFoldKey(p);
      if (workshopFolds.has(k)) workshopFolds.delete(k);
      else workshopFolds.add(k);
      render();
    },
    heldSelections: () => [ctx.selection()],
  });
  let ops: TreeOps = surfaceOps;

  const render = () => {
    host.innerHTML = '';
    const ctx = state.activeComponentTab !== null ? state.workshopCtx : null;
    ops = ctx ? workshopOps(ctx) : surfaceOps;
    currentRoot = ctx ? ctx.root() : state.doc.root;
    if (renamePath && renameRoot !== currentRoot) {
      renamePath = null;
      renameRoot = null;
    }
    if (foldRoot !== currentRoot) {
      // a retarget (surface⇄workshop, doc swap) makes the LOCAL fold paths
      // meaningless — drop them (the shared foldState prunes itself instead)
      workshopFolds.clear();
      foldRoot = currentRoot;
    }
    if (ctx) {
      host.appendChild(renderNode(ctx.root(), []));
      const renameInp0 = host.querySelector<HTMLInputElement>('.wb-tree-rename');
      if (renameInp0) { renameInp0.focus(); renameInp0.select(); }
      return;
    }
    if (state.doc.kind === 'grid') {
      // Columns mode: the grid root is scaffolding (the wrapper a future
      // promotion to a row view would use — gridScaffold.buildGridRoot), not
      // something the maker built. The tree lists the COLUMNS themselves;
      // the wrapper div never gets a row here.
      const cols = state.doc.root.children ?? [];
      cols.forEach((child, i) => host.appendChild(renderNode(child, [i])));
      if (!cols.length) {
        const empty = document.createElement('div');
        empty.className = 'wb-tree-empty';
        empty.textContent = 'No columns on the grid — use “+ column” on the canvas to add one.';
        host.appendChild(empty);
      }
    } else {
      host.appendChild(renderNode(state.doc.root, []));
    }
    // focus after attach — the rename input is created during the tree walk
    const renameInp = host.querySelector<HTMLInputElement>('.wb-tree-rename');
    if (renameInp) { renameInp.focus(); renameInp.select(); }
  };

  /** Indent depth for a row — on the grid the columns ARE the top level. */
  const depthOf = (path: NodePath): number =>
    Math.max(0, path.length - (ops.structural && state.doc.kind === 'grid' ? 1 : 0));

  const renderNode = (el: SPElement, path: NodePath): HTMLElement => {
    const wrap = document.createElement('div');
    wrap.className = 'wb-tree-node';

    const row = document.createElement('div');
    row.className = 'wb-tree-row';
    if (ops.isSelected(path)) row.classList.add('selected');
    if (el.style?.['display'] === 'none') row.classList.add('wb-tree-hidden');
    row.draggable = ops.structural && path.length > 0;
    row.tabIndex = 0;
    row.dataset.path = path.join('.');

    // workshop mode: an EMBED PLACEHOLDER (#225) is a read-only stand-in —
    // label it as the component it stands in for (⬡ name), selectable so the
    // inspector can teach, but no rename (edits would vanish on flatten)
    const embedName = ops.embedNameOf?.(el) ?? null;
    if (embedName !== null) {
      const label0 = document.createElement('span');
      label0.className = 'wb-tree-label';
      label0.style.paddingLeft = `${depthOf(path) * 12}px`;
      const mark0 = document.createElement('span');
      mark0.className = 'wb-comp-mark';
      mark0.textContent = '⬡';
      mark0.setAttribute('aria-hidden', 'true');
      const nm0 = document.createElement('span');
      nm0.className = 'wb-tree-name';
      nm0.textContent = embedName;
      // chevron-slot spacer so embed rows line up with foldable siblings
      const pad0 = document.createElement('span');
      pad0.className = 'wb-tree-fold wb-tree-fold-none';
      pad0.setAttribute('aria-hidden', 'true');
      label0.append(pad0, mark0, nm0);
      row.appendChild(label0);
      row.title = `The embedded “${embedName}” component — restyle it in its OWN workshop`;
      row.addEventListener('click', () => ops.select(path));
      // the row is focusable (tabIndex above) — keep it keyboard-operable
      // even though it short-circuits the rest of the row chrome (PR #270)
      row.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          e.stopPropagation();
          ops.select(path);
        }
      });
      wrap.appendChild(row);
      return wrap;
    }

    // the binding language: a bound component instance reads "⬡ Name ← Column"
    // — the teal ⬡ mark says "this is a component", the right-aligned tag says
    // which column(s) its slots are bound to (from the _component provenance).
    const boundColumns = el._component
      ? [...new Set(Object.values(el._component.map).filter(Boolean))]
        .map((n) => state.fields.find((f) => f.name === n)?.displayName ?? n)
      : [];

    const label = document.createElement('span');
    label.className = 'wb-tree-label';
    label.style.paddingLeft = `${depthOf(path) * 12}px`;

    // ── fold chevron (2026-07-16, synced with the JSON pane) ──
    // Foldable = has child rows to hide (children, or a card-formatter
    // subtree). Collapse folds the children:[ level in the JSON (card-only
    // nodes fold their element object — the only JSON fold that hides a
    // card); expand clears both fold kinds. Leaf rows get a same-width
    // spacer so icons stay aligned.
    const kids = el.children?.length ?? 0;
    const hasCardRows = !!el.customCardProps?.formatter;
    const foldSt = ops.foldStateOf(path);
    const collapsed = foldSt !== 'open';
    if (collapsed) row.dataset.folded = '1';
    const foldable = kids > 0 || (hasCardRows && path.length > 0);
    const fold = document.createElement(foldable ? 'button' : 'span') as HTMLElement;
    fold.className = 'wb-tree-fold' + (foldable ? '' : ' wb-tree-fold-none');
    if (foldable) {
      const btn = fold as HTMLButtonElement;
      btn.type = 'button';
      btn.textContent = collapsed ? '▸' : '▾';
      btn.setAttribute('aria-expanded', String(!collapsed));
      const what = kids > 0
        ? `${kids} child element${kids === 1 ? '' : 's'}`
        : 'the card-formatter subtree';
      btn.title = collapsed
        ? `Expand — show ${what} (unfolds in the JSON pane too)`
        : `Collapse — hide ${what} here and fold it in the JSON pane`;
      btn.setAttribute('aria-label', `${collapsed ? 'Expand' : 'Collapse'} ${what}`);
      btn.addEventListener('click', (e) => { e.stopPropagation(); ops.toggleCollapsed(path, kids > 0); });
      btn.addEventListener('dblclick', (e) => e.stopPropagation()); // never a rename
    } else {
      fold.setAttribute('aria-hidden', 'true');
    }
    label.appendChild(fold);

    const typeIcon = document.createElement('i');
    typeIcon.className = `ms-Icon ms-Icon--${elmIconName(el.elmType)} wb-tree-elmicon`;
    label.appendChild(typeIcon);
    if (el._component) {
      const mark = document.createElement('span');
      mark.className = 'wb-comp-mark';
      mark.textContent = '⬡';
      mark.setAttribute('aria-hidden', 'true');
      label.appendChild(mark);
    }
    // _elmName (the throwaway-name convention SP ignores) is the primary
    // label when present — the elmType steps back to a dim suffix.
    // (The grid root and its pre-stamped 'Row layout' name never render here
    // at all — Columns mode lists the columns themselves, see render().)
    const primaryName = el._elmName;
    if (primaryName) {
      const nm = document.createElement('span');
      nm.className = 'wb-tree-name';
      nm.textContent = primaryName;
      label.appendChild(nm);
    }
    const typeName = document.createElement('span');
    typeName.className = 'wb-tree-elmtype' + (primaryName ? ' wb-tree-elmtype-dim' : '');
    typeName.textContent = el.elmType ?? '?';
    // elemType does NOT join the label — it lives in the far-right "meta"
    // slot built below, swapped for the hover actions on row hover (#219).
    label.append(...nodeChips(el));
    const hint = primaryName ? '' : nodeHint(el);
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
      label.replaceChildren(fold, typeIcon, inp);
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
        ops.commitNode(path, (n) => {
          if (v) n._elmName = v; else delete n._elmName;
        });
      });
    }
    const startRename = () => { renamePath = path; renameRoot = currentRoot; render(); };
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
    if (ops.structural) {
      mk('GroupObject', 'Wrap in a new container (adds a parent — works on the root too)', () => state.wrapNode(path));
      if (path.length > 0 && path[path.length - 1] !== CARD_SEGMENT) {
        mk('Up', 'Move up', () => state.moveNode(path, -1));
        mk('Down', 'Move down', () => state.moveNode(path, 1));
        mk('Copy', 'Duplicate', () => state.duplicateNode(path));
        mk('Delete', 'Delete', () => state.removeNode(path));
      }
    }
    // NOTE: the 👁 hide/show toggle was removed (2026-07-16, issue #288) — it
    // wrote a raw display:none, clobbering any existing `display` value (e.g.
    // flex) and never restoring it on un-hide (it just deleted the property).
    // Tracked as a bug to reintroduce a lossless version. The .wb-tree-hidden
    // row treatment below still dims nodes that carry display:none from
    // imported/authored JSON.
    // the binding tag: which column(s) this component instance is bound to —
    // read-only provenance; remapping lives on the inspector's instance card.
    if (boundColumns.length) {
      const tag = document.createElement('span');
      tag.className = 'wb-tree-bindtag';
      tag.textContent = `← ${boundColumns.join(' · ')}`;
      tag.title = `This component instance is bound to ${boundColumns.join(', ')} — remap it from the inspector`;
      row.appendChild(tag);
    }
    // far-right "meta" slot (#219): elemType and the hover actions share the
    // same space, stacked in a CSS grid cell — at rest elemType shows, and
    // hovering the row fades/slides it out while the actions fade/slide in
    // (see .wb-tree-meta in style.css), so metadata stays out of the way
    // until the row is actually being acted on.
    const meta = document.createElement('span');
    meta.className = 'wb-tree-meta';
    meta.append(typeName, actions);
    row.appendChild(meta);

    // selection: plain click = single-select; Ctrl/Cmd/Shift = add/remove
    row.addEventListener('click', (e) => {
      if (e.ctrlKey || e.metaKey || e.shiftKey) ops.toggleSelect(path);
      else ops.select(path);
    });

    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        if (e.target !== row) return; // let buttons inside handle their own keys
        e.preventDefault();
        e.stopPropagation();
        if (e.ctrlKey || e.metaKey || e.shiftKey) ops.toggleSelect(path);
        else ops.select(path);
      }
      // tree-conventional fold keys: ← collapses, → expands (foldable rows)
      if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && e.target === row && foldable) {
        const wantCollapse = e.key === 'ArrowLeft';
        if (wantCollapse !== collapsed) {
          e.preventDefault();
          e.stopPropagation();
          ops.toggleCollapsed(path, kids > 0);
        }
      }
    });

    // right-click: the node action menu (Copy/Paste/Group/Ungroup/Duplicate/…),
    // headed like this very row plus a clickable parent crumb. Keep a live
    // multi-selection so "Group"/"Copy N" stay offered when several are picked.
    // Surface-only: the menu's actions are app-document mutations.
    if (ops.structural) {
      row.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!state.isSelected(path)) state.select(path);
        openElementMenu(path, { x: e.clientX, y: e.clientY }, onToast);
      });
    }

    // drag & drop reparent — structural, so surface-only
    if (ops.structural) row.addEventListener('dragstart', (e) => {
      e.stopPropagation();
      e.dataTransfer?.setData('application/x-wb-node', path.join('.'));
      e.dataTransfer!.effectAllowed = 'move';
    });
    if (ops.structural) row.addEventListener('dragover', (e) => {
      // accept-gating: only highlight payloads this row will act on — an
      // unconditional preventDefault false-advertised drops it would ignore.
      // Accepted: palette items, tree-node reparents, column-shelf chips (§5).
      const types = e.dataTransfer?.types;
      if (!types?.includes('application/x-wb-palette') && !types?.includes('application/x-wb-node')
        && !types?.includes(FIELD_MIME)) return;
      e.preventDefault();
      e.stopPropagation();
      row.classList.add('droptarget');
    });
    if (ops.structural) row.addEventListener('dragleave', () => row.classList.remove('droptarget'));
    if (ops.structural) row.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      row.classList.remove('droptarget');
      const paletteId = e.dataTransfer?.getData('application/x-wb-palette');
      if (paletteId) {
        const item = paletteItemById(paletteId);
        if (item) state.insertNode(instantiate(item, state.fields), path);
        return;
      }
      // a column chip (§5): the field arrives as its look-aware cell — dressed
      // when the column wears a component, the plain value otherwise. Same
      // insert semantics as a palette drop; one undoable step.
      const fieldName = e.dataTransfer?.getData(FIELD_MIME);
      if (fieldName) {
        const field = state.fields.find((f) => f.name === fieldName);
        if (field) state.insertNode(gridCellForField(field, state.columnLooks), path);
        return;
      }
      const from = e.dataTransfer?.getData('application/x-wb-node');
      if (from !== undefined && from !== '') {
        state.reparentNode(from.split('.').map(Number), path);
      } else if (from === '') {
        // root row dragged — ignore
      }
    });

    // a collapsed row that HIDES the selection says so (accent inset) — the
    // fold is never auto-expanded for it, mirroring the JSON pane's clamp-to-
    // sentinel behavior. Recomputed by updateSelectionOnly on selection emits.
    if (collapsed && holdsSelection(path)) row.classList.add('wb-tree-holdsel');

    wrap.appendChild(row);

    // fold gating mirrors the JSON pane exactly: an 'elm' fold (whole object)
    // elides the card subtree too; a 'children' fold hides just the child rows
    if (el.customCardProps?.formatter && foldSt !== 'elm') {
      const cardNote = document.createElement('div');
      cardNote.className = 'wb-tree-cardnote';
      cardNote.style.paddingLeft = `${(depthOf(path) + 1) * 12}px`;
      cardNote.textContent = '▣ card formatter (flyout content):';
      wrap.appendChild(cardNote);
      // card formatter subtree is fully editable — addressed via CARD_SEGMENT
      wrap.appendChild(renderNode(el.customCardProps.formatter, [...path, CARD_SEGMENT]));
    }

    if (foldSt === 'open') {
      el.children?.forEach((child, i) => wrap.appendChild(renderNode(child, [...path, i])));
    }
    return wrap;
  };

  /** Does any live selection sit STRICTLY inside this node's subtree? */
  const holdsSelection = (path: NodePath): boolean =>
    ops.heldSelections().some((sel) =>
      sel.length > path.length && path.every((v, i) => sel[i] === v));

  const updateSelectionOnly = () => {
    host.querySelectorAll<HTMLElement>('.wb-tree-row').forEach((row) => {
      const pathStr = row.dataset.path;
      if (pathStr === undefined) return;
      const path = pathStr === '' ? [] : pathStr.split('.').map(Number);
      row.classList.toggle('selected', ops.isSelected(path));
      // collapsed rows keep saying whether they hide the selection
      row.classList.toggle('wb-tree-holdsel', row.dataset.folded === '1' && holdsSelection(path));
    });
    revealSelectedRow();
  };

  /** Owner ask 2026-07-16: the tree keeps the selection in view, the way the
   *  JSON pane reveals its lines — gated behind ☰ → Preferences ("Structure
   *  tree follows selection", default on). Like the scope bar, it follows
   *  EVERY origin (canvas click, JSON caret, lint row): marking where you are
   *  is the whole job, and block:'nearest' keeps it gentle — a row already on
   *  screen doesn't move at all. A selection buried in a collapsed subtree
   *  reveals its nearest VISIBLE ancestor (the wb-tree-holdsel row) — folds
   *  are never auto-expanded. Runs only on 'selection' emits, never on
   *  document/data re-renders: a maker who scrolled away to browse must not
   *  be yanked back by an unrelated repaint. Surface tree only — the app
   *  selection's paths mean nothing to a workshop's staged tree. */
  const revealSelectedRow = (): void => {
    if (ops !== surfaceOps) return;
    if (!(treeOpts.followSelection?.() ?? true)) return;
    const sel = state.selection;
    if (!sel) return;
    for (let n = sel.length; n >= 0; n--) {
      const row = host.querySelector<HTMLElement>(`.wb-tree-row[data-path="${sel.slice(0, n).join('.')}"]`);
      if (row) {
        row.scrollIntoView?.({ block: 'nearest' }); // absent in test DOMs
        return;
      }
    }
  };

  if ((host as any)._unsub) {
    (host as any)._unsub();
  }
  const unsub = state.subscribe((reason) => {
    if (reason === 'selection') {
      updateSelectionOnly();
    } else if (reason === 'document' || reason === 'load' || reason === 'kind' || reason === 'data'
      || reason === 'workshop') {
      // 'workshop': staged commits, staged selection moves, and the ctx
      // registering/unregistering all reshape what this tree shows
      render();
    }
  });
  // fold changes re-render wholesale, whoever made them — this tree's own
  // chevrons (their toggle doesn't render directly), the JSON pane's chevrons
  // and fold commands, or a prune after a node vanished
  const unsubFolds = foldState.subscribe(() => render());
  (host as any)._unsub = () => {
    unsub();
    unsubFolds();
  };
  render();
}
