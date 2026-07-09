/**
 * jsonComplete.test.ts — the super-contextual completion brain (#244).
 * Contract: completions are keyed to WHERE the caret sits in the (possibly
 * invalid, mid-edit) JSON — element keys vs style props vs attribute names vs
 * value catalogs vs the SP expression layer — and everything offered is
 * grounded in core allow-lists. No standalone `!` is ever proposed (there is
 * no logical NOT — HANDOFF §3.1); unknown contexts stay silent.
 */
import { describe, it, expect } from 'vitest';
import { jsonCompletionAt, signatureHintAt, spFunctionItems, type JsonCompletion } from './jsonComplete';
import type { MockField } from '../core/types';

const FIELDS: MockField[] = [
  { name: 'Status', displayName: 'Status', type: 'choice', choices: ['Done', 'Blocked'] },
  { name: 'Owner', displayName: 'Owner', type: 'person' },
  { name: 'Tags', displayName: 'Tags', type: 'choiceMulti', choices: ['a', 'b'] },
  { name: 'Due', displayName: 'Due date', type: 'date' },
];

/** Caret helper: `|` marks the caret in the snippet. */
function at(snippet: string): { text: string; caret: number } {
  const caret = snippet.indexOf('|');
  if (caret < 0) throw new Error('no caret marker');
  return { text: snippet.slice(0, caret) + snippet.slice(caret + 1), caret };
}

function comp(snippet: string): JsonCompletion | null {
  const { text, caret } = at(snippet);
  return jsonCompletionAt(text, caret, FIELDS);
}

const inserts = (c: JsonCompletion | null): string[] => (c?.items ?? []).map((i) => i.insert);

describe('key completion — element objects', () => {
  it('offers element keys inside a fresh key string, prefix matches first', () => {
    const c = comp('{"elmType": "div", "children": [{"el|"}]}');
    expect(c).not.toBeNull();
    expect(c!.bare).toBe(false);
    const names = inserts(c);
    expect(names[0]).toBe('elmType'); // the prefix match leads
    // substring matches (inlineEditField…) may follow — reach, not noise
    expect(names).not.toContain('style'); // 'el' matches nothing in it
  });

  it('never offers keys the object already has — before OR after the caret', () => {
    const c = comp('{"elmType": "div", "children": [{"t|", "style": {}}]}');
    const names = inserts(c);
    expect(names).toContain('txtContent');
    expect(names).not.toContain('style'); // present after the caret
    expect(names).toContain('elmType'); // the PARENT has it; this child does not
  });

  it('the replace range covers the typed partial through the closing quote', () => {
    const { text, caret } = at('{"children": [{"elmT|ype"}]}');
    const c = jsonCompletionAt(text, caret, FIELDS)!;
    expect(text.slice(c.from, c.to)).toBe('elmType');
  });

  it('rowFormatter / customCardProps.formatter objects are element contexts', () => {
    expect(inserts(comp('{"rowFormatter": {"e|"}}'))).toContain('elmType');
    expect(inserts(comp('{"customCardProps": {"formatter": {"tx|"}}}'))).toContain('txtContent');
  });

  it('the top-level object offers wrapper AND element keys (column docs spread)', () => {
    const c = comp('{"|"}');
    const names = inserts(c);
    expect(names).toContain('elmType');
    expect(names).toContain('rowFormatter');
    expect(names).toContain('hideSelection');
    expect(names).toContain('commandBarProps');
  });

  it('commandBarProps offers commands; a commands entry offers the documented props', () => {
    expect(inserts(comp('{"commandBarProps": {"c|"}}'))).toEqual(['commands']);
    const names = inserts(comp('{"commandBarProps": {"commands": [{"|"}]}}'));
    expect(names).toContain('key');
    expect(names).toContain('hide');
    expect(names).toContain('sectionType');
    expect(names).toContain('selectionModes');
  });

  it('a command entry key value suggests the real command keys (aliases included)', () => {
    const c = comp('{"commandBarProps": {"commands": [{"key": "up|"}]}}');
    const names = inserts(c);
    expect(names).toContain('upload');
    expect(names).toContain('UploadCommand');
  });
});

describe('key completion — style and attributes maps', () => {
  it('offers the style allow-list (with docs) inside style', () => {
    const c = comp('{"style": {"back|"}}');
    const names = inserts(c);
    expect(names[0]).toBe('background-color'); // prefix match ranks first
    expect(names).toContain('background-image');
    expect(names).not.toContain('elmType');
    const item = c!.items.find((i) => i.insert === 'background-color')!;
    expect(item.doc).toBeTruthy();
  });

  it('beakStyle is a style map too', () => {
    expect(inserts(comp('{"customCardProps": {"beakStyle": {"col|"}}}'))).toContain('color');
  });

  it('offers the attribute allow-list inside attributes', () => {
    const c = comp('{"attributes": {"ic|"}}');
    expect(inserts(c)).toEqual(['iconName']);
  });

  it('substring matches rank after prefix matches', () => {
    const names = inserts(comp('{"style": {"color|"}}'));
    expect(names[0]).toBe('color');
    expect(names).toContain('background-color');
    expect(names.indexOf('color')).toBeLessThan(names.indexOf('background-color'));
  });
});

