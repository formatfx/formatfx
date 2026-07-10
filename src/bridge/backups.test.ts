/**
 * backups.test.ts — the pre-apply backup & restore logic
 * (extension/src/backups.ts): bounded history, restore payloads (including
 * clear targets for previously-empty formatters), display lines.
 */
import { describe, it, expect } from 'vitest';
import { makeBackupEntry, pushBounded, restorePayloadFrom, describeEntry } from '../../extension/src/backups';
import type { BackupEntry, BackupsFile } from '../../extension/src/staging';
import { parseApplyPayload, serializeApplyPayload } from './applyPayload';

const entryAt = (takenAt: string): BackupEntry => makeBackupEntry(
  'https://contoso.sharepoint.com', 'Projects',
  [
    { target: 'field', name: 'Status', formatter: '{"elmType":"div"}' },
    { target: 'view', name: 'All Items', formatter: null },
  ],
  takenAt,
);

describe('makeBackupEntry', () => {
  it('records site, label, time and every target verbatim', () => {
    const e = entryAt('2026-07-10T12:00:00Z');
    expect(e.siteUrl).toBe('https://contoso.sharepoint.com');
    expect(e.listLabel).toBe('Projects');
    expect(e.takenAt).toBe('2026-07-10T12:00:00Z');
    expect(e.targets).toEqual([
      { target: 'field', name: 'Status', formatter: '{"elmType":"div"}' },
      { target: 'view', name: 'All Items', formatter: null },
    ]);
  });
});

describe('pushBounded', () => {
  it('prepends (newest first) and starts a file when there is none', () => {
    const file = pushBounded(undefined, entryAt('t1'));
    const file2 = pushBounded(file, entryAt('t2'));
    expect(file2.entries.map((e) => e.takenAt)).toEqual(['t2', 't1']);
  });

  it('evicts the oldest past the cap', () => {
    let file: BackupsFile | undefined;
    for (let i = 1; i <= 25; i++) file = pushBounded(file, entryAt(`t${i}`), 20);
    expect(file!.entries).toHaveLength(20);
    expect(file!.entries[0].takenAt).toBe('t25');   // newest kept
    expect(file!.entries[19].takenAt).toBe('t6');   // t1..t5 evicted
  });
});

describe('restorePayloadFrom', () => {
  it('rebuilds formatters verbatim and turns previously-empty targets into clears', () => {
    const p = restorePayloadFrom(entryAt('t'));
    expect(p.targets).toEqual([
      { target: 'field', name: 'Status', formatterJson: '{"elmType":"div"}' },
      { target: 'view', name: 'All Items', formatterJson: '', clear: true },
    ]);
    expect(p.version).toBe(2); // a clear rides along → minimal version says 2
  });

  it('emits v1 when every target had a formatter (no clear needed)', () => {
    const e = makeBackupEntry('s', 'L', [{ target: 'field', name: 'A', formatter: '{}' }], 't');
    expect(restorePayloadFrom(e).version).toBe(1);
  });

  it('round-trips through the same parse the apply pipeline uses', () => {
    // the restore payload rides the normal serialize → parse → apply path
    const back = parseApplyPayload(serializeApplyPayload(restorePayloadFrom(entryAt('t'))));
    expect(back.targets[1]).toEqual({ target: 'view', name: 'All Items', formatterJson: '', clear: true });
  });
});

describe('describeEntry', () => {
  it('names up to three targets and counts the rest', () => {
    expect(describeEntry(entryAt('t'))).toBe('Projects: [Status], "All Items"');
    const big = makeBackupEntry('s', 'L', [
      { target: 'field', name: 'A', formatter: '{}' },
      { target: 'field', name: 'B', formatter: '{}' },
      { target: 'field', name: 'C', formatter: '{}' },
      { target: 'field', name: 'D', formatter: '{}' },
    ], 't');
    expect(describeEntry(big)).toBe('L: [A], [B], [C] +1 more');
  });
});
