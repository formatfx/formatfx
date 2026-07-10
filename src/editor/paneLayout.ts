// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sam Yost. FormatFX is dual-licensed: AGPL-3.0-only (see LICENSE) or a commercial license (see LICENSING.md).

/**
 * editor/paneLayout.ts — pane-state decisions for the app shell's grid
 * (spec 2026-07-10: JSON maximize, edit-pane bar, per-pane remembered state).
 * Pure decisions here; main.ts owns the DOM.
 *
 * Every pane keeps its MODE apart from its remembered SIZE: maximizing the
 * JSON pane never overwrites its dragged width, minimizing the edit pane
 * never overwrites its width, and reopening a pane restores both. The modes
 * persist as ADDITIVE fields inside the frozen `wb-ui-prefs` blob (the
 * canvasZoom precedent) — corrupt or legacy values sanitize to defaults.
 */

export type SideMode = 'normal' | 'max';
export type LeftMode = 'normal' | 'bar';

/** The minimized edit pane strip — wide enough to click, slim enough to ignore. */
export const LEFT_BAR_W = 28;
export const RESIZER_W = 5;
/** The JSON pane never squeezes below this, dragged or clamped. */
export const SIDE_MIN_W = 220;
/** The canvas floor in normal mode — dragging past it snaps to maximized
 *  instead of leaving a squished, useless preview. Deliberately narrow:
 *  makers build genuinely narrow formatters, so the floor only guards
 *  against a sliver, not a small canvas (owner call 2026-07-10, lowered
 *  420 → 200 owner call 2026-07-10 #2). */
export const CANVAS_MIN_W = 200;
/** How far past the ceiling the pointer must overshoot before the snap. */
export const SNAP_MARGIN = 40;
export const LEFT_MIN_W = 280;
export const LEFT_MAX_W = 640;
export const LEFT_DEFAULT_W = 360;

export function sanitizeSideMode(v: unknown): SideMode {
  return v === 'max' ? 'max' : 'normal';
}
export function sanitizeLeftMode(v: unknown): LeftMode {
  return v === 'bar' ? 'bar' : 'normal';
}
export function sanitizeLeftW(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : LEFT_DEFAULT_W;
}

/** The edit pane's drag band: [280, 640], but never more than 45% of the
 *  layout so the canvas + JSON pane always keep the majority. */
export function clampLeftW(w: number, layoutW: number): number {
  const cap = Math.min(LEFT_MAX_W, Math.floor(layoutW * 0.45));
  return Math.max(Math.min(LEFT_MIN_W, cap), Math.min(cap, Math.round(w)));
}

/** The left grid column as rendered: the bar, or the clamped pane width. */
export function leftColW(mode: LeftMode, leftW: number, layoutW: number): number {
  return mode === 'bar' ? LEFT_BAR_W : clampLeftW(sanitizeLeftW(leftW), layoutW);
}

/** The JSON pane's normal-mode ceiling: everything the left column, the two
 *  drag handles and a workable canvas don't need is the pane's to take. */
export function sideMaxW(layoutW: number, leftCol: number): number {
  return Math.max(SIDE_MIN_W, layoutW - leftCol - 2 * RESIZER_W - CANVAS_MIN_W);
}

export interface SideDrag { mode: SideMode; w: number }

/**
 * One pointer-move of the JSON pane's drag handle. Hysteresis around the
 * ceiling: overshoot by SNAP_MARGIN → maximized; come back under the
 * ceiling → normal, tracking the pointer; the band in between keeps the
 * current mode with the width pinned at the ceiling, so the snap never
 * flickers at the boundary.
 */
export function dragSide(proposedW: number, maxW: number, current: SideMode): SideDrag {
  if (proposedW >= maxW + SNAP_MARGIN) return { mode: 'max', w: maxW };
  if (proposedW < maxW) return { mode: 'normal', w: Math.max(SIDE_MIN_W, Math.round(proposedW)) };
  return { mode: current, w: maxW };
}

export interface PaneView {
  jsonOpen: boolean;
  sideMode: SideMode;
  leftMode: LeftMode;
  leftW: number;
  sideW: number;
  layoutW: number;
}

export interface PaneGrid {
  /** grid-template-columns for the VISIBLE members only — display:none grid
   *  children take no track, so the template always matches what shows. */
  template: string;
  /** Maximized: the whole center section (canvas, fx bar, data dock) hides. */
  centerHidden: boolean;
  /** The edit pane's drag handle — only when the pane is a real column. */
  leftResizer: boolean;
  /** The JSON pane's drag handle — stays in max mode (drag-out + dbl-click). */
  sideResizer: boolean;
}

export function paneGridTemplate(view: PaneView): PaneGrid {
  const left = leftColW(view.leftMode, view.leftW, view.layoutW);
  const maxed = view.jsonOpen && view.sideMode === 'max';
  const leftResizer = view.leftMode === 'normal' && !maxed;
  const cols: string[] = [`${left}px`];
  if (leftResizer) cols.push(`${RESIZER_W}px`);
  if (!view.jsonOpen) {
    cols.push('1fr');
    return { template: cols.join(' '), centerHidden: false, leftResizer, sideResizer: false };
  }
  if (maxed) {
    cols.push(`${RESIZER_W}px`, '1fr');
    return { template: cols.join(' '), centerHidden: true, leftResizer, sideResizer: true };
  }
  // clamp for display only — the saved pref keeps its value for roomier windows
  const side = Math.max(SIDE_MIN_W, Math.min(view.sideW, sideMaxW(view.layoutW, left)));
  cols.push('1fr', `${RESIZER_W}px`, `${side}px`);
  return { template: cols.join(' '), centerHidden: false, leftResizer, sideResizer: true };
}
