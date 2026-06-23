import { describe, it, expect } from 'vitest';
import { fxSuggestions } from './fxSuggest';
import { slotsFor } from './fxSlots';
import { excelToSp } from './dialect';
import type { MockField } from '../core/types';

const FIELDS: MockField[] = [
  { name: 'Title', displayName: 'Task name', type: 'text' },
  { name: 'Status', type: 'choice', choices: ['Not started', 'In Progress', 'Blocked', 'Done'] },
  { name: 'DueDate', displayName: 'Due date', type: 'date' },
  { name: 'Progress', displayName: 'Percent done', type: 'number' },
  { name: 'Approved', displayName: 'Approved?', type: 'boolean' },
];

const slot = (id: string) => {
  const s = slotsFor({ elmType: 'div', style: { 'border-radius': '4px' } }).find((x) => x.id === id);
  if (!s) throw new Error(`no slot ${id}`);
  return s;
};

describe('fxSuggestions — type-aware per slot', () => {
  it('colour slots offer the palette and a colour-by-condition template', () => {
    const s = fxSuggestions(slot('fill'), FIELDS);
    expect(s).toEqual(expect.arrayContaining(['#107c10'])); // palette
    expect(s.some((x) => x.startsWith('=IF([Status]'))).toBe(true); // choice template
    expect(s.some((x) => x.includes('TODAY()'))).toBe(true); // date overdue
  });

  it('the text slot offers field references (transpilable) and display templates', () => {
    const s = fxSuggestions(slot('text'), FIELDS);
    expect(s).toEqual(expect.arrayContaining(['=[Task name]', '=[Due date]']));
    expect(s.some((x) => x.includes('&'))).toBe(true); // concat template
  });

  it('the weight slot offers weight idioms', () => {
    const s = fxSuggestions(slot('weight'), FIELDS);
    expect(s).toEqual(expect.arrayContaining(['bold', '600', '700']));
  });

  it('a border slot offers border idioms', () => {
    const s = fxSuggestions(slot('leftBorder'), FIELDS);
    expect(s.some((x) => /solid/.test(x))).toBe(true);
  });

  it('pulls in the style playground value vocabulary for a slot', () => {
    // text-align values come straight from STYLE_VALUE_SUGGESTIONS
    expect(fxSuggestions(slot('align'), FIELDS)).toEqual(expect.arrayContaining(['left', 'center', 'right']));
    // corner radius likewise
    expect(fxSuggestions(slot('radius'), FIELDS)).toEqual(expect.arrayContaining(['2px', '50%']));
  });

  it('attribute slots suggest column references to bind to', () => {
    const src = slotsFor({ elmType: 'img' }).find((x) => x.id === 'src')!;
    expect(fxSuggestions(src, FIELDS)).toEqual(expect.arrayContaining(['=[Task name]']));
  });

  it('the Icon slot offers known Fluent icon names (literals, no transpile)', () => {
    const icon = slotsFor({ elmType: 'span', attributes: { iconName: 'CheckMark' } })
      .find((x) => x.id === 'attr:iconName')!;
    const s = fxSuggestions(icon, FIELDS);
    expect(s).toEqual(expect.arrayContaining(['CheckMark', 'Flag']));
    expect(s.every((x) => !x.startsWith('='))).toBe(true); // applied as-is
  });

  it('degrades gracefully with no schema', () => {
    const s = fxSuggestions(slot('fill'), []);
    expect(s).toEqual(expect.arrayContaining(['#107c10'])); // still offers the palette
    expect(s.every((x) => !x.includes('[]'))).toBe(true);
  });

  it('skips choice values that contain quotes (SP strings have no escape)', () => {
    const tricky: MockField[] = [{ name: 'Stage', type: 'choice', choices: ["Bob's turn", 'Ready'] }];
    const s = fxSuggestions(slot('fill'), tricky);
    expect(s.some((x) => x.includes("Bob's"))).toBe(false);
    // 'Ready' is clean and should be used
    expect(s.some((x) => x.includes('"Ready"'))).toBe(true);
  });
});

