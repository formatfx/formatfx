/**
 * search.test.ts — contract for the universal-search brain.
 *
 * Pins: what gets indexed from a document (elements, formulas, card content
 * via CARD_SEGMENT paths), the columns-and-rules index riding the SAME
 * rebuild-verified parse the conditional-formatting dialog reopens with,
 * the ranking order, per-group caps, and the no-logical-NOT teaching note.
 */

import { describe, it, expect } from 'vitest';
import type { MockField, SPElement } from '../core/types';
import { rulesToStyle } from './condRules';
import {
  indexElements, indexColumns, indexInsertables, indexReference,
  runSearch, teachingNote, GROUP_ORDER, GROUP_LABELS,
  type SearchEntry,
} from './search';

// ─── document index ──────────────────────────────────────────────────────────

const doc: SPElement = {
  elmType: 'div',
  _elmName: 'Card',
  style: {
    'background-color': '#ff0000',
    'color': "=if([$Status] == 'Done', '#107c10', '#a80000')",
  },
  children: [
    { elmType: 'span', _elmName: 'Title text', txtContent: '[$Title]' },
    {
      elmType: 'button',
      customCardProps: {
        formatter: { elmType: 'div', children: [{ elmType: 'span', txtContent: '@currentField' }] },
      } as SPElement['customCardProps'],
    },
  ],
};

describe('indexElements', () => {
  const entries = indexElements(doc, { kind: 'floor' }, 'Grid');

  it('indexes every element with its name, path and where-it-lives trail', () => {
    const title = entries.find((e) => e.label === 'Title text');
    expect(title).toBeDefined();
    expect(title!.action).toEqual({ type: 'node', surface: { kind: 'floor' }, path: [0] });
    expect(title!.trail).toBe('Grid → Card');
  });

  it('emits a separate entry per formula, carrying its property for the fx bar', () => {
    const formula = entries.find((e) => e.icon === 'ƒ');
    expect(formula).toBeDefined();
    expect(formula!.label).toContain("if([$Status]");
    expect(formula!.action).toMatchObject({ type: 'node', path: [], prop: 'color' });
    // the plain style value is NOT a formula entry, but is searchable on the element
    const card = entries.find((e) => e.label === 'Card');
    expect(card!.text).toContain('#ff0000');
  });

  it('descends into hover cards via the CARD_SEGMENT (-1) path convention', () => {
    const inCard = entries.find((e) => e.text.includes('@currentfield'));
    expect(inCard).toBeDefined();
    expect((inCard!.action as { path: number[] }).path).toEqual([1, -1, 0]);
    expect(inCard!.trail).toContain('hover card');
  });
});

// ─── columns & rules ─────────────────────────────────────────────────────────

const status: MockField = { name: 'Status', displayName: 'Status', type: 'choice', choices: ['Done', 'Blocked'] };
const due: MockField = { name: 'DueDate', displayName: 'Due Date', type: 'date' };
const fields = [status, due];

describe('indexColumns', () => {
  // a REAL generated style — the rules index must round-trip through the same
  // parse-back contract condRules.test.ts pins for the dialog. Looks live in
  // explicit-[$Field] dialect, but the rules parse only reads the style.
  const gen = rulesToStyle(status, [
    { cond: { kind: 'eq', value: 'Done' }, effect: 'pill', color: 'green' },
    { cond: { kind: 'eq', value: 'Blocked' }, effect: 'pill', color: 'red' },
  ]);
  const columnLooks: Record<string, SPElement> = {
    Status: { elmType: 'div', txtContent: '[$Status]', style: gen.style },
  };
  const entries = indexColumns(fields, columnLooks);

  it('lists every schema column, saying whether it wears a look and how many rules it has', () => {
    const col = entries.find((e) => e.icon === '▦' && e.label === 'Status');
    expect(col!.trail).toContain('formatted');
    expect(col!.trail).toContain('2 rules');
    const plain = entries.find((e) => e.icon === '▦' && e.label === 'Due Date');
    expect(plain!.trail).toBe('date');
  });

  it('lists each conditional rule in plain language, targeting the rules dialog', () => {
    const labels = entries.filter((e) => e.icon === '⚑').map((e) => e.label);
    expect(labels).toEqual(['Status is Done', 'Status is Blocked']);
    for (const e of entries.filter((x) => x.icon === '⚑')) {
      expect(e.action).toEqual({ type: 'rules', fieldName: 'Status' });
    }
  });

  it('never guesses rules from a hand-edited formula (the parse refuses)', () => {
    const foreign: Record<string, SPElement> = {
      Status: { elmType: 'div', style: { color: "=if([$Status] == 'Done', 'red', 'blue')" } },
    };
    const rules = indexColumns(fields, foreign).filter((e) => e.icon === '⚑');
    expect(rules).toEqual([]);
  });
});

