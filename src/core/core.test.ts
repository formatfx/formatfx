/**
 * Engine tests: expression evaluation, linting, serialization round-trips,
 * schema import (JSON + CSV) and DOM rendering (happy-dom).
 */
import { describe, it, expect } from 'vitest';
import { evaluate, evalAny, parseForEach, evaluateForEachList, type EvalContext } from './expressions';
import { lintDocument, stripExpressionWhitespace, hasUnsafeWhitespace } from './linter';
import { importJson, exportJson } from './serializer';
import { ALLOWED_STYLES, ALLOWED_ATTRIBUTES, STYLE_PROP_DOCS, ATTRIBUTE_DOCS, SP_FUNCTIONS, SP_FUNCTION_DOCS } from './schema';
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
    ["=[$Status]!='Done'", true],
    // lookup field access
    ['=[$Project.lookupValue]', 'Apollo'],
    ["='ID='+[$Project.lookupId]", 'ID=3'],
    ['=[$Project]', { lookupId: 3, lookupValue: 'Apollo' }],
  ];
  for (const [expr, expected] of cases) {
    it(expr, () => expect(evaluate(expr, ctx)).toEqual(expected));
  }

  it("there is no logical NOT — not(), '!' and the AST '!' all throw teaching errors", () => {
    expect(() => evaluate("=not([$Status]=='Done')", ctx)).toThrow(/no logical NOT/);
    expect(() => evaluate("=!([$Status]=='Done')", ctx)).toThrow(/no logical NOT/);
    expect(() => evalAny({ operator: '!', operands: [true] } as never, ctx)).toThrow(/no logical NOT/);
    // '!=' and negative literals are unaffected
    expect(evaluate("=indexOf([$Tags],'web')!=-1", ctx)).toBe(true);
  });

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

