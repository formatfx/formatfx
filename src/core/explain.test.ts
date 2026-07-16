/**
 * The Explain contract: every AST node kind reads back in plain English,
 * both expression dialects (Excel-style strings AND the legacy object/AST
 * syntax) are covered, the element walk addresses entries by NodePath
 * exactly like lint issues, and everything outside the vocabulary REFUSES
 * ("can't explain yet") rather than guessing.
 */
import { describe, it, expect } from 'vitest';
import { explainValue, explainDocument, astFromObjectForm, explainAst } from './explain';
import type { FormatterDocument, SPExpr } from './types';

const ok = (v: SPExpr, ctx = {}): string => {
  const r = explainValue(v, ctx);
  if (!r.ok) throw new Error(`expected an explanation, got refusal: ${r.reason}`);
  return r.text;
};
const refused = (v: SPExpr, ctx = {}): string => {
  const r = explainValue(v, ctx);
  if (r.ok) throw new Error(`expected a refusal, got: ${r.text}`);
  return r.reason;
};

describe('explainValue — literals and bare references', () => {
  it('literals pass through readably', () => {
    expect(ok(42)).toBe('42');
    expect(ok(true)).toBe('true');
    expect(ok('Done')).toBe('‘Done’');
    expect(ok('')).toBe('nothing');
  });
  it('bare [$Field] and @token strings resolve like the renderer resolves them', () => {
    expect(ok('[$Status]')).toBe('“Status”');
    expect(ok('@currentField')).toBe('this column’s value');
  });
  it('display names from the schema are preferred', () => {
    expect(ok('[$Status]', { displayNames: { Status: 'State' } })).toBe('“State”');
    expect(ok('@currentField', { currentFieldName: 'Progress' })).toContain('“Progress”');
  });
});

describe('explainAst — all nine node kinds', () => {
  it('num, str, field, token, ident, unary', () => {
    expect(ok("=-[$Progress]")).toBe('negative “Progress”');
    expect(ok('=true')).toBe('yes');
    expect(ok("='x'+1")).toContain('followed by');
  });
  it('field property access reads possessively', () => {
    expect(ok('[$Owner.email]')).toBe('“Owner”’s email');
    expect(ok('[!Status.DisplayName]')).toContain('display name of the “Status” column');
  });
  it('comparisons read as sentences', () => {
    expect(ok('=[$Progress]>=100')).toBe('“Progress” is at least 100');
    expect(ok("=[$Status]!='Done'")).toBe('“Status” is not ‘Done’');
  });
  it('ternary and if() read identically', () => {
    expect(ok("=[$Progress]>50?'big':'small'")).toBe('if “Progress” is more than 50, then ‘big’, otherwise ‘small’');
    expect(ok("=if([$Progress]>50,'big','small')")).toBe('if “Progress” is more than 50, then ‘big’, otherwise ‘small’');
  });
  it('two-argument if() says "otherwise nothing"', () => {
    expect(ok("=if([$Done],'✓')")).toContain('otherwise nothing');
  });
  it('mixed and/or is parenthesized so the reading is unambiguous', () => {
    expect(ok("=([$A]==1||[$B]==2)&&[$C]==3"))
      .toBe('(“A” is 1 or “B” is 2) and “C” is 3');
  });
  it('function calls get purposeful phrasing', () => {
    expect(ok("=getUserImage([$Owner.email],'S')")).toBe('the profile photo of “Owner”’s email');
    expect(ok('=toLocaleDateString([$DueDate])')).toBe('“DueDate” formatted as a date');
    expect(ok('=length(@currentField)')).toBe('how many items this column’s value holds');
    expect(ok("=join(@currentField,', ')")).toContain('joined with');
    expect(ok("=loopIndex('_tag')")).toContain('loop item');
  });
});

describe('the legacy object/AST syntax', () => {
  it('the "?" ternary with a nested comparison — the classic community sample', () => {
    const sample: SPExpr = {
      operator: '?',
      operands: [
        { operator: '<=', operands: ['@currentField', 70] },
        'sp-field-severity--warning',
        'sp-field-severity--good',
      ],
    };
    expect(ok(sample)).toBe('if this column’s value is at most 70, then ‘sp-field-severity--warning’, otherwise ‘sp-field-severity--good’');
  });
  it('multi-operand && folds like the engine folds it', () => {
    const node = astFromObjectForm({ operator: '&&', operands: [true, true, false] });
    expect(explainAst(node, {})).toBe('yes and yes and no');
  });
  it('function-style operators with the "()" suffix work', () => {
    expect(ok({ operator: 'toString()', operands: [45] })).toBe('45 as text');
  });
});

