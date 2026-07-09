/**
 * jsonFormat.test.ts — Format-document + typing-ergonomics decisions (spec
 * 2026-07-09 §2). Contract: canonical tier iff the buffer parses; re-indent
 * is tolerant and string-safe; assists are pure, undo-agnostic decisions
 * that never fire inside strings (except quote skip-over/wrap).
 */
import { describe, it, expect } from 'vitest';
import { formatDocument, reindentJson, typingAssist, pasteReindent } from './jsonFormat';
import { importJson } from '../core/serializer';

describe('formatDocument', () => {
  it('canonical tier: a parseable buffer round-trips through the serializer', () => {
    const messy = '{"elmType":"div","txtContent":"=if([$x], 1, 2)"}';
    const res = formatDocument(messy, { sanitizeWhitespace: true });
    expect(res.tier).toBe('canonical');
    expect(res.error).toBeUndefined();
    expect(res.text).toContain('\n  "elmType": "div"'); // 2-space pretty
    // canonical is a FIXED POINT: formatting formatted text changes nothing
    expect(formatDocument(res.text, { sanitizeWhitespace: true }).text).toBe(res.text);
    // …and re-imports as the same element, modulo the export pipeline's own
    // semantics: $schema is added, and sanitize strips expression whitespace
    // (the Zero Whitespace Rule pass — same as the pane's regenerate/Copy)
    const reroot = importJson(res.text).root as unknown as Record<string, unknown>;
    expect(reroot.elmType).toBe('div');
    expect(reroot.txtContent).toBe('=if([$x],1,2)');
  });

  it('reindent tier: a broken buffer gets indentation only, plus the parse error', () => {
    const broken = '{\n"elmType": "div"\n"txtContent": "x"\n}'; // missing comma
    const res = formatDocument(broken, { sanitizeWhitespace: true });
    expect(res.tier).toBe('reindent');
    expect(res.error).toBeTruthy();
    expect(res.text).toBe('{\n  "elmType": "div"\n  "txtContent": "x"\n}');
  });
});

describe('reindentJson', () => {
  it('re-indents by structural depth, closers dedent their own line', () => {
    const text = '{\n"a": {\n"b": 1\n},\n"c": [\n1\n]\n}';
    expect(reindentJson(text)).toBe('{\n  "a": {\n    "b": 1\n  },\n  "c": [\n    1\n  ]\n}');
  });

  it('brackets inside strings never move the depth', () => {
    const text = '{\n"t": "a } b [ c",\n"u": 1\n}';
    expect(reindentJson(text)).toBe('{\n  "t": "a } b [ c",\n  "u": 1\n}');
  });

  it('escaped quotes inside strings are handled (the string does not end early)', () => {
    const text = '{\n"t": "say \\"hi\\" {",\n"u": 1\n}';
    expect(reindentJson(text)).toBe('{\n  "t": "say \\"hi\\" {",\n  "u": 1\n}');
  });

  it('depth never goes negative on over-closed input', () => {
    expect(reindentJson('}\n{\n"a": 1\n}')).toBe('}\n{\n  "a": 1\n}');
  });
});

describe('typingAssist — Enter', () => {
  it('copies the current line indent', () => {
    const text = '{\n  "a": 1,\n  "b": 2\n}';
    const caret = text.indexOf('1,') + 2;
    const a = typingAssist(text, caret, caret, 'Enter');
    expect(a).toEqual({ kind: 'splice', from: caret, to: caret, insert: '\n  ', caret: caret + 3 });
  });

  it('adds one level after an opening brace', () => {
    const text = '{\n  "style": {';
    const caret = text.length;
    const a = typingAssist(text, caret, caret, 'Enter');
    expect(a).toEqual({ kind: 'splice', from: caret, to: caret, insert: '\n    ', caret: caret + 5 });
  });

  it('brace-Enter: expands between a pair, closer on its own dedented line', () => {
    const text = '{\n  "style": {}\n}';
    const caret = text.indexOf('{}') + 1; // between the braces
    const a = typingAssist(text, caret, caret, 'Enter');
    expect(a).toEqual({
      kind: 'splice', from: caret, to: caret,
      insert: '\n    \n  ',
      caret: caret + 5, // end of the indented middle line
    });
  });

  it('inside a string: no assist (default newline behavior)', () => {
    const text = '{"a": "hello"}';
    const caret = text.indexOf('hello') + 2;
    expect(typingAssist(text, caret, caret, 'Enter')).toBeNull();
  });
});

