/**
 * editor/subtypes.test.ts — contract for the custom-subtype store (US-1).
 *
 * The store persists ONLY maker-authored (custom) subtypes to the new
 * `wb-subtypes` localStorage key, schema-versioned `{ version: 1, subtypes }`.
 * Built-in seeds live in code (US-2), never here. Every read/write is
 * try/catch-guarded: a corrupt, missing, or incompatible key yields an empty
 * catalog and never throws (private-mode safe, like wb-ui-prefs).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  SUBTYPES_KEY, listSubtypes, getSubtype, saveSubtype, deleteSubtype,
  seedSubtypes, subtypesForType, bakeSubtype, knobError, coerceKnob,
} from './subtypes';
import type { Subtype, SPElement, Knob } from '../core/types';
import { lintDocument } from '../core/linter';
import { renderElement } from '../core/renderer';
import type { EvalContext } from '../core/expressions';

function ctx(row: Record<string, unknown>, currentFieldName: string): EvalContext {
  return {
    row: row as EvalContext['row'],
    rowIndex: 0,
    currentFieldName,
    me: { title: 'Me', email: 'me@x.com' },
    iterators: {},
    iteratorIndex: {},
    displayNames: {},
    now: new Date(),
  };
}

/** A seed "validates" when its formatter raises no error-severity lint issues. */
function lintErrors(formatter: SPElement): string[] {
  return lintDocument({ kind: 'column', root: formatter })
    .filter((i) => i.severity === 'error')
    .map((i) => i.rule);
}

function sample(over: Partial<Subtype> = {}): Subtype {
  return {
    id: 'c1',
    name: 'Money (mine)',
    origin: 'custom',
    baseTypes: ['number', 'currency'],
    formatter: { elmType: 'div', txtContent: '=@currentField' },
    knobs: [],
    vocab: { refs: [], values: [] },
    ...over,
  };
}

beforeEach(() => {
  try { localStorage.clear(); } catch { /* private mode */ }
});

describe('subtypes store: round-trip persistence', () => {
  it('saves and lists a custom subtype under the versioned envelope', () => {
    expect(listSubtypes()).toEqual([]);
    saveSubtype(sample());
    expect(listSubtypes().map((s) => s.id)).toEqual(['c1']);
    expect(getSubtype('c1')?.name).toBe('Money (mine)');
    const raw = JSON.parse(localStorage.getItem(SUBTYPES_KEY)!);
    expect(raw.version).toBe(1);
    expect(raw.subtypes).toHaveLength(1);
  });

  it('only the new wb-subtypes key is written (existing keys untouched)', () => {
    localStorage.setItem('wb-ui-prefs', '{"studioOpen":true}');
    saveSubtype(sample());
    expect(localStorage.getItem('wb-ui-prefs')).toBe('{"studioOpen":true}');
    expect(localStorage.getItem(SUBTYPES_KEY)).not.toBeNull();
  });

  it('upserts by id (one record per id), preserving catalog order', () => {
    saveSubtype(sample({ id: 'a', name: 'A' }));
    saveSubtype(sample({ id: 'b', name: 'B' }));
    saveSubtype(sample({ id: 'a', name: 'A2' })); // re-save must not jump to the end
    expect(listSubtypes().map((s) => s.id)).toEqual(['a', 'b']);
    expect(getSubtype('a')?.name).toBe('A2');
  });

  it('refuses to store a builtin-origin subtype (seeds live in code, not the store)', () => {
    saveSubtype(sample({ id: 'seed', origin: 'builtin' }));
    expect(listSubtypes()).toEqual([]);
  });

  it('deletes by id, leaving the rest', () => {
    saveSubtype(sample());
    saveSubtype(sample({ id: 'c2', name: 'Other' }));
    deleteSubtype('c1');
    expect(listSubtypes().map((s) => s.id)).toEqual(['c2']);
    expect(getSubtype('c1')).toBeUndefined();
  });
});

