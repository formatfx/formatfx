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

import type { FieldType, MockField } from '../core/types';
import { STYLE_VALUE_SUGGESTIONS, ICON_SUGGESTIONS, SPECIAL_TOKENS } from '../core/schema';
import { evaluate, type EvalContext, type SPValue } from '../core/expressions';
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
//
// #222 upgrades the typeahead to IntelliSense: each completion is a
// SuggestItem carrying its output type, a one-line doc, and — when the mock
// row can evaluate it honestly — a live preview of the current value. The
// catalog is grounded in what the engine resolves (SPECIAL_TOKENS + the
// column schema); a token src/core doesn't know is never offered, and a
// sub-property (.email, .lookupValue) is only offered on a column TYPE that
// legally carries it (refuse-don't-guess).

/** What a completion evaluates to — shown as the type badge in the menu. */
export type SuggestValueType = 'string' | 'number' | 'boolean' | 'date' | 'object' | 'array';

/** One IntelliSense completion: the inserted text plus its inline docs. */
export interface SuggestItem {
  /** The text spliced into the formula (brackets already closed). */
  insert: string;
  /** Output type badge, when known. */
  type?: SuggestValueType;
  /** One-line description of what the value represents. */
  doc?: string;
  /** The current mock value (from the data editor's row) — absent when it
   *  can't be previewed honestly (objects, eval errors, no context given). */
  preview?: string;
}

const toItem = (insert: string): SuggestItem => ({ insert });

/** Options threaded from the editor: the @currentField column + eval context. */
export interface CompletionOpts {
  /** The column @currentField resolves to (state.currentFieldName). */
  current?: MockField;
  /** Eval context for live mock previews (the data editor's row). */
  ctx?: EvalContext;
}

// ── live mock previews (honest or absent) ──

/** Evaluate an SP-dialect body against the mock row; undefined = no honest preview. */
function previewOf(spBody: string, ctx?: EvalContext): string | undefined {
  if (!ctx) return undefined;
  try { return formatPreview(evaluate(spBody, ctx)); } catch { return undefined; }
}

/** A short, honest rendering of a mock value — or undefined for shapes (bare
 *  objects) that have no faithful one-line form. Never a guess. */
function formatPreview(v: SPValue): string | undefined {
  if (v === null || v === '') return '(empty)';
  if (v instanceof Date) return clip(v.toLocaleString());
  if (Array.isArray(v)) {
    if (v.length === 0) return '(empty)';
    const parts = v.map(formatPreview);
    if (parts.some((p) => p === undefined)) return undefined;
    return clip(parts.join(', '));
  }
  if (typeof v === 'object') return undefined;
  return clip(String(v));
}

function clip(s: string): string {
  return s.length > 40 ? `${s.slice(0, 39)}…` : s;
}

// ── the token / column catalogs (grounded in src/core) ──

/** Docs for every token in the engine's SPECIAL_TOKENS list — keyed by the
 *  exact token so the catalog can never drift ahead of what core resolves. */
const TOKEN_DOCS: Record<string, { type?: SuggestValueType; doc: string }> = {
  // no type badge: @currentField is whatever the current column is — when the
  // column is unknown (no opts.current) an honest badge is no badge at all
  '@currentField': { doc: 'The value of the column this formatter paints' },
  '@me': { type: 'string', doc: 'The signed-in viewer’s email address' },
  '@now': { type: 'date', doc: 'The current date and time' },
  '@rowIndex': { type: 'number', doc: 'The row’s position in the view (first row is 0)' },
  '@isSelected': { type: 'boolean', doc: 'Whether the viewer has selected this row' },
  '@currentWeb': { type: 'string', doc: 'The site’s absolute URL' },
  '@group': { type: 'string', doc: 'The group header value (group headers only)' },
  '@columnAggregate': { type: 'object', doc: 'The column total in a group/footer (use .value)' },
  '@lastIndexedTime': { type: 'date', doc: 'When search last indexed this item' },
  '@thumbnail': { type: 'string', doc: 'Thumbnail URL of the item’s file' },
  '@window.innerWidth': { type: 'number', doc: 'The browser window’s width in pixels' },
  '@window.innerHeight': { type: 'number', doc: 'The browser window’s height in pixels' },
};

