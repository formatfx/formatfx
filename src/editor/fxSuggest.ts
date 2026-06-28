/**
 * editor/fxSuggest.ts — value suggestions for the fx bar (pure).
 *
 * Two sources of depth, blended per slot:
 *   1. type-aware TEMPLATES built from the list's columns — a colour-by-choice,
 *      an overdue-date colour, a number threshold, a yes/no, text composition;
 *   2. the same flat VALUE vocabulary the style playground offers
 *      (STYLE_VALUE_SUGGESTIONS) plus the conditional-formatting palette, so a
 *      slot offers concrete values to pick, not just a blank line.
 * Field references use the Excel bracket form (=[Display Name]) the bar speaks.
 *
 * Invariant (pinned by fxSuggest.test.ts): every suggestion that is a formula
 * (starts with '=') round-trips through the transpiler without a refusal — the
 * bar never proposes something it would then reject. Confidence is the product.
 *
 * No DOM, no state — a sibling of fxSlots.ts / dialect.ts.
 */

import type { MockField } from '../core/types';
import { STYLE_VALUE_SUGGESTIONS, ICON_SUGGESTIONS } from '../core/schema';
import type { FxSlot } from './fxSlots';
import { COND_COLORS, suggestChoiceColors, condColor } from './condRules';

const fieldRef = (f: MockField): string => `[${f.displayName ?? f.name}]`;

