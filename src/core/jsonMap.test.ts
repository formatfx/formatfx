/**
 * jsonMap.ts contracts (#218): the offset↔path map must be a byte-exact
 * byproduct of the real serializer — same text as exportJson, with every
 * element's range recoverable both ways (path → range → path round trips),
 * across nested arrays, unicode, escapes, card formatters and all four
 * document kinds.
 */
import { describe, it, expect } from 'vitest';
import { exportJsonWithMap, pathAtOffset, rangeForPath } from './jsonMap';
import { exportJson } from './serializer';
import type { FormatterDocument, NodePath, SPElement } from './types';

const CARD = -1;

/** Every element path in a tree, in document order. */
function allPaths(el: SPElement, base: NodePath = []): NodePath[] {
  const out: NodePath[] = [base];
  (el.children ?? []).forEach((c, i) => out.push(...allPaths(c, [...base, i])));
  if (el.customCardProps?.formatter) out.push(...allPaths(el.customCardProps.formatter, [...base, CARD]));
  return out;
}

const columnDoc = (): FormatterDocument => ({
  kind: 'column',
  root: {
    elmType: 'div',
    _elmName: 'Status pill',
    style: { 'background-color': "=if([$Status] == 'Done', '#107c10', '#d13438')", 'border-radius': '12px' },
    children: [
      { elmType: 'span', txtContent: '@currentField', style: { padding: '2px 8px' } },
      {
        elmType: 'span',
        txtContent: 'héllo "wörld" 😀 <>&\n\ttab',
        attributes: { class: 'sp-field-severity--good' },
      },
    ],
  },
});

const rowDoc = (): FormatterDocument => ({
  kind: 'row',
  hideSelection: true,
  viewExtras: { additionalRowClass: 'zebra' },
  root: {
    elmType: 'div',
    children: [
      {
        elmType: 'div',
        children: [
          { elmType: 'span', txtContent: '[$Title]' },
          { elmType: 'img', attributes: { src: '[$Link]' } },
        ],
      },
      {
        elmType: 'button',
        txtContent: 'Card',
        customCardProps: {
          openOnEvent: 'hover',
          formatter: {
            elmType: 'div',
            children: [{ elmType: 'span', txtContent: 'inside the card' }],
          },
        },
      },
    ],
  },
});

const tileDoc = (): FormatterDocument => ({
  kind: 'tile',
  tileWidth: 300,
  tileHeight: 200,
  root: { elmType: 'div', children: [{ elmType: 'span', txtContent: '=if(1 == 1, "a", "b")' }] },
});

const gridDoc = (): FormatterDocument => ({
  kind: 'grid',
  root: {
    elmType: 'div',
    children: [
      { elmType: 'div', children: [{ elmType: 'span', txtContent: '[$Title]' }] },
      { elmType: 'div', children: [] }, // empty children array
    ],
  },
});

describe('exportJsonWithMap — byte-identity with exportJson', () => {
  const docs: Array<[string, FormatterDocument]> = [
    ['column', columnDoc()], ['row', rowDoc()], ['tile', tileDoc()], ['grid', gridDoc()],
  ];
  for (const [name, doc] of docs) {
    it(`matches exportJson for a ${name} doc (default opts)`, () => {
      expect(exportJsonWithMap(doc).text).toBe(exportJson(doc));
    });
    it(`matches exportJson for a ${name} doc (keepMeta:false, sanitize off)`, () => {
      const opts = { keepMeta: false, sanitizeWhitespace: false };
      expect(exportJsonWithMap(doc, opts).text).toBe(exportJson(doc, opts));
    });
  }

  it('matches through the whitespace sanitizer (expression rewriting happens upstream of the map)', () => {
    const doc = tileDoc(); // txtContent has spaces inside an =expression
    const on = exportJsonWithMap(doc, { sanitizeWhitespace: true });
    expect(on.text).toBe(exportJson(doc, { sanitizeWhitespace: true }));
    expect(on.text).toContain('=if(1==1,\\"a\\",\\"b\\")'); // spaces stripped, quotes JSON-escaped
  });
});