/** Sub-properties the engine resolves on a person value ([$X.email], @me-shaped). */
const PERSON_PROPS: ReadonlyArray<{ name: string; type: SuggestValueType; doc: string }> = [
  { name: 'title', type: 'string', doc: 'The person’s display name' },
  { name: 'email', type: 'string', doc: 'The person’s email address' },
  { name: 'picture', type: 'string', doc: 'Profile photo URL' },
  { name: 'jobTitle', type: 'string', doc: 'The person’s job title' },
  { name: 'department', type: 'string', doc: 'The person’s department' },
  { name: 'sip', type: 'string', doc: 'IM (SIP) address' },
  { name: 'id', type: 'string', doc: 'The person’s user id' },
];

/** Sub-properties of a lookup value. */
const LOOKUP_PROPS: ReadonlyArray<{ name: string; type: SuggestValueType; doc: string }> = [
  { name: 'lookupValue', type: 'string', doc: 'The looked-up item’s text' },
  { name: 'lookupId', type: 'number', doc: 'The looked-up item’s list id' },
];

/** The sub-properties LEGAL for a column type — empty for scalar columns, so
 *  `.email` is never offered on a text column (refuse-don't-guess). */
function subpropsFor(type: FieldType): ReadonlyArray<{ name: string; type: SuggestValueType; doc: string }> {
  if (type === 'person' || type === 'personMulti') return PERSON_PROPS;
  if (type === 'lookup' || type === 'lookupMulti') return LOOKUP_PROPS;
  return [];
}

const MULTI_TYPES: ReadonlySet<FieldType> = new Set(['choiceMulti', 'personMulti', 'lookupMulti']);

/** What a whole column value evaluates to, per schema type. */
function outputTypeOf(type: FieldType): SuggestValueType {
  switch (type) {
    case 'number': case 'currency': return 'number';
    case 'boolean': return 'boolean';
    case 'date': return 'date';
    case 'person': case 'lookup': return 'object';
    case 'choiceMulti': case 'personMulti': case 'lookupMulti': return 'array';
    default: return 'string'; // text, note, choice, hyperlink
  }
}

const TYPE_LABELS: Record<FieldType, string> = {
  text: 'Text', note: 'Multi-line text', number: 'Number', currency: 'Currency',
  choice: 'Choice', choiceMulti: 'Multi-choice', date: 'Date', person: 'Person',
  personMulti: 'Multi-person', boolean: 'Yes/No', hyperlink: 'Hyperlink',
  lookup: 'Lookup', lookupMulti: 'Multi-lookup',
};

/**
 * System context tokens (@currentField, @me, @now, @rowIndex, …) as rich
 * items — exactly the engine's SPECIAL_TOKENS, nothing invented. When the
 * @currentField column is known, its legal sub-properties are offered right
 * after it (person → .title/.email/…, lookup → .lookupValue/.lookupId);
 * a scalar current column adds none.
 */
export function systemTokenItems(opts?: CompletionOpts): SuggestItem[] {
  const items: SuggestItem[] = [];
  for (const token of SPECIAL_TOKENS) {
    const meta = TOKEN_DOCS[token] ?? { type: undefined, doc: undefined };
    if (token === '@currentField' && opts?.current) {
      const f = opts.current;
      items.push({
        insert: token,
        type: outputTypeOf(f.type),
        doc: `The “${f.displayName ?? f.name}” value of this row (${TYPE_LABELS[f.type]} column)`,
        preview: previewOf(token, opts.ctx),
      });
      const multi = MULTI_TYPES.has(f.type);
      for (const p of subpropsFor(f.type)) {
        items.push({
          insert: `${token}.${p.name}`,
          type: multi ? 'array' : p.type,
          doc: multi ? `${p.doc} (one per value)` : p.doc,
          preview: previewOf(`${token}.${p.name}`, opts?.ctx),
        });
      }
      continue;
    }
    items.push({ insert: token, type: meta.type, doc: meta.doc, preview: previewOf(token, opts?.ctx) });
  }
  return items;
}

/** How a column reference is spelled: the bar's Excel form ([Display Name])
 *  or SharePoint's internal form ([$InternalName]). */
export type RefSpelling = 'display' | 'internal';

/**
 * Column references as rich items — every column, plus the sub-properties its
 * TYPE legally carries. Previews always evaluate through the SP internal ref,
 * whatever the spelling inserted.
 */
