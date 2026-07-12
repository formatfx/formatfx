// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sam Yost. FormatFX is dual-licensed: AGPL-3.0-only (see LICENSE) or a commercial license (see LICENSING.md).

/**
 * editor/search.ts — the universal-search brain (pure; searchUi.ts is the DOM).
 *
 * One query over everything the maker can reach: the document trees (elements,
 * text, style values, formulas), the schema's columns and their conditional
 * rules, the insertable catalog (palette presets, quick looks), and the
 * SharePoint function/token reference. The brain only builds entries and ranks
 * matches — every entry carries a data-only `action` descriptor and the UI
 * decides what clicking does (navigate, never mutate; insert only behind an
 * explicit button).
 *
 * Node paths use the same convention as lint/explain: child indices, with
 * CARD_SEGMENT (-1) descending into customCardProps.formatter.
 */

import type { SPElement, SPExpr, MockField, NodePath } from '../core/types';
import { SP_FUNCTION_DOCS, SPECIAL_TOKENS } from '../core/schema';
import { parseRulesFromStyle, condLabel, condEffect } from './condRules';

/** Mirrors core/explain.ts and editor/state.ts CARD_SEGMENT. */
const CARD_SEGMENT = -1;

export type SearchGroup = 'document' | 'columns' | 'insert' | 'reference';

/** Display order and headings for the result buckets. */
export const GROUP_ORDER: SearchGroup[] = ['document', 'columns', 'insert', 'reference'];
export const GROUP_LABELS: Record<SearchGroup, string> = {
  document: 'Your document',
  columns: 'Columns & rules',
  insert: 'Things you can insert',
  reference: 'Reference',
};

/** Which canvas surface a document entry lives on — the UI's navigation key. */
export type SearchSurface =
  | { kind: 'floor' }
  | { kind: 'view'; id: string };

/** Data-only descriptor of what activating a result should do. */
export type SearchAction =
  | { type: 'node'; surface: SearchSurface; path: NodePath; prop?: string }
  | { type: 'column'; fieldName: string }
  | { type: 'rules'; fieldName: string }
  | { type: 'preset'; presetId: string }
  | { type: 'quicklook'; label: string }
  | { type: 'reference'; name: string };

export interface SearchEntry {
  group: SearchGroup;
  /** Tiny glyph shown before the label — what kind of thing this is. */
  icon: string;
  label: string;
  /** Where it lives, e.g. "Grid → Status + DueDate group → pill". */
  trail: string;
  /** Lowercased haystack the query is matched against (label included). */
  text: string;
  action: SearchAction;
  /** Card body for insert/reference entries (description, summary…). */
  detail?: string;
  /** Ready-to-paste example (reference entries). */
  example?: string;
  /** Within-group tiebreak, lower first (default 0). The UI pins the ACTIVE
   *  surface's hits above other surfaces' — someone searching right after
   *  pasting a view means THAT view, not the showcase floor content, and a
   *  first hit from elsewhere navigates the canvas away (reads as a clobber
   *  even though it's navigation). */
  pin?: number;
}

export interface SearchHit {
  entry: SearchEntry;
  score: number;
  /** [start, end) ranges of the query inside `label`, for highlighting. */
  ranges: Array<[number, number]>;
}

export interface GroupedResults {
  group: SearchGroup;
  label: string;
  hits: SearchHit[];
}

// ─── document index ──────────────────────────────────────────────────────────

const nameOf = (el: SPElement): string => el._elmName ?? `<${el.elmType}>`;

/** A value is a formula when it's an `=`-string or an AST object — number and
 *  boolean style values are literals (the component editor's rule). */
function isFormula(v: SPExpr | undefined): boolean {
  return (typeof v === 'string' && v.trim().startsWith('=')) || (typeof v === 'object' && v !== null);
}

function exprText(v: SPExpr): string {
  return typeof v === 'object' ? JSON.stringify(v) : String(v);
}

const clip = (s: string, max = 72): string => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

/**
 * Walk one document tree into search entries: one per element (its name, text,
 * style and attribute values all searchable) plus one per FORMULA slot, so
 * "#ff0000" finds the plain fill and "if(" finds the expression — and the
 * formula entry carries its property name so the UI can dock the fx bar on it.
 */
