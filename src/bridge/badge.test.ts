/**
 * badge.test.ts — the toolbar badge mapping table (extension/src/badge.ts),
 * exhaustively: the badge is the extension's most visible surface, and its
 * silence on unconnected tabs is a privacy promise, not a styling choice.
 */
import { describe, it, expect } from 'vitest';
import { badgeFor } from '../../extension/src/badge';

describe('badgeFor', () => {
  it('shows nothing anywhere when not connected and nothing is staged', () => {
    for (const kind of ['sharepoint', 'sharepoint-site', 'other'] as const) {
      expect(badgeFor({ kind, connected: false, stagedCount: 0 }).text).toBe('');
    }
  });

  it('marks a connected list page with a green dot', () => {
    const b = badgeFor({ kind: 'sharepoint', connected: true, stagedCount: 0 });
    expect(b.text).toBe('●');
    expect(b.color).toBe('#15803d');
    expect(b.title).toContain('connected');
  });

  it('stays silent on a connected tenant page that is not a list', () => {
    // site home on a connected tenant: no action possible, no badge
    expect(badgeFor({ kind: 'sharepoint-site', connected: true, stagedCount: 0 }).text).toBe('');
  });

  it('staged apply beats the connected dot on a list page', () => {
    const b = badgeFor({ kind: 'sharepoint', connected: true, stagedCount: 2 });
    expect(b.text).toBe('2');
    expect(b.color).toBe('#c2410c');
    expect(b.title).toContain('2 staged formatters');
  });

  it('shows the staged count on a list page even when not connected', () => {
    // Apply staged works via activeTab regardless of connection
    expect(badgeFor({ kind: 'sharepoint', connected: false, stagedCount: 1 }).text).toBe('1');
  });

  it('does not advertise staged work away from list pages', () => {
    expect(badgeFor({ kind: 'other', connected: false, stagedCount: 3 }).text).toBe('');
    expect(badgeFor({ kind: 'sharepoint-site', connected: true, stagedCount: 3 }).text).toBe('');
  });

  it('marks formatfx.dev tabs', () => {
    const b = badgeFor({ kind: 'formatfx', connected: false, stagedCount: 0 });
    expect(b.text).toBe('FX');
  });

  it('caps the badge count at 99', () => {
    expect(badgeFor({ kind: 'sharepoint', connected: false, stagedCount: 150 }).text).toBe('99');
  });

  it('singular/plural in the staged title', () => {
    expect(badgeFor({ kind: 'sharepoint', connected: false, stagedCount: 1 }).title).toContain('1 staged formatter ');
  });
});
