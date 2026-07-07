/**
 * codeSync.ts contracts (#218): caret preservation across regenerated JSON,
 * the line math for scroll/flash, and the SyncEcho guard that keeps
 * bi-directional selection sync from looping.
 */
import { describe, it, expect } from 'vitest';
import { preserveCaret, lineSpanOf, lineOfOffset, SyncEcho } from './codeSync';

describe('preserveCaret', () => {
  it('identical text keeps the offset (clamped into bounds)', () => {
    expect(preserveCaret('abc', 'abc', 2)).toBe(2);
    expect(preserveCaret('abc', 'abc', 99)).toBe(3);
    expect(preserveCaret('', '', 0)).toBe(0);
  });

  it('a change AFTER the caret leaves it alone (common prefix)', () => {
    //          caret ↓ here, edit at the tail
    expect(preserveCaret('{ "a": 1 }', '{ "a": 22 }', 3)).toBe(3);
  });

  it('a change BEFORE the caret shifts it by the length delta', () => {
    const oldT = '{ "color": "red", "pad": 4 }';
    const newT = '{ "color": "green", "pad": 4 }';
    const caret = oldT.indexOf('"pad"'); // sits in the common suffix
    expect(preserveCaret(oldT, newT, caret)).toBe(newT.indexOf('"pad"'));
    // and a shrink shifts backwards
    expect(preserveCaret(newT, oldT, newT.indexOf('"pad"'))).toBe(caret);
  });

  it('a caret INSIDE the changed region lands at the end of the replacement', () => {
    const oldT = 'aa REMOVED zz';
    const newT = 'aa X zz';
    const caret = oldT.indexOf('MOV'); // mid-change
    expect(preserveCaret(oldT, newT, caret)).toBe(newT.length - ' zz'.length);
  });

  it('an insertion at the caret keeps the caret before it', () => {
    expect(preserveCaret('ab', 'aXb', 1)).toBe(1); // prefix wins for o <= prefix
  });

  it('deleting everything before the caret clamps to the start of the suffix', () => {
    expect(preserveCaret('hello world', 'world', 3)).toBe(0);
  });

  it('never returns an out-of-bounds offset', () => {
    for (const [o, n, at] of [['abcdef', 'x', 6], ['x', 'abcdef', 1], ['', 'abc', 0], ['abc', '', 3]] as const) {
      const r = preserveCaret(o, n, at);
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThanOrEqual(n.length);
    }
  });
});

describe('lineSpanOf / lineOfOffset', () => {
  const text = 'line0\nline1\nline2\nline3';
  it('maps offsets to 0-based lines', () => {
    expect(lineOfOffset(text, 0)).toBe(0);
    expect(lineOfOffset(text, 5)).toBe(0); // the \n itself still ends line 0
    expect(lineOfOffset(text, 6)).toBe(1);
    expect(lineOfOffset(text, text.length)).toBe(3);
    expect(lineOfOffset(text, 9999)).toBe(3); // clamped
  });
  it('spans a [start, end) range end-exclusive', () => {
    expect(lineSpanOf(text, 6, 12)).toEqual({ first: 1, last: 1 }); // "line1\n"
    expect(lineSpanOf(text, 6, 18)).toEqual({ first: 1, last: 2 });
    expect(lineSpanOf(text, 0, 0)).toEqual({ first: 0, last: 0 }); // degenerate
  });
});

describe('SyncEcho (the echo guard)', () => {
  it('reports the origin only inside the synchronous run', () => {
    const echo = new SyncEcho();
    expect(echo.from('code')).toBe(false);
    let seen = false;
    echo.run('code', () => { seen = echo.from('code'); });
    expect(seen).toBe(true);
    expect(echo.from('code')).toBe(false); // cleared after
  });

  it('distinguishes origins and restores the outer one on nesting', () => {
    const echo = new SyncEcho();
    echo.run('canvas', () => {
      expect(echo.from('code')).toBe(false);
      echo.run('code', () => expect(echo.from('code')).toBe(true));
      expect(echo.from('canvas')).toBe(true); // outer origin restored
    });
  });

  it('clears the origin even when the callback throws', () => {
    const echo = new SyncEcho();
    expect(() => echo.run('code', () => { throw new Error('boom'); })).toThrow('boom');
    expect(echo.from('code')).toBe(false);
  });

  it('returns the callback result', () => {
    expect(new SyncEcho().run('x', () => 42)).toBe(42);
  });
});