export function indexElements(root: SPElement, surface: SearchSurface, surfaceLabel: string): SearchEntry[] {
  const out: SearchEntry[] = [];

  const walk = (el: SPElement, path: NodePath, trail: string[]): void => {
    const label = nameOf(el);
    const hay: string[] = [label, el.elmType];

    const slots: Array<[string, SPExpr | undefined]> = [['txtContent', el.txtContent]];
    for (const [k, v] of Object.entries(el.style ?? {})) slots.push([k, v]);
    for (const [k, v] of Object.entries(el.attributes ?? {})) slots.push([k, v]);

    for (const [prop, value] of slots) {
      if (value === undefined) continue;
      const text = exprText(value);
      hay.push(text);
      if (isFormula(value)) {
        out.push({
          group: 'document',
          icon: 'ƒ',
          label: clip(text),
          trail: [surfaceLabel, ...trail, label].join(' → ') + ` · ${prop}`,
          text: `${text} ${prop} ${label}`.toLowerCase(),
          action: { type: 'node', surface, path: [...path], prop },
        });
      }
    }

    out.push({
      group: 'document',
      icon: '▢',
      label,
      trail: [surfaceLabel, ...trail].join(' → '),
      text: hay.join(' ').toLowerCase(),
      action: { type: 'node', surface, path: [...path] },
    });

    el.children?.forEach((c, i) => walk(c, [...path, i], [...trail, label]));
    if (el.customCardProps?.formatter) {
      walk(el.customCardProps.formatter, [...path, CARD_SEGMENT], [...trail, label, 'hover card']);
    }
  };

  walk(root, [], []);
  return out;
}

// ─── columns & rules index ───────────────────────────────────────────────────

/**
 * One entry per schema column (a look applied or not), plus one per
 * conditional rule parsed back out of the look's generated `=if()` chains —
 * the same rebuild-verified parse the conditional-formatting dialog reopens
 * with, so a hand-edited formula never shows up as a guessed rule.
 */
export function indexColumns(
  fields: MockField[],
  columnLooks: Record<string, SPElement | undefined>,
): SearchEntry[] {
  const out: SearchEntry[] = [];

  for (const field of fields) {
    const label = field.displayName ?? field.name;
    const look = Object.hasOwn(columnLooks, field.name) ? columnLooks[field.name] : undefined;
    const parsed = look ? parseRulesFromStyle(look.style, fields) : null;

    const bits: string[] = [field.type];
    if (look) bits.push('formatted');
    if (parsed?.rules.length) bits.push(`${parsed.rules.length} rule${parsed.rules.length === 1 ? '' : 's'}`);

    out.push({
      group: 'columns',
      icon: '▦',
      label,
      trail: bits.join(' · '),
      text: `${label} ${field.name} ${field.type}`.toLowerCase(),
      action: { type: 'column', fieldName: field.name },
    });

    if (parsed) {
      const watched = fields.find((f) => f.name === parsed.fieldName);
      for (const rule of parsed.rules) {
        if (!watched) break;
        const ruleLabel = condLabel(watched, rule.cond);
        out.push({
          group: 'columns',
          icon: '⚑',
          label: ruleLabel,
          trail: `${label} · ${condEffect(rule.effect).label}`,
          text: `${ruleLabel} ${label} ${rule.color} ${condEffect(rule.effect).label}`.toLowerCase(),
          action: { type: 'rules', fieldName: field.name },
        });
      }
    }
  }

  return out;
}

// ─── insertables index ───────────────────────────────────────────────────────

export interface PresetInput { id: string; label: string; description: string; group: string }
export interface QuickLookInput { label: string; hint: string; props: Record<string, string> }

/**
 * The insert catalog: palette presets (insert an element) and quick looks
 * (apply a style bundle). Activating one of these must ALWAYS go through an
 * explicit button in the UI — search results themselves never mutate.
 */
export function indexInsertables(presets: PresetInput[], quickLooks: QuickLookInput[]): SearchEntry[] {
  const out: SearchEntry[] = [];

  for (const p of presets) {
    out.push({
      group: 'insert',
      icon: '＋',
      label: p.label,
      trail: `Palette · ${p.group}`,
      text: `${p.label} ${p.description} ${p.group}`.toLowerCase(),
      action: { type: 'preset', presetId: p.id },
      detail: p.description,
    });
  }

  for (const q of quickLooks) {
    const props = Object.entries(q.props).map(([k, v]) => `${k}: ${v}`).join(' · ');
    out.push({
      group: 'insert',
      icon: '✦',
      label: q.label,
      trail: 'Quick look · style bundle',
      text: `${q.label} ${q.hint} ${props}`.toLowerCase(),
      action: { type: 'quicklook', label: q.label },
      detail: q.hint,
      example: props,
    });
  }

  return out;
}

// ─── reference index ─────────────────────────────────────────────────────────

/**
 * Plain-language one-liners for the context tokens. Stick to what Microsoft's
 * formatting-syntax reference documents — refuse-don't-guess applies to docs
 * as much as to generated JSON.
 */
