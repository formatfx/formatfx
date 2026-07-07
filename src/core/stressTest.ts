// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sam Yost. FormatFX is dual-licensed: AGPL-3.0 (see LICENSE) or a commercial license (see LICENSING.md).

/**
 * core/stressTest.ts — the edge-case matrix: pathological-but-REAL data
 * variants generated from the current schema, so a maker can see "will this
 * break in production?" without typing a single test row.
 *
 * Pure and node-testable (sibling of schemaImport/condRules). Every variant
 * is a labeled set of throwaway rows built on `sampleValue` baselines with
 * targeted overrides; callers render them read-only and must never write
 * them into the workspace (the overlay honors that — see editor/stressTestUi).
 *
 * The generators respect the live-verified SP semantics (HANDOFF §3) and the
 * mock-data model's own blank conventions:
 *   - a truly empty Date cell is null, never '' (empty-date-compare)
 *   - empty person/lookup multi-values are empty arrays; an empty
 *     multi-CHOICE is '' (the model stores choiceMulti as a ';#'-joined string)
 *   - Date columns cannot hold invalid strings on real SP, so no variant
 *     fabricates one (refuse-and-teach: we don't invent impossible data)
 *
 * The Boundary-numbers variant additionally MINES the formatter under test:
 * every numeric literal compared against a field/@currentField in any
 * expression becomes a probe value (the threshold itself and one below), so
 * `>=` vs `>` off-by-ones show up side by side.
 */

import type {
  MockField, MockRow, CellValue, PersonValue, LookupValue, SPElement, SPExpr, FieldType,
} from './types';
import { sampleValue } from './schemaImport';
import { parseExpression, type AstNode } from './expressions';

export interface StressRow {
  /** What this row probes, e.g. "Exactly 100" / "Blank (null) date". */
  label: string;
  row: MockRow;
}

export interface StressVariant {
  id: 'empty' | 'novel' | 'time' | 'numbers' | 'multi' | 'unicode';
  label: string;
  /** Plain-language: what production failure this variant would surface. */
  description: string;
  rows: StressRow[];
}

export interface StressOptions {
  /** Element trees to mine comparison thresholds from (main doc root and/or
   *  registered column formatters). */
  mineTrees?: SPElement[];
  /** Deterministic clock for tests; defaults to the real now. */
  now?: Date;
}

// ─── building blocks ─────────────────────────────────────────────────────────

const TEXTY: FieldType[] = ['text', 'note', 'choice', 'hyperlink'];
const NUMERIC: FieldType[] = ['number', 'currency'];
const MULTI: FieldType[] = ['choiceMulti', 'personMulti', 'lookupMulti'];

/** The verified empty representation per field type (HANDOFF §3: blank dates
 *  are null; blank person/lookup multi-values are empty arrays; a blank
 *  multi-choice is '' because the model stores choiceMulti as a ';#'-joined
 *  string; yes/no has no blank). */
export function emptyValue(field: MockField): CellValue {
  switch (field.type) {
    case 'date': return null;
    case 'personMulti': case 'lookupMulti': return [];
    case 'boolean': return false;
    default: return '';
  }
}

function person(title: string): PersonValue {
  return { title, email: `${title.toLowerCase().replace(/[^a-z0-9]+/g, '.')}@contoso.com` };
}

function lookup(value: string, id: number): LookupValue {
  return { lookupId: id, lookupValue: value };
}

