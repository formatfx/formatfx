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

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}
