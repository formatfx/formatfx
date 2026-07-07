// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sam Yost. FormatFX is dual-licensed: AGPL-3.0 (see LICENSE) or a commercial license (see LICENSING.md).

/**
 * bridge/applyPayload.ts — the FormatFX "apply" wire format (v1).
 *
 * The reverse of the List Snapshot (docs/CONNECTIVITY.md §3.1): instead of
 * pulling a list's formatting out, this carries one or more formatters TO
 * be written back onto a list's columns/views. It is what FormatFX puts on
 * the clipboard for the companion extension to read on a SharePoint list
 * tab, and the natural payload for a future batched Tier-0 deploy snippet.
 *
 * Like the snapshot: versioned from day one (a version newer than we
 * understand gets a friendly refusal, never a silent misread), and every
 * `formatterJson` stays a RAW string end to end — sanitized but NOT
 * csom-escaped, exactly as REST stores it. Pure module, node-tested.
 */

export const APPLY_PAYLOAD_VERSION = 1;

/** One write: a single column's or view's CustomFormatter. */
export interface ApplyTarget {
  /** A column (field) or a (shared) view. */
  target: 'field' | 'view';
  /** Field INTERNAL name, or the view's exact title. */
  name: string;
  /** The formatter JSON as a raw string (lint-clean, NOT csom-escaped). */
  formatterJson: string;
}

export interface ApplyPayload {
  /** Discriminator — mirrors the snapshot's `formatfx: 'list-snapshot'`. */
  formatfx: 'apply';
  version: number;
  /** When the payload was built (informational, like snapshot.capturedAt). */
  capturedAt?: string;
  /** Cross-list target on the same web; omitted = the list the tab shows. */
  listTitle?: string;
  /** One or more formatters to write. A "group of columns" is just many. */
  targets: ApplyTarget[];
}

export function isApplyPayload(parsed: unknown): parsed is Record<string, unknown> {
  return !!parsed && typeof parsed === 'object'
    && (parsed as Record<string, unknown>)['formatfx'] === 'apply';
}

/** Build a payload (clipboard producer side). Order is preserved. */
export function buildApplyPayload(
  targets: ApplyTarget[],
  opts: { listTitle?: string } = {},
): ApplyPayload {
  if (!targets.length) throw new Error('Nothing to apply — pick at least one column or view.');
  return {
    formatfx: 'apply',
    version: APPLY_PAYLOAD_VERSION,
    capturedAt: new Date().toISOString(),
    ...(opts.listTitle ? { listTitle: opts.listTitle } : {}),
    targets: targets.map((t) => ({ target: t.target, name: t.name, formatterJson: t.formatterJson })),
  };
}

export function serializeApplyPayload(payload: ApplyPayload): string {
  return JSON.stringify(payload, null, 1);
}

/**
 * Parse + validate an apply payload from clipboard text. Every failure is a
 * teaching error (the consumer surfaces it verbatim), never a silent skip.
 */
export function parseApplyPayload(text: string): ApplyPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('That clipboard text is not FormatFX apply data — copy "Apply with extension" from FormatFX first.');
  }
  if (!isApplyPayload(parsed)) {
    throw new Error('That clipboard text is not a FormatFX apply payload (no "apply" marker) — copy "Apply with extension" from FormatFX first.');
  }
  const p = parsed as Record<string, unknown>;
  const version = Number(p.version ?? 0);
  if (version > APPLY_PAYLOAD_VERSION) {
    throw new Error(`This apply payload is version ${version}, newer than this extension understands (v${APPLY_PAYLOAD_VERSION}) — update the FormatFX extension and copy it again.`);
  }
  const rawTargets = p.targets;
  if (!Array.isArray(rawTargets) || rawTargets.length === 0) {
    throw new Error('This apply payload has no targets — re-copy it from FormatFX.');
  }
  const targets: ApplyTarget[] = rawTargets.map((rt, i) => {
    const t = rt as Record<string, unknown>;
    if (t.target !== 'field' && t.target !== 'view') {
      throw new Error(`Apply target #${i + 1} is neither a column nor a view — re-copy it from FormatFX.`);
    }
    if (typeof t.name !== 'string' || !t.name) {
      throw new Error(`Apply target #${i + 1} is missing a column/view name — re-copy it from FormatFX.`);
    }
    if (typeof t.formatterJson !== 'string' || !t.formatterJson) {
      throw new Error(`Apply target "${String(t.name)}" carries no formatter — re-copy it from FormatFX.`);
    }
    return { target: t.target, name: t.name, formatterJson: t.formatterJson };
  });
  return {
    formatfx: 'apply',
    version,
    capturedAt: typeof p.capturedAt === 'string' ? p.capturedAt : undefined,
    listTitle: typeof p.listTitle === 'string' ? p.listTitle : undefined,
    targets,
  };
}