/** A plausible baseline row (protected fields keep it), then overrides. */
function baseRow(fields: MockField[], rowIndex: number, override: (f: MockField) => CellValue | undefined): MockRow {
  const row: MockRow = {};
  for (const f of fields) {
    const v = f.protected ? undefined : override(f);
    row[f.name] = v === undefined ? sampleValue(f, rowIndex) : v;
  }
  return row;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// ─── threshold mining ────────────────────────────────────────────────────────

const COMPARISONS = new Set(['<', '<=', '>', '>=', '==', '!=']);

/** Every numeric literal compared against a field/@token anywhere in the
 *  given trees — the numbers the formatter actually branches on. */
export function collectNumericThresholds(trees: SPElement[]): number[] {
  const found = new Set<number>();
  for (const tree of trees) walkElement(tree, (value) => mineExpr(value, found));
  return [...found].sort((a, b) => a - b);
}

function walkElement(el: SPElement, visit: (value: SPExpr) => void): void {
  if (el.txtContent !== undefined) visit(el.txtContent);
  for (const v of Object.values(el.style ?? {})) if (v !== undefined) visit(v);
  for (const v of Object.values(el.attributes ?? {})) if (v !== undefined) visit(v);
  if (el.forEach) visit(`=${el.forEach.replace(/^\s*[A-Za-z_][A-Za-z0-9_]*\s+in\s+/, '')}`);
  el.children?.forEach((c) => walkElement(c, visit));
  if (el.customCardProps?.formatter) walkElement(el.customCardProps.formatter, visit);
}

function mineExpr(value: SPExpr, found: Set<number>): void {
  if (typeof value === 'string') {
    if (!value.startsWith('=')) return;
    let ast: AstNode;
    try { ast = parseExpression(value.slice(1)); } catch { return; }
    mineAst(ast, found);
    return;
  }
  if (typeof value === 'object' && value !== null && typeof value.operator === 'string') {
    mineObjectForm(value, found);
  }
}

function mineAst(node: AstNode, found: Set<number>): void {
  switch (node.kind) {
    case 'binary':
      if (COMPARISONS.has(node.op)) {
        const sides = [node.left, node.right];
        const num = sides.find((s) => s.kind === 'num');
        const ref = sides.find((s) => s.kind === 'field' || s.kind === 'token');
        if (num?.kind === 'num' && ref) found.add(num.value);
      }
      mineAst(node.left, found);
      mineAst(node.right, found);
      break;
    case 'ternary':
      mineAst(node.cond, found); mineAst(node.yes, found); mineAst(node.no, found);
      break;
    case 'call':
      node.args.forEach((a) => mineAst(a, found));
      break;
    case 'unary':
      mineAst(node.operand, found);
      break;
    // num / str / field / token / ident: leaves
  }
}

/** Same mining over the legacy object/AST syntax community samples use. */
function mineObjectForm(node: { operator: string; operands: SPExpr[] }, found: Set<number>): void {
  const operands = node.operands ?? [];
  if (COMPARISONS.has(node.operator)) {
    const num = operands.find((o) => typeof o === 'number');
    const ref = operands.find((o) => typeof o === 'string' && /^(@|\[)/.test(o));
    if (typeof num === 'number' && ref !== undefined) found.add(num);
  }
  for (const o of operands) {
    if (typeof o === 'object' && o !== null && typeof o.operator === 'string') mineObjectForm(o, found);
    else if (typeof o === 'string' && o.startsWith('=')) mineExpr(o, found);
  }
}

// ─── the variant catalog ─────────────────────────────────────────────────────

export function buildStressVariants(fields: MockField[], opts: StressOptions = {}): StressVariant[] {
  const now = opts.now ?? new Date();
  const out: StressVariant[] = [];
  const has = (types: FieldType[]): boolean => fields.some((f) => !f.protected && types.includes(f.type));

  // 1. Empty state — the brand-new item nobody has filled in yet.
  out.push({
    id: 'empty',
    label: 'Empty state',
    description: 'A just-created item with nothing filled in. Blank dates are null on real SP (not empty text), blank multi-value fields are empty arrays — the classic silent-blank trap.',
    rows: [{ label: 'Everything blank', row: baseRow(fields, 0, emptyValue) }],
  });

  // 2. The Novel — content far longer than any demo row.
  if (has(TEXTY.concat('person', 'lookup'))) {
    const prose = 'A remarkably, almost defiantly long value that a real user will absolutely type one day, complete with clauses, parentheses (like these), and no regard whatsoever for your carefully measured column width';
    const token = 'Antidisestablishmentarianism_FINAL_v2_REVISED_(3)_APPROVED_USE_THIS_ONE_2026-Q3.xlsx';
    const novel = (unbroken: boolean) => (f: MockField): CellValue | undefined => {
      const long = unbroken ? token : prose;
      switch (f.type) {
        case 'text': return long;
        case 'note': return unbroken ? token : `${prose}\n\nAnd then a second paragraph, because notes fields always get a second paragraph.`;
        case 'choice': {
          const opts2 = f.choices?.length ? f.choices : null;
          return opts2 ? opts2.reduce((a, b) => (a.length >= b.length ? a : b)) : undefined;
        }
        case 'hyperlink': return `https://contoso.sharepoint.com/sites/operations/Shared%20Documents/${encodeURIComponent(token)}?web=1&e=AbCdEf&at=9`;
        case 'person': return person(unbroken ? 'Wolfeschlegelsteinhausenbergerdorff' : 'Maria del Carmen Fernández de la Torre y Aguilar');
        case 'lookup': return lookup(long.slice(0, 80), 99);
        default: return undefined;
      }
    };
    out.push({
      id: 'novel',
      label: 'The Novel',
      description: 'Maximum-length values: wrapping prose and one unbreakable token. Surfaces truncation, overflow, missing ellipsis, and layouts that only worked at demo lengths.',
      rows: [
        { label: 'Long, wrapping prose', row: baseRow(fields, 0, novel(false)) },
        { label: 'One unbreakable token', row: baseRow(fields, 1, novel(true)) },
      ],
    });
  }

  // 3. The Time Traveler — extreme but VALID dates (a real SP Date column
  //    cannot hold an invalid string, so none are fabricated; blank = null).
  if (has(['date'])) {
    const dateRow = (label: string, value: CellValue) => ({
      label,
      row: baseRow(fields, 0, (f) => (f.type === 'date' ? value : undefined)),
    });
    out.push({
      id: 'time',
      label: 'The Time Traveler',
      description: 'Every date field pushed to the extremes: the distant past, the far future, today (the boundary "due today" rides on), and blank — which is null on real SP, so [$Date] == \'\' will NOT catch it.',
      rows: [
        dateRow('Distant past (1900-01-01)', '1900-01-01'),
        dateRow('Today', isoDate(now)),
        dateRow('Far future (2099-12-31)', '2099-12-31'),
        dateRow('Blank (null — not empty text)', null),
      ],
    });
  }

  // 4. Boundary numbers — zero, negative, huge, fractional, and every
  //    threshold the formatter itself compares against (t and t−1).
  if (has(NUMERIC)) {
    const mined = collectNumericThresholds(opts.mineTrees ?? []);
    const values: Array<{ label: string; value: number }> = [
      { label: 'Zero', value: 0 },
      { label: 'Negative (−42)', value: -42 },
      { label: 'Fractional (0.5)', value: 0.5 },
      { label: 'Huge (9,999,999,999)', value: 9_999_999_999 },
    ];
    const seen = new Set(values.map((v) => v.value));
    for (const t of mined) {
      for (const probe of [t, t - 1]) {
        if (!seen.has(probe)) {
          seen.add(probe);
          values.push({
            label: probe === t ? `Exactly ${t} (a threshold in this formatter)` : `Just under ${t} (${probe})`,
            value: probe,
          });
        }
      }
    }
    out.push({
      id: 'numbers',
      label: 'Boundary numbers',
      description: mined.length
        ? `Zero, negative, fractional, huge — plus the thresholds mined from this formatter's own comparisons (${mined.join(', ')}), each tested exactly-at and just-below, so >= vs > off-by-ones show side by side.`
        : 'Zero, negative, fractional and huge values in every number/currency field — data bars, percentages and width math tend to assume 0–100.',
      rows: values.slice(0, 12).map((v) => ({
        label: v.label,
        row: baseRow(fields, 0, (f) => (NUMERIC.includes(f.type) ? v.value : undefined)),
      })),
    });
  }

  // 5. Multi-value extremes — crowded vs empty.
  if (has(MULTI)) {
    const crowd = ['Ada Lovelace', 'Grace Hopper', 'Mark Otto', 'Linus T', 'Radia Perlman', 'Katherine Johnson', 'Annie Easley', 'Barbara Liskov'];
    const crowded = (f: MockField): CellValue | undefined => {
      switch (f.type) {
        case 'personMulti': return crowd.map(person);
        case 'lookupMulti': return crowd.map((n, i) => lookup(`${f.lookup?.list ?? 'Item'} ${n.split(' ')[0]}`, i + 1));
        case 'choiceMulti': {
          // every configured option selected — the REAL maximum (a multi-choice
          // can't hold the same option twice, so we never fabricate duplicates)
          const opts2 = f.choices?.length ? f.choices : ['Red', 'Green', 'Blue'];
          return opts2.join(';#');
        }
        default: return undefined;
      }
    };
    const empty = (f: MockField): CellValue | undefined =>
      MULTI.includes(f.type) ? emptyValue(f) : undefined;
    out.push({
      id: 'multi',
      label: 'Multi-value extremes',
      description: 'Every multi-value field crowded with 8 entries, then completely empty. Facepiles overflow, joined lists run long, and length()/forEach logic meets the empty array.',
      rows: [
        { label: 'Crowded (8 values)', row: baseRow(fields, 0, crowded) },
        { label: 'Empty (no values)', row: baseRow(fields, 1, empty) },
      ],
    });
  }

  // 6. Unicode / RTL / emoji — real names and real languages.
  if (has(TEXTY.concat('person'))) {
    const accents = (f: MockField): CellValue | undefined => {
      switch (f.type) {
        case 'text': return 'Zürich ⇄ 東京 relocation — José’s naïve café rollout 🚀';
        case 'note': return 'Emoji in running text 🎉✅⚠️, combining marks (ñ, é), and CJK: 東京オフィス移転プロジェクト。';
        case 'person': return person('José Björk-Ñíguez');
        default: return undefined;
      }
    };
    const rtl = (f: MockField): CellValue | undefined => {
      switch (f.type) {
        case 'text': return 'مرحبا بالعالم — تقرير الربع الثالث';
        case 'note': return 'טקסט מימין לשמאל בתוך תצוגה משמאל לימין — bidirectional soup.';
        case 'person': return person('ليلى الأحمد');
        default: return undefined;
      }
    };
    out.push({
      id: 'unicode',
      label: 'Unicode, RTL & emoji',
      description: 'Accented names, CJK, emoji, and right-to-left scripts in every text field. Probes rendering; remember non-ASCII inside the FORMATTER (not the data) garbles via CSOM deploys — the linter\'s ascii-only rule watches that side.',
      rows: [
        { label: 'Accents, CJK & emoji', row: baseRow(fields, 0, accents) },
        { label: 'Right-to-left scripts', row: baseRow(fields, 1, rtl) },
      ],
    });
  }

  return out;
}
