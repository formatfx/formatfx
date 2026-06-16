/**
 * editor/fxSuggest.ts — type-aware value suggestions for the fx bar (pure).
 *
 * Each property slot offers values that FIT it and the list's column types:
 * colour slots offer the palette plus a colour-by-condition template built
 * from a real field (a choice's first value, an overdue date, a number
 * threshold, a yes/no); the text slot offers field references and display
 * templates; weight/border slots offer their idioms. Field references use the
 * Excel bracket form ([Display Name]) the fx bar speaks.
 *
 * Invariant (pinned by fxSuggest.test.ts): every suggestion that is a formula
 * (starts with '=') round-trips through the transpiler without a refusal — the
 * bar never proposes something it would then reject. Confidence is the product.
 *
 * No DOM, no state — a sibling of fxSlots.ts / dialect.ts.
 */

import type { MockField } from '../core/types';
import type { FxSlot } from './fxSlots';
import { COND_COLORS, suggestChoiceColors, condColor } from './condRules';

const label = (f: MockField): string => `[${f.displayName ?? f.name}]`;

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

/** Suggestions for a slot, ordered useful-first; de-duplicated. */
export function fxSuggestions(slot: FxSlot, fields: MockField[]): string[] {
  const out: string[] = [];
  const choice = sampleChoice(find(fields, 'choice', 'choiceMulti'));
  const date = find(fields, 'date');
  const num = find(fields, 'number', 'currency');
  const bool = find(fields, 'boolean');

  if (slot.kind === 'text') {
    if (choice) out.push(`=IF(${label(choice.field)} = "${choice.value}", "${choice.value} ✓", ${label(choice.field)})`);
    if (fields.length >= 2) out.push(`=${label(fields[0])} & " — " & ${label(fields[1])}`);
    if (fields[0]) out.push(`=IF(${label(fields[0])} = "", "—", ${label(fields[0])})`);
    out.push(...fields.map(label));
    return dedupe(out);
  }

  const kind = styleKindOf(slot.prop!);
  if (kind === 'color') {
    if (choice) {
      const c = condColor(suggestChoiceColors([choice.value]).get(choice.value) ?? 'blue');
      out.push(`=IF(${label(choice.field)} = "${choice.value}", "${c.strong}", "")`);
    }
    if (date) out.push(`=IF(${label(date)} < TODAY(), "#d13438", "")`);
    if (num) out.push(`=IF(${label(num)} >= 100, "#107c10", "#d13438")`);
    if (bool) out.push(`=IF(${label(bool)} = TRUE, "#107c10", "#d13438")`);
    out.push(...COND_COLORS.map((c) => c.strong));
    return dedupe(out);
  }
  if (kind === 'weight') {
    if (choice) out.push(`=IF(${label(choice.field)} = "${choice.value}", "700", "400")`);
    out.push('bold', '600', '700', 'normal');
    return dedupe(out);
  }
  if (kind === 'border') {
    if (choice) {
      const c = condColor(suggestChoiceColors([choice.value]).get(choice.value) ?? 'blue');
      out.push(`=IF(${label(choice.field)} = "${choice.value}", "3px solid ${c.strong}", "0")`);
    }
    out.push('3px solid #0078d4', '3px solid #d13438', '2px dashed #605e5c');
    return dedupe(out);
  }
  // generic style property: let an expression reference the data
  if (num) out.push(`=${label(num)} & "%"`);
  out.push(...fields.map(label));
  return dedupe(out);
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}
