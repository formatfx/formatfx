// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Sam Yost

/**
 * editor/lintView.ts — the lint footer's view-model brain (pure, node-tested).
 *
 * Pasting a formatter whose columns aren't in the mock schema floods the
 * footer with one 'unknown-field' warning per REFERENCE. This module folds
 * that flood into one row per missing COLUMN (count badge = how many places
 * reference it), leaves every other diagnostic untouched in walk order, and
 * tallies a severity summary (distinct issue types + total occurrences per
 * level) the panel can show even while collapsed.
 *
 * The missing-column filter is for the paste-JSON-as-scratchpad workflow
 * (using the editor on a formatter without wiring up the Data tab): it
 * suppresses the rows AND reports how many it suppressed — the summary stays
 * the full truth, hiding is never silent. The filter preference lives under
 * `wb-lint-prefs.v1` — an ADDITIVE key; the frozen originals stay frozen.
 *
 * inferFieldType guesses a missing column's type from how the formatter uses
 * it (person/lookup accessors, forEach = multi-valued, date functions and
 * @now comparisons, arithmetic, boolean compares) so "create this column" can
 * preselect something sensible. It's a heuristic for a DEFAULT — the create
 * flow always shows the type picker, so a wrong guess costs one click.
 */

import type { NodePath, SPElement, FieldType } from '../core/types';
import type { LintIssue } from '../core/linter';
import type { RenderIssue } from '../core/renderer';
import { parseForEach } from '../core/expressions';

/** One severity level's tally. The head-bar chips read "2 errors (×51)":
 *  2 distinct KINDS of error, 51 occurrences between them. */
export interface SeverityTally {
  /** Distinct issue types at this level (lint rules; runtime issues carry no
   *  rule, so distinct messages stand in). */
  types: number;
  /** Every occurrence at this level — the full-truth count. */
  total: number;
}

export interface LintSummary {
  errors: SeverityTally;
  warnings: SeverityTally;
  infos: SeverityTally;
  runtime: SeverityTally;
}

/** A diagnostic rendered as-is (everything except grouped missing columns). */
export interface PlainLintRow {
  kind: 'issue';
  sev: 'error' | 'warning' | 'info' | 'runtime';
  text: string;
  path: NodePath;
}

/** One row per missing column, folding every reference to it. */
export interface MissingColumnRow {
  kind: 'missing';
  field: string;
  /** How many diagnostics referenced the column (≈ how many places). */
  count: number;
  /** Unique referencing elements, first one is the jump target. */
  paths: NodePath[];
}

export type LintRow = PlainLintRow | MissingColumnRow;

export interface LintViewModel {
  rows: LintRow[];
  /** Full-truth counts — the filter never changes these. */
  summary: LintSummary;
  /** unknown-field diagnostics suppressed by the missing-column filter. */
  hiddenMissing: number;
}

export function buildLintView(
  issues: LintIssue[],
  runtime: RenderIssue[],
  opts: { hideMissingColumns?: boolean } = {},
): LintViewModel {
  const tally = (sev: LintIssue['severity']): SeverityTally => {
    const at = issues.filter((i) => i.severity === sev);
    return { types: new Set(at.map((i) => i.rule)).size, total: at.length };
  };
  const summary: LintSummary = {
    errors: tally('error'),
    warnings: tally('warning'),
    infos: tally('info'),
    runtime: { types: new Set(runtime.map((r) => r.message)).size, total: runtime.length },
  };
  const rows: LintRow[] = [];
  const groups = new Map<string, MissingColumnRow>();
  let hiddenMissing = 0;
  for (const issue of issues) {
    if (issue.rule === 'unknown-field' && issue.field) {
      if (opts.hideMissingColumns) { hiddenMissing++; continue; }
      const existing = groups.get(issue.field);
      if (existing) {
        existing.count++;
        if (!existing.paths.some((p) => p.join('/') === issue.path.join('/'))) {
          existing.paths.push(issue.path);
        }
      } else {
        const row: MissingColumnRow = { kind: 'missing', field: issue.field, count: 1, paths: [issue.path] };
        groups.set(issue.field, row);
        rows.push(row); // holds the group's first-seen position in walk order
      }
      continue;
    }
    rows.push({ kind: 'issue', sev: issue.severity, text: `${issue.rule}: ${issue.message}`, path: issue.path });
  }
  for (const r of runtime) {
    rows.push({ kind: 'issue', sev: 'runtime', text: r.message, path: r.path });
  }
  return { rows, summary, hiddenMissing };
}

// ── type inference from usage ──

