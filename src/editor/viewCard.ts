// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sam Yost. FormatFX is dual-licensed: AGPL-3.0-only (see LICENSE) or a commercial license (see LICENSING.md).

/**
 * editor/viewCard.ts — the "THIS VIEW" card (COLUMNS-COMPONENTS-VIEWS §3.2;
 * settings re-housed 2026-07-09, spec §A): name/kind of the active view tab
 * and the scanned behavior rows: every customRowAction / customCardProps in
 * the document, labeled and clickable — a click jumps to (selects) the
 * carrying element, where the inspector edits it. The ⋮ settings kebab
 * moved OFF the heading onto the Structure section header (2026-07-10) —
 * leftPane.ts holds the door, viewKebab.ts still holds the settings.
 *
 * Hidden while the Grid tab is up (the grid has no view-scoped behavior);
 * while a component WORKSHOP tab is active it shows a compact DEF card
 * instead — name, no-wrap [$slot] chips, and the def's usage count (a plain
 * clickable count over scanComponentUsages; clicking pops out the
 * where-it's-used jump rows).
 */

import { state, CARD_SEGMENT } from './state';
import type { NodePath, SPElement } from '../core/types';
import { componentById, openUsagePopout } from './componentLibrary';
import { scanComponentUsages } from './componentUsage';
import { isSectionCollapsed, setSectionCollapsed } from './paneSections';

/** The Behaviors fold's persistence id — a nested foldable under the pane
 *  sections' frozen store (paneSections.ts), same idiom as the Components
 *  library's own groups. Never rename (would reset everyone's fold). */
const BEHAVIORS_FOLD = 'viewcard-behaviors';

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
  void onToast; // kept for call-site stability — the settings kebab (its consumer) moved to leftPane.ts
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
    // (the ⋮ settings kebab lives on the Structure section header now —
    //  leftPane.ts owns the door, viewKebab.ts the panel)
    host.appendChild(head);

    // ── scanned behaviors: actions + cards, with jump-to-element — foldable
    //    (issue #279), same caret/aria idiom as the pane sections. State reads
    //    fresh each render (the card fully re-renders), so the fold survives.
    const behaviors = scanBehaviors(state.doc.root);
    if (behaviors.length) {
      const collapsed = isSectionCollapsed(BEHAVIORS_FOLD);
      const group = document.createElement('div');
      group.className = 'wb-viewcard-fold';
      group.classList.toggle('wb-collapsed', collapsed);
      const bhead = document.createElement('button');
      bhead.type = 'button';
      bhead.className = 'wb-lp-sec-head wb-viewcard-group';
      bhead.setAttribute('aria-expanded', String(!collapsed));
      bhead.setAttribute('aria-controls', 'wb-viewcard-behaviors');
      bhead.title = collapsed ? 'Show behaviors' : 'Hide behaviors';
      const caret = document.createElement('span');
      caret.className = 'wb-lp-sec-caret';
      caret.setAttribute('aria-hidden', 'true');
      const title = document.createElement('span');
      title.className = 'wb-lp-sec-title';
      // the count keeps the folded bar informative — you still see how many
      // behaviors the view carries without opening it
      title.textContent = `Behaviors (${behaviors.length})`;
      bhead.append(caret, title);
      const body = document.createElement('div');
      body.id = 'wb-viewcard-behaviors';
      body.className = 'wb-lp-sec-body wb-viewcard-behaviors';
      bhead.addEventListener('click', () => {
        const next = !group.classList.contains('wb-collapsed');
        group.classList.toggle('wb-collapsed', next);
        bhead.setAttribute('aria-expanded', String(!next));
        bhead.title = next ? 'Show behaviors' : 'Hide behaviors';
        setSectionCollapsed(BEHAVIORS_FOLD, next);
      });
      for (const b of behaviors) {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'wb-viewcard-behavior';
        row.textContent = b.label;
        row.title = b.title;
        row.addEventListener('click', () => state.select(b.path));
        body.appendChild(row);
      }
      group.append(bhead, body);
      host.appendChild(group);
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
        // the pill speaks the workshop's slot idiom — the [$Key] field ref,
        // with the label alongside when it says more than the key does
        const chip = document.createElement('span');
        chip.className = 'wb-comp-slot';
        chip.textContent = slot.label === slot.key ? `[$${slot.key}]` : `${slot.label} [$${slot.key}]`;
        chip.title = slot.description ?? slot.label;
        slots.appendChild(chip);
      }
      host.appendChild(slots);
    }
    const uses = scanComponentUsages([def], state.doc.root, state.columnLooks).get(def.id)?.length ?? 0;
    const count = document.createElement('button');
    count.type = 'button';
    count.className = 'wb-viewcard-usage';
    count.setAttribute('aria-haspopup', 'dialog');
    count.textContent = `Used in ${uses} place${uses === 1 ? '' : 's'}`;
    count.disabled = uses === 0;
    count.title = uses
      ? 'See every place this component is used — click one to jump there'
      : 'Not used anywhere yet — add it from the Components section below';
    count.addEventListener('click', (e) => {
      e.stopPropagation();
      openUsagePopout(count, def.id);
    });
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