export function columnRefItems(
  fields: MockField[],
  spelling: RefSpelling,
  ctx?: EvalContext,
): SuggestItem[] {
  const items: SuggestItem[] = [];
  for (const f of fields) {
    const head = spelling === 'internal' ? `$${f.name}` : (f.displayName ?? f.name);
    const ref = (tail: string): string => `[${head}${tail}]`;
    const spRef = (tail: string): string => `[$${f.name}${tail}]`;
    items.push({
      insert: ref(''),
      type: outputTypeOf(f.type),
      doc: `${TYPE_LABELS[f.type]} column`
        + (f.type === 'choice' || f.type === 'choiceMulti' ? choiceDoc(f) : ''),
      preview: previewOf(spRef(''), ctx),
    });
    const multi = MULTI_TYPES.has(f.type);
    for (const p of subpropsFor(f.type)) {
      items.push({
        insert: ref(`.${p.name}`),
        type: multi ? 'array' : p.type,
        doc: multi ? `${p.doc} (one per value)` : p.doc,
        preview: previewOf(spRef(`.${p.name}`), ctx),
      });
    }
  }
  return items;
}

function choiceDoc(f: MockField): string {
  return f.choices?.length ? ` — ${clip(f.choices.join(' / '))}` : '';
}

/** Column references in the bar's Excel bracket form — offered while typing `[`. */
export function columnCompletions(fields: MockField[]): string[] {
  return dedupe(fields.map((f) => `[${f.displayName ?? f.name}]`));
}

/** Docs for the Excel-dialect words the bar understands (see contextCompletions). */
const FUNCTION_ITEMS: ReadonlyArray<SuggestItem> = [
  { insert: 'IF(', doc: 'IF(test, when-true, when-false) — choose between two values' },
  { insert: 'AND(', type: 'boolean', doc: 'True when every test passes' },
  { insert: 'OR(', type: 'boolean', doc: 'True when any test passes' },
  { insert: 'NOT(', type: 'boolean', doc: 'Flips a test (rewritten — SP has no NOT)' },
  { insert: 'TODAY()', type: 'date', doc: 'The current date and time (@now)' },
  { insert: 'NOW()', type: 'date', doc: 'The current date and time (@now)' },
  { insert: 'ME()', type: 'string', doc: 'The signed-in viewer’s email (@me)' },
  { insert: 'TRUE', type: 'boolean', doc: 'The yes value' },
  { insert: 'FALSE', type: 'boolean', doc: 'The no value' },
];

/**
 * The Excel-dialect words the bar understands — its functions, the context
 * tokens (TODAY/NOW/ME) and the boolean constants — offered while typing a bare
 * identifier. Entries ending in `(` are call openers (the maker keeps typing
 * the arguments); the rest are complete and round-trip on their own.
 */
