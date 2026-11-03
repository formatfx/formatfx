// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Sam Yost

/**
 * lite/snap.ts — drag, resize and snap math for FormatFX Lite. Pure.
 *
 * Coordinates are card px (inside the card border). Snapping compares a
 * part's edges and centre against "lines": the card edges, the card centre,
 * the CARD_MARGIN insets, and every other part's edges and centre.
 */

import { CARD_MARGIN, MIN_SIZE, type Rect } from './model';

export type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

/** A guide to draw: a vertical line at x = at (axis 'x') or a horizontal one at y = at. */
export interface Guide { axis: 'x' | 'y'; at: number }

export interface Lines { xs: number[]; ys: number[] }

export function snapLines(inner: { w: number; h: number }, others: Rect[]): Lines {
  const m = CARD_MARGIN;
  return {
    xs: [0, m, inner.w / 2, inner.w - m, inner.w, ...others.flatMap((r) => [r.x, r.x + r.w / 2, r.x + r.w])],
    ys: [0, m, inner.h / 2, inner.h - m, inner.h, ...others.flatMap((r) => [r.y, r.y + r.h / 2, r.y + r.h])],
  };
}

export interface Snap { offset: number; at: number[] }

/**
 * Pick the snap for ONE axis. `edges` are the moving part's edge positions
 * on that axis (for a move: start, centre, end; for a resize: only the edge
 * being dragged). Returns how far to shift so an edge lands on a line, plus
 * every line that then lines up (each gets a guide), or null for no snap.
 *
 * This is the "feel" of the editor. The rule now: the nearest line within
 * the threshold wins, and a tie goes to the edge listed first.
 */
export function chooseSnap(edges: number[], lines: number[], threshold: number): Snap | null {
  let best: number | null = null;
  for (const e of edges) {
    for (const l of lines) {
      const d = l - e;
      if (Math.abs(d) <= threshold && (best === null || Math.abs(d) < Math.abs(best))) best = d;
    }
  }
  if (best === null) return null;
  const offset = best;
  const at = lines.filter((l) => edges.some((e) => Math.abs(e + offset - l) < 0.5));
  return { offset, at: [...new Set(at)] };
}

function guides(axis: 'x' | 'y', s: Snap | null): Guide[] {
  return (s?.at ?? []).map((at) => ({ axis, at }));
}

const round = (r: Rect): Rect => ({ x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) });

export function snapMove(r: Rect, lines: Lines, threshold: number): { rect: Rect; guides: Guide[] } {
  const sx = chooseSnap([r.x, r.x + r.w / 2, r.x + r.w], lines.xs, threshold);
  const sy = chooseSnap([r.y, r.y + r.h / 2, r.y + r.h], lines.ys, threshold);
  return {
    rect: round({ ...r, x: r.x + (sx?.offset ?? 0), y: r.y + (sy?.offset ?? 0) }),
    guides: [...guides('x', sx), ...guides('y', sy)],
  };
}

/** Apply a pointer delta to the edges a handle owns. The opposite edge stays put. */
export function resizeRect(start: Rect, handle: Handle, dx: number, dy: number, min = MIN_SIZE): Rect {
  let { x, y, w, h } = start;
  if (handle.includes('e')) w = Math.max(min, start.w + dx);
  if (handle.includes('s')) h = Math.max(min, start.h + dy);
  if (handle.includes('w')) { w = Math.max(min, start.w - dx); x = start.x + start.w - w; }
  if (handle.includes('n')) { h = Math.max(min, start.h - dy); y = start.y + start.h - h; }
  return { x, y, w, h };
}

export function snapResize(r: Rect, handle: Handle, lines: Lines, threshold: number, min = MIN_SIZE): { rect: Rect; guides: Guide[] } {
  let { x, y, w, h } = r;
  let sx: Snap | null = null, sy: Snap | null = null;
  if (handle.includes('e')) {
    sx = chooseSnap([x + w], lines.xs, threshold);
    if (sx) w = Math.max(min, w + sx.offset);
  } else if (handle.includes('w')) {
    sx = chooseSnap([x], lines.xs, threshold);
    if (sx && w - sx.offset >= min) { x += sx.offset; w -= sx.offset; }
  }
  if (handle.includes('s')) {
    sy = chooseSnap([y + h], lines.ys, threshold);
    if (sy) h = Math.max(min, h + sy.offset);
  } else if (handle.includes('n')) {
    sy = chooseSnap([y], lines.ys, threshold);
    if (sy && h - sy.offset >= min) { y += sy.offset; h -= sy.offset; }
  }
  return { rect: round({ x, y, w, h }), guides: [...guides('x', sx), ...guides('y', sy)] };
}

/** Arrow-key nudge: 1 px, or 10 px with Shift. */
export function nudge(r: Rect, key: string, big: boolean): Rect | null {
  const step = big ? 10 : 1;
  switch (key) {
    case 'ArrowLeft': return { ...r, x: r.x - step };
    case 'ArrowRight': return { ...r, x: r.x + step };
    case 'ArrowUp': return { ...r, y: r.y - step };
    case 'ArrowDown': return { ...r, y: r.y + step };
    default: return null;
  }
}
