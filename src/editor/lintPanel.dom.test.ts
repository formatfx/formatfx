// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sam Yost. FormatFX is dual-licensed: AGPL-3.0-only (see LICENSE) or a commercial license (see LICENSING.md).

/**
 * lintPanel.dom.test.ts — DOM contracts for the lint footer rework:
 *   · the missing-column flood folds to ONE row per column with a ×N badge;
 *   · row click still jumps to the (first) referencing element;
 *   · ＋ Create column opens a type picker preselected by usage inference,
 *     and Add lands the field in the mock schema (shared addMockField recipe);
 *   · the head bar minimizes the list to a severity summary and back,
 *     surviving re-renders (the summary IS the collapsed view);
 *   · the hide-missing-columns filter quiets rows AND squiggles, says how
 *     many it hid, and persists under the additive wb-lint-prefs.v1 key.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mountJsonPanel } from './jsonPanel';
import { state } from './state';
import { LINT_PREFS_KEY } from './lintView';

let toasts: string[] = [];

afterEach(() => {
  document.querySelectorAll<HTMLElement>('body > *').forEach((el) => {
    (el as unknown as { _unsub?: () => void })._unsub?.();
    el.remove();
  });
  state.resetAll();
});

beforeEach(() => {
  localStorage.clear();
  state.resetAll();
  toasts = [];
});

function mountPanel() {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const api = mountJsonPanel(host, (m) => toasts.push(m));
  const shell = host.querySelector('#wb-json-shell') as HTMLDivElement;
  const lint = host.querySelector('#wb-lint') as HTMLElement;
  return { host, shell, lint, api };
}

/** Three references to a missing [$Ghost] column: two elements, one of them
 *  referencing it twice (txtContent + a style formula) — so the fold shows
 *  count 3 while the jump list has 2 unique elements. The usage (addDays,
 *  @now comparison) says "date". */
function addGhostRefs(): void {
  state.mutateDocument(() => {
    state.nodeAt([0])!.txtContent = '=addDays([$Ghost],1)';
    const n1 = state.nodeAt([1])!;
    n1.txtContent = '[$Ghost]';
    n1.style = { ...(n1.style ?? {}), color: "=if([$Ghost]<=@now,'red','green')" };
  });
}

describe('the missing-column fold', () => {
  it('one row per missing column, with a reference-count badge', () => {
    const { lint, api } = mountPanel();
    addGhostRefs();
    api.refreshLint([]);
    const rows = lint.querySelectorAll('.wb-lint-item');
    expect(rows).toHaveLength(1); // 3 diagnostics folded into one row
    const row = rows[0] as HTMLElement;
    expect(row.classList.contains('wb-lint-missing')).toBe(true);
    expect(row.querySelector('.wb-lint-msg')!.textContent).toContain('[$Ghost]');
    expect(row.querySelector('.wb-lint-count')!.textContent).toBe('×3');
  });

  it('clicking the row selects the first referencing element', () => {
    const { lint, api } = mountPanel();
    addGhostRefs();
    api.refreshLint([]);
    (lint.querySelector('.wb-lint-missing') as HTMLElement).click();
    expect(state.selection).toEqual([0]);
  });
});

describe('create column from the lint row', () => {
  it('the picker preselects the usage-inferred type and Add creates the field', () => {
    const { lint, api } = mountPanel();
    addGhostRefs();
    api.refreshLint([]);
    (lint.querySelector('.wb-lint-create') as HTMLButtonElement).click();
    const sel = lint.querySelector('.wb-lint-createform select') as HTMLSelectElement;
    expect(sel).not.toBeNull();
    expect(sel.value).toBe('date'); // addDays + @now comparison say date

    (lint.querySelector('.wb-lint-createok') as HTMLButtonElement).click();
    const field = state.fields.find((f) => f.name === 'Ghost');
    expect(field?.type).toBe('date');
    // sample values seeded into every mock row
    expect(state.rows.every((r) => r.Ghost !== undefined)).toBe(true);
    expect(toasts.some((t) => t.includes('Added Ghost'))).toBe(true);

    api.refreshLint([]); // the app does this on the 'data' emit (main.ts)
    expect(lint.querySelector('.wb-lint-missing')).toBeNull();
    expect(lint.querySelector('.wb-lint-ok')).not.toBeNull();
  });

  it('Add on a column that meanwhile exists explains itself instead of failing silently', () => {
    const { lint, api } = mountPanel();
    addGhostRefs();
    api.refreshLint([]);
    (lint.querySelector('.wb-lint-create') as HTMLButtonElement).click();
    // the column lands from elsewhere (the Data tab) while the form is open
    state.addMockField({ name: 'Ghost', type: 'text' });
    (lint.querySelector('.wb-lint-createok') as HTMLButtonElement).click();
    expect(toasts.some((t) => t.includes('already in the Data tab'))).toBe(true);
    expect(state.fields.filter((f) => f.name === 'Ghost')).toHaveLength(1); // no dupe
  });

  it('a picked type overrides the guess', () => {
    const { lint, api } = mountPanel();
    addGhostRefs();
    api.refreshLint([]);
    (lint.querySelector('.wb-lint-create') as HTMLButtonElement).click();
    const sel = lint.querySelector('.wb-lint-createform select') as HTMLSelectElement;
    sel.value = 'choice';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    (lint.querySelector('.wb-lint-createok') as HTMLButtonElement).click();
    expect(state.fields.find((f) => f.name === 'Ghost')?.type).toBe('choice');
  });
});

