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
});
