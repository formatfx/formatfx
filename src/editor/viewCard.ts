// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sam Yost. FormatFX is dual-licensed: AGPL-3.0-only (see LICENSE) or a commercial license (see LICENSING.md).

/**
 * editor/viewCard.ts — the "THIS VIEW" card (COLUMNS-COMPONENTS-VIEWS §3.2):
 * name/kind of the active view tab plus its view-scoped behaviors &
 * properties — the things that belong to the VIEW rather than any element:
 *
 *   · density (Roomy/Compact — state.setRowDensity, one undoable step)
 *   · the extra row class (viewExtras.additionalRowClass — commit on
 *     Enter/blur as ONE document mutation; empty clears the key)
 *   · scanned behavior rows: every customRowAction / customCardProps in the
 *     document, labeled and clickable — a click jumps to (selects) the
 *     carrying element, where the inspector edits it.
 *
 * Hidden while the Grid tab is up (the grid has no view-scoped behavior);
 * while a component WORKSHOP tab is active it shows a compact DEF card
 * instead — name, slot chips, and the def's usage count (scanComponentUsages
 * over the active surface + the column looks).
 */

import { state, CARD_SEGMENT } from './state';
import type { NodePath, SPElement } from '../core/types';
import { rowDensityOf, DENSITY_LABEL, type RowDensity } from './areas';
import { componentById } from './componentLibrary';
import { scanComponentUsages } from './componentUsage';

/** One scanned behavior: where it lives + how the row reads. */
interface BehaviorRow {
  path: NodePath;
  label: string;
  title: string;
}

/** Walk a document for view-scoped behaviors: row-click actions and
 *  hover/click cards, card content included (CARD_SEGMENT paths). Pure over
 *  the tree — exported for the unit contract. */
export function scanBehaviors(root: SPElement): BehaviorRow[] {
  const out: BehaviorRow[] = [];
  const nameOf = (el: SPElement): string => el._elmName ?? `<${el.elmType}>`;
  const walk = (el: SPElement, path: NodePath): void => {
    if (el.customRowAction) {
      out.push({
        path,
        label: `▶ ${el.customRowAction.action || 'click action'} — ${nameOf(el)}`,
        title: 'A click action (customRowAction) — click to jump to the element that carries it',
      });
    }
    if (el.customCardProps) {
      out.push({
        path,
        label: `▣ ${el.customCardProps.openOnEvent === 'click' ? 'click' : 'hover'} card — ${nameOf(el)}`,
        title: 'A hover/click card (customCardProps) — click to jump to the element it opens from',
      });
    }
    el.children?.forEach((c, i) => walk(c, [...path, i]));
    if (el.customCardProps?.formatter) walk(el.customCardProps.formatter, [...path, CARD_SEGMENT]);
  };
  walk(root, []);
  return out;
}

