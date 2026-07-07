import { describe, it, expect } from 'vitest';
import { excelToSp, spToExcel, type DialectField } from './dialect';
import { evaluate, type EvalContext } from '../core/expressions';
import type { MockRow } from '../core/types';

// A small schema with spaced display names so name resolution is exercised.
const FIELDS: DialectField[] = [
  { name: 'Status', displayName: 'Status', type: 'choice' },
  { name: 'Progress', displayName: 'Percent done', type: 'number' },
  { name: 'DueDate', displayName: 'Due date', type: 'date' },
  { name: 'Approved', displayName: 'Approved?', type: 'boolean' },
  { name: 'Project', displayName: 'Project', type: 'lookup' },
  { name: 'Title', displayName: 'Task name', type: 'text' },
];

const sp = (input: string) => excelToSp(input, FIELDS);
const ex = (input: string) => spToExcel(input, FIELDS);

const ok = (r: ReturnType<typeof excelToSp>): string => {
  if (!r.ok) throw new Error(`expected ok, got refusal: ${r.reason}`);
  return r.value;
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

describe('excelToSp — operators and spelling', () => {
  it('= becomes ==, <> becomes !=, columns resolve by display name', () => {
    expect(ok(sp('=[Status] = "Done"'))).toBe("=[$Status] == 'Done'");
    expect(ok(sp('[Status] <> "Done"'))).toBe("=[$Status] != 'Done'");
    expect(ok(sp('[Percent done] >= 100'))).toBe('=[$Progress] >= 100');
  });

  it('accepts SP-ish equality too (in-between input is fine)', () => {
    expect(ok(sp('[Status] == "Done"'))).toBe("=[$Status] == 'Done'");
    expect(ok(sp('[Status] != "Done"'))).toBe("=[$Status] != 'Done'");
  });

  it('& concatenation maps to + and double quotes become single quotes', () => {
    expect(ok(sp('"Hi " & [Task name]'))).toBe("='Hi ' + [$Title]");
  });

  it('AND/OR fold into &&/|| and IF maps to if (names case-folded)', () => {
    expect(ok(sp('AND([Status] = "Done", [Percent done] >= 100)')))
      .toBe("=[$Status] == 'Done' && [$Progress] >= 100");
    expect(ok(sp('or([status] = "A", [Status] = "B")')))
      .toBe("=[$Status] == 'A' || [$Status] == 'B'");
    expect(ok(sp('IF([Percent done] >= 100, "done", "open")')))
      .toBe("=if([$Progress] >= 100, 'done', 'open')");
  });

  it('TODAY()/NOW()/ME() map to @now/@me', () => {
    expect(ok(sp('[Due date] < TODAY()'))).toBe('=[$DueDate] < @now');
    expect(ok(sp('[Due date] < now()'))).toBe('=[$DueDate] < @now');
  });

  it('three-or-more AND folds into a left-leaning && chain', () => {
    expect(ok(sp('AND([Status]="A",[Status]="B",[Status]="C")')))
      .toBe("=[$Status] == 'A' && [$Status] == 'B' && [$Status] == 'C'");
  });

  it('precedence is preserved with minimal parentheses', () => {
    expect(ok(sp('[Status] = "A" || [Status] = "B" && [Status] = "C"')))
      .toBe("=[$Status] == 'A' || [$Status] == 'B' && [$Status] == 'C'");
    expect(ok(sp('([Percent done] + 1) * 2'))).toBe('=([$Progress] + 1) * 2');
  });
});

describe('excelToSp — NOT is rewritten, never emitted', () => {
  it('flips a comparison', () => {
    expect(ok(sp('NOT([Status] = "Done")'))).toBe("=[$Status] != 'Done'");
    expect(ok(sp('NOT([Percent done] >= 100)'))).toBe('=[$Progress] < 100');
  });

  it('applies De Morgan across AND/OR', () => {
    expect(ok(sp('NOT(AND([Status] = "A", [Status] = "B"))')))
      .toBe("=[$Status] != 'A' || [$Status] != 'B'");
  });

  it('double negation cancels', () => {
    expect(ok(sp('NOT(NOT([Status] = "Done"))'))).toBe("=[$Status] == 'Done'");
  });

  it('negates a yes/no column as = false using the schema type', () => {
    expect(ok(sp('NOT([Approved?])'))).toBe('=[$Approved] == false');
  });

  it('refuses to negate a non-boolean column rather than guess', () => {
    const r = sp('NOT([Task name])');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/yes\/no|comparison/i);
  });

  it('never emits a standalone ! and output is always valid SP', () => {
    const out = ok(sp('NOT(AND([Status]="A", NOT([Approved?])))'));
    expect(out).not.toMatch(/[^!<>]![^=]/); // no logical-NOT bang
    // and it parses + evaluates through the engine
    expect(() => evaluate(out, ctx({ Status: 'A', Approved: true }))).not.toThrow();
  });
});

describe('excelToSp — refusals (teach, do not guess)', () => {
  it('unknown column names refuse and list what is available', () => {
    const r = sp('[Nope] = "x"');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/no column called/i);
  });

  it('unsupported functions refuse and point at Advanced', () => {
    const r = sp('CONCATENATE([Task name], "!")');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/Advanced|vocabulary/i);
  });

  it('a single quote inside text refuses (SP strings have no escape)', () => {
    const r = sp('[Task name] = "O\'Brien"');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/single quote/i);
  });

  it('a bare word (unbracketed column) refuses with a hint', () => {
    const r = sp('Status = "Done"');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/brackets/i);
  });
});