describe('expression edge cases', () => {
  it('rejects a malformed multi-dot number instead of silently truncating it', () => {
    // tokenizer used to grab "1.2.3" as one number, then parseFloat → 1.2 (silent)
    expect(() => evaluate('=1.2.3', ctx)).toThrow(/number/i);
    // a normal decimal still parses
    expect(evaluate('=1.5+0.5', ctx)).toBe(2);
  });

  it("hasUnsafeWhitespace flags a stray '\\r' (matching the stripper)", () => {
    expect(hasUnsafeWhitespace('=1\r+2')).toBe(true);
    // and the stripper already removes it — detector and stripper must agree
    expect(stripExpressionWhitespace('=1\r+2')).toBe('=1+2');
  });

  it("'+' treats a blank operand as 0 so a running sum keeps adding", () => {
    const bctx: EvalContext = { ...ctx, row: { ...ctx.row, Blank: '' } as never };
    // a blank number cell ('') in the middle of a sum must not concat-cascade
    expect(evaluate('=5+[$Blank]+3', bctx)).toBe(8);
    // genuine string concat with a non-empty string is preserved (SP overload)
    expect(evaluate("='$'+5", ctx)).toBe('$5');
    // an object operand still concatenates via toStr (person → title)
    expect(evaluate('=[$Owner]+5', ctx)).toBe('Ada Lovelace5');
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
    const issues = lintDocument(doc);
    const rules = issues.map((i) => i.rule);
    for (const expected of ['no-not-function', 'css-unsupported', 'foreach-iterator-underscore', 'zero-whitespace']) {
      expect(rules).toContain(expected);
    }
    // canon correction 2026-06-13: split()+forEach is only fatal on the ROOT
    // element — on a child it works, so the old blanket rule must stay quiet
    expect(rules).not.toContain('foreach-split-scope');
    // whitespace without split() is a precaution, not a verified failure
    expect(issues.find((i) => i.rule === 'zero-whitespace')!.severity).toBe('info');
  });

  it('foreach-split-scope fires on the root element only', () => {
    const doc: FormatterDocument = {
      kind: 'column',
      root: { elmType: 'div', forEach: "_t in split([$Tags],';')", txtContent: '[$_t]' },
    };
    expect(lintDocument(doc).map((i) => i.rule)).toContain('foreach-split-scope');
  });

  it('flags executeFlow with no flow id (flow-missing-id)', () => {
    const doc: FormatterDocument = { kind: 'row', root: { elmType: 'button', customRowAction: { action: 'executeFlow' } } };
    expect(lintDocument(doc).map((i) => i.rule)).toContain('flow-missing-id');
  });

  it('flags setValue with no actionInput (setvalue-missing-target)', () => {
    const doc: FormatterDocument = { kind: 'row', root: { elmType: 'button', customRowAction: { action: 'setValue' } } };
    expect(lintDocument(doc).map((i) => i.rule)).toContain('setvalue-missing-target');
  });

  it('does NOT flag a complete executeFlow', () => {
    const doc: FormatterDocument = { kind: 'row', root: { elmType: 'button', customRowAction: { action: 'executeFlow', actionParams: '{"id":"x"}' } } };
    expect(lintDocument(doc).map((i) => i.rule)).not.toContain('flow-missing-id');
  });

  // pnp/List-Formatting-verified action extras + executeQuickStep (issue #286)

  it('accepts the PnP list-safe actions with no lint noise (copyLink / comment / openApprovalDialog)', () => {
    for (const action of ['copyLink', 'comment', 'openApprovalDialog'] as const) {
      const doc: FormatterDocument = { kind: 'row', root: { elmType: 'button', customRowAction: { action } } };
      expect(lintDocument(doc)).toEqual([]);
    }
  });

  it('teaches that previewFileAction / copyFile / moveFile are library-only (action-library-only, info)', () => {
    for (const action of ['previewFileAction', 'copyFile', 'moveFile'] as const) {
      const doc: FormatterDocument = { kind: 'row', root: { elmType: 'button', customRowAction: { action } } };
      const issue = lintDocument(doc).find((i) => i.rule === 'action-library-only')!;
      // info, not a gate — the tool can't know if this deploys to a library
      expect(issue.severity).toBe('info');
      expect(issue.message).toContain(action);
    }
  });

  it('ALWAYS warns on executeQuickStep — an undocumented identifier (quickstep-undocumented)', () => {
    const doc: FormatterDocument = {
      kind: 'row',
      root: { elmType: 'div', customRowAction: { action: 'executeQuickStep', actionInput: { ruleTemplateId: '42' } } },
    };
    const issues = lintDocument(doc);
    expect(issues.find((i) => i.rule === 'quickstep-undocumented')!.severity).toBe('warning');
    // complete shape: the warning stands alone, no missing-id error
    expect(issues.map((i) => i.rule)).not.toContain('quickstep-missing-id');
  });

  it('flags executeQuickStep with no ruleTemplateId (quickstep-missing-id, error)', () => {
    const shapes: FormatterDocument[] = [
      { kind: 'row', root: { elmType: 'div', customRowAction: { action: 'executeQuickStep' } } },
      { kind: 'row', root: { elmType: 'div', customRowAction: { action: 'executeQuickStep', actionInput: { ruleTemplateId: '  ' } } } },
      // actionInput as a string can't carry the id shape SP expects here
      { kind: 'row', root: { elmType: 'div', customRowAction: { action: 'executeQuickStep', actionInput: 'ruleTemplateId' } } },
    ];
    for (const doc of shapes) {
      const issue = lintDocument(doc).find((i) => i.rule === 'quickstep-missing-id')!;
      expect(issue.severity).toBe('error');
    }
  });

  it('keeps the card-internal path on issues inside customCardProps.formatter (#76)', () => {
    const doc: FormatterDocument = {
      kind: 'column',
      root: {
        elmType: 'div',
        children: [
          { elmType: 'span' },
          {
            elmType: 'div',
            customCardProps: {
              openOnEvent: 'hover',
              formatter: {
                elmType: 'div',
                children: [
                  { elmType: 'span' },
                  { elmType: 'button', customRowAction: { action: 'executeFlow' } },
                ],
              },
            },
          },
        ],
      },
    };
    const issue = lintDocument(doc).find((i) => i.rule === 'flow-missing-id')!;
    expect(issue.message).toMatch(/^\[customCardProps\]/);
    // the path must point at the offending node INSIDE the card (host path +
    // the -1 CARD_SEGMENT + child indices), not at the host element — this is
    // what jsonPanel click-to-select and the CLI's path printout consume
    expect(issue.path).toEqual([1, -1, 1]);
  });

  it('card-trigger-button fires only for CLICK-opened cards — hover is never swallowed by children', () => {
    // the field observation behind the rule is about CLICK swallowing; a
    // hover card on a division with children is the exact shape the #204
    // apply workflow generates, and it works on real SP
    const shape = (openOnEvent: 'click' | 'hover'): FormatterDocument => ({
      kind: 'row',
      root: {
        elmType: 'div',
        customCardProps: { openOnEvent, formatter: { elmType: 'div', txtContent: 'card' } },
        children: [{ elmType: 'span', txtContent: 'x' }],
      },
    });
    expect(lintDocument(shape('click')).map((i) => i.rule)).toContain('card-trigger-button');
    expect(lintDocument(shape('hover')).map((i) => i.rule)).not.toContain('card-trigger-button');
  });

  it('retracted canon stays retracted: inlineEditField-in-forEach is clean', () => {
    const doc: FormatterDocument = {
      kind: 'column',
      root: {
        elmType: 'div',
        children: [
          { elmType: 'div', forEach: '_p in [$AssignedTo]', inlineEditField: '[$AssignedTo]', txtContent: '[$_p.title]' },
        ],
      },
    };
    expect(lintDocument(doc).map((i) => i.rule)).not.toContain('inline-edit-foreach');
  });

  it('hover-child-no-parent: showOnHoverChild with no showOnHoverParent ancestor warns', () => {
    // §3: the child class hides the element until an ANCESTOR carrying the
    // parent class is hovered — with no such ancestor it never appears.
    const orphan: FormatterDocument = {
      kind: 'column',
      root: {
        elmType: 'div',
        children: [{ elmType: 'span', attributes: { class: 'sp-card-showOnHoverChild' }, txtContent: 'hi' }],
      },
    };
    const issue = lintDocument(orphan).find((i) => i.rule === 'hover-child-no-parent')!;
    expect(issue).toBeTruthy();
    expect(issue.severity).toBe('warning');
    expect(issue.path).toEqual([0]);
  });

  it('hover-child-no-parent: the parent class on the SAME element does not count as an ancestor', () => {
    // the reveal selector is a descendant selector — a hidden element can't
    // hover itself, so self-carrying both classes never appears either
    const selfPair: FormatterDocument = {
      kind: 'column',
      root: { elmType: 'div', attributes: { class: 'sp-card-showOnHoverParent sp-card-showOnHoverChild' } },
    };
    expect(lintDocument(selfPair).map((i) => i.rule)).toContain('hover-child-no-parent');
  });

  it('hover pairing is satisfied by any ancestor, including the root', () => {
    const paired: FormatterDocument = {
      kind: 'row',
      root: {
        elmType: 'div',
        attributes: { class: 'sp-card-showOnHoverParent' },
        children: [
          { elmType: 'div', children: [{ elmType: 'span', attributes: { class: 'sp-card-showOnHoverChild' } }] },
        ],
      },
    };
    const rules = lintDocument(paired).map((i) => i.rule);
    expect(rules).not.toContain('hover-child-no-parent');
    expect(rules).not.toContain('hover-parent-no-child');
  });

  it('hover pairing counts classes emitted by =expressions', () => {
    const conditional: FormatterDocument = {
      kind: 'column',
      root: {
        elmType: 'div',
        attributes: { class: "=if([$Status]=='Done','sp-card-showOnHoverParent','')" },
        children: [{ elmType: 'span', attributes: { class: 'sp-card-showOnHoverChild' } }],
      },
    };
    const rules = lintDocument(conditional).map((i) => i.rule);
    expect(rules).not.toContain('hover-child-no-parent');
    expect(rules).not.toContain('hover-parent-no-child');
  });

  it('hover-parent-no-child: a parent with no child anywhere in its subtree is an info', () => {
    const lonely: FormatterDocument = {
      kind: 'column',
      root: {
        elmType: 'div',
        children: [{ elmType: 'div', attributes: { class: 'sp-card-showOnHoverParent' }, txtContent: 'x' }],
      },
    };
    const issue = lintDocument(lonely).find((i) => i.rule === 'hover-parent-no-child')!;
    expect(issue).toBeTruthy();
    expect(issue.severity).toBe('info');
    expect(issue.path).toEqual([0]);
  });

  it('hover pairing does not cross the customCardProps boundary (the card is a separate DOM tree)', () => {
    // a child inside the card formatter is NOT a descendant of the host in the
    // rendered DOM (the card lives in a callout), so the host parent class
    // can't reveal it — and vice versa
    const acrossBoundary: FormatterDocument = {
      kind: 'column',
      root: {
        elmType: 'div',
        attributes: { class: 'sp-card-showOnHoverParent' },
        customCardProps: {
          openOnEvent: 'hover',
          formatter: { elmType: 'div', attributes: { class: 'sp-card-showOnHoverChild' } },
        },
      },
    };
    const rules = lintDocument(acrossBoundary).map((i) => i.rule);
    expect(rules).toContain('hover-parent-no-child');
    expect(rules).toContain('hover-child-no-parent');
  });

  it("no-bang-operator fires on a standalone '!' but never on '!='", () => {
    // §3.1: there is no logical NOT. A standalone '!' before (, [$Field] or @token
    // must be flagged; '!=' (not-equals) is a different, fully-legal operator.
    const bang: FormatterDocument = {
      kind: 'column', root: { elmType: 'div', txtContent: '=![$Flag]' },
    };
    expect(lintDocument(bang).map((i) => i.rule)).toContain('no-bang-operator');

    const notEq: FormatterDocument = {
      kind: 'column', root: { elmType: 'div', txtContent: "=if([$Status]!='Done','a','b')" },
    };
    expect(lintDocument(notEq).map((i) => i.rule)).not.toContain('no-bang-operator');
  });
});

