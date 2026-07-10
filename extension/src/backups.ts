/**
 * backups.ts — pre-apply backup & restore, pure logic. Before every apply the
 * popup reads each target's live formatter (spClient.readTargetFormatters)
 * and files it here as a timestamped entry in chrome.storage.local; the
 * popup's History section restores one by building an apply payload that
 * routes through the SAME backup-then-confirm-then-apply pipeline — so a
 * restore backs up what it overwrites, and a restore of a restore works.
 *
 * A target that had NO formatter before the apply restores as a `clear: true`
 * target (apply payload v2): restoring means putting things back exactly,
 * including "there was nothing here".
 */
import type { ApplyPayload } from '../../src/bridge/applyPayload';
import { buildApplyPayload } from '../../src/bridge/applyPayload';
import type { TargetFormatter } from '../../src/bridge/spClient';
import { BACKUPS_CAP, type BackupEntry, type BackupsFile } from './staging';

export function makeBackupEntry(
  siteUrl: string,
  listLabel: string,
  read: TargetFormatter[],
  takenAt: string,
): BackupEntry {
  return {
    siteUrl,
    listLabel,
    takenAt,
    targets: read.map((r) => ({ target: r.target, name: r.name, formatter: r.formatter })),
  };
}

/** Newest first, bounded: the oldest entries fall off past the cap. */
export function pushBounded(file: BackupsFile | undefined, entry: BackupEntry, cap = BACKUPS_CAP): BackupsFile {
  const entries = [entry, ...(file?.entries ?? [])].slice(0, cap);
  return { entries };
}

/**
 * The apply payload that puts a backup's targets back exactly as recorded.
 * Previously-empty targets become clear targets (v2) — the payload version
 * is computed minimally by buildApplyPayload.
 */
export function restorePayloadFrom(entry: BackupEntry): ApplyPayload {
  return buildApplyPayload(entry.targets.map((t) => (
    t.formatter === null
      ? { target: t.target, name: t.name, formatterJson: '', clear: true as const }
      : { target: t.target, name: t.name, formatterJson: t.formatter }
  )));
}

/** One line for the popup's History list. */
export function describeEntry(entry: BackupEntry): string {
  const names = entry.targets.map((t) => (t.target === 'field' ? `[${t.name}]` : `"${t.name}"`));
  const shown = names.slice(0, 3).join(', ') + (names.length > 3 ? ` +${names.length - 3} more` : '');
  return `${entry.listLabel}: ${shown}`;
}
