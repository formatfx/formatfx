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
import { parseThemeClass } from './themeClasses';

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
  | 'eq' | 'neq' | 'contains' | 'empty' | 'notEmpty'
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
    case 'neq': {
      // the mirror of eq, negated INSIDE the expression — there is no logical
      // NOT, so '!=' / '== -1' carry the negation (never a standalone '!')
      const v = escapeCondValue(cond.value ?? '');
      if (field.type === 'lookup') return `[$${n}.lookupValue] != '${v}'`;
      if (field.type === 'lookupMulti') return `indexOf([$${n}.lookupValue], '${v}') == -1`;
      if (field.type === 'choiceMulti') return `indexOf(${r}, '${v}') == -1`;
      return `${r} != '${v}'`;
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
    case 'neq': return `${n} is not ${cond.value}`;
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

// ─── style → rules (the parse-back; §6 1.7's "obvious next step") ────────────
// The builder is not a one-way generator anymore: `=if()` chains IT generated
// parse back into editable rules. Correctness is the REBUILD-VERIFY gate —
// the parse is best-effort, then regenerated through rulesToStyle and every
// chain must come back byte-identical; anything hand-edited beyond the
// builder's vocabulary fails the gate and the dialog starts fresh (the
// templateModal round-trip precedent). Refuse-and-teach: a failed parse
// returns null, never a guessed rule.

export interface ParsedRules {
  rules: CondRule[];
  /** The WATCHED field the chains test (may differ from the painted column). */
  fieldName: string;
  /** Per managed property, the pre-rules plain fallback ('' = there was none). */
  fallbacks: Record<string, string>;
}

/** One parsed `=if(e1,'v1', if(e2,'v2', … '<fallback>'))` chain. */
interface IfChain { exprs: string[]; values: string[]; fallback: string }

/** SP string literal: single-quoted, and there is no escape syntax — a quote
 *  simply cannot appear inside (escapeCondValue strips them on the way in). */
function unquote(raw: string): string | null {
  if (raw.length < 2 || !raw.startsWith("'") || !raw.endsWith("'")) return null;
  const inner = raw.slice(1, -1);
  return inner.includes("'") ? null : inner;
}

/** Split `if(…)` innards into exactly three top-level arguments —
 *  paren-depth and quote aware, so commas inside nested calls don't split. */
function splitIfArgs(inner: string): [string, string, string] | null {
  const parts: string[] = [];
  let depth = 0;
  let quote = false;
  let start = 0;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (quote) { if (ch === "'") quote = false; continue; }
    if (ch === "'") quote = true;
    else if (ch === '(') depth++;
    else if (ch === ')') { depth--; if (depth < 0) return null; }
    else if (ch === ',' && depth === 0) {
      if (parts.length === 2) return null; // a 4th top-level argument isn't our shape
      parts.push(inner.slice(start, i));
      start = i + 1;
    }
  }
  if (quote || depth !== 0 || parts.length !== 2) return null;
  parts.push(inner.slice(start));
  return [parts[0].trim(), parts[1].trim(), parts[2].trim()];
}

/** Parse a generated chain: `=if(expr, 'value', <rest>)` nesting in the last
 *  argument until a plain quoted fallback. Null on any other shape. */
function parseIfChain(raw: SPExpr | undefined): IfChain | null {
  if (typeof raw !== 'string' || !raw.startsWith('=if(')) return null;
  const exprs: string[] = [];
  const values: string[] = [];
  let cur = raw.slice(1);
  while (cur.startsWith('if(') && cur.endsWith(')')) {
    const args = splitIfArgs(cur.slice(3, -1));
    if (!args) return null;
    const v = unquote(args[1]);
    if (v === null) return null;
    exprs.push(args[0]);
    values.push(v);
    cur = args[2];
  }
  if (!exprs.length) return null;
  const fallback = unquote(cur);
  if (fallback === null) return null;
  return { exprs, values, fallback };
}

/** The first `[$Name]` / `[$Name.prop]` reference in a condition. */
const FIELD_REF = /\[\$([A-Za-z0-9_]+)(?:\.[A-Za-z0-9_]+)?\]/;

/**
 * Recover the Condition behind one generated expression. Extraction is
 * deliberately sloppy regex — every candidate is VERIFIED by regenerating
 * condExpr and requiring an exact string match, so a sloppy pull can only
 * refuse, never mis-parse.
 */
