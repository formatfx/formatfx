/**
 * Engine tests: expression evaluation, linting, serialization round-trips,
 * schema import (JSON + CSV) and DOM rendering (happy-dom).
 */
import { describe, it, expect } from 'vitest';
import { evaluate, evalAny, parseForEach, evaluateForEachList, type EvalContext } from './expressions';
import { lintDocument, stripExpressionWhitespace } from './linter';
import { importJson, exportJson } from './serializer';
import { importSchema, mapSpFieldType, buildSampleRows } from './schemaImport';
import { renderElement } from './renderer';
import type { FormatterDocument, SPElement } from './types';

const ctx: EvalContext = {
  row: {
    Title: 'Launch new intranet', Status: 'In Progress', DueDate: '2026-06-15',
    Progress: 64, Tags: 'web;intranet',
    AssignedTo: [{ title: 'Ada Lovelace', email: 'ada@contoso.com' }, { title: 'Grace Hopper', email: 'grace@contoso.com' }],
    Owner: { title: 'Ada Lovelace', email: 'ada@contoso.com' },
    Project: { lookupId: 3, lookupValue: 'Apollo' },
  },
  rowIndex: 0,
  currentFieldName: 'Status',
  me: { title: 'Me', email: 'me@contoso.com' },
  iterators: {}, iteratorIndex: {},
  displayNames: { Title: 'Task name' },
  now: new Date('2026-06-10T12:00:00Z'),
};

describe('expression engine', () => {
  const cases: Array<[string, unknown]> = [
    ["=if([$Status]=='Done','green','blue')", 'blue'],
    ['=@currentField', 'In Progress'],
    ["=[$Progress]+'%'", '64%'],
    ["=[$Progress]>=50&&[$Status]!='Done'", true],
    ['=toUpperCase(substring([$Title],0,6))', 'LAUNCH'],
    ["=length([$AssignedTo])+' members'", '2 members'],
    ["=join(split([$Tags],';'),' | ')", 'web | intranet'],
    ['=[$Owner.title]', 'Ada Lovelace'],
    ["=if([$DueDate]<=@now,'overdue','ok')", 'ok'],
    ['=floor((Number(Date([$DueDate]))-Number(@now))/86400000)', 4],
    ['[$Title]', 'Launch new intranet'],
    ['[!Title.DisplayName]', 'Task name'],
    ['@rowIndex', 0],
    ["=padStart(toString([$Progress]),5,'0')", '00064'],
    ["=!([$Status]=='Done')", true],
    // lookup field access
    ['=[$Project.lookupValue]', 'Apollo'],
    ["='ID='+[$Project.lookupId]", 'ID=3'],
    ['=[$Project]', { lookupId: 3, lookupValue: 'Apollo' }],
  ];
  for (const [expr, expected] of cases) {
    it(expr, () => expect(evaluate(expr, ctx)).toEqual(expected));
  }

  it('forEach over split and person arrays', () => {
    const b = parseForEach("_tag in split([$Tags],';')")!;
    expect(evaluateForEachList(b.listExpr, ctx)).toEqual(['web', 'intranet']);
    const b2 = parseForEach('_p in [$AssignedTo]')!;
    expect(evaluateForEachList(b2.listExpr, ctx)).toHaveLength(2);
  });

  it('strips whitespace outside quoted literals', () => {
    expect(stripExpressionWhitespace("=if([$Status] == 'In Progress', 'a b', 'c')"))
      .toBe("=if([$Status]=='In Progress','a b','c')");
  });
});

describe('linter', () => {
  it('flags the documented silent-failure quirks', () => {
    const doc: FormatterDocument = {
      kind: 'column',
      root: {
        elmType: 'div',
        txtContent: "=not([$Status]=='x')",
        style: { 'transition': 'all .2s', 'display': "=if([$Status] == 'Done', 'none', 'flex')" },
        children: [
          { elmType: 'span', forEach: "tag in split([$Tags],';')", txtContent: '=[$tag]' },
        ],
      },
    };
    const rules = lintDocument(doc).map((i) => i.rule);
    for (const expected of ['no-not-function', 'css-unsupported', 'foreach-iterator-underscore', 'foreach-split-scope', 'zero-whitespace']) {
      expect(rules).toContain(expected);
    }
  });
});

