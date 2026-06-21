import { describe, it, expect } from 'vitest';
import { formatterDestination } from './formatterDestination';

describe('formatterDestination', () => {
  it('a column formatter with a known field names the column', () => {
    const d = formatterDestination('column', '[$Status]');
    expect(d.label).toBe('Saves to the [$Status] column');
    expect(d.title).toMatch(/column's CustomFormatter/);
  });
  it('a column formatter with no known field is generic', () => {
    expect(formatterDestination('column', null).label).toBe('Saves to a column');
  });
  it('grid saves to the view', () => {
    const d = formatterDestination('grid', null);
    expect(d.label).toBe('Saves to the view');
    expect(d.title).toMatch(/replac/i); // warns it replaces the view's formatting
  });
  it('row saves to the view', () => {
    expect(formatterDestination('row', null).label).toBe('Saves to the view');
  });
  it('tile names the tile layout', () => {
    expect(formatterDestination('tile', null).label).toBe('Saves to the view (tile layout)');
  });
});