function matchCondition(field: MockField, expr: string): Condition | null {
  const candidates: Condition[] = [
    { kind: 'empty' }, { kind: 'notEmpty' }, { kind: 'overdue' },
    { kind: 'today' }, { kind: 'isMe' }, { kind: 'isTrue' }, { kind: 'isFalse' },
  ];
  const quoted = /'([^']*)'/.exec(expr)?.[1];
  if (quoted !== undefined) {
    candidates.push(
      { kind: 'eq', value: quoted },
      { kind: 'neq', value: quoted },
      { kind: 'contains', value: quoted },
    );
  }
  const num = /(?:>=|<) (-?\d+(?:\.\d+)?)/.exec(expr)?.[1];
  if (num !== undefined) {
    candidates.push({ kind: 'gte', value: num }, { kind: 'lt', value: num });
  }
  const days = /addDays\(@now, (\d+)\)/.exec(expr)?.[1];
  if (days !== undefined) candidates.push({ kind: 'soon', days: Number(days) });
  return candidates.find((c) => condExpr(field, c) === expr) ?? null;
}

/** Recover rule i's look: the (effect, color) whose conditional properties
 *  match the chains' values at index i exactly — and every OTHER managed
 *  property must carry '' there (the rule doesn't set it). */
function matchLook(
  chains: Record<string, IfChain>,
  props: string[],
  i: number,
): { effect: EffectId; color: string } | null {
  for (const effect of COND_EFFECTS) {
    for (const color of COND_COLORS) {
      const want = effect.conditional(color);
      const ok = Object.keys(want).every((p) => p in chains)
        && props.every((p) => {
          const expected = want[p];
          return expected !== undefined ? chains[p].values[i] === expected : chains[p].values[i] === '';
        });
      if (ok) return { effect: effect.id, color: color.id };
    }
  }
  return null;
}

/**
 * Parse a style's generated `=if()` chains back into editable rules, the
 * watched field, and the pre-rules fallbacks. Null whenever the style isn't
 * something this builder produced (no chains, a foreign condition, a
 * hand-edited value, disagreeing condition spines) — gated at the end by
 * regenerating every chain and requiring byte-identical output.
 */
export function parseRulesFromStyle(
  style: Record<string, SPExpr | undefined> | undefined,
  fields: MockField[],
): ParsedRules | null {
  if (!style) return null;
  const chains: Record<string, IfChain> = {};
  for (const [prop, raw] of Object.entries(style)) {
    const chain = parseIfChain(raw);
    if (chain) chains[prop] = chain;
    // non-chain formulas on other props are simply unmanaged — ignored here
  }
  const props = Object.keys(chains);
  if (!props.length) return null;

  // one condition SPINE across every managed property — rulesToStyle threads
  // the same rule list through each chain, so any disagreement is foreign
  const spine = chains[props[0]].exprs;
  for (const p of props) {
    const e = chains[p].exprs;
    if (e.length !== spine.length || e.some((x, i) => x !== spine[i])) return null;
  }

  const fieldName = FIELD_REF.exec(spine[0])?.[1];
  const field = fieldName ? fields.find((f) => f.name === fieldName) : undefined;
  if (!field) return null;

  const rules: CondRule[] = [];
  for (let i = 0; i < spine.length; i++) {
    const cond = matchCondition(field, spine[i]);
    if (!cond) return null;
    const look = matchLook(chains, props, i);
    if (!look) return null;
    rules.push({ cond, effect: look.effect, color: look.color });
  }
  const fallbacks: Record<string, string> = {};
  for (const p of props) fallbacks[p] = chains[p].fallback;

  // the rebuild-verify gate: regenerate from the parse and require every
  // chain byte-for-byte. (Statics aren't gated — the dialog re-pins shape on
  // apply, and a hand-tweaked static is not destructive to round-trip.)
  const existing: Record<string, string> = {};
  for (const [p, fb] of Object.entries(fallbacks)) if (fb) existing[p] = fb;
  const regen = rulesToStyle(field, rules, existing);
  for (const p of props) if (regen.style[p] !== style[p]) return null;

  return { rules, fieldName: field.name, fallbacks };
}

