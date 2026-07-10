/**
 * pageKind.ts — classify a tab URL into the page kind the popup cares about.
 * Pure function, no chrome APIs, easy to unit-test.
 */

export type PageKind = 'sharepoint' | 'sharepoint-site' | 'formatfx' | 'other';

/**
 * Does this SharePoint URL point at a list or document-library *view* — the
 * only pages where Extract/Apply can actually do anything?
 *
 * SharePoint encodes the page kind in the path: list views sit under a
 * `/Lists/` segment and document-library views under a `/Forms/` folder. We
 * match only those two structural segments — site pages (`/SitePages/…`),
 * settings (`/_layouts/…`), and the site root have neither, so they fall
 * through to 'other'.
 */
function isListOrLibraryView(u: URL): boolean {
  const path = u.pathname.toLowerCase();
  return path.includes('/lists/') || path.includes('/forms/');
}

/**
 * Best-effort human label for a list/library view URL — the segment before
 * `/Lists/<Name>/…` (lists) or the library folder before `/Forms/…` — for
 * presence display only ("your *Projects* tab is open"). Falls back to the
 * hostname. Pure string work; no REST, no page access.
 */
export function listLabelFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const parts = u.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    const listsIdx = parts.findIndex((p) => p.toLowerCase() === 'lists');
    if (listsIdx >= 0 && parts[listsIdx + 1]) return parts[listsIdx + 1];
    const formsIdx = parts.findIndex((p) => p.toLowerCase() === 'forms');
    if (formsIdx > 0) return parts[formsIdx - 1];
    return u.hostname;
  } catch {
    return url;
  }
}

/** Classify a URL string (from `chrome.tabs.query`) into a page kind. */
export function classifyUrl(url: string | undefined): PageKind {
  if (!url) return 'other';
  try {
    const u = new URL(url);
    if (u.hostname.endsWith('.sharepoint.com')) {
      // 'sharepoint' keeps its exact meaning (Extract/Apply work here);
      // 'sharepoint-site' is any other page on a tenant — the popup offers
      // Connect there, but not the list actions.
      return isListOrLibraryView(u) ? 'sharepoint' : 'sharepoint-site';
    }
    if (u.hostname === 'formatfx.dev' || u.hostname.endsWith('.formatfx.dev')) return 'formatfx';
  } catch {
    // malformed URL → other
  }
  return 'other';
}
