import { describe, it, expect } from 'vitest';
import { evaluate, type EvalContext } from '../core/expressions';
import { lintDocument, stripExpressionWhitespace } from '../core/linter';
import {
  condExpr, condLabel, conditionOptionsFor, rulesToStyle, suggestChoiceColors,
  escapeCondValue, condColor, parseRulesFromStyle, type CondRule,
  mapOperatorsFor, mapRulesToExpr, parseMapFromExpr,
  type Condition, type CondKind, type MapRule,
} from './condRules';
import type { FormatterDocument, MockField, MockRow } from '../core/types';

const FIELDS: Record<string, MockField> = {
  Status: { name: 'Status', type: 'choice', choices: ['Not started', 'In Progress', 'Blocked', 'Done'] },
  DueDate: { name: 'DueDate', type: 'date' },
  Progress: { name: 'Progress', type: 'number' },
  Owner: { name: 'Owner', type: 'person' },
  AssignedTo: { name: 'AssignedTo', type: 'personMulti' },
  Title: { name: 'Title', type: 'text' },
  Approved: { name: 'Approved', type: 'boolean' },
  Project: { name: 'Project', type: 'lookup', lookup: { list: 'Projects', column: 'Title' } },
  Tags: { name: 'Tags', type: 'choiceMulti', choices: ['web', 'ops', 'intranet'] },
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

  it('overdue never matches a blank date', () => {
    expect(test(FIELDS.DueDate, { kind: 'overdue' }, { DueDate: days(-3) })).toBe(true);
    expect(test(FIELDS.DueDate, { kind: 'overdue' }, { DueDate: days(3) })).toBe(false);
    expect(test(FIELDS.DueDate, { kind: 'overdue' }, { DueDate: null })).toBe(false);
    expect(test(FIELDS.DueDate, { kind: 'overdue' }, {})).toBe(false);
  });

  it('blank dates are detected reliably', () => {
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

// ─── parse-back: rules → style → rules (§6 1.7's "obvious next step") ────────
// The builder is no longer a one-way generator: chains it generated parse
// back into editable rules, gated by REBUILDING the style and requiring
// byte-identical chains — a lossy reopen is structurally impossible.

describe('parseRulesFromStyle — the round trip', () => {
  const ALL_FIELDS = Object.values(FIELDS);

  const roundTrips = (field: MockField, rules: CondRule[], existing?: Record<string, string>): void => {
    const gen = rulesToStyle(field, rules, existing);
    const parsed = parseRulesFromStyle(gen.style, ALL_FIELDS);
    expect(parsed).not.toBeNull();
    expect(parsed!.fieldName).toBe(field.name);
    expect(parsed!.rules).toEqual(rules);
    // regenerating from the parse reproduces the chains byte-for-byte
    const regen = rulesToStyle(field, parsed!.rules, existing);
    expect(regen.style).toEqual(gen.style);
  };

  it('round-trips every condition kind the builder can produce', () => {
    roundTrips(FIELDS.Status, [{ cond: { kind: 'eq', value: 'Blocked' }, effect: 'pill', color: 'red' }]);
    roundTrips(FIELDS.Title, [{ cond: { kind: 'contains', value: 'urgent' }, effect: 'text', color: 'amber' }]);
    roundTrips(FIELDS.Title, [{ cond: { kind: 'notEmpty' }, effect: 'text', color: 'green' }]);
    roundTrips(FIELDS.DueDate, [
      { cond: { kind: 'overdue' }, effect: 'fill', color: 'red' },
      { cond: { kind: 'today' }, effect: 'fill', color: 'blue' },
      { cond: { kind: 'soon', days: 14 }, effect: 'fill', color: 'amber' },
      { cond: { kind: 'empty' }, effect: 'text', color: 'gray' },
    ]);
    roundTrips(FIELDS.Progress, [
      { cond: { kind: 'gte', value: '100' }, effect: 'pill', color: 'green' },
      { cond: { kind: 'lt', value: '25' }, effect: 'stripe', color: 'red' },
    ]);
    roundTrips(FIELDS.Owner, [{ cond: { kind: 'isMe' }, effect: 'fill', color: 'blue' }]);
    roundTrips(FIELDS.AssignedTo, [{ cond: { kind: 'isMe' }, effect: 'text', color: 'blue' }]);
    roundTrips(FIELDS.AssignedTo, [{ cond: { kind: 'empty' }, effect: 'strike', color: 'gray' }]);
    roundTrips(FIELDS.Approved, [
      { cond: { kind: 'isTrue' }, effect: 'pill', color: 'green' },
      { cond: { kind: 'isFalse' }, effect: 'text', color: 'gray' },
    ]);
    roundTrips(FIELDS.Project, [{ cond: { kind: 'eq', value: 'Apollo' }, effect: 'fill', color: 'teal' }]);
  });

  it('round-trips mixed effects across rules (per-property chains share one condition spine)', () => {
    roundTrips(FIELDS.Status, [
      { cond: { kind: 'eq', value: 'Done' }, effect: 'strike', color: 'green' },
      { cond: { kind: 'eq', value: 'Blocked' }, effect: 'pill', color: 'red' },
      { cond: { kind: 'empty' }, effect: 'text', color: 'gray' },
    ]);
  });

  it('recovers the plain-value fallbacks an existing style contributed', () => {
    const existing = { 'color': '#333333', 'font-weight': '400' };
    const gen = rulesToStyle(FIELDS.Status, [{ cond: { kind: 'eq', value: 'Done' }, effect: 'text', color: 'green' }], existing);
    const parsed = parseRulesFromStyle(gen.style, ALL_FIELDS)!;
    expect(parsed.fallbacks['color']).toBe('#333333');
    expect(parsed.fallbacks['font-weight']).toBe('400');
  });

  it('recovers the WATCHED field even when it differs from the painted column', () => {
    // "color DueDate by Status" — the chains test [$Status]
    const gen = rulesToStyle(FIELDS.Status, [{ cond: { kind: 'eq', value: 'Blocked' }, effect: 'fill', color: 'red' }]);
    expect(parseRulesFromStyle(gen.style, ALL_FIELDS)!.fieldName).toBe('Status');
  });

  it('ignores unmanaged properties sitting beside the chains', () => {
    const gen = rulesToStyle(FIELDS.Status, [{ cond: { kind: 'eq', value: 'Done' }, effect: 'pill', color: 'green' }]);
    const style = { ...gen.style, 'margin': '4px', 'width': '120px' };
    const parsed = parseRulesFromStyle(style, ALL_FIELDS);
    expect(parsed?.rules).toHaveLength(1);
  });

  it('REFUSES foreign formulas — refuse-and-teach, never a guessed rule', () => {
    // not an if-chain at all
    expect(parseRulesFromStyle({ 'color': "=if([$Status]" }, ALL_FIELDS)).toBeNull();
    expect(parseRulesFromStyle({ 'color': "='#'+substring([$Status],0,6)" }, ALL_FIELDS)).toBeNull();
    // a hand-written condition outside the builder's vocabulary
    expect(parseRulesFromStyle(
      { 'color': "=if([$Progress] > 10 && [$Progress] < 20, '#107c10', '')" }, ALL_FIELDS,
    )).toBeNull();
    // an unknown field name
    expect(parseRulesFromStyle(
      { 'color': "=if([$Ghost] == 'x', '#107c10', '')" }, ALL_FIELDS,
    )).toBeNull();
    // no chains at all
    expect(parseRulesFromStyle({ 'color': '#333333' }, ALL_FIELDS)).toBeNull();
    expect(parseRulesFromStyle(undefined, ALL_FIELDS)).toBeNull();
  });

  it('REFUSES a hand-edited chain value (a color outside the builder palette fails the rebuild gate)', () => {
    const gen = rulesToStyle(FIELDS.Status, [{ cond: { kind: 'eq', value: 'Done' }, effect: 'text', color: 'green' }]);
    const edited = { ...gen.style, 'color': gen.style['color'].replace('#107c10', '#123456') };
    expect(parseRulesFromStyle(edited, ALL_FIELDS)).toBeNull();
  });

  it('REFUSES chains whose condition spines disagree (one prop hand-reordered)', () => {
    const gen = rulesToStyle(FIELDS.Status, [
      { cond: { kind: 'eq', value: 'Done' }, effect: 'fill', color: 'green' },
      { cond: { kind: 'eq', value: 'Blocked' }, effect: 'fill', color: 'red' },
    ]);
    const style = { ...gen.style };
    // swap the two conditions in ONE property's chain only
    style['color'] = style['color']
      .replace("[$Status] == 'Done'", '§TMP§')
      .replace("[$Status] == 'Blocked'", "[$Status] == 'Done'")
      .replace('§TMP§', "[$Status] == 'Blocked'");
    expect(parseRulesFromStyle(style, ALL_FIELDS)).toBeNull();
  });
});

// ─── the Map Data property mapper (#217) ─────────────────────────────────────
// One PROPERTY, one `=if()` chain: visual IF / ELSE-IF / ELSE rows compile
// through the SAME condExpr vocabulary as the ✨ builder (no parallel
// codegen), and parse back under the same rebuild-verify discipline —
// byte-identical regeneration or refuse. Unlike rulesToStyle (one watched
// field fanned across effect properties), a map's rows may each watch a
// DIFFERENT column.

// the linter's own standalone-'!' shape: '!=' stays legal, '!('/'![$'/'!@' never
const STANDALONE_BANG = /!(?=\s*[([@])/;

describe('neq — not-equals (no logical NOT exists: != is the only negation)', () => {
  it('evaluates per type through the engine', () => {
    expect(test(FIELDS.Status, { kind: 'neq', value: 'Done' }, { Status: 'Blocked' })).toBe(true);
    expect(test(FIELDS.Status, { kind: 'neq', value: 'Done' }, { Status: 'Done' })).toBe(false);
    expect(test(FIELDS.Title, { kind: 'neq', value: 'x' }, { Title: 'y' })).toBe(true);
    // multi-choice: "does not include" — indexOf == -1, never a '!'
    // (mock rows carry multi-choice as the ';'-joined string, like the showcase)
    expect(test(FIELDS.Tags, { kind: 'neq', value: 'web' }, { Tags: 'ops' })).toBe(true);
    expect(test(FIELDS.Tags, { kind: 'neq', value: 'web' }, { Tags: 'web;ops' })).toBe(false);
    const apollo = { lookupId: 3, lookupValue: 'Apollo' };
    expect(test(FIELDS.Project, { kind: 'neq', value: 'Apollo' }, { Project: apollo })).toBe(false);
    expect(test(FIELDS.Project, { kind: 'neq', value: 'Gemini' }, { Project: apollo })).toBe(true);
  });

  it('never emits a standalone "!" and strips quotes like eq does', () => {
    for (const f of [FIELDS.Status, FIELDS.Tags, FIELDS.Title, FIELDS.Project]) {
      expect(condExpr(f, { kind: 'neq', value: 'x' })).not.toMatch(STANDALONE_BANG);
    }
    expect(condExpr(FIELDS.Title, { kind: 'neq', value: "a'b" })).not.toContain("a'b");
  });

  it('labels read like sentences', () => {
    expect(condLabel(FIELDS.Status, { kind: 'neq', value: 'Done' })).toBe('Status is not Done');
  });
});

describe('mapOperatorsFor — type-honest operator menus', () => {
  const kinds = (f: MockField): CondKind[] => mapOperatorsFor(f).map((o) => o.kind);

  it('text gets equals / not-equals / contains, never number comparisons', () => {
    expect(kinds(FIELDS.Title)).toEqual(['eq', 'neq', 'contains', 'empty', 'notEmpty']);
  });

  it('numbers get the engine comparisons (at least / below), never contains', () => {
    expect(kinds(FIELDS.Progress)).toEqual(['gte', 'lt', 'empty', 'notEmpty']);
  });

  it('dates get the verified date semantics, not raw equality', () => {
    expect(kinds(FIELDS.DueDate)).toEqual(['overdue', 'today', 'soon', 'empty', 'notEmpty']);
  });

  it('booleans and people stay inside the engine vocabulary', () => {
    expect(kinds(FIELDS.Approved)).toEqual(['isTrue', 'isFalse']);
    expect(kinds(FIELDS.Owner)).toEqual(['isMe', 'empty', 'notEmpty']);
    expect(kinds(FIELDS.AssignedTo)).toEqual(['isMe', 'empty', 'notEmpty']);
  });

  it('every offered operator compiles and evaluates for its type (even on a blank row)', () => {
    for (const f of Object.values(FIELDS)) {
      for (const op of mapOperatorsFor(f)) {
        const cond: Condition = { kind: op.kind };
        if (op.needs === 'text') cond.value = 'x';
        if (op.needs === 'number') cond.value = '5';
        if (op.needs === 'days') cond.days = 7;
        expect(() => evaluate(`=${condExpr(f, cond)}`, ctx({}))).not.toThrow();
      }
    }
  });
});

describe('mapRulesToExpr — the builder compile', () => {
  const ALL = Object.values(FIELDS);

  it('IF / ELSE-IF / ELSE: first match wins, and rows may watch different columns', () => {
    const expr = mapRulesToExpr(ALL, [
      { fieldName: 'Status', cond: { kind: 'eq', value: 'Blocked' }, output: '#fde7e9' },
      { fieldName: 'Progress', cond: { kind: 'gte', value: '100' }, output: '#dff6dd' },
    ], '#f3f2f1')!;
    const bg = (row: MockRow): unknown => evaluate(expr, ctx(row));
    expect(bg({ Status: 'Blocked', Progress: 100 })).toBe('#fde7e9'); // first match wins
    expect(bg({ Status: 'Open', Progress: 100 })).toBe('#dff6dd');
    expect(bg({ Status: 'Open', Progress: 10 })).toBe('#f3f2f1');    // the ELSE row
  });

  it('quotes are stripped from outputs and the else (SP literals have no escape syntax)', () => {
    const expr = mapRulesToExpr(ALL, [
      { fieldName: 'Title', cond: { kind: 'eq', value: "O'Brien" }, output: "d'oh" },
    ], "els'e")!;
    expect(expr).not.toContain("O'Brien");
    expect(evaluate(expr, ctx({ Title: 'OBrien' }))).toBe('doh');
    expect(evaluate(expr, ctx({ Title: 'zzz' }))).toBe('else');
  });

  it('refuses an unknown column or an empty rule list — never a guessed chain', () => {
    expect(mapRulesToExpr(ALL, [{ fieldName: 'Ghost', cond: { kind: 'eq', value: 'x' }, output: 'a' }], '')).toBeNull();
    expect(mapRulesToExpr(ALL, [], 'x')).toBeNull();
  });

  it('never emits a standalone "!" across the whole operator catalog', () => {
    for (const f of ALL) {
      for (const op of mapOperatorsFor(f)) {
        const cond: Condition = { kind: op.kind };
        if (op.needs === 'text') cond.value = 'x';
        if (op.needs === 'number') cond.value = '5';
        if (op.needs === 'days') cond.days = 3;
        const expr = mapRulesToExpr(ALL, [{ fieldName: f.name, cond, output: 'out' }], 'fallback')!;
        expect(expr).not.toMatch(STANDALONE_BANG);
      }
    }
  });

  it('generated output lints clean and survives Sanitize (the export whitespace strip)', () => {
    const expr = mapRulesToExpr(ALL, [
      { fieldName: 'Status', cond: { kind: 'neq', value: 'Done' }, output: '#fde7e9' },
      { fieldName: 'DueDate', cond: { kind: 'soon', days: 7 }, output: '#fff4ce' },
    ], '#ffffff')!;
    const doc: FormatterDocument = {
      kind: 'row',
      root: { elmType: 'div', txtContent: expr, style: { 'background-color': expr } },
    };
    const issues = lintDocument(doc, ALL.map((f) => f.name), Object.fromEntries(ALL.map((f) => [f.name, f.type])));
    // info-grade zero-whitespace notes are expected (Sanitize strips the
    // spaces on export, same as every ✨-generated chain) — nothing above info
    expect(issues.filter((i) => i.severity !== 'info')).toEqual([]);
    expect(evaluate(stripExpressionWhitespace(expr), ctx({ Status: 'Done' }))).toBe('#ffffff');
  });
});

describe('parseMapFromExpr — the round trip', () => {
  const ALL = Object.values(FIELDS);

  const roundTrips = (rules: MapRule[], elseOutput = ''): void => {
    const expr = mapRulesToExpr(ALL, rules, elseOutput)!;
    const parsed = parseMapFromExpr(expr, ALL);
    expect(parsed).toEqual({ rules, elseOutput });
    // regenerating from the parse reproduces the chain byte-for-byte
    expect(mapRulesToExpr(ALL, parsed!.rules, parsed!.elseOutput)).toBe(expr);
  };

  it('round-trips every operator/type combo the builder can offer', () => {
    for (const f of ALL) {
      for (const op of mapOperatorsFor(f)) {
        const cond: Condition = { kind: op.kind };
        if (op.needs === 'text') cond.value = 'sample';
        if (op.needs === 'number') cond.value = '42';
        if (op.needs === 'days') cond.days = 14;
        roundTrips([{ fieldName: f.name, cond, output: '#dff6dd' }], '#f3f2f1');
      }
    }
  });

  it('round-trips a multi-column chain (rows watching different fields)', () => {
    roundTrips([
      { fieldName: 'Status', cond: { kind: 'eq', value: 'Blocked' }, output: '#fde7e9' },
      { fieldName: 'DueDate', cond: { kind: 'overdue' }, output: '#fff4ce' },
      { fieldName: 'Progress', cond: { kind: 'gte', value: '100' }, output: '#dff6dd' },
    ], '#ffffff');
  });

  it('contains normalizes its comparison to lowercase (the engine is case-insensitive)', () => {
    const expr = mapRulesToExpr(ALL, [
      { fieldName: 'Title', cond: { kind: 'contains', value: 'URGENT' }, output: 'x' },
    ], '')!;
    const parsed = parseMapFromExpr(expr, ALL)!;
    expect(parsed.rules[0].cond.value).toBe('urgent');
    expect(mapRulesToExpr(ALL, parsed.rules, parsed.elseOutput)).toBe(expr);
  });

  it('reads chains the ✨ conditional-formatting builder generated (shared vocabulary)', () => {
    const gen = rulesToStyle(FIELDS.Status, [{ cond: { kind: 'eq', value: 'Done' }, effect: 'text', color: 'green' }]);
    const parsed = parseMapFromExpr(gen.style['color'], ALL);
    expect(parsed?.rules).toEqual([
      { fieldName: 'Status', cond: { kind: 'eq', value: 'Done' }, output: condColor('green').strong },
    ]);
  });

  it('REFUSES foreign expressions — refuse-and-teach, never a guessed row', () => {
    expect(parseMapFromExpr(undefined, ALL)).toBeNull();
    expect(parseMapFromExpr('#dff6dd', ALL)).toBeNull(); // a plain literal is not a map
    expect(parseMapFromExpr("='#'+substring([$Status],0,6)", ALL)).toBeNull();
    expect(parseMapFromExpr("=if([$Progress] > 10 && [$Progress] < 20, 'a', 'b')", ALL)).toBeNull();
    expect(parseMapFromExpr("=if([$Ghost] == 'x', 'a', 'b')", ALL)).toBeNull();
    // a non-literal fallback is beyond the builder's vocabulary
    expect(parseMapFromExpr("=if([$Status] == 'Done', 'a', [$Title])", ALL)).toBeNull();
  });

  it('REFUSES an in-vocabulary chain that is not byte-identical to a rebuild', () => {
    // hand-typed without the generator's spacing — the rebuild gate refuses
    expect(parseMapFromExpr("=if([$Status]=='Done','a','b')", ALL)).toBeNull();
  });
});