describe('AST (object) expression syntax', () => {
  it('evaluates the classic docs ternary example', () => {
    // color: red when @currentField <= 70
    const expr = {
      operator: '?',
      operands: [
        { operator: '<=', operands: ['=[$Progress]', 70] },
        '#ff0000', '#00ff00',
      ],
    } as const;
    expect(evalAny(expr as never, ctx)).toBe('#ff0000'); // Progress 64 <= 70 → red
  });

  it('supports the legacy ":" ternary alias used by community samples', () => {
    const expr = {
      operator: ':',
      operands: [
        { operator: '==', operands: ['@currentField', 'In Progress'] },
        'sp-field-severity--low', 'sp-field-severity--good',
      ],
    };
    expect(evalAny(expr as never, ctx)).toBe('sp-field-severity--low');
  });

  it('supports function-style operators with () suffix and string concat', () => {
    expect(evalAny({ operator: 'toString()', operands: [42] } as never, ctx)).toBe('42');
    expect(evalAny({ operator: '+', operands: ['Progress: ', '=[$Progress]', '%'] } as never, ctx)).toBe('Progress: 64%');
    expect(evalAny({ operator: 'toUpperCase', operands: ['@currentField'] } as never, ctx)).toBe('IN PROGRESS');
  });

  it('renders an element whose style uses AST syntax', () => {
    const el: SPElement = {
      elmType: 'div',
      txtContent: '@currentField',
      style: {
        color: {
          operator: '?',
          operands: [{ operator: '==', operands: ['@currentField', 'In Progress'] }, 'rgb(0, 120, 212)', ''],
        },
      },
    };
    const node = renderElement(el, ctx) as HTMLElement;
    expect(node.textContent).toBe('In Progress');
    expect(node.style.getPropertyValue('color')).toBe('rgb(0, 120, 212)');
  });

  it('export preserves AST objects untouched', () => {
    const doc: FormatterDocument = {
      kind: 'column',
      root: {
        elmType: 'div',
        txtContent: { operator: 'toString()', operands: ['@currentField'] },
      },
    };
    const out = JSON.parse(exportJson(doc));
    expect(out.txtContent).toEqual({ operator: 'toString()', operands: ['@currentField'] });
  });
});

describe('tenant theme', () => {
  it('parses flat maps, {palette} wrappers, and rejects junk', async () => {
    const { parseThemeJson } = await import('./theme');
    expect(parseThemeJson('{"themePrimary":"#536a8b","white":"#1a1d21","neutralPrimary":"#fff"}').themePrimary).toBe('#536a8b');
    expect(parseThemeJson('{"palette":{"themePrimary":"#111111","themeDark":"#222222","white":"#333333"}}').themeDark).toBe('#222222');
    expect(() => parseThemeJson('{"a":1,"b":2}')).toThrow(/color tokens/);
  });

  it('custom palette overrides stock tokens in the generated CSS', async () => {
    const { buildThemeCss, setCustomPalette } = await import('./theme');
    setCustomPalette({ themePrimary: '#abc123' });
    try {
      const css = buildThemeCss('light');
      expect(css).toContain('.sp-css-backgroundColor-themePrimary,.ms-bgColor-themePrimary{background-color:#abc123;}');
      // non-overridden tokens keep stock values
      expect(css).toContain('.ms-fontColor-neutralPrimary{color:#323130;}');
    } finally {
      setCustomPalette(null);
    }
  });
});

describe('empty-date semantics (live-verified 2026-06-10)', () => {
  const dctx: EvalContext = { ...ctx, row: { ...ctx.row, EmptyDate: null, EmptyText: '' } as never };

  it("[$EmptyDate]=='' is FALSE — null date cells differ from empty strings", () => {
    expect(evaluate("=if([$EmptyDate]=='','hidden','shown')", dctx)).toBe('shown');
    expect(evaluate("=[$EmptyDate]!=''", dctx)).toBe(true);
  });

  it("empty TEXT cells and absent fields still equal ''", () => {
    expect(evaluate("=[$EmptyText]==''", dctx)).toBe(true);
    expect(evaluate("=[$NoSuchField]==''", dctx)).toBe(true);
  });

  it('toLocaleDateString on an empty date renders empty text, not the epoch', () => {
    expect(evaluate('=toLocaleDateString([$EmptyDate])', dctx)).toBe('');
    expect(evaluate("='Start: '+toLocaleDateString([$EmptyDate])", dctx)).toBe('Start: ');
  });

  it('schema import coerces empty date cells to null', () => {
    const schema = importSchema([
      'Title,text', 'DueDate,date',
    ].join('\n'));
    const rows = buildSampleRows(schema.fields, 1);
    expect(rows[0].DueDate).not.toBeNull(); // generated samples are filled
    // the real check: CSV coercion path
    const out = importSchema(
      'ListSchema=' + JSON.stringify({ schemaXmlList: ['<Field Type="DateTime" Name="Due" DisplayName="Due" />', '<Field Type="Text" Name="T" DisplayName="T" />'] }) +
      '\n"Due","T"\n"","x"\n',
    );
    expect(out.rows?.[0].Due).toBeNull();
    expect(out.rows?.[0].T).toBe('x');
  });
});