interface Evidence {
  person: boolean;
  lookup: boolean;
  multi: boolean;
  date: boolean;
  number: boolean;
  bool: boolean;
}

const PERSON_ACCESSORS = /^(title|email|picture|sip|id|department|jobTitle)$/;
const LOOKUP_ACCESSORS = /^(lookupValue|lookupId)$/;
const DATE_FNS = '(?:toLocaleDateString|toLocaleString|toDateString|addDays|addMinutes|getDate|getMonth|getYear)';

/** `aliases` are names that stand for the field in scope: the field itself,
 *  plus any forEach iterators looping over it (their accessors count as the
 *  field's — `_o in [$Owners]` + `[$_o.title]` reads as person evidence). */
function gatherEvidence(el: SPElement, aliases: string[], ev: Evidence): void {
  let scope = aliases;
  if (typeof el.forEach === 'string') {
    const b = parseForEach(el.forEach);
    if (b && scope.some((a) => b.listExpr.includes(`[$${a}]`))) {
      ev.multi = true; // something loops over the field: it's multi-valued
      scope = [...scope, b.iterator];
    }
  }
  const values: string[] = [];
  if (typeof el.txtContent === 'string') values.push(el.txtContent);
  for (const v of Object.values(el.style ?? {})) if (typeof v === 'string') values.push(v);
  for (const v of Object.values(el.attributes ?? {})) if (typeof v === 'string') values.push(v);
  for (const s of values) {
    for (const a of scope) {
      if (!s.includes(`[$${a}`)) continue;
      const ref = `\\[\\$${a}\\]`;
      for (const m of s.matchAll(new RegExp(`\\[\\$${a}\\.([A-Za-z]+)`, 'g'))) {
        if (PERSON_ACCESSORS.test(m[1])) ev.person = true;
        if (LOOKUP_ACCESSORS.test(m[1])) ev.lookup = true;
      }
      if (new RegExp(`${DATE_FNS}\\(\\s*${ref}`).test(s)) ev.date = true;
      if (new RegExp(`${ref}\\s*(?:<=|>=|<|>|==|!=)\\s*@now\\b`).test(s)
        || new RegExp(`@now\\s*(?:<=|>=|<|>|==|!=)\\s*${ref}`).test(s)) ev.date = true;
      if (new RegExp(`${ref}\\s*[*/+-]\\s*[\\d(]`).test(s)
        || new RegExp(`[\\d)]\\s*[*/+-]\\s*${ref}`).test(s)
        || new RegExp(`${ref}\\s*(?:<=|>=|<|>|==|!=)\\s*\\d`).test(s)) ev.number = true;
      if (new RegExp(`${ref}\\s*(?:==|!=)\\s*(?:true|false)\\b`).test(s)) ev.bool = true;
    }
  }
  for (const child of el.children ?? []) gatherEvidence(child, scope, ev);
  if (el.customCardProps?.formatter) gatherEvidence(el.customCardProps.formatter, scope, ev);
}

/** Best-guess FieldType for a column from how the tree uses it ('text' when
 *  nothing in the usage says otherwise). */
export function inferFieldType(root: SPElement, field: string): FieldType {
  const ev: Evidence = { person: false, lookup: false, multi: false, date: false, number: false, bool: false };
  gatherEvidence(root, [field], ev);
  if (ev.person) return ev.multi ? 'personMulti' : 'person';
  if (ev.lookup) return ev.multi ? 'lookupMulti' : 'lookup';
  if (ev.multi) return 'choiceMulti';
  if (ev.date) return 'date';
  if (ev.number) return 'number';
  if (ev.bool) return 'boolean';
  return 'text';
}

// ── the filter preference (additive storage key) ──

export interface LintPrefs {
  hideMissingColumns: boolean;
}

export const LINT_PREFS_KEY = 'wb-lint-prefs.v1';

/** Strict parse with defaults — a garbled blob lands on the defaults. */
export function parseLintPrefs(raw: string | null): LintPrefs {
  try {
    const p = JSON.parse(raw ?? '{}');
    return { hideMissingColumns: p && typeof p === 'object' && p.hideMissingColumns === true };
  } catch {
    return { hideMissingColumns: false };
  }
}

export function loadLintPrefs(): LintPrefs {
  try {
    return parseLintPrefs(localStorage.getItem(LINT_PREFS_KEY));
  } catch {
    return { hideMissingColumns: false };
  }
}

export function saveLintPrefs(prefs: LintPrefs): void {
  try {
    localStorage.setItem(LINT_PREFS_KEY, JSON.stringify(prefs));
  } catch { /* private mode */ }
}
