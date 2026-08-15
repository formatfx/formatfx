// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Sam Yost

/**
 * core/contrast.ts — WCAG contrast math + static color-outcome extraction.
 *
 * The brain behind the linter's `low-contrast` rule: given the color values a
 * formatter authors (literals, "=if(...)" Excel-style strings, or the legacy
 * {"operator":...} object form), enumerate every color the expression can
 * statically produce and compute WCAG 2.x contrast ratios between text and
 * the fill behind it.
 *
 * Design rules (the linter's honesty contract):
 *  - Only SOUND pairings are reported. A conditional text color is checked
 *    against a constant fill (every branch really renders on that fill), and
 *    two conditional chains pair up branch-by-branch ONLY when their condition
 *    sequences are identical (the shape condRules and fxBar generate — same
 *    rule drives both properties). Mismatched chains are skipped, never
 *    cross-multiplied: a red-text branch that can't co-occur with a red fill
 *    must not produce a false alarm.
 *  - Anything unresolvable (field-driven colors, string concatenation, theme
 *    classes) marks the channel UNKNOWN and the check stays silent — the rule
 *    teaches real failures, it never guesses.
 *
 * Pure and dependency-free; imports only the expression parser. Node-tested
 * in contrast.test.ts.
 */

import type { SPExpr } from './types';
import { parseExpression, type AstNode } from './expressions';

// ─── Color parsing ───────────────────────────────────────────────────────────

export interface RGBA { r: number; g: number; b: number; a: number }

/** The CSS named colors (CSS Color Module level 4 list) + transparent. */
const NAMED: Record<string, string> = {
  aliceblue: '#f0f8ff', antiquewhite: '#faebd7', aqua: '#00ffff', aquamarine: '#7fffd4',
  azure: '#f0ffff', beige: '#f5f5dc', bisque: '#ffe4c4', black: '#000000',
  blanchedalmond: '#ffebcd', blue: '#0000ff', blueviolet: '#8a2be2', brown: '#a52a2a',
  burlywood: '#deb887', cadetblue: '#5f9ea0', chartreuse: '#7fff00', chocolate: '#d2691e',
  coral: '#ff7f50', cornflowerblue: '#6495ed', cornsilk: '#fff8dc', crimson: '#dc143c',
  cyan: '#00ffff', darkblue: '#00008b', darkcyan: '#008b8b', darkgoldenrod: '#b8860b',
  darkgray: '#a9a9a9', darkgreen: '#006400', darkgrey: '#a9a9a9', darkkhaki: '#bdb76b',
  darkmagenta: '#8b008b', darkolivegreen: '#556b2f', darkorange: '#ff8c00', darkorchid: '#9932cc',
  darkred: '#8b0000', darksalmon: '#e9967a', darkseagreen: '#8fbc8f', darkslateblue: '#483d8b',
  darkslategray: '#2f4f4f', darkslategrey: '#2f4f4f', darkturquoise: '#00ced1', darkviolet: '#9400d3',
  deeppink: '#ff1493', deepskyblue: '#00bfff', dimgray: '#696969', dimgrey: '#696969',
  dodgerblue: '#1e90ff', firebrick: '#b22222', floralwhite: '#fffaf0', forestgreen: '#228b22',
  fuchsia: '#ff00ff', gainsboro: '#dcdcdc', ghostwhite: '#f8f8ff', gold: '#ffd700',
  goldenrod: '#daa520', gray: '#808080', green: '#008000', greenyellow: '#adff2f',
  grey: '#808080', honeydew: '#f0fff0', hotpink: '#ff69b4', indianred: '#cd5c5c',
  indigo: '#4b0082', ivory: '#fffff0', khaki: '#f0e68c', lavender: '#e6e6fa',
  lavenderblush: '#fff0f5', lawngreen: '#7cfc00', lemonchiffon: '#fffacd', lightblue: '#add8e6',
  lightcoral: '#f08080', lightcyan: '#e0ffff', lightgoldenrodyellow: '#fafad2', lightgray: '#d3d3d3',
  lightgreen: '#90ee90', lightgrey: '#d3d3d3', lightpink: '#ffb6c1', lightsalmon: '#ffa07a',
  lightseagreen: '#20b2aa', lightskyblue: '#87cefa', lightslategray: '#778899', lightslategrey: '#778899',
  lightsteelblue: '#b0c4de', lightyellow: '#ffffe0', lime: '#00ff00', limegreen: '#32cd32',
  linen: '#faf0e6', magenta: '#ff00ff', maroon: '#800000', mediumaquamarine: '#66cdaa',
  mediumblue: '#0000cd', mediumorchid: '#ba55d3', mediumpurple: '#9370db', mediumseagreen: '#3cb371',
  mediumslateblue: '#7b68ee', mediumspringgreen: '#00fa9a', mediumturquoise: '#48d1cc',
  mediumvioletred: '#c71585', midnightblue: '#191970', mintcream: '#f5fffa', mistyrose: '#ffe4e1',
  moccasin: '#ffe4b5', navajowhite: '#ffdead', navy: '#000080', oldlace: '#fdf5e6',
  olive: '#808000', olivedrab: '#6b8e23', orange: '#ffa500', orangered: '#ff4500',
  orchid: '#da70d6', palegoldenrod: '#eee8aa', palegreen: '#98fb98', paleturquoise: '#afeeee',
  palevioletred: '#db7093', papayawhip: '#ffefd5', peachpuff: '#ffdab9', peru: '#cd853f',
  pink: '#ffc0cb', plum: '#dda0dd', powderblue: '#b0e0e6', purple: '#800080',
  rebeccapurple: '#663399', red: '#ff0000', rosybrown: '#bc8f8f', royalblue: '#4169e1',
  saddlebrown: '#8b4513', salmon: '#fa8072', sandybrown: '#f4a460', seagreen: '#2e8b57',
  seashell: '#fff5ee', sienna: '#a0522d', silver: '#c0c0c0', skyblue: '#87ceeb',
  slateblue: '#6a5acd', slategray: '#708090', slategrey: '#708090', snow: '#fffafa',
  springgreen: '#00ff7f', steelblue: '#4682b4', tan: '#d2b48c', teal: '#008080',
  thistle: '#d8bfd8', tomato: '#ff6347', turquoise: '#40e0d0', violet: '#ee82ee',
  wheat: '#f5deb3', white: '#ffffff', whitesmoke: '#f5f5f5', yellow: '#ffff00',
  yellowgreen: '#9acd32',
};

