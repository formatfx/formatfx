/**
 * applyFlow.ts — spec §7, as a pure orchestration over injected deps.
 *
 *   1. read the live formatter
 *   2. compare to BasedOn → 'stale' (the caller shows both, offers overwrite = force)
 *   3. (the digest is the REST client's business)
 *   4. write the Pending journal row with Before + After — BEFORE the list
 *   5. re-read immediately before the MERGE (no ETag: the window is narrowed,
 *      not closed); any difference → row Failed, 'stale'
 *   6. MERGE, re-read, verify, flip the row to Applied
 *   7. every failure flips the row to Failed and returns a teaching message;
 *      a row that could not be flipped stays Pending = "unconfirmed" in the
 *      History drawer, where checkPending() resolves it.
 *
 * Rollback is applyTarget() with `after` = an earlier row's Before.
 */
import type { JournalBackend } from './journalStore';
import { verdictForPending, type JournalRow, type TargetRef } from './journal';
import { formatterHash } from './hash';

export interface ApplyDeps {
  read(): Promise<string | null>;
  write(formatter: string | null): Promise<void>;
  journal: JournalBackend;
}
export interface ApplyRequest { listId: string; target: TargetRef; after: string | null; basedOn: string; force?: boolean }
export type ApplyResult =
  | { status: 'applied'; rowId: number }
  | { status: 'stale'; live: string | null; yours: string | null }
  | { status: 'failed'; rowId?: number; message: string };

const same = (a: string | null, b: string | null): boolean => (a ?? '') === (b ?? '');

export async function applyTarget(deps: ApplyDeps, req: ApplyRequest): Promise<ApplyResult> {
  const live1 = await deps.read();
  if (!req.force && formatterHash(live1) !== req.basedOn) {
    return { status: 'stale', live: live1, yours: req.after };
  }
  const row: JournalRow = { kind: 'Pending', listId: req.listId, target: req.target, before: live1, after: req.after, basedOn: req.basedOn };
  const rowId = await deps.journal.append(row);
  const fail = async (message: string): Promise<ApplyResult> => {
    try { await deps.journal.setKind(rowId, 'Failed'); } catch { /* stays Pending → unconfirmed */ }
    return { status: 'failed', rowId, message };
  };
  try {
    const live2 = await deps.read();
    if (!same(live2, live1)) {
      await fail('someone changed this since you started');
      return { status: 'stale', live: live2, yours: req.after };
    }
    await deps.write(req.after);
    const verify = await deps.read();
    if (!same(verify, req.after)) {
      return fail('The write returned OK but the list does not hold what was sent. Reload and check the target before trying again.');
    }
    await deps.journal.setKind(rowId, 'Applied');
    return { status: 'applied', rowId };
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }
}

/** The History drawer's "check" action for an unconfirmed (Pending) row. */
export async function checkPending(deps: ApplyDeps, row: JournalRow): Promise<'Applied' | 'Failed'> {
  const verdict = verdictForPending(row, await deps.read());
  if (row.id !== undefined) await deps.journal.setKind(row.id, verdict);
  return verdict;
}
