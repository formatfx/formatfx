/**
 * journalStore.ts — where drafts and history live (spec §6).
 *
 * Durable backend: the hidden `FormatFX` list on the site, created on first
 * use (needs Manage Lists). Drafts are per person + target (filtered by
 * AuthorId); Pending/Applied/Failed rows are the append-only history.
 *
 * Fallback backend: per-tab sessionStorage, used whenever the list is
 * unavailable to this person — cannot be created, or exists but cannot be
 * read/written. Nothing there is shared or durable; the panel says so.
 */
import { type SpRest, SpRestError } from './rest';
import {
  JOURNAL_FIELDS, JOURNAL_LIST_TITLE, fromItem, toItemBody, targetKey,
  type JournalKind, type JournalRow, type TargetRef,
} from './journal';

export interface JournalBackend {
  readonly durable: boolean;
  readonly reason?: string;
  loadDraft(t: TargetRef): Promise<JournalRow | null>;
  saveDraft(t: TargetRef, after: string, basedOn: string): Promise<void>;
  deleteDraft(t: TargetRef): Promise<void>;
  listDraftKeys(): Promise<Set<string>>;
  append(row: JournalRow): Promise<number>;
  setKind(id: number, kind: JournalKind): Promise<void>;
  history(t: TargetRef): Promise<JournalRow[]>;
}