describe('linter — empty-date teaching rule', () => {
  it("flags [$DateField]=='' comparisons when field types are known", () => {
    const doc: FormatterDocument = {
      kind: 'column',
      root: { elmType: 'div', style: { display: "=if([$DueDate]=='','none','flex')" }, txtContent: "=if([$Title]=='','x','y')" },
    };
    const issues = lintDocument(doc, ['DueDate', 'Title'], { DueDate: 'date', Title: 'text' })
      .filter((i) => i.rule === 'empty-date-compare');
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain('DueDate');
  });
});

describe('linter — production-bug diagnoses', () => {
  it('flags XML-entity escaped operators (the CSOM double-encoding bug)', () => {
    const doc: FormatterDocument = {
      kind: 'column',
      root: { elmType: 'div', style: { border: "=if([$A.lookupId]==''&amp;&amp;[$B.lookupId]=='','2px solid','none')" } },
    };
    const rules = lintDocument(doc).map((i) => i.rule);
    expect(rules).toContain('xml-entity-escape');
    expect(rules).not.toContain('expr-syntax'); // precise rule supersedes generic
  });

  it("flags a nested '=' inside an expression", () => {
    const doc: FormatterDocument = {
      kind: 'column',
      root: { elmType: 'div', txtContent: "=if([$A]=='x','y',=if([$B]=='z','1','2'))" },
    };
    const issues = lintDocument(doc).filter((i) => i.rule === 'nested-equals');
    expect(issues).toHaveLength(1);
  });

  it("does not false-positive on == != <= >= operators", () => {
    const doc: FormatterDocument = {
      kind: 'column',
      root: { elmType: 'div', txtContent: "=if([$A]=='x'&&[$B]!='y'&&[$C]<=3&&[$D]>=4,'a','b')" },
    };
    expect(lintDocument(doc).filter((i) => i.rule === 'nested-equals')).toHaveLength(0);
  });

  it('explains form-layout and footer-only JSON on import', () => {
    expect(() => importJson(JSON.stringify({ sections: [] }))).toThrow(/form layout/);
    expect(() => importJson(JSON.stringify({ footerFormatter: { elmType: 'div' } }))).toThrow(/footer/);
  });
});

describe('linter — unknown fields', () => {
  it('flags refs missing from the schema but not iterators or known fields', () => {
    const doc: FormatterDocument = {
      kind: 'column',
      root: {
        elmType: 'div',
        txtContent: '=[$Statuss]',
        children: [
          { elmType: 'span', forEach: '_p in [$AssignedTo]', txtContent: '=[$_p.title]' },
          { elmType: 'span', txtContent: '=[$Title]' },
        ],
      },
    };
    const issues = lintDocument(doc, ['Title', 'AssignedTo']).filter((i) => i.rule === 'unknown-field');
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain('[$Statuss]');
  });

  it('skips the check when no schema is provided', () => {
    const doc: FormatterDocument = { kind: 'column', root: { elmType: 'div', txtContent: '=[$Whatever]' } };
    expect(lintDocument(doc).filter((i) => i.rule === 'unknown-field')).toHaveLength(0);
  });
});

