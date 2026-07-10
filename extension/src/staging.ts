/**
 * staging.ts — the extension's chrome.storage.local schema, in one place.
 * Shared between web.ts (writer, on formatfx.dev), popup.ts and background.ts.
 * Its own file so each shell can import the keys/types without pulling in
 * another shell's side effects. Pure (no chrome APIs) so the root vitest
 * suite pins the shapes (src/bridge/extStorage.test.ts).
 *
 * Existing keys are frozen contracts: STAGE_KEY and PUSH_KEY shapes must
 * never change shape in place — evolve by adding keys and bumping
 * SCHEMA_VERSION with a migration step in migrateStorage().
 */
import type { ApplyPayload } from '../../src/bridge/applyPayload';

export const STAGE_KEY = 'formatfx.stagedApply';

export interface StagedApply {
  payload: ApplyPayload;
  stagedAt: string;
}

/**
 * Extract-push: a captured snapshot the popup hands off for an opening
 * formatfx.dev tab to pick up and auto-load. web.ts (on formatfx.dev) reads
 * it; nothing on a tenant ever touches it.
 */
export const PUSH_KEY = 'formatfx.pushedSnapshot';

export interface PushedSnapshot {
  snapshotJson: string;
  pushedAt: string;
}

// ── storage schema versioning ──────────────────────────────────────────────

/** Bump when a stored shape changes; add the migration to migrateStorage(). */
export const SCHEMA_VERSION = 1;
export const SCHEMA_KEY = 'formatfx.schemaVersion';

/**
 * Pre-apply backups (written by the popup before every apply, restored from
 * the popup's History section). Bounded — see BACKUPS_CAP.
 */
export const BACKUPS_KEY = 'formatfx.backups';
export const BACKUPS_CAP = 20;

/** One target's formatter as it was before an apply. null = had no formatter. */
export interface BackupTarget {
  target: 'field' | 'view';
  name: string;
  formatter: string | null;
}

export interface BackupEntry {
  /** The site the apply ran against (origin, for display + restore routing). */
  siteUrl: string;
  /** Human label for the list (best-effort, display only). */
  listLabel: string;
  takenAt: string;
  targets: BackupTarget[];
}

export interface BackupsFile {
  /** Newest first. */
  entries: BackupEntry[];
}

/**
 * Migrate raw chrome.storage.local contents to the current schema. Returns
 * only the keys to write back (empty object = nothing to do). v1 is a stamp:
 * pre-versioning STAGE/PUSH entries are already valid v1 shapes. Future
 * migrations chain here — never mutate the input.
 */
export function migrateStorage(current: Record<string, unknown>): Record<string, unknown> {
  const version = typeof current[SCHEMA_KEY] === 'number' ? (current[SCHEMA_KEY] as number) : 0;
  if (version >= SCHEMA_VERSION) return {};
  return { [SCHEMA_KEY]: SCHEMA_VERSION };
}