describe('subtypes store: corrupt/missing/version → empty catalog, never throws', () => {
  it('missing key yields an empty catalog', () => {
    expect(localStorage.getItem(SUBTYPES_KEY)).toBeNull();
    expect(listSubtypes()).toEqual([]);
    expect(getSubtype('anything')).toBeUndefined();
  });

  it('corrupt JSON yields an empty catalog', () => {
    localStorage.setItem(SUBTYPES_KEY, '{not valid json');
    expect(() => listSubtypes()).not.toThrow();
    expect(listSubtypes()).toEqual([]);
  });

  it('an incompatible version yields an empty catalog (version guard)', () => {
    localStorage.setItem(SUBTYPES_KEY, JSON.stringify({ version: 99, subtypes: [sample()] }));
    expect(listSubtypes()).toEqual([]);
  });

  it('a malformed envelope (subtypes not an array) yields an empty catalog', () => {
    localStorage.setItem(SUBTYPES_KEY, JSON.stringify({ version: 1, subtypes: 'nope' }));
    expect(listSubtypes()).toEqual([]);
  });

  it('drops only the corrupt records from an otherwise valid catalog', () => {
    const blob = {
      version: 1,
      subtypes: [
        sample(),
        { id: 'bad' },                                  // missing required fields
        { ...sample(), id: 'b2', baseTypes: 'number' }, // baseTypes not an array
        { ...sample(), id: 'seed', origin: 'builtin' }, // seeds never live in the store
        null,
      ],
    };
    localStorage.setItem(SUBTYPES_KEY, JSON.stringify(blob));
    expect(listSubtypes().map((s) => s.id)).toEqual(['c1']);
    expect(listSubtypes()).toHaveLength(1);
  });
});

describe('subtypes store: private-mode fallback (localStorage throws)', () => {
  let originalGet: typeof localStorage.getItem;
  let originalSet: typeof localStorage.setItem;
  afterEach(() => {
    localStorage.getItem = originalGet;
    localStorage.setItem = originalSet;
  });

  it('reads fall back to empty when getItem throws', () => {
    originalGet = localStorage.getItem;
    originalSet = localStorage.setItem;
    localStorage.getItem = () => { throw new Error('SecurityError'); };
    expect(() => listSubtypes()).not.toThrow();
    expect(listSubtypes()).toEqual([]);
    expect(() => getSubtype('c1')).not.toThrow();
  });

  it('writes are swallowed when setItem throws', () => {
    originalGet = localStorage.getItem;
    originalSet = localStorage.setItem;
    localStorage.setItem = () => { throw new Error('QuotaExceededError'); };
    expect(() => saveSubtype(sample())).not.toThrow();
    expect(() => deleteSubtype('c1')).not.toThrow();
  });
});

// ─── US-2: built-in seed catalog (presets re-expressed + Money) ──────────────

describe('seed catalog: every column preset re-expressed as a builtin subtype', () => {
  const seeds = seedSubtypes();

  it('exposes every existing columnPresets entry as a builtin subtype', () => {
    const ids = seeds.map((s) => s.id);
    for (const id of [
      'data-bar', 'status-pill', 'traffic-light', 'severity-class', 'progress-ring',
      'star-rating', 'date-badge', 'day-counter', 'persona', 'facepile',
      'member-count', 'lookup-chip', 'link',
    ]) {
      expect(ids).toContain(id);
    }
  });

  it('every seed is origin:builtin, has >=1 baseType, and a schema-valid formatter', () => {
    expect(seeds.length).toBeGreaterThan(0);
    for (const s of seeds) {
      expect(s.origin).toBe('builtin');
      expect(s.baseTypes.length).toBeGreaterThanOrEqual(1);
      expect(Array.isArray(s.knobs)).toBe(true);
      expect(lintErrors(s.formatter)).toEqual([]);
    }
  });

  it('carries the correct baseTypes (BY_TYPE inverted)', () => {
    const byId = Object.fromEntries(seeds.map((s) => [s.id, s]));
    expect(byId['data-bar'].baseTypes).toEqual(expect.arrayContaining(['number', 'currency']));
    expect(byId['status-pill'].baseTypes).toEqual(['choice']);
    expect(byId['facepile'].baseTypes).toEqual(['personMulti']);
    expect(byId['lookup-chip'].baseTypes).toEqual(expect.arrayContaining(['lookup', 'lookupMulti']));
    expect(byId['persona'].baseTypes).toEqual(['person']);
    expect(byId['link'].baseTypes).toEqual(['hyperlink']);
  });

  it('seed formatters are in @currentField terms (reusable across columns)', () => {
    const pill = seedSubtypes().find((s) => s.id === 'status-pill')!;
    expect(JSON.stringify(pill.formatter)).toContain('@currentField');
  });

  it('every preset seed carries a hand-authored, noise-free vocab', () => {
    // Hand-authored (not derived): the recipe centers on the column's value, so
    // every preset seed offers @currentField with no values — no CSS class
    // tokens (sp-field-*/ms-*), URLs, iterator names, or size-arg fragments.
    const noise = /^(sp-field-|ms-|https?:|_)|\s$|^\s/;
    for (const s of seeds.filter((x) => x.id !== 'money')) {
      expect(s.vocab.refs).toEqual(['@currentField']);
      expect(s.vocab.values).toEqual([]);
      for (const v of [...s.vocab.refs, ...s.vocab.values]) expect(v).not.toMatch(noise);
    }
  });
});

