/**
 * Formatted-columns gallery (happy-dom): lists every column that has a
 * formatter as a live preview, and picking one opens that column's formatter.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { openColumnGallery, closeColumnGallery, formattedColumnNames } from './columnGallery';
import { state } from './state';

const toast = (): void => {};

describe('columnGallery', () => {
  beforeEach(() => { state.resetAll(); });
  afterEach(() => { closeColumnGallery(); });

  it('lists the columns that currently have a formatter', () => {
    // the default project registers Status, Progress and Owner formatters
    expect(formattedColumnNames()).toEqual(expect.arrayContaining(['Status', 'Progress', 'Owner']));
  });

  it('renders one preview card per formatted column', () => {
    openColumnGallery(document.createElement('button'), toast);
    const cards = document.querySelectorAll('.wb-colgal-card');
    expect(cards.length).toBe(formattedColumnNames().length);
    // each card has a non-empty live preview
    expect(document.querySelectorAll('.wb-colgal-cell').length).toBeGreaterThan(0);
  });

  it('picking a card opens that column formatter and closes the gallery', () => {
    openColumnGallery(document.createElement('button'), toast);
    const owner = [...document.querySelectorAll('.wb-colgal-card')]
      .find((c) => c.querySelector('.wb-colgal-label')?.textContent === 'Owner') as HTMLElement;
    owner.dispatchEvent(new Event('click'));
    expect(state.activeDocKey).toBe('Owner');
    expect(document.querySelector('.wb-colgal')).toBeNull();
  });

  it('shows a helpful empty state when nothing is formatted', () => {
    state.columnRefs = {};
    openColumnGallery(document.createElement('button'), toast);
    expect(document.querySelector('.wb-colgal-empty')).not.toBeNull();
    expect(document.querySelectorAll('.wb-colgal-card').length).toBe(0);
  });

  it('lists a "Not yet formatted" row for every unformatted, non-protected field', () => {
    openColumnGallery(document.createElement('button'), toast);
    const rows = [...document.querySelectorAll('.wb-colgal-newrow')]
      .map((r) => r.textContent);
    // default project formats Status/Progress/Owner; ID is protected
    expect(rows).toEqual(expect.arrayContaining(['Title', 'DueDate', 'AssignedTo']));
    expect(rows).not.toContain('Status'); // already formatted → not in this group
    expect(rows).not.toContain('ID'); // protected → never offered
  });

  it('clicking a Not-yet-formatted row starts that column formatter', () => {
    openColumnGallery(document.createElement('button'), toast);
    const due = [...document.querySelectorAll('.wb-colgal-newrow')]
      .find((r) => r.textContent === 'DueDate') as HTMLElement;
    due.dispatchEvent(new Event('click'));
    // a date field offers presets first; take the manual escape hatch
    const manual = [...document.querySelectorAll('.wb-grid-menu button')]
      .find((b) => b.textContent?.includes('manually')) as HTMLElement;
    manual.dispatchEvent(new Event('click'));
    expect(state.activeDocKey).toBe('DueDate');
    expect(state.columnRefs.DueDate).toBeTruthy();
  });
});
