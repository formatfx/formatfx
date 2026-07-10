/**
 * exprPreview.test.ts — the live eval chip's decisions (spec 2026-07-09 §6):
 * live strings evaluate through the REAL engine against the sample row;
 * forEach specs list-preview; engine errors ARE the chip; plain data strings
 * and no-sample-row cases stay quiet; long values clip.
 */
import { describe, it, expect } from 'vitest';
import { evalChipAt } from './exprPreview';
import type { EvalContext } from '../core/expressions';

const ctx = (row: Record<string, unknown>): EvalContext => ({
  row,
  rowIndex: 0,
  currentFieldName: 'Status',
  me: { title: 'Me', email: 'me@x.com' },
  iterators: {},
  iteratorIndex: {},
  displayNames: {},
  now: new Date(2026, 6, 10),
} as unknown as EvalContext);

/** Caret inside the first live string of `text` (just past its `=`). */
const caretIn = (text: string, needle: string): number => text.indexOf(needle) + 2;

describe('evalChipAt', () => {
  it('a formula string evaluates to a quoted, type-badged value', () => {
    const text = '{"txtContent": "=if([$Done], \'yes\', \'no\')"}';
    const chip = evalChipAt(text, caretIn(text, '"=if'), ctx({ Done: true }))!;
    expect(chip).toEqual({ text: '"yes"', kind: 'value', type: 'text' });
  });

  it('numbers and booleans badge as themselves', () => {
    const text = '{"txtContent": "=[$N] + 2"}';
    expect(evalChipAt(text, caretIn(text, '"=[$N]'), ctx({ N: 40 })))
      .toEqual({ text: '42', kind: 'value', type: 'number' });
    const b = '{"txtContent": "=[$N] == 40"}';
    expect(evalChipAt(b, caretIn(b, '"=[$N]'), ctx({ N: 40 })))
      .toEqual({ text: 'true', kind: 'value', type: 'boolean' });
  });

  it('a bare field ref is live too (no = needed)', () => {
    const text = '{"txtContent": "[$Status]"}';
    const chip = evalChipAt(text, caretIn(text, '"[$Status]'), ctx({ Status: 'On track' }))!;
    expect(chip).toEqual({ text: '"On track"', kind: 'value', type: 'text' });
  });

  it('an empty result reads as empty, not as a phantom string', () => {
    const text = '{"txtContent": "=[$Missing]"}';
    const chip = evalChipAt(text, caretIn(text, '"=[$Missing]'), ctx({}))!;
    expect(chip.type).toBe('empty');
  });

  it('a multi-value ref lists its items', () => {
    const text = '{"txtContent": "=[$Tags]"}';
    const chip = evalChipAt(text, caretIn(text, '"=[$Tags]'), ctx({ Tags: ['Red', 'Green'] }))!;
    expect(chip.kind).toBe('list');
    expect(chip.text).toBe('2 items: Red, Green');
  });

  it('a forEach value previews the bound list', () => {
    const text = '{"forEach": "item in [$Tags]", "elmType": "div"}';
    const caret = text.indexOf('item in') + 1;
    const chip = evalChipAt(text, caret, ctx({ Tags: ['a', 'b', 'c'] }))!;
    expect(chip.kind).toBe('list');
    expect(chip.text).toContain('3 items');
  });

  it('a forEach value without the "item in list" shape teaches the shape', () => {
    const text = '{"forEach": "[$Tags]", "elmType": "div"}';
    const chip = evalChipAt(text, text.indexOf('[$Tags]') + 1, ctx({ Tags: [] }))!;
    expect(chip.kind).toBe('error');
    expect(chip.text).toContain('item in [$List]');
  });

  it("the engine's error IS the chip while a formula is half-typed", () => {
    const text = '{"txtContent": "=if([$Due]"}';
    const chip = evalChipAt(text, caretIn(text, '"=if'), ctx({ Due: 1 }))!;
    expect(chip.kind).toBe('error');
    expect(chip.text.length).toBeGreaterThan(0);
  });

  it('long values clip to a glance', () => {
    const text = `{"txtContent": "=[$Long]"}`;
    const chip = evalChipAt(text, caretIn(text, '"=[$Long]'), ctx({ Long: 'x'.repeat(200) }))!;
    expect(chip.text.length).toBeLessThanOrEqual(49);
    expect(chip.text.endsWith('…')).toBe(true);
  });

  it('plain data strings and out-of-string carets stay quiet', () => {
    const text = '{"txtContent": "hello", "n": 3}';
    expect(evalChipAt(text, text.indexOf('hello') + 2, ctx({}))).toBeNull();
    expect(evalChipAt(text, 1, ctx({}))).toBeNull();
  });

  it('no sample row → no chip (nothing to evaluate against)', () => {
    const text = '{"txtContent": "=1 + 1"}';
    expect(evalChipAt(text, caretIn(text, '"=1'), undefined)).toBeNull();
  });
});