describe('seed catalog: the new Money value→text seed', () => {
  const money = seedSubtypes().find((s) => s.id === 'money')!;

  it('exists with number + currency baseTypes', () => {
    expect(money).toBeDefined();
    expect(money.origin).toBe('builtin');
    expect(money.baseTypes).toEqual(expect.arrayContaining(['number', 'currency']));
  });

  it('exposes the symbol (text "$") and decimals (number 2) knobs', () => {
    const byLabel = Object.fromEntries(money.knobs.map((k) => [k.label, k]));
    expect(money.knobs).toHaveLength(2);
    expect(byLabel['Symbol']).toMatchObject({ type: 'text', default: '$' });
    expect(byLabel['Decimals']).toMatchObject({ type: 'number', default: 2 });
  });

  it('keeps the "$" and decimals literals verbatim so apply/refine can find them', () => {
    const json = JSON.stringify(money.formatter);
    expect(json).toContain("'$'");
    expect(json).toContain('pow(10,2)');
  });

  it('has a schema-valid formatter that renders a money string', () => {
    expect(lintErrors(money.formatter)).toEqual([]);
    const node = renderElement(money.formatter, ctx({ Amount: 1234.5 }, 'Amount'));
    expect(node.textContent).toBe('$1234.5');
  });

  it('renders nothing (not "$NaN") for an empty cell', () => {
    const node = renderElement(money.formatter, ctx({ Amount: '' }, 'Amount'));
    expect(node.textContent).toBe('');
  });

  it('hand-authored vocab offers the value plus common currency symbols', () => {
    expect(money.vocab.refs).toContain('@currentField');
    expect(money.vocab.values).toEqual(expect.arrayContaining(['$', '€', '£']));
  });
});

// ─── US-3: type-filtered catalog (seeds + customs) ───────────────────────────

describe('subtypesForType: the catalog a column type sees (refuse-don\'t-guess)', () => {
  beforeEach(() => { try { localStorage.clear(); } catch { /* private mode */ } });

  it('lists only seeds whose baseTypes include the type', () => {
    const forNumber = subtypesForType('number').map((s) => s.id);
    expect(forNumber).toContain('data-bar');
    expect(forNumber).toContain('money');
    expect(forNumber).not.toContain('status-pill'); // choice-only
    expect(forNumber).not.toContain('facepile');     // personMulti-only
    const forChoice = subtypesForType('choice').map((s) => s.id);
    expect(forChoice).toContain('status-pill');
    expect(forChoice).not.toContain('data-bar');
  });

  it('appends saved customs that fit, after the builtin seeds; excludes non-fitting ones', () => {
    saveSubtype(sample({ id: 'c-num', name: 'My Number', baseTypes: ['number'] }));
    saveSubtype(sample({ id: 'c-choice', name: 'My Choice', baseTypes: ['choice'] }));
    const list = subtypesForType('number');
    const mine = list.find((s) => s.id === 'c-num');
    expect(mine?.origin).toBe('custom');
    expect(list.map((s) => s.id)).not.toContain('c-choice');
    // seeds come before customs
    expect(list.findIndex((s) => s.id === 'data-bar')).toBeLessThan(list.findIndex((s) => s.id === 'c-num'));
  });

  it('returns empty for a type no subtype fits', () => {
    expect(subtypesForType('note')).toEqual([]);
    expect(subtypesForType('boolean')).toEqual([]);
  });

  it('a custom never shadows a built-in: an id collision is dropped, not double-listed', () => {
    saveSubtype(sample({ id: 'money', name: 'Fake Money', baseTypes: ['number'] }));
    const moneyEntries = subtypesForType('number').filter((s) => s.id === 'money');
    expect(moneyEntries).toHaveLength(1);
    expect(moneyEntries[0].origin).toBe('builtin');
  });
});

// ─── US-4: knob baking + apply-time validation ───────────────────────────────

