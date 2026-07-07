/**
 * The left VIEW STRIP (happy-dom) — FLOOR-AND-SHEETS Stage 2, as amended by
 * the owner 2026-07-05: one chip per named sheet + the ＋ on-ramp, NO
 * grid/floor chip (the grid is the COLUMNS tab's canvas). Chip clicks are
 * navigation only; double-click renames inline (Enter/blur commit, Esc
 * cancels — the viewMenu convention).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { mountViewStrip } from './viewStrip';
import { state } from './state';
import { closeMenu } from './menu';

const toast = (): void => {};

function addSheet(name?: string): string {
  return state.createView({ kind: 'row', root: { elmType: 'div', children: [] } }, name)!.id;
}

function mount(): HTMLElement {
  const host = document.createElement('div');
  document.body.appendChild(host);
  mountViewStrip(host, toast);
  return host;
}

describe('viewStrip', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    closeMenu();
    state.resetAll();
  });

  it('renders one chip per sheet plus the ＋ on-ramp — and NO grid chip', () => {
    addSheet('Sprint board');
    addSheet('Gallery');
    const host = mount();
    const chips = [...host.querySelectorAll('.wb-viewstrip-chip')].map((c) => c.textContent);
    expect(chips).toEqual(['Sprint board', 'Gallery']);
    expect(host.querySelector('.wb-viewstrip-add')).not.toBeNull();
    expect(host.textContent).not.toContain('Grid'); // no flip-flop button (owner call)
  });

  it('is plain navigation to AT too: a nav landmark, the active chip aria-current', () => {
    addSheet('A');
    const host = mount();
    expect(host.getAttribute('role')).toBe('navigation');
    expect(host.getAttribute('aria-label')).toBe('Views');
    expect(host.querySelector('.wb-viewstrip-chip.active')?.getAttribute('aria-current')).toBe('true');
  });

  it('marks the open sheet active and re-renders on navigation', () => {
    const a = addSheet('A');
    addSheet('B');
    const host = mount();
    expect(host.querySelector('.wb-viewstrip-chip.active')?.textContent).toBe('B');
    state.openView(a);
    expect(host.querySelector('.wb-viewstrip-chip.active')?.textContent).toBe('A');
  });

  it('clicking a chip opens that sheet — navigation only, no undo step', () => {
    const a = addSheet('A');
    addSheet('B');
    const host = mount();
    const undoDepth = (state as unknown as { undoStack: string[] }).undoStack.length;
    const chipA = [...host.querySelectorAll<HTMLElement>('.wb-viewstrip-chip')]
      .find((c) => c.textContent === 'A')!;
    chipA.dispatchEvent(new Event('click'));
    expect(state.activeViewId).toBe(a);
    expect((state as unknown as { undoStack: string[] }).undoStack.length).toBe(undoDepth);
  });

  it('chips keep working from the floor — the grid stays where it was, the sheet slides over it', () => {
    const a = addSheet('A');
    state.minimizeView(); // standing on the floor (the COLUMNS canvas)
    const floorJson = JSON.stringify(state.floorDoc);
    const host = mount();
    const chipA = [...host.querySelectorAll<HTMLElement>('.wb-viewstrip-chip')]
      .find((c) => c.textContent === 'A')!;
    chipA.dispatchEvent(new Event('click'));
    expect(state.activeViewId).toBe(a);
    expect(JSON.stringify(state.floorDoc)).toBe(floorJson); // navigation mutated nothing
  });

  it('double-click renames inline: Enter commits via renameView, Esc cancels', () => {
    const id = addSheet();
    const host = mount();
    host.querySelector<HTMLElement>('.wb-viewstrip-chip')!.dispatchEvent(new Event('dblclick'));
    let input = host.querySelector<HTMLInputElement>('.wb-viewstrip-input')!;
    expect(input.value).toBe('View 1');
    input.value = 'Sprint board';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(state.viewById(id)?.name).toBe('Sprint board');
    expect(host.querySelector<HTMLElement>('.wb-viewstrip-chip')?.textContent).toBe('Sprint board');

    host.querySelector<HTMLElement>('.wb-viewstrip-chip')!.dispatchEvent(new Event('dblclick'));
    input = host.querySelector<HTMLInputElement>('.wb-viewstrip-input')!;
    input.value = 'Discarded';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(state.viewById(id)?.name).toBe('Sprint board');
  });

  it('blur commits the rename too (the viewMenu convention)', () => {
    const id = addSheet();
    const host = mount();
    host.querySelector<HTMLElement>('.wb-viewstrip-chip')!.dispatchEvent(new Event('dblclick'));
    const input = host.querySelector<HTMLInputElement>('.wb-viewstrip-input')!;
    input.value = 'Committed on blur';
    input.dispatchEvent(new Event('blur'));
    expect(state.viewById(id)?.name).toBe('Committed on blur');
    expect(host.querySelector<HTMLElement>('.wb-viewstrip-chip')?.textContent).toBe('Committed on blur');
  });

  it('＋ opens the New view menu with the row/tile template on-ramps', () => {
    const host = mount();
    host.querySelector<HTMLElement>('.wb-viewstrip-add')!.dispatchEvent(new Event('click'));
    const labels = [...document.querySelectorAll('.wb-grid-menu .wb-menu-main span')]
      .map((n) => n.textContent);
    expect(labels).toContain('New rowview…');
    expect(labels).toContain('New tileview…');
  });
});