/** A choice value safe to embed in a literal (no quote — SP strings can't escape). */
function sampleChoice(f: MockField | undefined): { field: MockField; value: string } | null {
  if (!f?.choices?.length) return null;
  const value = f.choices.find((c) => !/['"]/.test(c));
  return value ? { field: f, value } : null;
}

function find(fields: MockField[], ...types: MockField['type'][]): MockField | undefined {
  return fields.find((f) => types.includes(f.type));
}

type StyleKind = 'color' | 'border' | 'weight' | 'generic';

function styleKindOf(prop: string): StyleKind {
  if (prop === 'font-weight') return 'weight';
  if (prop.includes('border') || prop === 'outline') return 'border';
  if (prop.includes('color') || prop === 'fill' || prop === 'stroke' || prop === 'background') return 'color';
  return 'generic';
}

/** The playground's literal value choices for a property (drop SP-syntax samples). */
function playgroundValues(prop: string | undefined): string[] {
  if (!prop) return [];
  return (STYLE_VALUE_SUGGESTIONS[prop] ?? []).filter((v) => !v.startsWith('='));
}

/** Map a recipe-relative vocab ref (@currentField / [$Field] / [!Field], each
 *  optionally with a `.prop` tail) to the bar's Excel form (=[Display Name.prop]);
 *  already-formula tokens pass through, and a ref to a column not in the schema
 *  is dropped. The dotted tail (e.g. .title / .lookupValue) is preserved so a
 *  person/lookup recipe's vocab keeps its display sub-field. */
function excelRef(field: MockField, prop?: string): string {
  return `=[${field.displayName ?? field.name}${prop ? `.${prop}` : ''}]`;
}
function vocabRefToExcel(token: string, fields: MockField[], current?: MockField): string | null {
  if (token.startsWith('=')) return token;
  const cur = token.match(/^@currentField(?:\.([A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*))?$/);
  if (cur) return current ? excelRef(current, cur[1]) : null;
  const m = token.match(/^\[[$!]([A-Za-z0-9_]+)(?:\.([^\]]+))?\]$/);
  if (m) { const f = fields.find((x) => x.name === m[1]); return f ? excelRef(f, m[2]) : null; }
  return null;
}

/** Subtype vocab the fx bar should offer for the column under @currentField. */
export interface SuggestVocab { refs: string[]; values: string[]; }

/**
 * Suggestions for a slot, ordered useful-first; de-duplicated.
 *
 * US-8: when `opts.vocab` is a column-subtype's NON-EMPTY vocab, the broad
 * `...refs`/`...values` padding is replaced by ONLY that vocab (refs mapped to
 * the bar's Excel form for the current column); an empty vocab or no subtype
 * falls back to today's padding unchanged. The curated per-slot templates,
 * palette and idioms are kept either way.
 */
export function fxSuggestions(
  slot: FxSlot,
  fields: MockField[],
  opts?: { current?: MockField; vocab?: SuggestVocab },
): string[] {
  const out: string[] = [];
  const choice = sampleChoice(find(fields, 'choice', 'choiceMulti'));
  const date = find(fields, 'date');
  const num = find(fields, 'number', 'currency');
  const bool = find(fields, 'boolean');
  const strictVocab = !!opts?.vocab && (opts.vocab.refs.length > 0 || opts.vocab.values.length > 0);
  const refs = strictVocab
    ? dedupe(opts!.vocab!.refs.map((r) => vocabRefToExcel(r, fields, opts!.current)).filter((x): x is string => x !== null))
    : fields.map((f) => `=${fieldRef(f)}`);

  if (slot.kind === 'text') {
    if (choice) out.push(`=IF(${fieldRef(choice.field)} = "${choice.value}", "${choice.value} ✓", ${fieldRef(choice.field)})`);
    if (fields.length >= 2) out.push(`=${fieldRef(fields[0])} & " — " & ${fieldRef(fields[1])}`);
    if (fields[0]) out.push(`=IF(${fieldRef(fields[0])} = "", "—", ${fieldRef(fields[0])})`);
    out.push(...refs);
    return dedupe(out);
  }

  if (slot.picker === 'icon') {
    // a handful of common icons as quick chips; the full gallery is one click
    // away in the bar. (Literals — applied as-is, no transpile needed.)
    return [...ICON_SUGGESTIONS];
  }

  if (slot.kind === 'attr') {
    // an attribute (image URL, link URL) is usually bound to a column's value
    out.push(...refs);
    return dedupe(out);
  }

  const kind = styleKindOf(slot.prop!);
  const values = strictVocab ? opts!.vocab!.values : playgroundValues(slot.prop);
  if (kind === 'color') {
    if (choice) {
      const c = condColor(suggestChoiceColors([choice.value]).get(choice.value) ?? 'blue');
      out.push(`=IF(${fieldRef(choice.field)} = "${choice.value}", "${c.strong}", "")`);
    }
    if (date) out.push(`=IF(${fieldRef(date)} < TODAY(), "#d13438", "")`);
    if (num) out.push(`=IF(${fieldRef(num)} >= 100, "#107c10", "#d13438")`);
    if (bool) out.push(`=IF(${fieldRef(bool)} = TRUE, "#107c10", "#d13438")`);
    out.push(...COND_COLORS.map((c) => c.strong), ...values);
    return dedupe(out);
  }
  if (kind === 'weight') {
    if (choice) out.push(`=IF(${fieldRef(choice.field)} = "${choice.value}", "700", "400")`);
    out.push('bold', '600', '700', 'normal', ...values);
    return dedupe(out);
  }
  if (kind === 'border') {
    if (choice) {
      const c = condColor(suggestChoiceColors([choice.value]).get(choice.value) ?? 'blue');
      out.push(`=IF(${fieldRef(choice.field)} = "${choice.value}", "3px solid ${c.strong}", "0")`);
    }
    out.push('3px solid #0078d4', '3px solid #d13438', '2px dashed #605e5c', ...values);
    return dedupe(out);
  }
  // generic style property: playground values + an expression referencing data
  if (num) out.push(`=${fieldRef(num)} & "%"`);
  out.push(...values, ...refs);
  return dedupe(out);
}

// ─── inline autocomplete (pure) ──────────────────────────────────────────────
// Completions for the fx bar's as-you-type typeahead. Everything offered is
// Excel-dialect and round-trips through excelToSp without a refusal (the same
// invariant fxSuggestions holds, pinned by fxSuggest.test.ts): the bar never
// proposes a token it would then reject.

/** Column references in the bar's Excel bracket form — offered while typing `[`. */
export function columnCompletions(fields: MockField[]): string[] {
  return dedupe(fields.map((f) => `[${f.displayName ?? f.name}]`));
}

/**
 * The Excel-dialect words the bar understands — its functions, the context
 * tokens (TODAY/NOW/ME) and the boolean constants — offered while typing a bare
 * identifier (or after `@`). Entries ending in `(` are call openers (the maker
 * keeps typing the arguments); the rest are complete and round-trip on their own.
 */
export function contextCompletions(): string[] {
  return ['IF(', 'AND(', 'OR(', 'NOT(', 'TODAY()', 'NOW()', 'ME()', 'TRUE', 'FALSE'];
}

/** Condition starters for after `IF(` — one type-aware comparison per column. */
export function operandSuggestions(fields: MockField[]): string[] {
  const out: string[] = [];
  const choice = sampleChoice(find(fields, 'choice', 'choiceMulti'));
  const date = find(fields, 'date');
  const num = find(fields, 'number', 'currency');
  const bool = find(fields, 'boolean');
  if (choice) out.push(`${fieldRef(choice.field)} = "${choice.value}"`);
  if (date) out.push(`${fieldRef(date)} < TODAY()`);
  if (num) out.push(`${fieldRef(num)} >= 100`);
  if (bool) out.push(`${fieldRef(bool)} = TRUE`);
  if (fields[0]) out.push(`${fieldRef(fields[0])} <> ""`, `${fieldRef(fields[0])} = ""`);
  return dedupe(out);
}

/**
 * Result values for a slot, in formula (quoted) form — the THEN / ELSE branches
 * of an IF(). Property-type-aware: colours for paint, weights for bold, the
 * slot's value vocabulary otherwise; text / attribute slots resolve to column
 * references (plus an empty fallback). An empty string `""` clears the property.
 */
export function resultSuggestions(slot: FxSlot, fields: MockField[]): string[] {
  if (slot.kind === 'text' || slot.kind === 'attr') {
    return dedupe([...columnCompletions(fields), '""']);
  }
  const quote = (v: string) => `"${v}"`;
  const kind = styleKindOf(slot.prop!);
  if (kind === 'color') return dedupe([...COND_COLORS.map((c) => quote(c.strong)), '""']);
  if (kind === 'weight') return dedupe(['"700"', '"600"', '"400"']);
  if (kind === 'border') return dedupe(['"3px solid #d13438"', '"3px solid #0078d4"', '""']);
  return dedupe([...playgroundValues(slot.prop).map(quote), '""']);
}

/** A live completion: the choices, and the [from, to) text range a pick replaces. */
export interface Completion { items: string[]; from: number; to: number; }

const WORD_RE = /[A-Za-z_][A-Za-z0-9_]*$/;
const AT_RE = /@[A-Za-z]*$/;

/**
 * What to suggest for the caret position in an fx-bar formula — or null when
 * nothing applies. Pure (no DOM) so it is unit-tested directly. Completions are
 * offered only inside a formula (leading `=`); a plain literal gets none.
 *   • inside an unclosed `[…`  → column references (filtered by the partial)
 *   • after `@…`               → context tokens (the `@` is replaced)
 *   • right after `IF(`/`AND(`… → condition operands
 *   • right after a `,`        → slot-typed result values
 *   • a bare word              → functions / context tokens / constants (by prefix)
 */
export function completionAt(text: string, caret: number, slot: FxSlot, fields: MockField[]): Completion | null {
  const before = text.slice(0, caret);
  if (!/^\s*=/.test(before)) return null; // literals get no dialect completions

  // inside an unclosed [column …
  const lb = before.lastIndexOf('[');
  if (lb >= 0 && !before.slice(lb).includes(']')) {
    const partial = before.slice(lb + 1).toLowerCase();
    const items = columnCompletions(fields).filter((c) => c.slice(1, -1).toLowerCase().includes(partial));
    return items.length ? { items, from: lb, to: caret } : null;
  }

  // @context token (replace the whole @word)
  const at = before.match(AT_RE);
  if (at) {
    const partial = at[0].slice(1).toLowerCase();
    const items = contextCompletions().filter((c) => c.toLowerCase().startsWith(partial));
    return items.length ? { items, from: caret - at[0].length, to: caret } : null;
  }

  // just opened a function call → condition operands; just typed a comma → results
  const trimmed = before.replace(/\s+$/, '');
  const last = trimmed.slice(-1);
  if (last === '(') {
    const fn = trimmed.slice(0, -1).match(WORD_RE)?.[0]?.toLowerCase();
    if (fn === 'if' || fn === 'and' || fn === 'or' || fn === 'not') {
      const items = operandSuggestions(fields);
      return items.length ? { items, from: caret, to: caret } : null;
    }
  }
  if (last === ',') {
    const items = resultSuggestions(slot, fields);
    return items.length ? { items, from: caret, to: caret } : null;
  }

  // a bare identifier word → functions / context tokens / constants by prefix
  const w = before.match(WORD_RE);
  if (w) {
    const partial = w[0].toLowerCase();
    const items = contextCompletions().filter((c) => c.toLowerCase().startsWith(partial));
    return items.length ? { items, from: caret - w[0].length, to: caret } : null;
  }

  return null;
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}
