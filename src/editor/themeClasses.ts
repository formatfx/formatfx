// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Sam Yost

/**
 * editor/themeClasses.ts — the color ↔ theme-class bridge (pure).
 *
 * SharePoint ships theme-aware utility classes that recolor with the tenant
 * theme (and dark mode) where a hardcoded hex cannot:
 *   ms-fontColor-{token}      → text color
 *   ms-bgColor-{token}        → background fill (+ sp-css-backgroundColor-{token})
 *   sp-css-borderColor-{token}→ border color
 *   sp-field-severity--{level}→ semantic status fill (SharePoint's own padding)
 *
 * This module is the single source of truth for mapping the editor's named
 * palette (aligned 1:1 to condRules' COND_COLORS ids) to those class tokens,
 * for reversing a token back to what it means, and for the two mutations that
 * write/clear a theme class on an element. It is DOM-free and state-free so it
 * is unit-tested directly (themeClasses.test.ts) and reused by the inspector,
 * Format Cells, and the conditional-formatting codegen.
 *
 * It leans on classPrecedence.ts for "which class governs which CSS slot" so
 * "same slot" always means exactly what the governance UI means.
 */

import type { SPElement, SPExpr } from '../core/types';
import { classTokens, CLASS_PRECEDENCE_RULES, type ClassRule } from './classPrecedence';

/** The three color slots a picker offers. */
export type ColorRole = 'text' | 'fill' | 'border';

/** SharePoint's five semantic status levels (sp-field-severity--*). */
export type SeverityLevel = 'good' | 'low' | 'warning' | 'severeWarning' | 'blocked';

/** The CSS property each role paints — kept in lockstep with CLASS_PRECEDENCE_RULES. */
export const ROLE_PROP: Record<ColorRole, string> = {
  text: 'color',
  fill: 'background-color',
  border: 'border-color',
};

/**
 * One bridge color. `text`/`fill`/`border` are Fluent palette token names (keys
 * of theme.ts's LIGHT/DARK maps); they can differ per role — e.g. gray uses a
 * lighter token for a fill than for ink/border. `soft` is an optional pastel
 * fill token.
 */
export interface ThemeColor {
  id: string;
  label: string;
  text: string;
  fill: string;
  border: string;
  soft?: string;
}

/**
 * The bridge palette — ids match condRules' COND_COLORS so the hex and class
 * palettes are interchangeable. Tokens are real theme.ts palette keys, so every
 * one has emulated light/dark CSS behind it (and honors a pasted tenant palette).
 */
export const THEME_COLORS: ThemeColor[] = [
  { id: 'green',  label: 'Green',  text: 'green',            fill: 'green',             border: 'green',            soft: 'successBackground50' },
  { id: 'red',    label: 'Red',    text: 'redDark',          fill: 'red',               border: 'redDark',          soft: 'errorBackground50' },
  { id: 'amber',  label: 'Amber',  text: 'orange',           fill: 'orange',            border: 'orange',           soft: 'warningBackground50' },
  { id: 'blue',   label: 'Blue',   text: 'themePrimary',     fill: 'themePrimary',      border: 'themePrimary',     soft: 'themeLighter' },
  { id: 'teal',   label: 'Teal',   text: 'teal',             fill: 'teal',              border: 'teal' },
  { id: 'purple', label: 'Purple', text: 'purple',           fill: 'purple',            border: 'purple' },
  { id: 'gray',   label: 'Gray',   text: 'neutralSecondary', fill: 'neutralQuaternary', border: 'neutralSecondary', soft: 'neutralLighter' },
];

/** Severity levels in ascending order, with the emulated background hex for previews. */
export const SEVERITY_LEVELS: { level: SeverityLevel; label: string; bg: string }[] = [
  { level: 'good',          label: 'Good',   bg: '#dff6dd' },
  { level: 'low',           label: 'Low',    bg: '#fff4ce' },
  { level: 'warning',       label: 'Warning', bg: '#fff4ce' },
  { level: 'severeWarning', label: 'Severe', bg: '#fed9cc' },
  { level: 'blocked',       label: 'Blocked', bg: '#fde7e9' },
];

export function themeColor(id: string): ThemeColor {
  return THEME_COLORS.find((c) => c.id === id) ?? THEME_COLORS[3];
}

/** Build the class token for a palette color in a role (fill can be `soft`). */
export function paletteClass(role: ColorRole, c: ThemeColor, soft = false): string {
  switch (role) {
    case 'text': return `ms-fontColor-${c.text}`;
    case 'border': return `sp-css-borderColor-${c.border}`;
    case 'fill': return `ms-bgColor-${soft && c.soft ? c.soft : c.fill}`;
  }
}

