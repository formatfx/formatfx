/**
 * pageKind.ts — classify a tab URL into the page kind the popup cares about.
 * Pure function, no chrome APIs, easy to unit-test.
 */

export type PageKind = 'sharepoint' | 'formatfx' | 'other';

/** Classify a URL string (from `chrome.tabs.query`) into a page kind. */
export function classifyUrl(url: string | undefined): PageKind {
  if (!url) return 'other';
  try {
    const u = new URL(url);
    if (u.hostname.endsWith('.sharepoint.com')) return 'sharepoint';
    if (u.hostname === 'formatfx.dev' || u.hostname.endsWith('.formatfx.dev')) return 'formatfx';
  } catch {
    // malformed URL → other
  }
  return 'other';
}
