// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sam Yost. FormatFX is dual-licensed: AGPL-3.0-only (see LICENSE) or a commercial license (see LICENSING.md).

/**
 * editor/jsonFold.ts — the pure fold layer for the JSON pane (spec
 * docs/superpowers/specs/2026-07-09-json-pane-ide-design.md §3).
 *
 * A fold is a CUT: a full-text range covering a node's interior lines,
 * elided to the ` ⋯ ` sentinel in the displayed (folded) text. Placeholders
 * keep the real opener, closer and trailing comma — `"style": { ⋯ },` — so
 * folded text stays bracket-balanced and every tolerant scanner
 * (completions, signature hints, assists) keeps working on it.
 *
 * The FoldView bimap is exact outside cuts and clamps inside them; the
 * panel owns WHICH paths are folded and when the view exists at all (clean
 * buffers only — edits always expand first, so undo and folds never meet).
 */

export const FOLD_SENTINEL = ' ⋯ ';

export interface FoldCut { start: number; end: number }

export interface FoldView {
  /** The folded display text (what the textarea shows). */
  text: string;
  /** The active cuts, sorted, in FULL-text coordinates. */
  cuts: FoldCut[];
  /** Folded offset → full offset; sentinel interiors map to their cut start. */
  toFull(folded: number): number;
  /** Full offset → folded offset; offsets inside a cut clamp to its folded start. */
  toFolded(full: number): number;
  /** Index of the cut whose sentinel INTERIOR contains this folded offset
   *  (exclusive ends: only a caret landing within the ` ⋯ ` glyphs counts —
   *  clicking the adjacent braces must not read as clicking the fold), or -1. */
  cutIndexAtFolded(folded: number): number;
}

/**
 * The cut for a node range (its opening bracket through its closing bracket,
 * half-open): from the opening line's end (\n offset) to the closing line's
 * first non-whitespace character. Null when the node renders on one line.
 */
export function cutForRange(text: string, range: { start: number; end: number }): FoldCut | null {
  const openLineEnd = text.indexOf('\n', range.start);
  if (openLineEnd === -1 || openLineEnd >= range.end - 1) return null; // single line
  const closeLineStart = text.lastIndexOf('\n', range.end - 1) + 1;
  if (closeLineStart <= openLineEnd) return null;
  let i = closeLineStart;
  while (i < text.length && (text[i] === ' ' || text[i] === '\t')) i++;
  return { start: openLineEnd, end: i };
}

/** Keep only cuts not contained in an earlier (outer) one. Node-derived cuts
 *  nest properly, so containment is the only overlap shape. */
export function outermost(cuts: FoldCut[]): FoldCut[] {
  const sorted = [...cuts].sort((a, b) => a.start - b.start || b.end - a.end);
  const out: FoldCut[] = [];
  for (const c of sorted) {
    const last = out[out.length - 1];
    if (last && c.start >= last.start && c.end <= last.end) continue;
    out.push(c);
  }
  return out;
}

interface Mark { fullStart: number; fullEnd: number; foldedStart: number }

/** Splice the cuts down to sentinels and build the offset bimap. */
export function buildFoldView(fullText: string, cuts: FoldCut[]): FoldView {
  const sorted = outermost(cuts);
  const parts: string[] = [];
  const marks: Mark[] = [];
  let pos = 0;
  let folded = 0;
  for (const c of sorted) {
    parts.push(fullText.slice(pos, c.start));
    folded += c.start - pos;
    marks.push({ fullStart: c.start, fullEnd: c.end, foldedStart: folded });
    parts.push(FOLD_SENTINEL);
    folded += FOLD_SENTINEL.length;
    pos = c.end;
  }
  parts.push(fullText.slice(pos));
  const text = parts.join('');

  const toFolded = (full: number): number => {
    let delta = 0;
    for (const m of marks) {
      if (full <= m.fullStart) break;
      if (full < m.fullEnd) return m.foldedStart;
      delta += (m.fullEnd - m.fullStart) - FOLD_SENTINEL.length;
    }
    return full - delta;
  };
  const toFull = (fo: number): number => {
    let delta = 0;
    for (const m of marks) {
      if (fo <= m.foldedStart) break;
      if (fo < m.foldedStart + FOLD_SENTINEL.length) return m.fullStart;
      delta += (m.fullEnd - m.fullStart) - FOLD_SENTINEL.length;
    }
    return fo + delta;
  };
  const cutIndexAtFolded = (fo: number): number => {
    for (let k = 0; k < marks.length; k++) {
      // strict interior: a caret at the sentinel's boundary sits against the
      // opener/closer the user actually clicked — not on the fold itself
      if (fo > marks[k].foldedStart && fo < marks[k].foldedStart + FOLD_SENTINEL.length) return k;
    }
    return -1;
  };

  return { text, cuts: sorted, toFolded, toFull, cutIndexAtFolded };
}

/** FULL-text line number (0-based) of a folded line's first character —
 *  powers the gutter's gapped numbering. Linear scans; buffers are a few KB. */
export function fullLineOfFoldedLine(view: FoldView, fullText: string, foldedLine: number): number {
  let off = 0;
  for (let l = 0; l < foldedLine; l++) {
    const nl = view.text.indexOf('\n', off);
    if (nl === -1) break;
    off = nl + 1;
  }
  const full = view.toFull(off);
  let line = 0;
  for (let i = 0; i < full; i++) if (fullText[i] === '\n') line++;
  return line;
}