describe('key completion — wrapper sub-objects', () => {
  it('customRowAction offers action/actionParams/actionInput', () => {
    expect(inserts(comp('{"customRowAction": {"a|"}}')))
      .toEqual(['action', 'actionParams', 'actionInput']);
  });

  it('customCardProps offers its five keys', () => {
    const names = inserts(comp('{"customCardProps": {"|"}}'));
    expect(names).toEqual(['formatter', 'openOnEvent', 'directionalHint', 'isBeakVisible', 'beakStyle']);
  });

  it('unknown containers (groupProps) stay silent', () => {
    expect(comp('{"groupProps": {"|"}}')).toBeNull();
  });
});

describe('bare-position completion', () => {
  it('bare key position offers full members with scaffolds, flagged bare', () => {
    const c = comp('{"children": [{|}]}');
    expect(c!.bare).toBe(true);
    const elm = c!.items.find((i) => i.insert.startsWith('"elmType"'))!;
    expect(elm.insert).toBe('"elmType": ""');
    expect(elm.caretOffset).toBe(elm.insert.length - 1); // inside the quotes
    const style = c!.items.find((i) => i.insert.startsWith('"style"'))!;
    expect(style.insert).toBe('"style": {}');
    expect(style.caretOffset).toBe(style.insert.length - 1);
  });

  it('appends a comma when another member follows on a later line', () => {
    const c = comp('{"children": [{\n  |\n  "elmType": "div"\n}]}');
    const txt = c!.items.find((i) => i.insert.includes('txtContent'))!;
    expect(txt.insert).toBe('"txtContent": "",');
    expect(c!.items.some((i) => i.insert.includes('"elmType"'))).toBe(false); // present below
  });

  it('leads with a comma right after a completed member', () => {
    const c = comp('{"elmType": "div"|}');
    const txt = c!.items.find((i) => i.insert.includes('txtContent'))!;
    expect(txt.insert).toBe(', "txtContent": ""');
  });

  it('bare value position for a boolean key offers true/false', () => {
    const c = comp('{"hideSelection": |}');
    expect(c!.bare).toBe(true);
    expect(inserts(c)).toEqual(['true', 'false']);
  });

  it('bare value position for a catalog key offers quoted values', () => {
    const c = comp('{"children": [{"elmType": |}]}');
    expect(c!.bare).toBe(true);
    expect(inserts(c)).toContain('"div"');
  });
});

describe('value completion — catalogs', () => {
  it('elmType values with docs', () => {
    const c = comp('{"children": [{"elmType": "s|"}]}');
    expect(c!.bare).toBe(false);
    expect(inserts(c)).toEqual(['span', 'svg']);
  });

  it('replaces the whole value through the closing quote', () => {
    const { text, caret } = at('{"children": [{"elmType": "di|v"}]}');
    const c = jsonCompletionAt(text, caret, FIELDS)!;
    expect(text.slice(c.from, c.to)).toBe('div');
  });

  it('style values per property', () => {
    expect(inserts(comp('{"style": {"display": "fl|"}}'))).toContain('flex');
  });

  it('class values complete per space-separated token', () => {
    const { text, caret } = at('{"attributes": {"class": "sp-field-severity--good ms-fo|"}}');
    const c = jsonCompletionAt(text, caret, FIELDS)!;
    expect(text.slice(c.from, c.to)).toBe('ms-fo');
    expect(inserts(c).every((v) => v.startsWith('ms-fontColor-'))).toBe(true);
  });

  it('iconName offers the icon catalog', () => {
    expect(inserts(comp('{"attributes": {"iconName": "Che|"}}'))).toContain('CheckMark');
  });

  it('customRowAction.action offers the action list with docs', () => {
    const c = comp('{"customRowAction": {"action": "|"}}');
    expect(inserts(c)).toContain('executeFlow');
    expect(inserts(c)).not.toContain(''); // the empty action is never offered
  });

  it('openOnEvent and directionalHint offer their enums', () => {
    expect(inserts(comp('{"customCardProps": {"openOnEvent": "|"}}'))).toEqual(['hover', 'click']);
    expect(inserts(comp('{"customCardProps": {"directionalHint": "bottom|"}}')))
      .toContain('bottomCenter');
  });

  it('forEach offers only multi-value fields', () => {
    const c = comp('{"children": [{"forEach": "|"}]}');
    expect(inserts(c)).toEqual(['item in [$Tags]']);
  });

  it('inlineEditField offers field refs', () => {
    expect(inserts(comp('{"children": [{"inlineEditField": "|"}]}'))).toContain('[$Status]');
  });

  it('$schema offers the schema URLs without duplicates', () => {
    const c = comp('{"$schema": "|"}');
    const urls = inserts(c);
    expect(urls).toHaveLength(2);
    expect(new Set(urls).size).toBe(2);
  });

  it('free-form values (txtContent literals) stay silent', () => {
    expect(comp('{"children": [{"txtContent": "hello wo|"}]}')).toBeNull();
  });
});

