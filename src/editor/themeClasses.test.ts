import { describe, it, expect } from 'vitest';
import type { SPElement } from '../core/types';
import {
  THEME_COLORS, SEVERITY_LEVELS, ROLE_PROP,
  paletteClass, severityClass, parseThemeClass, activeThemeClass,
  setThemeClass, clearThemeClass,
} from './themeClasses';

const el = (attrs?: Record<string, unknown>, style?: Record<string, unknown>): SPElement => ({
  elmType: 'div',
  ...(attrs ? { attributes: attrs as SPElement['attributes'] } : {}),
  ...(style ? { style: style as SPElement['style'] } : {}),
});

const green = THEME_COLORS.find((c) => c.id === 'green')!;
const gray = THEME_COLORS.find((c) => c.id === 'gray')!;

describe('paletteClass / severityClass', () => {
  it('builds a token per role', () => {
    expect(paletteClass('text', green)).toBe('ms-fontColor-green');
    expect(paletteClass('fill', green)).toBe('ms-bgColor-green');
    expect(paletteClass('border', green)).toBe('sp-css-borderColor-green');
  });
  it('builds a soft fill when the color has one', () => {
    expect(paletteClass('fill', green, true)).toBe('ms-bgColor-successBackground50');
    // teal has no soft token → falls back to the solid fill token
    const teal = THEME_COLORS.find((c) => c.id === 'teal')!;
    expect(paletteClass('fill', teal, true)).toBe('ms-bgColor-teal');
  });
  it('uses per-role tokens (gray fill differs from gray text/border)', () => {
    expect(paletteClass('text', gray)).toBe('ms-fontColor-neutralSecondary');
    expect(paletteClass('fill', gray)).toBe('ms-bgColor-neutralQuaternary');
    expect(paletteClass('border', gray)).toBe('sp-css-borderColor-neutralSecondary');
  });
  it('builds a severity class', () => {
    expect(severityClass('good')).toBe('sp-field-severity--good');
    expect(severityClass('blocked')).toBe('sp-field-severity--blocked');
  });
});

describe('parseThemeClass (reverse map)', () => {
  it('round-trips every palette token for every role', () => {
    for (const c of THEME_COLORS) {
      for (const role of ['text', 'fill', 'border'] as const) {
        const token = paletteClass(role, c);
        const info = parseThemeClass(token);
        expect(info, token).not.toBeNull();
        expect(info!.role).toBe(role);
        expect(info!.colorId).toBe(c.id);
      }
    }
  });
  it('recognises soft fills as fill + soft', () => {
    const info = parseThemeClass('ms-bgColor-successBackground50');
    expect(info).toEqual({ role: 'fill', token: 'ms-bgColor-successBackground50', colorId: 'green', soft: true });
  });
  it('recognises the sp-css- backgroundColor/color/borderColor aliases', () => {
    expect(parseThemeClass('sp-css-backgroundColor-green')?.role).toBe('fill');
    expect(parseThemeClass('sp-css-color-green')?.role).toBe('text');
    expect(parseThemeClass('sp-css-borderColor-green')?.role).toBe('border');
  });
  it('recognises every severity level as a fill', () => {
    for (const { level } of SEVERITY_LEVELS) {
      const info = parseThemeClass(severityClass(level));
      expect(info).toEqual({ role: 'fill', token: `sp-field-severity--${level}`, severity: level });
    }
  });
  it('returns null for tokens outside the bridge palette and for non-color classes', () => {
    expect(parseThemeClass('ms-bgColor-magenta')).toBeNull();      // emulated but not a bridge color
    expect(parseThemeClass('sp-field-dataBars')).toBeNull();
    expect(parseThemeClass('sp-card-container')).toBeNull();
    expect(parseThemeClass('not-a-class')).toBeNull();
  });
});