// ─── property mapping (Map Data — issue #217) ────────────────────────────────
// One PROPERTY, one `=if()` chain: the visual IF / ELSE-IF / ELSE builder
// compiles each row through the SAME condExpr vocabulary the ✨ dialog uses
// (no parallel codegen), and parses back under the same rebuild-verify
// discipline — byte-identical regeneration or refuse. Unlike rulesToStyle
// (one watched field fanned across effect properties), a map's rows may each
// watch a DIFFERENT column.

export interface MapRule {
  /** The column this row watches. */
  fieldName: string;
  cond: Condition;
  /** The value the property takes when this row matches first. */
  output: string;
}

export interface ParsedMap { rules: MapRule[]; elseOutput: string }

/** An operator the Map Data builder may offer for a column — strictly the
 *  engine's verified vocabulary per type: no 'greater' on plain text, dates
 *  through the pinned overdue/today/soon semantics, and never a standalone
 *  '!' (neq negates with '!=' / '== -1' inside the expression). */
export interface MapOperator {
  kind: CondKind;
  label: string;
  /** The comparison input this operator needs, if any. */
  needs?: 'text' | 'number' | 'days';
}

export function mapOperatorsFor(field: MockField): MapOperator[] {
  switch (field.type) {
    case 'choice':
      return [
        { kind: 'eq', label: 'equals', needs: 'text' },
        { kind: 'neq', label: 'does not equal', needs: 'text' },
        { kind: 'empty', label: 'is empty' },
        { kind: 'notEmpty', label: 'has a value' },
      ];
    case 'choiceMulti': case 'lookupMulti':
      return [
        { kind: 'eq', label: 'includes', needs: 'text' },
        { kind: 'neq', label: 'does not include', needs: 'text' },
        { kind: 'empty', label: 'is empty' },
        { kind: 'notEmpty', label: 'has a value' },
      ];
    case 'number': case 'currency':
      return [
        { kind: 'gte', label: 'is at least (≥)', needs: 'number' },
        { kind: 'lt', label: 'is below (<)', needs: 'number' },
        { kind: 'empty', label: 'is empty' },
        { kind: 'notEmpty', label: 'has a value' },
      ];
    case 'date':
      return [
        { kind: 'overdue', label: 'is in the past (overdue)' },
        { kind: 'today', label: 'is today' },
        { kind: 'soon', label: 'is within the next … days', needs: 'days' },
        { kind: 'empty', label: 'has no date' },
        { kind: 'notEmpty', label: 'has a date' },
      ];
    case 'person':
      return [
        { kind: 'isMe', label: 'is you' },
        { kind: 'empty', label: 'is unassigned' },
        { kind: 'notEmpty', label: 'is assigned' },
      ];
    case 'personMulti':
      return [
        { kind: 'isMe', label: 'includes you' },
        { kind: 'empty', label: 'is unassigned' },
        { kind: 'notEmpty', label: 'is assigned' },
      ];
    case 'boolean':
      return [
        { kind: 'isTrue', label: 'is Yes' },
        { kind: 'isFalse', label: 'is No' },
      ];
    case 'lookup':
      return [
        { kind: 'eq', label: 'equals', needs: 'text' },
        { kind: 'neq', label: 'does not equal', needs: 'text' },
        { kind: 'empty', label: 'is empty' },
        { kind: 'notEmpty', label: 'has a value' },
      ];
    default: // text, note, hyperlink
      return [
        { kind: 'eq', label: 'equals', needs: 'text' },
        { kind: 'neq', label: 'does not equal', needs: 'text' },
        { kind: 'contains', label: 'contains', needs: 'text' },
        { kind: 'empty', label: 'is empty' },
        { kind: 'notEmpty', label: 'has a value' },
      ];
  }
}

/** Output values live inside SP single-quoted literals, which have no escape
 *  syntax — quotes simply can't appear (escapeCondValue's rule, minus the
 *  trim: an output is a value, not a search term). */