export function contextCompletions(): string[] {
  return FUNCTION_ITEMS.map((i) => i.insert);
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
export interface Completion { items: SuggestItem[]; from: number; to: number; }

const WORD_RE = /[A-Za-z_][A-Za-z0-9_]*$/;
const AT_RE = /@[A-Za-z0-9_.]*$/;

/** Where an accepted `[…]` completion should replace to: through an existing
 *  closing `]` ahead of the caret (so the pick's own `]` doesn't double up),
 *  else just to the caret. */
function bracketReplaceEnd(text: string, caret: number): number {
  const close = text.indexOf(']', caret);
  const nextOpen = text.indexOf('[', caret);
  return close !== -1 && (nextOpen === -1 || close < nextOpen) ? close + 1 : caret;
}

/** Filter column items by the text typed after `[` (bracket-inner match). */
function filterBracket(items: SuggestItem[], partial: string): SuggestItem[] {
  const p = partial.toLowerCase();
  return items.filter((i) => i.insert.slice(1, -1).toLowerCase().includes(p));
}

/**
 * What to suggest for the caret position in an fx-bar formula — or null when
 * nothing applies. Pure (no DOM) so it is unit-tested directly. Completions are
 * offered only inside a formula (leading `=`); a plain literal gets none.
 *   • inside an unclosed `[…`  → column references (filtered by the partial;
 *     a `[$…` partial switches to the SP internal spelling), with type-legal
 *     sub-properties (.email, .lookupValue) per column
 *   • after `@…`               → the engine's system context tokens
 *   • right after `IF(`/`AND(`… → condition operands
 *   • right after a `,`        → slot-typed result values
 *   • a bare word              → functions / constants (by prefix)
 * `opts` threads the @currentField column + the mock-row eval context so items
 * carry their inline docs and live previews.
 */
export function completionAt(
  text: string,
  caret: number,
  slot: FxSlot,
  fields: MockField[],
  opts?: CompletionOpts,
): Completion | null {
  const before = text.slice(0, caret);
  if (!/^\s*=/.test(before)) return null; // literals get no dialect completions

  // inside an open [column … (no ] between the '[' and the caret)
  const lb = before.lastIndexOf('[');
  if (lb >= 0 && !before.slice(lb).includes(']')) {
    const partial = before.slice(lb + 1);
    const internal = partial.startsWith('$');
    const items = filterBracket(
      columnRefItems(fields, internal ? 'internal' : 'display', opts?.ctx),
      internal ? partial.slice(1) : partial,
    );
    const to = bracketReplaceEnd(text, caret);
    return items.length ? { items, from: lb, to } : null;
  }

  // @context token (replace the whole @word, dots included)
  const at = before.match(AT_RE);
  if (at) {
    const partial = at[0].slice(1).toLowerCase();
    const items = systemTokenItems(opts)
      .filter((i) => i.insert.slice(1).toLowerCase().startsWith(partial));
    return items.length ? { items, from: caret - at[0].length, to: caret } : null;
  }

  // just opened a function call → condition operands; just typed a comma → results
  const trimmed = before.replace(/\s+$/, '');
  const last = trimmed.slice(-1);
  if (last === '(') {
    const fn = trimmed.slice(0, -1).match(WORD_RE)?.[0]?.toLowerCase();
    if (fn === 'if' || fn === 'and' || fn === 'or' || fn === 'not') {
      const items = operandSuggestions(fields).map(toItem);
      return items.length ? { items, from: caret, to: caret } : null;
    }
  }
  if (last === ',') {
    const items = resultSuggestions(slot, fields).map(toItem);
    return items.length ? { items, from: caret, to: caret } : null;
  }

  // a bare identifier word → functions / constants by prefix
  const w = before.match(WORD_RE);
  if (w) {
    const partial = w[0].toLowerCase();
    const items = FUNCTION_ITEMS.filter((i) => i.insert.toLowerCase().startsWith(partial));
    return items.length ? { items, from: caret - w[0].length, to: caret } : null;
  }

  return null;
}

/**
 * Token completion for the Code lens (SP dialect, one declaration per line) —
 * or null. Triggers only inside a declaration's VALUE (after the line's `:`,
 * so `@name` at the start of a line — an attribute — is left alone):
 *   • `@…`   → the engine's system context tokens
 *   • `[$…`  → SP internal-name column references + type-legal sub-properties
 * (a bare `[` without `$` is NOT a ref in the SP dialect, so it stays quiet).
 */
export function spCompletionAt(
  text: string,
  caret: number,
  fields: MockField[],
  opts?: CompletionOpts,
): Completion | null {
  const lineStart = text.lastIndexOf('\n', caret - 1) + 1;
  const line = text.slice(lineStart, caret);
  const colon = line.indexOf(':');
  if (colon < 0) return null; // still typing the property/attribute name
  const valueStart = lineStart + colon + 1;
  const before = text.slice(valueStart, caret);

  // inside an open [$… (no ] between the '[' and the caret)
  const lb = before.lastIndexOf('[');
  if (lb >= 0 && !before.slice(lb).includes(']') && before.slice(lb + 1).startsWith('$')) {
    const items = filterBracket(columnRefItems(fields, 'internal', opts?.ctx), before.slice(lb + 2));
    // only a ] on THIS line can be replaced through — never swallow a newline
    const lineEnd = text.indexOf('\n', caret);
    const to = bracketReplaceEnd(text.slice(0, lineEnd === -1 ? text.length : lineEnd), caret);
    return items.length ? { items, from: valueStart + lb, to } : null;
  }

  const at = before.match(AT_RE);
  if (at) {
    const partial = at[0].slice(1).toLowerCase();
    const items = systemTokenItems(opts)
      .filter((i) => i.insert.slice(1).toLowerCase().startsWith(partial));
    return items.length ? { items, from: caret - at[0].length, to: caret } : null;
  }

  return null;
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}
