/**
 * core/refs.ts — the one definition of "field name behind a reference".
 * Replaces ~7 inline copies of the same triple .replace() across editor + core.
 */
import { describe, it, expect } from 'vitest';
import { cfrFieldName } from './refs';

describe('cfrFieldName', () => {
  it('strips all three reference forms down to the bare field name', () => {
    expect(cfrFieldName('[$Status]')).toBe('Status');
    expect(cfrFieldName('$Status')).toBe('Status');
    expect(cfrFieldName('Status')).toBe('Status');
  });

  it('leaves an already-bare name untouched and is idempotent', () => {
    expect(cfrFieldName(cfrFieldName('[$Title]'))).toBe('Title');
  });
});