describe('bakeSubtype: by-value knob substitution (pure; the seed is never mutated)', () => {
  it('bakes Money symbol + decimals into every occurrence and renders accordingly', () => {
    const money = seedSubtypes().find((s) => s.id === 'money')!;
    const before = JSON.stringify(money.formatter);
    const baked = bakeSubtype(money, { Symbol: '€', Decimals: 0 });
    const json = JSON.stringify(baked);
    expect(json).toContain("'€'");
    expect(json).not.toContain("'$'");
    expect(json).toContain('pow(10,0)');
    expect(json).not.toContain('pow(10,2)');
    expect(JSON.stringify(money.formatter)).toBe(before); // source untouched
    // floor(1234.5 * 10^0 + 0.5) / 10^0 = 1235
    const node = renderElement(baked, ctx({ Amount: 1234.5 }, 'Amount'));
    expect(node.textContent).toBe('€1235');
  });

  it('falls back to a knob default when its arg is missing', () => {
    const money = seedSubtypes().find((s) => s.id === 'money')!;
    const baked = bakeSubtype(money, { Symbol: '€' }); // Decimals omitted → default 2
    expect(JSON.stringify(baked)).toContain('pow(10,2)');
    expect(JSON.stringify(baked)).toContain("'€'");
  });

  it('a zero-knob subtype bakes to a fresh clone (never aliases the seed)', () => {
    const pill = seedSubtypes().find((s) => s.id === 'status-pill')!;
    const baked = bakeSubtype(pill, {});
    expect(baked).not.toBe(pill.formatter);
    expect(JSON.stringify(baked)).toBe(JSON.stringify(pill.formatter));
  });

  it('is order-independent: a value one knob bakes is never re-matched by a later knob', () => {
    const st: Subtype = {
      id: 'c', name: 'x', origin: 'custom', baseTypes: ['choice'],
      knobs: [
        { path: 'A', label: 'First', type: 'text', default: 'A' },
        { path: 'B', label: 'Second', type: 'text', default: 'B' },
      ],
      vocab: { refs: [], values: [] },
      formatter: { elmType: 'div', txtContent: "=if(@currentField=='A','B','')" },
    };
    // First: A→B, Second: B→C. A naive sequential bake would turn the baked 'B'
    // back into 'C'; the single-pass bake must yield exactly =if(...=='B','C','').
    const baked = bakeSubtype(st, { First: 'B', Second: 'C' });
    expect(baked.txtContent).toBe("=if(@currentField=='B','C','')");
  });

  it('does not corrupt embedded digits when baking a number knob (by token, not substring)', () => {
    const st: Subtype = {
      id: 'n', name: 'x', origin: 'custom', baseTypes: ['number'],
      knobs: [{ path: '2', label: 'N', type: 'number', default: 2 }],
      vocab: { refs: [], values: [] },
      formatter: { elmType: 'div', txtContent: '=@currentField*0.25+pow(10,2)+120' },
    };
    const baked = bakeSubtype(st, { N: 9 });
    // only the standalone 2 changes; 0.25, 120 are untouched
    expect(baked.txtContent).toBe('=@currentField*0.25+pow(10,9)+120');
  });

  it('bakes a quoted text literal and a bare color style value, by value', () => {
    const st: Subtype = {
      id: 'c', name: 'x', origin: 'custom', baseTypes: ['choice'],
      knobs: [
        { path: 'Done', label: 'Match', type: 'text', default: 'Done' },
        { path: '#107c10', label: 'Color', type: 'color', default: '#107c10' },
      ],
      vocab: { refs: [], values: [] },
      formatter: {
        elmType: 'div',
        txtContent: "=if(@currentField=='Done','✓','')",
        style: { 'background-color': '#107c10' },
      },
    };
    const baked = bakeSubtype(st, { Match: 'Shipped', Color: '#0078d4' });
    expect(JSON.stringify(baked)).toContain("'Shipped'");
    expect(JSON.stringify(baked)).not.toContain('Done');
    expect(baked.style!['background-color']).toBe('#0078d4');
    expect(JSON.stringify(baked)).not.toContain('#107c10');
  });
});

describe('knobError / coerceKnob: refuse-and-teach validation', () => {
  const numberKnob: Knob = { path: '2', label: 'Decimals', type: 'number', default: 2 };
  const choiceKnob: Knob = { path: 'M', label: 'Size', type: 'choice', default: 'M', choices: ['S', 'M', 'L'] };
  const textKnob: Knob = { path: '$', label: 'Symbol', type: 'text', default: '$' };

  it('rejects a non-numeric or blank number knob, accepts a number', () => {
    expect(knobError(numberKnob, coerceKnob(numberKnob, 'abc'))).toMatch(/number/i);
    expect(knobError(numberKnob, coerceKnob(numberKnob, ''))).toMatch(/number/i); // blank is NOT silently 0
    expect(knobError(numberKnob, coerceKnob(numberKnob, '   '))).toMatch(/number/i);
    expect(knobError(numberKnob, coerceKnob(numberKnob, '0'))).toBeNull();
  });

  it('rejects a choice outside the list', () => {
    expect(knobError(choiceKnob, 'XL')).toMatch(/one of/i);
    expect(knobError(choiceKnob, 'L')).toBeNull();
  });

  it('teaches against a single quote in text (SP strings cannot escape it)', () => {
    expect(knobError(textKnob, "i'm")).toMatch(/quote/i);
    expect(knobError(textKnob, '€')).toBeNull();
  });

  it('coerces raw widget input by knob type', () => {
    expect(coerceKnob(numberKnob, '3')).toBe(3);
    expect(coerceKnob({ path: 'x', label: 'On', type: 'bool', default: false }, true)).toBe(true);
    expect(coerceKnob(textKnob, '€')).toBe('€');
  });
});
