/**
 * synPalette.test.ts — the owner-tunable syntax palette's decisions:
 * per-theme storage round-trips; corrupt/foreign storage drops silently
 * (never breaks the pane); apply sets exactly the overridden vars and
 * CLEARS the rest (a removed override falls back to the stylesheet).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  SYN_SLOTS, SYN_STORE_KEY, parseSynPrefs, loadSynPrefs, saveSynPrefs, applySynPrefs,
} from './synPalette';

beforeEach(() => localStorage.clear());

describe('parseSynPrefs', () => {
  it('round-trips per-theme overrides', () => {
    const prefs = { light: { '--wb-syn-xfield': '#123456' }, dark: { '--wb-syn-xop': '#abcdef' } };
    expect(parseSynPrefs(JSON.stringify(prefs))).toEqual(prefs);
  });

  it('drops unknown slots, malformed colors, and non-JSON without throwing', () => {
    expect(parseSynPrefs('{nope')).toEqual({ light: {}, dark: {} });
    expect(parseSynPrefs(JSON.stringify({
      light: { '--wb-syn-xfield': 'red', '--evil': '#123456', '--wb-syn-xnum': '#00ff00' },
      dark: 'not-an-object',
    }))).toEqual({ light: { '--wb-syn-xnum': '#00ff00' }, dark: {} });
    expect(parseSynPrefs(null)).toEqual({ light: {}, dark: {} });
  });
});

describe('save/load', () => {
  it('persists under the new wb-syn-colors key and clears it when empty', () => {
    saveSynPrefs({ light: { '--wb-syn-xkw': '#112233' }, dark: {} });
    expect(localStorage.getItem(SYN_STORE_KEY)).toContain('#112233');
    expect(loadSynPrefs().light['--wb-syn-xkw']).toBe('#112233');

    saveSynPrefs({ light: {}, dark: {} });
    expect(localStorage.getItem(SYN_STORE_KEY)).toBeNull();
  });
});

describe('applySynPrefs', () => {
  it("sets the active theme's overrides and clears every other slot", () => {
    const el = document.createElement('div');
    el.style.setProperty('--wb-syn-xstr', '#999999'); // stale from a previous apply
    applySynPrefs({ light: { '--wb-syn-xfield': '#123456' }, dark: { '--wb-syn-xstr': '#654321' } }, false, el);
    expect(el.style.getPropertyValue('--wb-syn-xfield')).toBe('#123456');
    expect(el.style.getPropertyValue('--wb-syn-xstr')).toBe(''); // dark's override must not leak into light

    applySynPrefs({ light: { '--wb-syn-xfield': '#123456' }, dark: { '--wb-syn-xstr': '#654321' } }, true, el);
    expect(el.style.getPropertyValue('--wb-syn-xstr')).toBe('#654321');
    expect(el.style.getPropertyValue('--wb-syn-xfield')).toBe('');
  });

  it('covers every declared slot (the panel builds its rows from SYN_SLOTS)', () => {
    expect(SYN_SLOTS.map((s) => s.cssVar)).toEqual([
      '--wb-syn-xfield', '--wb-syn-xtoken', '--wb-syn-xfn', '--wb-syn-xstr',
      '--wb-syn-xnum', '--wb-syn-xop', '--wb-syn-xkw',
    ]);
  });
});
