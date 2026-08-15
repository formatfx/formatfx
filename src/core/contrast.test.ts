// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Sam Yost

/**
 * core/contrast.test.ts — the WCAG contrast brain (core/contrast.ts).
 *
 * Contracts pinned here:
 *  - color parsing across the forms formatters actually carry (hex, rgb/rgba,
 *    hsl, named, transparent) and honest nulls for everything else
 *  - WCAG math against the published anchor values (black/white = 21:1,
 *    Fluent #0078d4 on white ≈ 4.5:1)
 *  - static outcome extraction over BOTH expression syntaxes, with the
 *    soundness rule: known branches are real outcomes, unknowns mark the
 *    chain incomplete instead of guessing
 *  - pairing soundness: constant × chain always pairs; two conditional
 *    chains pair ONLY when their condition sequences are identical
 *  - STOCK_THEME stays in sync with core/theme.ts (the mirror is pinned, so
 *    the palettes can't drift apart silently)
 */

import { describe, it, expect } from 'vitest';
import {
  parseCssColor, relativeLuminance, compositeOver, contrastRatio, formatRatio,
  colorChainOf, contrastPairsOf, STOCK_THEME,
} from './contrast';
import { themePalette } from './theme';
import type { SPExpr } from './types';

describe('parseCssColor', () => {
  it('parses the hex forms', () => {
    expect(parseCssColor('#fff')).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseCssColor('#FF0000')).toEqual({ r: 255, g: 0, b: 0, a: 1 });
    expect(parseCssColor('#0f08')!.a).toBeCloseTo(136 / 255, 5);
    expect(parseCssColor('#00ff0080')!.a).toBeCloseTo(128 / 255, 5);
  });

  it('parses rgb()/rgba() with commas, spaces and percentages', () => {
    expect(parseCssColor('rgb(255, 0, 0)')).toEqual({ r: 255, g: 0, b: 0, a: 1 });
    expect(parseCssColor('rgb(0 128 255)')).toEqual({ r: 0, g: 128, b: 255, a: 1 });
    expect(parseCssColor('rgba(0,0,0,.5)')!.a).toBe(0.5);
    expect(parseCssColor('rgb(100%, 0%, 50%)')).toEqual({ r: 255, g: 0, b: 128, a: 1 });
  });

  it('parses hsl() (red, half-lightness gray, with alpha)', () => {
    expect(parseCssColor('hsl(0, 100%, 50%)')).toEqual({ r: 255, g: 0, b: 0, a: 1 });
    expect(parseCssColor('hsl(0, 0%, 50%)')).toEqual({ r: 128, g: 128, b: 128, a: 1 });
    expect(parseCssColor('hsla(120, 100%, 25%, 0.4)')).toEqual({ r: 0, g: 128, b: 0, a: 0.4 });
  });

  it('parses named colors and transparent', () => {
    expect(parseCssColor('white')).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseCssColor('RebeccaPurple')).toEqual({ r: 102, g: 51, b: 153, a: 1 });
    expect(parseCssColor(' transparent ')!.a).toBe(0);
  });

  it('returns null for everything that is not a color literal', () => {
    for (const bad of ['', 'inherit', 'currentColor', 'var(--x)', '[$Color]', '=if(1,2,3)', '#12345', 'rgb(1,2)', 'sp-css-color-blue']) {
      expect(parseCssColor(bad)).toBeNull();
    }
    expect(parseCssColor(12)).toBeNull();
    expect(parseCssColor(undefined)).toBeNull();
  });
});

describe('WCAG math', () => {
  const white = parseCssColor('#ffffff')!;
  const black = parseCssColor('#000000')!;

  it('luminance anchors: black 0, white 1', () => {
    expect(relativeLuminance(black)).toBe(0);
    expect(relativeLuminance(white)).toBeCloseTo(1, 5);
  });

  it('contrast anchors: black/white 21:1, same-color 1:1, symmetric', () => {
    expect(contrastRatio(black, white)).toBeCloseTo(21, 2);
    expect(contrastRatio(white, black)).toBeCloseTo(21, 2);
    expect(contrastRatio(white, white)).toBeCloseTo(1, 5);
  });

  it('matches the published Fluent anchor: #0078d4 on white ≈ 4.5:1', () => {
    const r = contrastRatio(parseCssColor('#0078d4')!, white);
    expect(r).toBeGreaterThan(4.4);
    expect(r).toBeLessThan(4.7);
  });

  it('composites translucent text over the fill before measuring', () => {
    const halfBlack = parseCssColor('rgba(0,0,0,0.5)')!;
    expect(compositeOver(halfBlack, white)).toEqual({ r: 128, g: 128, b: 128, a: 1 });
    const r = contrastRatio(halfBlack, white);
    expect(r).toBeGreaterThan(1);
    expect(r).toBeLessThan(contrastRatio(black, white));
  });

  it('formatRatio renders one decimal', () => {
    expect(formatRatio(4.503)).toBe('4.5:1');
    expect(formatRatio(21)).toBe('21.0:1');
    expect(formatRatio(1.249)).toBe('1.2:1');
  });
});

