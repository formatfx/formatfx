import { describe, it, expect } from 'vitest';
import { slotsFor, readSlot, writeSlot, humanizeProp, type FxSlot } from './fxSlots';
import type { SPElement } from '../core/types';

const bySlot = (slots: FxSlot[], id: string): FxSlot => {
  const s = slots.find((x) => x.id === id);
  if (!s) throw new Error(`no slot ${id}`);
  return s;
};

describe('slotsFor — element/type-aware catalog', () => {
  it('text-capable elements offer "Text shown"; img/svg do not', () => {
    expect(slotsFor({ elmType: 'div' }).some((s) => s.id === 'text')).toBe(true);
    expect(slotsFor({ elmType: 'span' }).some((s) => s.id === 'text')).toBe(true);
    expect(slotsFor({ elmType: 'img' }).some((s) => s.id === 'text')).toBe(false);
  });

  it('always offers the curated paint set', () => {
    const ids = slotsFor({ elmType: 'div' }).map((s) => s.id);
    expect(ids).toEqual(expect.arrayContaining(['text', 'fill', 'ink', 'weight', 'leftBorder']));
  });

  it('surfaces existing style properties as their own slots, without duplicating curated ones', () => {
    const node: SPElement = {
      elmType: 'div',
      style: { 'background-color': '#fff', 'border-radius': '12px', 'width': '120px' },
    };
    const slots = slotsFor(node);
    // background-color is curated (fill) — not a second slot
    expect(slots.filter((s) => s.prop === 'background-color')).toHaveLength(1);
    // border-radius / width appear as their own humanized slots
    expect(bySlot(slots, 'style:border-radius').label).toBe('Border radius');
    expect(bySlot(slots, 'style:width').label).toBe('Width');
  });

  it('hints describe the slot in "every row" terms', () => {
    for (const s of slotsFor({ elmType: 'div' })) {
      expect(s.hint).toMatch(/every row/i);
    }
  });
});

describe('readSlot / writeSlot', () => {
  it('reads text and style values', () => {
    const node: SPElement = { elmType: 'div', txtContent: '=[$Title]', style: { color: '#107c10' } };
    const slots = slotsFor(node);
    expect(readSlot(node, bySlot(slots, 'text'))).toBe('=[$Title]');
    expect(readSlot(node, bySlot(slots, 'ink'))).toBe('#107c10');
    expect(readSlot(node, bySlot(slots, 'fill'))).toBeUndefined();
  });

  it('writes, then clears (tidying an empty style object)', () => {
    const node: SPElement = { elmType: 'div' };
    const fill = bySlot(slotsFor(node), 'fill');
    writeSlot(node, fill, "=if([$Status]=='Done','#107c10','#d13438')");
    expect(node.style!['background-color']).toBe("=if([$Status]=='Done','#107c10','#d13438')");
    writeSlot(node, fill, '');
    expect(node.style).toBeUndefined(); // empty object removed
  });

  it('clearing text removes txtContent', () => {
    const node: SPElement = { elmType: 'span', txtContent: 'hello' };
    writeSlot(node, bySlot(slotsFor(node), 'text'), undefined);
    expect(node.txtContent).toBeUndefined();
  });

  it('a style write preserves other style keys', () => {
    const node: SPElement = { elmType: 'div', style: { color: '#000' } };
    writeSlot(node, bySlot(slotsFor(node), 'fill'), '#fff');
    expect(node.style).toEqual({ color: '#000', 'background-color': '#fff' });
  });
});

describe('humanizeProp', () => {
  it('reads CSS names as words', () => {
    expect(humanizeProp('background-color')).toBe('Background color');
    expect(humanizeProp('-webkit-line-clamp')).toBe('Webkit line clamp');
  });
});
