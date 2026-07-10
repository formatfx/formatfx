/**
 * connections.ts — pure helpers for the per-site opt-in model. A "connected
 * site" is a SharePoint origin the user granted a standing host permission
 * for via the popup's Connect button. The connected list is DERIVED from
 * chrome.permissions.getAll().origins — never stored — so a revoke from
 * chrome://extensions is instantly authoritative and nothing can drift.
 *
 * Only *.sharepoint.com hosts are connectable: that is the manifest's
 * optional_host_permissions boundary (sovereign clouds like *.sharepoint.us
 * are a documented follow-up — widening the optional pattern widens the
 * install-time review surface, so it waits for a verified need).
 */

/** True for a host the optional_host_permissions pattern can cover. */
function isSharePointHost(hostname: string): boolean {
  // ends-with dot-suffix match: "contoso.sharepoint.com" yes,
  // "sharepoint.com.evil.com" no, bare "sharepoint.com" no (no tenant).
  return hostname.endsWith('.sharepoint.com') && hostname.length > '.sharepoint.com'.length;
}

/**
 * The origin permission pattern for a page URL, or null when the URL is not
 * a connectable SharePoint page (non-SP hosts, http:, malformed).
 */
export function originPatternFor(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return null;
    if (!isSharePointHost(u.hostname)) return null;
    return `https://${u.hostname}/*`;
  } catch {
    return null;
  }
}

/** "https://contoso.sharepoint.com/*" → "contoso.sharepoint.com" (display). */
export function hostFromPattern(pattern: string): string {
  return pattern.replace(/^https:\/\//, '').replace(/\/\*$/, '');
}

/**
 * Filter a chrome.permissions.getAll().origins list down to the SharePoint
 * origin patterns this extension manages, normalized for display.
 */
export function sharePointOrigins(grantedOrigins: string[] | undefined): string[] {
  if (!grantedOrigins) return [];
  return grantedOrigins
    .filter((o) => /^https:\/\/[^/]+\.sharepoint\.com\/\*$/.test(o))
    .map(hostFromPattern)
    .sort();
}
