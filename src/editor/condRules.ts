// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sam Yost. FormatFX is dual-licensed: AGPL-3.0 (see LICENSE) or a commercial license (see LICENSING.md).

/**
 * editor/condRules.ts — pure logic for the conditional-formatting builder:
 * the type-aware condition catalog, the looks (style bundles), the color
 * palette with keyword-smart choice mapping, and SP expression generation.
 *
 * No DOM, no state imports — node-testable, like gridScaffold. The exact
 * semantics of every generated condition (blank cells, per-type quirks,
 * the no-NOT rule) are pinned by condRules.test.ts — that test file is the
 * contract; change behavior there first.
 *
 * Rule semantics: rules read top-down and the FIRST matching rule wins for
 * every property it manages — one mental model, no Excel priority maze.
 * An element's existing plain value for a managed property becomes the
 * "no rule matched" fallback, so conditional formatting layers over a look
 * instead of erasing it.
 */

import type { MockField, SPExpr } from '../core/types';

// ─── colors ──────────────────────────────────────────────────────────────────

export interface CondColor {
  id: string;
  label: string;
  /** Saturated tone — solid pill fill, text ink, stripes. */
  strong: string;
  /** Pastel tone — soft fills behind `strong` text. */
  soft: string;
}

export const COND_COLORS: CondColor[] = [
  { id: 'green', label: 'Green', strong: '#107c10', soft: '#dff6dd' },
  { id: 'red', label: 'Red', strong: '#d13438', soft: '#fde7e9' },
  { id: 'amber', label: 'Amber', strong: '#ca5010', soft: '#fff4ce' },
  { id: 'blue', label: 'Blue', strong: '#0078d4', soft: '#deecf9' },
  { id: 'teal', label: 'Teal', strong: '#038387', soft: '#daf3f2' },
  { id: 'purple', label: 'Purple', strong: '#5c2d91', soft: '#ece4f6' },
  { id: 'gray', label: 'Gray', strong: '#605e5c', soft: '#f3f2f1' },
];

export function condColor(id: string): CondColor {
  return COND_COLORS.find((c) => c.id === id) ?? COND_COLORS[3];
}

/** Keyword-smart color for a choice value ("Done" → green, "Blocked" → red…). */
const CHOICE_KEYWORDS: Array<[RegExp, string]> = [
  // negations first — "Not started" must not fall into the "started" bucket
  [/not started|new|todo|to do|backlog|none|n\/a/i, 'gray'],
  [/done|complete|closed|resolved|approved|success|finished|ready|shipped|yes|good|pass/i, 'green'],
  [/block|fail|reject|cancel|critical|severe|risk|overdue|late|breach|escalat/i, 'red'],
  [/progress|active|review|working|started|doing|current|testing/i, 'blue'],
  [/hold|wait|pend|paused|draft|warn|medium|defer|triage/i, 'amber'],
];

export function suggestChoiceColors(choices: string[]): Map<string, string> {
  const out = new Map<string, string>();
  const rotation = ['purple', 'teal', 'blue', 'amber', 'gray'];
  let next = 0;
  for (const choice of choices) {
    const hit = CHOICE_KEYWORDS.find(([re]) => re.test(choice));
    out.set(choice, hit ? hit[1] : rotation[next++ % rotation.length]);
  }
  return out;
}

// ─── conditions ──────────────────────────────────────────────────────────────

export type CondKind =
  | 'eq' | 'contains' | 'empty' | 'notEmpty'
  | 'gte' | 'lt'
  | 'overdue' | 'today' | 'soon'
  | 'isMe' | 'isTrue' | 'isFalse';

export interface Condition {
  kind: CondKind;
  /** Comparison value for eq/contains/gte/lt. */
  value?: string;
  /** Window size for 'soon'. */
  days?: number;
}

/** A pickable condition in the builder, suggested by the field's type. */
export interface CondOption {
  kind: CondKind;
  label: string;
  /** The chip needs an inline input before it can become a rule. */
  needs?: 'text' | 'number' | 'days';
  /** Pre-filled value (each choice arrives as its own ready chip). */
  value?: string;
  /** Color the builder preselects when this condition is picked. */
  suggestColor: string;
}

const MULTI = new Set(['personMulti', 'lookupMulti', 'choiceMulti']);