function hexToRgba(hex: string): RGBA | null {
  const h = hex.slice(1);
  const dup = (c: string): number => parseInt(c + c, 16);
  if (/^[0-9a-f]{3}$/i.test(h)) return { r: dup(h[0]), g: dup(h[1]), b: dup(h[2]), a: 1 };
  if (/^[0-9a-f]{4}$/i.test(h)) return { r: dup(h[0]), g: dup(h[1]), b: dup(h[2]), a: dup(h[3]) / 255 };
  if (/^[0-9a-f]{6}$/i.test(h)) return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: 1 };
  if (/^[0-9a-f]{8}$/i.test(h)) return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: parseInt(h.slice(6, 8), 16) / 255 };
  return null;
}

function clamp255(n: number): number { return Math.max(0, Math.min(255, Math.round(n))); }
function clamp01(n: number): number { return Math.max(0, Math.min(1, n)); }

const NUM_RE = /^-?(?:\d+\.?\d*|\.\d+)$/;

/** One rgb()/hsl() component: plain number or percentage (of `full`).
 *  Strict — 'A0bogus' is not a number, and a non-color must parse to null
 *  (an unknown channel silences the check; a wrong color would misjudge it). */
function comp(raw: string, full: number): number | null {
  const t = raw.trim();
  if (t.endsWith('%')) {
    const body = t.slice(0, -1);
    return NUM_RE.test(body) ? (parseFloat(body) / 100) * full : null;
  }
  return NUM_RE.test(t) ? parseFloat(t) : null;
}

/** An hsl() hue with its CSS angle units (deg/grad/rad/turn), in degrees. */
function hueDeg(raw: string): number | null {
  const m = raw.trim().match(/^(-?(?:\d+\.?\d*|\.\d+))(deg|grad|rad|turn)?$/i);
  if (!m) return null;
  const n = parseFloat(m[1]);
  switch ((m[2] ?? 'deg').toLowerCase()) {
    case 'grad': return n * 360 / 400;
    case 'rad': return n * 180 / Math.PI;
    case 'turn': return n * 360;
    default: return n;
  }
}