// ─── insertables & reference ─────────────────────────────────────────────────

describe('indexInsertables', () => {
  const entries = indexInsertables(
    [{ id: 'pill', label: 'Status pill', description: 'Colored pill bound to a choice column', group: 'Text & Status' }],
    [{ label: 'Pill', hint: 'Rounded ends, snug padding', props: { 'border-radius': '12px' } }],
  );

  it('carries data-only actions — inserting is the UI button, never the entry', () => {
    expect(entries[0].action).toEqual({ type: 'preset', presetId: 'pill' });
    expect(entries[1].action).toEqual({ type: 'quicklook', label: 'Pill' });
  });

  it('makes quick-look style props searchable', () => {
    const [grouped] = runSearch(entries, '12px');
    expect(grouped.hits.map((h) => h.entry.label)).toContain('Pill');
  });
});

describe('indexReference', () => {
  const entries = indexReference();

  it('surfaces the schema function catalog with signature and example', () => {
    const fn = entries.find((e) => e.label === 'toLocaleDateString(date)');
    expect(fn).toBeDefined();
    expect(fn!.example).toBe('=toLocaleDateString(@now)');
    expect(fn!.action).toEqual({ type: 'reference', name: 'toLocaleDateString' });
  });

  it('surfaces context tokens with plain-language docs', () => {
    const me = entries.find((e) => e.label === '@me');
    expect(me).toBeDefined();
    expect(me!.detail).toContain('email');
  });
});

// ─── ranking & grouping ──────────────────────────────────────────────────────

const mk = (group: SearchEntry['group'], label: string, text = label.toLowerCase()): SearchEntry => ({
  group, icon: '▢', label, trail: '', text, action: { type: 'reference', name: label },
});

describe('runSearch', () => {
  it('ranks label prefix > label word-start > label substring > haystack-only', () => {
    const entries = [
      mk('document', 'A pillow case'),          // word-start
      mk('document', 'Pill'),                    // prefix
      mk('document', 'Caterpillar'),             // substring
      mk('document', 'Badge', 'badge pill look'), // text only
    ];
    const [grouped] = runSearch(entries, 'pill');
    expect(grouped.hits.map((h) => h.entry.label))
      .toEqual(['Pill', 'A pillow case', 'Caterpillar', 'Badge']);
  });

  it('reports match ranges on the label for highlighting', () => {
    const [grouped] = runSearch([mk('insert', 'Status pill')], 'status');
    expect(grouped.hits[0].ranges).toEqual([[0, 6]]);
  });

  it('groups in fixed bucket order, drops empty buckets, caps each bucket', () => {
    const entries: SearchEntry[] = [
      ...Array.from({ length: 12 }, (_, i) => mk('reference', `pillFn${i}`)),
      mk('document', 'pill element'),
    ];
    const grouped = runSearch(entries, 'pill');
    expect(grouped.map((g) => g.group)).toEqual(['document', 'reference']);
    expect(grouped[1].hits).toHaveLength(8);
    expect(GROUP_ORDER.every((g) => g in GROUP_LABELS)).toBe(true);
  });

  it('returns nothing for an empty query (the recents/starter view is the UI)', () => {
    expect(runSearch([mk('document', 'Pill')], '  ')).toEqual([]);
  });
});

// ─── teaching ────────────────────────────────────────────────────────────────

describe('teachingNote', () => {
  it('teaches the no-logical-NOT truth instead of a bare no-results', () => {
    for (const q of ['not(', 'NOT', '!contains', '!']) {
      const note = teachingNote(q);
      expect(note, q).toBeTruthy();
      expect(note!).toContain('!=');
      expect(note!).toContain('no logical NOT');
    }
  });

  it('stays quiet for ordinary queries — != included', () => {
    expect(teachingNote('status')).toBeNull();
    expect(teachingNote('!=')).toBeNull();
    expect(teachingNote('cannot')).toBeNull();
  });
});
