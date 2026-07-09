// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sam Yost. FormatFX is dual-licensed: AGPL-3.0-only (see LICENSE) or a commercial license (see LICENSING.md).

/**
 * editor/jsonDecorations.ts — squiggle decorations for the JSON pane (spec
 * docs/superpowers/specs/2026-07-09-json-pane-ide-design.md §5).
 *
 * Two sources merge into one positioned list: positioned parse errors from
 * core/jsonText (char-precise, live while typing) and lintDocument issues
 * (node-addressed → the element's OPENING LINE only, so a style warning
 * doesn't paint a whole subtree red — the lint footer stays the detail
 * view). The renderer emits a SEPARATE overlay layer: same text, transparent
 * glyphs, only wavy text-decorations visible — so the main highlight layer's
 * lossless invariant is never involved.
 */

import type { LintIssue } from '../core/linter';
import { rangeForPath, type JsonRange } from '../core/jsonMap';
import type { TextParseError } from '../core/jsonText';
import { escapeHtml } from './jsonHighlight';

export type DecorationKind = 'err' | 'warning' | 'info';
export interface Decoration { start: number; end: number; kind: DecorationKind; message: string }

const SEV_RANK: Record<DecorationKind, number> = { err: 3, warning: 2, info: 1 };
const LINT_KIND: Record<string, DecorationKind> = { error: 'err', warning: 'warning', info: 'info' };

/** Merge parse errors (char-precise) and lint issues (opening line of the
 *  element at the issue's path) into one sorted decoration list. */
export function decorationsFrom(
  parseErrors: TextParseError[],
  lintIssues: LintIssue[],
  ranges: JsonRange[],
  text: string,
): Decoration[] {
  const out: Decoration[] = [];
  for (const e of parseErrors) {
    let { start, end } = e;
    if (end <= start) {
      // zero-width (e.g. "unexpected end of JSON" at EOF): widen to one
      // visible character so the wavy underline has glyphs to ride
      if (start >= text.length && start > 0) start = text.length - 1;
      end = Math.min(start + 1, text.length);
      if (end <= start) continue; // empty buffer — nothing to underline
    }
    out.push({ start, end, kind: 'err', message: e.message });
  }
  for (const issue of lintIssues) {
    const r = rangeForPath(ranges, issue.path);
    if (!r) continue; // stale path — the footer still lists it
    const nl = text.indexOf('\n', r.start);
    const end = nl === -1 || nl > r.end ? r.end : nl;
    out.push({
      start: r.start,
      end,
      kind: LINT_KIND[issue.severity] ?? 'info',
      message: `${issue.rule}: ${issue.message}`,
    });
  }
  return out.sort((a, b) => a.start - b.start || a.end - b.end);
}

/** The highest-severity decoration containing `offset` (half-open), or null. */
export function decorationAt(decorations: Decoration[], offset: number): Decoration | null {
  let best: Decoration | null = null;
  for (const d of decorations) {
    if (offset < d.start || offset >= d.end) continue;
    if (!best || SEV_RANK[d.kind] > SEV_RANK[best.kind]) best = d;
  }
  return best;
}

/**
 * The squiggle layer's HTML: the buffer text verbatim (escaped), wrapped in
 * `wb-sq-KIND` spans where decorations apply — overlaps flatten to the
 * highest severity per segment. Same trailing-line pad rule as the highlight
 * layer so the layers never shear on the final line.
 */
export function renderSquigglesHtml(text: string, decorations: Decoration[]): string {
  const points = new Set<number>([0, text.length]);
  for (const d of decorations) {
    points.add(Math.max(0, Math.min(d.start, text.length)));
    points.add(Math.max(0, Math.min(d.end, text.length)));
  }
  const cuts = [...points].sort((a, b) => a - b);
  const out: string[] = [];
  for (let k = 0; k + 1 < cuts.length; k++) {
    const s = cuts[k];
    const e = cuts[k + 1];
    if (e <= s) continue;
    const d = decorationAt(decorations, s);
    const slice = escapeHtml(text.slice(s, e));
    out.push(d ? `<span class="wb-sq-${d.kind}">${slice}</span>` : slice);
  }
  if (text.endsWith('\n') || text === '') out.push(' ');
  return out.join('');
}
