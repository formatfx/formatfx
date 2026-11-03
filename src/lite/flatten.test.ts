// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Sam Yost

import { describe, it, expect } from 'vitest';
import type { FormatterDocument, SPElement } from '../core/types';
import { flattenCard, isUnit, type Measure, type Measured } from './flatten';
import { STARTERS, exportCard, isClickOverlay, isFreeCard, partIndices, partRect } from './model';
import { sampleFields, withExtraFields, sampleRows } from './sample';

/** SharePoint's own card-designer shape (the main app's verified 3-layer scaffold) plus the hard cases. */
function designerCard(): FormatterDocument {
  const root: SPElement = {
    elmType: 'div',
    attributes: { class: 'sp-card-container sp-card-showOnHoverParent' },
    children: [
      { elmType: 'div', attributes: { class: 'sp-card-defaultClickButton', role: 'button', title: 'Open item' }, customRowAction: { action: 'defaultClick' } },
      {
        elmType: 'div',
        attributes: { class: 'sp-card-subContainer sp-card-borderHighlight' },
        style: { color: '#323130', padding: '12px' },
        children: [
          {
            elmType: 'div', attributes: { class: 'sp-card-displayColumnContainer ms-fontSize-14' },
            children: [
              { elmType: 'p', txtContent: '[!Title.DisplayName]', attributes: { class: 'sp-card-label' } },
              { elmType: 'p', txtContent: '[$Title]', attributes: { class: 'sp-card-content sp-card-highlightedContent' }, style: { 'margin-top': '4px', flex: '1' } },
            ],
          },
          { elmType: 'div', style: { display: "=if([$Status]=='Done','none','flex')", 'flex-direction': 'column', flex: '1' }, children: [{ elmType: 'span', txtContent: '[$Status]' }] },
          { elmType: 'div', children: [{ elmType: 'span', txtContent: '[$Notes]' }] },
          { elmType: 'div', style: { height: '8px' } },
        ],
      },
    ],
  };
  return { kind: 'tile', root, tileWidth: 254, tileHeight: 220 };
}

function fakeMeasure(map: Record<string, Measured | null>): Measure {
  return (path) => map[path.join('.')] ?? null;
}

const at = (x: number, y: number, w: number, h: number, paints = false, own?: string[]): Measured => ({ rect: { x, y, w, h }, paints, own });

