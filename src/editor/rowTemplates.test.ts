import { describe, it, expect } from 'vitest';
import {
  composeRowStyle, buildKebab, defaultConfigFor, buildTemplateView,
  addArea, removeArea, moveArea, setAreaField, patchArea, nextWeight, childSlotOrder,
  type RowTemplateConfig, type KebabConfig,
} from './rowTemplates';
import { themePalette } from '../core/theme';
import type { MockField } from '../core/types';

const PAL = themePalette('light');
const base = (over: Partial<RowTemplateConfig> = {}): RowTemplateConfig => ({
  templateId: 'equal', rowStyle: 'flat', density: 'roomy',
  zebraStriping: false, hoverHighlight: false, hoverToken: 'themeLighter',
  borderStyle: 'none', borderColor: 'neutralQuaternaryAlt', leftStripe: 'none',
  areas: [], kebab: { enabled: false, behavior: 'custom', position: 'right',
    actions: { defaultClick: false, editProps: false, share: false, delete: false, executeFlow: false, setValue: false } },
  ...over,
});

describe('composeRowStyle — conflict precedence + exclusion', () => {
  it('card disables generic border and zebra, with reasons (card keeps its own border)', () => {
    const c = composeRowStyle(base({ rowStyle: 'card', borderStyle: 'solid', borderColor: 'red', zebraStriping: true }), PAL);
    expect(c.disabled.border).toBe('Card style manages its own border');
    expect(c.disabled.zebra).toBe('Card fill covers row striping');
    // the user-chosen generic border is suppressed (its color class does not leak)…
    expect(c.rootClass).not.toContain('sp-css-borderColor-red');
    expect(c.wrapperAdditionalRowClass).toBeUndefined();
    // …while the card paints its own surface: white fill, rounded, bordered, shadowed
    expect(c.rootClass).toContain('ms-bgColor-white');
    expect(c.rootClass).toContain('sp-css-borderColor-neutralQuaternaryAlt');
    expect(c.rootStyle['border-radius']).toBe('4px');
  });

  it('zebra emits a wrapper additionalRowClass, never a root background', () => {
    const c = composeRowStyle(base({ zebraStriping: true }), PAL);
    expect(c.wrapperAdditionalRowClass).toBe("=if(@rowIndex % 2 == 0,'ms-bgColor-themeLighter','')");
    expect(c.rootStyle['background-color']).toBeUndefined();
  });

  it('hover highlight is a named --hover class, never a :hover style', () => {
    const c = composeRowStyle(base({ hoverHighlight: true, hoverToken: 'themeLighter' }), PAL);
    expect(c.rootClass).toContain('ms-bgColor-themeLighter--hover');
    expect(JSON.stringify(c.rootStyle)).not.toMatch(/:hover/);
  });

  it('leftStripe wins border-left over a flat generic border', () => {
    const c = composeRowStyle(base({ borderStyle: 'solid', leftStripe: 'neutral' }), PAL);
    expect(c.rootStyle['border-left']).toBe(`3px solid ${PAL.themePrimary}`);
  });

  it('minimalist disables generic border but allows leftStripe', () => {
    const c = composeRowStyle(base({ rowStyle: 'minimalist', borderStyle: 'solid', leftStripe: 'neutral' }), PAL);
    expect(c.disabled.border).toBe('Minimalist uses only a bottom separator');
    expect(c.rootStyle['border-bottom-style']).toBe('solid');
    expect(c.rootStyle['border-left']).toBe(`3px solid ${PAL.themePrimary}`);
  });

  it('every emitted style key is on the SP allow-list', async () => {
    const { ALLOWED_STYLES } = await import('../core/schema');
    const c = composeRowStyle(base({ rowStyle: 'card', leftStripe: 'neutral', hoverHighlight: true }), PAL);
    for (const k of Object.keys(c.rootStyle)) expect(ALLOWED_STYLES.has(k)).toBe(true);
  });
});

const kebab = (over: Partial<KebabConfig> = {}): KebabConfig => ({
  enabled: true, behavior: 'custom', position: 'right',
  actions: { defaultClick: false, editProps: false, share: false, delete: false, executeFlow: false, setValue: false },
  ...over,
});

