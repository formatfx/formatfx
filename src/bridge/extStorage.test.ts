/**
 * extStorage.test.ts — pins the companion extension's chrome.storage.local
 * schema (extension/src/staging.ts) and the popup/web ⇄ background message
 * vocabulary (extension/src/bgProtocol.ts). Pure modules, tested from the
 * root suite like pageKind.test.ts.
 */
import { describe, it, expect } from 'vitest';
import {
  STAGE_KEY, PUSH_KEY, SCHEMA_KEY, SCHEMA_VERSION, BACKUPS_KEY, BACKUPS_CAP,
  migrateStorage,
} from '../../extension/src/staging';
import {
  isFormatfxTabHello, isRefreshSnapshotRequest, isSpTabsQuery,
} from '../../extension/src/bgProtocol';

describe('extension storage schema (staging.ts)', () => {
  it('keeps the frozen key names', () => {
    // These strings are contracts with deployed extensions — never rename.
    expect(STAGE_KEY).toBe('formatfx.stagedApply');
    expect(PUSH_KEY).toBe('formatfx.pushedSnapshot');
    expect(SCHEMA_KEY).toBe('formatfx.schemaVersion');
    expect(BACKUPS_KEY).toBe('formatfx.backups');
    expect(BACKUPS_CAP).toBe(20);
  });

  it('stamps unversioned storage to the current schema version', () => {
    const changes = migrateStorage({});
    expect(changes).toEqual({ [SCHEMA_KEY]: SCHEMA_VERSION });
  });

  it('preserves pre-versioning staged/pushed entries untouched (stamp only)', () => {
    const staged = { payload: { formatfx: 'apply', version: 1, targets: [] }, stagedAt: 'x' };
    const pushed = { snapshotJson: '{}', pushedAt: 'y' };
    const current = { [STAGE_KEY]: staged, [PUSH_KEY]: pushed };
    const changes = migrateStorage(current);
    // migration returns only what to write back — existing entries are valid v1
    expect(changes).toEqual({ [SCHEMA_KEY]: SCHEMA_VERSION });
    expect(current[STAGE_KEY]).toBe(staged); // input not mutated
    expect(current[PUSH_KEY]).toBe(pushed);
  });

  it('is idempotent on already-current storage', () => {
    expect(migrateStorage({ [SCHEMA_KEY]: SCHEMA_VERSION })).toEqual({});
  });

  it('leaves a future (newer) schema alone rather than downgrading it', () => {
    expect(migrateStorage({ [SCHEMA_KEY]: SCHEMA_VERSION + 1 })).toEqual({});
  });
});

describe('background message vocabulary (bgProtocol.ts)', () => {
  it('recognises well-formed messages', () => {
    expect(isFormatfxTabHello({ type: 'formatfxTabHello' })).toBe(true);
    expect(isRefreshSnapshotRequest({ type: 'refreshSnapshot', siteUrl: 'https://contoso.sharepoint.com' })).toBe(true);
    expect(isSpTabsQuery({ type: 'spTabsQuery' })).toBe(true);
  });

  it('rejects malformed or foreign messages', () => {
    expect(isFormatfxTabHello(null)).toBe(false);
    expect(isFormatfxTabHello({ type: 'other' })).toBe(false);
    expect(isRefreshSnapshotRequest({ type: 'refreshSnapshot' })).toBe(false); // no siteUrl
    expect(isRefreshSnapshotRequest({ type: 'refreshSnapshot', siteUrl: '' })).toBe(false);
    expect(isSpTabsQuery('spTabsQuery')).toBe(false);
  });
});