function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const [r1, g1, b1] = hp < 1 ? [c, x, 0] : hp < 2 ? [x, c, 0] : hp < 3 ? [0, c, x]
    : hp < 4 ? [0, x, c] : hp < 5 ? [x, 0, c] : [c, 0, x];
  const m = l - c / 2;
  return { r: clamp255((r1 + m) * 255), g: clamp255((g1 + m) * 255), b: clamp255((b1 + m) * 255) };
}

/**
 * Parse a CSS color literal → RGBA, or null for anything that isn't one
 * (keywords like 'inherit', field-driven strings, empty). Handles #hex
 * (3/4/6/8), rgb()/rgba() (comma or space separated), hsl()/hsla(), the CSS
 * named colors, and 'transparent' (alpha 0).
 */
export function parseCssColor(raw: unknown): RGBA | null {
  if (typeof raw !== 'string') return null;
  const v = raw.trim().toLowerCase();
  if (!v) return null;
  if (v === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
  if (NAMED[v]) return hexToRgba(NAMED[v]);
  if (v.startsWith('#')) return hexToRgba(v);
  const fn = v.match(/^(rgba?|hsla?)\(\s*([^)]*)\)$/);
  if (!fn) return null;
  const parts = fn[2].split(fn[2].includes(',') ? ',' : /[\s/]+/).map((p) => p.trim()).filter(Boolean);
  if (parts.length < 3 || parts.length > 4) return null;
  const alpha = parts.length === 4 ? comp(parts[3], 1) : 1;
  if (alpha === null) return null;
  if (fn[1].startsWith('rgb')) {
    const r = comp(parts[0], 255), g = comp(parts[1], 255), b = comp(parts[2], 255);
    if (r === null || g === null || b === null) return null;
    return { r: clamp255(r), g: clamp255(g), b: clamp255(b), a: clamp01(alpha) };
  }
  const h = hueDeg(parts[0]);
  const s = comp(parts[1], 1), l = comp(parts[2], 1);
  if (h === null || s === null || l === null) return null;
  return { ...hslToRgb(h, clamp01(s), clamp01(l)), a: clamp01(alpha) };
}

// ─── WCAG math ───────────────────────────────────────────────────────────────

/** WCAG 2.x relative luminance of an (assumed opaque) color. */
export function relativeLuminance(c: RGBA): number {
  const lin = (v: number): number => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
}

/** Alpha-composite `top` over an opaque `under`. */
export function compositeOver(top: RGBA, under: RGBA): RGBA {
  if (top.a >= 1) return top;
  const mix = (t: number, u: number): number => clamp255(t * top.a + u * (1 - top.a));
  return { r: mix(top.r, under.r), g: mix(top.g, under.g), b: mix(top.b, under.b), a: 1 };
}

/**
 * WCAG contrast ratio between text and the (opaque) fill behind it, 1–21.
 * Semi-transparent text is composited over the fill first.
 */
export function contrastRatio(fg: RGBA, bg: RGBA): number {
  const f = relativeLuminance(compositeOver(fg, bg));
  const b = relativeLuminance(bg);
  const [hi, lo] = f >= b ? [f, b] : [b, f];
  return (hi + 0.05) / (lo + 0.05);
}

/** '4.4:1' — one decimal, TRUNCATED, for teaching messages. Truncation keeps
 *  the display honest at the WCAG boundaries: a failing 4.49 must never read
 *  "4.5:1" next to a diagnostic that says it's below 4.5:1. */
export function formatRatio(r: number): string {
  return `${(Math.floor(r * 10) / 10).toFixed(1)}:1`;
}

// ─── Static color-outcome extraction ─────────────────────────────────────────

/**
 * One color an expression can produce. `cond` is a canonical key for the
 * branch path that produces it (null = unconditional); two chains whose
 * entries carry identical cond sequences were built by the same decision
 * tree, so their entries pair positionally.
 */
export interface ColorOutcome { cond: string | null; css: string; rgba: RGBA }

export interface ColorChain {
  entries: ColorOutcome[];
  /** False when some branch's value couldn't be resolved to a color literal
   *  (field-driven, concatenation, empty string, …) — known entries are still
   *  real outcomes, but they aren't the WHOLE story. */
  complete: boolean;
}

/** Canonical key for a condition AST/subexpression (positions don't matter). */
function condKey(node: unknown): string { return JSON.stringify(node); }