describe('typingAssist — auto-close and skip-over', () => {
  it('auto-closes { [ " at a boundary, caret between', () => {
    const text = '{"a": }';
    const caret = 6; // before the closing }
    expect(typingAssist(text, caret, caret, '{')).toEqual({ kind: 'splice', from: caret, to: caret, insert: '{}', caret: caret + 1 });
    expect(typingAssist(text, caret, caret, '[')).toEqual({ kind: 'splice', from: caret, to: caret, insert: '[]', caret: caret + 1 });
    expect(typingAssist(text, caret, caret, '"')).toEqual({ kind: 'splice', from: caret, to: caret, insert: '""', caret: caret + 1 });
  });

  it('never auto-closes brackets inside a string', () => {
    const text = '{"a": "x y"}';
    const caret = text.indexOf('x') + 1;
    expect(typingAssist(text, caret, caret, '{')).toBeNull();
    expect(typingAssist(text, caret, caret, '[')).toBeNull();
  });

  it('no auto-close directly before a word character', () => {
    const text = '{"a": x}';
    const caret = 6; // before x
    expect(typingAssist(text, caret, caret, '{')).toBeNull();
  });

  it('typing the closing quote at a closing quote skips over instead of inserting', () => {
    const text = '{"a": "xy"}';
    const caret = text.indexOf('xy') + 2; // right before the closing "
    expect(typingAssist(text, caret, caret, '"')).toEqual({ kind: 'caret', caret: caret + 1 });
  });

  it('typing " mid-string (not at the closer) stays default', () => {
    const text = '{"a": "xy"}';
    const caret = text.indexOf('xy') + 1;
    expect(typingAssist(text, caret, caret, '"')).toBeNull();
  });

  it('quote-wraps a selection outside strings', () => {
    const text = '{"a": stuff}';
    const from = text.indexOf('stuff');
    const to = from + 5;
    expect(typingAssist(text, from, to, '"')).toEqual({ kind: 'splice', from, to, insert: '"stuff"', caret: to + 2 });
  });

  it('} and ] skip over a matching next char, insert otherwise', () => {
    const text = '{"a": []}';
    const inBrackets = text.indexOf('[') + 1;
    expect(typingAssist(text, inBrackets, inBrackets, ']')).toEqual({ kind: 'caret', caret: inBrackets + 1 });
    expect(typingAssist(text, inBrackets, inBrackets, '}')).toBeNull(); // next char is ], not }
  });
});

describe('pasteReindent', () => {
  it('single-line pastes pass through unchanged', () => {
    expect(pasteReindent('{\n  "a": 1\n}', 4, '"x": 2,')).toBe('"x": 2,');
  });

  it('re-bases continuation lines to the caret line indent', () => {
    const text = '{\n    "a": 1\n}';
    const caret = text.indexOf('"a"');
    const pasted = '"b": {\n  "c": 1\n},';
    expect(pasteReindent(text, caret, pasted)).toBe('"b": {\n      "c": 1\n    },');
  });

  it('strips the common leading indent before re-basing', () => {
    const text = '{\n  "a": 1\n}';
    const caret = text.indexOf('"a"');
    const pasted = 'x\n        deep\n      shallow';
    // common indent of continuation lines (6) stripped, caret indent (2) applied
    expect(pasteReindent(text, caret, pasted)).toBe('x\n    deep\n  shallow');
  });
});