export function mountViewCard(host: HTMLElement, onToast: (m: string) => void): void {
  host.classList.add('wb-viewcard');

  /** name + dim kind tag heading, shared by both card shapes. */
  const heading = (mark: string, name: string, kind: string, cls = ''): HTMLElement => {
    const head = document.createElement('div');
    head.className = `wb-viewcard-head ${cls}`.trim();
    const m = document.createElement('span');
    m.className = 'wb-viewcard-mark';
    m.textContent = mark;
    m.setAttribute('aria-hidden', 'true');
    const nm = document.createElement('span');
    nm.className = 'wb-viewcard-name';
    nm.textContent = name;
    const kd = document.createElement('span');
    kd.className = 'wb-viewcard-kind';
    kd.textContent = kind;
    head.append(m, nm, kd);
    return head;
  };

  const renderViewCard = (): void => {
    const view = state.activeView!;
    host.appendChild(heading(view.doc.kind === 'tile' ? '▤' : '☰', view.name,
      view.doc.kind === 'tile' ? 'tile view' : 'row view'));

    // ── density: Roomy/Compact on the root (the canvas toolbar's twin) ───────
    const density = rowDensityOf(state.doc.root);
    const densRow = document.createElement('div');
    densRow.className = 'wb-viewcard-row';
    const densLab = document.createElement('span');
    densLab.className = 'wb-viewcard-label';
    densLab.textContent = 'Density';
    const seg = document.createElement('span');
    seg.className = 'wb-viewcard-seg';
    seg.setAttribute('role', 'group');
    seg.setAttribute('aria-label', 'Row density');
    for (const d of ['roomy', 'compact'] as RowDensity[]) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'wb-viewcard-segbtn' + (density === d ? ' active' : '');
      b.setAttribute('aria-pressed', String(density === d));
      b.textContent = DENSITY_LABEL[d];
      b.title = `${DENSITY_LABEL[d]} spacing for the whole row — one undoable step`;
      b.addEventListener('click', () => {
        if (density === d) return;
        state.setRowDensity(d);
        onToast(`Row density: ${DENSITY_LABEL[d]}`);
      });
      seg.appendChild(b);
    }
    densRow.append(densLab, seg);
    host.appendChild(densRow);

    // ── the extra row class (viewExtras.additionalRowClass) ─────────────────
    const classRow = document.createElement('label');
    classRow.className = 'wb-viewcard-row';
    const classLab = document.createElement('span');
    classLab.className = 'wb-viewcard-label';
    classLab.textContent = 'Row class';
    const classInp = document.createElement('input');
    classInp.type = 'text';
    classInp.className = 'wb-viewcard-rowclass';
    classInp.placeholder = 'none';
    const current = state.doc.viewExtras?.additionalRowClass;
    classInp.value = typeof current === 'string' ? current : '';
    classInp.title = 'additionalRowClass — a CSS class SharePoint puts on every row this view renders (zebra striping and friends). Clear it to remove.';
    const commitClass = (): void => {
      const v = classInp.value.trim();
      const before = state.doc.viewExtras?.additionalRowClass;
      if (v === (typeof before === 'string' ? before : '')) return;
      // ONE document mutation: set, or delete the key (an empty viewExtras
      // object is dropped whole so the export stays clean)
      state.mutateDocument(() => {
        if (v) {
          state.doc.viewExtras = { ...state.doc.viewExtras, additionalRowClass: v };
        } else if (state.doc.viewExtras) {
          const next = { ...state.doc.viewExtras };
          delete next.additionalRowClass;
          if (Object.keys(next).length) state.doc.viewExtras = next;
          else delete state.doc.viewExtras;
        }
      });
      onToast(v ? `Every row now carries the "${v}" class — Ctrl+Z undoes` : 'Row class removed — Ctrl+Z undoes');
    };
    classInp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); commitClass(); }
    });
    classInp.addEventListener('blur', commitClass);
    classRow.append(classLab, classInp);
    host.appendChild(classRow);

    // ── scanned behaviors: actions + cards, with jump-to-element ────────────
    const behaviors = scanBehaviors(state.doc.root);
    if (behaviors.length) {
      const bhead = document.createElement('div');
      bhead.className = 'wb-viewcard-group';
      bhead.textContent = 'Behaviors';
      host.appendChild(bhead);
      for (const b of behaviors) {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'wb-viewcard-behavior';
        row.textContent = b.label;
        row.title = b.title;
        row.addEventListener('click', () => state.select(b.path));
        host.appendChild(row);
      }
    }
  };

  const renderDefCard = (defId: string): void => {
    const def = componentById(defId);
    if (!def) return; // the strip is already closing this orphaned tab
    host.appendChild(heading('⬡', def.name,
      def.kind === 'row' ? 'row component' : 'component', 'wb-viewcard-def'));
    if (def.slots.length) {
      const slots = document.createElement('div');
      slots.className = 'wb-viewcard-slots';
      for (const slot of def.slots) {
        const chip = document.createElement('span');
        chip.className = 'wb-comp-slot';
        chip.textContent = slot.label;
        chip.title = slot.description ?? slot.label;
        slots.appendChild(chip);
      }
      host.appendChild(slots);
    }
    const uses = scanComponentUsages([def], state.doc.root, state.columnLooks).get(def.id)?.length ?? 0;
    const count = document.createElement('div');
    count.className = 'wb-viewcard-usage';
    count.textContent = uses
      ? `Used in ${uses} place${uses === 1 ? '' : 's'} — saving re-bakes every instance.`
      : 'Not used anywhere yet — add it from the Components section below.';
    host.appendChild(count);
  };

  const render = (): void => {
    host.replaceChildren();
    if (state.activeComponentTab !== null) {
      host.hidden = false;
      renderDefCard(state.activeComponentTab);
      return;
    }
    if (state.onFloor) {
      // the grid shows nothing — a grid has no view-scoped behavior (§3.2)
      host.hidden = true;
      return;
    }
    host.hidden = false;
    renderViewCard();
  };

  const hostAny = host as unknown as { _unsub?: () => void };
  hostAny._unsub?.();
  hostAny._unsub = state.subscribe((reason) => {
    // 'load' = surface switches, 'data' = tab/rename/registry changes,
    // 'kind' = row⇄tile flips, 'document' = density/class/behavior edits
    if (reason === 'load' || reason === 'data' || reason === 'kind' || reason === 'document') render();
  });
  render();
}
