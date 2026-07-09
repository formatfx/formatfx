/**
 * jsonDecorations.test.ts — squiggle decorations (spec 2026-07-09 §5):
 * parse errors are char-precise (zero-width widens to something visible),
 * lint issues underline the element's OPENING LINE only, overlaps flatten
 * to the highest severity, and the squiggle layer's flattened text is the
 * buffer verbatim (layer alignment).
 */
import { describe, it, expect } from 'vitest';
import { decorationsFrom, decorationAt, renderSquigglesHtml } from './jsonDecorations';
import type { LintIssue } from '../core/linter';
import type { JsonRange } from '../core/jsonMap';

const TEXT = '{\n  "elmType": "div",\n  "children": []\n}';
const RANGES: JsonRange[] = [{ path: [], start: 0, end: TEXT.length }];

describe('decorationsFrom', () => {
  it('parse errors pass through char-precise', () => {
    const [d] = decorationsFrom([{ start: 5, end: 9, message: 'boom' }], [], RANGES, TEXT);
    expect(d).toEqual({ start: 5, end: 9, kind: 'err', message: 'boom' });
  });

  it('zero-width errors at EOF widen backwards to stay visible', () => {
    const [d] = decorationsFrom([{ start: TEXT.length, end: TEXT.length, message: 'eof' }], [], RANGES, TEXT);
    expect(d.start).toBe(TEXT.length - 1);
    expect(d.end).toBe(TEXT.length);
  });

  it('lint issues underline only the opening line of the element', () => {
    const issues: LintIssue[] = [{ severity: 'warning', rule: 'test-rule', message: 'watch out', path: [] }];
    const [d] = decorationsFrom([], issues, RANGES, TEXT);
    expect(d.start).toBe(0);
    expect(d.end).toBe(TEXT.indexOf('\n')); // stops at the opening line's end
    expect(d.kind).toBe('warning');
    expect(d.message).toBe('test-rule: watch out');
  });

  it('issues whose path has no range are skipped (the footer still lists them)', () => {
    const issues: LintIssue[] = [{ severity: 'error', rule: 'r', message: 'm', path: [9, 9] }];
    expect(decorationsFrom([], issues, RANGES, TEXT)).toEqual([]);
  });
});

describe('decorationAt', () => {
  it('picks the highest severity among overlaps, half-open', () => {
    const ds = [
      { start: 0, end: 5, kind: 'info' as const, message: 'note' },
      { start: 2, end: 4, kind: 'err' as const, message: 'hard' },
    ];
    expect(decorationAt(ds, 3)!.kind).toBe('err'); // overlap → max severity
    expect(decorationAt(ds, 4)!.kind).toBe('info'); // past the err's half-open end
    expect(decorationAt(ds, 5)).toBeNull(); // past both
  });
});

describe('renderSquigglesHtml', () => {
  it('wraps decorated segments, flattens overlap by severity, stays lossless', () => {
    const ds = decorationsFrom(
      [{ start: 2, end: 8, message: 'hard' }],
      [{ severity: 'info', rule: 'soft', message: 'note', path: [] }],
      RANGES, TEXT,
    );
    const html = renderSquigglesHtml(TEXT, ds);
    expect(html).toContain('<span class="wb-sq-err">');
    expect(html).toContain('<span class="wb-sq-info">');
    const flat = html.replace(/<[^>]*>/g, '')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    expect(flat).toBe(TEXT);
  });

  it('escapes HTML inside decorated segments', () => {
    const text = '{"a": "<b>"}';
    const html = renderSquigglesHtml(text, [{ start: 6, end: 11, kind: 'err', message: 'x' }]);
    expect(html).not.toContain('<b>');
    expect(html).toContain('&lt;b&gt;');
  });

  it('keeps the trailing empty line visible like the highlight layer', () => {
    expect(renderSquigglesHtml('{}\n', []).endsWith(' ')).toBe(true);
  });
});
