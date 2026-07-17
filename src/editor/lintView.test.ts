// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sam Yost. FormatFX is dual-licensed: AGPL-3.0-only (see LICENSE) or a commercial license (see LICENSING.md).

/**
 * lintView.test.ts — contracts for the lint footer's view model: the
 * missing-column fold (one row per column, count badge, first-seen order),
 * the filter's honest accounting, the usage-based type inference behind
 * "create this column", and the additive prefs blob's strict parse.
 */
import { describe, it, expect } from 'vitest';
import { buildLintView, inferFieldType, parseLintPrefs, type MissingColumnRow, type PlainLintRow } from './lintView';
import type { LintIssue } from '../core/linter';
import type { SPElement } from '../core/types';

const missing = (field: string, path: number[], where = 'txtContent'): LintIssue => ({
  severity: 'warning',
  rule: 'unknown-field',
  field,
  path,
  message: `${where}: [$${field}] is not in the mock schema — add the field in the Data tab or import your list schema.`,
});
const issue = (severity: LintIssue['severity'], rule: string, path: number[]): LintIssue =>
  ({ severity, rule, message: 'msg', path });

describe('buildLintView — the missing-column fold', () => {
  it('folds unknown-field issues into one row per column, at first-seen position', () => {
    const view = buildLintView([
      issue('error', 'expr-syntax', [0]),
      missing('Region', [1]),
      missing('Owner', [2]),
      missing('Region', [3]),
      issue('info', 'ascii-only', [4]),
      missing('Region', [5]),
    ], []);
    expect(view.rows.map((r) => r.kind)).toEqual(['issue', 'missing', 'missing', 'issue']);
    const region = view.rows[1] as MissingColumnRow;
    expect(region.field).toBe('Region');
    expect(region.count).toBe(3);
    expect(region.paths).toEqual([[1], [3], [5]]);
    expect((view.rows[2] as MissingColumnRow).count).toBe(1);
  });

  it('counts every reference but dedupes repeat paths (two expressions on one element)', () => {
    const view = buildLintView([
      missing('Due', [0, 1], 'txtContent'),
      missing('Due', [0, 1], 'style.color'),
    ], []);
    const row = view.rows[0] as MissingColumnRow;
    expect(row.count).toBe(2);
    expect(row.paths).toEqual([[0, 1]]);
  });

  it('appends runtime issues as plain rows after the lint rows', () => {
    const view = buildLintView([missing('X', [0])], [{ path: [2], message: 'boom' }]);
    expect(view.rows).toHaveLength(2);
    const rt = view.rows[1] as PlainLintRow;
    expect(rt.sev).toBe('runtime');
    expect(rt.text).toBe('boom');
    expect(view.summary.runtime).toEqual({ types: 1, total: 1 });
  });

  it('the filter suppresses missing-column rows but never the accounting', () => {
    const issues = [missing('A', [0]), missing('A', [1]), missing('B', [2]), issue('warning', 'css-unknown', [3])];
    const view = buildLintView(issues, [], { hideMissingColumns: true });
    expect(view.rows.map((r) => r.kind)).toEqual(['issue']); // only css-unknown survives
    expect(view.hiddenMissing).toBe(3);
    // the summary is the full truth — hiding is never silent
    expect(view.summary.warnings).toEqual({ types: 2, total: 4 });
    const unfiltered = buildLintView(issues, []);
    expect(unfiltered.hiddenMissing).toBe(0);
    expect(unfiltered.summary.warnings).toEqual({ types: 2, total: 4 });
  });

  it('an unknown-field issue without structured field data falls back to a plain row', () => {
    const legacy: LintIssue = { severity: 'warning', rule: 'unknown-field', message: 'm', path: [0] };
    const view = buildLintView([legacy], [], { hideMissingColumns: true });
    expect(view.rows).toHaveLength(1);
    expect(view.rows[0].kind).toBe('issue');
  });

  it('tallies each severity as distinct issue types AND total occurrences', () => {
    const view = buildLintView([
      issue('error', 'a', [0]), issue('error', 'a', [1]), issue('error', 'b', [2]),
      issue('warning', 'c', [3]), issue('info', 'd', [4]),
    ], [{ path: [], message: 'boom' }, { path: [1], message: 'boom' }, { path: [2], message: 'bang' }]);
    expect(view.summary).toEqual({
      errors: { types: 2, total: 3 },
      warnings: { types: 1, total: 1 },
      infos: { types: 1, total: 1 },
      // runtime issues carry no rule — distinct messages stand in for types
      runtime: { types: 2, total: 3 },
    });
  });
});

