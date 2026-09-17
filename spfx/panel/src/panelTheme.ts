/**
 * panelTheme.ts — which theme the panel opens in (issue #321), pure.
 *
 * Precedence: the person's stored choice (the head's ☾/☀ button writes it),
 * else SharePoint's own page theme (modern pages expose it as
 * `window.__themeState__.theme.isInverted`), else the OS preference. The
 * storage key is additive (`ffx-`), never one of the frozen `wb-` keys.
 */
export type ThemeChoice = 'light' | 'dark';

export const THEME_KEY = 'ffx-theme';

export function resolveTheme(o: { stored: ThemeChoice | null; spInverted: boolean | null; prefersDark: boolean }): ThemeChoice {
  if (o.stored) return o.stored;
  if (o.spInverted !== null) return o.spInverted ? 'dark' : 'light';
  return o.prefersDark ? 'dark' : 'light';
}

export function readStoredTheme(storage: Storage): ThemeChoice | null {
  try {
    const v = storage.getItem(THEME_KEY);
    return v === 'light' || v === 'dark' ? v : null;
  } catch { return null; }
}

export function writeStoredTheme(storage: Storage, choice: ThemeChoice): void {
  try { storage.setItem(THEME_KEY, choice); } catch { /* private mode */ }
}

/** SharePoint's theme state, when the page carries one. */
export function spThemeInverted(win: object): boolean | null {
  const inv = (win as { __themeState__?: { theme?: { isInverted?: unknown } } }).__themeState__?.theme?.isInverted;
  return typeof inv === 'boolean' ? inv : null;
}
