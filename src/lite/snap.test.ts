// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Sam Yost

import { describe, it, expect } from 'vitest';
import { chooseSnap, snapLines, snapMove, resizeRect, snapResize, nudge } from './snap';

const inner = { w: 252, h: 234 };

describe('Lite snapping', () => {
  it('snaps the nearest edge within the threshold, and reports the guide', () => {
    const s = chooseSnap([14, 64, 114], [0, 16, 126, 236, 252], 4);
    expect(s).toEqual({ offset: 2, at: [16] });
  });

  it('does not snap past the threshold', () => {
    expect(chooseSnap([30], [0, 16, 252], 4)).toBeNull();
  });

  it('centres a part on the card when its middle is near the centre line', () => {
    const lines = snapLines(inner, []);
    const { rect, guides } = snapMove({ x: 74, y: 100, w: 100, h: 20 }, lines, 4);
    expect(rect.x).toBe(76); // 76 + 50 = 126 = card centre
    expect(guides).toContainEqual({ axis: 'x', at: 126 });
  });

  it('aligns to another part', () => {
    const lines = snapLines(inner, [{ x: 40, y: 50, w: 60, h: 30 }]);
    const { rect, guides } = snapMove({ x: 42, y: 120, w: 30, h: 10 }, lines, 4);
    expect(rect.x).toBe(40);
    expect(guides).toContainEqual({ axis: 'x', at: 40 });
  });

  it('resizes from any handle and keeps the opposite edge fixed', () => {
    const start = { x: 20, y: 20, w: 100, h: 40 };
    expect(resizeRect(start, 'se', 10, 5)).toEqual({ x: 20, y: 20, w: 110, h: 45 });
    expect(resizeRect(start, 'nw', 10, 5)).toEqual({ x: 30, y: 25, w: 90, h: 35 });
    expect(resizeRect(start, 'w', 500, 0, 4)).toEqual({ x: 116, y: 20, w: 4, h: 40 });
  });

  it('snaps only the dragged edge while resizing', () => {
    const lines = snapLines(inner, []);
    const { rect } = snapResize({ x: 16, y: 16, w: 218, h: 20 }, 'e', lines, 4);
    expect(rect).toEqual({ x: 16, y: 16, w: 220, h: 20 }); // right edge lands on the 16 px inset (236)
  });

  it('nudges by 1 px, or 10 px with Shift', () => {
    const r = { x: 5, y: 5, w: 10, h: 10 };
    expect(nudge(r, 'ArrowRight', false)).toEqual({ ...r, x: 6 });
    expect(nudge(r, 'ArrowUp', true)).toEqual({ ...r, y: -5 });
    expect(nudge(r, 'Enter', false)).toBeNull();
  });
});