describe('inferFieldType — usage evidence', () => {
  const doc = (...children: SPElement[]): SPElement => ({ elmType: 'div', children });

  it('person accessors read as person', () => {
    expect(inferFieldType(doc({ elmType: 'span', txtContent: '[$Owner.email]' }), 'Owner')).toBe('person');
    expect(inferFieldType(doc({ elmType: 'span', txtContent: "=if([$Owner.title]=='','–',[$Owner.title])" }), 'Owner')).toBe('person');
  });

  it('a forEach loop over the field makes it multi — iterator accessors count as the field', () => {
    const root: SPElement = {
      elmType: 'div',
      forEach: '_o in [$Owners]',
      children: [{ elmType: 'span', txtContent: '[$_o.title]' }],
    };
    expect(inferFieldType({ elmType: 'div', children: [root] }, 'Owners')).toBe('personMulti');
  });

  it('lookup accessors read as lookup; looped, as lookupMulti', () => {
    expect(inferFieldType(doc({ elmType: 'span', txtContent: '[$Project.lookupValue]' }), 'Project')).toBe('lookup');
    const looped: SPElement = {
      elmType: 'div',
      forEach: '_p in [$Projects]',
      children: [{ elmType: 'span', txtContent: '[$_p.lookupId]' }],
    };
    expect(inferFieldType({ elmType: 'div', children: [looped] }, 'Projects')).toBe('lookupMulti');
  });

  it('a plain forEach with no accessor evidence reads as choiceMulti', () => {
    const looped: SPElement = { elmType: 'div', forEach: '_t in [$Tags]', children: [{ elmType: 'span', txtContent: '[$_t]' }] };
    expect(inferFieldType({ elmType: 'div', children: [looped] }, 'Tags')).toBe('choiceMulti');
  });

  it('date functions and @now comparisons read as date', () => {
    expect(inferFieldType(doc({ elmType: 'span', txtContent: '=toLocaleDateString([$Due])' }), 'Due')).toBe('date');
    expect(inferFieldType(doc({ elmType: 'span', txtContent: '=addDays([$Due],3)' }), 'Due')).toBe('date');
    expect(inferFieldType(doc({ elmType: 'div', style: { color: "=if([$Due]<=@now,'red','')" } }), 'Due')).toBe('date');
  });

  it('arithmetic and numeric comparisons read as number', () => {
    expect(inferFieldType(doc({ elmType: 'span', txtContent: '=[$Score]*2' }), 'Score')).toBe('number');
    expect(inferFieldType(doc({ elmType: 'div', style: { color: "=if([$Score]>=80,'green','red')" } }), 'Score')).toBe('number');
  });

  it('true/false comparisons read as boolean', () => {
    expect(inferFieldType(doc({ elmType: 'span', txtContent: "=if([$Done]==true,'✓','')" }), 'Done')).toBe('boolean');
  });

  it('descends into customCardProps content', () => {
    const host: SPElement = {
      elmType: 'div',
      customCardProps: { formatter: { elmType: 'span', txtContent: '[$Contact.email]' }, openOnEvent: 'hover' },
    };
    expect(inferFieldType({ elmType: 'div', children: [host] }, 'Contact')).toBe('person');
  });

  it('defaults to text when the usage says nothing', () => {
    expect(inferFieldType(doc({ elmType: 'span', txtContent: '[$Notes]' }), 'Notes')).toBe('text');
    expect(inferFieldType(doc({ elmType: 'span', txtContent: 'no refs at all' }), 'Notes')).toBe('text');
  });
});

describe('lint prefs — strict parse of the additive blob', () => {
  it('defaults when missing, garbled, or mistyped', () => {
    expect(parseLintPrefs(null)).toEqual({ hideMissingColumns: false });
    expect(parseLintPrefs('{not json')).toEqual({ hideMissingColumns: false });
    expect(parseLintPrefs('"just a string"')).toEqual({ hideMissingColumns: false });
    expect(parseLintPrefs('{"hideMissingColumns":"yes"}')).toEqual({ hideMissingColumns: false });
  });

  it('round-trips the only real value', () => {
    expect(parseLintPrefs('{"hideMissingColumns":true}')).toEqual({ hideMissingColumns: true });
  });
});