export function escapeMapOutput(raw: string): string {
  return raw.replace(/['"\\]/g, '');
}

/**
 * Compile IF/ELSE-IF rows + an ELSE output into one `=if(…)` chain — the
 * exact chain shape rulesToStyle emits, so parseIfChain/parseMapFromExpr
 * read it back. Null when a rule names an unknown column or there are no
 * rules at all (refuse — never guess).
 */
export function mapRulesToExpr(
  fields: MockField[],
  rules: MapRule[],
  elseOutput: string,
): string | null {
  if (!rules.length) return null;
  let expr = `'${escapeMapOutput(elseOutput)}'`;
  for (let i = rules.length - 1; i >= 0; i--) {
    const field = fields.find((f) => f.name === rules[i].fieldName);
    if (!field) return null;
    expr = `if(${condExpr(field, rules[i].cond)}, '${escapeMapOutput(rules[i].output)}', ${expr})`;
  }
  return `=${expr}`;
}

/**
 * Parse a generated map chain back into editable rows (each row recovering
 * its own watched column) + the ELSE output. Gated exactly like
 * parseRulesFromStyle: regenerate through mapRulesToExpr and require the
 * byte-identical expression — a hand-edited or foreign formula returns null,
 * never a guessed row.
 */
export function parseMapFromExpr(
  raw: SPExpr | undefined,
  fields: MockField[],
): ParsedMap | null {
  const chain = parseIfChain(raw);
  if (!chain) return null;
  const rules: MapRule[] = [];
  for (let i = 0; i < chain.exprs.length; i++) {
    const name = FIELD_REF.exec(chain.exprs[i])?.[1];
    const field = name ? fields.find((f) => f.name === name) : undefined;
    if (!field) return null;
    const cond = matchCondition(field, chain.exprs[i]);
    if (!cond) return null;
    rules.push({ fieldName: field.name, cond, output: chain.values[i] });
  }
  if (mapRulesToExpr(fields, rules, chain.fallback) !== raw) return null;
  return { rules, elseOutput: chain.fallback };
}

// ─── rules → theme class (the classes-first conditional look) ─────────────────
// One watched field, ONE `=if()` chain of theme-class tokens for attributes.class
// (e.g. =if([$Status]=='Done','sp-field-severity--good','')). Same spine shape as
// rulesToStyle (one field fanned across rules), but the value per rule is a single
// class token instead of per-property style values — so a conditional look
// survives dark mode and tenant re-theming. Parses back under the same
// rebuild-verify discipline, and every token must be recognized theme-class
// vocabulary (refuse-and-teach on anything foreign).

export interface CondClassRule {
  cond: Condition;
  /** The theme-class token applied when this rule matches first. */
  token: string;
}

export interface ParsedClassRules {
  rules: CondClassRule[];
  /** The watched field the chain tests. */
  fieldName: string;
  /** The class applied when no rule matches ('' = none). */
  elseToken: string;
}

/** Compile single-field rules into one `=if()` class chain. Null on no rules. */
export function rulesToClass(field: MockField, rules: CondClassRule[], elseToken = ''): string | null {
  if (!rules.length) return null;
  let expr = `'${elseToken}'`;
  for (let i = rules.length - 1; i >= 0; i--) {
    expr = `if(${condExpr(field, rules[i].cond)}, '${rules[i].token}', ${expr})`;
  }
  return `=${expr}`;
}

/**
 * Parse a generated class chain back into editable rules + the watched field.
 * Single spine field (like parseRulesFromStyle), every rule token a recognized
 * theme class, gated by byte-identical regeneration — a hand-edited or foreign
 * formula returns null, never a guessed rule.
 */
export function parseClassRules(raw: SPExpr | undefined, fields: MockField[]): ParsedClassRules | null {
  const chain = parseIfChain(raw);
  if (!chain) return null;
  const name = FIELD_REF.exec(chain.exprs[0])?.[1];
  const field = name ? fields.find((f) => f.name === name) : undefined;
  if (!field) return null;
  const rules: CondClassRule[] = [];
  for (let i = 0; i < chain.exprs.length; i++) {
    if (FIELD_REF.exec(chain.exprs[i])?.[1] !== field.name) return null; // one watched field
    const cond = matchCondition(field, chain.exprs[i]);
    if (!cond) return null;
    if (!parseThemeClass(chain.values[i])) return null; // only our theme-class vocabulary
    rules.push({ cond, token: chain.values[i] });
  }
  if (rulesToClass(field, rules, chain.fallback) !== raw) return null;
  return { rules, fieldName: field.name, elseToken: chain.fallback };
}
