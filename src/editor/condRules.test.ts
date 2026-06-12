import { describe, it, expect } from 'vitest';
import { evaluate, type EvalContext } from '../core/expressions';
import {
  condExpr, condLabel, conditionOptionsFor, rulesToStyle, suggestChoiceColors,
  escapeCondValue, condColor,
} from './condRules';
import type { MockField, MockRow } from '../core/types';

const FIELDS: Record<string, MockField> = {
  Status: { name: 'Status', type: 'choice', choices: ['Not started', 'In Progress', 'Blocked', 'Done'] },
  DueDate: { name: 'DueDate', type: 'date' },
  Progress: { name: 'Progress', type: 'number' },
  Owner: { name: 'Owner', type: 'person' },
  AssignedTo: { name: 'AssignedTo', type: 'personMulti' },
  Title: { name: 'Title', type: 'text' },
  Approved: { name: 'Approved', type: 'boolean' },
  Project: { name: 'Project', type: 'lookup', lookup: { list: 'Projects', column: 'Title' } },
};

const ctx = (row: MockRow): EvalContext => ({
  row,
  rowIndex: 0,
  currentFieldName: 'Status',
  me: { title: 'Me', email: 'me@contoso.com' },
  iterators: {},
  iteratorIndex: {},
  displayNames: {},
  now: new Date(),
});

const test = (field: MockField, cond: Parameters<typeof condExpr>[1], row: MockRow): boolean =>
  evaluate(`=${condExpr(field, cond)}`, ctx(row)) === true;

const days = (n: number): string => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

describe('condExpr — generated conditions evaluate correctly through the engine', () => {
  it('choice equality', () => {
    expect(test(FIELDS.Status, { kind: 'eq', value: 'Blocked' }, { Status: 'Blocked' })).toBe(true);
    expect(test(FIELDS.Status, { kind: 'eq', value: 'Blocked' }, { Status: 'Done' })).toBe(false);
  });

  it('overdue is FALSE for empty dates (null would coerce to the 1970 epoch unguarded)', () => {
    expect(test(FIELDS.DueDate, { kind: 'overdue' }, { DueDate: days(-3) })).toBe(true);
    expect(test(FIELDS.DueDate, { kind: 'overdue' }, { DueDate: days(3) })).toBe(false);
    expect(test(FIELDS.DueDate, { kind: 'overdue' }, { DueDate: null })).toBe(false);
    expect(test(FIELDS.DueDate, { kind: 'overdue' }, {})).toBe(false);
  });

  it('empty date detected via toString (null == "" is FALSE per live-verified SP)', () => {
    expect(test(FIELDS.DueDate, { kind: 'empty' }, { DueDate: null })).toBe(true);
    expect(test(FIELDS.DueDate, { kind: 'empty' }, { DueDate: days(1) })).toBe(false);
  });

  it('within the next N days excludes the past, the far future and blanks', () => {
    const soon = { kind: 'soon' as const, days: 7 };
    expect(test(FIELDS.DueDate, soon, { DueDate: days(3) })).toBe(true);
    expect(test(FIELDS.DueDate, soon, { DueDate: days(-1) })).toBe(false);
    expect(test(FIELDS.DueDate, soon, { DueDate: days(30) })).toBe(false);
    expect(test(FIELDS.DueDate, soon, { DueDate: null })).toBe(false);
  });

  it('number thresholds treat empty cells as no-match', () => {
    expect(test(FIELDS.Progress, { kind: 'gte', value: '100' }, { Progress: 100 })).toBe(true);
    expect(test(FIELDS.Progress, { kind: 'gte', value: '100' }, { Progress: 64 })).toBe(false);
    expect(test(FIELDS.Progress, { kind: 'gte', value: '100' }, { Progress: '' })).toBe(false);
    expect(test(FIELDS.Progress, { kind: 'lt', value: '50' }, { Progress: 20 })).toBe(true);
    expect(test(FIELDS.Progress, { kind: 'lt', value: '50' }, { Progress: '' })).toBe(false);
  });

  it('person is-me, single and multi', () => {
    const me = { title: 'Me', email: 'me@contoso.com' };
    const other = { title: 'Ada', email: 'ada@contoso.com' };
    expect(test(FIELDS.Owner, { kind: 'isMe' }, { Owner: me })).toBe(true);
    expect(test(FIELDS.Owner, { kind: 'isMe' }, { Owner: other })).toBe(false);
    expect(test(FIELDS.AssignedTo, { kind: 'isMe' }, { AssignedTo: [other, me] })).toBe(true);
    expect(test(FIELDS.AssignedTo, { kind: 'isMe' }, { AssignedTo: [other] })).toBe(false);
    expect(test(FIELDS.AssignedTo, { kind: 'empty' }, { AssignedTo: [] })).toBe(true);
  });

  it('text contains is case-insensitive; quotes are stripped, not escaped', () => {
    expect(test(FIELDS.Title, { kind: 'contains', value: 'URGENT' }, { Title: 'urgent: fix' })).toBe(true);
    expect(test(FIELDS.Title, { kind: 'contains', value: 'urgent' }, { Title: 'Routine' })).toBe(false);
    expect(escapeCondValue("O'Brien \"x\"")).toBe('OBrien x');
    expect(condExpr(FIELDS.Title, { kind: 'eq', value: "a'b" })).not.toContain("a'b");
  });

  it('boolean and lookup', () => {
    expect(test(FIELDS.Approved, { kind: 'isTrue' }, { Approved: true })).toBe(true);
    expect(test(FIELDS.Approved, { kind: 'isFalse' }, { Approved: false })).toBe(true);
    expect(test(FIELDS.Approved, { kind: 'isTrue' }, { Approved: false })).toBe(false);
    const apollo = { lookupId: 3, lookupValue: 'Apollo' };
    expect(test(FIELDS.Project, { kind: 'eq', value: 'Apollo' }, { Project: apollo })).toBe(true);
    expect(test(FIELDS.Project, { kind: 'empty' }, { Project: null })).toBe(true);
    expect(test(FIELDS.Project, { kind: 'empty' }, { Project: apollo })).toBe(false);
  });
});