describe('linter — low-contrast (WCAG, core/contrast.ts is the brain)', () => {
  const textEl = (style: Record<string, string>, extra: Partial<SPElement> = {}): FormatterDocument => ({
    kind: 'column',
    root: { elmType: 'div', txtContent: 'hello', style, ...extra },
  });
  const hits = (doc: FormatterDocument) => lintDocument(doc).filter((i) => i.rule === 'low-contrast');

  it('flags an unreadable literal pair as a WARNING (below the 3:1 large-text floor)', () => {
    const issues = hits(textEl({ 'color': '#d13438', 'background-color': '#c50f1f' }));
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('warning');
    expect(issues[0].message).toContain("'#d13438' text on the '#c50f1f' fill");
    expect(issues[0].message).toMatch(/\d\.\d:1/);
  });

  it('flags a borderline pair as INFO (3:1–4.5:1 — fine for large text, not this)', () => {
    const issues = hits(textEl({ 'color': '#0078d4', 'background-color': '#deecf9' }));
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('info');
  });

  it('stays silent on a passing pair and honors the large-text threshold', () => {
    expect(hits(textEl({ 'color': '#ffffff', 'background-color': '#107c10' }))).toHaveLength(0);
    // the same borderline pair passes once the text is WCAG-large (≥24px → 3:1 bar)
    expect(hits(textEl({ 'color': '#0078d4', 'background-color': '#deecf9', 'font-size': '24px' }))).toHaveLength(0);
    // bold 20px is large too (≥18.66px bold)
    expect(hits(textEl({ 'color': '#0078d4', 'background-color': '#deecf9', 'font-size': '20px', 'font-weight': '700' }))).toHaveLength(0);
  });

  it('checks every branch of a conditional fill under constant text', () => {
    const issues = hits(textEl({
      'color': '#ffffff',
      'background-color': "=if([$Status]=='Done','#107c10','#ffffff')",
    }));
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('warning'); // white-on-white branch
    expect(issues[0].message).toContain('when its conditions pick');
  });

  it('pairs two chains positionally when their conditions are IDENTICAL', () => {
    // classic conditional-formatting shape: the same rule drives text and fill
    const ok = textEl({
      'color': "=if([$S]=='a','#ffffff','#323130')",
      'background-color': "=if([$S]=='a','#107c10','#ffffff')",
    });
    expect(hits(ok)).toHaveLength(0); // each branch pair is readable
    const bad = textEl({
      'color': "=if([$S]=='a','#ffffff','#fefefe')",
      'background-color': "=if([$S]=='a','#107c10','#ffffff')",
    });
    expect(hits(bad)).toHaveLength(1); // near-white on white in the else branch
  });

  it('NEVER cross-multiplies chains with different conditions (soundness over coverage)', () => {
    // naive cross-product would scream white-on-white; the branches can't co-occur provably
    const doc = textEl({
      'color': "=if([$S]=='a','#ffffff','#323130')",
      'background-color': "=if([$Other]==1,'#ffffff','#107c10')",
    });
    expect(hits(doc)).toHaveLength(0);
  });

  it('inherits the fill down the tree and resets at the card boundary', () => {
    const inherited: FormatterDocument = {
      kind: 'column',
      root: {
        elmType: 'div',
        style: { 'background-color': '#c50f1f' },
        children: [{ elmType: 'span', txtContent: 'x', style: { 'color': '#d13438' } }],
      },
    };
    const issues = hits(inherited);
    expect(issues).toHaveLength(1);
    expect(issues[0].path).toEqual([0]); // the SPAN, not the container
    // the card renders in its own callout — the host's dark fill doesn't carry in
    const card: FormatterDocument = {
      kind: 'column',
      root: {
        elmType: 'div',
        style: { 'background-color': '#c50f1f' },
        customCardProps: {
          openOnEvent: 'hover',
          formatter: { elmType: 'div', txtContent: 'x', style: { 'color': '#d13438' } },
        },
      },
    };
    expect(hits(card)).toHaveLength(0);
  });

  it("a 'transparent' fill keeps the inherited backdrop", () => {
    const doc: FormatterDocument = {
      kind: 'column',
      root: {
        elmType: 'div',
        style: { 'background-color': '#c50f1f' },
        children: [{
          elmType: 'span', txtContent: 'x',
          style: { 'color': '#d13438', 'background-color': 'transparent' },
        }],
      },
    };
    expect(hits(doc)).toHaveLength(1);
  });

  it('one-sided cases flag only when BOTH stock themes fail', () => {
    // mid-gray text on the bare list surface: ~3.9:1 light AND ~4.2:1 dark → info
    const bothFail = hits(textEl({ 'color': '#808080' }));
    expect(bothFail).toHaveLength(1);
    expect(bothFail[0].severity).toBe('info');
    expect(bothFail[0].message).toContain('BOTH stock themes');
    // yellow text is unreadable on light but fine on dark → a tenant theme decides; stay silent
    expect(hits(textEl({ 'color': '#ffb900' }))).toHaveLength(0);
    // mid-gray fill under the default text color fails both → info; a dark fill
    // only fails the light theme's dark text → silent
    expect(hits(textEl({ 'background-color': '#808080' }))).toHaveLength(1);
    expect(hits(textEl({ 'background-color': '#605e5c' }))).toHaveLength(0);
  });

  it('honest silence: theme classes, background-image, unresolvable values, icons', () => {
    // an sp-css fill class paints something the linter can't resolve
    expect(hits(textEl({ 'color': '#ffffff' }, { attributes: { class: 'sp-css-backgroundColor-blueBackground37' } }))).toHaveLength(0);
    // a background-image under gray text: the image decides, not the surface
    expect(hits(textEl({ 'color': '#808080', 'background-image': 'url(x.png)' }))).toHaveLength(0);
    // a field-driven color could be anything
    expect(hits(textEl({ 'color': '=[$BrandColor]', 'background-color': '#ffffff' }))).toHaveLength(0);
    // no text, no problem (icon dots pair colors without prose)
    const dot: FormatterDocument = {
      kind: 'column',
      root: { elmType: 'div', style: { 'color': '#d13438', 'background-color': '#c50f1f' } },
    };
    expect(hits(dot)).toHaveLength(0);
    // links and buttons carry their own theme ink — no default-text judgment
    expect(hits({ kind: 'column', root: { elmType: 'button', txtContent: 'Go', style: { 'background-color': '#808080' } } })).toHaveLength(0);
  });

  it('reads the legacy object syntax too', () => {
    const doc: FormatterDocument = {
      kind: 'column',
      root: {
        elmType: 'div', txtContent: 'x',
        style: {
          'color': '#ffffff',
          'background-color': { operator: '?', operands: [{ operator: '==', operands: ['@currentField', 'Done'] }, '#107c10', '#ffffff'] },
        },
      },
    };
    const issues = hits(doc);
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('warning');
  });

  it('review fixes hold (Copilot round, PR #310)', () => {
    // (1) an image paints OVER a background-color fallback — together they stay unknown
    expect(hits(textEl({ 'color': '#ffffff', 'background-color': '#ffffff', 'background-image': 'url(x.png)' }))).toHaveLength(0);
    // (2) a button's theme ink covers text in child spans too…
    const buttonChild: FormatterDocument = {
      kind: 'column',
      root: {
        elmType: 'button',
        style: { 'background-color': '#808080' },
        children: [{ elmType: 'span', txtContent: 'Go' }],
      },
    };
    expect(hits(buttonChild)).toHaveLength(0);
    // …but an AUTHORED button ink is judged like any other pair
    expect(hits({
      kind: 'column',
      root: { elmType: 'button', txtContent: 'Go', style: { 'color': '#d13438', 'background-color': '#c50f1f' } },
    })).toHaveLength(1);
    // (3) a conditional 'transparent' branch RESOLVES to a known opaque backdrop
    const condTransparent: FormatterDocument = {
      kind: 'column',
      root: {
        elmType: 'div',
        style: { 'background-color': '#ffffff' },
        children: [{
          elmType: 'span', txtContent: 'x',
          style: { 'color': '#ffffff', 'background-color': "=if([$Done],'transparent','#000000')" },
        }],
      },
    };
    const resolved = hits(condTransparent);
    expect(resolved).toHaveLength(1); // white-on-white through the transparent branch
    expect(resolved[0].severity).toBe('warning');
    // (4) the WORST pair leads the message even when traversal finds it last
    const [ordered] = hits(textEl({
      'color': '#ffffff',
      'background-color': "=if([$A]==1,'#909090',if([$A]==2,'#8c8c8c','#ffffff'))",
    }));
    expect(ordered.severity).toBe('warning');
    expect(ordered.message.indexOf("'#ffffff' fill")).toBeLessThan(ordered.message.indexOf("'#909090'"));
    // (5) 'bolder' is relative, not bold — it must not unlock the 3:1 bar
    expect(hits(textEl({ 'color': '#0078d4', 'background-color': '#deecf9', 'font-size': '20px', 'font-weight': 'bolder' }))).toHaveLength(1);
  });

  it('models literal group opacity — deliberately faded text is measured as rendered (Copilot round 2)', () => {
    // strong green at 0.6 blends below 3:1 on BOTH stock surfaces → warning
    const faded = hits(textEl({ 'color': '#107c10', 'opacity': '0.6' }));
    expect(faded).toHaveLength(1);
    expect(faded[0].severity).toBe('warning');
    // at 0.75 (the shipped strike fade) it clears 3:1 everywhere → info at worst
    const gentle = hits(textEl({ 'color': '#107c10', 'opacity': '0.75' }));
    expect(gentle).toHaveLength(1);
    expect(gentle[0].severity).toBe('info');
    // full opacity: green on the light surface is 5.3:1 → silent
    expect(hits(textEl({ 'color': '#107c10', 'opacity': '1' }))).toHaveLength(0);
    // a fill inside the translucent group blends with the group base too:
    // 50% black over white = mid gray; white text stays white (blended with
    // the same white base) → ~3.9:1 → info, measured exactly as rendered
    const glassCard: FormatterDocument = {
      kind: 'column',
      root: {
        elmType: 'div',
        style: { 'background-color': '#ffffff' },
        children: [{
          elmType: 'span', txtContent: 'x',
          style: { 'opacity': '0.5', 'background-color': '#000000', 'color': '#ffffff' },
        }],
      },
    };
    const glassed = hits(glassCard);
    expect(glassed).toHaveLength(1);
    expect(glassed[0].severity).toBe('info');
    // FORMULA opacity is ignored, not silenced: blending only lowers contrast,
    // so the underlying red-on-red failure is still a true failure
    const formulaOp = hits(textEl({
      'color': '#d13438', 'background-color': '#c50f1f',
      'opacity': "=if([$Done],'0.5','1')",
    }));
    expect(formulaOp).toHaveLength(1);
    expect(formulaOp[0].severity).toBe('warning');
    // opacity 0 hides the subtree — invisibility is not a contrast problem
    expect(hits(textEl({ 'color': '#d13438', 'background-color': '#c50f1f', 'opacity': '0' }))).toHaveLength(0);
  });

  it('the product palettes practice what the rule preaches (status pill grays pass)', () => {
    // #605e5c replaced #737a7f under white pill text — pin it above 4.5:1
    const issues = hits(textEl({
      'color': '#ffffff', 'font-size': '12px', 'font-weight': '600',
      'background-color': "=if([$Status]=='Done','#107c10',if([$Status]=='Blocked','#d13438',if([$Status]=='In Progress','#0078d4','#605e5c')))",
    }));
    expect(issues).toHaveLength(0);
  });
});

