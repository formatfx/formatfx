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
