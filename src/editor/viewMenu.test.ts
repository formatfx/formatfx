/**
 * View Formatters menu (happy-dom): lists the current view and renames it.
 * The deliberate shell for future multi-view — for now, one view + Rename.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { openViewMenu, closeViewMenu } from './viewMenu';
import { state } from './state';

const toast = (): void => {};
const anchor = (): HTMLElement => document.createElement('button');

describe('viewMenu', () => {
  beforeEach(() => { state.resetAll(); });
  afterEach(() => { closeViewMenu(); });

  it('lists the current view name and a Rename action', () => {
    openViewMenu(anchor(), toast);
    expect(document.querySelector('.wb-viewmenu')).not.toBeNull();
    expect(document.querySelector('.wb-viewmenu-name')?.textContent).toBe('View 1');
    expect(document.querySelector('.wb-viewmenu-rename')).not.toBeNull();
  });

  it('Rename → Enter commits the new name via setViewName and closes the menu', () => {
    openViewMenu(anchor(), toast);
    (document.querySelector('.wb-viewmenu-rename') as HTMLElement).dispatchEvent(new Event('click'));
    const input = document.querySelector('.wb-viewmenu-input') as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input.value).toBe('View 1'); // prefilled with the current name
    input.value = 'Sprint board';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(state.viewName).toBe('Sprint board');
    expect(document.querySelector('.wb-viewmenu')).toBeNull(); // committed → closed
  });

  it('Rename → Esc cancels without changing the name', () => {
    openViewMenu(anchor(), toast);
    (document.querySelector('.wb-viewmenu-rename') as HTMLElement).dispatchEvent(new Event('click'));
    const input = document.querySelector('.wb-viewmenu-input') as HTMLInputElement;
    input.value = 'Discarded';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(state.viewName).toBe('View 1');
  });

  it('a blank rename falls back to "View 1"', () => {
    state.setViewName('Something');
    openViewMenu(anchor(), toast);
    (document.querySelector('.wb-viewmenu-rename') as HTMLElement).dispatchEvent(new Event('click'));
    const input = document.querySelector('.wb-viewmenu-input') as HTMLInputElement;
    input.value = '   ';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(state.viewName).toBe('View 1');
  });
});