describe('activeThemeClass', () => {
  it('finds the token governing each role', () => {
    const node = el({ class: 'ms-fontColor-green ms-bgColor-red sp-css-borderColor-purple' });
    expect(activeThemeClass(node, 'text')?.colorId).toBe('green');
    expect(activeThemeClass(node, 'fill')?.colorId).toBe('red');
    expect(activeThemeClass(node, 'border')?.colorId).toBe('purple');
  });
  it('finds a severity fill', () => {
    expect(activeThemeClass(el({ class: 'sp-field-severity--warning' }), 'fill'))
      .toMatchObject({ role: 'fill', severity: 'warning' });
  });
  it('returns the LAST same-slot token, matching the precedence engine (later wins)', () => {
    expect(activeThemeClass(el({ class: 'ms-bgColor-red ms-bgColor-green' }), 'fill')?.colorId).toBe('green');
  });
  it('is null when no class governs the role, or the class is a formula', () => {
    expect(activeThemeClass(el(), 'fill')).toBeNull();
    expect(activeThemeClass(el({ class: "=if([$x]=='a','ms-bgColor-green','')" }), 'fill')).toBeNull();
  });
});

describe('setThemeClass', () => {
  it('adds the token and clears the conflicting inline style (governed, not overridden)', () => {
    const node = el(undefined, { 'background-color': '#d13438', color: '#fff' });
    expect(setThemeClass(node, 'fill', 'ms-bgColor-green')).toBe(true);
    expect(node.attributes!.class).toBe('ms-bgColor-green');
    expect(node.style!['background-color']).toBeUndefined();   // dead inline value cleared
    expect(node.style!.color).toBe('#fff');                    // untouched sibling
  });
  it('replaces the existing same-slot token, keeps other-slot tokens', () => {
    const node = el({ class: 'ms-bgColor-red ms-fontColor-green' });
    setThemeClass(node, 'fill', 'ms-bgColor-purple');
    expect(node.attributes!.class).toBe('ms-fontColor-green ms-bgColor-purple');
  });
  it('a severity fill replaces a solid fill (both govern background-color)', () => {
    const node = el({ class: 'ms-bgColor-red' });
    setThemeClass(node, 'fill', 'sp-field-severity--blocked');
    expect(node.attributes!.class).toBe('sp-field-severity--blocked');
  });
  it('deletes style entirely when it becomes empty', () => {
    const node = el(undefined, { 'background-color': '#d13438' });
    setThemeClass(node, 'fill', 'ms-bgColor-green');
    expect(node.style).toBeUndefined();
  });
  it('setting a border color does NOT strip a sp-field-borderAll shorthand class', () => {
    const node = el({ class: 'sp-field-borderAllRegular' });
    setThemeClass(node, 'border', 'sp-css-borderColor-green');
    expect(node.attributes!.class).toBe('sp-field-borderAllRegular sp-css-borderColor-green');
  });
  it('refuses (returns false, leaves class untouched) when class is a formula', () => {
    const node = el({ class: "=if([$Status]=='Done','ms-bgColor-green','')" });
    expect(setThemeClass(node, 'fill', 'ms-bgColor-red')).toBe(false);
    expect(node.attributes!.class).toBe("=if([$Status]=='Done','ms-bgColor-green','')");
  });
});

describe('clearThemeClass', () => {
  it('removes the active theme class for a role, leaves siblings', () => {
    const node = el({ class: 'ms-fontColor-green ms-bgColor-red' });
    clearThemeClass(node, 'fill');
    expect(node.attributes!.class).toBe('ms-fontColor-green');
  });
  it('drops class + attributes when nothing remains', () => {
    const node = el({ class: 'ms-bgColor-red' });
    clearThemeClass(node, 'fill');
    expect(node.attributes).toBeUndefined();
  });
  it('does nothing to a formula class', () => {
    const node = el({ class: '=if(true,\'ms-bgColor-green\',\'\')' });
    clearThemeClass(node, 'fill');
    expect(node.attributes!.class).toBe('=if(true,\'ms-bgColor-green\',\'\')');
  });
});

describe('ROLE_PROP', () => {
  it('maps roles to the CSS slots the precedence engine governs', () => {
    expect(ROLE_PROP).toEqual({ text: 'color', fill: 'background-color', border: 'border-color' });
  });
});
