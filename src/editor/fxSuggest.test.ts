import { describe, it, expect } from 'vitest';
import {
  fxSuggestions, columnCompletions, contextCompletions,
  operandSuggestions, resultSuggestions, completionAt,
  systemTokenItems, columnRefItems, spCompletionAt,
  type Completion, type SuggestItem,
} from './fxSuggest';
import { slotsFor } from './fxSlots';
import { excelToSp } from './dialect';
import { SPECIAL_TOKENS } from '../core/schema';
import type { EvalContext } from '../core/expressions';
import type { MockField } from '../core/types';

const FIELDS: MockField[] = [
  { name: 'Title', displayName: 'Task name', type: 'text' },
  { name: 'Status', type: 'choice', choices: ['Not started', 'In Progress', 'Blocked', 'Done'] },
  { name: 'DueDate', displayName: 'Due date', type: 'date' },
  { name: 'Progress', displayName: 'Percent done', type: 'number' },
  { name: 'Approved', displayName: 'Approved?', type: 'boolean' },
];

/** FIELDS plus the object-shaped columns the sub-property rules care about. */
const RICH_FIELDS: MockField[] = [
  ...FIELDS,
  { name: 'Owner', type: 'person' },
  { name: 'AssignedTo', displayName: 'Assigned to', type: 'personMulti' },
  { name: 'Project', type: 'lookup', lookup: { list: 'Projects', column: 'Title' } },
];

/** A mock-row eval context matching RICH_FIELDS (the data editor's row). */
const CTX: EvalContext = {
  row: {
    Title: 'Ship it',
    Status: 'In Progress',
    DueDate: '2026-07-20',
    Progress: 62,
    Approved: true,
    Owner: { title: 'Frank Lee', email: 'frank@contoso.com' },
    AssignedTo: [{ title: 'Ada', email: 'ada@contoso.com' }, { title: 'Grace', email: 'grace@contoso.com' }],
    Project: { lookupId: 4, lookupValue: 'Apollo' },
  },
  rowIndex: 0,
  currentFieldName: 'Status',
  me: { title: 'Sandbox User', email: 'me@contoso.com' },
  iterators: {},
  iteratorIndex: {},
  displayNames: {},
  now: new Date(),
};

const field = (name: string): MockField => RICH_FIELDS.find((f) => f.name === name)!;
const texts = (c: Completion | null): string[] => (c ? c.items.map((i) => i.insert) : []);
const inserts = (items: SuggestItem[]): string[] => items.map((i) => i.insert);

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