describe('fxSuggestions — subtype vocab (US-8)', () => {
  const current = FIELDS.find((f) => f.name === 'Status')!; // pretend Status is the @currentField column

  it('a non-empty vocab offers ONLY the vocab refs and suppresses the broad ...refs padding', () => {
    const s = fxSuggestions(slot('text'), FIELDS, { current, vocab: { refs: ['@currentField'], values: [] } });
    expect(s).toContain('=[Status]');           // @currentField → the current column's ref
    expect(s).not.toContain('=[Task name]');    // an unrelated column's bare ref is suppressed
    expect(s).not.toContain('=[Due date]');
    expect(s).not.toContain('=[Percent done]');
  });

  it('maps [$Field] vocab refs to that column and drops unknown tokens', () => {
    const s = fxSuggestions(slot('text'), FIELDS, { current, vocab: { refs: ['[$DueDate]', '[$Ghost]'], values: [] } });
    expect(s).toContain('=[Due date]');         // DueDate → its display-name ref
    expect(s.some((x) => x.includes('Ghost'))).toBe(false); // a ref to a missing column is dropped
  });

  it('preserves the .prop tail and maps the [!Field] form (all round-trippable)', () => {
    const flds: MockField[] = [...FIELDS, { name: 'Owner', type: 'person' }];
    const owner = flds.find((f) => f.name === 'Owner')!;
    const s = fxSuggestions(slot('text'), flds, {
      current: owner,
      vocab: { refs: ['[$Owner.title]', '[!Status]', '@currentField.email'], values: [] },
    });
    expect(s).toContain('=[Owner.title]');  // dotted [$Field.prop] keeps its prop
    expect(s).toContain('=[Status]');       // the [!Field] form maps too
    expect(s).toContain('=[Owner.email]');  // @currentField.prop → the current column + prop
    for (const sug of s) if (sug.startsWith('=')) expect(excelToSp(sug, flds).ok, `refused: ${sug}`).toBe(true);
  });

  it('a non-empty vocab replaces the value padding on a style slot', () => {
    const s = fxSuggestions(slot('weight'), FIELDS, { current, vocab: { refs: [], values: ['Done', 'Blocked'] } });
    expect(s).toEqual(expect.arrayContaining(['Done', 'Blocked'])); // the vocab values
    expect(s).toContain('bold');                                    // the curated idioms stay
    expect(s).not.toContain('400');                                 // a broad playground value is suppressed
    expect(fxSuggestions(slot('weight'), FIELDS)).toContain('400'); // …which IS offered today (suppression is real)
  });

  it('an EMPTY vocab falls back to today\'s padding', () => {
    expect(fxSuggestions(slot('text'), FIELDS, { current, vocab: { refs: [], values: [] } }))
      .toEqual(fxSuggestions(slot('text'), FIELDS));
  });

  it('NO subtype behaves exactly as today (with or without a current field)', () => {
    expect(fxSuggestions(slot('text'), FIELDS, { current })).toEqual(fxSuggestions(slot('text'), FIELDS));
    expect(fxSuggestions(slot('fill'), FIELDS, {})).toEqual(fxSuggestions(slot('fill'), FIELDS));
    expect(fxSuggestions(slot('text'), FIELDS)).toEqual(fxSuggestions(slot('text'), FIELDS, undefined));
  });

  it('vocab ref suggestions still round-trip through the transpiler', () => {
    const s = fxSuggestions(slot('text'), FIELDS, { current, vocab: { refs: ['@currentField', '[$DueDate]'], values: [] } });
    for (const sug of s) {
      if (!sug.startsWith('=')) continue;
      expect(excelToSp(sug, FIELDS).ok, `refused: ${sug}`).toBe(true);
    }
  });
});

describe('every suggested formula round-trips through the transpiler (no refusals)', () => {
  it('holds for every slot of several element kinds', () => {
    const nodes = [
      { elmType: 'div' as const, style: { 'border-radius': '4px', width: '120px' } },
      { elmType: 'img' as const },
      { elmType: 'a' as const },
    ];
    for (const node of nodes) {
      for (const s of slotsFor(node)) {
        for (const sug of fxSuggestions(s, FIELDS)) {
          if (!sug.startsWith('=')) continue; // literals are stored as-is
          const r = excelToSp(sug, FIELDS);
          expect(r.ok, `refused: ${sug} (${r.ok ? '' : r.reason})`).toBe(true);
        }
      }
    }
  });
});