function chainFromAst(node: AstNode, path: string, out: ColorOutcome[]): boolean {
  switch (node.kind) {
    case 'str': {
      const rgba = parseCssColor(node.value);
      if (!rgba) return false;
      out.push({ cond: path || null, css: node.value, rgba });
      return true;
    }
    case 'call':
      if (node.fn === 'if' && (node.args.length === 2 || node.args.length === 3)) {
        const key = condKey(node.args[0]);
        const yes = chainFromAst(node.args[1], `${path}+${key}`, out);
        const no = node.args.length === 3 ? chainFromAst(node.args[2], `${path}-${key}`, out) : false;
        return yes && no;
      }
      return false;
    case 'ternary': {
      const key = condKey(node.cond);
      const yes = chainFromAst(node.yes, `${path}+${key}`, out);
      const no = chainFromAst(node.no, `${path}-${key}`, out);
      return yes && no;
    }
    default:
      return false;
  }
}

function chainFromLegacy(node: SPExpr, path: string, out: ColorOutcome[]): boolean {
  if (typeof node === 'string') {
    const rgba = parseCssColor(node);
    if (!rgba) return false;
    out.push({ cond: path || null, css: node, rgba });
    return true;
  }
  if (node && typeof node === 'object' && (node.operator === '?' || node.operator === ':')
    && Array.isArray(node.operands) && node.operands.length === 3) {
    const key = condKey(node.operands[0]);
    const yes = chainFromLegacy(node.operands[1], `${path}+${key}`, out);
    const no = chainFromLegacy(node.operands[2], `${path}-${key}`, out);
    return yes && no;
  }
  return false;
}

/**
 * Every color a style value can statically produce. Literal strings give one
 * unconditional entry; "=if(...)" strings and legacy {"operator":"?"} trees
 * give one entry per resolvable branch. Unresolvable values give an empty,
 * incomplete chain.
 */
export function colorChainOf(value: SPExpr | undefined): ColorChain {
  const entries: ColorOutcome[] = [];
  if (typeof value === 'string') {
    if (value.startsWith('=')) {
      let ast: AstNode;
      try {
        ast = parseExpression(value.slice(1));
      } catch {
        return { entries, complete: false }; // expr-syntax already teaches this
      }
      const complete = chainFromAst(ast, '', entries);
      return { entries, complete };
    }
    const rgba = parseCssColor(value);
    if (rgba) entries.push({ cond: null, css: value.trim(), rgba });
    return { entries, complete: entries.length > 0 };
  }
  if (value && typeof value === 'object') {
    const complete = chainFromLegacy(value, '', entries);
    return { entries, complete };
  }
  return { entries, complete: false };
}

/** A chain that is one unconditional color (a plain literal, effectively). */
function isConstant(c: ColorChain): boolean {
  return c.entries.length === 1 && c.entries[0].cond === null;
}

/**
 * The SOUND text/fill combinations of two chains (see the module header):
 * constant × chain checks every branch against the constant; two conditional
 * chains pair positionally only when their condition sequences are identical.
 * Anything else returns [] — silence over speculation.
 */
export function contrastPairsOf(fg: ColorChain, bg: ColorChain): Array<{ fg: ColorOutcome; bg: ColorOutcome }> {
  if (!fg.entries.length || !bg.entries.length) return [];
  if (isConstant(fg)) return bg.entries.map((b) => ({ fg: fg.entries[0], bg: b }));
  if (isConstant(bg)) return fg.entries.map((f) => ({ fg: f, bg: bg.entries[0] }));
  if (fg.entries.length === bg.entries.length
    && fg.entries.every((f, i) => f.cond === bg.entries[i].cond)) {
    return fg.entries.map((f, i) => ({ fg: f, bg: bg.entries[i] }));
  }
  return [];
}

// ─── Stock theme anchors ─────────────────────────────────────────────────────

/**
 * The default text color and list surface of the stock Fluent themes —
 * mirrors core/theme.ts LIGHT/DARK (neutralPrimary / white). contrast.test.ts
 * pins these against themePalette() so they can't drift apart. Used for the
 * one-sided checks: an authored fill under default text (or authored text on
 * the bare list surface) only warns when it fails BOTH, because a tenant
 * theme decides which one a reader actually gets.
 */
export const STOCK_THEME = {
  light: { text: '#323130', surface: '#ffffff' },
  dark: { text: '#ffffff', surface: '#1f1f1f' },
} as const;