describe('inline autocomplete completions (pure)', () => {
  const textSlot = slotsFor({ elmType: 'div' }).find((s) => s.id === 'text')!;
  const fillSlot = slotsFor({ elmType: 'div' }).find((s) => s.id === 'fill')!;

  it('columnCompletions offers every column in the Excel bracket form', () => {
    expect(columnCompletions(FIELDS)).toEqual(
      expect.arrayContaining(['[Task name]', '[Status]', '[Due date]', '[Percent done]', '[Approved?]']));
  });

  it('contextCompletions covers the dialect functions, context tokens and constants', () => {
    expect(contextCompletions()).toEqual(
      expect.arrayContaining(['IF(', 'AND(', 'OR(', 'NOT(', 'TODAY()', 'ME()', 'TRUE', 'FALSE']));
  });

  it('operandSuggestions are type-aware conditions that round-trip', () => {
    const ops = operandSuggestions(FIELDS);
    expect(ops.some((o) => /\[Status\] = "/.test(o))).toBe(true);
    expect(ops.some((o) => /\[Due date\] < TODAY\(\)/.test(o))).toBe(true);
    for (const o of ops) expect(excelToSp('=' + o, FIELDS).ok, `refused: ${o}`).toBe(true);
  });

  it('resultSuggestions are slot-typed and round-trip', () => {
    expect(resultSuggestions(fillSlot, FIELDS).some((r) => /^"#/.test(r))).toBe(true); // colours, quoted
    expect(resultSuggestions(textSlot, FIELDS)).toEqual(expect.arrayContaining(['[Task name]', '""']));
    for (const slot of [fillSlot, textSlot]) {
      for (const r of resultSuggestions(slot, FIELDS)) {
        expect(excelToSp('=' + r, FIELDS).ok, `refused: ${r}`).toBe(true);
      }
    }
  });

  it('every complete (non-opener) completion round-trips through the transpiler', () => {
    const all = [...columnCompletions(FIELDS), ...contextCompletions().filter((c) => !c.endsWith('('))];
    for (const c of all) expect(excelToSp('=' + c, FIELDS).ok, `refused: ${c}`).toBe(true);
  });

  describe('completionAt — caret-driven dispatch', () => {
    const weightSlot = slotsFor({ elmType: 'div' }).find((s) => s.id === 'weight')!;

    it('offers column refs inside an unclosed bracket, filtered by the partial', () => {
      const text = '=IF([Sta';
      const c = completionAt(text, text.length, textSlot, FIELDS)!;
      expect(texts(c)).toContain('[Status]');
      expect(texts(c)).not.toContain('[Due date]'); // filtered by "Sta"
      expect(c.from).toBe(text.indexOf('['));       // replaces from the '['
      expect(c.to).toBe(text.length);
    });

    it('replaces through an existing closing ] so accepting does not duplicate it', () => {
      const text = '=IF([Sta], "x", "")';
      const caret = text.indexOf(']'); // caret right after "Sta", before the ]
      const c = completionAt(text, caret, textSlot, FIELDS)!;
      expect(c.from).toBe(text.indexOf('['));
      expect(c.to).toBe(caret + 1); // range includes the existing ]
      const spliced = text.slice(0, c.from) + '[Status]' + text.slice(c.to);
      expect(spliced).toBe('=IF([Status], "x", "")');
      expect(spliced).not.toContain(']]');
    });

    it('still ends the range at the caret when the bracket is genuinely unclosed', () => {
      const text = '=[Sta';
      const c = completionAt(text, text.length, textSlot, FIELDS)!;
      expect(c.to).toBe(text.length);
    });

    it('offers condition operands right after IF(', () => {
      const text = '=IF(';
      const c = completionAt(text, text.length, textSlot, FIELDS)!;
      expect(texts(c).some((o) => /\[Status\] = "/.test(o))).toBe(true);
      expect(c.from).toBe(text.length); // pure insertion at the caret
    });

    it('offers slot-typed results after a comma', () => {
      const text = '=IF([Status] = "Done", ';
      const c = completionAt(text, text.length, fillSlot, FIELDS)!;
      expect(texts(c).some((r) => /^"#/.test(r))).toBe(true);
    });

    it('offers functions/constants for a bare word, by prefix', () => {
      const text = '=TO';
      const c = completionAt(text, text.length, textSlot, FIELDS)!;
      expect(texts(c)).toContain('TODAY()');
      expect(texts(c)).not.toContain('IF(');
      expect(c.from).toBe(1); // replaces "TO"
    });

    it('replaces an @word with the SYSTEM CONTEXT tokens (#222)', () => {
      const text = '=@';
      const c = completionAt(text, text.length, textSlot, FIELDS)!;
      expect(texts(c)).toEqual(expect.arrayContaining(['@currentField', '@me', '@now', '@rowIndex']));
      expect(c.from).toBe(1);
    });

    it('gives nothing for a plain literal (no leading =)', () => {
      expect(completionAt('#107c10', 7, fillSlot, FIELDS)).toBeNull();
      expect(completionAt('bold', 4, weightSlot, FIELDS)).toBeNull();
    });
  });
});

describe('#222 — system token catalog (grounded in the engine)', () => {
  it('offers exactly tokens the engine resolves — every head is in SPECIAL_TOKENS', () => {
    const heads = new Set(SPECIAL_TOKENS.map((t) => t.split('.')[0]));
    for (const t of inserts(systemTokenItems())) {
      expect(heads.has(t.split('.')[0]), `not engine-known: ${t}`).toBe(true);
    }
  });

  it('covers the headline tokens and never invents ones core does not know', () => {
    const t = inserts(systemTokenItems());
    expect(t).toEqual(expect.arrayContaining([
      '@currentField', '@me', '@now', '@rowIndex', '@window.innerWidth', '@window.innerHeight',
    ]));
    expect(t).not.toContain('@thousands'); // not resolved by src/core → never offered
    expect(t).not.toContain('@currency');
  });

  it('every token carries a doc line and its output type', () => {
    for (const item of systemTokenItems()) {
      expect(item.doc, item.insert).toBeTruthy();
    }
    const byInsert = new Map(systemTokenItems().map((i) => [i.insert, i]));
    expect(byInsert.get('@now')!.type).toBe('date');
    expect(byInsert.get('@rowIndex')!.type).toBe('number');
    expect(byInsert.get('@isSelected')!.type).toBe('boolean');
    expect(byInsert.get('@window.innerWidth')!.type).toBe('number');
  });

  it('@currentField sub-properties follow the CURRENT column type (refuse-don\'t-guess)', () => {
    const person = inserts(systemTokenItems({ current: field('Owner') }));
    expect(person).toEqual(expect.arrayContaining(['@currentField.title', '@currentField.email']));
    const lookup = inserts(systemTokenItems({ current: field('Project') }));
    expect(lookup).toContain('@currentField.lookupValue');
    expect(lookup).not.toContain('@currentField.email'); // person-only
    const text = inserts(systemTokenItems({ current: field('Title') }));
    expect(text.some((t) => t.startsWith('@currentField.'))).toBe(false); // scalar → no tails
  });

  it('@currentField reports the current column\'s output type and names it in the doc', () => {
    const num = systemTokenItems({ current: field('Progress') })
      .find((i) => i.insert === '@currentField')!;
    expect(num.type).toBe('number');
    expect(num.doc).toContain('Percent done');
  });
});

describe('#222 — column ref catalog (type-aware sub-properties)', () => {
  it('display spelling offers every column; internal spelling offers [$Internal]', () => {
    expect(inserts(columnRefItems(FIELDS, 'display'))).toEqual(
      expect.arrayContaining(['[Task name]', '[Status]', '[Due date]']));
    expect(inserts(columnRefItems(FIELDS, 'internal'))).toEqual(
      expect.arrayContaining(['[$Title]', '[$Status]', '[$DueDate]']));
  });

  it('person and lookup columns get their legal tails; scalar columns get NONE', () => {
    const t = inserts(columnRefItems(RICH_FIELDS, 'internal'));
    expect(t).toEqual(expect.arrayContaining(
      ['[$Owner.email]', '[$Owner.title]', '[$Project.lookupValue]', '[$Project.lookupId]']));
    // never offer .email on a text column
    expect(t.some((x) => x.startsWith('[$Title.'))).toBe(false);
    expect(t.some((x) => x.startsWith('[$Status.'))).toBe(false);
  });

  it('items carry the column\'s output type and a doc line', () => {
    const by = new Map(columnRefItems(RICH_FIELDS, 'display').map((i) => [i.insert, i]));
    expect(by.get('[Percent done]')!.type).toBe('number');
    expect(by.get('[Due date]')!.type).toBe('date');
    expect(by.get('[Owner]')!.type).toBe('object');
    expect(by.get('[Owner.email]')!.type).toBe('string');
    expect(by.get('[Assigned to.email]')!.type).toBe('array'); // multi → one per value
    expect(by.get('[Status]')!.doc).toContain('Choice');
    for (const i of by.values()) expect(i.doc, i.insert).toBeTruthy();
  });
});

describe('#222 — live mock previews (honest or absent)', () => {
  it('previews scalar columns and tokens from the mock row', () => {
    const cols = new Map(columnRefItems(RICH_FIELDS, 'display', CTX).map((i) => [i.insert, i]));
    expect(cols.get('[Status]')!.preview).toBe('In Progress');
    expect(cols.get('[Percent done]')!.preview).toBe('62');
    expect(cols.get('[Owner.email]')!.preview).toBe('frank@contoso.com');
    const toks = new Map(systemTokenItems({ current: field('Status'), ctx: CTX }).map((i) => [i.insert, i]));
    expect(toks.get('@currentField')!.preview).toBe('In Progress');
    expect(toks.get('@me')!.preview).toBe('me@contoso.com');
    expect(toks.get('@rowIndex')!.preview).toBe('0');
  });

  it('a bare object value shows NO preview rather than a guess', () => {
    const cols = new Map(columnRefItems(RICH_FIELDS, 'display', CTX).map((i) => [i.insert, i]));
    expect(cols.get('[Owner]')!.preview).toBeUndefined();     // person object
    expect(cols.get('[Project]')!.preview).toBeUndefined();   // lookup object
    const toks = new Map(systemTokenItems({ ctx: CTX }).map((i) => [i.insert, i]));
    expect(toks.get('@columnAggregate')!.preview).toBeUndefined();
  });

  it('a multi-person tail previews every value; no context means no preview', () => {
    const cols = new Map(columnRefItems(RICH_FIELDS, 'display', CTX).map((i) => [i.insert, i]));
    expect(cols.get('[Assigned to.email]')!.preview).toBe('ada@contoso.com, grace@contoso.com');
    for (const i of columnRefItems(RICH_FIELDS, 'display')) {
      expect(i.preview, i.insert).toBeUndefined();
    }
  });

  it('an empty cell previews as (empty) — honest, not blank-looking', () => {
    const ctx: EvalContext = { ...CTX, row: { ...CTX.row, Title: '' } };
    const cols = new Map(columnRefItems(RICH_FIELDS, 'display', ctx).map((i) => [i.insert, i]));
    expect(cols.get('[Task name]')!.preview).toBe('(empty)');
  });
});

describe('#222 — trigger + insertion mechanics', () => {
  const textSlot = slotsFor({ elmType: 'div' }).find((s) => s.id === 'text')!;

  it('a [$ partial switches to the internal spelling and completes the bracket', () => {
    const text = '=[$Sta';
    const c = completionAt(text, text.length, textSlot, RICH_FIELDS)!;
    expect(texts(c)).toContain('[$Status]');
    expect(texts(c)).not.toContain('[Status]'); // internal spelling only
    const spliced = text.slice(0, c.from) + '[$Status]' + text.slice(c.to);
    expect(spliced).toBe('=[$Status]');
  });

  it('typed sub-property partials filter within the bracket', () => {
    const text = '=[$Owner.em';
    const c = completionAt(text, text.length, textSlot, RICH_FIELDS)!;
    expect(texts(c)).toEqual(['[$Owner.email]']);
  });

  it('an @ partial (dots included) replaces the whole token', () => {
    const text = '=IF(@currentField.em';
    const c = completionAt(text, text.length, textSlot, RICH_FIELDS, { current: field('Owner') })!;
    expect(texts(c)).toEqual(['@currentField.email']);
    const spliced = text.slice(0, c.from) + '@currentField.email' + text.slice(c.to);
    expect(spliced).toBe('=IF(@currentField.email');
  });

  it('the current column gates the @ tails here too', () => {
    const c = completionAt('=@currentField.', 15, textSlot, RICH_FIELDS, { current: field('Title') });
    expect(c).toBeNull(); // a text column has no legal tails
  });

  it('accepting a column over an existing ] never doubles the bracket', () => {
    const text = '=IF([$Sta], "x", "")';
    const caret = text.indexOf(']');
    const c = completionAt(text, caret, textSlot, RICH_FIELDS)!;
    const spliced = text.slice(0, c.from) + '[$Status]' + text.slice(c.to);
    expect(spliced).toBe('=IF([$Status], "x", "")');
    expect(spliced).not.toContain(']]');
  });

  it('everything the token menus insert round-trips through the transpiler', () => {
    const all = [
      ...systemTokenItems({ current: field('Owner') }),
      ...systemTokenItems({ current: field('Project') }),
      ...columnRefItems(RICH_FIELDS, 'display'),
      ...columnRefItems(RICH_FIELDS, 'internal'),
    ];
    for (const item of all) {
      const r = excelToSp(`=${item.insert}`, RICH_FIELDS);
      expect(r.ok, `refused: ${item.insert}${r.ok ? '' : ` (${r.reason})`}`).toBe(true);
    }
  });
});

describe('#222 — spCompletionAt (the Code lens, SP dialect)', () => {
  it('offers system tokens after @ inside a declaration VALUE', () => {
    const text = 'color: =if(@cu';
    const c = spCompletionAt(text, text.length, RICH_FIELDS)!;
    expect(texts(c)).toContain('@currentField');
    expect(c.from).toBe(text.indexOf('@cu'));
    expect(c.to).toBe(text.length);
  });

  it('does NOT trigger on the @name that starts an attribute line', () => {
    expect(spCompletionAt('@txtCont', 8, RICH_FIELDS)).toBeNull();
    expect(spCompletionAt('padding: 4px;\n@txtCont', 22, RICH_FIELDS)).toBeNull();
  });

  it('offers internal-name refs (with tails) after [$ — and stays quiet on a bare [', () => {
    const text = '@txtContent: =[$Own';
    const c = spCompletionAt(text, text.length, RICH_FIELDS)!;
    expect(texts(c)).toEqual(expect.arrayContaining(['[$Owner]', '[$Owner.email]']));
    expect(spCompletionAt('@txtContent: =[Own', 18, RICH_FIELDS)).toBeNull();
  });

  it('replaces through an existing ] on the same line only', () => {
    const text = 'width: =[$Prog] + 1;\nheight: 4px;';
    const caret = text.indexOf(']');
    const c = spCompletionAt(text, caret, RICH_FIELDS)!;
    const spliced = text.slice(0, c.from) + '[$Progress]' + text.slice(c.to);
    expect(spliced).toBe('width: =[$Progress] + 1;\nheight: 4px;');
  });

  it('previews ride along when a context is given', () => {
    const c = spCompletionAt('color: =@currentFi', 18, RICH_FIELDS, { current: field('Status'), ctx: CTX })!;
    expect(c.items[0].insert).toBe('@currentField');
    expect(c.items[0].preview).toBe('In Progress');
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
