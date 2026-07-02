/**
 * The stress-test variant catalog contract: variants honor the live-verified
 * blank-value semantics (HANDOFF §3 — blank dates are null, blank
 * multi-values are empty arrays), adapt to the schema, mine the formatter's
 * own comparison thresholds, and never mutate their inputs.
 */
import { describe, it, expect } from 'vitest';
import { buildStressVariants, collectNumericThresholds, emptyValue } from './stressTest';
import type { MockField, SPElement } from './types';

const FIELDS: MockField[] = [
  { name: 'ID', type: 'number', protected: true },
  { name: 'Title', type: 'text' },
  { name: 'Notes', type: 'note' },
  { name: 'Status', type: 'choice', choices: ['New', 'Waiting on somebody else', 'Done'] },
  { name: 'Tags', type: 'choiceMulti', choices: ['Red', 'Green', 'Blue'] },
  { name: 'DueDate', type: 'date' },
  { name: 'Progress', type: 'number' },
  { name: 'Budget', type: 'currency' },
  { name: 'Owner', type: 'person' },
  { name: 'Team', type: 'personMulti' },
  { name: 'Done', type: 'boolean' },
  { name: 'Link', type: 'hyperlink' },
  { name: 'Project', type: 'lookup', lookup: { list: 'Projects', column: 'Title' } },
  { name: 'Related', type: 'lookupMulti', lookup: { list: 'Projects', column: 'Title' } },
];

const NOW = new Date('2026-07-01T12:00:00Z');

function variant(id: string, fields = FIELDS, mineTrees: SPElement[] = []) {
  return buildStressVariants(fields, { now: NOW, mineTrees }).find((v) => v.id === id);
}

describe('emptyValue — the verified blank semantics', () => {
  it('blank dates are null, never empty text (HANDOFF §3)', () => {
    expect(emptyValue({ name: 'D', type: 'date' })).toBeNull();
  });
  it('blank multi-values are empty arrays; yes/no has no blank', () => {
    expect(emptyValue({ name: 'P', type: 'personMulti' })).toEqual([]);
    expect(emptyValue({ name: 'L', type: 'lookupMulti' })).toEqual([]);
    expect(emptyValue({ name: 'B', type: 'boolean' })).toBe(false);
    expect(emptyValue({ name: 'T', type: 'text' })).toBe('');
  });
});

describe('empty-state variant', () => {
  it('blanks every non-protected field with the correct representation', () => {
    const row = variant('empty')!.rows[0].row;
    expect(row.DueDate).toBeNull();
    expect(row.Team).toEqual([]);
    expect(row.Title).toBe('');
    expect(row.Done).toBe(false);
    expect(typeof row.ID).toBe('number'); // protected — a real item always has one
  });
});

describe('the Novel', () => {
  it('stretches text far past demo length, including one unbreakable token', () => {
    const rows = variant('novel')!.rows;
    expect(rows).toHaveLength(2);
    expect(String(rows[0].row.Title).length).toBeGreaterThan(120);
    expect(String(rows[1].row.Title)).not.toMatch(/\s/); // the unbroken token
  });
  it('choice fields stay on REAL options — the longest configured one', () => {
    for (const r of variant('novel')!.rows) {
      expect(r.row.Status).toBe('Waiting on somebody else');
    }
  });
});

describe('the Time Traveler', () => {
  it('covers past, today, future and blank — and blank is null, not a fake string', () => {
    const rows = variant('time')!.rows;
    const values = rows.map((r) => r.row.DueDate);
    expect(values).toContain('1900-01-01');
    expect(values).toContain('2099-12-31');
    expect(values).toContain('2026-07-01'); // "today" from the injected clock
    expect(values).toContain(null);
    // a real SP Date column cannot hold an invalid string — none are generated
    for (const v of values) {
      if (typeof v === 'string') expect(Number.isNaN(new Date(v).getTime())).toBe(false);
    }
  });
  it('is omitted entirely when the schema has no date fields', () => {
    const noDates = FIELDS.filter((f) => f.type !== 'date');
    expect(variant('time', noDates)).toBeUndefined();
  });
});

describe('boundary numbers + threshold mining', () => {
  const TREES: SPElement[] = [
    {
      elmType: 'div',
      style: { 'background-color': "=if([$Progress]>=100,'#107c10','#0078d4')" },
      children: [{
        elmType: 'span',
        // the legacy object/AST syntax community samples use
        txtContent: { operator: '?', operands: [{ operator: '<=', operands: ['@currentField', 70] }, 'low', 'high'] },
      }],
    },
  ];

  it('collects thresholds from both expression dialects, sorted and deduped', () => {
    expect(collectNumericThresholds(TREES)).toEqual([70, 100]);
  });

  it('probes exactly-at and just-under every mined threshold', () => {
    const rows = variant('numbers', FIELDS, TREES)!.rows;
    const values = rows.map((r) => r.row.Progress);
    for (const expected of [0, -42, 0.5, 70, 69, 100, 99]) {
      expect(values).toContain(expected);
    }
    expect(rows.some((r) => /threshold/i.test(r.label))).toBe(true);
  });

  it('still ships the universal probes with nothing to mine', () => {
    const values = variant('numbers')!.rows.map((r) => r.row.Budget);
    expect(values).toContain(0);
    expect(values).toContain(-42);
    expect(values).toContain(9_999_999_999);
  });
});

describe('multi-value extremes', () => {
  it('crowds every multi field to its real maximum, then empties them', () => {
    const rows = variant('multi')!.rows;
    expect((rows[0].row.Team as unknown[]).length).toBe(8);
    // a multi-choice can't repeat an option — crowded = ALL configured choices
    expect(String(rows[0].row.Tags).split(';#')).toEqual(['Red', 'Green', 'Blue']);
    expect(rows[1].row.Team).toEqual([]);
    expect(rows[1].row.Related).toEqual([]);
  });
});

describe('unicode / RTL / emoji', () => {
  it('ships an accents+emoji row and a right-to-left row', () => {
    const rows = variant('unicode')!.rows;
    expect(rows.some((r) => /🚀/.test(String(r.row.Title)))).toBe(true);
    expect(rows.some((r) => /[֐-ࣿ]/.test(String(r.row.Title)))).toBe(true);
  });
});

describe('read-only guarantees', () => {
  it('never mutates the fields it is given', () => {
    const before = JSON.stringify(FIELDS);
    buildStressVariants(FIELDS, { now: NOW });
    expect(JSON.stringify(FIELDS)).toBe(before);
  });

  it('every generated row carries a value for every field (refs always resolve)', () => {
    for (const v of buildStressVariants(FIELDS, { now: NOW })) {
      for (const { row } of v.rows) {
        for (const f of FIELDS) expect(f.name in row).toBe(true);
      }
    }
  });

  it('is deterministic for a fixed clock', () => {
    const a = buildStressVariants(FIELDS, { now: NOW });
    const b = buildStressVariants(FIELDS, { now: NOW });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