/** Build a semantic status-fill class. */
export function severityClass(level: SeverityLevel): string {
  return `sp-field-severity--${level}`;
}

/** What a single class token means (or null if it isn't one of ours). */
export interface ClassMeaning {
  role: ColorRole;
  token: string;
  /** present for palette-token classes */
  colorId?: string;
  /** true when the token is a color's soft/pastel fill */
  soft?: boolean;
  /** present for sp-field-severity--* classes */
  severity?: SeverityLevel;
}

const RE = {
  font: /^(?:ms-fontColor|sp-css-color)-(.+)$/,
  bg: /^(?:ms-bgColor|sp-css-backgroundColor)-(.+)$/,
  border: /^(?:sp-css-borderColor|ms-borderColor)-(.+)$/,
  severity: /^sp-field-severity--(.+)$/,
};

/** Reverse a single class token to its meaning within the bridge palette. */
export function parseThemeClass(token: string): ClassMeaning | null {
  let m: RegExpExecArray | null;
  if ((m = RE.font.exec(token))) {
    const c = THEME_COLORS.find((x) => x.text === m![1]);
    return c ? { role: 'text', token, colorId: c.id } : null;
  }
  if ((m = RE.bg.exec(token))) {
    const solid = THEME_COLORS.find((x) => x.fill === m![1]);
    if (solid) return { role: 'fill', token, colorId: solid.id, soft: false };
    const soft = THEME_COLORS.find((x) => x.soft === m![1]);
    if (soft) return { role: 'fill', token, colorId: soft.id, soft: true };
    return null;
  }
  if ((m = RE.border.exec(token))) {
    const c = THEME_COLORS.find((x) => x.border === m![1]);
    return c ? { role: 'border', token, colorId: c.id } : null;
  }
  if ((m = RE.severity.exec(token))) {
    const level = m[1] as SeverityLevel;
    return SEVERITY_LEVELS.some((s) => s.level === level)
      ? { role: 'fill', token, severity: level }
      : null;
  }
  return null;
}

/** The element's active theme class for a role — the token that actually governs
 *  the slot. When several same-slot tokens are present the LAST one wins, matching
 *  the precedence engine's CSS-source-order rule (governedProperties). */
export function activeThemeClass(el: SPElement, role: ColorRole): ClassMeaning | null {
  let match: ClassMeaning | null = null;
  for (const token of classTokens(el.attributes?.class)) {
    const info = parseThemeClass(token);
    if (info && info.role === role) match = info;
  }
  return match;
}

const BORDER_ALL = /^sp-field-borderAll/.source;

/** The precedence rules that paint a role's slot, excluding the borderAll shorthand. */
function slotRules(role: ColorRole): ClassRule[] {
  const prop = ROLE_PROP[role];
  return CLASS_PRECEDENCE_RULES.filter((r) => r.props.includes(prop) && r.test.source !== BORDER_ALL);
}

function isFormula(v: SPExpr | undefined): boolean {
  return typeof v === 'string' && v.trim().startsWith('=');
}

/**
 * Swap `token` in for `role`: drop any existing same-slot theme token and CLEAR
 * the conflicting inline style prop (so governance reads `governed`, not a dead
 * `overridden`). Refuses a formula-valued class — returns false and leaves the
 * element untouched (refuse-don't-guess; the caller should teach, not clobber).
 */
export function setThemeClass(el: SPElement, role: ColorRole, token: string): boolean {
  const raw = el.attributes?.class;
  if (isFormula(raw)) return false;
  const rules = slotRules(role);
  const kept = classTokens(raw).filter((t) => !rules.some((r) => r.test.test(t)));
  kept.push(token);
  el.attributes = el.attributes ?? {};
  el.attributes.class = kept.join(' ');
  if (el.style) {
    delete el.style[ROLE_PROP[role]];
    if (Object.keys(el.style).length === 0) delete el.style;
  }
  return true;
}

/** Remove the active theme class for `role`; leave other classes and inline styles alone. */
export function clearThemeClass(el: SPElement, role: ColorRole): void {
  const raw = el.attributes?.class;
  if (typeof raw !== 'string' || isFormula(raw)) return;
  const rules = slotRules(role);
  const kept = classTokens(raw).filter((t) => !rules.some((r) => r.test.test(t)));
  if (!el.attributes) return;
  if (kept.length) {
    el.attributes.class = kept.join(' ');
  } else {
    delete el.attributes.class;
    if (Object.keys(el.attributes).length === 0) delete el.attributes;
  }
}