describe('linter — function catalog (arg-count + unknown name)', () => {
  const lint = (expr: string) =>
    lintDocument({ kind: 'column', root: { elmType: 'div', txtContent: expr } }).map((i) => i.rule);

  it('flags a known function called with too few arguments', () => {
    expect(lint('=pow(2)')).toContain('fn-arg-count');
    expect(lint("=if([$Status]=='Done')")).toContain('fn-arg-count');
  });

  it('flags a known function called with too many arguments', () => {
    expect(lint("=substring('DogFood',3,6,9)")).toContain('fn-arg-count');
  });

  it('accepts valid arity, including documented optional arguments', () => {
    expect(lint("=if([$Status]=='Done','#107c10','#a80000')")).not.toContain('fn-arg-count');
    expect(lint("=substring('DogFood',3)")).not.toContain('fn-arg-count'); // end is optional (2–3)
    expect(lint("=padStart('7',3)")).not.toContain('fn-arg-count');        // pad string optional (2–3)
  });

  it('flags an unknown / miscapitalized function name', () => {
    expect(lint("=upper('x')")).toContain('fn-unknown');        // it is toUpperCase
    expect(lint("=Substring('x',0,1)")).toContain('fn-unknown'); // case-sensitive
  });

  it('leaves valid calls (and the dedicated not() rule) alone', () => {
    expect(lint("=toUpperCase('x')")).not.toContain('fn-unknown');
    expect(lint("=join(@currentField,', ')")).not.toContain('fn-arg-count');
    // not() is owned by no-not-function, not double-reported as fn-unknown
    const notRules = lint("=not([$Flag])");
    expect(notRules).toContain('no-not-function');
    expect(notRules).not.toContain('fn-unknown');
  });

  it('checks nested calls too', () => {
    expect(lint("=if([$x]=='a',toUpperCase('y','z'),'')")).toContain('fn-arg-count');
  });
});

