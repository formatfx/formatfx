// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sam Yost. FormatFX is dual-licensed: AGPL-3.0 (see LICENSE) or a commercial license (see LICENSING.md).

/**
 * editor/subtypes.ts — the custom-subtype store (the new `wb-subtypes`
 * localStorage key). A subtype is a reusable column-rendering recipe (see
 * `Subtype` in core/types): a saved formatter that may carry typed knobs
 * (apply-time fill-ins) and the fx-bar vocabulary to offer.
 *
 * This module owns persistence for MAKER-AUTHORED subtypes only. Built-in seeds
 * live in code (added in US-2) and are never stored here. Every read and write
 * is try/catch-guarded (private-mode safe, exactly like `wb-ui-prefs`): a
 * corrupt, missing, or version-incompatible key yields an empty catalog and
 * never throws — a misread can never wipe or block a maker's work.
 */

import type { Subtype, Knob, KnobType, SPElement, FieldType, MockField } from '../core/types';
import { presetSeeds } from './columnPresets';
import { toColumnFormatter } from './cfr';

/** localStorage key for maker-authored (custom) subtypes. Frozen + additive —
 *  the only new key this feature introduces. */
export const SUBTYPES_KEY = 'wb-subtypes';

/** Envelope schema version — bump ONLY on an incompatible shape change. */
const STORE_VERSION = 1;

interface SubtypeStore {
  version: number;
  subtypes: Subtype[];
}

/**
 * The custom catalog from storage. Empty on a missing, corrupt, or
 * version-incompatible key; individually malformed records are dropped so one
 * bad entry can never poison the rest.
 */
