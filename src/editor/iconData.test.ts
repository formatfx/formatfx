import { describe, it, expect } from 'vitest';
import { ICON_GROUPS, ALL_ICONS, NO_PREVIEW_ICONS } from './iconData';

describe('iconData — the SP-renderable Fluent icon set', () => {
  it('has a substantial, grouped catalog', () => {
    expect(ICON_GROUPS.length).toBeGreaterThan(10);
    expect(ALL_ICONS.length).toBeGreaterThan(1500);
  });

  it('every name is a clean Fabric icon token (maps to ms-Icon--Name)', () => {
    for (const name of ALL_ICONS) expect(name).toMatch(/^[A-Za-z0-9]+$/);
  });

  it('ALL_ICONS is the deduped union of the groups', () => {
    const union = new Set(ICON_GROUPS.flatMap((g) => g.icons));
    expect(ALL_ICONS.length).toBe(union.size);
    for (const g of ICON_GROUPS) for (const n of g.icons) expect(union.has(n)).toBe(true);
  });

  it('the no-preview set is a subset of the catalog', () => {
    const all = new Set(ALL_ICONS);
    for (const n of NO_PREVIEW_ICONS) expect(all.has(n)).toBe(true);
    // the bulk of icons DO preview
    expect(NO_PREVIEW_ICONS.size).toBeLessThan(ALL_ICONS.length / 2);
  });
});
