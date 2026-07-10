/**
 * The THIS VIEW card (happy-dom) — COLUMNS-COMPONENTS-VIEWS §3.2: hidden on
 * the grid; on a view tab it names the view and carries the view-scoped
 * behaviors & properties (density, additionalRowClass, scanned action/card
 * rows with jump-to-element); while a component workshop tab is active it
 * shows a compact DEF card (name, slot chips, usage count) instead.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { mountViewCard, scanBehaviors } from './viewCard';
import { openViewKebab, closeViewKebab } from './viewKebab';
import { state, CARD_SEGMENT } from './state';
import { rowDensityOf } from './areas';
import type { SPElement } from '../core/types';

function mount(toasts: string[] = []): HTMLElement {
  const host = document.createElement('div');
  document.body.appendChild(host);
  mountViewCard(host, (m) => toasts.push(m));
  return host;
}

beforeEach(() => {
  document.body.innerHTML = '';
  state.resetAll();
});

describe('what shows when (per-tab shapes)', () => {
  it('the grid shows NOTHING — the card is hidden', () => {
    const host = mount();
    expect(state.onFloor).toBe(true);
    expect(host.hidden).toBe(true);
  });

  it('a view tab shows name + kind; navigation keeps it live', () => {
    state.createView({ kind: 'row', root: { elmType: 'div', children: [] } }, 'Sprint board');
    const host = mount();
    expect(host.hidden).toBe(false);
    expect(host.querySelector('.wb-viewcard-name')?.textContent).toBe('Sprint board');
    expect(host.querySelector('.wb-viewcard-kind')?.textContent).toBe('row view');
    state.minimizeView();
    expect(host.hidden).toBe(true);
    state.openView(state.views[0].id);
    expect(host.hidden).toBe(false);
  });

  it('a tile view reads "tile view"', () => {
    state.createView({ kind: 'tile', root: { elmType: 'div', children: [] } }, 'Gallery');
    const host = mount();
    expect(host.querySelector('.wb-viewcard-kind')?.textContent).toBe('tile view');
  });

  it('a component tab shows the compact DEF card: ⬡ name, [$slot] chips, usage count', () => {
    state.createView({
      kind: 'row',
      root: {
        elmType: 'div',
        children: [{
          elmType: 'div', txtContent: 'x',
          _component: { id: 'builtin-deadline-chip', map: { Due: 'DueDate' } },
        } as SPElement],
      },
    });
    state.openComponentTab('builtin-deadline-chip');
    const host = mount();
    expect(host.hidden).toBe(false);
    expect(host.querySelector('.wb-viewcard-mark')?.textContent).toBe('⬡');
    expect(host.querySelector('.wb-viewcard-name')?.textContent).toBe('Deadline chip');
    // one Due slot, speaking the workshop's [$Key] idiom, label alongside
    expect(host.querySelectorAll('.wb-comp-slot').length).toBe(1);
    expect(host.querySelector('.wb-comp-slot')?.textContent).toContain('[$Due]');
    expect(host.querySelector('.wb-viewcard-usage')?.textContent).toContain('1 place');
    // the count is plain prose, not the "save rebakes every instance" chatter
    expect(host.querySelector('.wb-viewcard-usage')?.textContent).not.toContain('bake');
    // no view-scoped controls on a def card
    expect(host.querySelector('.wb-viewcard-rowclass')).toBeNull();
    state.deactivateComponentTab();
    expect(host.querySelector('.wb-viewcard-name')?.textContent).toBe('View 1');
  });

  it('clicking the usage count pops out the where-it\'s-used jump rows; a jump navigates', () => {
    state.createView({
      kind: 'row',
      root: {
        elmType: 'div',
        children: [{
          elmType: 'div', txtContent: 'x',
          _component: { id: 'builtin-deadline-chip', map: { Due: 'DueDate' } },
        } as SPElement],
      },
    });
    state.openComponentTab('builtin-deadline-chip');
    const host = mount();
    (host.querySelector('.wb-viewcard-usage') as HTMLButtonElement).click();
    const pop = document.body.querySelector('.wb-usage-pop')!;
    expect(pop).toBeTruthy();
    const jumps = pop.querySelectorAll<HTMLButtonElement>('.wb-comp-usage');
    expect(jumps.length).toBe(1);
    jumps[0].click();
    // the jump uncovers the canvas (the workshop tab stays open) and selects
    expect(state.activeComponentTab).toBeNull();
    expect(state.selection).toEqual([0]);
    expect(document.body.querySelector('.wb-usage-pop')).toBeNull();
  });
});

describe('the settings kebab moved off the card (2026-07-10 — the Structure header holds the door)', () => {
  it('the card carries NO inline settings and NO kebab — everything lives in the structure-header kebab', () => {
    state.makeRowView();
    const host = mount();
    expect(host.querySelector('.wb-viewcard-seg')).toBeNull();
    expect(host.querySelector('.wb-viewcard-rowclass')).toBeNull();
    expect(host.querySelector('.wb-viewcard-kebab')).toBeNull();
    expect(host.querySelector('.wb-structure-kebab')).toBeNull(); // leftPane's, not the card's
  });

  it('a settings gesture re-renders the card but the body-owned panel survives', () => {
    state.makeRowView();
    mount();
    const anchor = document.createElement('button');
    document.body.appendChild(anchor);
    openViewKebab(anchor, () => {});
    const compact = [...document.body.querySelectorAll<HTMLButtonElement>('.wb-viewkebab [data-prop="density"] .wb-viewcard-segbtn')]
      .find((b) => b.textContent === 'Compact')!;
    compact.click();
    expect(rowDensityOf(state.doc.root)).toBe('compact');
    expect(document.body.querySelector('.wb-viewkebab')).toBeTruthy();
    closeViewKebab();
  });
});

describe('scanned behaviors (jump-to-element rows)', () => {
  const behaviorDoc = (): SPElement => ({
    elmType: 'div',
    children: [
      { elmType: 'button', _elmName: 'Go button', txtContent: 'Go', customRowAction: { action: 'executeFlow' } },
      {
        elmType: 'div', _elmName: 'Owner chip',
        customCardProps: {
          openOnEvent: 'hover',
          formatter: { elmType: 'div', children: [{ elmType: 'button', txtContent: 'inner', customRowAction: { action: 'defaultClick' } }] },
        },
      },
    ],
  });

  it('scanBehaviors finds actions and cards, card content included (CARD_SEGMENT paths)', () => {
    const rows = scanBehaviors(behaviorDoc());
    expect(rows.map((r) => r.path)).toEqual([[0], [1], [1, CARD_SEGMENT, 0]]);
    expect(rows[0].label).toBe('▶ executeFlow — Go button');
    expect(rows[1].label).toBe('▣ hover card — Owner chip');
    expect(rows[2].label).toBe('▶ defaultClick — <button>');
  });

  it('renders one row per behavior; clicking JUMPS (selects) — never mutates', () => {
    state.createView({ kind: 'row', root: behaviorDoc() });
    const host = mount();
    const rows = [...host.querySelectorAll<HTMLElement>('.wb-viewcard-behavior')];
    expect(rows.length).toBe(3);
    const undoDepth = (state as unknown as { undoStack: string[] }).undoStack.length;
    rows[1].click();
    expect(state.selection).toEqual([1]);
    rows[2].click();
    expect(state.selection).toEqual([1, CARD_SEGMENT, 0]);
    expect((state as unknown as { undoStack: string[] }).undoStack.length).toBe(undoDepth);
  });

  it('a behavior-free view shows no Behaviors group', () => {
    state.createView({ kind: 'row', root: { elmType: 'div', children: [] } });
    const host = mount();
    expect(host.querySelector('.wb-viewcard-group')).toBeNull();
    expect(host.querySelector('.wb-viewcard-behavior')).toBeNull();
  });
});
