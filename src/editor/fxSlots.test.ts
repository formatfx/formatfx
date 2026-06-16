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
    expect(ids).toEqual(expect.arrayContaining(['text', 'fill', 'ink', 'weight', 'leftBorder', 'radius', 'opacity']));
  });

  it('is element-aware: box slots everywhere, type slots only where text renders', () => {
    const img = slotsFor({ elmType: 'img' }).map((s) => s.id);
    // box/paint slots apply to an image…
    expect(img).toEqual(expect.arrayContaining(['fill', 'leftBorder', 'radius', 'opacity']));
    // …but text/type slots and "Text shown" do not
    expect(img).not.toContain('ink');
    expect(img).not.toContain('weight');
    expect(img).not.toContain('text');
  });

  it('offers attribute slots only where they apply (img → src, a → href)', () => {
    expect(slotsFor({ elmType: 'img' }).some((s) => s.id === 'src')).toBe(true);
    expect(slotsFor({ elmType: 'a' }).some((s) => s.id === 'href')).toBe(true);
    expect(slotsFor({ elmType: 'div' }).some((s) => s.kind === 'attr')).toBe(false);
  });

  it('surfaces existing style properties as their own slots, without duplicating curated ones', () => {
    const node: SPElement = {
      elmType: 'div',
      style: { 'background-color': '#fff', 'box-shadow': '0 1px 2px #0003', 'width': '120px' },
    };
    const slots = slotsFor(node);
    // background-color is curated (fill) — not a second slot
    expect(slots.filter((s) => s.prop === 'background-color')).toHaveLength(1);
    // non-curated props appear as their own humanized slots
    expect(bySlot(slots, 'style:box-shadow').label).toBe('Box shadow');
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

  it('reads/writes attribute slots, tidying an empty attributes object', () => {
    const node: SPElement = { elmType: 'img' };
    const src = bySlot(slotsFor(node), 'src');
    expect(readSlot(node, src)).toBeUndefined();
    writeSlot(node, src, '=getUserImage([$Owner.email])');
    expect(node.attributes!['src']).toBe('=getUserImage([$Owner.email])');
    writeSlot(node, src, '');
    expect(node.attributes).toBeUndefined();
  });
});

describe('humanizeProp', () => {
  it('reads CSS names as words', () => {
    expect(humanizeProp('background-color')).toBe('Background color');
    expect(humanizeProp('-webkit-line-clamp')).toBe('Webkit line clamp');
  });
});
