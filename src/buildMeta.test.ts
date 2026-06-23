import { describe, it, expect } from 'vitest';
import { parseMergePR, repoHttpUrl } from './buildMeta';

describe('parseMergePR', () => {
  it('extracts number and title from a GitHub merge commit', () => {
    expect(parseMergePR('Merge pull request #53 from formatfx/claude/foo', 'Custom Column Subtypes'))
      .toEqual({ number: 53, title: 'Custom Column Subtypes' });
  });
  it('uses only the first body line as the title', () => {
    expect(parseMergePR('Merge pull request #7 from o/b', 'Title here\n\nlong description'))
      .toEqual({ number: 7, title: 'Title here' });
  });
  it('falls back to a generic title when the body is empty', () => {
    expect(parseMergePR('Merge pull request #9 from o/b', '   '))
      .toEqual({ number: 9, title: 'Pull request #9' });
  });
  it('returns null for a non-PR-merge subject', () => {
    expect(parseMergePR('feat: do a thing', 'body')).toBeNull();
    expect(parseMergePR('Merge branch main into x', '')).toBeNull();
  });
});

describe('repoHttpUrl', () => {
  it('normalizes an ssh remote', () => {
    expect(repoHttpUrl('git@github.com:formatfx/formatfx.git')).toBe('https://github.com/formatfx/formatfx');
  });
  it('normalizes an https remote with .git', () => {
    expect(repoHttpUrl('https://github.com/formatfx/formatfx.git')).toBe('https://github.com/formatfx/formatfx');
  });
  it('handles https without .git', () => {
    expect(repoHttpUrl('https://github.com/formatfx/formatfx')).toBe('https://github.com/formatfx/formatfx');
  });
  it('returns null for empty or unrecognized remotes', () => {
    expect(repoHttpUrl('')).toBeNull();
    expect(repoHttpUrl('weird-thing')).toBeNull();
  });
});
