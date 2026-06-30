import { describe, it, expect } from 'vitest';
import { lintBadge, lintAriaLabel } from './lintBadge';

describe('lintBadge — severity is perceivable without colour (WCAG 1.4.1)', () => {
  it('gives every level a distinct glyph (shape) AND a word', () => {
    expect(lintBadge('error')).toEqual({ glyph: '✕', label: 'Error' });
    expect(lintBadge('warning')).toEqual({ glyph: '⚠', label: 'Warning' });
    expect(lintBadge('info')).toEqual({ glyph: 'ⓘ', label: 'Info' });
    expect(lintBadge('runtime')).toEqual({ glyph: '◆', label: 'Runtime' });
  });

  it('uses a distinct glyph per level — no two levels share a shape', () => {
    const glyphs = ['error', 'warning', 'info', 'runtime'].map((s) => lintBadge(s).glyph);
    expect(new Set(glyphs).size).toBe(glyphs.length);
  });

  it('falls back to a neutral, non-empty badge for an unknown severity', () => {
    const b = lintBadge('mystery');
    expect(b.glyph).toBeTruthy();
    expect(b.label).toBe('Mystery'); // capitalised raw level, never blank
  });

  it('is safe for prototype-chain keys (no Object.prototype leak)', () => {
    for (const key of ['__proto__', 'constructor', 'hasOwnProperty', 'toString']) {
      const b = lintBadge(key);
      expect(b.glyph).toBe('•'); // the neutral fallback glyph, never an inherited member
      expect(typeof b.label).toBe('string');
      expect(b.label.length).toBeGreaterThan(0);
    }
    expect(lintAriaLabel('__proto__', 'x')).not.toMatch(/^undefined/);
  });

  it('builds a screen-reader label that leads with the level word, not the glyph', () => {
    expect(lintAriaLabel('error', 'no-not: SharePoint has no logical NOT')).toBe(
      'Error: no-not: SharePoint has no logical NOT',
    );
    expect(lintAriaLabel('runtime', 'expression failed on row 2')).toBe(
      'Runtime: expression failed on row 2',
    );
  });
});