export function listSubtypes(): Subtype[] {
  try {
    const raw = localStorage.getItem(SUBTYPES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Partial<SubtypeStore> | null;
    if (!parsed || parsed.version !== STORE_VERSION || !Array.isArray(parsed.subtypes)) return [];
    return parsed.subtypes.filter(isSubtype);
  } catch {
    return [];
  }
}

/** One custom subtype by id, or undefined. */
export function getSubtype(id: string): Subtype | undefined {
  return listSubtypes().find((s) => s.id === id);
}

/** Upsert a custom subtype by id (in place — order preserved), then persist
 *  (swallowed in private mode). Built-in seeds live in code and are refused. */
export function saveSubtype(subtype: Subtype): void {
  if (subtype.origin !== 'custom') return; // seeds are never stored (refuse-don't-guess)
  const all = listSubtypes();
  const i = all.findIndex((s) => s.id === subtype.id);
  if (i >= 0) all[i] = subtype; else all.push(subtype);
  persist(all);
}

/** Remove a custom subtype by id, then persist (swallowed in private mode). */
export function deleteSubtype(id: string): void {
  persist(listSubtypes().filter((s) => s.id !== id));
}

function persist(subtypes: Subtype[]): void {
  try {
    const store: SubtypeStore = { version: STORE_VERSION, subtypes };
    localStorage.setItem(SUBTYPES_KEY, JSON.stringify(store));
  } catch {
    /* quota / private mode — best-effort, like wb-ui-prefs autosave */
  }
}

/** Minimal shape guard so a corrupt record can't crash or poison the catalog. */
function isSubtype(s: unknown): s is Subtype {
  if (!s || typeof s !== 'object') return false;
  const o = s as Record<string, unknown>;
  const vocab = o.vocab as { refs?: unknown; values?: unknown } | undefined;
  return typeof o.id === 'string'
    && typeof o.name === 'string'
    && o.origin === 'custom' // the store holds maker-authored subtypes only
    && Array.isArray(o.baseTypes) && o.baseTypes.every((t) => typeof t === 'string')
    && !!o.formatter && typeof o.formatter === 'object'
    && Array.isArray(o.knobs) && o.knobs.every((k) => !!k && typeof k === 'object')
    // vocab.refs/values must be arrays — downstream (fx bar, chip editor) assumes it
    && !!vocab && typeof vocab === 'object'
    && Array.isArray(vocab.refs) && Array.isArray(vocab.values);
}

// ─── Built-in seed catalog (defined in code, never stored) ───────────────────
// The existing column presets re-expressed as builtin subtypes, plus the new
// value→text Money seed. Seeds are immutable and app-versioned; a maker forks
// one (Save-as) rather than editing it. `seedSubtypes()` returns FRESH trees
// each call, so a consumer can never mutate the shared catalog.

const MONEY_ID = 'money';

/** The Money value→text seed: a currency symbol + fixed decimals. SP has no
 *  toFixed, so rounding is floor(v·10^d + 0.5)/10^d, guarded for the empty cell
 *  (an unset number is '' → render nothing, never "$NaN"). The `'$'` (symbol)
 *  and `2` (decimals) literals appear verbatim so apply-time baking and
 *  refine-time promotion can find them by value. */
function moneySeed(): Subtype {
  return {
    id: MONEY_ID,
    name: 'Money',
    origin: 'builtin',
    baseTypes: ['number', 'currency'],
    formatter: {
      elmType: 'div',
      _elmName: 'Money',
      style: { 'text-align': 'right' },
      txtContent: "=if(@currentField=='','','$'+toString(floor(@currentField*pow(10,2)+0.5)/pow(10,2)))",
    },
    knobs: [
      { path: '$', label: 'Symbol', type: 'text', default: '$' },
      { path: '2', label: 'Decimals', type: 'number', default: 2 },
    ],
    // hand-authored: a money column's bar offers the value and common symbols.
    vocab: { refs: ['@currentField'], values: ['$', '€', '£', '¥'] },
  };
}

/**
 * The full built-in catalog: every column preset re-expressed (fresh trees each
 * call) + Money. Vocab is HAND-AUTHORED (spec US-2): a preset recipe centers on
 * the column's own value, so it offers `@currentField` and suppresses the bar's
 * all-columns padding (US-8) without guessing column-specific values — those
 * come from refine (US-6) or value→text seeds like Money. (Auto-derivation of
 * vocab is US-5's job for maker Save-as, not the seed catalog's.)
 *
 * NOTE: a few preset recipes carry secondary refs to showcase field names
 * (date-badge → [$Status], lookup-chip → [$Project.*]); these are inherited
 * from the palette presets and are the existing apply-time-rebind story, not a
 * guarantee that every secondary ref resolves on an arbitrary list.
 */
export function seedSubtypes(): Subtype[] {
  const fromPresets: Subtype[] = presetSeeds().map((seed) => ({
    id: seed.id,
    name: seed.label,
    origin: 'builtin',
    baseTypes: seed.baseTypes,
    formatter: seed.formatter,
    knobs: [],
    vocab: { refs: ['@currentField'], values: [] },
  }));
  return [...fromPresets, moneySeed()];
}

/**
 * The catalog a column of `type` sees: the builtin seeds that fit, then the
 * saved customs that fit. Subtypes whose `baseTypes` exclude `type` never
 * appear (refuse-don't-guess — a misclick can't apply a broken recipe).
 */
export function subtypesForType(type: FieldType): Subtype[] {
  const fits = (s: Subtype): boolean => s.baseTypes.includes(type);
  const seeds = seedSubtypes().filter(fits);
  const seedIds = new Set(seeds.map((s) => s.id));
  // A custom never shadows a built-in (spec: override/shadow is out of scope —
  // you fork instead); an id collision drops the custom so the menu can't
  // double-list the same id.
  const customs = listSubtypes().filter((s) => fits(s) && !seedIds.has(s.id));
  return [...seeds, ...customs];
}

// ─── Knob baking + apply-time validation ─────────────────────────────────────

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A knob whose answer is a quoted/bare STRING (text/color/choice), vs a bare
 *  number/bool token. Drives both the widget and the substitution form. */
function isTextKnob(knob: Knob): boolean {
  return knob.type === 'text' || knob.type === 'color' || knob.type === 'choice';
}

/** The literal answer for a knob baked into an expression: a quoted, quote-safe
 *  string for text/color/choice; the bare value for number/bool. */
function bakedLiteral(knob: Knob, answer: string | number | boolean): string {
  const ans = String(answer);
  return isTextKnob(knob) ? `'${ans.replace(/'/g, '')}'` : ans; // SP strings can't escape a quote
}

/**
 * Rewrite one expression string, substituting EVERY knob's literal BY VALUE in a
 * SINGLE left-to-right pass — so a value a knob just baked in can never be
 * re-matched by a later knob (order-independent). Matches a quoted literal
 * `'<path>'` (text/color/choice), a standalone numeric/bool token `<path>`, and
 * a bare value equal to `<path>` (a whole style/attribute literal).
 */
function bakeString(s: string, knobs: Knob[], answerOf: (knob: Knob) => string | number | boolean): string {
  // a whole bare value (a style/attribute literal) equals a knob's literal
  for (const knob of knobs) {
    if (s === String(knob.path)) {
      const ans = String(answerOf(knob));
      return isTextKnob(knob) ? ans.replace(/'/g, '') : ans;
    }
  }
  // one combined regex of every in-expression occurrence (one capture each),
  // replaced in a single scan that never re-reads a baked-in answer
  const alternatives = knobs.map((knob) => {
    const p = escapeRegExp(String(knob.path));
    // a quoted literal, or a STANDALONE numeric/bool token — never digits inside
    // a quoted string (the `'` guards keep a number knob from rewriting e.g. the
    // SVG circumference in `',100'` when promoting the `/100` divisor)
    return isTextKnob(knob) ? `'(${p})'` : `(?<![\\w.$@'])(${p})(?![\\w.'])`;
  });
  const re = new RegExp(alternatives.join('|'), 'g');
  return s.replace(re, (...m): string => {
    const captures = m.slice(1, 1 + knobs.length); // groups before offset/string
    const idx = captures.findIndex((g) => g !== undefined);
    return idx === -1 ? m[0] : bakedLiteral(knobs[idx], answerOf(knobs[idx]));
  });
}

/**
 * Bake a subtype's knob answers into a fresh copy of its formatter (the source
 * subtype is never mutated — apply/refine stay click-safe). Every knob's literal
 * is replaced BY VALUE across the whole tree, in one pass per string so baking
 * is order-independent; a missing answer falls back to the knob's default. A
 * zero-knob subtype simply deep-clones. Only expression-bearing fields
 * (txtContent/style/attributes/forEach + card formatters) are rewritten — never
 * elmType/_elmName/etc.
 */
export function bakeSubtype(subtype: Subtype, args: Record<string, string | number | boolean>): SPElement {
  const tree = JSON.parse(JSON.stringify(subtype.formatter)) as SPElement;
  if (subtype.knobs.length === 0) return tree;
  // args are keyed by the STABLE knob.path (the promoted literal), not the
  // editable label — so a label rename never orphans an applied column's answer
  const answerOf = (knob: Knob): string | number | boolean => (knob.path in args ? args[knob.path] : knob.default);
  const sub = (s: string): string => bakeString(s, subtype.knobs, answerOf);
  const visit = (node: SPElement): void => {
    if (typeof node.txtContent === 'string') node.txtContent = sub(node.txtContent);
    if (node.style) for (const k of Object.keys(node.style)) { const v = node.style[k]; if (typeof v === 'string') node.style[k] = sub(v); }
    if (node.attributes) for (const k of Object.keys(node.attributes)) { const v = node.attributes[k]; if (typeof v === 'string') node.attributes[k] = sub(v); }
    if (typeof node.forEach === 'string') node.forEach = sub(node.forEach);
    node.children?.forEach(visit);
    if (node.customCardProps?.formatter) visit(node.customCardProps.formatter);
  };
  visit(tree);
  return tree;
}

/** Coerce a widget's raw value (string box / checkbox) to the knob's type. A
 *  blank number box becomes NaN (not 0), so it is refused rather than silently
 *  baked as zero. */
export function coerceKnob(knob: Knob, raw: string | boolean): string | number | boolean {
  if (knob.type === 'number') return String(raw).trim() === '' ? NaN : Number(raw);
  if (knob.type === 'bool') return raw === true || raw === 'true';
  return String(raw);
}

/** A refuse-and-teach validation message for a knob answer, or null if valid. */
export function knobError(knob: Knob, value: string | number | boolean): string | null {
  switch (knob.type) {
    case 'number':
      return Number.isFinite(typeof value === 'number' ? value : Number(value))
        ? null : `${knob.label} must be a number.`;
    case 'choice':
      return (knob.choices ?? []).includes(String(value))
        ? null : `${knob.label} must be one of: ${(knob.choices ?? []).join(', ')}.`;
    case 'text':
    case 'color':
      return String(value).includes("'")
        ? `${knob.label} can't contain a single quote — SharePoint text can't escape it.`
        : null;
    case 'bool':
      return null;
    default: { const _exhaustive: never = knob.type; return _exhaustive; } // a new KnobType must add validation
  }
}

// ─── Vocab derivation + Save-as birth ────────────────────────────────────────

const REF_RE = /@currentField(?:\.[A-Za-z0-9_]+)?|\[\$[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*\]|\[![^\]]+\]/g;
const STR_LITERAL_RE = /'([^']*)'/g;