describe('condition catalog', () => {
  it('choice fields get one ready chip per choice with smart colors', () => {
    const opts = conditionOptionsFor(FIELDS.Status);
    expect(opts.map((o) => o.value).slice(0, 4)).toEqual(FIELDS.Status.choices);
    const byValue = new Map(opts.map((o) => [o.value, o.suggestColor]));
    expect(byValue.get('Done')).toBe('green');
    expect(byValue.get('Blocked')).toBe('red');
    expect(byValue.get('In Progress')).toBe('blue');
    expect(byValue.get('Not started')).toBe('gray');
  });

  it('keyword mapping rotates through the palette for unrecognized choices', () => {
    const m = suggestChoiceColors(['Alpha', 'Beta', 'Shipped']);
    expect(m.get('Shipped')).toBe('green');
    expect(m.get('Alpha')).not.toBe(m.get('Beta'));
  });

  it('labels read like sentences', () => {
    expect(condLabel(FIELDS.Status, { kind: 'eq', value: 'Done' })).toBe('Status is Done');
    expect(condLabel(FIELDS.DueDate, { kind: 'overdue' })).toBe('DueDate is overdue');
    expect(condLabel(FIELDS.AssignedTo, { kind: 'empty' })).toBe('AssignedTo is unassigned');
  });
});

describe('rulesToStyle — compiled chains', () => {
  const rules = [
    { cond: { kind: 'eq' as const, value: 'Blocked' }, effect: 'pill' as const, color: 'red' },
    { cond: { kind: 'eq' as const, value: 'Done' }, effect: 'pill' as const, color: 'green' },
  ];

  it('first matching rule wins and the else branch is empty by default', () => {
    const { style } = rulesToStyle(FIELDS.Status, rules);
    const bg = (row: MockRow): unknown => evaluate(style['background-color'], ctx(row));
    expect(bg({ Status: 'Blocked' })).toBe(condColor('red').strong);
    expect(bg({ Status: 'Done' })).toBe(condColor('green').strong);
    expect(bg({ Status: 'Not started' })).toBe('');
    // pill scaffolding is unconditional
    expect(style['border-radius']).toBe('12px');
    expect(style['display']).toBe('inline-flex');
  });

  it('an existing plain value becomes the no-match fallback; formulas are flagged', () => {
    const existing = { 'background-color': '#eeeeee', 'color': "=if([$Status]=='Done','#fff','')" };
    const { style, replacedFormulas } = rulesToStyle(FIELDS.Status, rules, existing);
    expect(evaluate(style['background-color'], ctx({ Status: 'Other' }))).toBe('#eeeeee');
    expect(replacedFormulas).toEqual(['color']);
  });

  it('mixed effects: a rule that does not manage a property blanks it when it matches first', () => {
    const mixed = [
      { cond: { kind: 'eq' as const, value: 'Blocked' }, effect: 'stripe' as const, color: 'red' },
      { cond: { kind: 'notEmpty' as const }, effect: 'text' as const, color: 'blue' },
    ];
    const { style } = rulesToStyle(FIELDS.Status, mixed);
    // Blocked matches rule 1 (stripe) — rule 2's text color must NOT bleed in
    expect(evaluate(style['color'], ctx({ Status: 'Blocked' }))).toBe('');
    expect(evaluate(style['color'], ctx({ Status: 'Done' }))).toBe(condColor('blue').strong);
    expect(evaluate(style['border-left'], ctx({ Status: 'Blocked' }))).toContain(condColor('red').strong);
  });
});
