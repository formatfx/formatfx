/**
 * The VIEWS LIST (happy-dom) — COLUMNS-COMPONENTS-VIEWS §2-3: the old
 * anchored View Formatters popover became a standing left-pane section. One
 * row per named sheet (open = navigation into its canvas tab, never an undo
 * step; ✎/dblclick renames inline) plus the ＋ template on-ramps. The row
 * marked active follows the ACTIVE TAB — a workshop covering the canvas
 * unmarks the view underneath.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mountViewsList } from './viewMenu';
import { state } from './state';

const toast = (): void => {};

function addSheet(name?: string): string {
  return state.createView({ kind: 'row', root: { elmType: 'div', children: [] } }, name)!.id;
}

function mount(): HTMLElement {
  const host = document.createElement('div');
  document.body.appendChild(host);
  mountViewsList(host, toast);
  return host;
}

describe('viewsList', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    state.resetAll();
  });
  afterEach(() => {
    // close any template modal a test opened via its real path (overlay Esc)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    document.querySelectorAll<HTMLElement>('body > *').forEach((el) => {
      (el as unknown as { _unsub?: () => void })._unsub?.();
      el.remove();
    });
  });

  it('a fresh workspace teaches the model — no views yet, the on-ramps still offered', () => {
    const host = mount();
    // the section's own title row died 2026-07-09 — leftPane's collapsible
    // section header carries the "Views" title now
    expect(host.querySelector('.wb-viewslist-head')).toBeNull();
    expect(host.querySelector('.wb-viewslist-empty')?.textContent).toContain('columns and components');
    expect(host.querySelector('.wb-viewslist-row')).toBeNull();
    expect(host.querySelector('.wb-viewslist-newview')).not.toBeNull();
  });

  it('lists every sheet by name with its kind tag, marking the ACTIVE TAB\'s row', () => {
    addSheet('Sprint board');
    addSheet('Gallery');
    const host = mount();
    const names = [...host.querySelectorAll('.wb-viewslist-name')].map((n) => n.textContent);
    expect(names).toEqual(['Sprint board', 'Gallery']);
    // 'Gallery' was created last → it's the open sheet, so its row is marked
    const active = host.querySelector('.wb-viewslist-row.selected .wb-viewslist-name');
    expect(active?.textContent).toBe('Gallery');
    expect(host.querySelector('.wb-viewslist-row.selected .wb-viewslist-open')
      ?.getAttribute('aria-current')).toBe('true');
  });

  it('clicking a row opens that view — navigation only, no undo step — and re-renders live', () => {
    const a = addSheet('A');
    addSheet('B');
    const host = mount();
    const undoDepth = (state as unknown as { undoStack: string[] }).undoStack.length;
    const rowA = [...host.querySelectorAll<HTMLElement>('.wb-viewslist-name')]
      .find((n) => n.textContent === 'A')!.closest('.wb-viewslist-open') as HTMLElement;
    rowA.dispatchEvent(new Event('click'));
    expect(state.activeViewId).toBe(a);
    expect((state as unknown as { undoStack: string[] }).undoStack.length).toBe(undoDepth);
    expect(host.querySelector('.wb-viewslist-row.selected .wb-viewslist-name')?.textContent).toBe('A');
  });

  it('a workshop tab covering the canvas unmarks the view row (the active-TAB rule)', () => {
    addSheet('A');
    const host = mount();
    expect(host.querySelector('.wb-viewslist-row.selected')).not.toBeNull();
    state.openComponentTab('builtin-deadline-chip');
    expect(host.querySelector('.wb-viewslist-row.selected')).toBeNull();
    state.deactivateComponentTab();
    expect(host.querySelector('.wb-viewslist-row.selected')).not.toBeNull();
  });

  it('✎ → Enter commits the rename via renameView; Esc cancels; blank keeps the name', () => {
    const id = addSheet();
    const host = mount();
    (host.querySelector('.wb-tree-actions button') as HTMLElement).dispatchEvent(new Event('click'));
    let input = host.querySelector('.wb-viewslist-input') as HTMLInputElement;
    expect(input.value).toBe('View 1'); // prefilled with the current name
    input.value = 'Sprint board';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(state.viewById(id)?.name).toBe('Sprint board');
    expect(host.querySelector('.wb-viewslist-name')?.textContent).toBe('Sprint board');

    (host.querySelector('.wb-tree-actions button') as HTMLElement).dispatchEvent(new Event('click'));
    input = host.querySelector('.wb-viewslist-input') as HTMLInputElement;
    input.value = 'Discarded';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(state.viewById(id)?.name).toBe('Sprint board');

    (host.querySelector('.wb-tree-actions button') as HTMLElement).dispatchEvent(new Event('click'));
    input = host.querySelector('.wb-viewslist-input') as HTMLInputElement;
    input.value = '   ';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(state.viewById(id)?.name).toBe('Sprint board');
  });

  it('double-clicking the row renames too (the strip convention); blur commits', () => {
    const id = addSheet();
    const host = mount();
    (host.querySelector('.wb-viewslist-open') as HTMLElement).dispatchEvent(new Event('dblclick'));
    const input = host.querySelector('.wb-viewslist-input') as HTMLInputElement;
    input.value = 'Committed on blur';
    input.dispatchEvent(new Event('blur'));
    expect(state.viewById(id)?.name).toBe('Committed on blur');
  });

  it('＋ New view opens the layout selector — row AND tile layouts behind one door', () => {
    const host = mount();
    (host.querySelector('.wb-viewslist-newview') as HTMLElement).dispatchEvent(new Event('click'));
    expect(document.querySelector('.wb-template-modal')).not.toBeNull();
    const heads = [...document.querySelectorAll('.wb-template-gallery-head')].map((h) => h.textContent);
    expect(heads).toEqual(['Row layouts', 'Tile layouts']);
    // close via the real path so createOverlay detaches its document Esc listener
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(document.querySelector('.wb-template-modal')).toBeNull();
  });
});
