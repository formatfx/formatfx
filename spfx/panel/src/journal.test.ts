import { describe, it, expect } from 'vitest';
import {
  targetKey, rowTitle, toItemBody, fromItem, verdictForPending,
  JOURNAL_FIELDS, JOURNAL_LIST_TITLE, type JournalRow,
} from './journal';
import { formatterHash } from './hash';

const row: JournalRow = {
  kind: 'Pending', listId: 'e481b50b-ebf9-4cbd-804f-a5276afb23ab',
  target: { kind: 'Field', id: 'Status' },
  before: '{"elmType":"div"}', after: '{"elmType":"span"}', basedOn: formatterHash('{"elmType":"div"}'),
};

describe('journal rows', () => {
  it('keys a target as Kind:id', () => {
    expect(targetKey({ kind: 'View', id: 'f24ba2a8-0000-0000-0000-000000000000' })).toBe('View:f24ba2a8-0000-0000-0000-000000000000');
  });
  it('titles a row for the list view', () => {
    expect(rowTitle(row)).toBe('Pending Field:Status');
  });
  it('maps to and from a SharePoint item, Title included (required column)', () => {
    const body = toItemBody(row);
    expect(body).toEqual({
      Title: 'Pending Field:Status', Kind: 'Pending', ListId: row.listId, TargetKind: 'Field', TargetId: 'Status',
      Before: row.before, After: row.after, BasedOn: row.basedOn,
    });
    const back = fromItem({ Id: 7, ...body, Created: '2026-09-16T00:00:00Z', Author: { Title: 'Sam' } });
    expect(back).toEqual({ ...row, id: 7, created: '2026-09-16T00:00:00Z', author: 'Sam' });
  });
  it('maps a cleared formatter as null both ways', () => {
    const cleared = { ...row, before: null };
    expect(toItemBody(cleared).Before).toBe('');
    expect(fromItem({ Id: 1, ...toItemBody(cleared) })?.before).toBeNull();
  });
  it('rejects an item with an unknown Kind', () => {
    expect(fromItem({ Id: 1, Kind: 'Bogus', ListId: 'x', TargetKind: 'Field', TargetId: 'y' })).toBeNull();
  });
  it('confirms a Pending row when the live formatter equals After, else fails it', () => {
    expect(verdictForPending(row, '{"elmType":"span"}')).toBe('Applied');
    expect(verdictForPending(row, '{"elmType":"div"}')).toBe('Failed');
    expect(verdictForPending({ ...row, after: null }, null)).toBe('Applied');
  });
  it('declares the hidden list shape', () => {
    expect(JOURNAL_LIST_TITLE).toBe('FormatFX');
    expect(JOURNAL_FIELDS.map((f) => f.name)).toEqual(['Kind', 'ListId', 'TargetKind', 'TargetId', 'Before', 'After', 'BasedOn']);
    expect(JOURNAL_FIELDS.find((f) => f.name === 'Before')?.kind).toBe(3);
  });
});
