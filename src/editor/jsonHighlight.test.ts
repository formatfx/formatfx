/**
 * jsonHighlight.test.ts — the lexical half of the IDE-style JSON pane (#244).
 * Contract: the tokenizer is tolerant (never throws, half-typed buffers paint
 * sensibly), formula strings read distinctly from data strings, brackets
 * match structurally (never inside strings), and the overlay HTML is escaped.
 */
import { describe, it, expect } from 'vitest';
import { tokenizeJson, matchBracketAt, renderJsonHtml, scanString, type JsonToken } from './jsonHighlight';

const kinds = (text: string): string[] => tokenizeJson(text).map((t) => t.kind);
const slice = (text: string, t: JsonToken): string => text.slice(t.start, t.end);

describe('tokenizeJson', () => {
  it('classifies keys, string values, numbers, booleans, null and punctuation', () => {
    const text = '{"a": "x", "n": 12.5, "b": true, "z": null}';
    const toks = tokenizeJson(text);
    expect(slice(text, toks[1])).toBe('"a"');
    expect(toks[1].kind).toBe('key');
    expect(toks.map((t) => t.kind)).toEqual([
      'punct', 'key', 'punct', 'str', 'punct',
      'key', 'punct', 'num', 'punct',
      'key', 'punct', 'bool', 'punct',
      'key', 'punct', 'null', 'punct',
    ]);
  });

  it('a string value starting with = is an expression token', () => {
    const text = '{"txtContent": "=if([$Done], \'✓\', \'\')"}';
    const toks = tokenizeJson(text);
    expect(toks.find((t) => t.kind === 'expr')).toBeTruthy();
    expect(toks.filter((t) => t.kind === 'str')).toHaveLength(0);
  });

  it('bare [$Field] refs and @tokens paint as expressions too (the engine resolves them live)', () => {
    // mirrors core/expressions.evaluate: whole-string refs are references
    const text = '{"txtContent": "[$Title]", "src": "@thumbnail", "alt": "a [$Title] label"}';
    const toks = tokenizeJson(text).filter((t) => t.kind !== 'key' && t.kind !== 'punct');
    expect(toks.map((t) => t.kind)).toEqual(['expr', 'expr', 'str']);
  });

  it('escaped quotes stay inside one string token', () => {
    const text = '{"a": "he said \\"hi\\""}';
    const toks = tokenizeJson(text);
    const str = toks.find((t) => t.kind === 'str')!;
    expect(slice(text, str)).toBe('"he said \\"hi\\""');
  });

  it('an unterminated string runs to end of line, never swallowing the next line', () => {
    const text = '{\n  "a": "unfinished\n  "b": 1\n}';
    const toks = tokenizeJson(text);
    const strs = toks.filter((t) => t.kind === 'str');
    expect(strs).toHaveLength(1);
    expect(slice(text, strs[0])).toBe('"unfinished');
    // the next line's key still tokenizes as a key
    const keyB = toks.find((t) => slice(text, t) === '"b"')!;
    expect(keyB.kind).toBe('key');
  });

  it('bare identifiers (invalid JSON) get the err kind instead of crashing', () => {
    expect(kinds('{"a": oops}')).toContain('err');
  });

  it('a key is only a key when the colon follows (spaces allowed)', () => {
    const text = '{"k"  : 1, "v"}';
    const toks = tokenizeJson(text);
    expect(toks[1].kind).toBe('key');
    const v = toks.find((t) => slice(text, t) === '"v"')!;
    expect(v.kind).toBe('str');
  });
});

describe('scanString', () => {
  it('reports closed vs line-truncated strings', () => {
    expect(scanString('"ab"', 0)).toEqual({ end: 4, closed: true });
    expect(scanString('"ab\ncd"', 0)).toEqual({ end: 3, closed: false });
    expect(scanString('"a\\"b"', 0)).toEqual({ end: 6, closed: true });
  });
});

describe('matchBracketAt', () => {
  const text = '{"a": {"b": [1, 2]}}';
  const toks = tokenizeJson(text);

  it('matches the bracket just before the caret (and at it as fallback)', () => {
    // caret right after the inner '{' at offset 6
    expect(matchBracketAt(text, toks, 7)).toEqual([6, 18]);
    // caret ON the outer '{'
    expect(matchBracketAt(text, toks, 0)).toEqual([0, 19]);
  });

  it('matches backward from a closer', () => {
    expect(matchBracketAt(text, toks, 18)).toEqual([12, 17]); // after ']'
  });

  it('ignores brackets inside strings', () => {
    const t = '{"a": "[not|a bracket]"}';
    const tk = tokenizeJson(t);
    // caret inside the string next to '[' — no punct token there, no match
    expect(matchBracketAt(t, tk, 8)).toBeNull();
  });

  it('unbalanced brackets return null instead of guessing', () => {
    const t = '{"a": [1, 2';
    const tk = tokenizeJson(t);
    expect(matchBracketAt(t, tk, 7)).toBeNull();
  });
});

describe('renderJsonHtml', () => {
  it('wraps tokens in kind-classed spans and escapes HTML', () => {
    const text = '{"a": "<b> & stuff"}';
    const html = renderJsonHtml(text, tokenizeJson(text));
    expect(html).toContain('<span class="wb-tok-key">"a"</span>');
    expect(html).toContain('&lt;b&gt; &amp; stuff');
    expect(html).not.toContain('<b>');
  });

  it('stamps wb-tok-match on the matched bracket pair', () => {
    const text = '{"a": 1}';
    const toks = tokenizeJson(text);
    const html = renderJsonHtml(text, toks, matchBracketAt(text, toks, 1));
    expect(html).toContain('<span class="wb-tok-punct wb-tok-match">{</span>');
    expect(html).toContain('<span class="wb-tok-punct wb-tok-match">}</span>');
  });

  it('keeps a trailing empty line visible so the overlay never shears', () => {
    const text = '{}\n';
    const html = renderJsonHtml(text, tokenizeJson(text));
    expect(html.endsWith('\n ') || html.endsWith(' ')).toBe(true);
  });

  it('round-trips the raw text of every token (nothing lost between spans)', () => {
    const text = '{\n  "elmType": "div",\n  "style": { "color": "=if(1, \'a\', \'b\')" }\n}';
    const html = renderJsonHtml(text, tokenizeJson(text));
    const plain = html.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    expect(plain).toBe(text);
  });
});