/** Layout/visibility/weight keywords that show up in style branch expressions —
 *  values the recipe paints with, never the column's own data. */
const CSS_KEYWORDS = new Set([
  'flex', 'none', 'block', 'inline', 'inline-block', 'inline-flex', 'grid',
  'hidden', 'visible', 'absolute', 'relative', 'fixed', 'sticky',
  'bolder', 'lighter', 'wrap', 'nowrap', 'stretch', 'baseline',
  'solid', 'dashed', 'dotted', 'uppercase', 'lowercase', 'capitalize',
  'underline', 'italic', 'ellipsis', 'pointer', 'transparent',
]);

/** A literal the fx bar should NOT offer as a column VALUE (the bar's own
 *  palettes own colors/sizes; class tokens, URLs, single-char args and CSS
 *  keywords are paint, not data). */
function looksLikeStyleValue(s: string): boolean {
  return s === ''
    || s.length === 1                                    // single-char arg (e.g. image size 'S')
    || s.startsWith('#')                                 // hex color
    || /^(rgb|rgba|hsl|hsla|var|calc|url)\(/.test(s)
    || /^-?\d/.test(s)                                   // number / size
    || !/[A-Za-z]/.test(s)                               // punctuation-only
    || /(^|\s)(sp-|ms-)[a-z]/i.test(s)                   // SP/Fluent class tokens
    || /^https?:|aspx|DispForm/i.test(s)                 // URLs / SP form links
    || CSS_KEYWORDS.has(s);                              // case-sensitive: keeps data like "None", drops "none"
}

/** The `_iterator` name a forEach binds ("_person in @currentField" → _person). */
function forEachIterator(forEach: string): string | null {
  return forEach.match(/^\s*([A-Za-z0-9_]+)\s+in\b/)?.[1] ?? null;
}

/**
 * Derive the fx-bar vocabulary a recipe implies: the COLUMN references it uses
 * (`refs`) and the value literals it branches on / displays (`values`).
 * Style-ish literals (colors, sizes, class tokens, URLs, CSS keywords) are
 * excluded — the bar offers those from its own palettes — and forEach loop
 * locals (`[$_person.*]`) are NOT columns, so they never appear as refs. The
 * auto-derived vocab a Save-as subtype is born with.
 */
export function deriveVocab(formatter: SPElement): { refs: string[]; values: string[] } {
  const refs = new Set<string>();
  const values = new Set<string>();
  // pass 1: every forEach iterator name, so its loop-local refs can be dropped
  const iterators = new Set<string>();
  const collectIters = (node: SPElement): void => {
    if (typeof node.forEach === 'string') { const it = forEachIterator(node.forEach); if (it) iterators.add(it); }
    node.children?.forEach(collectIters);
    if (node.customCardProps?.formatter) collectIters(node.customCardProps.formatter);
  };
  collectIters(formatter);
  // pass 2: collect refs (minus loop locals) + branch/display values
  const scan = (node: SPElement): void => {
    const strings: string[] = [];
    if (typeof node.txtContent === 'string') strings.push(node.txtContent);
    if (typeof node.forEach === 'string') strings.push(node.forEach);
    if (node.style) for (const v of Object.values(node.style)) if (typeof v === 'string') strings.push(v);
    if (node.attributes) for (const v of Object.values(node.attributes)) if (typeof v === 'string') strings.push(v);
    for (const s of strings) {
      for (const m of s.matchAll(REF_RE)) {
        const name = m[0].match(/^\[\$([A-Za-z0-9_]+)/)?.[1];
        if (name && iterators.has(name)) continue; // a loop local, not a column
        refs.add(m[0]);
      }
      if (s.startsWith('=')) {
        for (const m of s.matchAll(STR_LITERAL_RE)) if (!looksLikeStyleValue(m[1])) values.add(m[1]);
      }
    }
    node.children?.forEach(scan);
    if (node.customCardProps?.formatter) scan(node.customCardProps.formatter);
  };
  scan(formatter);
  return { refs: [...refs], values: [...values] };
}

/** Whether `id` names a built-in seed (vs a maker's custom). */
export function isBuiltinSubtype(id: string): boolean {
  return !!id && seedSubtypes().some((s) => s.id === id);
}

/** Resolve a subtype id to its record — a built-in seed or a saved custom. */
export function resolveSubtype(id: string): Subtype | undefined {
  return seedSubtypes().find((s) => s.id === id) ?? getSubtype(id);
}

let subtypeSeq = 0;
/** A fresh, collision-improbable id for a maker-authored subtype. */
function newSubtypeId(): string {
  subtypeSeq += 1;
  return `custom-${Date.now().toString(36)}-${subtypeSeq}-${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Build a custom subtype from a column's current formatter (Save-as birth):
 * `baseTypes` defaults to the source column's type; the formatter is NORMALIZED
 * to @currentField terms (so it is reusable across columns — a column may ship a
 * hand-authored [$Field] formatter, which would otherwise be frozen to the
 * source column) and snapshotted; vocab is auto-derived from the normalized
 * tree; `forkedFrom` records the built-in a fork descends from. The caller
 * persists it via `saveSubtype`. `toColumnFormatter` is idempotent on a tree
 * that is already in @currentField terms (the common, app-created case).
 */
export function subtypeFromColumn(opts: {
  name: string;
  formatter: SPElement;
  field: MockField;
  forkedFrom?: string;
}): Subtype {
  const normalized = toColumnFormatter(opts.formatter, opts.field.name);
  return {
    id: newSubtypeId(),
    name: opts.name,
    origin: 'custom',
    ...(opts.forkedFrom ? { forkedFrom: opts.forkedFrom } : {}),
    baseTypes: [opts.field.type],
    formatter: normalized,
    knobs: [],
    vocab: deriveVocab(normalized),
  };
}

// ─── Refine: literal extraction + promote/demote (by value) + fork ───────────

/** A distinct literal a maker can promote to a knob, plus a guessed type. */
export interface LiteralCandidate {
  value: string;
  suggestedType: KnobType;
}

const NUMBER_LITERAL_RE = /(?<![\w.$@'])-?\d+(?:\.\d+)?(?![\w.'])/g;

/** A starting knob type guessed from a literal's shape (the maker can change it). */
function guessKnobType(value: string): KnobType {
  if (/^#[0-9a-fA-F]{3,8}$/.test(value) || /^(rgb|rgba|hsl|hsla)\(/.test(value)) return 'color';
  if (/^-?\d+(?:\.\d+)?$/.test(value)) return 'number';
  if (value === 'true' || value === 'false') return 'bool';
  return 'text';
}

/** A WHOLE bare style/attribute value that is paint, not a parameterizable
 *  value: class tokens, URLs, or SVG path data. (Colors/sizes stay — a maker may
 *  want a color knob.) */
function isBareNoise(s: string): boolean {
  return /(^|\s)(sp-|ms-)[a-z]/i.test(s)   // SP/Fluent class tokens
    || /^https?:/i.test(s)                  // URLs
    || /^[Mm][\s\d.,-]/.test(s);            // SVG path data ("M18 2.0845 …")
}

/**
 * The distinct value-literals in a formatter — the refine checklist source.
 * Quoted strings and standalone numbers inside `=` expressions, plus whole bare
 * style/attribute literals (a color/size value). Field references and the empty
 * string are not literals. Promotion is BY VALUE, so each distinct value is one
 * row (and becomes at most one knob).
 */
export function extractLiterals(formatter: SPElement): LiteralCandidate[] {
  const seen = new Map<string, KnobType>();
  const add = (v: string): void => { if (v !== '' && !seen.has(v)) seen.set(v, guessKnobType(v)); };
  const scan = (node: SPElement): void => {
    const strings: string[] = [];
    if (typeof node.txtContent === 'string') strings.push(node.txtContent);
    if (typeof node.forEach === 'string') strings.push(node.forEach);
    if (node.style) for (const v of Object.values(node.style)) if (typeof v === 'string') strings.push(v);
    if (node.attributes) for (const v of Object.values(node.attributes)) if (typeof v === 'string') strings.push(v);
    for (const s of strings) {
      if (s.startsWith('=')) {
        for (const m of s.matchAll(STR_LITERAL_RE)) add(m[1]);
        for (const m of s.matchAll(NUMBER_LITERAL_RE)) add(m[0]);
      } else if (!/[@[\]]/.test(s) && !isBareNoise(s)) {
        add(s); // a bare literal value (not a field reference or raw paint)
      }
    }
    node.children?.forEach(scan);
    if (node.customCardProps?.formatter) scan(node.customCardProps.formatter);
  };
  scan(formatter);
  return [...seen].map(([value, suggestedType]) => ({ value, suggestedType }));
}

/** Coerce a literal string to a knob default of the chosen type. */
function defaultFromLiteral(value: string, type: KnobType): string | number | boolean {
  if (type === 'number') return Number(value);
  if (type === 'bool') return value === 'true';
  return value;
}

/** Whether a value is currently promoted to a knob (by value). */
export function isPromoted(subtype: Subtype, value: string): boolean {
  return subtype.knobs.some((k) => k.path === value);
}

/**
 * Promote a literal to a typed knob (immutable — returns a new subtype). BY
 * VALUE: the knob's `path` is the literal value, so baking updates every
 * occurrence; re-promoting the same value REPLACES its knob (no duplicates).
 * The formatter is unchanged — the literal stays as the knob's default until a
 * maker answers differently at apply time.
 */
export function promoteLiteral(
  subtype: Subtype,
  value: string,
  opts: { label: string; type: KnobType; default?: string | number | boolean; choices?: string[] },
): Subtype {
  const knob: Knob = {
    path: value,
    label: opts.label,
    type: opts.type,
    default: opts.default !== undefined ? opts.default : defaultFromLiteral(value, opts.type),
    ...(opts.choices ? { choices: opts.choices } : {}),
  };
  return { ...subtype, knobs: [...subtype.knobs.filter((k) => k.path !== value), knob] };
}

/** Demote a literal back to a plain value (remove its knob); the formatter
 *  literal is left in place. Immutable. */
export function demoteLiteral(subtype: Subtype, value: string): Subtype {
  return { ...subtype, knobs: subtype.knobs.filter((k) => k.path !== value) };
}

/** Fork a custom subtype into a fresh, independent custom (a new id + " copy"
 *  name); knobs/vocab/formatter are deep-copied so edits never alias the source. */
export function forkSubtype(subtype: Subtype): Subtype {
  const copy = JSON.parse(JSON.stringify(subtype)) as Subtype;
  return {
    ...copy,
    id: newSubtypeId(),
    name: `${subtype.name} copy`,
    origin: 'custom',
    forkedFrom: subtype.origin === 'builtin' ? subtype.id : subtype.forkedFrom,
  };
}
