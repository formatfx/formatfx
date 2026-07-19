// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Sam Yost

/**
 * editor/viewKebab.ts — the structure-header kebab (spec
 * docs/superpowers/specs/2026-07-09-view-chrome-workshop-design.md §A;
 * re-anchored 2026-07-10 from the THIS VIEW card's heading onto the
 * Structure section header — leftPane.ts holds the ⋮ door now).
 *
 * On a VIEW tab it's everything view-scoped in one panel: density, row
 * class, the hide toggles (selection boxes / column headers / list header),
 * the tile box, Templates (the row/tile builder — moved here from the
 * canvas toolbar 2026-07-10), and the Command buttons drill-in (per-button
 * hides + presets over core/commandBar).
 *
 * On a COMPONENT workshop tab the option list changes — view-scoped
 * settings don't apply to a def, so openComponentKebab shows the
 * component-scoped door instead: Add to a view, and the where-it's-used
 * jump rows.
 *
 * The panel is BODY-OWNED and position:fixed (snapMenu's pattern) because
 * pane chrome re-renders wholesale on every 'document' emit — an inline
 * panel would be destroyed by its own gestures. Instead the panel
 * subscribes and REDRAWS IN PLACE on 'document' (its own commits and
 * Ctrl+Z alike), keeping mode + scroll; 'load'/'kind'/'data' (surface
 * switches, tab changes, undo's cross-surface hops) close it. Escape +
 * outside-pointerdown close; clicks inside never auto-close — this is a
 * settings surface, not an action menu (the Templates door and the
 * component jumps are the exceptions: they open another surface, so they
 * close the panel like the ☰ menu's example loader).
 *
 * Every gesture is ONE state.mutateDocument call. "Show" removes props
 * rather than writing `false`, so exports stay clean (the additionalRowClass
 * precedent).
 */

import { state } from './state';
import { rowDensityOf, DENSITY_LABEL, type RowDensity } from './areas';
import {
  COMMAND_GROUPS, COMMAND_PRESETS, readCommandState, setCommandHidden,
  applyCommandPreset, hiddenCommandCount, type CommandPreset,
} from '../core/commandBar';
import { openTemplateModal } from './templateModal';
import { componentById, openComponentMapper, usageJumpList } from './componentLibrary';
import { scanComponentUsages } from './componentUsage';

type Mode = 'main' | 'commands';

let open: {
  panel: HTMLElement;
  anchor: HTMLElement;
  cleanup: () => void;
} | null = null;

export function closeViewKebab(): void {
  if (!open) return;
  open.cleanup();
  open.panel.remove();
  open = null;
}

/** Write the next viewExtras object (or drop it entirely) inside a mutation. */
function putExtras(next: Record<string, unknown> | undefined): void {
  if (next) state.doc.viewExtras = next;
  else delete state.doc.viewExtras;
}

const EYE_ON = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.2" d="M1.5 8S4 3.8 8 3.8 14.5 8 14.5 8 12 12.2 8 12.2 1.5 8 1.5 8z"/><circle cx="8" cy="8" r="2" fill="currentColor"/></svg>';
const EYE_OFF = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.2" d="M1.5 8S4 3.8 8 3.8 14.5 8 14.5 8 12 12.2 8 12.2 1.5 8 1.5 8z" opacity=".45"/><path stroke="currentColor" stroke-width="1.2" d="M3 13L13 3"/></svg>';

