// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Sam Yost

/**
 * editor/lintBadge.ts — how the lint panel announces a diagnostic's severity.
 *
 * The linter is FormatFX's teaching surface; "confidence is the product" means
 * its single most important signal — is this a hard error or a gentle nudge? —
 * must be perceivable WITHOUT colour. A 3px coloured stripe alone makes error
 * (red) and warning (amber) indistinguishable to ~1 in 12 men (deuteranopia),
 * i.e. the teaching surface silently fails to teach. So every level carries a
 * distinct GLYPH (shape) and a WORD here; colour (applied in CSS) is a third,
 * redundant cue. Pure + node-tested, like the other editor cores.
 */

export interface LintBadge {
  /** A decorative shape cue (rendered aria-hidden — the word carries the meaning). */
  glyph: string;
  /** The human level word, e.g. "Error". */
  label: string;
}

// A Map (not a plain object) so an arbitrary severity string — including
// prototype-chain keys like "__proto__" or "constructor" — can never resolve
// to an inherited member; unknown levels fall through to the neutral badge.
const BADGES = new Map<string, LintBadge>([
  ['error', { glyph: '✕', label: 'Error' }],
  ['warning', { glyph: '⚠', label: 'Warning' }],
  ['info', { glyph: 'ⓘ', label: 'Info' }],
  ['runtime', { glyph: '◆', label: 'Runtime' }],
]);

/** Map a severity to its badge; an unknown level gets a neutral, never-blank badge. */
export function lintBadge(sev: string): LintBadge {
  return BADGES.get(sev) ?? { glyph: '•', label: capitalise(sev) || 'Note' };
}

/** Screen-reader label that leads with the level word (not the decorative glyph). */
export function lintAriaLabel(sev: string, text: string): string {
  return `${lintBadge(sev).label}: ${text}`;
}

function capitalise(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}
