/**
 * jsonFold.test.ts — the pure fold layer (spec 2026-07-09 §3): cuts elide a
 * node's interior lines to the sentinel, the bimap is exact outside cuts and
 * clamps inside them, and placeholders keep opener + closer + trailing comma
 * so folded text stays bracket-balanced for every tolerant scanner.
 */
import { describe, it, expect } from 'vitest';
import {
  FOLD_SENTINEL, cutForRange, outermost, buildFoldView, fullLineOfFoldedLine,
} from './jsonFold';

const FIXTURE = [
  '{',                      // 0
  '  "elmType": "div",',    // 1
  '  "style": {',           // 2
  '    "color": "red",',    // 3
  '    "padding": "4px"',   // 4
  '  },',                   // 5
  '  "children": []',       // 6
  '}',                      // 7
].join('\n');

/** Range of the style OBJECT (its { through its }) in FIXTURE. */
function styleRange() {
  const start = FIXTURE.indexOf('{', FIXTURE.indexOf('"style"'));
  const end = FIXTURE.indexOf('}', start) + 1;
  return { start, end };
}

describe('cutForRange', () => {
  it('cuts from the opening line end to the closing line indentation', () => {
    const cut = cutForRange(FIXTURE, styleRange())!;
    const folded = FIXTURE.slice(0, cut.start) + FOLD_SENTINEL + FIXTURE.slice(cut.end);
    expect(folded).toContain('"style": { ⋯ },'); // opener, sentinel, closer, trailing comma
    expect(folded).not.toContain('"color"');
  });

  it('single-line nodes are not foldable', () => {
    const start = FIXTURE.indexOf('[');
    expect(cutForRange(FIXTURE, { start, end: start + 2 })).toBeNull();
  });
});

describe('outermost', () => {
  it('drops cuts contained in an earlier one', () => {
    expect(outermost([
      { start: 10, end: 50 }, { start: 20, end: 30 }, { start: 60, end: 70 },
    ])).toEqual([{ start: 10, end: 50 }, { start: 60, end: 70 }]);
  });
});

describe('buildFoldView', () => {
  const cut = cutForRange(FIXTURE, styleRange())!;
  const view = buildFoldView(FIXTURE, [cut]);

  it('assembles the folded text with the sentinel', () => {
    expect(view.text).toContain('"style": { ⋯ },');
    expect(view.text.length).toBe(FIXTURE.length - (cut.end - cut.start) + FOLD_SENTINEL.length);
  });

  it('round-trips offsets outside the cut exactly', () => {
    for (const probe of [0, 5, cut.start - 1, cut.end, FIXTURE.length]) {
      expect(view.toFull(view.toFolded(probe))).toBe(probe);
    }
  });

  it('clamps offsets inside the cut to the folded cut start', () => {
    const foldedStart = view.toFolded(cut.start);
    expect(view.toFolded(cut.start + 3)).toBe(foldedStart);
    // sentinel interior maps back to the cut start
    expect(view.toFull(foldedStart + 1)).toBe(cut.start);
  });

  it('cutIndexAtFolded is inclusive across the sentinel span, -1 elsewhere', () => {
    const foldedStart = view.toFolded(cut.start);
    expect(view.cutIndexAtFolded(foldedStart)).toBe(0);
    expect(view.cutIndexAtFolded(foldedStart + FOLD_SENTINEL.length)).toBe(0);
    expect(view.cutIndexAtFolded(0)).toBe(-1);
    expect(view.cutIndexAtFolded(view.text.length)).toBe(-1);
  });

  it('maps are monotonic', () => {
    let prev = -1;
    for (let o = 0; o <= FIXTURE.length; o++) {
      const f = view.toFolded(o);
      expect(f).toBeGreaterThanOrEqual(prev);
      prev = f;
    }
  });
});

describe('fullLineOfFoldedLine', () => {
  it('numbers gap across the fold', () => {
    const cut = cutForRange(FIXTURE, styleRange())!;
    const view = buildFoldView(FIXTURE, [cut]);
    // folded lines: 0 '{', 1 elmType, 2 '"style": { ⋯ },', 3 children, 4 '}'
    expect(fullLineOfFoldedLine(view, FIXTURE, 0)).toBe(0);
    expect(fullLineOfFoldedLine(view, FIXTURE, 2)).toBe(2);
    expect(fullLineOfFoldedLine(view, FIXTURE, 3)).toBe(6); // the gap: 3,4,5 hidden
    expect(fullLineOfFoldedLine(view, FIXTURE, 4)).toBe(7);
  });
});