/** What's worth testing on this field — the menu IS the thinking. */
export function conditionOptionsFor(field: MockField): CondOption[] {
  switch (field.type) {
    case 'choice': case 'choiceMulti': {
      const colors = suggestChoiceColors(field.choices ?? []);
      return [
        ...(field.choices ?? []).map((c): CondOption => ({
          kind: 'eq', value: c, label: `is ${c}`, suggestColor: colors.get(c) ?? 'blue',
        })),
        { kind: 'empty', label: 'is empty', suggestColor: 'gray' },
      ];
    }
    case 'date':
      return [
        { kind: 'overdue', label: 'is in the past (overdue)', suggestColor: 'red' },
        { kind: 'today', label: 'is today', suggestColor: 'blue' },
        { kind: 'soon', label: 'is within the next … days', needs: 'days', suggestColor: 'amber' },
        { kind: 'empty', label: 'has no date', suggestColor: 'gray' },
      ];
    case 'number': case 'currency':
      return [
        { kind: 'gte', label: 'is at least …', needs: 'number', suggestColor: 'green' },
        { kind: 'lt', label: 'is below …', needs: 'number', suggestColor: 'red' },
        { kind: 'empty', label: 'is empty', suggestColor: 'gray' },
      ];
    case 'person': case 'personMulti':
      return [
        { kind: 'isMe', label: field.type === 'personMulti' ? 'includes you' : 'is you', suggestColor: 'blue' },
        { kind: 'empty', label: 'is unassigned', suggestColor: 'gray' },
      ];
    case 'boolean':
      return [
        { kind: 'isTrue', label: 'is Yes', suggestColor: 'green' },
        { kind: 'isFalse', label: 'is No', suggestColor: 'gray' },
      ];
    case 'lookup': case 'lookupMulti':
      return [
        { kind: 'eq', label: 'is exactly …', needs: 'text', suggestColor: 'blue' },
        { kind: 'empty', label: 'is empty', suggestColor: 'gray' },
      ];
    default: // text, note, hyperlink
      return [
        { kind: 'eq', label: 'is exactly …', needs: 'text', suggestColor: 'blue' },
        { kind: 'contains', label: 'contains …', needs: 'text', suggestColor: 'amber' },
        { kind: 'empty', label: 'is empty', suggestColor: 'gray' },
        { kind: 'notEmpty', label: 'has a value', suggestColor: 'green' },
      ];
  }
}

