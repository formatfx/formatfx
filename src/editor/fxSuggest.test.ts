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

  it('the text slot offers field references and display templates', () => {
    const s = fxSuggestions(slot('text'), FIELDS);
    expect(s).toEqual(expect.arrayContaining(['[Task name]', '[Due date]']));
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

describe('every suggested formula round-trips through the transpiler (no refusals)', () => {
  it('holds for every slot of an element', () => {
    const node = { elmType: 'div' as const, style: { 'border-radius': '4px', width: '120px' } };
    for (const s of slotsFor(node)) {
      for (const sug of fxSuggestions(s, FIELDS)) {
        if (!sug.startsWith('=')) continue; // literals are stored as-is
        const r = excelToSp(sug, FIELDS);
        expect(r.ok, `refused: ${sug} (${r.ok ? '' : r.reason})`).toBe(true);
      }
    }
  });
});
