// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sam Yost. FormatFX is dual-licensed: AGPL-3.0-only (see LICENSE) or a commercial license (see LICENSING.md).

/**
 * editor/viewCard.ts — the "THIS VIEW" card (COLUMNS-COMPONENTS-VIEWS §3.2;
 * settings re-housed 2026-07-09, spec §A): name/kind of the active view tab,
 * the ⋮ VIEW SETTINGS kebab at the heading's far right (density, row class,
 * the hide toggles, the tile box and the Command buttons drill-in — all in
 * viewKebab.ts), and the scanned behavior rows: every customRowAction /
 * customCardProps in the document, labeled and clickable — a click jumps to
 * (selects) the carrying element, where the inspector edits it.
 *
 * Hidden while the Grid tab is up (the grid has no view-scoped behavior);
 * while a component WORKSHOP tab is active it shows a compact DEF card
 * instead — name, slot chips, and the def's usage count (scanComponentUsages
 * over the active surface + the column looks) — and no kebab.
 */

import { state, CARD_SEGMENT } from './state';
import type { NodePath, SPElement } from '../core/types';
import { componentById } from './componentLibrary';
import { scanComponentUsages } from './componentUsage';
import { openViewKebab } from './viewKebab';

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
    const head = heading(view.doc.kind === 'tile' ? '▤' : '☰', view.name,
      view.doc.kind === 'tile' ? 'tile view' : 'row view');

    // ── the View settings kebab (spec §A): the card holds the door, the
    //    body-owned viewKebab panel holds the settings — this card re-renders
    //    on every 'document' emit, which would destroy an inline panel ───────
    const kebab = document.createElement('button');
    kebab.type = 'button';
    kebab.className = 'wb-viewcard-kebab';
    // a settings popover with live controls, not an action menu — announce
    // as a dialog (Copilot review, PR #267)
    kebab.setAttribute('aria-haspopup', 'dialog');
    kebab.setAttribute('aria-label', 'View settings');
    kebab.title = 'View settings — density, row class, and what SharePoint shows around this view';
    kebab.innerHTML = KEBAB_ICON;
    kebab.addEventListener('click', (e) => {
      e.stopPropagation();
      openViewKebab(kebab, onToast);
    });
    head.appendChild(kebab);
    host.appendChild(head);

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

// ⋮ — the pane toolbar's kebab glyph (leftPane ICONS), theme via currentColor.
const KEBAB_ICON = '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M8 3a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm0 6.5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm0 6.5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z"/></svg>';
