/**
 * viewport.ts contracts — the pure brain behind the canvas view controls
 * (#216 zoom). Pure math only: the DOM plumbing is exercised in canvas.test.
 */
import { describe, it, expect } from 'vitest';
import {
  ZOOM_MIN, ZOOM_MAX, ZOOM_STOPS, clampZoom, stepZoom, zoomLabel,
  sanitizeViewPrefs,
} from './viewport';

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

describe('persisted view prefs (additive inside wb-ui-prefs — never trusted)', () => {
  it('defaults when the blob is missing, foreign-typed or from an older version', () => {
    expect(sanitizeViewPrefs(undefined)).toEqual({ zoom: 1 });
    expect(sanitizeViewPrefs(null)).toEqual({ zoom: 1 });
    expect(sanitizeViewPrefs('garbage')).toEqual({ zoom: 1 });
    expect(sanitizeViewPrefs({})).toEqual({ zoom: 1 });
    expect(sanitizeViewPrefs({ zoom: 'big' })).toEqual({ zoom: 1 });
  });

  it('clamps a persisted zoom back into range', () => {
    expect(sanitizeViewPrefs({ zoom: 99 }).zoom).toBe(ZOOM_MAX);
    expect(sanitizeViewPrefs({ zoom: 0 }).zoom).toBe(ZOOM_MIN);
  });

  it('valid prefs survive a JSON round-trip unchanged', () => {
    const prefs = sanitizeViewPrefs({ zoom: 1.5 });
    expect(sanitizeViewPrefs(JSON.parse(JSON.stringify(prefs)))).toEqual(prefs);
  });

  it('drops unknown fields instead of echoing them back into the blob', () => {
    const out = sanitizeViewPrefs({ zoom: 1.25, legacyKnob: true });
    expect(Object.keys(out).sort()).toEqual(['zoom']);
  });
});
