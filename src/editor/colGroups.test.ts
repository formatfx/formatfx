/**
 * Column tab groups (owner brief 2026-07-05) — the pure brain: exclusive
 * membership, least-used color pick, monotonic ids, and the load guard for
 * the additive `floorGroups` project key.
 */
import { describe, it, expect } from 'vitest';
import {
  addGroup, groupForField, nextGroupColor, nextGroupId, nextGroupName,
  sanitizeGroups, GROUP_COLORS, type ColumnGroup,
} from './colGroups';

const mk = (over: Partial<ColumnGroup> = {}): ColumnGroup => ({
  id: 'g1', name: 'Group 1', color: GROUP_COLORS[0].color, fields: ['A'], collapsed: false,
  ...over,
});

describe('colGroups: creation', () => {
  it('addGroup builds a named group over the fields, defaulting name and color', () => {
    const { groups, group } = addGroup([], ['Title', 'Status']);
    expect(groups).toEqual([group]);
    expect(group).toMatchObject({
      id: 'g1', name: 'Group 1', color: GROUP_COLORS[0].color,
      fields: ['Title', 'Status'], collapsed: false,
    });
  });

  it('membership is exclusive: grouping steals fields; emptied groups are dropped', () => {
    const first = addGroup([], ['Title', 'Status']).groups;
    const { groups, group } = addGroup(first, ['Status', 'Due']);
    expect(group.fields).toEqual(['Status', 'Due']);
    expect(groupForField(groups, 'Title')?.id).toBe('g1'); // survivor keeps the rest
    expect(groupForField(groups, 'Status')?.id).toBe(group.id);
    // stealing EVERY field drops the emptied group entirely
    const { groups: after } = addGroup(groups, ['Title']);
    expect(after.some((g) => g.id === 'g1')).toBe(false);
  });

  it('duplicate fields collapse to one membership', () => {
    const { group } = addGroup([], ['A', 'A', 'B']);
    expect(group.fields).toEqual(['A', 'B']);
  });

  it('ids stay monotonic past every existing id; names skip taken "Group N"s', () => {
    const existing = [mk({ id: 'g7', name: 'Group 2' })];
    expect(nextGroupId(existing)).toBe('g8');
    expect(nextGroupName(existing)).toBe('Group 3'); // "Group 2" is taken
  });

  it('color picks the least-used palette entry (first wins ties)', () => {
    expect(nextGroupColor([])).toBe(GROUP_COLORS[0].color);
    const one = [mk({ color: GROUP_COLORS[0].color })];
    expect(nextGroupColor(one)).toBe(GROUP_COLORS[1].color);
    const all = GROUP_COLORS.map((c, i) => mk({ id: `g${i + 1}`, fields: [`F${i}`], color: c.color }));
    expect(nextGroupColor(all)).toBe(GROUP_COLORS[0].color); // wraps around
  });
});

describe('colGroups: the load guard (sanitizeGroups)', () => {
  it('accepts a well-shaped array and normalizes collapsed to a real boolean', () => {
    const out = sanitizeGroups([{ id: 'g1', name: 'People', color: '#0078d4', fields: ['Owner'], collapsed: 'yes' }]);
    expect(out).toEqual([{ id: 'g1', name: 'People', color: '#0078d4', fields: ['Owner'], collapsed: false }]);
  });

  it('drops garbage: non-arrays, malformed entries, empty/blank bits, duplicate ids', () => {
    expect(sanitizeGroups(undefined)).toEqual([]);
    expect(sanitizeGroups('nope')).toEqual([]);
    expect(sanitizeGroups([null, 42, { id: '', name: 'x', color: '#111', fields: ['A'] }])).toEqual([]);
    expect(sanitizeGroups([{ id: 'g1', name: '  ', color: '#111', fields: ['A'] }])).toEqual([]);
    expect(sanitizeGroups([{ id: 'g1', name: 'x', color: '#111', fields: [] }])).toEqual([]);
    const dupes = sanitizeGroups([
      { id: 'g1', name: 'x', color: '#111', fields: ['A'] },
      { id: 'g1', name: 'y', color: '#222', fields: ['B'] },
    ]);
    expect(dupes).toHaveLength(1);
    expect(dupes[0].name).toBe('x');
  });

  it('de-duplicates fields across groups — first group wins, emptied ones drop', () => {
    const out = sanitizeGroups([
      { id: 'g1', name: 'x', color: '#111', fields: ['A', 'B'] },
      { id: 'g2', name: 'y', color: '#222', fields: ['B', 'C'] },
      { id: 'g3', name: 'z', color: '#333', fields: ['A'] },
    ]);
    expect(out.map((g) => g.fields)).toEqual([['A', 'B'], ['C']]);
  });
});
