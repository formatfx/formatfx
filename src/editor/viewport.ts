// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sam Yost. FormatFX is dual-licensed: AGPL-3.0-only (see LICENSE) or a commercial license (see LICENSING.md).

/**
 * editor/viewport.ts — the pure brain behind the canvas VIEW controls:
 * zoom (#216) and the simulated viewport width (#224). Two separate,
 * composable axes — keep them straight:
 *
 *   · ZOOM scales rendered pixels (CSS transform scale) to fight workspace
 *     claustrophobia or inspect a pill up close — it NEVER changes layout.
 *   · VIEWPORT WIDTH constrains the preview's LAYOUT width so real CSS
 *     reflow happens (flex-wrap, ellipsis, truncation, overflow) — the
 *     honest "does this survive a narrow screen?" signal that zoom alone
 *     would erase. "Phone width AND zoomed in to read a pill" composes.
 *
 * This is the one width→reflow module: the template builder's squeeze
 * scrubber (templatePreview.ts) and the canvas viewport control both drive
 * their drag handles through clampDragWidth/commitDragWidth below — the
 * modal keeps its own row-squeeze preset table (STAGE_WIDTHS in
 * templateUi.ts) because it answers a different question ("when does this
 * row wrap?") than the device presets here ("how much room does a real
 * person have?").
 *
 * View state only: nothing here touches the document, the undo stack or the
 * autosave. The chosen zoom + viewport persist as ADDITIVE fields inside the
 * frozen `wb-ui-prefs` localStorage blob (main.ts owns the blob —
 * frozen-keys rule: no new top-level localStorage keys, no renames).
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

// ─── viewport width (#224): real reflow at representative widths ────────────

/** The floor any simulated viewport can squeeze to — below this even real
 *  SharePoint gives up and scrolls; matches the template stage's CSS
 *  min-width so the two surfaces tell one story. */
export const MIN_STAGE_WIDTH = 240;

/** Sanity cap for PERSISTED widths only (double a 1920 desktop) — a
 *  hand-edited blob can't park the stage a kilometer off-canvas. Live drags
 *  are capped by the actual container instead (clampDragWidth). */
export const MAX_STAGE_WIDTH = 3840;

/** Dragging within this many px of full width snaps back to "no constraint"
 *  (null) — reaching the edge means "give me everything" (the template
 *  modal's long-standing behavior, now shared). */
const SNAP_TO_FULL_PX = 8;

/** Clamp a dragged stage width between the floor and the container. */
export function clampDragWidth(w: number, full: number): number {
  return Math.round(Math.min(Math.max(w, MIN_STAGE_WIDTH), full));
}

/** Commit a drag: at (or within SNAP_TO_FULL_PX of) full width the
 *  constraint dissolves to null — full width is the absence of a viewport,
 *  not a number that happens to match the container today. */
export function commitDragWidth(w: number, full: number): number | null {
  return w >= full - SNAP_TO_FULL_PX ? null : w;
}

export interface ViewportPreset {
  id: 'fit' | 'average' | 'half' | 'phone';
  /** Button glyph + word — the "how much room does a real person have" read. */
  label: string;
  /** Layout width in px; null = no constraint (use all the canvas room). */
  width: number | null;
  /** Tooltip copy. The numeric presets say "approximate" out loud —
   *  refuse-don't-guess: these are sandbox estimates, and the real-tenant
   *  truth for wrap behavior is #177 (live-verify wrap-when-tight). */
  hint: string;
}

/**
 * The device presets (#224). ASSUMPTIONS, documented the templatePreview
 * way — every value is an ESTIMATE of "how much width does the rendered
 * list actually get", not a device spec, and the UI labels them ≈:
 *
 *   · average 1420 — the most common desktop is 1920px wide (StatCounter
 *     has 1920×1080 at ~22–24% of desktops for years). A maximized modern
 *     SP list page spends ~450–500px on the app bar + site nav rail +
 *     page padding, leaving ≈1400–1450px of list room. We use 1420.
 *     (Renamed from "monitor" 2026-07-10 — the id is view-pref-internal,
 *     never persisted, so the rename costs nothing.)
 *   · half    860 — split-screen reality: half of 1920 is 960; window
 *     chrome + page padding eat ~100px, and below ~1024px SharePoint
 *     collapses the left nav, so the list keeps ≈860.
 *   · phone   360 — the long-standing small-phone CSS viewport baseline
 *     (360×800 Androids; iPhone SE is 375) — the wrap-everything case.
 *     Deliberately the same 360 as the template modal's "Narrow" preset.
 *
 * Real tenants differ (app bar on/off, nav collapsed, density) — which is
 * exactly why #177 (live-verify wrap-when-tight) exists; the preview must
 * never overpromise what only a tenant can confirm.
 */
export const VIEWPORT_PRESETS: readonly ViewportPreset[] = [
  {
    id: 'fit', label: 'Fit', width: null,
    hint: 'No simulated viewport — the preview uses all the room the canvas has',
  },
  {
    id: 'average', label: 'Average', width: 1420,
    hint: 'Approximate (~1420px): the room a maximized list gets on an average 1920px-wide desktop, after SharePoint\'s nav rail and page padding',
  },
  {
    id: 'half', label: 'Half', width: 860,
    hint: 'Approximate (~860px): a split-screen half of a 1920px desktop — SharePoint collapses its left nav and the list keeps about this much',
  },
  {
    id: 'phone', label: 'Phone', width: 360,
    hint: 'Approximate (~360px): a small phone viewport — the wrap-everything case',
  },
];

// ─── persisted view prefs (inside wb-ui-prefs — additive, frozen-keys safe) ─

export interface CanvasViewPrefs {
  /** Zoom factor (1 = 100%). */
  zoom: number;
  /** Simulated viewport LAYOUT width in px; null = fit (no constraint). */
  viewportWidth: number | null;
}

/** Never trust the blob: `wb-ui-prefs` survives every release, so a value
 *  written by any past or future version (or hand-edited) must sanitize to
 *  something usable — bad fields fall back to defaults, extra fields drop. */
export function sanitizeViewPrefs(raw: unknown): CanvasViewPrefs {
  const o = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const w = o.viewportWidth;
  return {
    zoom: typeof o.zoom === 'number' ? clampZoom(o.zoom) : 1,
    viewportWidth: typeof w === 'number' && Number.isFinite(w)
      ? Math.round(Math.min(Math.max(w, MIN_STAGE_WIDTH), MAX_STAGE_WIDTH))
      : null,
  };
}
