/**
 * connections.test.ts — pins the per-site opt-in boundary
 * (extension/src/connections.ts): which URLs are connectable, and how granted
 * origin patterns map back to display hosts.
 */
import { describe, it, expect } from 'vitest';
import { originPatternFor, hostFromPattern, sharePointOrigins } from '../../extension/src/connections';

describe('originPatternFor', () => {
  it('derives an origin pattern from any page on a SharePoint tenant', () => {
    expect(originPatternFor('https://contoso.sharepoint.com/sites/Team/Lists/MyList/AllItems.aspx'))
      .toBe('https://contoso.sharepoint.com/*');
    expect(originPatternFor('https://contoso.sharepoint.com/')).toBe('https://contoso.sharepoint.com/*');
    // OneDrive-style tenants are still *.sharepoint.com hosts
    expect(originPatternFor('https://contoso-my.sharepoint.com/personal/x')).toBe('https://contoso-my.sharepoint.com/*');
  });

  it('refuses anything outside the optional_host_permissions boundary', () => {
    expect(originPatternFor('https://google.com')).toBeNull();
    expect(originPatternFor('https://formatfx.dev')).toBeNull();
    // suffix spoof: the SP-looking host is not actually *.sharepoint.com
    expect(originPatternFor('https://contoso.sharepoint.com.evil.com/')).toBeNull();
    // bare apex (no tenant) is not a connectable site
    expect(originPatternFor('https://sharepoint.com/')).toBeNull();
    // non-https schemes can't be granted by our optional pattern
    expect(originPatternFor('http://contoso.sharepoint.com/')).toBeNull();
    expect(originPatternFor('chrome://extensions')).toBeNull();
    expect(originPatternFor(undefined)).toBeNull();
    expect(originPatternFor('not a url')).toBeNull();
  });
});

describe('hostFromPattern', () => {
  it('inverts originPatternFor for display', () => {
    expect(hostFromPattern('https://contoso.sharepoint.com/*')).toBe('contoso.sharepoint.com');
  });
});

describe('sharePointOrigins', () => {
  it('filters a granted-origins list down to managed SharePoint patterns, sorted', () => {
    expect(sharePointOrigins([
      'https://zeta.sharepoint.com/*',
      'https://alpha.sharepoint.com/*',
      'https://formatfx.dev/*',            // not ours to manage
      '<all_urls>',                        // never granted by us, ignore
    ])).toEqual(['alpha.sharepoint.com', 'zeta.sharepoint.com']);
    expect(sharePointOrigins(undefined)).toEqual([]);
    expect(sharePointOrigins([])).toEqual([]);
  });
});
