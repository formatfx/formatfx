import { describe, it, expect } from 'vitest';
import { composeRowStyle, buildKebab, type RowTemplateConfig, type KebabConfig } from './rowTemplates';
import { themePalette } from '../core/theme';

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
