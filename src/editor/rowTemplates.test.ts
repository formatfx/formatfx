import { describe, it, expect } from 'vitest';
import { composeRowStyle, type RowTemplateConfig } from './rowTemplates';
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