describe('spToExcel — stored SP rendered toward Excel', () => {
  it('== becomes =, != becomes <>, internal names become display names', () => {
    expect(ok(ex("=[$Status] == 'Done'"))).toBe('=[Status] = "Done"');
    expect(ok(ex("=[$Status] != 'Done'"))).toBe('=[Status] <> "Done"');
    expect(ok(ex('=[$Progress] >= 100'))).toBe('=[Percent done] >= 100');
  });

  it('&&/|| become AND()/OR() and if becomes IF', () => {
    expect(ok(ex("=[$Status] == 'Done' && [$Progress] >= 100")))
      .toBe('=AND([Status] = "Done", [Percent done] >= 100)');
    expect(ok(ex("=if([$Progress] >= 100, 'done', 'open')")))
      .toBe('=IF([Percent done] >= 100, "done", "open")');
  });

  it('@now/@me and a lookup property render in Excel terms', () => {
    expect(ok(ex('=[$DueDate] < @now'))).toBe('=[Due date] < TODAY()');
    expect(ok(ex("=[$Project.lookupValue] == 'Apollo'")))
      .toBe('=[Project.lookupValue] = "Apollo"');
  });

  it('refuses SP functions outside the subset, pointing at Advanced', () => {
    const r = ex("=toString([$DueDate]) != '' && [$DueDate] < @now");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/Advanced/i);
  });
});

describe('round-trip safety (SP is the stored truth)', () => {
  const sps = [
    "=[$Status] == 'Done'",
    '=[$Progress] >= 100',
    "=[$Status] == 'Done' && [$Progress] >= 100",
    "=if([$Progress] >= 100, 'done', 'open')",
    '=[$DueDate] < @now',
  ];
  it('SP → Excel → SP is stable', () => {
    for (const s of sps) {
      const excel = ok(ex(s));
      expect(ok(excelToSp(excel, FIELDS))).toBe(s);
    }
  });
});

describe('#222 — SharePoint context tokens pass through both dialects', () => {
  it('engine-known @tokens are accepted by the Excel side verbatim', () => {
    expect(ok(sp('=@currentField'))).toBe('=@currentField');
    expect(ok(sp('=@rowIndex % 2 = 0'))).toBe('=@rowIndex % 2 == 0');
    expect(ok(sp('=@window.innerWidth < 640'))).toBe('=@window.innerWidth < 640');
    expect(ok(sp('=@currentField.lookupValue = "Apollo"')))
      .toBe("=@currentField.lookupValue == 'Apollo'");
  });

  it('typed @now/@me normalise to the stored tokens and still display as TODAY()/ME()', () => {
    expect(ok(sp('=[Due date] < @now'))).toBe('=[$DueDate] < @now');
    expect(ok(ex('=[$DueDate] < @now'))).toBe('=[Due date] < TODAY()');
    expect(ok(sp('=@me'))).toBe('=@me');
    expect(ok(ex('=@me.email'))).toBe('=@me.email'); // a dotted @me keeps its prop
  });

  it('a bare head that only exists dotted is NOT a token — @window refuses both ways', () => {
    // exact tokens and dotted-on-a-real-base pass; a head like @window that
    // only appears dotted in SPECIAL_TOKENS is nothing SP would resolve
    const exq = ex('=@window');
    expect(exq.ok).toBe(false);
    if (!exq.ok) expect(exq.reason).toMatch(/doesn’t translate/);
    expect(sp('=@window').ok).toBe(false);
    expect(sp('=@window.zoom').ok).toBe(false); // dotted, but the base isn't a token
    expect(ok(sp('=@window.innerWidth > 0'))).toBe('=@window.innerWidth > 0');
  });

  it('stored tokens render back verbatim, so the round-trip is stable', () => {
    for (const s of ['=@currentField', '=@rowIndex', "=@currentWeb + '/Lists'", '=@window.innerHeight']) {
      expect(ok(excelToSp(ok(ex(s)), FIELDS))).toBe(s);
    }
  });

  it('an unknown @token refuses with the engine\'s token list (refuse-don\'t-guess)', () => {
    const r = sp('=@thousands');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/context token/i);
  });

  it('the SP internal [$Name(.prop)] spelling is accepted on the Excel side', () => {
    expect(ok(sp('=[$Status] = "Done"'))).toBe("=[$Status] == 'Done'");
    expect(ok(sp('=[$Project.lookupValue]'))).toBe('=[$Project.lookupValue]');
    const r = sp('=[$Ghost]');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/no column called/i);
  });
});

describe('no-schema fallback', () => {
  it('column names pass through as identity both directions', () => {
    expect(ok(excelToSp('[Status] = "Done"'))).toBe("=[$Status] == 'Done'");
    expect(ok(spToExcel("=[$Status] == 'Done'"))).toBe('=[Status] = "Done"');
  });

  it('empty input translates to empty (a cleared slot)', () => {
    expect(ok(excelToSp(''))).toBe('');
    expect(ok(spToExcel('   '))).toBe('');
  });
});