describe('refuse-don’t-guess', () => {
  it('unknown functions refuse by name', () => {
    expect(refused("=upper([$Title])")).toContain('upper()');
  });
  it('unknown tokens refuse', () => {
    expect(refused('=@columnAggregate.value')).toContain('@columnAggregate');
  });
  it('unparseable formulas refuse with the parse problem', () => {
    expect(refused("=if([$Status]=='Done'")).toMatch(/parsed/);
  });
});

describe('explainDocument — the element walk', () => {
  const DOC: FormatterDocument = {
    kind: 'row',
    root: {
      elmType: 'div', // structure-only: should produce NO entry
      children: [
        {
          elmType: 'span',
          _elmName: 'Status pill',
          txtContent: '[$Status]',
          style: {
            'background-color': "=if([$Status]=='Blocked','#d13438','#107c10')",
            'padding': '2px 10px', // static — design, not meaning; stays out
          },
        },
        {
          elmType: 'button',
          txtContent: 'Escalate',
          customRowAction: { action: 'executeFlow', actionParams: '{"id":"abc-123"}' },
        },
        {
          elmType: 'button',
          txtContent: 'Done',
          customRowAction: { action: 'setValue', actionInput: { Status: 'Done' } },
        },
        {
          elmType: 'button',
          txtContent: 'Card',
          customCardProps: {
            openOnEvent: 'hover',
            formatter: { elmType: 'div', children: [{ elmType: 'span', txtContent: '[$Notes]' }] },
          },
        },
        { elmType: 'div', forEach: '_tag in [$Tags]', children: [{ elmType: 'span', txtContent: '[$_tag]' }] },
        { elmType: 'span', txtContent: '=mystery([$Title])' },
      ],
    },
  };
  const entries = explainDocument(DOC, { displayNames: { Status: 'Status' } });
  const byPath = (p: number[]) => entries.find((e) => JSON.stringify(e.path) === JSON.stringify(p));

  it('skips structure-only wrappers, keeps everything with meaning', () => {
    expect(byPath([])).toBeUndefined();
    expect(entries.length).toBeGreaterThanOrEqual(7);
  });

  it('labels entries by _elmName and reads conditions back', () => {
    const pill = byPath([0])!;
    expect(pill.label).toBe('Status pill');
    expect(pill.lines.some((l) => l.text === 'Shows “Status”.')).toBe(true);
    expect(pill.lines.some((l) => l.text.includes('background color') && l.text.includes('‘#d13438’'))).toBe(true);
    // static padding is design, not meaning
    expect(pill.lines.some((l) => l.text.includes('padding'))).toBe(false);
  });

  it('actions read as what clicking DOES', () => {
    expect(byPath([1])!.lines.some((l) => l.text === 'Clicking runs the Power Automate flow abc-123.')).toBe(true);
    expect(byPath([2])!.lines.some((l) => l.text.includes('sets “Status” to ‘Done’'))).toBe(true);
  });

  it('the PnP action extras and executeQuickStep read as what clicking does (#286)', () => {
    const line = (action: string, actionInput?: Record<string, unknown>): string => {
      const doc: FormatterDocument = {
        kind: 'row',
        root: { elmType: 'button', customRowAction: { action, ...(actionInput ? { actionInput } : {}) } as never },
      };
      return explainDocument(doc)[0].lines[0].text;
    };
    expect(line('comment')).toContain('comments pane');
    // library-only actions carry their caveat in the sentence
    expect(line('copyFile')).toContain('document libraries only');
    expect(line('executeQuickStep', { ruleTemplateId: '42' })).toContain('Quick Step with rule template id 42');
    expect(line('executeQuickStep')).toContain('no ruleTemplateId is set');
  });

  it('cards recurse via the CARD_SEGMENT path, like lint issues do', () => {
    expect(byPath([3])!.lines.some((l) => l.text.includes('hover card'))).toBe(true);
    const inside = byPath([3, -1, 0]);
    expect(inside).toBeDefined();
    expect(inside!.lines[0].text).toBe('Shows “Notes”.');
  });

  it('forEach is described', () => {
    expect(byPath([4])!.lines.some((l) => l.text.includes('Repeats once for each item in “Tags”'))).toBe(true);
  });

  it('unknown constructs surface as honest refusals, flagged unexplained', () => {
    const mystery = byPath([5])!;
    const line = mystery.lines.find((l) => l.unexplained);
    expect(line).toBeDefined();
    expect(line!.text).toContain('can’t explain this yet');
    expect(line!.text).toContain('mystery()');
  });

  it('a setValue whose value can’t be read is flagged unexplained too', () => {
    const doc: FormatterDocument = {
      kind: 'column',
      root: {
        elmType: 'button',
        txtContent: 'Set',
        customRowAction: { action: 'setValue', actionInput: { Status: '=mystery()' } },
      },
    };
    const line = explainDocument(doc)[0].lines.find((l) => l.text.includes('Clicking sets'))!;
    expect(line.text).toContain('can’t read yet');
    expect(line.unexplained).toBe(true);
  });
});
