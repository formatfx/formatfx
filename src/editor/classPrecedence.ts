/**
 * editor/classPrecedence.ts — the SharePoint class-precedence engine (pure).
 *
 * SharePoint ships utility classes (ms-bgColor-*, sp-field-severity--*, …) that
 * paint properties a formatter would otherwise set inline. When such a class is
 * present on an element, the Left Edit Pane shows the matching property as
 * "governed by <class>" (a class wins unless an inline style overrides it).
 *
 * This module is the source of truth for *which* class governs *which* CSS
 * property slot. It is DOM-free and state-free so it can be unit-tested directly
 * (see classPrecedence.test.ts) — §5.C of the Left Edit Pane spec is the table.
 */

import type { SPExpr } from '../core/types';

/** One class→property mapping rule. `props` are the CSS slots the class paints. */
export interface ClassRule {
  /** Tested against each whitespace-separated class token. */
  test: RegExp;
  /** The CSS property slots this class governs. */
  props: string[];
}

/**
 * The §5.C mapping table, in cascade order (later rules win for a shared prop,
 * mirroring CSS source order). Patterns are anchored at the start of the token
 * so `sp-field-severityX` does NOT match `sp-field-severity--`.
 */
export const CLASS_PRECEDENCE_RULES: ClassRule[] = [
  // background-color
  { test: /^sp-css-backgroundColor-/, props: ['background-color'] },
  { test: /^ms-bgColor-/, props: ['background-color'] },
  { test: /^sp-field-severity--/, props: ['background-color'] },
  // color
  { test: /^sp-css-color-/, props: ['color'] },
  { test: /^ms-fontColor-/, props: ['color'] },
  // border-color
  { test: /^sp-css-borderColor-/, props: ['border-color'] },
  { test: /^ms-borderColor-/, props: ['border-color'] },
  // font-size
  { test: /^sp-field-fontSize/, props: ['font-size'] },
  { test: /^ms-fontSize-/, props: ['font-size'] },
  // font-weight
  { test: /^ms-fontWeight-/, props: ['font-weight'] },
  { test: /^sp-card-boldText$/, props: ['font-weight'] },
  // border shorthand (paints all three border facets)
  { test: /^sp-field-borderAll/, props: ['border-width', 'border-style', 'border-color'] },
];

/**
 * The set of CSS properties any precedence rule can govern — useful for the
 * inspector to know up-front which slots are "governable".
 */
export const GOVERNABLE_PROPS: ReadonlySet<string> = new Set(
  CLASS_PRECEDENCE_RULES.flatMap((r) => r.props),
);

/** Extract the literal class tokens from a class attribute value.
 *  Expression-valued class attributes (formulas / AST) are opaque → []. */
export function classTokens(classAttr: SPExpr | undefined): string[] {
  if (typeof classAttr !== 'string') return [];
  // a formula (=…) can't be statically tokenized — treat as no static classes
  if (classAttr.trim().startsWith('=')) return [];
  return classAttr.split(/\s+/).filter(Boolean);
}

/**
 * Map every governed CSS property to the class token that governs it. When two
 * present classes govern the same property, the later token wins (CSS order).
 */
export function governedProperties(classAttr: SPExpr | undefined): Map<string, string> {
  const out = new Map<string, string>();
  for (const token of classTokens(classAttr)) {
    for (const rule of CLASS_PRECEDENCE_RULES) {
      if (rule.test.test(token)) {
        for (const prop of rule.props) out.set(prop, token);
      }
    }
  }
  return out;
}

/** How a single property relates to the element's classes + inline styles. */
export type GovernanceKind = 'none' | 'governed' | 'overridden';

export interface Governance {
  kind: GovernanceKind;
  /** The governing class token (when kind !== 'none'). */
  className?: string;
}

/**
 * Resolve the governance of one property:
 *  - `none`       — no class governs it (the control behaves normally).
 *  - `governed`   — a class paints it and there is no inline override (the
 *                   control should fade + show "(governed by …)").
 *  - `overridden` — a class would paint it but an inline style wins (show the
 *                   "[Class Overridden]" badge with the class as a tooltip).
 */
export function governanceFor(
  prop: string,
  classAttr: SPExpr | undefined,
  hasInlineValue: boolean,
): Governance {
  const className = governedProperties(classAttr).get(prop);
  if (!className) return { kind: 'none' };
  return { kind: hasInlineValue ? 'overridden' : 'governed', className };
}
