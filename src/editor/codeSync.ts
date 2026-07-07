// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sam Yost. FormatFX is dual-licensed: AGPL-3.0-only (see LICENSE) or a commercial license (see LICENSING.md).

/**
 * editor/codeSync.ts — pure logic for the bi-directional code/canvas sync
 * (#218): caret preservation across regenerated JSON, the echo guard that
 * keeps selection sync from looping, and the line math behind scroll/flash.
 *
 * DOM-free on purpose — unit-tested directly (codeSync.test.ts); the
 * textarea shell that drives it lives in editor/jsonPanel.ts. Sync is a VIEW
 * concern: nothing in this module (or its callers' sync paths) ever touches
 * the undo stack.
 */

/**
 * Re-place a caret offset from `oldText` into `newText` after a regenerate:
 * offsets in the common prefix stay put, offsets in the common suffix shift
 * by the length delta, and a caret INSIDE the changed region lands at the end
 * of the replacement (the nearest stable anchor). Because the serializer is
 * deterministic, a single visual edit changes one contiguous region and every
 * other caret position survives exactly.
 */
export function preserveCaret(oldText: string, newText: string, offset: number): number {
  const o = Math.max(0, Math.min(offset, oldText.length));
  if (oldText === newText) return o;
  const max = Math.min(oldText.length, newText.length);
  let prefix = 0;
  while (prefix < max && oldText[prefix] === newText[prefix]) prefix++;
  let suffix = 0;
  while (suffix < max - prefix
    && oldText[oldText.length - 1 - suffix] === newText[newText.length - 1 - suffix]) suffix++;
  if (o <= prefix) return o;
  if (o >= oldText.length - suffix) return o + (newText.length - oldText.length);
  return newText.length - suffix;
}

/** 0-based first/last line of the [start, end) character range in `text`. */
export function lineSpanOf(text: string, start: number, end: number): { first: number; last: number } {
  return {
    first: lineOfOffset(text, start),
    last: lineOfOffset(text, Math.max(start, end - 1)),
  };
}

/** 0-based line number of a character offset (clamped into the text). */
export function lineOfOffset(text: string, offset: number): number {
  const upto = Math.max(0, Math.min(offset, text.length));
  let n = 0;
  for (let i = 0; i < upto; i++) if (text[i] === '\n') n++;
  return n;
}

/**
 * The echo guard: tags state changes with their origin for the duration of
 * the SYNCHRONOUS notify cycle, so a subscriber can tell "this selection came
 * from my own surface" apart from "this came from the canvas/tree/lint".
 *
 *     echo.run('code', () => state.select(path));   // the origin side
 *     if (echo.from('code')) return;                // the subscriber side
 *
 * state.emit runs listeners synchronously, so the flag is reliably visible to
 * every subscriber and reliably cleared afterwards (finally) — including on
 * re-entrancy and thrown listeners. No timers, no stale flags.
 */
export class SyncEcho {
  private source: string | null = null;

  run<T>(source: string, fn: () => T): T {
    const prev = this.source;
    this.source = source;
    try {
      return fn();
    } finally {
      this.source = prev;
    }
  }

  from(source: string): boolean {
    return this.source === source;
  }
}
