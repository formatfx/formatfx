import { describe, it, expect } from 'vitest';
import {
  classTokens, governedProperties, governanceFor, GOVERNABLE_PROPS,
} from './classPrecedence';

describe('classTokens', () => {
  it('splits whitespace-separated tokens', () => {
    expect(classTokens('ms-bgColor-themePrimary sp-field-severity--good'))
      .toEqual(['ms-bgColor-themePrimary', 'sp-field-severity--good']);
  });
  it('treats a formula class as opaque (no static tokens)', () => {
    expect(classTokens("=if([$Status]=='Done','ms-bgColor-green','')")).toEqual([]);
  });
  it('ignores non-string / undefined class values', () => {
    expect(classTokens(undefined)).toEqual([]);
    expect(classTokens({ operator: '+', operands: ['a', 'b'] })).toEqual([]);
  });
});

describe('governedProperties (§5.C mapping table)', () => {
  it('maps background-color classes', () => {
    for (const c of ['sp-css-backgroundColor-red', 'ms-bgColor-themePrimary', 'sp-field-severity--blocked']) {
      expect(governedProperties(c).get('background-color')).toBe(c);
    }
  });
  it('maps color classes', () => {
    expect(governedProperties('sp-css-color-blue').get('color')).toBe('sp-css-color-blue');
    expect(governedProperties('ms-fontColor-green').get('color')).toBe('ms-fontColor-green');
  });
  it('maps border-color classes', () => {
    expect(governedProperties('sp-css-borderColor-red').get('border-color')).toBe('sp-css-borderColor-red');
    expect(governedProperties('ms-borderColor-neutralLight').get('border-color')).toBe('ms-borderColor-neutralLight');
  });
  it('maps font-size and font-weight classes', () => {
    expect(governedProperties('ms-fontSize-24').get('font-size')).toBe('ms-fontSize-24');
    expect(governedProperties('sp-field-fontSizeSmall').get('font-size')).toBe('sp-field-fontSizeSmall');
    expect(governedProperties('ms-fontWeight-semibold').get('font-weight')).toBe('ms-fontWeight-semibold');
    expect(governedProperties('sp-card-boldText').get('font-weight')).toBe('sp-card-boldText');
  });
  it('sp-field-borderAll governs all three border facets', () => {
    const g = governedProperties('sp-field-borderAll-2');
    expect(g.get('border-width')).toBe('sp-field-borderAll-2');
    expect(g.get('border-style')).toBe('sp-field-borderAll-2');
    expect(g.get('border-color')).toBe('sp-field-borderAll-2');
  });
  it('does not match near-miss tokens', () => {
    // sp-card-boldText is anchored exactly; sp-card-boldTextDark must not match
    expect(governedProperties('sp-card-boldTextDark').size).toBe(0);
    expect(governedProperties('not-a-sharepoint-class').size).toBe(0);
  });
  it('later class wins for a shared property (CSS source order)', () => {
    expect(governedProperties('ms-bgColor-red sp-field-severity--good').get('background-color'))
      .toBe('sp-field-severity--good');
  });
});

describe('governanceFor', () => {
  it('returns none when no class governs the property', () => {
    expect(governanceFor('background-color', 'some-random-class', false))
      .toEqual({ kind: 'none' });
  });
  it('returns governed when a class paints it and there is no inline override', () => {
    expect(governanceFor('background-color', 'ms-bgColor-themePrimary', false))
      .toEqual({ kind: 'governed', className: 'ms-bgColor-themePrimary' });
  });
  it('returns overridden when an inline style wins over the class', () => {
    expect(governanceFor('background-color', 'ms-bgColor-themePrimary', true))
      .toEqual({ kind: 'overridden', className: 'ms-bgColor-themePrimary' });
  });
});

describe('GOVERNABLE_PROPS', () => {
  it('contains every property any rule can paint', () => {
    for (const p of ['background-color', 'color', 'border-color', 'font-size', 'font-weight', 'border-width', 'border-style']) {
      expect(GOVERNABLE_PROPS.has(p)).toBe(true);
    }
  });
});