describe('serializer', () => {
  it('round-trips a view formatter', () => {
    const doc = importJson(JSON.stringify({
      $schema: 'https://developer.microsoft.com/json-schemas/sp/view-formatting.schema.json',
      hideSelection: true,
      rowFormatter: { elmType: 'div', txtContent: '[$Title]' },
    }));
    expect(doc.kind).toBe('row');
    const out = JSON.parse(exportJson(doc));
    expect(out.rowFormatter.txtContent).toBe('[$Title]');
    expect(out.hideSelection).toBe(true);
  });

  it('CSOM-safe export escapes & and <', () => {
    const doc = importJson(JSON.stringify({ height: 200, width: 300, formatter: { elmType: 'div', txtContent: "=if([$A]>1&&[$B]<2,'x','y')" } }));
    const csom = exportJson(doc, { csomSafe: true });
    expect(csom).not.toMatch(/[&<]/);
    expect(csom).toContain('\\u0026\\u0026');
  });
});

describe('schema import', () => {
  it('maps SP TypeAsString values', () => {
    expect(mapSpFieldType('User')).toBe('person');
    expect(mapSpFieldType('UserMulti')).toBe('personMulti');
    expect(mapSpFieldType('DateTime')).toBe('date');
    expect(mapSpFieldType('MultiChoice')).toBe('choiceMulti');
    expect(mapSpFieldType('Counter')).toBe('number');
    expect(mapSpFieldType('URL')).toBe('hyperlink');
    expect(mapSpFieldType('LookupMulti')).toBe('lookupMulti');
  });

  it('imports Export-ListSchema.ps1 JSON with lookups, protected and sample rows', () => {
    const schema = importSchema(JSON.stringify({
      list: 'Tasks',
      fields: [
        { internalName: 'ID', type: 'Counter', readOnly: true },
        { internalName: 'Title', displayName: 'Task name', type: 'Text' },
        { internalName: 'Project', type: 'Lookup', lookupList: 'Projects', lookupColumn: 'Title' },
        { internalName: 'Severity', type: 'Choice', choices: ['Low', 'High'] },
      ],
      sampleRows: [{ ID: 7, Title: 'Real task', Project: { lookupId: 2, lookupValue: 'Hermes' } }],
    }));
    expect(schema.listName).toBe('Tasks');
    expect(schema.fields.find((f) => f.name === 'ID')?.protected).toBe(true);
    expect(schema.fields.find((f) => f.name === 'Project')?.lookup).toEqual({ list: 'Projects', column: 'Title' });
    expect(schema.fields.find((f) => f.name === 'Severity')?.choices).toEqual(['Low', 'High']);
    expect(schema.rows?.[0].Title).toBe('Real task');
  });

  it('imports hand-written CSV', () => {
    const schema = importSchema([
      'InternalName,Type,DisplayName,LookupList,LookupColumn,Protected,Choices',
      'Title,text,Task name',
      'Status,choice,,,,,"Not started|In progress|Done"',
      'Project,lookup,Project,Projects,Title',
      'AssignedTo,UserMulti',
      'ID,number,,,,yes',
    ].join('\n'));
    expect(schema.fields).toHaveLength(5);
    expect(schema.fields[1].choices).toEqual(['Not started', 'In progress', 'Done']);
    expect(schema.fields[2].lookup?.list).toBe('Projects');
    expect(schema.fields[3].type).toBe('personMulti');
    expect(schema.fields[4].protected).toBe(true);
    const rows = buildSampleRows(schema.fields, 2);
    expect(rows).toHaveLength(2);
    expect(rows[0].Status).toBe('Not started');
  });

  it('rejects internal names with spaces', () => {
    expect(() => importSchema('My Field,text')).toThrow(/spaces/);
  });

  it('imports SharePoint "Export to CSV with schema" files: fields, rows and live formatters', () => {
    const fieldXml = (s: string) => s.replace(/'/g, '"');
    const schema = {
      schemaXmlList: [
        fieldXml("<Field Type='Text' Name='Title' DisplayName='Task name' ReadOnly='FALSE' />"),
        fieldXml("<Field Type='Choice' Name='Status' DisplayName='Status'><CHOICES><CHOICE>Inbox</CHOICE><CHOICE>Working</CHOICE></CHOICES></Field>"),
        fieldXml("<Field Type='UserMulti' Name='Team' DisplayName='Team' />"),
        fieldXml("<Field Type='Counter' Name='ID' DisplayName='ID' ReadOnly='TRUE' />"),
        fieldXml("<Field Type='Text' Name='Secret' DisplayName='Secret' Hidden='TRUE' />"),
        // CustomFormatter JSON arrives XML-entity-encoded
        '<Field Type="Number" Name="Progress" DisplayName="Progress" CustomFormatter="{&quot;elmType&quot;:&quot;div&quot;,&quot;txtContent&quot;:&quot;@currentField&quot;}" />',
      ],
    };
    const text = `ListSchema=${JSON.stringify(schema)}\n` +
      '"Task name","Status","Team","ID","Progress"\n' +
      '"Build the thing","Working","Ada Lovelace; Grace Hopper","7","64"\n' +
      '"Line\nbreak title","Inbox","","8","10"\n';
    const out = importSchema(text);
    expect(out.fields.map((f) => f.name)).toEqual(['Title', 'Status', 'Team', 'ID', 'Progress']);
    expect(out.fields.find((f) => f.name === 'Status')?.choices).toEqual(['Inbox', 'Working']);
    expect(out.fields.find((f) => f.name === 'ID')?.protected).toBe(true);
    expect(out.rows).toHaveLength(2);
    expect(out.rows?.[0].Title).toBe('Build the thing');
    expect((out.rows?.[0].Team as Array<{ title: string }>)).toHaveLength(2);
    expect(out.rows?.[0].Progress).toBe(64);
    expect(out.rows?.[1].Title).toBe('Line\nbreak title'); // quoted newline survives
    expect(out.columnFormatters?.Progress.txtContent).toBe('@currentField');
  });
});

describe('renderer (happy-dom)', () => {
  it('renders a conditional status pill with evaluated styles', () => {
    const pill: SPElement = {
      elmType: 'div',
      txtContent: "=if([$Status]=='','None',[$Status])",
      style: {
        'background-color': "=if([$Status]=='Done','#107c10','#0078d4')",
        'transition': 'all .2s', // unsupported — must be dropped like SP does
        'gap': '4px',            // supported (modern SP allows flex gap)
      },
    };
    const node = renderElement(pill, ctx) as HTMLElement;
    expect(node.textContent).toBe('In Progress');
    expect(node.style.getPropertyValue('background-color')).toBeTruthy();
    expect(node.style.getPropertyValue('transition')).toBe('');
    expect(node.style.getPropertyValue('gap')).toBe('4px');
  });

  it('expands forEach children per item with loopIndex', () => {
    const facepile: SPElement = {
      elmType: 'div',
      children: [{
        elmType: 'span',
        forEach: '_p in [$AssignedTo]',
        txtContent: '=[$_p.title]',
        style: { 'margin-left': "=if(loopIndex('_p')==0,'0','-8px')" },
      }],
    };
    const node = renderElement(facepile, ctx) as HTMLElement;
    const spans = Array.from(node.querySelectorAll('span'));
    expect(spans.map((s) => s.textContent)).toEqual(['Ada Lovelace', 'Grace Hopper']);
    expect((spans[1] as HTMLElement).style.getPropertyValue('margin-left')).toBe('-8px');
  });

  it('resolves columnFormatterReference from a registry, with cycle protection', () => {
    const ref: SPElement = { elmType: 'span', txtContent: '[$Status]' };
    const el: SPElement = { elmType: 'div', columnFormatterReference: '[$StatusUI]' };
    const node = renderElement(el, ctx, { resolveColumnRef: () => ref }) as HTMLElement;
    expect(node.textContent).toBe('In Progress');

    const cyc: SPElement = { elmType: 'div', columnFormatterReference: '[$Loop]' };
    const node2 = renderElement(cyc, ctx, { resolveColumnRef: () => cyc }) as HTMLElement;
    expect(node2.querySelector('.wb-cfr-chip')).toBeTruthy();
  });

  it('@currentField inside a CFR means the REFERENCED column, not the host', () => {
    const progressFormatter: SPElement = { elmType: 'span', txtContent: '@currentField' };
    const host: SPElement = { elmType: 'div', columnFormatterReference: '[$Progress]' };
    // host ctx targets Status — but the referenced formatter must see Progress
    const node = renderElement(host, ctx, { resolveColumnRef: () => progressFormatter }) as HTMLElement;
    expect(node.textContent).toBe('64');
  });

  it('collects runtime issues instead of failing silently', () => {
    const issues: Array<{ path: number[]; message: string }> = [];
    renderElement({ elmType: 'div', txtContent: '=bogusFn(1)' }, ctx, { issues });
    expect(issues.length).toBe(1);
    expect(issues[0].message).toMatch(/bogusFn/);
  });
});
