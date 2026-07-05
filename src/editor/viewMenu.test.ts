/**
 * View Formatters menu (happy-dom): the multi-view list — the floor entry,
 * one row per named sheet (open = navigation, Rename inline), and the
 * template on-ramps (FLOOR-AND-SHEETS Stage 1).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { openViewMenu, closeViewMenu } from './viewMenu';
import { state } from './state';

const toast = (): void => {};
const anchor = (): HTMLElement => document.createElement('button');

function addSheet(name?: string): string {
  return state.createView({ kind: 'row', root: { elmType: 'div', children: [] } }, name)!.id;
}

describe('viewMenu', () => {
  beforeEach(() => { state.resetAll(); });
  afterEach(() => { closeViewMenu(); });

  it('always lists the grid floor; a fresh workspace has no views yet', () => {
    openViewMenu(anchor(), toast);
    expect(document.querySelector('.wb-viewmenu')).not.toBeNull();
    expect(document.querySelector('.wb-viewmenu-floor')).not.toBeNull();
    expect(document.querySelector('.wb-viewmenu-empty')).not.toBeNull();
    expect(document.querySelector('.wb-viewmenu-name')).toBeNull();
  });

  it('lists every sheet by name, marking the active one', () => {
    addSheet('Sprint board');
    addSheet('Gallery');
    openViewMenu(anchor(), toast);
    const names = [...document.querySelectorAll('.wb-viewmenu-name')].map((n) => n.textContent);
    expect(names).toEqual(['Sprint board', 'Gallery']);
    // 'Gallery' was created last → it's the open sheet
    const active = document.querySelector('.wb-viewmenu-active .wb-viewmenu-name');
    expect(active?.textContent).toBe('Gallery');
  });

  it('clicking a sheet opens it — navigation only, no undo step', () => {
    const a = addSheet('A');
    addSheet('B');
    const undoDepth = (state as unknown as { undoStack: string[] }).undoStack.length;
    openViewMenu(anchor(), toast);
    const rowA = [...document.querySelectorAll('.wb-viewmenu-name')]
      .find((n) => n.textContent === 'A') as HTMLElement;
    rowA.dispatchEvent(new Event('click'));
    expect(state.activeViewId).toBe(a);
    expect((state as unknown as { undoStack: string[] }).undoStack.length).toBe(undoDepth);
    expect(document.querySelector('.wb-viewmenu')).toBeNull(); // navigated → closed
  });

  it('the floor entry minimizes back to the grid', () => {
    addSheet('A');
    expect(state.onFloor).toBe(false);
    openViewMenu(anchor(), toast);
    (document.querySelector('.wb-viewmenu-floor .wb-viewmenu-open') as HTMLElement)
      .dispatchEvent(new Event('click'));
    expect(state.onFloor).toBe(true);
    expect(state.views).toHaveLength(1); // the sheet is untouched
  });

  it('Rename → Enter commits the new name via renameView and closes the menu', () => {
    const id = addSheet();
    openViewMenu(anchor(), toast);
    (document.querySelector('.wb-viewmenu-rename') as HTMLElement).dispatchEvent(new Event('click'));
    const input = document.querySelector('.wb-viewmenu-input') as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input.value).toBe('View 1'); // prefilled with the current name
    input.value = 'Sprint board';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(state.viewById(id)?.name).toBe('Sprint board');
    expect(document.querySelector('.wb-viewmenu')).toBeNull(); // committed → closed
  });

  it('Rename → Esc cancels without changing the name', () => {
    const id = addSheet();
    openViewMenu(anchor(), toast);
    (document.querySelector('.wb-viewmenu-rename') as HTMLElement).dispatchEvent(new Event('click'));
    const input = document.querySelector('.wb-viewmenu-input') as HTMLInputElement;
    input.value = 'Discarded';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(state.viewById(id)?.name).toBe('View 1');
  });

  it('a blank rename keeps the existing name', () => {
    const id = addSheet('Something');
    openViewMenu(anchor(), toast);
    (document.querySelector('.wb-viewmenu-rename') as HTMLElement).dispatchEvent(new Event('click'));
    const input = document.querySelector('.wb-viewmenu-input') as HTMLInputElement;
    input.value = '   ';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(state.viewById(id)?.name).toBe('Something');
  });

  it('New rowview opens the template modal from the menu', () => {
    openViewMenu(anchor(), toast);
    const newRow = document.querySelector('.wb-viewmenu-newrow') as HTMLElement;
    expect(newRow).not.toBeNull();
    newRow.dispatchEvent(new Event('click'));
    expect(document.querySelector('.wb-viewmenu')).toBeNull();           // menu closed
    expect(document.querySelector('.wb-template-modal')).not.toBeNull(); // template modal opened
    // close via the real path so createOverlay detaches its document Esc listener —
    // removing only the overlay node would leak the keydown handler into later tests
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(document.querySelector('.wb-template-modal')).toBeNull();
  });

  it('New tileview opens the template modal with the tile layouts leading', () => {
    openViewMenu(anchor(), toast);
    const newTile = document.querySelector('.wb-viewmenu-newtile') as HTMLElement;
    expect(newTile).not.toBeNull();
    newTile.dispatchEvent(new Event('click'));
    expect(document.querySelector('.wb-viewmenu')).toBeNull();           // menu closed
    expect(document.querySelector('.wb-template-modal')).not.toBeNull(); // builder opened
    expect(document.querySelector('.wb-template-gallery-head')?.textContent).toBe('Tile layouts');
    // close via the real path so createOverlay detaches its document Esc listener
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(document.querySelector('.wb-template-modal')).toBeNull();
  });
});
