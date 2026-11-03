// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Sam Yost

import { describe, it, expect } from 'vitest';
import { importJson } from '../core/serializer';
import {
  STARTERS, exportCard, isFreeCard, partIndices, partRect, setPartRect, setCardSize,
  boundField, fieldText, duplicatePart, moveLayer, removePart, innerSize, isClickOverlay,
  addPart, newText, centered, setStyles, setFontSize,
} from './model';
import { sampleFields } from './sample';

const fields = sampleFields();

describe('Lite starters', () => {
  for (const s of STARTERS) {
    it(`${s.label} exports lint-clean, free-layout JSON that round-trips`, () => {
      const doc = s.build();
      const out = exportCard(doc, fields);
      expect(out.errors).toEqual([]);
      expect(out.warnings).toEqual([]);
      expect(out.json).not.toMatch(/(^|[^=!<>])!(?!=)/); // house rule: never a standalone '!'
      const back = importJson(out.json);
      expect(back.kind).toBe('tile');
      expect(isFreeCard(back)).toBe(true);
      expect(back.tileWidth).toBe(doc.tileWidth);
      expect(back.tileHeight).toBe(doc.tileHeight);
      expect(partIndices(back)).toEqual(partIndices(doc));
    });
  }

  it('judges text contrast against the part under it, not only the card', () => {
    const header = STARTERS.find((s) => s.id === 'header')!.build();
    expect(exportCard(header, fields).warnings).toEqual([]); // white title on the blue header shape
    const title = partIndices(header).find((i) => header.root.children![i]._elmName === 'Title')!;
    const lost = setPartRect(header, title, { x: 16, y: 90, w: 220, h: 22 }); // off the header, onto white
    expect(exportCard(lost, fields).warnings.map((w) => w.rule)).toContain('low-contrast');
    // the borrowed fill is lint-only: the exported Title still has none
    const exported = JSON.parse(exportCard(header, fields).json) as { formatter: { children: Array<{ _elmName?: string; style?: Record<string, string> }> } };
    expect(exported.formatter.children.find((c) => c._elmName === 'Title')?.style?.['background-color']).toBeUndefined();
  });

  it('does not call a root that shows text itself a free card', () => {
    const textRoot = { kind: 'tile' as const, tileWidth: 254, tileHeight: 120,
      root: { elmType: 'div' as const, style: { position: 'relative' }, txtContent: '[$Title]' } };
    expect(isFreeCard(textRoot)).toBe(false);
  });

  it('pins the SharePoint open-item overlay as the first child, outside the parts', () => {
    const doc = STARTERS[0].build();
    expect(isClickOverlay(doc.root.children![0])).toBe(true);
    expect(partIndices(doc)).not.toContain(0);
  });

  it('keeps every starter part inside the card', () => {
    for (const s of STARTERS) {
      const doc = s.build();
      const inner = innerSize(doc);
      for (const i of partIndices(doc)) {
        const r = partRect(doc.root.children![i])!;
        expect(r.x).toBeGreaterThanOrEqual(0);
        expect(r.y).toBeGreaterThanOrEqual(0);
        expect(r.x + r.w).toBeLessThanOrEqual(inner.w);
        expect(r.y + r.h).toBeLessThanOrEqual(inner.h);
      }
    }
  });
});