describe('buildKebab — trigger shape + refuse-and-teach', () => {
  it('custom trigger is a button with DIRECT txtContent and NO children (no card-trigger gotcha)', () => {
    const el = buildKebab(kebab({ actions: { defaultClick: false, editProps: true, share: false, delete: false, executeFlow: false, setValue: false } }))!;
    expect(el.elmType).toBe('button');
    expect(el.txtContent).toBe('⋯');
    expect(el.children).toBeUndefined();               // trigger has no children
    expect(el.customCardProps!.formatter.children!.length).toBe(1); // flyout has the action
  });

  it('refuses executeFlow with a blank flow id (no dead action emitted)', () => {
    const el = buildKebab(kebab({ actions: { defaultClick: false, editProps: false, share: false, delete: false, executeFlow: true, setValue: false }, flowId: '   ' }));
    expect(el).toBeNull();                              // nothing else enabled → whole kebab refused
  });

  it('emits executeFlow only when a flow id is present, as a JSON-string actionParams', () => {
    const el = buildKebab(kebab({ actions: { defaultClick: false, editProps: false, share: false, delete: false, executeFlow: true, setValue: false }, flowId: 'abc-123' }))!;
    const action = el.customCardProps!.formatter.children![0].customRowAction!;
    expect(action.action).toBe('executeFlow');
    expect(action.actionParams).toBe('{"id":"abc-123"}');
  });

  it('emits setValue only with field+value, keyed by the internal name', () => {
    const el = buildKebab(kebab({ actions: { defaultClick: false, editProps: false, share: false, delete: false, executeFlow: false, setValue: true }, setValueField: 'Status', setValueVal: 'Done' }))!;
    const action = el.customCardProps!.formatter.children![0].customRowAction!;
    expect(action.action).toBe('setValue');
    expect(action.actionInput).toEqual({ Status: 'Done' });
  });

  it('native behavior is a button carrying openContextMenu (direct glyph, no children)', () => {
    const el = buildKebab(kebab({ behavior: 'native' }))!;
    expect(el.elmType).toBe('button');
    expect(el.children).toBeUndefined();
    expect(el.customRowAction!.action).toBe('openContextMenu');
  });
});

const FIELDS: MockField[] = [
  { name: 'Title', type: 'text' }, { name: 'Status', type: 'choice' }, { name: 'Due', type: 'date' },
];

describe('defaultConfigFor + buildTemplateView', () => {
  it('split skeleton seeds a Title area + 2 content areas', () => {
    const c = defaultConfigFor('split', FIELDS);
    expect(c.areas.length).toBe(3);
    expect(c.areas[0].fieldName).toBe('Title');
    expect(c.areas[0].weight).toBe('wide'); // Title gets the heavier area
  });

  it('areas become CFR/value cells with conflict-free weights (areas.ts reuse)', () => {
    const c = defaultConfigFor('equal', FIELDS);
    const { root } = buildTemplateView(c, FIELDS, {}, themePalette('light'));
    expect(root.children!.length).toBe(c.areas.length);
    for (const area of root.children!) expect(area.style!['min-width']).toBe('0'); // setAreaWeight invariant
  });

  it('zebra lands on the returned additionalRowClass, never on root style', () => {
    const c = defaultConfigFor('equal', FIELDS);
    c.zebraStriping = true;
    const { root, additionalRowClass } = buildTemplateView(c, FIELDS, {}, themePalette('light'));
    expect(additionalRowClass).toBe("=if(@rowIndex % 2 == 0,'ms-bgColor-themeLighter','')");
    expect(root.style!['background-color']).toBeUndefined();
  });

  it('hover-positioned kebab puts showOnHoverParent on the row and showOnHoverChild on the kebab', () => {
    const c = defaultConfigFor('equal', FIELDS);
    c.kebab = { enabled: true, behavior: 'custom', position: 'hover',
      actions: { defaultClick: true, editProps: false, share: false, delete: false, executeFlow: false, setValue: false } };
    const { root } = buildTemplateView(c, FIELDS, {}, themePalette('light'));
    expect((root.attributes!.class as string)).toContain('sp-card-showOnHoverParent');
    const kebab = root.children![root.children!.length - 1];
    expect((kebab.attributes!.class as string)).toContain('sp-card-showOnHoverChild');
  });
});

