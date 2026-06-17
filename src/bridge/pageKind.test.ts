import { describe, it, expect } from 'vitest';
import { classifyUrl } from '../../extension/src/pageKind';

describe('classifyUrl', () => {
  it('returns "sharepoint" for *.sharepoint.com URLs', () => {
    expect(classifyUrl('https://contoso.sharepoint.com/sites/myList/AllItems.aspx')).toBe('sharepoint');
    expect(classifyUrl('https://tenant.sharepoint.com/')).toBe('sharepoint');
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
