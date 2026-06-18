import { describe, it, expect } from 'vitest';
import { classifyUrl } from '../../extension/src/pageKind';

describe('classifyUrl', () => {
  it('returns "sharepoint" for list and document-library view URLs', () => {
    // classic + modern list views live under /Lists/
    expect(classifyUrl('https://contoso.sharepoint.com/sites/Team/Lists/MyList/AllItems.aspx')).toBe('sharepoint');
    // a saved, non-default list view (named .aspx under /Lists/)
    expect(classifyUrl('https://contoso.sharepoint.com/sites/Team/Lists/MyList/By%20Status.aspx')).toBe('sharepoint');
    // document-library views live under a /Forms/ folder
    expect(classifyUrl('https://contoso.sharepoint.com/sites/Team/Shared%20Documents/Forms/AllItems.aspx')).toBe('sharepoint');
    // a custom library, deep-linked into a folder with a viewid
    expect(classifyUrl('https://contoso.sharepoint.com/sites/Team/Docs/Forms/AllItems.aspx?id=%2Fsites%2FTeam%2FDocs%2FSub&viewid=8c1a...')).toBe('sharepoint');
  });

  it('returns "other" for SharePoint pages that are not a list or library', () => {
    expect(classifyUrl('https://tenant.sharepoint.com/')).toBe('other'); // site root
    expect(classifyUrl('https://contoso.sharepoint.com/sites/Team')).toBe('other'); // site home
    expect(classifyUrl('https://contoso.sharepoint.com/sites/Team/SitePages/Home.aspx')).toBe('other'); // modern page
    expect(classifyUrl('https://contoso.sharepoint.com/sites/Team/_layouts/15/viewlsts.aspx')).toBe('other'); // site contents
    // only /Lists/ and /Forms/ count: a bare viewid or AllItems without the folder is not enough
    expect(classifyUrl('https://contoso.sharepoint.com/sites/Team/SitePages/Home.aspx?viewid=8c1a...')).toBe('other');
    expect(classifyUrl('https://contoso.sharepoint.com/sites/Team/AllItems.aspx')).toBe('other');
  });

  it('returns "formatfx" for formatfx.dev URLs', () => {
    expect(classifyUrl('https://formatfx.dev')).toBe('formatfx');
    expect(classifyUrl('https://formatfx.dev/')).toBe('formatfx');
    expect(classifyUrl('https://staging.formatfx.dev/foo')).toBe('formatfx');
  });

  it('returns "other" for unrelated URLs', () => {
    expect(classifyUrl('https://google.com')).toBe('other');
    expect(classifyUrl('chrome://extensions')).toBe('other');
    expect(classifyUrl('about:blank')).toBe('other');
  });

  it('returns "other" for undefined or empty input', () => {
    expect(classifyUrl(undefined)).toBe('other');
    expect(classifyUrl('')).toBe('other');
  });
});
