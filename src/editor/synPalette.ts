// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Sam Yost

/**
 * editor/synPalette.ts — owner-tunable expression syntax colors (the PR A
 * hand-over: the --wb-syn-x* hues are an owner contribution point, so the
 * kebab grows a panel to try them live). Pure decisions here; jsonPanel owns
 * the DOM.
 *
 * Overrides are stored PER THEME (light/dark) under a NEW localStorage key —
 * nothing existing is renamed (frozen-keys rule) — and applied as inline
 * custom properties on <body>, which outranks both theme blocks in
 * style.css. Only #rrggbb values are accepted on load: that is what
 * <input type="color"> emits, and it keeps every stored value CSS-safe.
 */

export const SYN_STORE_KEY = 'wb-syn-colors';

/** The tunable slots — the expression sub-token channel (PR A). */
export const SYN_SLOTS: ReadonlyArray<{ cssVar: string; label: string }> = [
  { cssVar: '--wb-syn-xfield', label: 'Field refs [$…]' },
  { cssVar: '--wb-syn-xtoken', label: '@tokens' },
  { cssVar: '--wb-syn-xfn', label: 'Functions' },
  { cssVar: '--wb-syn-xstr', label: 'String literals' },
  { cssVar: '--wb-syn-xnum', label: 'Numbers' },
  { cssVar: '--wb-syn-xop', label: 'Operators' },
  { cssVar: '--wb-syn-xkw', label: 'true / false / in' },
];

export type SynOverrides = Record<string, string>;
export interface SynPrefs { light: SynOverrides; dark: SynOverrides }

const HEX6 = /^#[0-9a-fA-F]{6}$/;
const KNOWN_VARS = new Set(SYN_SLOTS.map((s) => s.cssVar));

/** Parse stored prefs: unknown slots and non-#rrggbb values drop silently
 *  (corrupt or future-version storage must never break the pane). */
export function parseSynPrefs(raw: string | null): SynPrefs {
  const out: SynPrefs = { light: {}, dark: {} };
  if (!raw) return out;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    for (const theme of ['light', 'dark'] as const) {
      const block = parsed[theme];
      if (!block || typeof block !== 'object') continue;
      for (const [k, v] of Object.entries(block as Record<string, unknown>)) {
        if (KNOWN_VARS.has(k) && typeof v === 'string' && HEX6.test(v)) out[theme][k] = v;
      }
    }
  } catch { /* malformed JSON — fresh start */ }
  return out;
}

export function loadSynPrefs(): SynPrefs {
  try {
    return parseSynPrefs(localStorage.getItem(SYN_STORE_KEY));
  } catch {
    return { light: {}, dark: {} }; // storage unavailable (privacy modes)
  }
}

export function saveSynPrefs(prefs: SynPrefs): void {
  try {
    const empty = !Object.keys(prefs.light).length && !Object.keys(prefs.dark).length;
    if (empty) localStorage.removeItem(SYN_STORE_KEY);
    else localStorage.setItem(SYN_STORE_KEY, JSON.stringify(prefs));
  } catch { /* storage unavailable — the session still gets the live colors */ }
}

/** Apply one theme's overrides as inline custom properties on `el` (the
 *  <body>): set what's overridden, clear the rest so a removed override
 *  falls back to the stylesheet's value. */
export function applySynPrefs(prefs: SynPrefs, dark: boolean, el: HTMLElement): void {
  const active = dark ? prefs.dark : prefs.light;
  for (const { cssVar } of SYN_SLOTS) {
    const v = active[cssVar];
    if (v) el.style.setProperty(cssVar, v);
    else el.style.removeProperty(cssVar);
  }
}
