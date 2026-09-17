import { describe, it, expect, beforeEach } from 'vitest';
import { createSpRest } from './rest';
import { openJournal, createSessionJournal, JOURNAL_PATH, type JournalBackend } from './journalStore';
import { formatterHash } from './hash';
import { JOURNAL_FIELDS, type JournalRow } from './journal';

interface Call { url: string; init?: RequestInit }
const LIST = 'e481b50b-ebf9-4cbd-804f-a5276afb23ab';
const T = { kind: 'Field' as const, id: 'Status' };
const PROBE = '/items?$top=1&$select=Id,Kind,ListId,TargetKind,TargetId,Before,After,BasedOn';
/** ViewListItems | AddListItems | … — the Low word of a full Edit permission set. */
const FULL_LOW = 0x3f;

interface TenantState {
  exists: boolean; canWrite: boolean; items: Record<string, unknown>[];
  /** Columns the existing list already has (default: all of them). */
  fields?: string[];
  /** EffectiveBasePermissions.Low (default: full). Bit 1 = AddListItems. */
  permsLow?: number;
}

/** An in-memory FormatFX list behind a fake fetch. `state.exists=false` 404s the list. */
function fakeTenant(state: TenantState) {
  const calls: Call[] = [];
  let nextId = 1;
  const f = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const h = (init?.headers ?? {}) as Record<string, string>;
    const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
    if (url.endsWith('/_api/contextinfo')) return json({ FormDigestValue: 'D' });
    if (url.endsWith('/_api/web/currentuser?$select=Id')) return json({ Id: 12 });
    if (url.endsWith('/_api/web/lists') && init?.method === 'POST') {
      if (!state.canWrite) return new Response('', { status: 403 });
      state.exists = true; return json({ Id: 'new' }, 201);
    }
    if (!url.includes(JOURNAL_PATH)) return new Response('', { status: 404 });
    if (!state.exists) return new Response('', { status: 404 });
    if (url.endsWith('/fields') && init?.method === 'POST') return json({}, 201);
    if (url.includes('EffectiveBasePermissions')) {
      return json({ EffectiveBasePermissions: { High: '2147483647', Low: String(state.permsLow ?? FULL_LOW) } });
    }
    if (url.includes('/fields?')) {
      const have = state.fields ?? JOURNAL_FIELDS.map((x) => x.name);
      return json({ value: have.map((n) => ({ InternalName: n })) });
    }
    if (url.includes('/items(') && h['X-HTTP-Method'] === 'MERGE') {
      const id = Number(/items\((\d+)\)/.exec(url)![1]);
      Object.assign(state.items.find((i) => i.Id === id)!, JSON.parse(init!.body as string));
      return new Response('', { status: 204 });
    }
    if (url.includes('/items(') && h['X-HTTP-Method'] === 'DELETE') {
      const id = Number(/items\((\d+)\)/.exec(url)![1]);
      state.items = state.items.filter((i) => i.Id !== id);
      return new Response('', { status: 204 });
    }
    if (url.includes('/items') && init?.method === 'POST') {
      const item = { Id: nextId++, Created: new Date(nextId * 1000).toISOString(), AuthorId: 12, Author: { Title: 'Me' }, ...JSON.parse(init!.body as string) };
      state.items.push(item);
      return json(item, 201);
    }
    if (url.includes('/items')) {
      const filter = decodeURIComponent(new URL(url).searchParams.get('$filter') ?? '');
      const rows = state.items.filter((i) => {
        const eq = (col: string) => { const m = new RegExp("(^|\\s)" + col + " eq '([^']*)'").exec(filter); return !m || i[col] === m[2]; };
        const ne = (col: string) => { const m = new RegExp("(^|\\s)" + col + " ne '([^']*)'").exec(filter); return !m || i[col] !== m[2]; };
        const author = /AuthorId eq (\d+)/.exec(filter); return eq('Kind') && ne('Kind') && eq('ListId') && eq('TargetKind') && eq('TargetId') && (!author || i.AuthorId === Number(author[1]));
      });
      const desc = (new URL(url).searchParams.get('$orderby') ?? '').includes('desc');
      return json({ value: desc ? [...rows].reverse() : rows });
    }
    return json({ Id: 'list' });
  }) as unknown as typeof fetch;
  return { fetch: f, calls, state };
}

