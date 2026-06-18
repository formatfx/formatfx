/**
 * pageKind.ts — classify a tab URL into the page kind the popup cares about.
 * Pure function, no chrome APIs, easy to unit-test.
 */

export type PageKind = 'sharepoint' | 'formatfx' | 'other';

/**
 * Does this SharePoint URL point at a list or document-library *view* — the
 * only pages where Extract/Apply can actually do anything?
 *
 * SharePoint encodes the page kind in the path: list views sit under a
 * `/Lists/` segment, library views under a `/Forms/` folder, both default to
 * `AllItems.aspx`, and any saved view carries a `viewid` (or `viewpath`)
 * query param. Site pages (`/SitePages/…`), settings (`/_layouts/…`), and the
 * site root match none of these — so they fall through to 'other'.
 */
function isListOrLibraryView(u: URL): boolean {
  const path = u.pathname.toLowerCase();
  return (
    path.includes('/lists/') ||
    path.includes('/forms/') ||
    path.endsWith('/allitems.aspx') ||
    u.searchParams.has('viewid') ||
    u.searchParams.has('viewpath')
  );
}

/** Classify a URL string (from `chrome.tabs.query`) into a page kind. */
export function classifyUrl(url: string | undefined): PageKind {
  if (!url) return 'other';
  try {
    const u = new URL(url);
    if (u.hostname.endsWith('.sharepoint.com')) {
      return isListOrLibraryView(u) ? 'sharepoint' : 'other';
    }
    if (u.hostname === 'formatfx.dev' || u.hostname.endsWith('.formatfx.dev')) return 'formatfx';
  } catch {
    // malformed URL → other
  }
  return 'other';
}
