/**
 * editor/columnGallery.ts — the formatted-columns picker (a ribbon affordance).
 *
 * A floating gallery of the columns that currently HAVE a formatter
 * (state.columnRefs), each shown as a live preview rendered against the mock
 * rows. Picking one opens that column's formatter for editing
 * (state.openColumnRef) — the quick way back into a formatter you've built.
 *
 * Preview-driven: you choose by what the column looks like, not by name.
 */

import { state } from './state';
import { renderElement } from '../core/renderer';
import type { EvalContext } from '../core/expressions';
import type { SPElement } from '../core/types';
import { cfrFieldName } from '../core/refs';
import { fieldLabel } from './gridScaffold';
import { openColumnFormatMenuFor } from './gridView';

/** Column names that currently carry a formatter, in registry order. */
export function formattedColumnNames(): string[] {
  return Object.keys(state.columnRefs);
}

let openPanel: { panel: HTMLElement; cleanup: () => void } | null = null;

export function closeColumnGallery(): void {
  if (!openPanel) return;
  openPanel.cleanup();
  openPanel.panel.remove();
  openPanel = null;
}

const resolveColumnRef = (fieldRef: string): SPElement | null => {
  const name = cfrFieldName(fieldRef);
  return state.columnRefs[name] ?? null;
};

function previewCtx(rowIndex: number, fieldName: string): EvalContext {
  return {
    row: state.rows[rowIndex] ?? {},
    rowIndex,
    currentFieldName: fieldName,
    me: state.me,
    iterators: {},
    iteratorIndex: {},
    displayNames: Object.fromEntries(state.fields.map((f) => [f.name, f.displayName ?? f.name])),
    now: new Date(),
  };
}

/** Open the gallery anchored under `anchor`. Click a card → open that formatter. */
export function openColumnGallery(anchor: HTMLElement, onToast: (m: string) => void): void {
  closeColumnGallery();

  const panel = document.createElement('div');
  panel.className = 'wb-colgal';

  const head = document.createElement('div');
  head.className = 'wb-colgal-head';
  head.textContent = 'Column Formatters';
  panel.appendChild(head);

  const names = formattedColumnNames();

  const formattedLabel = document.createElement('div');
  formattedLabel.className = 'wb-colgal-group';
  formattedLabel.textContent = 'Formatted';
  panel.appendChild(formattedLabel);

  if (names.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'wb-colgal-empty';
    empty.textContent = 'No columns have a formatter yet. Start one from the “Not yet formatted” list below.';
    panel.appendChild(empty);
  }

  // up to 3 sample rows; `|| 1` keeps a single empty-context preview if the
  // maker has cleared all mock rows, so the card still shows the formatter
  const rowCount = Math.min(state.rows.length || 1, 3);
  for (const name of names) {
    const field = state.fields.find((f) => f.name === name);
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'wb-colgal-card';
    card.title = `Open the ${name} column formatter`;

    const label = document.createElement('div');
    label.className = 'wb-colgal-label';
    label.textContent = field?.displayName ?? name;

    const preview = document.createElement('div');
    preview.className = 'wb-colgal-preview';
    for (let i = 0; i < rowCount; i++) {
      const cell = document.createElement('div');
      cell.className = 'wb-colgal-cell';
      try {
        cell.appendChild(renderElement(state.columnRefs[name], previewCtx(i, name), { resolveColumnRef }));
      } catch {
        cell.textContent = '—';
      }
      preview.appendChild(cell);
    }

    card.append(label, preview);
    card.addEventListener('click', () => {
      closeColumnGallery();
      state.openColumnRef(name);
      onToast(`Editing the ${name} column formatter`);
    });
    panel.appendChild(card);
  }

  // ── Not yet formatted: every schema field without a formatter, as plain
  // rows. Click → the existing type-aware "Format this column" flow. ─────────
  const unformatted = state.fields.filter(
    (f) => !f.protected && !(f.name in state.columnRefs),
  );
  if (unformatted.length) {
    const newLabel = document.createElement('div');
    newLabel.className = 'wb-colgal-group';
    newLabel.textContent = 'Not yet formatted';
    panel.appendChild(newLabel);
    for (const field of unformatted) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'wb-colgal-newrow';
      row.textContent = fieldLabel(field);
      row.title = `Start a formatter for the ${fieldLabel(field)} column`;
      row.addEventListener('click', () => {
        closeColumnGallery();
        openColumnFormatMenuFor(field, anchor, onToast);
      });
      panel.appendChild(row);
    }
  }

  document.body.appendChild(panel);

  // position under the anchor, kept on-screen
  const r = anchor.getBoundingClientRect();
  panel.style.top = `${Math.min(r.bottom + 6, Math.max(8, window.innerHeight - 320))}px`;
  panel.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - 340))}px`;

  let done = false;
  const close = (): void => { if (!done) { done = true; closeColumnGallery(); } };
  const onOutside = (e: PointerEvent): void => {
    if (!panel.contains(e.target as Node) && e.target !== anchor) close();
  };
  const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') close(); };
  setTimeout(() => {
    document.addEventListener('pointerdown', onOutside);
    document.addEventListener('keydown', onKey);
  }, 0);
  const cleanup = (): void => {
    document.removeEventListener('pointerdown', onOutside);
    document.removeEventListener('keydown', onKey);
  };
  openPanel = { panel, cleanup };
}
