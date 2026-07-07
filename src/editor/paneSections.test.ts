/**
 * Pane-section collapse persistence (happy-dom localStorage) — the three big
 * Left Edit Pane sections (Columns · Components · Inspector) remember whether
 * they're folded away, on their own frozen key, defaulting to EXPANDED.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  isSectionCollapsed, setSectionCollapsed, PANE_SECTIONS_KEY,
} from './paneSections';

beforeEach(() => {
  localStorage.clear();
});

describe('paneSections', () => {
  it('defaults every section to EXPANDED (nothing stored)', () => {
    expect(isSectionCollapsed('columns')).toBe(false);
    expect(isSectionCollapsed('components')).toBe(false);
    expect(isSectionCollapsed('inspector')).toBe(false);
  });

  it('round-trips a collapse flag per section, independently', () => {
    setSectionCollapsed('components', true);
    expect(isSectionCollapsed('components')).toBe(true);
    // the others are untouched
    expect(isSectionCollapsed('columns')).toBe(false);
    expect(isSectionCollapsed('inspector')).toBe(false);
    // and it flips back
    setSectionCollapsed('components', false);
    expect(isSectionCollapsed('components')).toBe(false);
  });

  it('persists under the frozen key as a plain map (survives a reload)', () => {
    setSectionCollapsed('columns', true);
    setSectionCollapsed('inspector', true);
    // a fresh read (as a reloaded session would) sees the stored state
    expect(JSON.parse(localStorage.getItem(PANE_SECTIONS_KEY)!)).toEqual({
      columns: true, inspector: true,
    });
  });

  it('treats malformed storage as all-expanded rather than throwing', () => {
    localStorage.setItem(PANE_SECTIONS_KEY, '{not json');
    expect(() => isSectionCollapsed('columns')).not.toThrow();
    expect(isSectionCollapsed('columns')).toBe(false);
    // and a set recovers to valid JSON
    setSectionCollapsed('columns', true);
    expect(isSectionCollapsed('columns')).toBe(true);
  });

  it('treats a stored JSON array as malformed — a flag set over it still persists', () => {
    // an array is typeof 'object'; naively kept, a named flag written onto it
    // would vanish on re-serialize (JSON.stringify([]) drops named props)
    localStorage.setItem(PANE_SECTIONS_KEY, '[]');
    expect(isSectionCollapsed('columns')).toBe(false);
    setSectionCollapsed('columns', true);
    expect(isSectionCollapsed('columns')).toBe(true); // recovered into a plain map
    expect(Array.isArray(JSON.parse(localStorage.getItem(PANE_SECTIONS_KEY)!))).toBe(false);
  });
});