describe('exportJsonWithMap — ranges', () => {
  it('every element range slices to valid JSON that IS that element (round trip)', () => {
    for (const doc of [columnDoc(), rowDoc(), tileDoc(), gridDoc()]) {
      const { text, ranges } = exportJsonWithMap(doc);
      for (const path of allPaths(doc.root)) {
        const r = rangeForPath(ranges, path);
        expect(r, `range for [${path.join(',')}] in ${doc.kind}`).not.toBeNull();
        const slice = text.slice(r!.start, r!.end);
        const parsed = JSON.parse(slice) as SPElement;
        // resolve the same path in the source tree and compare identity anchor
        let node: SPElement | undefined = doc.root;
        for (const seg of path) {
          node = seg === CARD ? node?.customCardProps?.formatter : node?.children?.[seg];
        }
        expect(parsed.elmType).toBe(node!.elmType);
        // and the range's own start maps back to the same path (innermost wins)
        expect(pathAtOffset(ranges, r!.start)).toEqual(path);
      }
    }
  });

  it('an offset inside a child maps to the child, not the parent', () => {
    const { text, ranges } = exportJsonWithMap(rowDoc());
    const inner = rangeForPath(ranges, [0, 0])!; // the [$Title] span
    const mid = text.indexOf('[$Title]', inner.start);
    expect(mid).toBeGreaterThan(inner.start);
    expect(mid).toBeLessThan(inner.end);
    expect(pathAtOffset(ranges, mid)).toEqual([0, 0]);
  });

  it('offsets survive unicode + escapes (quotes, newline, emoji, tab)', () => {
    const { text, ranges } = exportJsonWithMap(columnDoc(), { sanitizeWhitespace: false });
    const r = rangeForPath(ranges, [1])!; // the unicode span
    const parsed = JSON.parse(text.slice(r.start, r.end)) as SPElement;
    expect(parsed.txtContent).toBe('héllo "wörld" 😀 <>&\n\ttab');
    // an offset in the middle of the escaped literal still maps to that span
    const at = text.indexOf('😀');
    expect(pathAtOffset(ranges, at)).toEqual([1]);
  });

  it('descends into customCardProps.formatter with the -1 card segment', () => {
    const { text, ranges } = exportJsonWithMap(rowDoc());
    const card = rangeForPath(ranges, [1, CARD])!;
    expect(JSON.parse(text.slice(card.start, card.end)).elmType).toBe('div');
    const innerSpan = rangeForPath(ranges, [1, CARD, 0])!;
    expect(text.slice(innerSpan.start, innerSpan.end)).toContain('inside the card');
    expect(pathAtOffset(ranges, innerSpan.start + 1)).toEqual([1, CARD, 0]);
  });

  it('a view wrapper offset ($schema line) maps to no element; a column $schema maps to the root it spreads into', () => {
    const row = exportJsonWithMap(rowDoc());
    expect(pathAtOffset(row.ranges, 0)).toBeNull(); // payload "{" — wrapper chrome
    expect(pathAtOffset(row.ranges, row.text.indexOf('$schema'))).toBeNull();
    const col = exportJsonWithMap(columnDoc());
    expect(pathAtOffset(col.ranges, 0)).toEqual([]); // the payload IS the root, spread
  });

  it('offsets outside every range return null; end-of-element is inclusive', () => {
    const { text, ranges } = exportJsonWithMap(rowDoc());
    expect(pathAtOffset(ranges, text.length)).toBeNull(); // after the wrapper "}"
    const leaf = rangeForPath(ranges, [0, 1])!;
    expect(pathAtOffset(ranges, leaf.end)).toEqual([0, 1]); // caret right after "}"
  });

  it('handles an element with an empty children array', () => {
    const { text, ranges } = exportJsonWithMap(gridDoc());
    const r = rangeForPath(ranges, [1])!;
    expect(text.slice(r.start, r.end)).toContain('"children": []');
    expect(pathAtOffset(ranges, r.start + 1)).toEqual([1]);
  });
});
