/**
 * exprTokens.test.ts — the positioned sub-lexer for live strings (spec
 * 2026-07-09 §1). Contract: tolerant (never throws, unterminated anything
 * runs to the slice end), JSON-escape-aware (the buffer holds \" for SP
 * double-quoted literals), and unknown function names read as errors.
 */
import { describe, it, expect } from 'vitest';
import { tokenizeExpr, tokenizeForEach } from './exprTokens';

const lex = (s: string): Array<[string, string]> =>
  tokenizeExpr(s, 0, s.length).map((t) => [t.kind, s.slice(t.start, t.end)]);

describe('tokenizeExpr', () => {
  it('paints refs, tokens, functions, strings, numbers and operators distinctly', () => {
    const s = "=if([$Due] <= @now, 'Late', toString(3))";
    expect(lex(s)).toEqual([
      ['xop', '='], ['xfn', 'if'], ['xparen', '('],
      ['xfield', '[$Due]'], ['xop', '<='], ['xtoken', '@now'],
      ['xstr', "'Late'"], ['xfn', 'toString'], ['xparen', '('], ['xnum', '3'], ['xparen', ')'],
      ['xparen', ')'],
    ]);
  });

  it('flags unknown function names as xfn-unknown (live typo catch)', () => {
    expect(lex('=iff([$x], 1, 2)')).toContainEqual(['xfn-unknown', 'iff']);
    expect(lex('=if([$x], 1, 2)')).toContainEqual(['xfn', 'if']);
  });

  it('JSON-escaped double-quoted SP literals stay one xstr token', () => {
    // buffer chars: =if([$T] == \"Done\", 1, 0)
    const s = '=if([$T] == \\"Done\\", 1, 0)';
    expect(lex(s)).toContainEqual(['xstr', '\\"Done\\"']);
  });

  it('a double quote inside a single-quoted literal is just content', () => {
    // buffer chars: ='he said \"hi\"'
    const s = "='he said \\\"hi\\\"'";
    expect(lex(s)).toEqual([['xop', '='], ['xstr', "'he said \\\"hi\\\"'"]]);
  });

  it('dotted refs and dotted @tokens tokenize whole', () => {
    expect(lex('=[!Owner.Title] == @currentField.email')).toEqual([
      ['xop', '='], ['xfield', '[!Owner.Title]'], ['xop', '=='], ['xtoken', '@currentField.email'],
    ]);
  });

  it('!= is one operator; a standalone ! is also painted (the linter flags it, not us)', () => {
    expect(lex('=[$a] != 1')).toContainEqual(['xop', '!=']);
    expect(lex('=![$a]')).toContainEqual(['xop', '!']);
  });

  it('true/false are keywords; bare non-call identifiers stay unpainted', () => {
    const toks = lex('=if([$Done], true, _x)');
    expect(toks).toContainEqual(['xkw', 'true']);
    expect(toks.some(([, text]) => text === '_x')).toBe(false);
  });

  it('unterminated refs and literals run to the slice end (tolerant, never throws)', () => {
    expect(lex('=if([$Due')).toEqual([
      ['xop', '='], ['xfn', 'if'], ['xparen', '('], ['xfield', '[$Due'],
    ]);
    expect(lex("='oops")).toEqual([['xop', '='], ['xstr', "'oops"]]);
    expect(lex('=\\"oops')).toEqual([['xop', '='], ['xstr', '\\"oops']]);
  });

  it('bare whole-string refs and tokens (no = prefix) lex fine', () => {
    expect(lex('[$Title]')).toEqual([['xfield', '[$Title]']]);
    expect(lex('@thumbnail')).toEqual([['xtoken', '@thumbnail']]);
  });

  it('respects slice bounds (absolute offsets in, absolute offsets out)', () => {
    const s = 'XX[$Due]YY';
    const toks = tokenizeExpr(s, 2, 8);
    expect(toks).toEqual([{ kind: 'xfield', start: 2, end: 8 }]);
  });
});

describe('tokenizeForEach', () => {
  it('paints the in keyword and the list expression', () => {
    const s = 'item in [$Colors]';
    expect(tokenizeForEach(s, 0, s.length).map((t) => [t.kind, s.slice(t.start, t.end)])).toEqual([
      ['xkw', 'in'], ['xfield', '[$Colors]'],
    ]);
  });

  it('falls back to plain expression lexing when the spec shape is absent', () => {
    const s = '[$Colors]';
    expect(tokenizeForEach(s, 0, s.length)).toEqual([{ kind: 'xfield', start: 0, end: 9 }]);
  });
});
