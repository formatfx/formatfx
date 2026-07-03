/**
 * elmRef.ts: the element-reference badge must (1) wear the SAME tree icon for a
 * given elmType so the two visuals connect, and (2) never route a user-supplied
 * _elmName through innerHTML (imported JSON is untrusted — see .jules/sentinel).
 */
import { describe, it, expect } from 'vitest';
import { elementRefChip, elmIconName, ELM_ICONS, DEFAULT_ELM_ICON } from './elmRef';

describe('elmIconName', () => {
  it('maps known elmTypes to their tree glyphs', () => {
    expect(elmIconName('div')).toBe('CubeShape');
    expect(elmIconName('span')).toBe('PlainText');
    expect(elmIconName('a')).toBe('Link');
    expect(elmIconName('button')).toBe('ButtonControl');
    // every mapping is reachable through the helper
    for (const [type, glyph] of Object.entries(ELM_ICONS)) {
      expect(elmIconName(type)).toBe(glyph);
    }
  });

  it('falls back to the tree default for unknown or missing types', () => {
    expect(elmIconName('marquee')).toBe(DEFAULT_ELM_ICON);
    expect(elmIconName(undefined)).toBe(DEFAULT_ELM_ICON);
    expect(elmIconName('')).toBe(DEFAULT_ELM_ICON);
    expect(DEFAULT_ELM_ICON).toBe('CubeShape');
  });
});

describe('elementRefChip', () => {
  it('shows the tree icon, the name, and the type as a dim suffix', () => {
    const chip = elementRefChip({ _elmName: 'status pill', elmType: 'div' });
    expect(chip.classList.contains('wb-elmref')).toBe(true);

    const icon = chip.querySelector('i')!;
    expect(icon.className).toContain('ms-Icon--CubeShape');
    expect(icon.getAttribute('aria-hidden')).toBe('true');

    expect(chip.querySelector('.wb-elmref-name')!.textContent).toBe('status pill');
    expect(chip.querySelector('.wb-elmref-type')!.textContent).toBe('div');
    expect(chip.title).toContain('status pill');
    expect(chip.title).toContain('<div>');
  });

  it('shows <type> alone for an unnamed element, with no dim suffix', () => {
    const chip = elementRefChip({ elmType: 'button' });
    expect(chip.querySelector('i')!.className).toContain('ms-Icon--ButtonControl');
    expect(chip.querySelector('.wb-elmref-name')!.textContent).toBe('<button>');
    expect(chip.querySelector('.wb-elmref-type')).toBeNull();
  });

  it('uses the default glyph and a safe placeholder when the type is missing', () => {
    const chip = elementRefChip({});
    expect(chip.querySelector('i')!.className).toContain(`ms-Icon--${DEFAULT_ELM_ICON}`);
    expect(chip.querySelector('.wb-elmref-name')!.textContent).toBe('<element>');
  });

  it('never lets an imported _elmName become live markup (XSS)', () => {
    const evil = '<img src=x onerror="alert(1)">';
    const chip = elementRefChip({ _elmName: evil, elmType: 'span' });
    // the raw string survives verbatim as text…
    expect(chip.querySelector('.wb-elmref-name')!.textContent).toBe(evil);
    // …and nothing was parsed into real nodes (only the type <i> icon exists)
    expect(chip.querySelector('img')).toBeNull();
    expect(chip.querySelectorAll('i').length).toBe(1);
  });
});