describe('Lite flatten', () => {
  const measured = fakeMeasure({
    '1': at(0, 0, 254, 220, true),
    '1.0': at(12, 12, 230, 40),
    '1.0.0': at(12, 12, 230, 14, false, ['color', 'font-size']), // sp-card-label sets both itself
    '1.0.1': at(12, 28, 230, 20),
    '1.1': at(12, 60, 100, 20),
    '1.3': at(12, 90, 230, 8),
  });
  const { doc, notes } = flattenCard(designerCard(), measured);
  const parts = partIndices(doc).map((i) => doc.root.children![i]);

  it('produces a card Lite can edit, keeping the open-item overlay first', () => {
    expect(isFreeCard(doc)).toBe(true);
    expect(isClickOverlay(doc.root.children![0])).toBe(true);
  });

  it('turns content into parts at their measured boxes, and painted containers into shapes', () => {
    expect(parts.map((p) => p._elmName ?? p.txtContent ?? p.children?.[0].txtContent)).toEqual([
      'Background', '[!Title.DisplayName]', '[$Title]', '[$Status]', '[$Notes]',
    ]);
    expect(partRect(parts[0])).toEqual({ x: 0, y: 0, w: 254, h: 220 });
    expect(partRect(parts[2])).toEqual({ x: 12, y: 28, w: 230, h: 20 });
  });

  it('drops flow-only layout but keeps the look', () => {
    const title = parts[2];
    expect(title.style?.['margin-top']).toBeUndefined();
    expect(title.style?.flex).toBeUndefined();
    expect(title.style?.margin).toBe('0');
    expect(title.style?.['box-sizing']).toBe('border-box');
    expect(title.attributes?.class).toContain('sp-card-highlightedContent');
  });

  it('moves text styles from dissolved containers down onto their parts', () => {
    expect(parts[2].style?.color).toBe('#323130');
    expect(parts[2].attributes?.class).toContain('ms-fontSize-14');
    expect(parts[0].style?.padding).toBe('0'); // the shape never keeps padding
  });

  it('never copies a handed-down style over one the part sets itself', () => {
    // the label's class sets its own gray and size: no inline color, no size class over it
    expect(parts[1].style?.color).toBeUndefined();
    expect(parts[1].attributes?.class).toBe('sp-card-label');
  });

  it('strips flex-item layout but keeps the flex-container settings of a kept part', () => {
    expect(parts[3].style?.flex).toBeUndefined();
    expect(parts[3].style?.['flex-direction']).toBe('column');
  });

  it('makes the root exactly the tile: no class margin can shift it', () => {
    expect(doc.root.style?.margin).toBe('0');
  });

  it('keeps a part a rule shows or hides whole, with its rule', () => {
    expect(parts[3].elmType).toBe('div');
    expect(parts[3].style?.display).toBe("=if([$Status]=='Done','none','flex')");
    expect(parts[3].children?.[0].txtContent).toBe('[$Status]');
  });

  it('never drops content it could not see: it places it over its container and says so', () => {
    expect(partRect(parts[4])).toEqual({ x: 0, y: 0, w: 254, h: 220 });
    expect(notes.join(' ')).toMatch(/Not visible on the sample items.*\[\$Notes\]/);
    expect(notes.join(' ')).toMatch(/1 part is shown by a rule/);
  });

  it('exports lint-clean and opens again unchanged', () => {
    const fields = sampleFields();
    withExtraFields(fields, sampleRows(), ['Notes']);
    expect(exportCard(doc, fields).errors).toEqual([]);
    expect(flattenCard(doc, () => null).doc).toBe(doc);
  });

  it('leaves Lite-made cards alone', () => {
    const task = STARTERS[0].build();
    expect(flattenCard(task, () => null)).toEqual({ doc: task, notes: [] });
  });

  it('opens a bare column formatter as a one-part card', () => {
    const bare: FormatterDocument = { kind: 'tile', root: { elmType: 'span', txtContent: '[$Title]', style: { color: '#a4262c' } }, tileWidth: 254, tileHeight: 120 };
    const out = flattenCard(bare, fakeMeasure({ '': at(0, 0, 80, 18) })).doc;
    expect(isFreeCard(out)).toBe(true);
    expect(out.root.elmType).toBe('div');
    expect(out.root.txtContent).toBeUndefined();
    const only = out.root.children!;
    expect(only).toHaveLength(1);
    expect(only[0].txtContent).toBe('[$Title]');
    expect(partRect(only[0])).toEqual({ x: 0, y: 0, w: 80, h: 18 });
  });

  it('keeps a root whole when taking it apart would break a loop or a rule', () => {
    const looped: FormatterDocument = { kind: 'tile', tileWidth: 254, tileHeight: 120, root: {
      elmType: 'div', style: { display: 'flex' },
      children: [{ elmType: 'img', forEach: 'p in [$AssignedTo]', attributes: { src: '[$p.picture]' } }],
    } };
    const out = flattenCard(looped, fakeMeasure({ '': at(0, 0, 254, 40) })).doc;
    expect(out.root.children).toHaveLength(1);
    expect(out.root.children![0].children?.[0].forEach).toBe('p in [$AssignedTo]');
    const hidden: FormatterDocument = { kind: 'tile', tileWidth: 254, tileHeight: 120, root: {
      elmType: 'div', style: { display: "=if([$Status]=='Done','none','block')" },
      children: [{ elmType: 'span', txtContent: '[$Title]' }],
    } };
    const kept = flattenCard(hidden, fakeMeasure({ '': at(0, 0, 254, 20) })).doc.root.children![0];
    expect(kept.style?.display).toBe("=if([$Status]=='Done','none','block')");
  });

  it('keeps behavior and references, and never drops what it could not see', () => {
    const card: FormatterDocument = { kind: 'tile', tileWidth: 254, tileHeight: 120, root: {
      elmType: 'div',
      children: [
        { elmType: 'div', customRowAction: { action: 'defaultClick' } },
        { elmType: 'div', columnFormatterReference: '[$Status]' },
        { elmType: 'div', style: { width: '10px', height: '10px', 'background-color': '#d13438' } },
        { elmType: 'div' },
      ],
    } };
    const out = flattenCard(card, fakeMeasure({ '0': at(0, 0, 254, 120), '3': at(0, 0, 4, 4) })).doc;
    const kids = out.root.children!;
    expect(kids.some((k) => k.customRowAction)).toBe(true); // unpainted, but it has behavior
    expect(kids.some((k) => k.columnFormatterReference)).toBe(true); // renders another column's look
    expect(kids.map((k) => partRect(k))).toContainEqual({ x: 0, y: 0, w: 10, h: 10 }); // never shown: own size
    expect(kids).toHaveLength(3); // only the seen, empty, unpainted spacer goes
  });

  it('treats loops, behaviors and hover groups as single parts', () => {
    expect(isUnit({ elmType: 'div', style: { opacity: '0.5' }, children: [{ elmType: 'span' }] })).toBe(true);
    expect(isUnit({ elmType: 'div', children: [{ elmType: 'div', style: { width: "=[$Progress]+'%'" } }] })).toBe(true);
    expect(isUnit({ elmType: 'div', children: [{ elmType: 'img', forEach: 'p in [$AssignedTo]' }] })).toBe(true);
    expect(isUnit({ elmType: 'div', customRowAction: { action: 'defaultClick' }, children: [{ elmType: 'span' }] })).toBe(true);
    expect(isUnit({ elmType: 'div', attributes: { class: 'sp-card-showOnHoverChild' }, children: [{ elmType: 'span' }] })).toBe(true);
    expect(isUnit({ elmType: 'div', children: [{ elmType: 'span' }] })).toBe(false);
  });
});