const TOKEN_DOCS: Record<string, string> = {
  '@currentField': 'The value of the field this formatter is applied to.',
  '@me': 'The email address of the person viewing the list.',
  '@now': 'The current date and time.',
  '@rowIndex': 'The row’s index in the rendered view, starting at 0 — the classic zebra-stripe driver.',
  '@isSelected': 'True when the row is selected. The sandbox always renders it as false (see the field guide).',
  '@currentWeb': 'The absolute URL of the current site — handy for building links.',
  '@group': 'The current group’s value in a grouped view.',
  '@columnAggregate': 'The aggregate value (sum, average…) shown for a group or view total.',
  '@lastIndexedTime': 'When the item was last indexed by search.',
  '@thumbnail': 'A thumbnail URL for the item’s file — used as @thumbnail.small/medium/large or @thumbnail.<width>x<height>.',
  '@window.innerWidth': 'The browser window’s width in pixels — for responsive formatters.',
  '@window.innerHeight': 'The browser window’s height in pixels — for responsive formatters.',
};

/** SharePoint functions (from the schema's verified catalog) + context tokens. */
export function indexReference(): SearchEntry[] {
  const out: SearchEntry[] = [];

  for (const [name, doc] of Object.entries(SP_FUNCTION_DOCS)) {
    out.push({
      group: 'reference',
      icon: '𝑓',
      label: doc.signature,
      trail: `SharePoint function · returns ${doc.returns}${doc.onlineOnly ? ' · SharePoint Online only' : ''}`,
      text: `${name} ${doc.signature} ${doc.summary}`.toLowerCase(),
      action: { type: 'reference', name },
      detail: doc.summary,
      example: doc.example,
    });
  }

  for (const token of SPECIAL_TOKENS) {
    out.push({
      group: 'reference',
      icon: '@',
      label: token,
      trail: 'Context token',
      text: `${token} ${TOKEN_DOCS[token] ?? ''}`.toLowerCase(),
      action: { type: 'reference', name: token },
      detail: TOKEN_DOCS[token] ?? 'A SharePoint context token.',
      example: token,
    });
  }

  return out;
}

// ─── the query ───────────────────────────────────────────────────────────────

/** All [start, end) occurrences of `q` in `label`, case-insensitive. */
function matchRanges(label: string, q: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  const lower = label.toLowerCase();
  let from = 0;
  for (;;) {
    const i = lower.indexOf(q, from);
    if (i < 0) break;
    ranges.push([i, i + q.length]);
    from = i + q.length;
  }
  return ranges;
}

/** Word-boundary test: match at index 0 or right after a non-alphanumeric. */
function atWordStart(lower: string, q: string): boolean {
  let from = 0;
  for (;;) {
    const i = lower.indexOf(q, from);
    if (i < 0) return false;
    if (i === 0 || !/[a-z0-9]/.test(lower[i - 1])) return true;
    from = i + 1;
  }
}

/**
 * Rank entries against a query and bucket them. Scoring: label prefix (4)
 * beats label word-start (3) beats label substring (2) beats
 * anywhere-in-the-haystack (1). Empty buckets are omitted; each bucket is
 * capped so one chatty group can't drown the rest.
 */
export function runSearch(entries: SearchEntry[], query: string, perGroup = 8): GroupedResults[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const buckets = new Map<SearchGroup, SearchHit[]>();
  for (const entry of entries) {
    const labelLower = entry.label.toLowerCase();
    let score = 0;
    if (labelLower.startsWith(q)) score = 4;
    else if (atWordStart(labelLower, q)) score = 3;
    else if (labelLower.includes(q)) score = 2;
    else if (entry.text.includes(q)) score = 1;
    if (!score) continue;
    const hits = buckets.get(entry.group) ?? [];
    hits.push({ entry, score, ranges: matchRanges(entry.label, q) });
    buckets.set(entry.group, hits);
  }

  const out: GroupedResults[] = [];
  for (const group of GROUP_ORDER) {
    const hits = buckets.get(group);
    if (!hits?.length) continue;
    hits.sort((a, b) => b.score - a.score
      || (a.entry.pin ?? 0) - (b.entry.pin ?? 0)
      || a.entry.label.localeCompare(b.entry.label));
    out.push({ group, label: GROUP_LABELS[group], hits: hits.slice(0, perGroup) });
  }
  return out;
}

/**
 * The teaching no-match: someone searching for negation gets the §3 truth
 * (there is no logical NOT in the expression language) and the rewrite that
 * works, instead of a bare "no results".
 */
export function teachingNote(query: string): string | null {
  const q = query.trim().toLowerCase();
  if (/(^|[^a-z0-9])not\s*\(?$/.test(q) || q.includes('not(') || /^!(?!=)/.test(q)) {
    return 'SharePoint has no logical NOT — no not() function and no standalone "!" prefix. '
      + 'Rewrite the test instead: turn == into !=, < into >=, or swap the if() branches. '
      + '(!= itself is fine — search for a function name or token to see its reference card.)';
  }
  return null;
}
