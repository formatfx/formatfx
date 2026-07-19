// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Sam Yost

/**
 * editor/acMenu.ts — the inline IntelliSense drop-down (shared DOM shell).
 *
 * One compact typeahead menu used by every formula surface — the fx bar
 * (Excel dialect) and the Code lens (SP dialect). The PURE decision of what
 * to offer lives in fxSuggest.ts (completionAt / spCompletionAt); this module
 * only draws the items and handles highlight / accept.
 *
 * Each row shows the completion plus its inline docs (#222): the output-type
 * badge, a one-line description, and — when the mock row could evaluate it
 * honestly — a live preview of the current value. Items without metadata
 * (operand/result templates) render as the plain monospace rows they always
 * were. Arrow keys highlight; Enter / Tab or click accepts; Escape closes
 * (all driven by the host editor's keydown — the menu never steals focus).
 */

import type { SuggestItem } from './fxSuggest';

export interface AcMenu {
  el: HTMLElement;
  /** Move the keyboard highlight by ±1 (wraps). */
  move: (delta: number) => void;
  /** Accept the highlighted item; false when there's nothing to accept. */
  accept: () => boolean;
  close: () => void;
}

/** How many completions the menu shows at once (the filter reaches the rest). */
const MAX_SHOWN = 12;

/** An explicit anchor point (viewport coordinates) — the JSON pane passes the
 *  caret's rect so the menu opens AT the caret instead of under the whole
 *  (tall) textarea. Absent, the menu anchors to the editor box as always. */
export interface AcAnchor { left: number; bottom: number; }

/**
 * Open the typeahead under `editor`, anchored and sized to it (or to
 * `anchor`, when the caller knows a better point — see AcAnchor). `onPick`
 * receives the picked item's insert text; the caller splices it into the
 * formula and re-runs its completion to chain.
 */
export function openAcMenu(editor: HTMLElement, items: SuggestItem[], onPick: (value: string) => void, anchor?: AcAnchor): AcMenu {
  const el = document.createElement('div');
  el.className = 'wb-fx-acmenu';
  const shown = items.slice(0, MAX_SHOWN);
  const nodes: HTMLElement[] = [];
  let active = 0;
  shown.forEach((item, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'wb-fx-acopt' + (i === 0 ? ' active' : '');
    fillAcOption(b, item);
    // keep focus in the editor so the click can't blur-commit first
    b.addEventListener('mousedown', (e) => e.preventDefault());
    b.addEventListener('click', () => onPick(item.insert));
    nodes.push(b);
    el.appendChild(b);
  });
  const setActive = (i: number): void => {
    nodes[active]?.classList.remove('active');
    active = (i + nodes.length) % nodes.length;
    nodes[active]?.classList.add('active');
    nodes[active]?.scrollIntoView({ block: 'nearest' });
  };
  document.body.appendChild(el);
  const r = editor.getBoundingClientRect();
  const a = anchor ?? { left: r.left, bottom: r.bottom };
  el.style.top = `${Math.min(a.bottom + 4, window.innerHeight - 12)}px`;
  el.style.left = `${Math.max(8, Math.min(a.left, window.innerWidth - el.offsetWidth - 8))}px`;
  el.style.minWidth = anchor ? '280px' : `${Math.max(180, r.width)}px`;
  return {
    el,
    move: (d) => setActive(active + d),
    accept: () => { if (!shown.length) return false; onPick(shown[active].insert); return true; },
    close: () => el.remove(),
  };
}

/** Render one completion row: insert text, then type badge / doc / live value. */
function fillAcOption(button: HTMLElement, item: SuggestItem): void {
  if (!item.type && !item.doc && item.preview === undefined) {
    button.textContent = item.insert; // a plain template row, as before
    return;
  }
  button.classList.add('wb-fx-acopt-rich');
  const ins = document.createElement('span');
  ins.className = 'wb-fx-ac-ins';
  ins.textContent = item.insert;
  button.appendChild(ins);
  if (item.type) {
    const t = document.createElement('span');
    t.className = 'wb-fx-ac-type';
    t.textContent = item.type;
    button.appendChild(t);
  }
  if (item.doc) {
    const d = document.createElement('span');
    d.className = 'wb-fx-ac-doc';
    d.textContent = item.doc;
    button.appendChild(d);
  }
  if (item.preview !== undefined) {
    const p = document.createElement('span');
    p.className = 'wb-fx-ac-val';
    p.textContent = item.preview;
    p.title = `Current mock value: ${item.preview}`;
    button.appendChild(p);
  }
  const tip = [item.doc, item.preview !== undefined ? `Now: ${item.preview}` : '']
    .filter(Boolean).join(' · ');
  if (tip) button.title = tip;
}
