/**
 * editor/snapshots.ts — the snapshot store brain (issue #140). Pure and
 * node-testable, like gridScaffold/areas/cfr: no state import, no DOM, no
 * direct localStorage — callers hand raw JSON in and get raw JSON back.
 *
 * A snapshot captures ONE thing, chosen by its scope:
 *   · { kind: 'column', field }     — one column formatter's tree
 *   · { kind: 'all' }               — the whole workspace: the floor grid,
 *                                     every named view sheet, and every
 *                                     registered column formatter
 * The scope KEY ('col:<field>' | 'all') partitions the store so the snapshot
 * menu lists only the history of what's selected, with the "everything" group
 * alongside — placement decides the primary action.
 *
 * Storage contract: the caller persists under STORAGE_KEY ('wb-snapshots.v1',
 * an ADDITIVE key — the frozen project/prefs keys stay frozen; deleting it
 * loses snapshots and nothing else). Each scope keeps at most CAP entries;
 * adding past the cap evicts the oldest of THAT scope only. Entries whose
 * shape predates FLOOR-AND-SHEETS Stage 1 (the old main-document 'view'
 * scope, the old doc-shaped 'all' payload) fail the load-time validity filter
 * and are dropped — a load guard, not a converter (no migration code).
 */

import type { FormatterDocument, SPElement } from '../core/types';

/** One named sheet inside an 'all' payload (mirrors editor/state SheetDoc —
 *  redeclared here so this module keeps zero editor imports). */
export interface SnapshotSheet { id: string; name: string; doc: FormatterDocument }

export type SnapshotScope =
  | { kind: 'column'; field: string }
  | { kind: 'all' };

/** What a snapshot holds, by scope kind (exactly one of these is set). */
export interface SnapshotPayload {
  /** column: that formatter's element tree. */
  root?: SPElement;
  /** all: the floor + the named view sheets + the registered column formatters. */
  all?: { floor: FormatterDocument; views: SnapshotSheet[]; columnRefs: Record<string, SPElement> };
}

export interface Snapshot {
  id: string;
  /** ISO timestamp of capture (display + eviction order). */
  takenAt: string;
  /** Human label, e.g. "View 1 — grid" or "Status column". */
  label: string;
  scope: SnapshotScope;
  payload: SnapshotPayload;
}

export interface SnapshotStore {
  version: 1;
  snapshots: Snapshot[];
}

/** ADDITIVE localStorage key — see the frozen-keys rule in docs/HANDOFF.md §1. */
export const STORAGE_KEY = 'wb-snapshots.v1';

/** Per-scope retention: adding the CAP+1th snapshot evicts that scope's oldest. */
export const CAP = 25;

/** The partition key a snapshot lives under. */
export function scopeKeyOf(scope: SnapshotScope): string {
  return scope.kind === 'column' ? `col:${scope.field}` : scope.kind;
}

/** A persisted scope is only trusted if it's one we actually write — an
 *  unknown or retired kind (foreign/corrupt/pre-Stage-1 data) must never
 *  reach applySnapshot. */
function isValidScope(s: unknown): s is SnapshotScope {
  if (!s || typeof s !== 'object') return false;
  const kind = (s as { kind?: unknown }).kind;
  if (kind === 'all') return true;
  return kind === 'column'
    && typeof (s as { field?: unknown }).field === 'string'
    && (s as { field: string }).field.length > 0;
}

/** The payload must match its scope's CURRENT shape — an old-format capture
 *  (e.g. a pre-Stage-1 'all' holding a single main document) is dropped here
 *  rather than failing at restore time. */
function isValidPayload(scope: SnapshotScope, p: unknown): p is SnapshotPayload {
  if (!p || typeof p !== 'object') return false;
  const payload = p as SnapshotPayload;
  if (scope.kind === 'column') return Boolean(payload.root?.elmType);
  return Boolean(payload.all?.floor?.root?.elmType) && Array.isArray(payload.all?.views);
}

/** Parse a persisted store; tolerate corrupt/missing/foreign data (fresh store). */
export function loadStore(raw: string | null): SnapshotStore {
  if (!raw) return { version: 1, snapshots: [] };
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.version !== 1 || !Array.isArray(parsed.snapshots)) {
      return { version: 1, snapshots: [] };
    }
    const snapshots = (parsed.snapshots as Snapshot[]).filter((s) =>
      s && typeof s.id === 'string' && typeof s.takenAt === 'string'
      && isValidScope(s.scope) && isValidPayload(s.scope, s.payload),
    );
    return { version: 1, snapshots };
  } catch {
    return { version: 1, snapshots: [] };
  }
}

export function serializeStore(store: SnapshotStore): string {
  return JSON.stringify(store);
}

/** Newest-first history of one scope. */
export function snapshotsFor(store: SnapshotStore, scope: SnapshotScope): Snapshot[] {
  const key = scopeKeyOf(scope);
  return store.snapshots
    .filter((s) => scopeKeyOf(s.scope) === key)
    .sort((a, b) => b.takenAt.localeCompare(a.takenAt));
}

/**
 * Add a snapshot, evicting the oldest of the SAME scope past the cap.
 * Returns a new store (the input is not mutated).
 */
export function addSnapshot(store: SnapshotStore, snap: Snapshot, cap: number = CAP): SnapshotStore {
  const key = scopeKeyOf(snap.scope);
  const snapshots = [...store.snapshots, snap];
  const scoped = snapshots
    .filter((s) => scopeKeyOf(s.scope) === key)
    .sort((a, b) => b.takenAt.localeCompare(a.takenAt));
  if (scoped.length <= cap) return { version: 1, snapshots };
  const evict = new Set(scoped.slice(cap).map((s) => s.id));
  return { version: 1, snapshots: snapshots.filter((s) => !evict.has(s.id)) };
}

/** Remove one snapshot by id. Returns a new store. */
export function removeSnapshot(store: SnapshotStore, id: string): SnapshotStore {
  return { version: 1, snapshots: store.snapshots.filter((s) => s.id !== id) };
}

/** Unique-enough id — time-ordered prefix plus a random suffix. */
export function snapshotId(now: Date): string {
  return `${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Default human label for a fresh snapshot. */
export function defaultLabel(scope: SnapshotScope, viewCount: number): string {
  if (scope.kind === 'column') return `${scope.field} column`;
  return viewCount === 0
    ? 'Grid + column formatters'
    : `Grid + ${viewCount} view${viewCount === 1 ? '' : 's'} + column formatters`;
}

/** Compact relative-time caption for the menu ("just now", "5m ago", "2d ago"). */
export function relativeTime(takenAt: string, now: Date): string {
  const then = Date.parse(takenAt);
  if (Number.isNaN(then)) return '';
  const s = Math.max(0, Math.floor((now.getTime() - then) / 1000));
  if (s < 45) return 'just now';
  if (s < 90) return '1m ago';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}
