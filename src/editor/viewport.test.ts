/**
 * viewport.ts contracts — the pure brain behind the canvas view controls
 * (#216 zoom + #224 viewport width). Pure math/tables only: the DOM
 * plumbing is exercised in canvas.test (and templateModal.test drives the
 * modal scrubber that shares the drag math).
 */
import { describe, it, expect } from 'vitest';
import {
  ZOOM_MIN, ZOOM_MAX, ZOOM_STOPS, clampZoom, stepZoom, zoomLabel,
  MIN_STAGE_WIDTH, MAX_STAGE_WIDTH, clampDragWidth, commitDragWidth,
  VIEWPORT_PRESETS, sanitizeViewPrefs,
} from './viewport';
import { STAGE_WIDTHS } from './templateUi';

describe('zoom clamp (#216 — 25%…200%)', () => {
  it('clamps into range and passes valid values through', () => {
    expect(clampZoom(0.1)).toBe(ZOOM_MIN);
    expect(clampZoom(9)).toBe(ZOOM_MAX);
    expect(clampZoom(0.5)).toBe(0.5);
    expect(clampZoom(1)).toBe(1);
  });

  it('garbage (NaN/∞) lands back on 100%, never a broken transform', () => {
    expect(clampZoom(NaN)).toBe(1);
    expect(clampZoom(Infinity)).toBe(1);
    expect(clampZoom(-Infinity)).toBe(1);
  });
});

describe('zoom stops ladder', () => {
  it('is sorted, spans exactly MIN→MAX and includes 100%', () => {
    expect([...ZOOM_STOPS]).toEqual([...ZOOM_STOPS].sort((a, b) => a - b));
    expect(ZOOM_STOPS[0]).toBe(ZOOM_MIN);
    expect(ZOOM_STOPS[ZOOM_STOPS.length - 1]).toBe(ZOOM_MAX);
    expect(ZOOM_STOPS).toContain(1);
  });

  it('steps to the neighbouring stop and saturates at the ends', () => {
    expect(stepZoom(1, 1)).toBe(1.1);
    expect(stepZoom(1, -1)).toBe(0.9);
    expect(stepZoom(ZOOM_MAX, 1)).toBe(ZOOM_MAX);
    expect(stepZoom(ZOOM_MIN, -1)).toBe(ZOOM_MIN);
  });

  it('a value between stops (an old persisted zoom) snaps in the step direction', () => {
    expect(stepZoom(0.8, 1)).toBe(0.9);
    expect(stepZoom(0.8, -1)).toBe(0.75);
  });

  it('labels round to whole percent', () => {
    expect(zoomLabel(1)).toBe('100%');
    expect(zoomLabel(0.67)).toBe('67%');
    expect(zoomLabel(2)).toBe('200%');
  });
});

describe('viewport presets (#224 — representative, honestly approximate)', () => {
  it('pins the preset table: Fit (null) → Average 1420 → Half 860 → Phone 360', () => {
    expect(VIEWPORT_PRESETS.map((p) => [p.id, p.width])).toEqual([
      ['fit', null], ['average', 1420], ['half', 860], ['phone', 360],
    ]);
  });

  it('every numeric preset says "approximate" out loud (refuse-don\'t-guess)', () => {
    for (const p of VIEWPORT_PRESETS) {
      if (p.width !== null) expect(p.hint.toLowerCase()).toContain('approximate');
    }
  });

  it('widths are ordered, above the drag floor and inside the persist cap', () => {
    const widths = VIEWPORT_PRESETS.flatMap((p) => (p.width === null ? [] : [p.width]));
    expect([...widths]).toEqual([...widths].sort((a, b) => b - a));
    for (const w of widths) {
      expect(w).toBeGreaterThanOrEqual(MIN_STAGE_WIDTH);
      expect(w).toBeLessThanOrEqual(MAX_STAGE_WIDTH);
    }
  });

  it('the Phone preset matches the template modal\'s Narrow — one story on both surfaces', () => {
    const narrow = STAGE_WIDTHS.find(([label]) => label === 'Narrow')![1];
    expect(VIEWPORT_PRESETS.find((p) => p.id === 'phone')!.width).toBe(narrow);
  });
});

