// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sam Yost. FormatFX is dual-licensed: AGPL-3.0 (see LICENSE) or a commercial license (see LICENSING.md).

/**
 * editor/areas.ts — Pure brain for Stage 3 "make a row view": turning grid
 * columns into a row-formatter layout of weighted **areas**.
 *
 * No DOM, no state imports — node-testable, like gridScaffold.ts / condRules.ts.
 * A grid is a row formatter in embryo (its root is already a flex row, each
 * child one area), so a "row view" is the same tree viewed/sized as an explicit
 * layout: each area carries an independent, conflict-free flex **weight**
 * (Normal/Wide/Widest, exactly like CSS `fr`), and the row carries a single
 * **density** knob (Roomy/Compact) that only sets gap + padding.
 */

import type { SPElement } from '../core/types';

/** Per-area sizing: independent normalized weights (CSS-`fr`-like, conflict-free). */
export type AreaWeight = 'normal' | 'wide' | 'widest';
/** Row-level breathing room — a separate knob from per-area sizing. */
export type RowDensity = 'roomy' | 'compact';

/** Weight → the `flex` grow factor it paints as. Normal is the grid default (1). */
export const WEIGHT_FLEX: Record<AreaWeight, string> = {
  normal: '1',
  wide: '2',
  widest: '3',
};

export const WEIGHT_LABEL: Record<AreaWeight, string> = {
  normal: 'Normal',
  wide: 'Wide',
  widest: 'Widest',
};

/** Density → the gap/padding it paints as on the row root. */
export const DENSITY_STYLE: Record<RowDensity, { gap: string; padding: string }> = {
  roomy: { gap: '16px', padding: '10px 12px' },
  compact: { gap: '8px', padding: '4px 8px' },
};

export const DENSITY_LABEL: Record<RowDensity, string> = {
  roomy: 'Roomy',
  compact: 'Compact',
};

/** First number in a `flex` value ("2", "2 1 0%", "1 0 120px" …), or null. */
function flexGrow(flex: unknown): number | null {
  if (typeof flex === 'number') return flex;
  if (typeof flex !== 'string') return null;
  const m = flex.trim().match(/^-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
}

/** The weight an area currently paints as (Normal when no/identity flex). */
export function areaWeightOf(el: SPElement): AreaWeight {
  const g = flexGrow(el.style?.['flex']);
  if (g !== null && g >= 3) return 'widest';
  if (g !== null && g >= 2) return 'wide';
  return 'normal';
}

/** Set an area's weight in place (the caller wraps this in one undo step). */
export function setAreaWeight(el: SPElement, weight: AreaWeight): void {
  el.style = el.style ?? {};
  el.style['flex'] = WEIGHT_FLEX[weight];
  // an area must be allowed to shrink, or a Widest neighbor can squeeze it out
  if (el.style['min-width'] === undefined) el.style['min-width'] = '0';
}

/** The density the row currently paints as (Roomy unless it matches Compact). */
export function rowDensityOf(root: SPElement): RowDensity {
  return root.style?.['gap'] === DENSITY_STYLE.compact.gap ? 'compact' : 'roomy';
}

/** Set the row's density in place (gap + padding only — never touches areas). */
export function setRowDensity(root: SPElement, density: RowDensity): void {
  root.style = root.style ?? {};
  root.style['gap'] = DENSITY_STYLE[density].gap;
  root.style['padding'] = DENSITY_STYLE[density].padding;
}

/**
 * Build a row-view root from a grid root. The chosen columns (all, or the
 * `include` index subset in the order given) become areas — each gets a flex
 * weight (Normal unless it already carried a heavier one) so sizing is
 * conflict-free, and the row gets the requested density. The tree is otherwise
 * the same elements, so it round-trips as a view (row) formatter unchanged.
 */
export function buildRowView(
  gridRoot: SPElement,
  include?: number[],
  density: RowDensity = 'roomy',
): SPElement {
  const kids = gridRoot.children ?? [];
  const chosen = include?.length
    ? include.filter((i) => i >= 0 && i < kids.length).map((i) => kids[i])
    : kids;
  const root: SPElement = {
    ...gridRoot,
    elmType: gridRoot.elmType || 'div',
    _elmName: gridRoot._elmName ?? 'Row layout',
    style: {
      'display': 'flex',
      'align-items': 'center',
      'width': '100%',
      ...gridRoot.style,
    },
    children: chosen.map((c) => {
      const area: SPElement = { ...c, style: { ...c.style } };
      setAreaWeight(area, areaWeightOf(area)); // normalize: every area has a weight
      return area;
    }),
  };
  setRowDensity(root, density);
  return root;
}
