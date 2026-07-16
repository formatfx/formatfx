/**
 * foldState.ts — the shared fold set behind the JSON pane and the Structure
 * tree (2026-07-16): key grammar, change-detected notification with origins,
 * and the reset hook state.resetAll()/loadProject() rely on.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { foldState, elmFoldKey, childrenFoldKey, childrenPathOfKey } from './foldState';

beforeEach(() => {
  foldState.clear();
});

describe('key grammar', () => {
  it('element, children and root keys are distinct and parseable', () => {
    expect(elmFoldKey([0, 2])).toBe('0/2');
    expect(elmFoldKey([])).toBe(''); // the root
    expect(childrenFoldKey([0, 2])).toBe('#c/0/2');
    expect(childrenFoldKey([])).toBe('#c/'); // the root's children array
    expect(childrenPathOfKey('#c/0/2')).toEqual([0, 2]);
    expect(childrenPathOfKey('#c/')).toEqual([]);
    // non-children keys are not children keys
    expect(childrenPathOfKey('0/2')).toBeNull();
    expect(childrenPathOfKey('@groupProps')).toBeNull();
    expect(childrenPathOfKey('')).toBeNull();
    // the card segment (-1) round-trips
    expect(childrenPathOfKey(childrenFoldKey([1, -1]))).toEqual([1, -1]);
  });
});

describe('update + subscribe', () => {
  it('notifies each subscriber once per changing update, with the origin', () => {
    const seen: string[] = [];
    const unsub = foldState.subscribe((origin) => seen.push(origin));
    foldState.update('tree', (set) => {
      set.add('0');
      set.add('#c/1');
    });
    expect(seen).toEqual(['tree']); // one batch, one notification
    expect(foldState.has('0')).toBe(true);
    expect(foldState.has('#c/1')).toBe(true);
    expect(foldState.keys().sort()).toEqual(['#c/1', '0']);
    unsub();
    foldState.update('json', (set) => set.delete('0'));
    expect(seen).toEqual(['tree']); // unsubscribed — silent
  });

  it('a no-op update stays silent (delete of an absent key, re-add of a present one)', () => {
    foldState.update('tree', (set) => set.add('0'));
    let calls = 0;
    const unsub = foldState.subscribe(() => calls++);
    foldState.update('json', (set) => set.delete('ghost'));
    foldState.update('json', (set) => set.add('0'));
    expect(calls).toBe(0);
    unsub();
  });

  it('clear() empties the set and notifies as a reset by default', () => {
    foldState.update('tree', (set) => set.add('0'));
    const seen: string[] = [];
    const unsub = foldState.subscribe((origin) => seen.push(origin));
    foldState.clear();
    expect(foldState.keys()).toEqual([]);
    expect(seen).toEqual(['reset']);
    foldState.clear(); // already empty — silent
    expect(seen).toEqual(['reset']);
    unsub();
  });
});