export const JOURNAL_PATH = `/_api/web/lists/getbytitle('${JOURNAL_LIST_TITLE}')`;
const SELECT = '$select=Id,Kind,ListId,TargetKind,TargetId,Before,After,BasedOn,Created,AuthorId,Author/Title&$expand=Author';
const q = (s: string): string => s.replace(/'/g, "''");

// ── the hidden list ────────────────────────────────────────────────────────

export function createListJournal(rest: SpRest, listId: string, userId: number): JournalBackend {
  const items = async (filter: string, extra = ''): Promise<JournalRow[]> => {
    const res = await rest.getJson(`${JOURNAL_PATH}/items?$filter=${encodeURIComponent(filter)}&${SELECT}${extra}`);
    return ((res.value as Record<string, unknown>[]) ?? []).map(fromItem).filter((r): r is JournalRow => r !== null);
  };
  const target = (t: TargetRef): string => `ListId eq '${q(listId)}' and TargetKind eq '${t.kind}' and TargetId eq '${q(t.id)}'`;
  const draftOf = async (t: TargetRef): Promise<JournalRow | null> =>
    (await items(`Kind eq 'Draft' and ${target(t)} and AuthorId eq ${userId}`, '&$top=1'))[0] ?? null;

  return {
    durable: true,
    loadDraft: draftOf,
    async saveDraft(t, after, basedOn) {
      const existing = await draftOf(t);
      if (existing?.id !== undefined) {
        await rest.merge(`${JOURNAL_PATH}/items(${existing.id})`, { After: after, BasedOn: basedOn });
        return;
      }
      await rest.postJson(`${JOURNAL_PATH}/items`, toItemBody({ kind: 'Draft', listId, target: t, before: null, after, basedOn }));
    },
    async deleteDraft(t) {
      const existing = await draftOf(t);
      if (existing?.id !== undefined) await rest.del(`${JOURNAL_PATH}/items(${existing.id})`);
    },
    async listDraftKeys() {
      const rows = await items(`Kind eq 'Draft' and ListId eq '${q(listId)}' and AuthorId eq ${userId}`, '&$top=500');
      return new Set(rows.map((r) => targetKey(r.target)));
    },
    async append(row) {
      const created = await rest.postJson(`${JOURNAL_PATH}/items`, toItemBody(row));
      const id = created?.Id;
      if (typeof id !== 'number') throw new Error('FormatFX: the journal row was written but SharePoint returned no item id.');
      return id;
    },
    async setKind(id, kind) {
      await rest.merge(`${JOURNAL_PATH}/items(${id})`, { Kind: kind, Title: `${kind} (row ${id})` });
    },
    async history(t) {
      return items(`Kind ne 'Draft' and ${target(t)}`, '&$orderby=Created desc&$top=50');
    },
  };
}

/** Ensure the list exists with its columns. Throws SpRestError when it cannot. */
async function ensureJournalList(rest: SpRest): Promise<void> {
  try {
    await rest.getJson(`${JOURNAL_PATH}?$select=Id`);
    return;
  } catch (e) {
    if (!(e instanceof SpRestError) || e.status !== 404) throw e;
  }
  await rest.postJson('/_api/web/lists', {
    '@odata.type': '#SP.List', BaseTemplate: 100, Title: JOURNAL_LIST_TITLE, Hidden: true,
    Description: 'FormatFX drafts and formatter history. Do not edit by hand.',
  });
  for (const f of JOURNAL_FIELDS) {
    await rest.postJson(`${JOURNAL_PATH}/fields`, {
      '@odata.type': f.kind === 3 ? '#SP.FieldMultiLineText' : '#SP.FieldText', FieldTypeKind: f.kind, Title: f.name,
    });
  }
}

// ── the per-tab fallback ───────────────────────────────────────────────────

interface SessionBag { nextId: number; rows: JournalRow[] }

export function createSessionJournal(listId: string, storage: Storage, reason: string): JournalBackend {
  const key = `ffx-journal.${listId}`;
  const load = (): SessionBag => {
    try { const raw = storage.getItem(key); if (raw) return JSON.parse(raw) as SessionBag; } catch { /* private mode */ }
    return { nextId: 1, rows: [] };
  };
  const save = (bag: SessionBag): void => { try { storage.setItem(key, JSON.stringify(bag)); } catch { /* quota */ } };
  const same = (a: TargetRef, b: TargetRef): boolean => a.kind === b.kind && a.id === b.id;
  return {
    durable: false,
    reason,
    async loadDraft(t) { return load().rows.find((r) => r.kind === 'Draft' && same(r.target, t)) ?? null; },
    async saveDraft(t, after, basedOn) {
      const bag = load();
      const d = bag.rows.find((r) => r.kind === 'Draft' && same(r.target, t));
      if (d) { d.after = after; d.basedOn = basedOn; }
      else bag.rows.push({ id: bag.nextId++, kind: 'Draft', listId, target: t, before: null, after, basedOn, created: new Date().toISOString() });
      save(bag);
    },
    async deleteDraft(t) {
      const bag = load();
      bag.rows = bag.rows.filter((r) => !(r.kind === 'Draft' && same(r.target, t)));
      save(bag);
    },
    async listDraftKeys() { return new Set(load().rows.filter((r) => r.kind === 'Draft').map((r) => targetKey(r.target))); },
    async append(row) {
      const bag = load();
      const id = bag.nextId++;
      bag.rows.push({ ...row, id, created: new Date().toISOString() });
      save(bag);
      return id;
    },
    async setKind(id, kind) {
      const bag = load();
      const r = bag.rows.find((x) => x.id === id);
      if (r) { r.kind = kind; save(bag); }
    },
    async history(t) {
      return load().rows.filter((r) => r.kind !== 'Draft' && same(r.target, t)).sort((a, b) => (b.id ?? 0) - (a.id ?? 0));
    },
  };
}

// ── choosing ───────────────────────────────────────────────────────────────

export async function openJournal(rest: SpRest, listId: string, storage: Storage): Promise<JournalBackend> {
  try {
    await ensureJournalList(rest);
    const me = await rest.getJson('/_api/web/currentuser?$select=Id');
    await rest.getJson(`${JOURNAL_PATH}/items?$top=1&$select=Id`); // proves this person can read it
    return createListJournal(rest, listId, me.Id as number);
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    return createSessionJournal(listId, storage, `The FormatFX journal list is not available to you (${why}). Drafts and history live in this browser tab only.`);
  }
}
