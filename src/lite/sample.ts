// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Sam Yost

/**
 * lite/sample.ts — the sample list FormatFX Lite previews cards against.
 *
 * Same column names as the main app's default list, so a card made here
 * also previews there. The rows are chosen to stress a fixed-size card:
 * a very long title, an empty date, an empty project, 0 % and 100 %.
 */

import type { MockField, MockRow, PersonValue } from '../core/types';
import type { EvalContext } from '../core/expressions';
import { sampleValue } from '../core/schemaImport';

export function sampleFields(): MockField[] {
  return [
    { name: 'Title', type: 'text' },
    { name: 'Status', type: 'choice', choices: ['Not started', 'In Progress', 'Blocked', 'Done'] },
    { name: 'DueDate', displayName: 'Due date', type: 'date' },
    { name: 'Progress', type: 'number' },
    { name: 'Owner', type: 'person' },
    { name: 'Project', type: 'lookup', lookup: { list: 'Projects', column: 'Title' } },
  ];
}

const person = (title: string): PersonValue => ({
  title, email: `${title.toLowerCase().replace(/ /g, '.')}@contoso.com`,
});

function isoDaysFromNow(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export function sampleRows(): MockRow[] {
  return [
    { Title: 'Launch new intranet', Status: 'In Progress', DueDate: isoDaysFromNow(5), Progress: 64,
      Owner: person('Ada Lovelace'), Project: { lookupId: 3, lookupValue: 'Apollo' } },
    { Title: 'Migrate every file share to SharePoint before the old servers retire', Status: 'Blocked',
      DueDate: isoDaysFromNow(-3), Progress: 20, Owner: person('Grace Hopper'),
      Project: { lookupId: 7, lookupValue: 'Hermes' } },
    { Title: 'Quarterly review deck', Status: 'Done', DueDate: isoDaysFromNow(-10), Progress: 100,
      Owner: person('Mark Otto'), Project: { lookupId: 3, lookupValue: 'Apollo' } },
    { Title: 'Onboard the finance team', Status: 'Not started', DueDate: '', Progress: 0,
      Owner: person('Linus T'), Project: null },
    { Title: 'Refresh brand photos', Status: 'In Progress', DueDate: isoDaysFromNow(14), Progress: 45,
      Owner: person('Grace Hopper'), Project: { lookupId: 9, lookupValue: 'Zephyr' } },
  ];
}

/** Give fields a pasted card mentions (but the sample list lacks) a column
 *  and plausible values, so the preview never shows blanks for them. */
export function withExtraFields(fields: MockField[], rows: MockRow[], names: string[]): void {
  for (const name of names) {
    if (fields.some((f) => f.name === name)) continue;
    const field: MockField = { name, type: 'text' };
    fields.push(field);
    rows.forEach((row, i) => { row[name] = sampleValue(field, i); });
  }
}

const ME: PersonValue = { title: 'Sandbox User', email: 'me@contoso.com' };

export function ctxFor(fields: MockField[], rows: MockRow[], rowIndex: number): EvalContext {
  return {
    row: rows[rowIndex] ?? {},
    rowIndex,
    currentFieldName: 'Title',
    me: ME,
    iterators: {},
    iteratorIndex: {},
    displayNames: Object.fromEntries(fields.map((f) => [f.name, f.displayName ?? f.name])),
    fieldTypes: Object.fromEntries(fields.map((f) => [f.name, f.type])),
    now: new Date(),
  };
}