describe('colorChainOf — static outcome extraction', () => {
  it('a literal is one unconditional, complete entry', () => {
    const c = colorChainOf('#ff0000');
    expect(c.entries).toHaveLength(1);
    expect(c.entries[0]).toMatchObject({ cond: null, css: '#ff0000' });
    expect(c.complete).toBe(true);
  });

  it('an =if() chain yields one entry per branch, all conditional, complete', () => {
    const c = colorChainOf("=if([$Status]=='Done','#107c10',if([$Status]=='Blocked','#d13438','#605e5c'))");
    expect(c.entries.map((e) => e.css)).toEqual(['#107c10', '#d13438', '#605e5c']);
    expect(c.entries.every((e) => e.cond !== null)).toBe(true);
    expect(c.complete).toBe(true);
  });

  it('an unresolvable branch keeps the known entries but marks the chain incomplete', () => {
    const c = colorChainOf("=if([$Done],'#107c10',[$CustomColor])");
    expect(c.entries.map((e) => e.css)).toEqual(['#107c10']);
    expect(c.complete).toBe(false);
    // the empty string condRules emits as "no color here" is not an outcome
    const d = colorChainOf("=if([$Done],'#107c10','')");
    expect(d.entries.map((e) => e.css)).toEqual(['#107c10']);
    expect(d.complete).toBe(false);
  });

  it('reads the legacy object syntax ("?" and the ":" alias)', () => {
    const legacy: SPExpr = {
      operator: '?',
      operands: [{ operator: '<=', operands: ['@currentField', 70] }, '#d13438', '#107c10'],
    };
    const c = colorChainOf(legacy);
    expect(c.entries.map((e) => e.css)).toEqual(['#d13438', '#107c10']);
    expect(c.complete).toBe(true);
    const alias = colorChainOf({ operator: ':', operands: [{ operator: '==', operands: ['@me', '[$Author.email]'] }, 'white', 'black'] });
    expect(alias.entries.map((e) => e.css)).toEqual(['white', 'black']);
  });

  it('is honest about what it cannot read', () => {
    expect(colorChainOf('=[$Color]')).toEqual({ entries: [], complete: false });
    expect(colorChainOf("=if([$A],'#fff',")).toEqual({ entries: [], complete: false }); // broken syntax: expr-syntax rule teaches it
    expect(colorChainOf(42).entries).toHaveLength(0);
    expect(colorChainOf(undefined).entries).toHaveLength(0);
    expect(colorChainOf("='#ff'+'0000'")).toEqual({ entries: [], complete: false }); // concatenation is runtime-only
  });
});

describe('contrastPairsOf — soundness', () => {
  const constant = (css: string) => colorChainOf(css);

  it('constant × constant is one pair; constant × chain checks every branch', () => {
    expect(contrastPairsOf(constant('#fff'), constant('#000'))).toHaveLength(1);
    const chain = colorChainOf("=if([$S]=='a','#107c10','#d13438')");
    expect(contrastPairsOf(constant('#ffffff'), chain)).toHaveLength(2);
    expect(contrastPairsOf(chain, constant('#ffffff'))).toHaveLength(2);
  });

  it('two chains with IDENTICAL conditions pair positionally', () => {
    const fg = colorChainOf("=if([$S]=='a','#ffffff','#323130')");
    const bg = colorChainOf("=if([$S]=='a','#107c10','#ffffff')");
    const pairs = contrastPairsOf(fg, bg);
    expect(pairs.map((p) => [p.fg.css, p.bg.css])).toEqual([
      ['#ffffff', '#107c10'],
      ['#323130', '#ffffff'],
    ]);
  });

  it('chains with DIFFERENT conditions never cross-multiply (no false alarms)', () => {
    const fg = colorChainOf("=if([$S]=='a','#ffffff','#323130')");
    const bg = colorChainOf("=if([$Other]==1,'#ffffff','#107c10')");
    expect(contrastPairsOf(fg, bg)).toEqual([]);
  });

  it('an incomplete chain still pairs its known entries against a constant', () => {
    const fg = colorChainOf("=if([$Done],'#ffffff',[$CustomColor])");
    expect(contrastPairsOf(fg, constant('#fffffe'))).toHaveLength(1);
  });
});

describe('STOCK_THEME mirrors core/theme.ts', () => {
  it('light and dark anchors match the stock palettes', () => {
    const light = themePalette('light'), dark = themePalette('dark');
    expect(STOCK_THEME.light.text).toBe(light.neutralPrimary);
    expect(STOCK_THEME.light.surface).toBe(light.white);
    expect(STOCK_THEME.dark.text).toBe(dark.neutralPrimary);
    expect(STOCK_THEME.dark.surface).toBe(dark.white);
  });
});
