/**
 * journal.ts — the hidden FormatFX list's row model (spec §6), pure.
 * One row per event; drafts are per person + target; Pending → Applied /
 * Failed is the only transition, history is append-only.
 */
export type JournalKind = 'Draft' | 'Pending' | 'Applied' | 'Failed';
export type TargetKind = 'Field' | 'View';
export interface TargetRef { kind: TargetKind; id: string }
export interface JournalRow {
  id?: number;
  kind: JournalKind;
  listId: string;
  target: TargetRef;
  before: string | null;
  after: string | null;
  basedOn: string;
  author?: string;
  created?: string;
}

export const JOURNAL_LIST_TITLE = 'FormatFX';
/** FieldTypeKind 2 = single line of text, 3 = multiple lines (the JSON). */
export const JOURNAL_FIELDS: { name: string; kind: 2 | 3 }[] = [
  { name: 'Kind', kind: 2 }, { name: 'ListId', kind: 2 }, { name: 'TargetKind', kind: 2 },
  { name: 'TargetId', kind: 2 }, { name: 'Before', kind: 3 }, { name: 'After', kind: 3 }, { name: 'BasedOn', kind: 2 },
];
const KINDS: readonly string[] = ['Draft', 'Pending', 'Applied', 'Failed'];

export function targetKey(t: TargetRef): string { return `${t.kind}:${t.id}`; }
export function rowTitle(row: JournalRow): string { return `${row.kind} ${targetKey(row.target)}`; }

export function toItemBody(row: JournalRow): Record<string, unknown> {
  return {
    Title: rowTitle(row), Kind: row.kind, ListId: row.listId,
    TargetKind: row.target.kind, TargetId: row.target.id,
    Before: row.before ?? '', After: row.after ?? '', BasedOn: row.basedOn,
  };
}

export function fromItem(item: Record<string, unknown>): JournalRow | null {
  const kind = item.Kind;
  if (typeof kind !== 'string' || !KINDS.includes(kind)) return null;
  if (item.TargetKind !== 'Field' && item.TargetKind !== 'View') return null;
  const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
  const row: JournalRow = {
    kind: kind as JournalKind, listId: String(item.ListId ?? ''),
    target: { kind: item.TargetKind, id: String(item.TargetId ?? '') },
    before: str(item.Before), after: str(item.After), basedOn: String(item.BasedOn ?? ''),
  };
  if (typeof item.Id === 'number') row.id = item.Id;
  if (typeof item.Created === 'string') row.created = item.Created;
  const author = (item.Author as { Title?: unknown } | undefined)?.Title;
  if (typeof author === 'string') row.author = author;
  return row;
}

/** The "check" action on an unconfirmed row: does the list hold After now? */
export function verdictForPending(row: JournalRow, live: string | null): 'Applied' | 'Failed' {
  return (live ?? '') === (row.after ?? '') ? 'Applied' : 'Failed';
}