describe('Lite edits', () => {
  const doc = STARTERS[0].build();
  const first = partIndices(doc)[0];

  it('moves a part without touching the original document', () => {
    const moved = setPartRect(doc, first, { x: 30, y: 40, w: 50, h: 10 });
    expect(partRect(moved.root.children![first])).toEqual({ x: 30, y: 40, w: 50, h: 10 });
    expect(partRect(doc.root.children![first])).not.toEqual({ x: 30, y: 40, w: 50, h: 10 });
  });

  it('rounds to whole pixels', () => {
    const moved = setPartRect(doc, first, { x: 10.4, y: 9.6, w: 20.5, h: 3.2 });
    expect(partRect(moved.root.children![first])).toEqual({ x: 10, y: 10, w: 21, h: 3 });
  });

  it('resizes the tile box and the root together', () => {
    const big = setCardSize(doc, 300, 280);
    expect(big.tileWidth).toBe(300);
    expect(big.tileHeight).toBe(280);
    expect(big.root.style?.width).toBe('300px');
    expect(big.root.style?.height).toBe('280px');
  });

  it('duplicates next to the original, offset by 8 px', () => {
    const { doc: d2, index } = duplicatePart(doc, first);
    const a = partRect(d2.root.children![first])!;
    const b = partRect(d2.root.children![index])!;
    expect(index).toBe(first + 1);
    expect(b).toEqual({ ...a, x: a.x + 8, y: a.y + 8 });
  });

  it('moves a layer up and down without passing the overlay', () => {
    const parts = partIndices(doc);
    const { doc: up, index } = moveLayer(doc, parts[0], 1);
    expect(index).toBe(parts[1]);
    expect(up.root.children![parts[1]]).toEqual(doc.root.children![parts[0]]);
    const { index: same } = moveLayer(doc, parts[0], -1);
    expect(same).toBe(parts[0]); // the overlay below is not a part
  });

  it('removes and adds parts', () => {
    const n = partIndices(doc).length;
    expect(partIndices(removePart(doc, first))).toHaveLength(n - 1);
    const { doc: d3, index } = addPart(doc, newText(fields[0], centered(doc, 100, 20)));
    expect(partIndices(d3)).toContain(index);
  });

  it('keeps a pill centred and a clamped title tidy when their boxes change', () => {
    const named = (d: typeof doc, n: string): number => partIndices(d).find((i) => d.root.children![i]._elmName === n)!;
    const pill = named(doc, 'Status pill');
    const tall = setPartRect(doc, pill, { x: 16, y: 76, w: 96, h: 32 });
    expect(tall.root.children![pill].style?.['line-height']).toBe('32px');
    const title = named(doc, 'Title'); // 22px lines, 2 of them, at y 22
    const three = setPartRect(doc, title, { x: 16, y: 22, w: 220, h: 70 });
    expect(partRect(three.root.children![title])).toEqual({ x: 16, y: 22, w: 220, h: 66 }); // whole lines
    expect(three.root.children![title].style?.['-webkit-line-clamp']).toBe('3');
    const fromTop = setPartRect(doc, title, { x: 16, y: 2, w: 220, h: 64 }); // top edge dragged up
    expect(partRect(fromTop.root.children![title])).toEqual({ x: 16, y: 0, w: 220, h: 66 }); // bottom stays put at 66
    const moved = setPartRect(doc, title, { x: 30, y: 30, w: 220, h: 44 });
    expect(moved.root.children![title].style?.['-webkit-line-clamp']).toBe('2'); // a move never re-fits
  });

  it('changes text size without breaking the box', () => {
    const named = (n: string): number => partIndices(doc).find((i) => doc.root.children![i]._elmName === n)!;
    const title = named('Title'); // 16px text, 22px lines, 2 lines
    const big = setFontSize(doc, title, 24);
    expect(big.root.children![title].style?.['line-height']).toBe('33px');
    expect(big.root.children![title].style?.['-webkit-line-clamp']).toBe('2');
    expect(partRect(big.root.children![title])?.h).toBe(66); // still two lines, so the box grows
    const pill = named('Status pill'); // 12px text centred in a 24px box
    expect(setFontSize(doc, pill, 14).root.children![pill].style?.['line-height']).toBe('24px'); // still fits
    const huge = setFontSize(doc, pill, 20);
    expect(partRect(huge.root.children![pill])?.h).toBe(28);
    expect(huge.root.children![pill].style?.['line-height']).toBe('28px'); // grown and still centred
  });

  it('applies several style changes as one edit', () => {
    const d = setStyles(doc, first, { color: '#ff0000', 'font-weight': undefined });
    expect(d.root.children![first].style?.color).toBe('#ff0000');
    expect(d.root.children![first].style?.['font-weight']).toBeUndefined();
  });
});

describe('Lite field binding', () => {
  it('round-trips every bindable field through fieldText → boundField', () => {
    for (const f of fields) expect(boundField(fieldText(f))).toBe(f.name);
  });

  it('does not claim a formula that shows more than one field', () => {
    expect(boundField("=[$Title]+' '+[$Status]")).toBeNull();
    expect(boundField("=if(toString([$DueDate])=='','No due date','Due '+toLocaleDateString([$DueDate]))")).toBeNull();
  });

  it('guards empty dates the way the main app does', () => {
    expect(fieldText({ name: 'DueDate', type: 'date' })).toBe("=if(toString([$DueDate])=='','',toLocaleDateString([$DueDate]))");
  });
});
