/**
 * paneLayout.test.ts — the pane-state grid decisions (spec 2026-07-10):
 * the template always matches the visible grid members; drag past the
 * canvas floor snaps to maximized with hysteresis (no flicker at the
 * boundary); modes and sizes sanitize independently, so corrupt or legacy
 * wb-ui-prefs blobs land on defaults instead of breaking the shell.
 */
import { describe, it, expect } from 'vitest';
import {
  LEFT_BAR_W, RESIZER_W, SIDE_MIN_W, CANVAS_MIN_W, SNAP_MARGIN,
  LEFT_MIN_W, LEFT_MAX_W, LEFT_DEFAULT_W,
  sanitizeSideMode, sanitizeLeftMode, sanitizeLeftW,
  clampLeftW, leftColW, sideMaxW, dragSide, paneGridTemplate,
} from './paneLayout';

const LAYOUT_W = 1440;

describe('sanitizers (legacy / corrupt wb-ui-prefs)', () => {
  it('modes whitelist their two values, anything else is normal', () => {
    expect(sanitizeSideMode('max')).toBe('max');
    expect(sanitizeSideMode('normal')).toBe('normal');
    expect(sanitizeSideMode(undefined)).toBe('normal'); // legacy blob
    expect(sanitizeSideMode('huge')).toBe('normal');
    expect(sanitizeLeftMode('bar')).toBe('bar');
    expect(sanitizeLeftMode(42)).toBe('normal');
  });

  it('leftW takes finite numbers only, else the default', () => {
    expect(sanitizeLeftW(412)).toBe(412);
    expect(sanitizeLeftW('412')).toBe(LEFT_DEFAULT_W);
    expect(sanitizeLeftW(NaN)).toBe(LEFT_DEFAULT_W);
    expect(sanitizeLeftW(undefined)).toBe(LEFT_DEFAULT_W);
  });
});

describe('clampLeftW', () => {
  it('holds the drag band', () => {
    expect(clampLeftW(100, LAYOUT_W)).toBe(LEFT_MIN_W);
    expect(clampLeftW(9999, LAYOUT_W)).toBe(LEFT_MAX_W);
    expect(clampLeftW(400, LAYOUT_W)).toBe(400);
  });

  it('caps at 45% of a small layout, and the floor yields to the cap', () => {
    expect(clampLeftW(600, 1000)).toBe(450); // 45% of 1000 < LEFT_MAX_W
    expect(clampLeftW(500, 500)).toBe(225); // cap (225) below LEFT_MIN_W: cap wins
  });
});

describe('leftColW', () => {
  it('bar mode is the strip, regardless of remembered width', () => {
    expect(leftColW('bar', 500, LAYOUT_W)).toBe(LEFT_BAR_W);
  });
  it('normal mode is the clamped remembered width, sanitized first', () => {
    expect(leftColW('normal', 420, LAYOUT_W)).toBe(420);
    expect(leftColW('normal', Number.NaN, LAYOUT_W)).toBe(LEFT_DEFAULT_W);
  });
});

describe('sideMaxW', () => {
  it('reserves the left column, both handles and a workable canvas', () => {
    expect(sideMaxW(LAYOUT_W, 360)).toBe(LAYOUT_W - 360 - 2 * RESIZER_W - CANVAS_MIN_W);
  });
  it('never collapses below the pane minimum on tiny layouts', () => {
    expect(sideMaxW(600, 360)).toBe(SIDE_MIN_W);
  });
});

describe('dragSide (snap hysteresis)', () => {
  const MAX = 660;

  it('tracks the pointer under the ceiling', () => {
    expect(dragSide(400, MAX, 'normal')).toEqual({ mode: 'normal', w: 400 });
    expect(dragSide(400.4, MAX, 'normal')).toEqual({ mode: 'normal', w: 400 });
  });

  it('holds the pane width floor', () => {
    expect(dragSide(50, MAX, 'normal')).toEqual({ mode: 'normal', w: SIDE_MIN_W });
  });

  it('pins at the ceiling inside the band without changing mode', () => {
    expect(dragSide(MAX, MAX, 'normal')).toEqual({ mode: 'normal', w: MAX });
    expect(dragSide(MAX + SNAP_MARGIN - 1, MAX, 'normal')).toEqual({ mode: 'normal', w: MAX });
    // dragging OUT of max: the band keeps max until the pointer is back under
    expect(dragSide(MAX + 1, MAX, 'max')).toEqual({ mode: 'max', w: MAX });
  });

  it('snaps to max on overshoot, releases under the ceiling', () => {
    expect(dragSide(MAX + SNAP_MARGIN, MAX, 'normal')).toEqual({ mode: 'max', w: MAX });
    expect(dragSide(MAX - 1, MAX, 'max')).toEqual({ mode: 'normal', w: MAX - 1 });
  });
});

describe('paneGridTemplate', () => {
  const base = { leftW: 360, sideW: 360, layoutW: LAYOUT_W } as const;

  it('JSON closed: pane, handle, canvas', () => {
    expect(paneGridTemplate({ ...base, jsonOpen: false, sideMode: 'normal', leftMode: 'normal' }))
      .toEqual({ template: '360px 5px 1fr', centerHidden: false, leftResizer: true, sideResizer: false });
  });

  it('JSON open: both handles, both panes', () => {
    expect(paneGridTemplate({ ...base, jsonOpen: true, sideMode: 'normal', leftMode: 'normal' }))
      .toEqual({ template: '360px 5px 1fr 5px 360px', centerHidden: false, leftResizer: true, sideResizer: true });
  });

  it('maximized: center hidden, side handle stays for the way back', () => {
    expect(paneGridTemplate({ ...base, jsonOpen: true, sideMode: 'max', leftMode: 'normal' }))
      .toEqual({ template: '360px 5px 1fr', centerHidden: true, leftResizer: false, sideResizer: true });
  });

  it('max while closed is inert — the remembered mode waits for reopen', () => {
    expect(paneGridTemplate({ ...base, jsonOpen: false, sideMode: 'max', leftMode: 'normal' }))
      .toEqual({ template: '360px 5px 1fr', centerHidden: false, leftResizer: true, sideResizer: false });
  });

  it('bar mode swaps the pane for the strip and drops its handle', () => {
    expect(paneGridTemplate({ ...base, jsonOpen: false, sideMode: 'normal', leftMode: 'bar' }))
      .toEqual({ template: `${LEFT_BAR_W}px 1fr`, centerHidden: false, leftResizer: false, sideResizer: false });
    expect(paneGridTemplate({ ...base, jsonOpen: true, sideMode: 'normal', leftMode: 'bar' }))
      .toEqual({ template: `${LEFT_BAR_W}px 1fr 5px 360px`, centerHidden: false, leftResizer: false, sideResizer: true });
  });

  it('bar + maximized: strip, handle, pane — the JSON pane takes everything else', () => {
    expect(paneGridTemplate({ ...base, jsonOpen: true, sideMode: 'max', leftMode: 'bar' }))
      .toEqual({ template: `${LEFT_BAR_W}px 5px 1fr`, centerHidden: true, leftResizer: false, sideResizer: true });
  });

  it('display-clamps an oversized remembered width without mutating it', () => {
    const view = { ...base, sideW: 2000, jsonOpen: true, sideMode: 'normal', leftMode: 'normal' } as const;
    const ceiling = sideMaxW(LAYOUT_W, 360);
    expect(paneGridTemplate(view).template).toBe(`360px 5px 1fr 5px ${ceiling}px`);
  });
});