describe('drag width math (shared by the canvas handle and the modal scrubber)', () => {
  it('clamps between the stage floor and the container, rounding to whole px', () => {
    expect(clampDragWidth(100, 800)).toBe(MIN_STAGE_WIDTH);
    expect(clampDragWidth(900, 800)).toBe(800);
    expect(clampDragWidth(512.6, 800)).toBe(513);
  });

  it('committing at (or within 8px of) full width dissolves to null — full width is no constraint', () => {
    expect(commitDragWidth(800, 800)).toBeNull();
    expect(commitDragWidth(793, 800)).toBeNull();
    expect(commitDragWidth(791, 800)).toBe(791);
    expect(commitDragWidth(360, 800)).toBe(360);
  });
});

describe('persisted view prefs (additive inside wb-ui-prefs — never trusted)', () => {
  it('defaults when the blob is missing, foreign-typed or from an older version', () => {
    const defaults = { zoom: 1, viewportWidth: null };
    expect(sanitizeViewPrefs(undefined)).toEqual(defaults);
    expect(sanitizeViewPrefs(null)).toEqual(defaults);
    expect(sanitizeViewPrefs('garbage')).toEqual(defaults);
    expect(sanitizeViewPrefs({})).toEqual(defaults);
    expect(sanitizeViewPrefs({ zoom: 'big', viewportWidth: 'thin' })).toEqual(defaults);
  });

  it('clamps a persisted zoom and viewport width back into range', () => {
    expect(sanitizeViewPrefs({ zoom: 99 }).zoom).toBe(ZOOM_MAX);
    expect(sanitizeViewPrefs({ zoom: 0 }).zoom).toBe(ZOOM_MIN);
    expect(sanitizeViewPrefs({ viewportWidth: 5 }).viewportWidth).toBe(MIN_STAGE_WIDTH);
    expect(sanitizeViewPrefs({ viewportWidth: 99999 }).viewportWidth).toBe(MAX_STAGE_WIDTH);
    expect(sanitizeViewPrefs({ viewportWidth: NaN }).viewportWidth).toBeNull();
  });

  it('valid prefs survive a JSON round-trip unchanged (incl. the null = fit case)', () => {
    for (const raw of [{ zoom: 1.5, viewportWidth: 360 }, { zoom: 0.5, viewportWidth: null }]) {
      const prefs = sanitizeViewPrefs(raw);
      expect(sanitizeViewPrefs(JSON.parse(JSON.stringify(prefs)))).toEqual(prefs);
    }
  });

  it('drops unknown fields instead of echoing them back into the blob', () => {
    const out = sanitizeViewPrefs({ zoom: 1.25, viewportWidth: 860, legacyKnob: true });
    expect(Object.keys(out).sort()).toEqual(['viewportWidth', 'zoom']);
  });

  it('rides ADDITIVELY inside a wb-ui-prefs blob — sibling prefs pass through untouched (frozen-keys rule)', () => {
    // the main.ts pattern: defaults spread under the parsed blob
    const stored = JSON.parse(JSON.stringify({
      cols: { side: 420 }, dataMode: 'max', titleCol: false,
      canvasZoom: 1.25, canvasViewportW: 860,
    }));
    const merged = { canvasZoom: 1, canvasViewportW: null, ...stored };
    expect(merged.cols).toEqual({ side: 420 });       // untouched sibling
    expect(merged.dataMode).toBe('max');              // untouched sibling
    expect(sanitizeViewPrefs({ zoom: merged.canvasZoom, viewportWidth: merged.canvasViewportW }))
      .toEqual({ zoom: 1.25, viewportWidth: 860 });   // ours round-trips
  });
});