describe('the head bar', () => {
  it('shows severity counts and minimizes to just the summary, surviving re-renders', () => {
    const { lint, api } = mountPanel();
    addGhostRefs();
    api.refreshLint([]);
    expect(lint.querySelector('.wb-lint-chip-warning')!.textContent).toContain('3');

    const fold = lint.querySelector('.wb-lint-fold') as HTMLButtonElement;
    expect(fold.getAttribute('aria-expanded')).toBe('true');
    fold.click();
    expect((lint.querySelector('#wb-lint-body') as HTMLElement).hidden).toBe(true);
    // a later re-render (any emit refreshes lint) keeps it minimized
    api.refreshLint([]);
    expect((lint.querySelector('#wb-lint-body') as HTMLElement).hidden).toBe(true);
    expect((lint.querySelector('.wb-lint-fold') as HTMLElement).getAttribute('aria-expanded')).toBe('false');
    // the summary stays visible while minimized
    expect(lint.querySelector('.wb-lint-chip-warning')).not.toBeNull();

    (lint.querySelector('.wb-lint-fold') as HTMLButtonElement).click();
    expect((lint.querySelector('#wb-lint-body') as HTMLElement).hidden).toBe(false);
  });

  it('runtime issues count in the summary as their own kind', () => {
    const { lint, api } = mountPanel();
    api.refreshLint([{ path: [0], message: 'runtime boom' }]);
    expect(lint.querySelector('.wb-lint-chip-runtime')!.textContent).toContain('1');
    expect(lint.querySelector('.wb-lint-runtime .wb-lint-msg')!.textContent).toBe('runtime boom');
  });
});

describe('the hide-missing-columns filter', () => {
  it('quiets the rows and the squiggles, reports the hidden count, and persists', () => {
    const { shell, lint, api } = mountPanel();
    addGhostRefs();
    api.refreshLint([]);
    // unfiltered: rows + warning squiggles on the opening lines
    expect(lint.querySelector('.wb-lint-missing')).not.toBeNull();
    expect(shell.querySelector('.wb-json-sq .wb-sq-warning')).not.toBeNull();

    const cb = lint.querySelector('#wb-lint-hide-missing') as HTMLInputElement;
    cb.checked = true;
    cb.dispatchEvent(new Event('change', { bubbles: true }));

    expect(lint.querySelector('.wb-lint-missing')).toBeNull();
    expect(lint.querySelector('.wb-lint-hiddennote')!.textContent).toBe('3 ignored');
    expect(shell.querySelector('.wb-json-sq .wb-sq-warning')).toBeNull();
    // the summary stays the full truth
    expect(lint.querySelector('.wb-lint-chip-warning')!.textContent).toContain('3');
    expect(JSON.parse(localStorage.getItem(LINT_PREFS_KEY)!)).toEqual({ hideMissingColumns: true });
  });

  it('the persisted filter greets the next mount', () => {
    localStorage.setItem(LINT_PREFS_KEY, '{"hideMissingColumns":true}');
    const { lint, api } = mountPanel();
    addGhostRefs();
    api.refreshLint([]);
    expect((lint.querySelector('#wb-lint-hide-missing') as HTMLInputElement).checked).toBe(true);
    expect(lint.querySelector('.wb-lint-missing')).toBeNull();
    expect(lint.querySelector('.wb-lint-hiddennote')!.textContent).toBe('3 ignored');
  });
});
