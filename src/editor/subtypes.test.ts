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
import { SUBTYPES_KEY, listSubtypes, getSubtype, saveSubtype, deleteSubtype } from './subtypes';
import type { Subtype } from '../core/types';

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
