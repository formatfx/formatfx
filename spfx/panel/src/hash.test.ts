import { describe, it, expect } from 'vitest';
import { contentHash, formatterHash } from './hash';

describe('contentHash', () => {
  it('is deterministic and length-tagged', () => {
    expect(contentHash('abc')).toBe(contentHash('abc'));
    expect(contentHash('abc')).toMatch(/^[0-9a-f]{8}-3$/);
  });
  it('differs on a one-character change', () => {
    expect(contentHash('{"elmType":"div"}')).not.toBe(contentHash('{"elmType":"span"}'));
  });
  it('treats a missing formatter as the empty string', () => {
    expect(formatterHash(null)).toBe(contentHash(''));
  });
});
