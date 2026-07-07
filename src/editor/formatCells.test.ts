/**
 * Format cells (happy-dom) — the theme-aware color picking added for theme
 * style classes. The dialog defaults to emitting a theme class (classes-first);
 * a per-tab toggle falls back to the fixed-hex swatches, and a formula-valued
 * class forces hex mode. Apply is one undoable document mutation.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { openFormatCells, closeFormatCells } from './formatCells';
import { state } from './state';
import type { SPElement } from '../core/types';

function selectNode(el: Partial<SPElement> = {}): void {
  state.createView({
    kind: 'row',
    root: { elmType: 'div', children: [{ elmType: 'div', txtContent: 'x', ...el } as SPElement] },
  });
}
const node0 = (): SPElement => state.doc.root.children![0];
const overlay = (): HTMLElement => document.querySelector('.wb-fc-overlay')!;

function clickTab(name: string): void {
  [...overlay().querySelectorAll<HTMLButtonElement>('.wb-fc-tab')].find((b) => b.textContent?.startsWith(name))!.click();
}
const swatches = (): HTMLButtonElement[] => [...overlay().querySelectorAll<HTMLButtonElement>('.wb-fc-swatch')];
const swatch = (title: string): HTMLButtonElement => swatches().find((b) => b.title.includes(title))!;
const themeToggle = (): HTMLButtonElement =>
  [...overlay().querySelectorAll<HTMLButtonElement>('.wb-fc-toggle')].find((b) => b.textContent?.startsWith('Theme-aware'))!;
const apply = (): void => overlay().querySelector<HTMLButtonElement>('.wb-fc-ok')!.click();
const undoDepth = (): number => (state as unknown as { undoStack: string[] }).undoStack.length;

beforeEach(() => {
  document.body.innerHTML = '';
  localStorage.clear();
  state.resetAll();
});
afterEach(() => { closeFormatCells(); document.body.innerHTML = ''; });

describe('Format cells — theme-aware color picking', () => {
  it('a theme Fill swatch applies a class and clears the inline background, in one undo step', () => {
    selectNode({ style: { 'background-color': '#d13438' } });
    openFormatCells([0], () => {});
    clickTab('Fill');
    const before = undoDepth();
    swatch('ms-bgColor-green').click();
    apply();
    expect(node0().attributes?.class).toBe('ms-bgColor-green');
    expect(node0().style?.['background-color']).toBeUndefined();
    expect(undoDepth()).toBe(before + 1);
  });

  it('a Status swatch emits a severity class', () => {
    selectNode();
    openFormatCells([0], () => {});
    clickTab('Fill');
    swatch('sp-field-severity--blocked').click();
    apply();
    expect(node0().attributes?.class).toBe('sp-field-severity--blocked');
  });

  it('the Font tab emits a text color class', () => {
    selectNode();
    openFormatCells([0], () => {});
    clickTab('Font');
    swatch('ms-fontColor-themePrimary').click();
    apply();
    expect(node0().attributes?.class).toBe('ms-fontColor-themePrimary');
  });

  it('toggling Theme-aware off falls back to hex swatches (writes style, not class)', () => {
    selectNode();
    openFormatCells([0], () => {});
    clickTab('Fill');
    themeToggle().click(); // → hex mode
    swatch('#107c10').click(); // COND green strong
    apply();
    expect(node0().style?.['background-color']).toBe('#107c10');
    expect(node0().attributes?.class).toBeUndefined();
  });

  it('a formula-valued class forces hex mode and disables the toggle', () => {
    selectNode({ attributes: { class: "=if([$x]=='a','ms-bgColor-green','')" } });
    openFormatCells([0], () => {});
    clickTab('Fill');
    expect(themeToggle().disabled).toBe(true);
    // hex swatches are shown, not theme-class swatches
    expect(swatches().some((b) => b.title.includes('ms-bgColor-green'))).toBe(false);
  });
});
