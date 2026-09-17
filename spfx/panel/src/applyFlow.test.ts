import { describe, it, expect } from 'vitest';
import { applyTarget, checkPending, type ApplyDeps } from './applyFlow';
import { createSessionJournal } from './journalStore';
import { formatterHash } from './hash';

const LIST = 'e481b50b-ebf9-4cbd-804f-a5276afb23ab';
const T = { kind: 'Field' as const, id: 'Status' };
const V1 = '{"elmType":"div"}';
const V2 = '{"elmType":"span"}';

/** A fake target whose live value can be changed mid-flight: `reads` is a queue of values the read() returns in order (last repeats). */
function target(reads: (string | null)[], opts: { writeFails?: string } = {}) {
  const log: string[] = [];
  let live: string | null = reads[0];
  let i = 0;
  const deps: ApplyDeps = {
    async read() { live = reads[Math.min(i++, reads.length - 1)]; log.push('read'); return live; },
    async write(f) { log.push('write'); if (opts.writeFails) throw new Error(opts.writeFails); reads.push(f); },
    journal: createSessionJournal(LIST, sessionStorage, 'test'),
  };
  return { deps, log };
}

describe('applyTarget', () => {
  it('happy path: read → Pending row → re-read → write → verify → Applied', async () => {
    sessionStorage.clear();
    const { deps, log } = target([V1]);
    const r = await applyTarget(deps, { listId: LIST, target: T, after: V2, basedOn: formatterHash(V1) });
    expect(r.status).toBe('applied');
    expect(log).toEqual(['read', 'read', 'write', 'read']);
    const [row] = await deps.journal.history(T);
    expect(row.kind).toBe('Applied');
    expect(row.before).toBe(V1);
    expect(row.after).toBe(V2);
  });

  it('stops at step 2 when the live formatter no longer matches BasedOn (no row, no write)', async () => {
    sessionStorage.clear();
    const { deps, log } = target([V2]);
    const r = await applyTarget(deps, { listId: LIST, target: T, after: '{"x":1}', basedOn: formatterHash(V1) });
    expect(r).toEqual({ status: 'stale', live: V2, yours: '{"x":1}' });
    expect(log).toEqual(['read']);
    expect(await deps.journal.history(T)).toEqual([]);
  });

  it('force skips the BasedOn check but still records the real Before', async () => {
    sessionStorage.clear();
    const { deps } = target([V2]);
    const r = await applyTarget(deps, { listId: LIST, target: T, after: '{"x":1}', basedOn: formatterHash(V1), force: true });
    expect(r.status).toBe('applied');
    expect((await deps.journal.history(T))[0].before).toBe(V2);
  });

  it('narrows the window: a change between step 1 and the pre-MERGE re-read fails the Pending row and reports stale', async () => {
    sessionStorage.clear();
    const { deps, log } = target([V1, V2]);
    const r = await applyTarget(deps, { listId: LIST, target: T, after: '{"x":1}', basedOn: formatterHash(V1) });
    expect(r).toEqual({ status: 'stale', live: V2, yours: '{"x":1}' });
    expect(log).toEqual(['read', 'read']);
    expect((await deps.journal.history(T))[0].kind).toBe('Failed');
  });

  it('a failed write flips the row to Failed and returns the teaching message', async () => {
    sessionStorage.clear();
    const { deps } = target([V1], { writeFails: 'FormatFX: you need Manage Lists on this list' });
    const r = await applyTarget(deps, { listId: LIST, target: T, after: V2, basedOn: formatterHash(V1) });
    expect(r.status).toBe('failed');
    expect((r as { message: string }).message).toContain('Manage Lists');
    expect((await deps.journal.history(T))[0].kind).toBe('Failed');
  });

  it('a verify mismatch is a failure, never Applied', async () => {
    sessionStorage.clear();
    const { deps } = target([V1, V1, '{"other":true}']);
    const r = await applyTarget(deps, { listId: LIST, target: T, after: V2, basedOn: formatterHash(V1) });
    expect(r.status).toBe('failed');
    expect((await deps.journal.history(T))[0].kind).toBe('Failed');
  });

  it('clears a formatter with after = null (rollback to "no formatter")', async () => {
    sessionStorage.clear();
    const { deps } = target([V1]);
    const r = await applyTarget(deps, { listId: LIST, target: T, after: null, basedOn: formatterHash(V1) });
    expect(r.status).toBe('applied');
  });

  it('a rejected journal append resolves failed instead of rejecting the promise (no rowId, no write)', async () => {
    sessionStorage.clear();
    const log: string[] = [];
    const deps: ApplyDeps = {
      async read() { log.push('read'); return V1; },
      async write() { log.push('write'); },
      journal: {
        ...createSessionJournal(LIST, sessionStorage, 'test'),
        append: async () => { throw new Error('FormatFX: you need Manage Lists on this list'); },
      },
    };
    const r = await applyTarget(deps, { listId: LIST, target: T, after: V2, basedOn: formatterHash(V1) });
    expect(r.status).toBe('failed');
    expect((r as { message: string }).message).toContain('Manage Lists');
    expect(log).toEqual(['read']);
  });

  it('a write that throws after landing (e.g. a timeout) is recovered by a re-read → Applied', async () => {
    sessionStorage.clear();
    const reads: (string | null)[] = [V1];
    let i = 0;
    const deps: ApplyDeps = {
      async read() { return reads[Math.min(i++, reads.length - 1)]; },
      async write(f) { reads.push(f); throw new Error('timeout after send'); },
      journal: createSessionJournal(LIST, sessionStorage, 'test'),
    };
    const r = await applyTarget(deps, { listId: LIST, target: T, after: V2, basedOn: formatterHash(V1) });
    expect(r.status).toBe('applied');
    expect((await deps.journal.history(T))[0].kind).toBe('Applied');
  });
});

describe('checkPending', () => {
  it('re-reads and flips an unconfirmed row', async () => {
    sessionStorage.clear();
    const { deps } = target([V2]);
    const id = await deps.journal.append({ kind: 'Pending', listId: LIST, target: T, before: V1, after: V2, basedOn: formatterHash(V1) });
    const [row] = await deps.journal.history(T);
    expect(await checkPending(deps, row)).toBe('Applied');
    expect((await deps.journal.history(T))[0]).toMatchObject({ id, kind: 'Applied' });
  });
});
