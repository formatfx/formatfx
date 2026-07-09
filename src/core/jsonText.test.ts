/**
 * jsonText.test.ts — the positioned tolerant JSON parser (spec 2026-07-09 §4).
 * THE contract: parsing the serializer's own output reproduces the
 * serializer's element map exactly (paths, starts, ends) — pinned across all
 * three doc kinds and the card segment. Errors are positioned, recovery is
 * member-level, and unclosed-at-EOF still yields usable ranges (mid-edit is
 * the whole point).
 */
import { describe, it, expect } from 'vitest';
import { parseJsonWithMap } from './jsonText';
import { importJson } from './serializer';
import { exportJsonWithMap, type JsonRange } from './jsonMap';
import { SCHEMA_URLS } from './types';

const byPos = (a: JsonRange, b: JsonRange): number => a.start - b.start || a.end - b.end;

/** Round-trip: my ranges over the serializer's text ≡ the serializer's map. */
function expectMapEquality(inputJson: string): void {
  const doc = importJson(inputJson);
  const { text, ranges } = exportJsonWithMap(doc, { sanitizeWhitespace: true, keepMeta: true });
  const mine = parseJsonWithMap(text);
  expect(mine.errors).toEqual([]);
  expect([...mine.ranges].sort(byPos)).toEqual([...ranges].sort(byPos));
}

describe('parseJsonWithMap ≡ exportJsonWithMap (the property)', () => {
  it('column formatter with nested children', () => {
    expectMapEquality('{"elmType":"div","children":[{"elmType":"span","txtContent":"a"},{"elmType":"span","children":[{"elmType":"div"}]}]}');
  });

  it('row (view) formatter behind the wrapper', () => {
    expectMapEquality(`{"$schema":"${SCHEMA_URLS.row}","rowFormatter":{"elmType":"div","children":[{"elmType":"span"}]},"hideSelection":true}`);
  });

  it('the customCardProps.formatter card segment (-1)', () => {
    const src = '{"elmType":"div","customCardProps":{"openOnEvent":"hover","formatter":{"elmType":"div","children":[{"elmType":"span"}]}}}';
    expectMapEquality(src);
    const doc = importJson(src);
    const { text } = exportJsonWithMap(doc, { sanitizeWhitespace: true, keepMeta: true });
    const mine = parseJsonWithMap(text);
    expect(mine.ranges.some((r) => r.path.includes(-1))).toBe(true);
  });
});

describe('positioned errors + recovery', () => {
  it('missing comma: positioned error, later members still parse and map', () => {
    const text = '{\n  "elmType": "div"\n  "children": [\n    {\n      "elmType": "span"\n    }\n  ]\n}';
    const res = parseJsonWithMap(text);
    expect(res.errors.length).toBeGreaterThan(0);
    expect(res.errors[0].start).toBe(text.indexOf('"children"'));
    // recovery: the child element after the error still gets a range
    const child = res.ranges.find((r) => r.path.length === 1 && r.path[0] === 0);
    expect(child).toBeTruthy();
    expect(text.slice(child!.start, child!.end)).toContain('"span"');
  });

  it('unterminated string: error runs to the line end, parsing continues', () => {
    const text = '{\n  "a": "oops\n  "b": 1\n}';
    const res = parseJsonWithMap(text);
    expect(res.errors.some((e) => e.message.includes('unterminated'))).toBe(true);
    // the buffer still yields a root range
    expect(res.ranges.some((r) => r.path.length === 0)).toBe(true);
  });

  it('unclosed at EOF: error, but the open element still spans to the end (mid-edit)', () => {
    const text = '{\n  "elmType": "div",\n  "children": [\n    {\n      "elmType": "span"';
    const res = parseJsonWithMap(text);
    expect(res.errors.some((e) => e.message.includes('unclosed'))).toBe(true);
    const root = res.ranges.find((r) => r.path.length === 0)!;
    expect(root.start).toBe(0);
    expect(root.end).toBe(text.length);
    const child = res.ranges.find((r) => r.path.length === 1 && r.path[0] === 0)!;
    expect(child.end).toBe(text.length);
  });

  it('bad literals and stray characters are positioned, never thrown', () => {
    const res = parseJsonWithMap('{"a": tru, "b": @}');
    expect(res.errors.length).toBeGreaterThanOrEqual(2);
    expect(res.errors.every((e) => e.end > e.start || e.end === e.start)).toBe(true);
  });

  it('trailing garbage after the top value is an error', () => {
    const res = parseJsonWithMap('{} nonsense');
    expect(res.errors.some((e) => e.message.includes('after'))).toBe(true);
  });

  it('errors cap at 20 so a pathological buffer cannot flood', () => {
    const bad = '{' + Array.from({ length: 40 }, (_, i) => `oops${i}`).join(' ') + '}';
    const res = parseJsonWithMap(bad);
    expect(res.errors.length).toBeLessThanOrEqual(20);
  });

  it('empty and garbage inputs return errors, not throws', () => {
    expect(parseJsonWithMap('').errors.length).toBeGreaterThan(0);
    expect(parseJsonWithMap('   ').errors.length).toBeGreaterThan(0);
    expect(parseJsonWithMap('!!!').errors.length).toBeGreaterThan(0);
  });
});