export function openViewKebab(anchor: HTMLElement, onToast: (m: string) => void): void {
  // second click on the same anchor toggles the panel shut
  if (open && open.anchor === anchor) { closeViewKebab(); return; }
  closeViewKebab();

  let mode: Mode = 'main';

  const panel = document.createElement('div');
  panel.className = 'wb-viewkebab wb-esc-owner';
  // announced as a newly opened surface, not a grouping container (PR #267)
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'View settings');

  // ── row builders ──────────────────────────────────────────────────────────

  /** A labeled two-option segmented toggle in the density control's exact
   *  clothes (.wb-viewcard-seg / -segbtn — the owner's "look like the density
   *  toggle"). */
  const segRow = (
    prop: string, label: string, title: string,
    options: [string, string], activeIdx: 0 | 1,
    onPick: (idx: 0 | 1) => void,
  ): HTMLElement => {
    const row = document.createElement('div');
    row.className = 'wb-viewcard-row';
    row.dataset.prop = prop;
    const lab = document.createElement('span');
    lab.className = 'wb-viewcard-label';
    lab.textContent = label;
    lab.title = title;
    const seg = document.createElement('span');
    seg.className = 'wb-viewcard-seg';
    seg.setAttribute('role', 'group');
    seg.setAttribute('aria-label', `${label} — ${title}`);
    options.forEach((opt, i) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'wb-viewcard-segbtn' + (activeIdx === i ? ' active' : '');
      btn.setAttribute('aria-pressed', String(activeIdx === i));
      btn.textContent = opt;
      btn.addEventListener('click', () => {
        if (activeIdx === i) return;
        onPick(i as 0 | 1);
      });
      seg.appendChild(btn);
    });
    row.append(lab, seg);
    return row;
  };

  /** A boolean doc/viewExtras prop as a Show/Hide seg. `hidden` semantics:
   *  Hide writes true, Show DELETES the prop (clean export). */
  const hideRow = (
    prop: string, label: string, title: string,
    isHidden: boolean, setHidden: (hide: boolean) => void, toastCopy: (hide: boolean) => string,
  ): HTMLElement =>
    segRow(prop, label, title, ['Show', 'Hide'], isHidden ? 1 : 0, (idx) => {
      const hide = idx === 1;
      state.mutateDocument(() => setHidden(hide));
      onToast(toastCopy(hide));
    });

  const numberRow = (
    prop: 'tileWidth' | 'tileHeight', label: string, fallback: number,
  ): HTMLElement => {
    const row = document.createElement('label');
    row.className = 'wb-viewcard-row';
    row.dataset.prop = prop;
    const lab = document.createElement('span');
    lab.className = 'wb-viewcard-label';
    lab.textContent = label;
    const inp = document.createElement('input');
    inp.type = 'number';
    inp.className = 'wb-viewkebab-num';
    inp.value = String(state.doc[prop] ?? fallback);
    inp.addEventListener('change', () => {
      const v = Number(inp.value);
      if (!Number.isFinite(v) || v <= 0) { inp.value = String(state.doc[prop] ?? fallback); return; }
      if (v === state.doc[prop]) return;
      state.mutateDocument(() => { state.doc[prop] = v; });
      onToast(`${label}: ${v}px — Ctrl+Z undoes`);
    });
    row.append(lab, inp);
    return row;
  };

  const sep = (): HTMLElement => {
    const s = document.createElement('div');
    s.className = 'wb-viewkebab-sep';
    s.setAttribute('role', 'separator');
    return s;
  };

  // ── main mode ─────────────────────────────────────────────────────────────

  const buildMain = (): HTMLElement[] => {
    const out: HTMLElement[] = [];
    const doc = state.doc;

    // density — the canvas toolbar's twin, verbatim semantics
    const density = rowDensityOf(doc.root);
    out.push(segRow(
      'density', 'Density', 'Roomy/Compact spacing for the whole row — one undoable step',
      [DENSITY_LABEL.roomy, DENSITY_LABEL.compact], density === 'compact' ? 1 : 0,
      (idx) => {
        const d: RowDensity = idx === 1 ? 'compact' : 'roomy';
        state.setRowDensity(d);
        onToast(`Row density: ${DENSITY_LABEL[d]}`);
      },
    ));

    // The "Row class" (additionalRowClass) input is GONE (owner call
    // 2026-07-17): SharePoint ignores the property whenever a rowFormatter
    // is present — every view here exports one, so the field only ever
    // authored dead JSON. Conditional row styling belongs on the row root
    // (the builder's zebra emits the @rowIndex class expression there);
    // pasted JSON carrying the key still round-trips via viewExtras and the
    // rowclass-with-rowformatter lint rule teaches why it won't paint.

    // the hide toggles — Show deletes, Hide writes true
    out.push(hideRow(
      'hideSelection', 'Selection boxes',
      'hideSelection — the row checkboxes SharePoint shows on hover/selection',
      doc.hideSelection === true,
      (hide) => { if (hide) state.doc.hideSelection = true; else delete state.doc.hideSelection; },
      (hide) => hide ? 'Selection boxes hidden on every row — Ctrl+Z undoes' : 'Selection boxes back — Ctrl+Z undoes',
    ));
    if (doc.kind === 'row' || doc.kind === 'grid') {
      out.push(hideRow(
        'hideColumnHeader', 'Column headers',
        'hideColumnHeader — the column-name header row above the list',
        doc.hideColumnHeader === true,
        (hide) => { if (hide) state.doc.hideColumnHeader = true; else delete state.doc.hideColumnHeader; },
        (hide) => hide ? 'Column headers hidden — Ctrl+Z undoes' : 'Column headers back — Ctrl+Z undoes',
      ));
      out.push(hideRow(
        'hideListHeader', 'List header',
        'hideListHeader — the list header area above the command bar',
        doc.viewExtras?.hideListHeader === true,
        (hide) => {
          if (hide) {
            state.doc.viewExtras = { ...state.doc.viewExtras, hideListHeader: true };
          } else if (state.doc.viewExtras) {
            const next = { ...state.doc.viewExtras };
            delete next.hideListHeader;
            putExtras(Object.keys(next).length ? next : undefined);
          }
        },
        (hide) => hide ? 'List header hidden — Ctrl+Z undoes' : 'List header back — Ctrl+Z undoes',
      ));
    }
    if (doc.kind === 'tile') {
      out.push(
        numberRow('tileWidth', 'Tile width', 254),
        numberRow('tileHeight', 'Tile height', 220),
        hideRow(
          'fillHorizontally', 'Fill across', 'fillHorizontally — stretch the tile row to fill the view width',
          doc.fillHorizontally === true,
          (on) => { if (on) state.doc.fillHorizontally = true; else delete state.doc.fillHorizontally; },
          (on) => on ? 'Tiles fill the row — Ctrl+Z undoes' : 'Tiles back to their own width — Ctrl+Z undoes',
        ),
      );
      // seg options read On/Off better than Show/Hide for a stretch behavior
      const fillSeg = out[out.length - 1].querySelectorAll<HTMLButtonElement>('.wb-viewcard-segbtn');
      if (fillSeg.length === 2) { fillSeg[0].textContent = 'Off'; fillSeg[1].textContent = 'On'; }
    }
    out.push(sep());

    // the Command buttons drill-in door
    const cmdBtn = document.createElement('button');
    cmdBtn.type = 'button';
    cmdBtn.className = 'wb-viewkebab-commands';
    cmdBtn.title = 'Show or hide SharePoint’s command-bar buttons for this view — per button, or with one preset';
    const cmdLabel = document.createElement('span');
    cmdLabel.textContent = 'Command buttons…';
    cmdBtn.appendChild(cmdLabel);
    const hiddenN = hiddenCommandCount(doc.viewExtras);
    if (hiddenN > 0) {
      const count = document.createElement('span');
      count.className = 'wb-viewkebab-count';
      count.textContent = `${hiddenN} hidden`;
      cmdBtn.appendChild(count);
    }
    cmdBtn.addEventListener('click', () => { mode = 'commands'; redraw(); });
    out.push(cmdBtn);

    // Templates — the row/tile builder door (moved off the canvas toolbar,
    // 2026-07-10). Opening a modal is an ACTION, so it closes the panel.
    const tplBtn = document.createElement('button');
    tplBtn.type = 'button';
    tplBtn.className = 'wb-viewkebab-templates';
    tplBtn.title = doc.kind === 'tile'
      ? 'Start from a pre-built tile layout (skeleton + stackable styles)'
      : 'Start from a pre-built row layout (skeleton + stackable styles)';
    const tplLabel = document.createElement('span');
    tplLabel.textContent = '▤ Templates…';
    tplBtn.appendChild(tplLabel);
    tplBtn.addEventListener('click', () => {
      closeViewKebab();
      openTemplateModal(onToast);
    });
    out.push(tplBtn);
    return out;
  };

  // ── commands mode ─────────────────────────────────────────────────────────

  const buildCommands = (): HTMLElement[] => {
    const out: HTMLElement[] = [];
    const cmdState = readCommandState(state.doc.viewExtras);

    const head = document.createElement('div');
    head.className = 'wb-viewkebab-head';
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'wb-viewkebab-back';
    back.textContent = '‹ Back';
    back.addEventListener('click', () => { mode = 'main'; redraw(); });
    const title = document.createElement('span');
    title.className = 'wb-viewkebab-title';
    title.textContent = 'Command buttons';
    head.append(back, title);
    out.push(head);

    const note = document.createElement('div');
    note.className = 'wb-viewkebab-note';
    note.textContent = 'Hides ride the view formatter (commandBarProps) — they apply to everyone who opens this view. Hiding a button also hides its right-click menu entry.';
    out.push(note);

    const presets = document.createElement('div');
    presets.className = 'wb-viewkebab-presets';
    for (const preset of COMMAND_PRESETS) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'wb-viewkebab-preset';
      chip.dataset.preset = preset.id;
      chip.textContent = preset.label;
      chip.title = preset.hint;
      chip.addEventListener('click', () => {
        state.mutateDocument(() => {
          putExtras(applyCommandPreset(state.doc.viewExtras, preset.id as CommandPreset['id']));
        });
        onToast(`Command buttons: ${preset.label} — Ctrl+Z undoes`);
      });
      presets.appendChild(chip);
    }
    out.push(presets);

    for (const group of COMMAND_GROUPS) {
      const gh = document.createElement('div');
      gh.className = 'wb-viewkebab-group';
      gh.textContent = group.label;
      out.push(gh);
      for (const btn of group.buttons) {
        const isHidden = cmdState.hidden.has(btn.id);
        const isFormula = cmdState.formula.has(btn.id);
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'wb-viewkebab-cmd' + (isHidden ? ' wb-hidden' : '');
        row.dataset.cmd = btn.id;
        row.setAttribute('aria-pressed', String(isHidden));
        row.title = (btn.hint ? `${btn.hint} — ` : '')
          + (isFormula
            ? 'a formula drives this button’s visibility; clicking replaces it with a plain hide/show'
            : isHidden ? 'hidden on this view — click to show' : 'shown — click to hide');
        const lab = document.createElement('span');
        lab.className = 'wb-viewkebab-cmdlabel';
        lab.textContent = btn.label;
        row.appendChild(lab);
        if (isFormula) {
          const fx = document.createElement('span');
          fx.className = 'wb-viewkebab-fx';
          fx.textContent = '𝑓x';
          row.appendChild(fx);
        }
        const eye = document.createElement('span');
        eye.className = 'wb-viewkebab-eye';
        eye.innerHTML = isHidden ? EYE_OFF : EYE_ON;
        row.appendChild(eye);
        row.addEventListener('click', () => {
          const nextHidden = !isHidden;
          state.mutateDocument(() => {
            putExtras(setCommandHidden(state.doc.viewExtras, btn.id, nextHidden));
          });
          onToast(nextHidden
            ? `“${btn.label}” hidden on this view — Ctrl+Z undoes`
            : `“${btn.label}” back on the command bar — Ctrl+Z undoes`);
        });
        out.push(row);
      }
    }
    return out;
  };

  const redraw = (): void => {
    const scroll = panel.scrollTop;
    panel.replaceChildren(...(mode === 'commands' ? buildCommands() : buildMain()));
    panel.scrollTop = scroll;
  };

  redraw();
  document.body.appendChild(panel);

  // fixed under the anchor, right edge pinned to the anchor's right; clamp
  // against the panel's ACTUAL rendered height so a tall panel never hangs
  // off-screen (PR #267)
  const r = anchor.getBoundingClientRect();
  const w = panel.offsetWidth || 280;
  const h = panel.offsetHeight || 320;
  panel.style.top = `${Math.max(8, Math.min(r.bottom + 4, window.innerHeight - h - 8))}px`;
  panel.style.left = `${Math.max(8, r.right - w)}px`;

  let done = false;
  const close = (): void => { if (!done) { done = true; closeViewKebab(); } };
  const onOutside = (e: PointerEvent): void => {
    if (!panel.contains(e.target as Node) && !anchor.contains(e.target as Node)) close();
  };
  const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') close(); };
  const armTimer = window.setTimeout(() => document.addEventListener('pointerdown', onOutside), 0);
  document.addEventListener('keydown', onKey);
  // the panel belongs to the tab it opened on: any change that keeps that tab
  // active (own commits, Ctrl+Z of a panel gesture, row⇄tile flips, renames)
  // redraws in place; a change that moves the surface out from under it
  // (navigation, cross-surface undo, a workshop covering the canvas) closes.
  const openedTabKey = state.activeTabKey;
  const unsub = state.subscribe((reason) => {
    if (reason !== 'document' && reason !== 'load' && reason !== 'kind' && reason !== 'data') return;
    if (state.activeTabKey !== openedTabKey || state.onFloor) close();
    else redraw();
  });
  const cleanup = (): void => {
    window.clearTimeout(armTimer);
    document.removeEventListener('pointerdown', onOutside);
    document.removeEventListener('keydown', onKey);
    unsub();
  };
  open = { panel, anchor, cleanup };
}

