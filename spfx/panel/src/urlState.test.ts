import { describe, it, expect, vi } from 'vitest';
import { viewIdFromUrl, watchUrl, readReopen, writeReopen, REOPEN_KEY } from './urlState';

describe('viewIdFromUrl', () => {
  it('reads viewid in any casing/encoding and normalizes the guid', () => {
    expect(viewIdFromUrl('https://t/sites/x/Lists/L/AllItems.aspx?viewid=%7BF24BA2A8-0000-0000-0000-000000000001%7D')).toBe('f24ba2a8-0000-0000-0000-000000000001');
    expect(viewIdFromUrl('https://t/sites/x/Lists/L/AllItems.aspx?env=WebView&viewid=f24ba2a8-0000-0000-0000-000000000001')).toBe('f24ba2a8-0000-0000-0000-000000000001');
    expect(viewIdFromUrl('https://t/sites/x/Lists/L/AllItems.aspx')).toBeNull();
    expect(viewIdFromUrl('not a url')).toBeNull();
  });
});

describe('watchUrl', () => {
  it('reports href changes on poll and popstate, and stops', () => {
    vi.useFakeTimers();
    try {
      const seen: string[] = [];
      const stop = watchUrl((h) => seen.push(h), 100);
      history.pushState({}, '', '/a?viewid=1');
      vi.advanceTimersByTime(100);
      history.replaceState({}, '', '/a?viewid=2');
      window.dispatchEvent(new PopStateEvent('popstate'));
      stop();
      history.replaceState({}, '', '/a?viewid=3');
      vi.advanceTimersByTime(300);
      expect(seen.map((h) => new URL(h).search)).toEqual(['?viewid=1', '?viewid=2']);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('reopen state', () => {
  it('round-trips per tab and ignores another list', () => {
    sessionStorage.clear();
    writeReopen(sessionStorage, { listId: 'L1', targetKey: 'Field:Status' });
    expect(JSON.parse(sessionStorage.getItem(REOPEN_KEY)!)).toEqual({ listId: 'L1', targetKey: 'Field:Status' });
    expect(readReopen(sessionStorage, 'L1')).toEqual({ listId: 'L1', targetKey: 'Field:Status' });
    expect(readReopen(sessionStorage, 'L2')).toBeNull();
    writeReopen(sessionStorage, null);
    expect(readReopen(sessionStorage, 'L1')).toBeNull();
  });
});