describe('openJournal', () => {
  it('creates the hidden list with its columns when missing, then is durable', async () => {
    const t = fakeTenant({ exists: false, canWrite: true, items: [] });
    const j = await openJournal(createSpRest('https://t/sites/x', t.fetch), LIST, sessionStorage);
    expect(j.durable).toBe(true);
    // Verified on the tenant 2026-09-17: under `odata=nometadata` SharePoint 400s
    // "'@odata.type' is an invalid instance annotation name" — the two creation
    // POSTs (and only those) send verbose bodies with `__metadata.type`.
    const create = t.calls.find((c) => c.url.endsWith('/_api/web/lists') && c.init?.method === 'POST')!;
    expect(JSON.parse(create.init!.body as string)).toEqual({ __metadata: { type: 'SP.List' }, BaseTemplate: 100, Title: 'FormatFX', Hidden: true, Description: 'FormatFX drafts and formatter history. Do not edit by hand.' });
    expect((create.init!.headers as Record<string, string>)['Content-Type']).toBe('application/json;odata=verbose');
    expect((create.init!.headers as Record<string, string>).Accept).toBe('application/json;odata=nometadata');
    const fieldCalls = t.calls.filter((c) => c.url.endsWith('/fields') && c.init?.method === 'POST');
    const fields = fieldCalls.map((c) => JSON.parse(c.init!.body as string));
    expect(fields).toHaveLength(7);
    expect(fields[4]).toEqual({ __metadata: { type: 'SP.FieldMultiLineText' }, FieldTypeKind: 3, Title: 'Before' });
    expect(fields[0]).toEqual({ __metadata: { type: 'SP.FieldText' }, FieldTypeKind: 2, Title: 'Kind' });
    for (const c of fieldCalls) expect((c.init!.headers as Record<string, string>)['Content-Type']).toBe('application/json;odata=verbose');
    // Everything else stays nometadata (items, MERGE, DELETE never carried a type).
    const nonCreate = t.calls.filter((c) => c.init?.method === 'POST' && !c.url.endsWith('/_api/web/lists') && !c.url.endsWith('/fields') && !c.url.endsWith('/_api/contextinfo'));
    for (const c of nonCreate) expect((c.init!.headers as Record<string, string>)['Content-Type']).toBe('application/json;odata=nometadata');
  });

  it('falls back to the per-tab journal when the list cannot be created', async () => {
    const t = fakeTenant({ exists: false, canWrite: false, items: [] });
    const j = await openJournal(createSpRest('https://t/sites/x', t.fetch), LIST, sessionStorage);
    expect(j.durable).toBe(false);
    expect(j.reason).toContain('Manage Lists');
  });

  it('repairs an existing list by creating only the columns it is missing', async () => {
    const t = fakeTenant({ exists: true, canWrite: true, items: [], fields: ['Kind', 'ListId', 'TargetKind'] });
    const j = await openJournal(createSpRest('https://t/sites/x', t.fetch), LIST, sessionStorage);
    expect(j.durable).toBe(true);
    const created = t.calls
      .filter((c) => c.url.endsWith('/fields') && c.init?.method === 'POST')
      .map((c) => JSON.parse(c.init!.body as string) as { Title: string });
    expect(created.map((b) => b.Title)).toEqual(['TargetId', 'Before', 'After', 'BasedOn']);
    expect(created[1]).toEqual({ __metadata: { type: 'SP.FieldMultiLineText' }, FieldTypeKind: 3, Title: 'Before' });
  });

  it('probes every column it reads, and falls back when that probe fails', async () => {
    const ok = fakeTenant({ exists: true, canWrite: true, items: [] });
    await openJournal(createSpRest('https://t/sites/x', ok.fetch), LIST, sessionStorage);
    expect(ok.calls.some((c) => c.url.endsWith(JOURNAL_PATH + PROBE))).toBe(true);

    const t = fakeTenant({ exists: true, canWrite: true, items: [] });
    const missingColumn = (async (url: string, init?: RequestInit) => (url.includes('$select=Id,Kind')
      ? new Response('column does not exist', { status: 400 })
      : t.fetch(url, init))) as unknown as typeof fetch;
    const j = await openJournal(createSpRest('https://t/sites/x', missingColumn), LIST, sessionStorage);
    expect(j.durable).toBe(false);
  });

  it('falls back when the list can be read but not written', async () => {
    const t = fakeTenant({ exists: true, canWrite: true, items: [], permsLow: 1 }); // ViewListItems only
    const j = await openJournal(createSpRest('https://t/sites/x', t.fetch), LIST, sessionStorage);
    expect(j.durable).toBe(false);
    expect(j.reason).toContain('write');
  });
});

function contract(name: string, make: () => Promise<JournalBackend>): void {
  describe(`${name} backend`, () => {
    let j: JournalBackend;
    beforeEach(async () => { sessionStorage.clear(); j = await make(); });

    it('has no draft to begin with', async () => {
      expect(await j.loadDraft(T)).toBeNull();
      expect(await j.listDraftKeys()).toEqual(new Set());
    });
    it('saves ONE draft per target and person, updating in place', async () => {
      await j.saveDraft(T, '{"a":1}', formatterHash(null));
      await j.saveDraft(T, '{"a":2}', formatterHash(null));
      const d = await j.loadDraft(T);
      expect(d?.kind).toBe('Draft');
      expect(d?.after).toBe('{"a":2}');
      expect(await j.listDraftKeys()).toEqual(new Set(['Field:Status']));
      await j.deleteDraft(T);
      expect(await j.loadDraft(T)).toBeNull();
    });
    it('appends Pending rows, flips them, and lists history newest first without drafts', async () => {
      await j.saveDraft(T, '{"draft":1}', formatterHash(null));
      const row: JournalRow = { kind: 'Pending', listId: LIST, target: T, before: null, after: '{"v":1}', basedOn: formatterHash(null) };
      const id1 = await j.append(row);
      await j.setKind(id1, 'Applied');
      const id2 = await j.append({ ...row, before: '{"v":1}', after: '{"v":2}', basedOn: formatterHash('{"v":1}') });
      const h = await j.history(T);
      expect(h.map((r) => [r.id, r.kind])).toEqual([[id2, 'Pending'], [id1, 'Applied']]);
      expect(h.every((r) => r.kind !== 'Draft')).toBe(true);
      expect(h[1].after).toBe('{"v":1}');
    });
  });
}

contract('list', async () => {
  const t = fakeTenant({ exists: true, canWrite: true, items: [] });
  return openJournal(createSpRest('https://t/sites/x', t.fetch), LIST, sessionStorage);
});
contract('session', async () => createSessionJournal(LIST, sessionStorage, 'test'));