/** SP string literals have no escape syntax — quotes simply can't appear. */
export function escapeCondValue(raw: string): string {
  return raw.replace(/['"\\]/g, '').trim();
}

/** The boolean SP expression (no leading '=') for one condition. */
export function condExpr(field: MockField, cond: Condition): string {
  const n = field.name;
  const r = `[$${n}]`;
  const multi = MULTI.has(field.type);
  switch (cond.kind) {
    case 'eq': {
      const v = escapeCondValue(cond.value ?? '');
      if (field.type === 'lookup') return `[$${n}.lookupValue] == '${v}'`;
      if (field.type === 'lookupMulti') return `indexOf([$${n}.lookupValue], '${v}') != -1`;
      if (field.type === 'choiceMulti') return `indexOf(${r}, '${v}') != -1`;
      return `${r} == '${v}'`;
    }
    case 'contains': {
      const v = escapeCondValue(cond.value ?? '').toLowerCase();
      return `indexOf(toLowerCase(${r}), '${v}') != -1`;
    }
    case 'empty':
      // blank-cell detection per type — pinned in condRules.test.ts
      if (multi) return `length(${r}) == 0`;
      if (field.type === 'date' || field.type === 'lookup' || field.type === 'person') {
        return `toString(${r}) == ''`;
      }
      return `${r} == ''`;
    case 'notEmpty':
      if (multi) return `length(${r}) != 0`;
      if (field.type === 'date' || field.type === 'lookup' || field.type === 'person') {
        return `toString(${r}) != ''`;
      }
      return `${r} != ''`;
    case 'gte': return `${r} >= ${numLiteral(cond.value)}`;
    case 'lt': return `${r} < ${numLiteral(cond.value)}`;
    // date comparisons keep their blank guard — pinned in condRules.test.ts
    case 'overdue': return `toString(${r}) != '' && ${r} < @now`;
    case 'today':
      return `toString(${r}) != '' && getDate(${r}) == getDate(@now) && getMonth(${r}) == getMonth(@now) && getYear(${r}) == getYear(@now)`;
    case 'soon': {
      const days = Math.max(1, Math.min(365, Math.round(cond.days ?? 7)));
      return `toString(${r}) != '' && ${r} >= @now && ${r} <= addDays(@now, ${days})`;
    }
    case 'isMe':
      return field.type === 'personMulti'
        ? `indexOf([$${n}.email], @me) != -1`
        : `[$${n}.email] == @me`;
    // SP has no logical NOT ('!=' is fine; a standalone '!' is not) —
    // booleans compare explicitly
    case 'isTrue': return `${r} == true`;
    case 'isFalse': return `${r} == false`;
  }
}

function numLiteral(raw: string | undefined): string {
  const v = Number(raw);
  return Number.isFinite(v) ? String(v) : '0';
}

/** Plain-language readout: "Status is Blocked", "DueDate is overdue"… */
export function condLabel(field: MockField, cond: Condition): string {
  const n = field.displayName ?? field.name;
  switch (cond.kind) {
    case 'eq': return `${n} is ${cond.value}`;
    case 'contains': return `${n} contains "${cond.value}"`;
    case 'empty': return field.type === 'person' || field.type === 'personMulti'
      ? `${n} is unassigned` : `${n} is empty`;
    case 'notEmpty': return `${n} has a value`;
    case 'gte': return `${n} is at least ${cond.value}`;
    case 'lt': return `${n} is below ${cond.value}`;
    case 'overdue': return `${n} is overdue`;
    case 'today': return `${n} is today`;
    case 'soon': return `${n} is within ${cond.days ?? 7} days`;
    case 'isMe': return `${n} is you`;
    case 'isTrue': return `${n} is Yes`;
    case 'isFalse': return `${n} is No`;
  }
}

// ─── looks (effects) ─────────────────────────────────────────────────────────

export type EffectId = 'text' | 'fill' | 'pill' | 'stripe' | 'strike';

export interface CondEffect {
  id: EffectId;
  label: string;
  hint: string;
  /** Properties that follow the rules (conditional, per matched color). */
  conditional: (c: CondColor) => Record<string, string>;
  /** Scaffolding applied once, unconditionally (shape, not color). */
  static?: Record<string, string>;
}

export const COND_EFFECTS: CondEffect[] = [
  {
    id: 'text', label: 'Color the text', hint: 'Ink only — the quietest signal',
    conditional: (c) => ({ 'color': c.strong, 'font-weight': '600' }),
  },
  {
    id: 'fill', label: 'Soft fill', hint: 'Pastel background, dark ink — easy on dashboards',
    conditional: (c) => ({ 'background-color': c.soft, 'color': c.strong }),
    static: { 'border-radius': '4px', 'padding': '2px 8px' },
  },
  {
    id: 'pill', label: 'Solid pill', hint: 'The classic status pill — white text on color',
    conditional: (c) => ({ 'background-color': c.strong, 'color': '#ffffff' }),
    static: {
      'display': 'inline-flex', 'align-items': 'center', 'justify-content': 'center',
      'border-radius': '12px', 'padding': '2px 10px', 'font-size': '12px', 'font-weight': '600',
    },
  },
  {
    id: 'stripe', label: 'Edge stripe', hint: 'A colored left border — subtle row accent',
    conditional: (c) => ({ 'border-left': `3px solid ${c.strong}` }),
    static: { 'padding-left': '8px' },
  },
  {
    id: 'strike', label: 'Strike out', hint: 'Cross it off and fade it — done/cancelled items',
    conditional: (c) => ({ 'text-decoration': 'line-through', 'opacity': '0.6', 'color': c.strong }),
  },
];

export function condEffect(id: EffectId): CondEffect {
  return COND_EFFECTS.find((e) => e.id === id) ?? COND_EFFECTS[1];
}

// ─── rules → style ───────────────────────────────────────────────────────────

export interface CondRule {
  cond: Condition;
  effect: EffectId;
  /** CondColor id. */
  color: string;
}

export interface GeneratedStyle {
  /** Property → value or '=if(…)' chain, ready to merge into element.style. */
  style: Record<string, string>;
  /** Managed properties whose existing value was a formula (now replaced). */
  replacedFormulas: string[];
}

/**
 * Compile rules into style properties. Per conditional property the chain
 * threads through EVERY rule in order ('' when a rule doesn't set it), so
 * the first matching rule wins outright across all properties.
 */
export function rulesToStyle(
  field: MockField,
  rules: CondRule[],
  existing?: Record<string, SPExpr | undefined>,
): GeneratedStyle {
  const style: Record<string, string> = {};
  const replacedFormulas: string[] = [];

  const perRule = rules.map((rule) => ({
    expr: condExpr(field, rule.cond),
    props: condEffect(rule.effect).conditional(condColor(rule.color)),
  }));

  const conditionalProps = new Set<string>();
  for (const r of perRule) for (const k of Object.keys(r.props)) conditionalProps.add(k);

  for (const prop of conditionalProps) {
    const prior = existing?.[prop];
    const fallback = typeof prior === 'string' && !prior.startsWith('=') ? prior : '';
    if (prior !== undefined && (typeof prior !== 'string' || prior.startsWith('='))) {
      replacedFormulas.push(prop);
    }
    let expr = `'${fallback}'`;
    for (let i = perRule.length - 1; i >= 0; i--) {
      expr = `if(${perRule[i].expr}, '${perRule[i].props[prop] ?? ''}', ${expr})`;
    }
    style[prop] = `=${expr}`;
  }

  // scaffolding: first rule using an effect pins that effect's statics
  for (const rule of rules) {
    for (const [k, v] of Object.entries(condEffect(rule.effect).static ?? {})) {
      if (!(k in style)) {
        const prior = existing?.[k];
        if (prior !== undefined && (typeof prior !== 'string' || prior.startsWith('='))) {
          replacedFormulas.push(k);
        }
        style[k] = v;
      }
    }
  }

  return { style, replacedFormulas };
}