describe('schema docs — function catalog', () => {
  it('every SP_FUNCTIONS name has a catalog entry, and vice-versa', () => {
    for (const fn of SP_FUNCTIONS) {
      expect(SP_FUNCTION_DOCS[fn], `missing SP_FUNCTION_DOCS entry for "${fn}"`).toBeTruthy();
    }
    for (const fn of Object.keys(SP_FUNCTION_DOCS)) {
      expect((SP_FUNCTIONS as readonly string[]).includes(fn), `SP_FUNCTION_DOCS has "${fn}" but SP_FUNCTIONS does not`).toBe(true);
    }
  });

  it('every entry has a signature, summary, example and a sane arity range', () => {
    for (const [fn, doc] of Object.entries(SP_FUNCTION_DOCS)) {
      expect(doc.signature, `${fn} signature`).toBeTruthy();
      expect(doc.summary, `${fn} summary`).toBeTruthy();
      expect(doc.example.startsWith('='), `${fn} example should be an =expression`).toBe(true);
      expect(doc.minArgs, `${fn} minArgs`).toBeGreaterThanOrEqual(1);
      expect(doc.maxArgs, `${fn} maxArgs`).toBeGreaterThanOrEqual(doc.minArgs);
    }
  });

  it('summary prose carries no word-internal apostrophes (the example-chip parser splits on them)', () => {
    for (const [fn, doc] of Object.entries(SP_FUNCTION_DOCS)) {
      expect(/[A-Za-z]'[A-Za-z]/.test(doc.summary), `"${fn}" summary has a prose apostrophe: ${doc.summary}`).toBe(false);
    }
  });

  it('every catalog example lints clean (no syntax, arity or unknown-name errors)', () => {
    for (const [fn, doc] of Object.entries(SP_FUNCTION_DOCS)) {
      const rules = lintDocument({ kind: 'column', root: { elmType: 'div', txtContent: doc.example } }).map((i) => i.rule);
      for (const bad of ['expr-syntax', 'fn-arg-count', 'fn-unknown']) {
        expect(rules, `"${fn}" example "${doc.example}" should not raise ${bad}`).not.toContain(bad);
      }
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

  it("'&&' and '||' short-circuit and '||' yields the first truthy operand", () => {
    // boom would throw (no logical NOT in the AST form) if it were ever reached —
    // its survival proves the later operands are not evaluated.
    const boom = { operator: '!', operands: [true] };

    // || returns the first TRUTHY operand value (not a coerced boolean) and skips the rest
    expect(evalAny({ operator: '||', operands: [false, 'first', boom] } as never, ctx)).toBe('first');
    // && returns false at the first falsy operand and skips the rest
    expect(evalAny({ operator: '&&', operands: [false, boom] } as never, ctx)).toBe(false);
    // sanity: the throwing operand really would throw if evaluated
    expect(() => evalAny(boom as never, ctx)).toThrow(/no logical NOT/);
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

  it('sp-row-* and sp-field classes render SP-faithfully in both modes (pnp-compare findings 10-12)', async () => {
    const { buildThemeCss } = await import('./theme');
    for (const mode of ['light', 'dark'] as const) {
      const css = buildThemeCss(mode);
      // the multi-line row-card family exists with card chrome
      expect(css).toMatch(/\.sp-row-card\{[^}]*border:1px solid/);
      expect(css).toMatch(/\.sp-row-card\{[^}]*padding:/);
      expect(css).toMatch(/\.sp-row-title\{[^}]*font-weight:600/);
      expect(css).toMatch(/\.sp-row-listPadding\{[^}]*padding:/);
      expect(css).toMatch(/\.sp-row-button\{[^}]*cursor:pointer/);
      // severity--low is untinted on real SP; dataBars are the light tint
      expect(css).toContain('.sp-field-severity--low{background:transparent;}');
      expect(css).toMatch(/\.sp-field-dataBars\{background:#[0-9a-f]{6}/);
    }
    // the bar follows the palette's LIGHT slot with readable body text per
    // mode (light: light-blue bar + dark text — the SP pairing the pnp
    // screenshot shows; dark: dark-blue bar + light text)
    expect(buildThemeCss('light')).toContain('.sp-field-dataBars{background:#c7e0f4;color:#323130');
    expect(buildThemeCss('dark')).toContain('.sp-field-dataBars{background:#004c87;color:#ffffff');
  });
});

describe('tileProps wrapper import (pnp-compare finding 13)', () => {
  it('imports the modern tileProps view-formatting shape as a tile doc', () => {
    const doc = importJson(JSON.stringify({
      $schema: 'https://developer.microsoft.com/json-schemas/sp/view-formatting.schema.json',
      hideSelection: true,
      tileProps: { height: 220, width: 254, formatter: { elmType: 'div', txtContent: '[$Title]' } },
    }));
    expect(doc.kind).toBe('tile');
    expect(doc.root.elmType).toBe('div');
    expect(doc.tileWidth).toBe(254);
    expect(doc.tileHeight).toBe(220);
    expect(doc.hideSelection).toBe(true);
  });

  it('keeps the legacy bare tile shape working', () => {
    const doc = importJson(JSON.stringify({ height: 200, width: 250, formatter: { elmType: 'div' } }));
    expect(doc.kind).toBe('tile');
    expect(doc.tileHeight).toBe(200);
  });

  it('coerces "286"-style numeric-string tile dimensions (the pnp event-tiles shape)', () => {
    const doc = importJson(JSON.stringify({
      tileProps: { height: '352', width: '286', formatter: { elmType: 'div' } },
    }));
    expect(doc.tileWidth).toBe(286);
    expect(doc.tileHeight).toBe(352);
    // junk dimensions drop to undefined so the stock default applies
    const junk = importJson(JSON.stringify({ height: 'tall', width: 250, formatter: { elmType: 'div' } }));
    expect(junk.tileHeight).toBeUndefined();
    expect(junk.tileWidth).toBe(250);
  });

  it('unmodeled tileProps-INTERIOR keys keep their nesting through the round trip (modern shape back out)', () => {
    const src = {
      $schema: 'https://developer.microsoft.com/json-schemas/sp/view-formatting.schema.json',
      tileProps: { height: 200, width: 250, someFutureKey: { a: 1 }, formatter: { elmType: 'div' } },
    };
    const doc = importJson(JSON.stringify(src));
    expect((doc.viewExtras?.tileProps as Record<string, unknown>).someFutureKey).toEqual({ a: 1 });
    const out = JSON.parse(exportJson(doc));
    // the key stays INSIDE tileProps — never relocated to the wrapper top
    expect(out.tileProps.someFutureKey).toEqual({ a: 1 });
    expect(out.someFutureKey).toBeUndefined();
    expect(out.tileProps.formatter.elmType).toBe('div');
    expect(importJson(JSON.stringify(out)).viewExtras?.tileProps).toEqual({ someFutureKey: { a: 1 } });
  });

  it('carries tile wrapper siblings (groupProps etc.) through import → export', () => {
    const src = {
      $schema: 'https://developer.microsoft.com/json-schemas/sp/view-formatting.schema.json',
      groupProps: { headerFormatter: { elmType: 'div', txtContent: '@group.count' } },
      tileProps: { height: 200, width: 250, formatter: { elmType: 'div' } },
    };
    const doc = importJson(JSON.stringify(src));
    expect(doc.viewExtras?.groupProps).toEqual(src.groupProps);
    const out = JSON.parse(exportJson(doc));
    expect(out.groupProps).toEqual(src.groupProps); // never silently destroyed
    // and re-importing the export keeps them again
    expect(importJson(JSON.stringify(out)).viewExtras?.groupProps).toEqual(src.groupProps);
  });
});

describe('linter — additionalRowClass vs rowFormatter mutual exclusivity', () => {
  it('warns when a row doc carries viewExtras.additionalRowClass (SP ignores it)', () => {
    const doc: FormatterDocument = {
      kind: 'row',
      root: { elmType: 'div', txtContent: '[$Title]' },
      viewExtras: { additionalRowClass: "=if(@rowIndex%2==0,'ms-bgColor-themeLighter','')" },
    };
    const hits = lintDocument(doc).filter((i) => i.rule === 'rowclass-with-rowformatter');
    expect(hits).toHaveLength(1);
    expect(hits[0].severity).toBe('warning');
    expect(hits[0].message).toContain('IGNORED');
  });

  it('fires on grid docs too (they export as rowFormatter views)', () => {
    const doc: FormatterDocument = {
      kind: 'grid',
      root: { elmType: 'div', children: [{ elmType: 'div', txtContent: '[$Title]' }] },
      viewExtras: { additionalRowClass: 'zebra' },
    };
    expect(lintDocument(doc).map((i) => i.rule)).toContain('rowclass-with-rowformatter');
  });

  it('stays quiet without the class, and on non-view docs', () => {
    expect(lintDocument({ kind: 'row', root: { elmType: 'div' } })
      .filter((i) => i.rule === 'rowclass-with-rowformatter')).toHaveLength(0);
    expect(lintDocument({ kind: 'column', root: { elmType: 'div' } })
      .filter((i) => i.rule === 'rowclass-with-rowformatter')).toHaveLength(0);
  });
});

describe('SP numeric/date coercion + accessors (pnp-compare findings)', () => {
  // Real-SP behaviors verified against pnp/List-Formatting samples that work
  // on live tenants (e2e/pnp-compare/FINDINGS.md, 2026-07-17 sweep).
  const pctx: EvalContext = {
    ...ctx,
    row: {
      ...ctx.row,
      Born: '1997-06-10', Died: '2017-12-21',
      Letters: 'A;#B;#C',
      Vendor: { lookupId: 3, lookupValue: 'Contoso Ltd' },
      Score: 1234.5,
      Notes: 'A;#B literal in plain text',
      Code: '2026-07-10',
    },
    // type-aware normalization: string SHAPE alone never decides (a text
    // cell containing ';#' or an ISO-looking date keeps its literal value)
    fieldTypes: {
      Born: 'date', Died: 'date', Letters: 'choiceMulti', Vendor: 'lookup',
      Score: 'number', Progress: 'number', Notes: 'text', Code: 'text',
      Title: 'text', AssignedTo: 'personMulti',
    },
  };

  it('Number() on an ISO date string returns epoch ms (the day-counter idiom)', () => {
    expect(evaluate('=Number([$Born])', pctx)).toBe(new Date('1997-06-10').getTime());
    expect(evaluate('=floor((Number([$Died])-Number([$Born]))/(1000*60*60*24*365))', pctx)).toBe(20);
    // non-date strings keep parseFloat semantics
    expect(evaluate("=Number('12px')", pctx)).toBe(12);
  });

  it('subtracting two date-string fields yields their ms difference', () => {
    const ms = new Date('2017-12-21').getTime() - new Date('1997-06-10').getTime();
    expect(evaluate('=[$Died]-[$Born]', pctx)).toBe(ms);
  });

  it('.length property accessor works on strings and arrays (colored-pills sample)', () => {
    expect(evaluate('=[$Vendor.lookupValue.length]', pctx)).toBe(11);
    expect(evaluate('=[$AssignedTo.length]', pctx)).toBe(2);
    expect(evaluate('=[$Title.length]', pctx)).toBe('Launch new intranet'.length);
  });

  it("forEach and length() treat choiceMulti cells as the choice list (type-aware, not by string shape)", () => {
    expect(evaluateForEachList('[$Letters]', pctx)).toEqual(['A', 'B', 'C']);
    expect(evaluate('=length([$Letters])', pctx)).toBe(3);
    // plain strings keep their character length
    expect(evaluate('=length([$Title])', pctx)).toBe(19);
    // a TEXT cell that merely contains ';#' stays scalar — no splitting
    expect(evaluateForEachList('[$Notes]', pctx)).toEqual(['A;#B literal in plain text']);
    expect(evaluate('=length([$Notes])', pctx)).toBe('A;#B literal in plain text'.length);
    // and a string LITERAL is never a choice list
    expect(evaluate("=length('A;#B')", pctx)).toBe(4);
  });

  it('toLocaleString on a number formats the number, not a date', () => {
    expect(evaluate('=toLocaleString([$Score])', pctx)).toBe((1234.5).toLocaleString());
    expect(evaluate('=toLocaleString([$Progress])', pctx)).toBe('64');
  });

  it('.displayValue approximates the display string by FIELD type', () => {
    expect(evaluate('=[$Progress.displayValue]', pctx)).toBe('64');
    expect(evaluate('=[$Score.displayValue]', pctx)).toBe((1234.5).toLocaleString());
    // a DATE field's string formats as a locale date…
    expect(evaluate('=[$Born.displayValue]', pctx)).toBe(new Date('1997-06-10').toLocaleDateString());
    // …but a TEXT field whose value merely looks like a date keeps its text
    expect(evaluate('=[$Code.displayValue]', pctx)).toBe('2026-07-10');
    expect(evaluate('=@currentField.displayValue', { ...pctx, currentFieldName: 'Score' })).toBe((1234.5).toLocaleString());
  });
});

describe('blank-cell semantics', () => {
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
    // the missing column's name rides as structured data — the lint UI groups
    // the per-reference flood into one row per column on it
    expect(issues[0].field).toBe('Statuss');
  });

  it('skips the check when no schema is provided', () => {
    const doc: FormatterDocument = { kind: 'column', root: { elmType: 'div', txtContent: '=[$Whatever]' } };
    expect(lintDocument(doc).filter((i) => i.rule === 'unknown-field')).toHaveLength(0);
  });
});

describe('linter — columnFormatterReference', () => {
  const cfrDoc = (cfr: string): FormatterDocument => ({
    kind: 'row',
    root: {
      elmType: 'div',
      children: [{ columnFormatterReference: cfr } as unknown as SPElement],
    },
  });

  it('stands in for elmType — no elmType-required error on a CFR element', () => {
    const issues = lintDocument(cfrDoc('[$Status]'), ['Status']);
    expect(issues.filter((i) => i.rule === 'elmType-required')).toHaveLength(0);
    expect(issues.filter((i) => i.severity === 'error')).toHaveLength(0); // deploys stay unblocked
  });

  it('teaches that the preview cannot resolve the reference (info, per element)', () => {
    const issues = lintDocument(cfrDoc('[$Status]'), ['Status']);
    const info = issues.filter((i) => i.rule === 'cfr-not-emulated');
    expect(info).toHaveLength(1);
    expect(info[0].severity).toBe('info');
    expect(info[0].path).toEqual([0]);
  });

  it('checks the referenced column against the schema — grouped like any missing column', () => {
    for (const form of ['[$Regionn]', 'Regionn', '$Regionn']) {
      const issues = lintDocument(cfrDoc(form), ['Status']).filter((i) => i.rule === 'unknown-field');
      expect(issues).toHaveLength(1);
      expect(issues[0].field).toBe('Regionn');
      expect(issues[0].message).toContain('columnFormatterReference');
    }
    expect(lintDocument(cfrDoc('[$Status]'), ['Status']).filter((i) => i.rule === 'unknown-field')).toHaveLength(0);
  });

  it('an empty or non-string reference still demands elmType', () => {
    const issues = lintDocument(cfrDoc('  '), ['Status']);
    expect(issues.filter((i) => i.rule === 'elmType-required')).toHaveLength(1);
  });
});

describe('serializer', () => {
  it('round-trips a view formatter', () => {
    const doc = importJson(JSON.stringify({
      $schema: 'https://developer.microsoft.com/json-schemas/sp/v2/view-formatting.schema.json',
      hideSelection: true,
      rowFormatter: { elmType: 'div', txtContent: '[$Title]' },
    }));
    expect(doc.kind).toBe('row');
    const out = JSON.parse(exportJson(doc));
    expect(out.rowFormatter.txtContent).toBe('[$Title]');
    expect(out.hideSelection).toBe(true);
  });

  it('preserves footer/group/commandBar siblings of a rowFormatter across import → export', () => {
    const doc = importJson(JSON.stringify({
      $schema: 'https://developer.microsoft.com/json-schemas/sp/v2/view-formatting.schema.json',
      hideSelection: true,
      footerFormatter: { elmType: 'div', txtContent: "='Total: '+[$Amount]" },
      groupProps: { menuActionOverrides: [{ key: 'collapseAll' }] },
      commandBarProps: { commands: [{ key: 'new', hide: true }] },
      additionalRowClass: 'my-row-class',
      hideListHeader: true,
      rowFormatter: { elmType: 'div', txtContent: '[$Title]' },
    }));
    expect(doc.kind).toBe('row');
    const out = JSON.parse(exportJson(doc));
    // the editable parts still work
    expect(out.rowFormatter.txtContent).toBe('[$Title]');
    expect(out.hideSelection).toBe(true);
    // the parts we cannot edit survive verbatim instead of being dropped
    expect(out.footerFormatter).toEqual({ elmType: 'div', txtContent: "='Total: '+[$Amount]" });
    expect(out.groupProps).toEqual({ menuActionOverrides: [{ key: 'collapseAll' }] });
    expect(out.commandBarProps).toEqual({ commands: [{ key: 'new', hide: true }] });
    expect(out.additionalRowClass).toBe('my-row-class');
    expect(out.hideListHeader).toBe(true);
  });

  it('CSOM-safe export escapes & and <', () => {
    const doc = importJson(JSON.stringify({ height: 200, width: 300, formatter: { elmType: 'div', txtContent: "=if([$A]>1&&[$B]<2,'x','y')" } }));
    const csom = exportJson(doc, { csomSafe: true });
    expect(csom).not.toMatch(/[&<]/);
    expect(csom).toContain('\\u0026\\u0026');
  });

  it('_elmName survives import and export by default; keepMeta:false strips (clean is opt-in)', () => {
    const doc = importJson(JSON.stringify({
      elmType: 'div', _elmName: 'Card',
      children: [{ elmType: 'span', _elmName: 'Label', txtContent: '[$Title]' }],
    }));
    expect(doc.root._elmName).toBe('Card');
    expect(doc.root.children?.[0]._elmName).toBe('Label');
    const kept = JSON.parse(exportJson(doc));
    expect(kept._elmName).toBe('Card');
    expect(kept.children[0]._elmName).toBe('Label');
    expect(exportJson(doc, { keepMeta: false })).not.toContain('_elmName');
  });

  it('_component instance provenance ships by default and strips with keepMeta:false (like _elmName)', () => {
    const doc = importJson(JSON.stringify({
      elmType: 'div', _component: { id: 'c-1', map: { Due: 'DueDate' } },
      children: [{ elmType: 'span', txtContent: '[$DueDate]' }],
    }));
    // round-trips through the JSON tab: import keeps it, default export ships it
    expect(doc.root._component).toEqual({ id: 'c-1', map: { Due: 'DueDate' } });
    const kept = JSON.parse(exportJson(doc));
    expect(kept._component).toEqual({ id: 'c-1', map: { Due: 'DueDate' } });
    expect(exportJson(doc, { keepMeta: false })).not.toContain('_component');
  });
});

describe('schema docs', () => {
  it('every allow-listed style property has an ⓘ explanation', () => {
    for (const prop of ALLOWED_STYLES) {
      expect(STYLE_PROP_DOCS[prop], `missing STYLE_PROP_DOCS entry for "${prop}"`).toBeTruthy();
    }
  });
  it('every allow-listed attribute has an ⓘ explanation', () => {
    for (const attr of ALLOWED_ATTRIBUTES) {
      expect(ATTRIBUTE_DOCS[attr], `missing ATTRIBUTE_DOCS entry for "${attr}"`).toBeTruthy();
    }
  });

  it("doc prose never contains word-internal apostrophes (they desync the 'example' chip parser)", () => {
    for (const [prop, doc] of [...Object.entries(STYLE_PROP_DOCS), ...Object.entries(ATTRIBUTE_DOCS)]) {
      expect(/[A-Za-z]'[A-Za-z]/.test(doc), `"${prop}" doc has a prose apostrophe: ${doc}`).toBe(false);
    }
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

  it('coerces an empty multi-value cell exported as the literal "[]" to []', () => {
    const fieldXml = (s: string) => s.replace(/'/g, '"');
    const schema = {
      schemaXmlList: [
        fieldXml("<Field Type='UserMulti' Name='Team' DisplayName='Team' />"),
        fieldXml("<Field Type='LookupMulti' Name='Projects' DisplayName='Projects' />"),
      ],
    };
    // SP exports an empty multi-lookup/multi-user as the literal string "[]"
    const text = `ListSchema=${JSON.stringify(schema)}\n` +
      '"Team","Projects"\n' +
      '"[]","[]"\n';
    const out = importSchema(text);
    expect(out.rows?.[0].Team).toEqual([]);
    expect(out.rows?.[0].Projects).toEqual([]);
  });

  // the List Snapshot happy path (incl. OData row coercion and the
  // generator→parser round trip) lives in src/bridge/bridge.test.ts —
  // these are the parser's edges
  it('list snapshot: hidden fields skipped, view formatters kept as raw text', () => {
    const out = importSchema(JSON.stringify({
      formatfx: 'list-snapshot', version: 1, list: 'Tasks',
      fields: [
        { internalName: 'Title', type: 'Text' },
        { internalName: 'Ghost', type: 'Text', hidden: true },
        { internalName: 'Broken', type: 'Text', customFormatter: '{not json' },
      ],
      views: [{ title: 'All Items', isDefault: true, customFormatter: '{"rowFormatter":{"elmType":"div"}}' }],
    }));
    expect(out.fields.map((f) => f.name)).toEqual(['Title', 'Broken']);
    // an unparseable column formatter never blocks the field import
    expect(out.columnFormatters).toBeUndefined();
    expect(out.views?.[0].customFormatter).toBe('{"rowFormatter":{"elmType":"div"}}');
    expect(out.listName).toBe('Tasks');
  });

  it('list snapshot: future versions refuse with teaching copy; empty refuses too', () => {
    expect(() => importSchema(JSON.stringify({ formatfx: 'list-snapshot', version: 99, fields: [] })))
      .toThrow(/newer than this app understands/);
    expect(() => importSchema(JSON.stringify({ formatfx: 'list-snapshot', version: 1 })))
      .toThrow(/no "fields" array/);
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

  it('inlineEditField indicator is legible: names the column so the maker sees the action took (#212)', () => {
    const el: SPElement = { elmType: 'div', txtContent: '[$Title]', inlineEditField: '[$Title]' };
    const node = renderElement(el, ctx) as HTMLElement;
    expect(node.classList.contains('wb-inline-edit')).toBe(true);
    expect(node.getAttribute('title')).toBe('double-click to edit Title');
    // a non-FieldRef value stays the honest raw readout
    const raw = renderElement({ elmType: 'div', inlineEditField: '@currentField' } as SPElement, ctx) as HTMLElement;
    expect(raw.getAttribute('title')).toBe('inlineEditField: @currentField');
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

  it('collects runtime issues instead of failing silently', () => {
    const issues: Array<{ path: number[]; message: string }> = [];
    renderElement({ elmType: 'div', txtContent: '=bogusFn(1)' }, ctx, { issues });
    expect(issues.length).toBe(1);
    expect(issues[0].message).toMatch(/bogusFn/);
  });

  it('drops attributes outside the SP allow-list, including on* event handlers', () => {
    const el: SPElement = {
      elmType: 'div',
      txtContent: 'hi',
      attributes: {
        onclick: 'alert(1)', onerror: 'alert(2)', onmouseover: 'alert(3)',
        title: 'kept', class: 'kept-class', 'aria-label': 'Status',
      },
    };
    const node = renderElement(el, ctx) as HTMLElement;
    // event-handler attributes never reach the DOM
    expect(node.getAttribute('onclick')).toBeNull();
    expect(node.getAttribute('onerror')).toBeNull();
    expect(node.getAttribute('onmouseover')).toBeNull();
    // allow-listed attributes (and aria-*) still render
    expect(node.getAttribute('title')).toBe('kept');
    expect(node.classList.contains('kept-class')).toBe(true);
    expect(node.getAttribute('aria-label')).toBe('Status');
  });

  it('blocks javascript:/data:text URLs in href and src but keeps safe and image-data ones', () => {
    const js: SPElement = { elmType: 'a', txtContent: 'go', attributes: { href: 'javascript:alert(1)' } };
    expect((renderElement(js, ctx) as HTMLElement).getAttribute('href')).toBeNull();
    // control-char obfuscation of the scheme is defeated too
    const obf: SPElement = { elmType: 'a', txtContent: 'go', attributes: { href: 'java\nscript:alert(1)' } };
    expect((renderElement(obf, ctx) as HTMLElement).getAttribute('href')).toBeNull();
    const htmlData: SPElement = { elmType: 'img', attributes: { src: 'data:text/html,<script>alert(1)</script>' } };
    expect((renderElement(htmlData, ctx) as HTMLElement).getAttribute('src')).toBeNull();
    // safe URLs survive: absolute, relative, and the avatar generator's image data URI
    const https: SPElement = { elmType: 'a', txtContent: 'go', attributes: { href: 'https://example.com/x' } };
    expect((renderElement(https, ctx) as HTMLElement).getAttribute('href')).toBe('https://example.com/x');
    const rel: SPElement = { elmType: 'a', txtContent: 'go', attributes: { href: '/sites/team/page.aspx' } };
    expect((renderElement(rel, ctx) as HTMLElement).getAttribute('href')).toBe('/sites/team/page.aspx');
    const avatar: SPElement = { elmType: 'img', attributes: { src: 'data:image/svg+xml,%3Csvg%3E%3C/svg%3E' } };
    expect((renderElement(avatar, ctx) as HTMLElement).getAttribute('src')).toContain('data:image/svg+xml');
  });
});