describe('value completion — the SP expression layer', () => {
  it('@ offers the engine system tokens', () => {
    const c = comp('{"children": [{"txtContent": "=@cur|"}]}');
    expect(inserts(c)).toContain('@currentField');
  });

  it('[$ offers internal-name column refs with type-legal sub-properties', () => {
    const c = comp('{"children": [{"txtContent": "=[$Ow|"}]}');
    const names = inserts(c);
    expect(names).toContain('[$Owner]');
    expect(names).toContain('[$Owner.email]');
    expect(names).not.toContain('[$Owner.lookupValue]'); // person, not lookup
  });

  it('a [$ pick replaces through an existing closing bracket', () => {
    const { text, caret } = at('{"children": [{"txtContent": "=[$Ow|ner]"}]}');
    const c = jsonCompletionAt(text, caret, FIELDS)!;
    expect(text.slice(c.from, c.to)).toBe('[$Owner]');
  });

  it('a bare [ without $ stays quiet (not a ref in the SP dialect)', () => {
    expect(comp('{"children": [{"txtContent": "=[x|"}]}')).toBeNull();
  });

  it('a bare word offers the engine function catalog with signature docs', () => {
    const c = comp('{"style": {"color": "=i|"}}');
    const item = c!.items.find((i) => i.insert === 'if(')!;
    expect(item.doc).toContain('if(condition');
    expect(inserts(c)).toContain('indexOf(');
  });

  it('expression completions work in ANY value string, wrapper keys included', () => {
    const c = comp('{"additionalRowClass": "=if([$St|"}');
    expect(inserts(c)).toContain('[$Status]');
  });

  it('never offers a standalone ! (there is no logical NOT)', () => {
    for (const fn of spFunctionItems()) expect(fn.insert).not.toBe('!');
    const c = comp('{"children": [{"txtContent": "=|"}]}');
    expect(inserts(c)).not.toContain('!');
  });
});

describe('tolerance — completions during invalid JSON', () => {
  it('works with a dangling brace and missing commas above the caret', () => {
    const c = comp('{\n"elmType": "div"\n"style": {"co|"');
    expect(inserts(c)).toContain('color');
  });

  it('nested children stay element contexts at depth', () => {
    const c = comp('{"rowFormatter": {"children": [{"children": [{"elm|"}]}]}}');
    expect(inserts(c)[0]).toBe('elmType');
  });

  it('a caret outside the root offers nothing', () => {
    expect(comp('{"elmType": "div"}  |')).toBeNull();
  });

  it('array item position (bare) offers nothing', () => {
    expect(comp('{"children": [|]}')).toBeNull();
  });
});

describe('signatureHintAt', () => {
  it('names the innermost known call and the active argument', () => {
    const { text, caret } = at('{"style": {"color": "=if(indexOf([$Status], \'Do\'|), 1, 2)"}}');
    const hint = signatureHintAt(text, caret)!;
    expect(hint.name).toBe('indexOf');
    expect(hint.argIndex).toBe(1);
    expect(hint.doc.signature).toContain('indexOf(');
  });

  it('commas inside SP string literals do not advance the argument', () => {
    const { text, caret } = at('{"children": [{"txtContent": "=substring(\'a,b\', 0, |"}]}');
    const hint = signatureHintAt(text, caret)!;
    expect(hint.name).toBe('substring');
    expect(hint.argIndex).toBe(2);
  });

  it('double-quoted literals (JSON-escaped \\") shield their commas and parens too', () => {
    // the engine tokenizer accepts BOTH quote styles — in the pane's buffer a
    // double quote arrives as the two-character sequence \" (JSON escaping)
    const { text, caret } = at('{"children": [{"txtContent": "=substring(\\"a,(b\\", 0, |"}]}');
    const hint = signatureHintAt(text, caret)!;
    expect(hint.name).toBe('substring');
    expect(hint.argIndex).toBe(2);
  });

  it('an unterminated double-quoted literal stops the scan like a single-quoted one', () => {
    const { text, caret } = at('{"children": [{"txtContent": "=if(\\"a,b|"}]}');
    const hint = signatureHintAt(text, caret)!;
    expect(hint.name).toBe('if');
    expect(hint.argIndex).toBe(0); // the comma sits inside the open literal
  });

  it('a closed call no longer hints; outside expressions never hints', () => {
    const closed = at('{"children": [{"txtContent": "=if(1,2,3)|"}]}');
    expect(signatureHintAt(closed.text, closed.caret)).toBeNull();
    const plain = at('{"children": [{"txtContent": "if(|"}]}');
    expect(signatureHintAt(plain.text, plain.caret)).toBeNull();
  });

  it('skips unknown call names and reports the known one around them', () => {
    const { text, caret } = at('{"style": {"color": "=if(mystery(|"}}');
    const hint = signatureHintAt(text, caret)!;
    expect(hint.name).toBe('if');
  });
});
