/**
 * jsonHover.test.ts — hover-at-offset intelligence (spec 2026-07-09 §5):
 * decorations explain themselves first; field refs show display name, type
 * and the sample-row value via the real engine; functions show signatures;
 * @tokens show catalog docs; style/attribute keys show their docs; and any
 * formula surfaces the unescaped x-ray.
 */
import { describe, it, expect } from 'vitest';
import { hoverAt } from './jsonHover';
import type { Decoration } from './jsonDecorations';
import type { MockField } from '../core/types';
import type { EvalContext } from '../core/expressions';

const FIELDS = [
  { name: 'Due', displayName: 'Due date', type: 'date' },
] as unknown as MockField[];

const CTX = {
  row: { Due: 3 },
  rowIndex: 0,
  currentFieldName: 'Due',
  me: { title: 'Me', email: 'me@x.com' },
  iterators: {},
  iteratorIndex: {},
  displayNames: {},
  now: new Date(2026, 6, 9),
} as unknown as EvalContext;

const NO_DECOS: Decoration[] = [];

describe('hoverAt', () => {
  it('a decoration message wins over token docs', () => {
    const text = '{"txtContent": "=if([$Due], 1, 2)"}';
    const decos: Decoration[] = [{ start: 16, end: 20, kind: 'err', message: 'broken here' }];
    const info = hoverAt(text, 17, decos, FIELDS)!;
    expect(info.title).toBe('Problem');
    expect(info.body).toBe('broken here');
  });

  it('field refs show display name, type, and the engine-evaluated sample value', () => {
    const text = '{"txtContent": "=if([$Due], 1, 2)"}';
    const offset = text.indexOf('[$Due]') + 2;
    const info = hoverAt(text, offset, NO_DECOS, FIELDS, { ctx: CTX })!;
    expect(info.title).toBe('[$Due]');
    expect(info.body).toContain('Due date — date');
    expect(info.body).toContain('sample value: 3');
  });

  it('unknown refs teach instead of guessing', () => {
    const text = '{"txtContent": "[$Nope]"}';
    const info = hoverAt(text, text.indexOf('[$Nope]') + 2, NO_DECOS, FIELDS)!;
    expect(info.body).toContain('not in the mock schema');
  });

  it('known functions show their signature; unknown ones teach', () => {
    const text = '{"txtContent": "=if([$Due], toStrinng(1), 2)"}';
    const onIf = hoverAt(text, text.indexOf('=if') + 2, NO_DECOS, FIELDS)!;
    expect(onIf.title).toMatch(/^if\(/);
    const onTypo = hoverAt(text, text.indexOf('toStrinng') + 2, NO_DECOS, FIELDS)!;
    expect(onTypo.body).toContain('not a formatter-engine function');
  });

  it('@tokens show their catalog doc', () => {
    const text = '{"txtContent": "=if(@now, 1, 2)"}';
    const info = hoverAt(text, text.indexOf('@now') + 1, NO_DECOS, FIELDS)!;
    expect(info.title).toBe('@now');
    expect(info.body.length).toBeGreaterThan(0);
  });

  it('style keys show STYLE_PROP_DOCS', () => {
    const text = '{"style": {"color": "red"}}';
    const info = hoverAt(text, text.indexOf('"color"') + 2, NO_DECOS, FIELDS);
    expect(info?.title).toBe('color');
    expect((info?.body ?? '').length).toBeGreaterThan(0);
  });

  it('formulas anywhere else surface the unescaped x-ray', () => {
    // buffer holds: =if([$T] == \"Done\", 1, 0)
    const text = '{"txtContent": "=if([$T] == \\"Done\\", 1, 0)"}';
    const offset = text.indexOf('==') + 6; // inside the escaped literal
    const info = hoverAt(text, offset, NO_DECOS, FIELDS)!;
    expect(info.mono).toBe(true);
    expect(info.body).toBe('=if([$T] == "Done", 1, 0)');
  });

  it('plain strings and punctuation hover nothing', () => {
    const text = '{"elmType": "div"}';
    expect(hoverAt(text, text.indexOf('"div"') + 2, NO_DECOS, FIELDS)).toBeNull();
    expect(hoverAt(text, 0, NO_DECOS, FIELDS)).toBeNull();
  });
});

describe('hoverAt — #PR-E iconName values', () => {
  it('a verified icon name shows its glyph and the verification note', () => {
    const text = '{"iconName": "Warning"}';
    const info = hoverAt(text, text.indexOf('Warning') + 2, NO_DECOS, FIELDS)!;
    expect(info.title).toBe('Warning');
    expect(info.icon).toBe('Warning');
    expect(info.body).toContain('verified');
  });

  it('a typo teaches instead of drawing a broken glyph', () => {
    const text = '{"iconName": "Warnign"}';
    const info = hoverAt(text, text.indexOf('Warnign') + 2, NO_DECOS, FIELDS)!;
    expect(info.icon).toBeUndefined();
    expect(info.body).toContain('check the spelling');
  });

  it('the same value under a different key stays quiet', () => {
    const text = '{"txtContent": "Warning"}';
    expect(hoverAt(text, text.indexOf('Warning') + 2, NO_DECOS, FIELDS)).toBeNull();
  });
});