// ─── free-form area ops + the editor's children→area mapping (overhaul) ──────

const NATIVE_ACTIONS = { defaultClick: false, editProps: false, share: false, delete: false, executeFlow: false, setValue: false };

describe('area ops (pure, immutable)', () => {
  const cfg = (): RowTemplateConfig => defaultConfigFor('split', FIELDS);

  it('addArea appends an empty area without mutating the source', () => {
    const a = cfg();
    const n0 = a.areas.length;
    const b = addArea(a);
    expect(b).not.toBe(a);
    expect(a.areas.length).toBe(n0);                 // source untouched
    expect(b.areas.length).toBe(n0 + 1);
    expect(b.areas.at(-1)?.fieldName).toBe('');
  });

  it('addArea can seed the new area with a field', () => {
    expect(addArea(cfg(), 'Due').areas.at(-1)?.fieldName).toBe('Due');
  });

  it('removeArea splices the given index', () => {
    const a = cfg();
    expect(removeArea(a, 1).areas.length).toBe(a.areas.length - 1);
  });

  it('moveArea reorders; out-of-range is a no-op (same ref)', () => {
    const a = cfg();
    const first = a.areas[0].fieldName;
    expect(moveArea(a, 0, 2).areas[2].fieldName).toBe(first);
    expect(moveArea(a, 0, 9)).toBe(a);
  });

  it('setAreaField / patchArea update one area immutably', () => {
    const a = cfg();
    expect(setAreaField(a, 0, 'Status').areas[0].fieldName).toBe('Status');
    expect(patchArea(a, 0, { align: 'center', weight: 'widest' }).areas[0]).toMatchObject({ align: 'center', weight: 'widest' });
    expect(a.areas[0].align).toBe('left');           // source untouched
  });

  it('nextWeight cycles normal → wide → widest → normal', () => {
    expect(nextWeight('normal')).toBe('wide');
    expect(nextWeight('wide')).toBe('widest');
    expect(nextWeight('widest')).toBe('normal');
  });
});

describe('childSlotOrder mirrors buildTemplateView child order (incl. spliced kebab)', () => {
  const len = (c: RowTemplateConfig): number =>
    buildTemplateView(c, FIELDS, {}, themePalette('light')).root.children?.length ?? 0;

  it('no kebab → one slot per area, in order', () => {
    const c = defaultConfigFor('split', FIELDS);
    expect(childSlotOrder(c)).toEqual([0, 1, 2]);
    expect(childSlotOrder(c).length).toBe(len(c));
  });

  it('kebab right → appended last', () => {
    const c: RowTemplateConfig = { ...defaultConfigFor('split', FIELDS), kebab: { enabled: true, behavior: 'native', position: 'right', actions: { ...NATIVE_ACTIONS } } };
    expect(childSlotOrder(c)).toEqual([0, 1, 2, 'kebab']);
    expect(childSlotOrder(c).length).toBe(len(c));
  });

  it('kebab title → spliced after the first area', () => {
    const c: RowTemplateConfig = { ...defaultConfigFor('split', FIELDS), kebab: { enabled: true, behavior: 'native', position: 'title', actions: { ...NATIVE_ACTIONS } } };
    expect(childSlotOrder(c)).toEqual([0, 'kebab', 1, 2]);
    expect(childSlotOrder(c).length).toBe(len(c));
  });

  it('a refused (all-blank custom) kebab leaves no slot', () => {
    const c: RowTemplateConfig = { ...defaultConfigFor('split', FIELDS), kebab: { enabled: true, behavior: 'custom', position: 'right', actions: { ...NATIVE_ACTIONS } } };
    expect(childSlotOrder(c)).toEqual([0, 1, 2]);     // buildKebab → null, not placed
    expect(childSlotOrder(c).length).toBe(len(c));
  });
});
