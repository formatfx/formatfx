import { describe, it, expect } from 'vitest';
import { resolveTheme, readStoredTheme, writeStoredTheme, spThemeInverted, THEME_KEY } from './panelTheme';

describe('resolveTheme', () => {
  it('a stored choice wins over everything', () => {
    expect(resolveTheme({ stored: 'light', spInverted: true, prefersDark: true })).toBe('light');
    expect(resolveTheme({ stored: 'dark', spInverted: false, prefersDark: false })).toBe('dark');
  });
  it("else SharePoint's page theme (inverted = dark) decides", () => {
    expect(resolveTheme({ stored: null, spInverted: true, prefersDark: false })).toBe('dark');
    expect(resolveTheme({ stored: null, spInverted: false, prefersDark: true })).toBe('light');
  });
  it('else the OS preference', () => {
    expect(resolveTheme({ stored: null, spInverted: null, prefersDark: true })).toBe('dark');
    expect(resolveTheme({ stored: null, spInverted: null, prefersDark: false })).toBe('light');
  });
});

describe('the stored choice', () => {
  it('round-trips under its own additive key and ignores garbage', () => {
    localStorage.clear();
    expect(readStoredTheme(localStorage)).toBeNull();
    writeStoredTheme(localStorage, 'dark');
    expect(localStorage.getItem(THEME_KEY)).toBe('dark');
    expect(readStoredTheme(localStorage)).toBe('dark');
    localStorage.setItem(THEME_KEY, 'blue');
    expect(readStoredTheme(localStorage)).toBeNull();
    expect(THEME_KEY.startsWith('ffx-')).toBe(true); // never a wb-* key
  });
  it('survives a throwing storage', () => {
    const bad = { getItem: () => { throw new Error('private'); }, setItem: () => { throw new Error('private'); } } as unknown as Storage;
    expect(readStoredTheme(bad)).toBeNull();
    expect(() => writeStoredTheme(bad, 'dark')).not.toThrow();
  });
});

describe('spThemeInverted', () => {
  it("reads SharePoint's theme state when present, null otherwise", () => {
    expect(spThemeInverted({ __themeState__: { theme: { isInverted: true } } })).toBe(true);
    expect(spThemeInverted({ __themeState__: { theme: { isInverted: false } } })).toBe(false);
    expect(spThemeInverted({})).toBeNull();
    expect(spThemeInverted({ __themeState__: { theme: {} } })).toBeNull();
  });
});
