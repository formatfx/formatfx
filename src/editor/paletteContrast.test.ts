// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Sam Yost

/**
 * editor/paletteContrast.test.ts — the product practices what its linter
 * preaches.
 *
 * The low-contrast rule (core/linter.ts over core/contrast.ts) teaches WCAG
 * contrast on authored color pairs. Everything FormatFX ships or generates
 * must hold itself to the same bar:
 *
 *  - the default showcase workspace lints without ANY low-contrast rows
 *    (a fresh landing must not open on a nagging badge)
 *  - every palette preset and built-in component is free of low-contrast
 *    WARNINGS (the <3:1 tier); the soft condRules looks sit knowingly in
 *    the 3:1–4.5:1 info band — Fluent's own pastel pairs — so info is
 *    tolerated for THOSE, and pinned so it never quietly gets worse
 *
 * When a new preset/component/look trips this file, fix the colors — don't
 * loosen the sweep. (#737a7f died for exactly that: 4.36:1 under white pill
 * text; #605e5c reads the same and passes.)
 */

import { describe, it, expect } from 'vitest';
import { lintDocument } from '../core/linter';
import type { FormatterDocument } from '../core/types';
import { state, defaultFields } from './state';
import { PALETTE } from './presets';
import { BUILTIN_COMPONENTS } from './components';
import { COND_EFFECTS, COND_COLORS } from './condRules';

const contrastIssues = (doc: FormatterDocument) =>
  lintDocument(doc).filter((i) => i.rule === 'low-contrast');

describe('shipped formatting vs the low-contrast rule', () => {
  it('the default showcase workspace lints with zero low-contrast rows', () => {
    const fields = defaultFields();
    const issues = lintDocument(
      state.floorDoc,
      fields.map((f) => f.name),
      Object.fromEntries(fields.map((f) => [f.name, f.type])),
    ).filter((i) => i.rule === 'low-contrast');
    expect(issues.map((i) => `${i.severity}: ${i.message}`)).toEqual([]);
  });

  it('every palette preset is warning-free (and today, info-free too)', () => {
    const offenders: string[] = [];
    for (const p of PALETTE) {
      for (const i of contrastIssues({ kind: 'column', root: p.create() })) {
        offenders.push(`${p.id} [${i.severity}]: ${i.message}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('every built-in component is warning-free (and today, info-free too)', () => {
    const offenders: string[] = [];
    for (const c of BUILTIN_COMPONENTS) {
      for (const i of contrastIssues({ kind: 'column', root: c.root })) {
        offenders.push(`${c.id} [${i.severity}]: ${i.message}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('condRules effects never fall below 3:1; only "fill" and "strike" may sit in the info band', () => {
    // fill = Fluent's own pastel pairs; strike = a deliberate de-emphasis
    // whose literal opacity the linter now models. Every OTHER effect must be
    // completely silent — an info on text/pill/stripe is a palette regression.
    const infoAllowed = new Set(['fill', 'strike']);
    const offenders: string[] = [];
    for (const effect of COND_EFFECTS) {
      for (const color of COND_COLORS) {
        const style = { ...effect.static, ...effect.conditional(color) };
        const issues = contrastIssues({
          kind: 'column',
          root: { elmType: 'div', txtContent: 'sample', style },
        });
        for (const i of issues) {
          if (i.severity !== 'info' || !infoAllowed.has(effect.id)) {
            offenders.push(`${effect.id}/${color.id} [${i.severity}]: ${i.message}`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