/**
 * The structure-header kebab while a COMPONENT workshop tab is up: a def has
 * no view-scoped settings, so the panel offers the component-scoped doors
 * instead — Add to a view (the typed mapping dialog) and the where-it's-used
 * jump rows (each navigates to the instance, leaving the workshop showing-
 * wise; its tab and staged edits stay put). Same body-owned plumbing as the
 * view panel; a tab switch closes it, a document change redraws the counts.
 */
export function openComponentKebab(anchor: HTMLElement, defId: string, onToast: (m: string) => void): void {
  if (open && open.anchor === anchor) { closeViewKebab(); return; }
  closeViewKebab();

  const panel = document.createElement('div');
  panel.className = 'wb-viewkebab wb-viewkebab-component wb-esc-owner';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Component options');

  let done = false;
  const close = (): void => { if (!done) { done = true; closeViewKebab(); } };

  const redraw = (): void => {
    const def = componentById(defId);
    if (!def) { close(); return; } // the def vanished under the panel
    const scroll = panel.scrollTop;
    const out: HTMLElement[] = [];

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'wb-viewkebab-addcomp';
    addBtn.title = 'Map your columns into this component and add it to the canvas';
    const addLabel = document.createElement('span');
    addLabel.textContent = 'Add to view…';
    addBtn.appendChild(addLabel);
    addBtn.addEventListener('click', () => {
      close();
      openComponentMapper(def, onToast);
    });
    out.push(addBtn);

    const sep = document.createElement('div');
    sep.className = 'wb-viewkebab-sep';
    sep.setAttribute('role', 'separator');
    out.push(sep);

    const usesHead = document.createElement('div');
    usesHead.className = 'wb-viewkebab-group';
    usesHead.textContent = 'Where it’s used';
    out.push(usesHead);
    const inUse = scanComponentUsages([def], state.doc.root, state.columnLooks).get(def.id) ?? [];
    if (inUse.length) {
      out.push(usageJumpList(inUse, close));
    } else {
      const none = document.createElement('div');
      none.className = 'wb-viewkebab-note';
      none.textContent = 'Not used anywhere yet.';
      out.push(none);
    }

    panel.replaceChildren(...out);
    panel.scrollTop = scroll;
  };

  redraw();
  document.body.appendChild(panel);

  const r = anchor.getBoundingClientRect();
  const w = panel.offsetWidth || 280;
  const h = panel.offsetHeight || 240;
  panel.style.top = `${Math.max(8, Math.min(r.bottom + 4, window.innerHeight - h - 8))}px`;
  panel.style.left = `${Math.max(8, r.right - w)}px`;

  const onOutside = (e: PointerEvent): void => {
    if (!panel.contains(e.target as Node) && !anchor.contains(e.target as Node)) close();
  };
  const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') close(); };
  const armTimer = window.setTimeout(() => document.addEventListener('pointerdown', onOutside), 0);
  document.addEventListener('keydown', onKey);
  const openedTabKey = state.activeTabKey;
  const unsub = state.subscribe((reason) => {
    if (reason !== 'document' && reason !== 'load' && reason !== 'kind' && reason !== 'data') return;
    if (state.activeTabKey !== openedTabKey) close();
    else redraw();
  });
  const cleanup = (): void => {
    window.clearTimeout(armTimer);
    document.removeEventListener('pointerdown', onOutside);
    document.removeEventListener('keydown', onKey);
    unsub();
  };
  open = { panel, anchor, cleanup };
}
