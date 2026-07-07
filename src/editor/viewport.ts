/**
 * editor/viewport.ts — the pure brain behind the canvas VIEW controls:
 * zoom (#216). Zoom scales rendered pixels (CSS transform scale) to fight
 * workspace claustrophobia or inspect a pill up close — it NEVER changes
 * layout. Pure math/tables only, unit-tested directly; the DOM plumbing
 * lives in canvas.ts.
 *
 * View state only: nothing here touches the document, the undo stack or the
 * autosave. The chosen zoom persists as an ADDITIVE field inside the frozen
 * `wb-ui-prefs` localStorage blob (main.ts owns the blob — frozen-keys rule:
 * no new top-level localStorage keys, no renames).
 */

// ─── zoom (#216): magnify-only, clamped, stepped through familiar stops ─────

/** The zoom clamp range — 25%…200% (#216's "sane range"). */
export const ZOOM_MIN = 0.25;
export const ZOOM_MAX = 2;

/** The +/− (and Ctrl+wheel) ladder — the familiar browser-zoom stops. */
export const ZOOM_STOPS: readonly number[] =
  [0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];

/** Clamp any zoom factor into range; garbage (NaN/∞) lands back on 100%. */
export function clampZoom(z: number): number {
  if (!Number.isFinite(z)) return 1;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
}

/** The next stop above (+1) or below (−1) `z`, saturating at the ends. A `z`
 *  between stops (an old persisted value) snaps to the nearest stop in the
 *  requested direction, so stepping never gets stuck. */
export function stepZoom(z: number, dir: 1 | -1): number {
  const cur = clampZoom(z);
  const EPS = 1e-3;
  if (dir > 0) return ZOOM_STOPS.find((s) => s > cur + EPS) ?? ZOOM_MAX;
  for (let i = ZOOM_STOPS.length - 1; i >= 0; i--) {
    if (ZOOM_STOPS[i] < cur - EPS) return ZOOM_STOPS[i];
  }
  return ZOOM_MIN;
}

/** "100%" — the toolbar readout. */
export function zoomLabel(z: number): string {
  return `${Math.round(clampZoom(z) * 100)}%`;
}

// ─── persisted view prefs (inside wb-ui-prefs — additive, frozen-keys safe) ─

export interface CanvasViewPrefs {
  /** Zoom factor (1 = 100%). */
  zoom: number;
}

/** Never trust the blob: `wb-ui-prefs` survives every release, so a value
 *  written by any past or future version (or hand-edited) must sanitize to
 *  something usable — bad fields fall back to defaults, extra fields drop. */
export function sanitizeViewPrefs(raw: unknown): CanvasViewPrefs {
  const o = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  return {
    zoom: typeof o.zoom === 'number' ? clampZoom(o.zoom) : 1,
  };
}
