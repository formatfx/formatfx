// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sam Yost. FormatFX is dual-licensed: AGPL-3.0-only (see LICENSE) or a commercial license (see LICENSING.md).

/**
 * main.ts — FormatFX: the visual sandbox for SharePoint list formatting.
 *
 * App shell. The editing surface is the Claude-style Left Edit Pane (structure
 * tree + draw toolbar + Simple/Pro/Code property lenses), the center canvas
 * (Function Bar + preview + Data dock), and a JSON-only right pane.
 */

import './style.css';
// Self-hosted SVG masks for our own chrome icons — loaded AFTER style.css so the
// app's icons render with no network (the CDN Fluent font stays only for
// arbitrary SharePoint iconName previews). See tools/gen-chrome-icons.mjs.
import './chromeIcons.css';
import { state, type EditorLens } from './editor/state';
import { PRODUCT_NAME, PRODUCT_TAGLINE, PROJECT_FILE_NAME } from './branding';
import { applyTheme, setCustomPalette } from './core/theme';
import { mountCanvas } from './editor/canvas';
import { mountCanvasTabs } from './editor/canvasTabs';
import { mountFxBar } from './editor/fxBar';
import { mountJsonPanel } from './editor/jsonPanel';
import { mountDataPanel, applyImportedSchema } from './editor/dataPanel';
import { onPushedSnapshot, onExtensionReady, onFormatterRequest, stageApplyToExtension } from './editor/extensionBridge';
import { buildCurrentApplyPayload } from './editor/deployPayload';
import { mountLeftPane } from './editor/leftPane';
import { copyNodes, pasteNodes } from './editor/clipboard';
import { paletteItemById } from './editor/palette';
import { instantiate } from './editor/presets';
import { openPlayground } from './editor/playground';
import { openGuide } from './editor/guide';
import { openSearch } from './editor/searchUi';
import { openAbout } from './editor/about';
import { openStressTest } from './editor/stressTestUi';
import { mountExplainPanel } from './editor/explainPanel';
import { openShareDialog, openSharedWorkspaceFromHash, wireRestoreBackup } from './editor/shareUi';
import { parseShareHash } from './core/share';
import { themeToggleView } from './editor/themeToggle';
import {
  paneGridTemplate, dragSide, sideMaxW, leftColW, clampLeftW,
  sanitizeSideMode, sanitizeLeftMode, sanitizeLeftW,
  type SideMode, type LeftMode,
} from './editor/paneLayout';
import type { DocumentKind } from './core/types';

const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `
  <header class="wb-topbar">
    <div class="wb-brand">
      <svg class="wb-brand-logo" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="18" height="18" aria-hidden="true" focusable="false">
        <style>
          .ffx-logo-path { fill: var(--wb-text); }
        </style>
        <path class="ffx-logo-path" fill-rule="evenodd" d="M 0 0 L 32 0 L 32 32 L 0 32 Z M 6 5 L 32 5 L 32 9 L 10 9 L 10 14 L 32 14 L 32 18 L 11 18 A 1 1 0 0 0 10 19 L 10 32 L 5 32 L 5 6 A 1 1 0 0 1 6 5 Z M 16 23 L 32 23 L 32 27 L 20 27 L 20 32 L 15 32 L 15 24 A 1 1 0 0 1 16 23 Z"/>
      </svg>
      <span>${PRODUCT_NAME}</span>
      <span class="wb-brand-sub">${PRODUCT_TAGLINE}</span>
    </div>
    <div class="wb-topbar-controls">
      <button id="wb-search-open" title="Search everything — elements, formulas, columns, rules, presets, functions (Ctrl+F)" aria-label="Search everything">Search</button>
      <button id="wb-json-toggle" title="Show or hide the validated-JSON pane (the escape hatch, with Deploy and Copy). The editing pane and canvas stay put."><i class="ms-Icon ms-Icon--Code"></i> JSON<span id="wb-lint-badge" hidden aria-label="lint issues"></span></button>
      <button id="wb-share" title="Share this workspace as a link — the whole thing travels inside the URL fragment, nothing is uploaded anywhere"><i class="ms-Icon ms-Icon--Share"></i> Share</button>
      <button id="wb-undo" title="Undo (Ctrl+Z)" aria-label="Undo"><i class="ms-Icon ms-Icon--Undo" aria-hidden="true"></i></button>
      <button id="wb-redo" title="Redo (Ctrl+Y)" aria-label="Redo"><i class="ms-Icon ms-Icon--Redo" aria-hidden="true"></i></button>
      <button id="wb-send-ext" hidden title="Send the formatter you're editing to the FormatFX companion extension (no clipboard) — then click the extension on your SharePoint list tab → Apply staged"><i class="ms-Icon ms-Icon--Lightning"></i> Send to extension</button>
      <div class="wb-menu" id="wb-menu">
        <button id="wb-menu-btn" title="Project & view options" aria-label="Project and view options menu">☰</button>
        <div class="wb-menu-panel" id="wb-menu-panel" hidden>
          <button id="wb-save" title="Save project file (formatter + schema + mock data) — Ctrl+S"><i class="ms-Icon ms-Icon--Save"></i> Save project</button>
          <button id="wb-open" title="Open a saved project file"><i class="ms-Icon ms-Icon--OpenFolderHorizontal"></i> Open project…</button>
          <button id="wb-restore-backup" hidden title="Restore the project that was backed up when you saved a shared workspace over it — the current workspace swaps into the backup slot, so nothing is lost"><i class="ms-Icon ms-Icon--Undo"></i> Restore backed-up work</button>
          <button id="wb-theme" title="Toggle light/dark theme emulation"><i class="ms-Icon" id="wb-theme-icon"></i> <span id="wb-theme-label"></span></button>
          <button id="wb-about" title="Version, build revision and the last merged pull request"><i class="ms-Icon ms-Icon--Info"></i> About</button>
          <button id="wb-menu-more" aria-expanded="false" title="Everything else — examples, outlines, playground, stress test, field guide, reset">More…</button>
          <div class="wb-menu-extra" id="wb-menu-extra" hidden>
            <hr>
            <label class="wb-menu-row" title="Load a ready-made example formatter to start from"><i class="ms-Icon ms-Icon--Lightbulb"></i> Load example
              <select id="wb-example">
                <option value="">— pick one —</option>
                <option value="status-pill">Status pill column</option>
                <option value="facepile">Facepile column</option>
                <option value="data-bar">Progress data bar</option>
                <option value="row-card">Row card view</option>
                <option value="tile-card">Gallery tile (3-layer)</option>
              </select>
            </label>
            <label class="wb-check" title="Outline every element on the canvas so you can see the boxes you're building"><input type="checkbox" id="wb-outlines"> Outline every element</label>
            <button id="wb-playground" title="A consequence-free sandbox-within-the-sandbox: click through every style property on sample elements">⚗ Style playground</button>
            <button id="wb-stress" title="Will this break in production? Render this formatter against generated edge-case data — empty items, extreme dates, boundary numbers, crowded multi-values — without touching your workspace">🧪 Stress test</button>
            <button id="wb-guide" title="What lists really are (SQL under React), the column type system and its constraints, the formatting JSON layer, and the field-tested gotchas — written for developers">📖 Field guide</button>
            <hr>
            <button id="wb-reset" title="Reset to the default example project"><i class="ms-Icon ms-Icon--EraseTool"></i> Reset to default example</button>
          </div>
        </div>
      </div>
    </div>
  </header>
  <main class="wb-layout" id="wb-layout">
    <button class="wb-lp-bar" id="wb-lp-bar" title="Expand the edit pane" aria-label="Expand the edit pane"><span aria-hidden="true">▸</span><span class="wb-lp-bar-label">Edit</span></button>
    <aside class="wb-leftpane" id="wb-leftpane"></aside>
    <div class="wb-resizer wb-resizer-left" data-col="left" title="Drag to resize the edit pane — double-click to minimize it to a bar"></div>
    <section class="wb-pane-canvas">
      <div id="wb-canvastabs" title="Canvas tabs — the Grid plus every view or component you open; drag to rearrange"></div>
      <div id="wb-fxbar" title="The Function Bar — paint the selected element's properties with Excel-style formulas."></div>
      <label class="wb-check wb-preview-titlecol" id="wb-titlecol-label" title="Show the Title context column next to your formatted column — uncheck to show the formatter cell alone"><input type="checkbox" id="wb-titlecol" checked> Title column</label>
      <div id="wb-canvas" class="wb-canvas"></div>
      <div id="wb-workshop" hidden></div>
      <div class="wb-data-split" id="wb-data-split" title="Drag to resize the data panel"></div>
      <section class="wb-data-dock" id="wb-data-dock">
        <div class="wb-data-dock-head" id="wb-data-dock-head" title="Mock rows &amp; columns — click the title to collapse">
          <span class="wb-data-title">Data — mock rows &amp; columns</span>
          <span class="wb-data-dock-actions">
            <button id="wb-data-min" title="Collapse / expand the data panel" aria-label="Collapse or expand data panel">▾</button>
            <button id="wb-data-max" title="Maximize or restore the data panel" aria-label="Toggle data panel maximize">⛶</button>
          </span>
        </div>
        <div id="wb-tab-data" class="wb-data-body"></div>
      </section>
    </section>
    <div class="wb-resizer" data-col="side" title="Drag to resize"></div>
    <aside class="wb-pane wb-pane-side" id="wb-pane-side">
      <div class="wb-side-head">
        <div class="wb-side-tabs" role="tablist" aria-label="Advanced pane view">
          <button class="wb-side-tab active" id="wb-side-tab-json" role="tab" aria-selected="true" data-tab="wb-tab-json">JSON</button>
          <button class="wb-side-tab" id="wb-side-tab-explain" role="tab" aria-selected="false" data-tab="wb-tab-explain" title="Read this formatter back in plain English — what shows, what turns which color when, what clicking does">Explain</button>
        </div>
        <div class="wb-side-actions">
        <button id="wb-side-max" class="wb-side-maxbtn" aria-pressed="false" aria-label="Toggle JSON pane maximize" title="Maximize the JSON pane over the canvas and data bar — the edit pane stays">⛶</button>
        <div class="wb-menu wb-side-more">
          <button id="wb-json-kebab" aria-haspopup="menu" aria-label="JSON pane actions" title="Everything else — copy, download, deploy, output options and the surface type"><svg viewBox="0 0 16 16" width="17" height="17" aria-hidden="true"><path fill="currentColor" d="M8 3a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm0 6.5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm0 6.5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z"/></svg></button>
          <div class="wb-json-kebab-panel" id="wb-json-kebab-panel" hidden>
            <div class="wb-json-kebab-slot" id="wb-json-kebab-slot"></div>
            <hr>
            <label class="wb-menu-row" title="Advanced: the surface on the canvas. On a view, switching row/tile changes its wrapper; picking Grid minimizes back to the floor (the view is untouched). On the grid, picking row/tile starts a new view carrying the grid's columns."><span>Type</span>
              <select id="wb-kind">
                <option value="grid">Grid — view columns</option>
                <option value="row">View (row) formatter</option>
                <option value="tile">Tile / Gallery</option>
              </select>
            </label>
          </div>
        </div>
        </div>
      </div>
      <div id="wb-tab-json" class="wb-tab active"></div>
      <div id="wb-tab-explain" class="wb-tab"></div>
    </aside>
  </main>
  <div id="wb-toast" class="wb-toast" hidden></div>
`;

// ─── resizable JSON pane + Data dock (persisted UI prefs) ───────────────────
const layout = document.getElementById('wb-layout')!;
interface UiPrefs {
  cols: { side: number };
  /** The center Data dock: its height (px) and minimize/maximize state. */
  dataH: number;
  dataMode: 'normal' | 'min' | 'max';
  titleCol: boolean;
  /** The active Left Edit Pane lens — a view pref, not part of the project. */
  activeLens: EditorLens;
  /** Whether the right-hand validated-JSON pane (the Advanced escape hatch) is
   *  shown. Collapsed by default so the maker landing is left pane + canvas. */
  jsonOpen: boolean;
  /** Pane states (spec 2026-07-10) — ADDITIVE fields in this frozen blob.
   *  Each pane's mode lives apart from its remembered size: maximizing the
   *  JSON pane never overwrites cols.side, the edit pane's bar never
   *  overwrites leftW, and reopening a pane restores both. */
  sideMode: SideMode;
  leftMode: LeftMode;
  leftW: number;
  /** Canvas view controls (#216/#224): the preview zoom factor (1 = 100%)
   *  and the simulated viewport width in px (null = fit the canvas).
   *  ADDITIVE fields in this frozen blob — read-only view prefs, never part
   *  of the project (no undo entry, no document autosave). */
  canvasZoom: number;
  canvasViewportW: number | null;
}
const uiPrefs: UiPrefs = {
  cols: { side: 360 },
  dataH: 220,
  dataMode: 'min',
  titleCol: true,
  activeLens: 'pro',
  jsonOpen: false,
  sideMode: 'normal',
  leftMode: 'normal',
  leftW: 360,
  canvasZoom: 1,
  canvasViewportW: null,
  ...JSON.parse(localStorage.getItem('wb-ui-prefs') ?? '{}'),
};
// a stored blob predating these fields — or a corrupt one — lands on defaults
uiPrefs.sideMode = sanitizeSideMode(uiPrefs.sideMode);
uiPrefs.leftMode = sanitizeLeftMode(uiPrefs.leftMode);
uiPrefs.leftW = sanitizeLeftW(uiPrefs.leftW);
const saveUiPrefs = () => {
  try { localStorage.setItem('wb-ui-prefs', JSON.stringify(uiPrefs)); } catch { /* private mode */ }
};
const sidePane = document.getElementById('wb-pane-side')!;
const sideResizer = layout.querySelector<HTMLElement>('.wb-resizer[data-col="side"]')!;
const leftResizerEl = layout.querySelector<HTMLElement>('.wb-resizer[data-col="left"]')!;
const leftPaneEl = document.getElementById('wb-leftpane')!;
const leftBarEl = document.getElementById('wb-lp-bar') as HTMLButtonElement;
const sideMaxBtn = document.getElementById('wb-side-max') as HTMLButtonElement;
// Pane states (spec 2026-07-10): paneLayout.ts makes every sizing decision;
// this block only reads prefs, measures the layout and paints the answer.
// The Left Edit Pane — or its 28px bar — is always visible: no state can
// strand the user with no way back. The JSON pane's width ceiling tracks the
// window (everything a workable ~420px canvas doesn't need is the pane's to
// take), and maximizing hands it the canvas + data dock too.
const applyLayout = () => {
  const grid = paneGridTemplate({
    jsonOpen: uiPrefs.jsonOpen, sideMode: uiPrefs.sideMode, leftMode: uiPrefs.leftMode,
    leftW: uiPrefs.leftW, sideW: uiPrefs.cols.side, layoutW: layout.clientWidth,
  });
  layout.style.gridTemplateColumns = grid.template;
  // bar/max visibility rides CLASSES, not inline styles, so the <900px
  // stacked media query can neutralize both modes with no JS breakpoint
  layout.classList.toggle('wb-left-bar', uiPrefs.leftMode === 'bar');
  layout.classList.toggle('wb-side-maxed', grid.centerHidden);
  sidePane.style.display = uiPrefs.jsonOpen ? '' : 'none';
  sideResizer.style.display = grid.sideResizer ? '' : 'none';
  leftResizerEl.style.display = grid.leftResizer ? '' : 'none';
  sideMaxBtn.classList.toggle('active', grid.centerHidden);
  sideMaxBtn.setAttribute('aria-pressed', String(grid.centerHidden));
  sideMaxBtn.title = grid.centerHidden
    ? 'Restore the JSON pane to its remembered width — or double-click the drag handle'
    : 'Maximize the JSON pane over the canvas and data bar — the edit pane stays';
  document.getElementById('wb-json-toggle')?.classList.toggle('active', uiPrefs.jsonOpen);
};
window.addEventListener('resize', applyLayout);

// the JSON pane's drag handle — width in normal mode, snap-to-max past the
// canvas floor (dragSide's hysteresis), drag-out restores pointer tracking
sideResizer.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  sideResizer.setPointerCapture(e.pointerId);
  const startX = e.clientX;
  const startW = sidePane.getBoundingClientRect().width;
  const preDragW = uiPrefs.cols.side;
  const move = (ev: PointerEvent) => {
    // the JSON pane grows leftwards
    const proposed = startW - (ev.clientX - startX);
    const left = leftColW(uiPrefs.leftMode, uiPrefs.leftW, layout.clientWidth);
    const d = dragSide(proposed, sideMaxW(layout.clientWidth, left), uiPrefs.sideMode);
    uiPrefs.sideMode = d.mode;
    if (d.mode === 'normal') uiPrefs.cols.side = d.w;
    applyLayout();
  };
  const up = () => {
    sideResizer.removeEventListener('pointermove', move);
    sideResizer.removeEventListener('pointerup', up);
    sideResizer.removeEventListener('pointercancel', up);
    // a drag that ends maximized keeps the pre-drag width as the remembered
    // one — un-maximizing returns to where the pane sat before the gesture
    if (uiPrefs.sideMode === 'max') uiPrefs.cols.side = preDragW;
    saveUiPrefs();
  };
  sideResizer.addEventListener('pointermove', move);
  sideResizer.addEventListener('pointerup', up);
  sideResizer.addEventListener('pointercancel', up);
});
sideResizer.addEventListener('dblclick', () => {
  uiPrefs.sideMode = uiPrefs.sideMode === 'max' ? 'normal' : 'max';
  applyLayout();
  saveUiPrefs();
});

// the edit pane's drag handle (it grows rightwards); double-click minimizes
// to the bar — the handle hides with the pane, the bar itself restores
leftResizerEl.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  leftResizerEl.setPointerCapture(e.pointerId);
  const startX = e.clientX;
  const startW = leftPaneEl.getBoundingClientRect().width;
  const move = (ev: PointerEvent) => {
    uiPrefs.leftW = clampLeftW(startW + (ev.clientX - startX), layout.clientWidth);
    applyLayout();
  };
  const up = () => {
    leftResizerEl.removeEventListener('pointermove', move);
    leftResizerEl.removeEventListener('pointerup', up);
    leftResizerEl.removeEventListener('pointercancel', up);
    saveUiPrefs();
  };
  leftResizerEl.addEventListener('pointermove', move);
  leftResizerEl.addEventListener('pointerup', up);
  leftResizerEl.addEventListener('pointercancel', up);
});
leftResizerEl.addEventListener('dblclick', () => {
  uiPrefs.leftMode = 'bar';
  applyLayout();
  saveUiPrefs();
});
leftBarEl.addEventListener('click', () => {
  uiPrefs.leftMode = 'normal';
  applyLayout();
  saveUiPrefs();
});
sideMaxBtn.addEventListener('click', () => {
  uiPrefs.sideMode = uiPrefs.sideMode === 'max' ? 'normal' : 'max';
  applyLayout();
  saveUiPrefs();
});
applyLayout();

// JSON: show/hide the validated-JSON pane — reopening restores the pane's
// remembered width AND mode (they persist independently of jsonOpen)
document.getElementById('wb-json-toggle')!.addEventListener('click', () => {
  uiPrefs.jsonOpen = !uiPrefs.jsonOpen;
  applyLayout();
  saveUiPrefs();
});

// ─── center Data dock: collapse / maximize / drag-resize ────────────────────
const dataDock = document.getElementById('wb-data-dock')!;
const dataSplit = document.getElementById('wb-data-split')!;
const dataMinBtn = document.getElementById('wb-data-min') as HTMLButtonElement;
const dataMaxBtn = document.getElementById('wb-data-max') as HTMLButtonElement;
const applyDataDock = () => {
  dataDock.classList.toggle('wb-min', uiPrefs.dataMode === 'min');
  dataDock.classList.toggle('wb-max', uiPrefs.dataMode === 'max');
  dataDock.style.setProperty('--wb-data-h', `${uiPrefs.dataH}px`);
  dataSplit.style.display = uiPrefs.dataMode === 'min' ? 'none' : '';
  dataMinBtn.textContent = uiPrefs.dataMode === 'min' ? '▸' : '▾';
  dataMinBtn.title = uiPrefs.dataMode === 'min' ? 'Expand the data panel' : 'Collapse the data panel';
  dataMaxBtn.classList.toggle('active', uiPrefs.dataMode === 'max');
};
dataMinBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  uiPrefs.dataMode = uiPrefs.dataMode === 'min' ? 'normal' : 'min';
  applyDataDock(); saveUiPrefs();
});
dataMaxBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  uiPrefs.dataMode = uiPrefs.dataMode === 'max' ? 'normal' : 'max';
  applyDataDock(); saveUiPrefs();
});
document.getElementById('wb-data-dock-head')!.addEventListener('click', (e) => {
  if ((e.target as HTMLElement).closest('button')) return; // buttons handle themselves
  uiPrefs.dataMode = uiPrefs.dataMode === 'min' ? 'normal' : 'min';
  applyDataDock(); saveUiPrefs();
});
dataSplit.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  dataSplit.setPointerCapture(e.pointerId);
  const startY = e.clientY;
  const startH = dataDock.getBoundingClientRect().height;
  if (uiPrefs.dataMode !== 'normal') { uiPrefs.dataMode = 'normal'; applyDataDock(); }
  const move = (ev: PointerEvent) => {
    const paneH = dataDock.parentElement?.clientHeight ?? window.innerHeight;
    uiPrefs.dataH = Math.max(90, Math.min(paneH - 160, startH - (ev.clientY - startY)));
    dataDock.style.setProperty('--wb-data-h', `${uiPrefs.dataH}px`);
  };
  const up = () => {
    dataSplit.removeEventListener('pointermove', move);
    dataSplit.removeEventListener('pointerup', up);
    dataSplit.removeEventListener('pointercancel', up);
    saveUiPrefs();
  };
  dataSplit.addEventListener('pointermove', move);
  dataSplit.addEventListener('pointerup', up);
  dataSplit.addEventListener('pointercancel', up);
});
applyDataDock();

// ─── topbar ☰ menu — slim by default (save/open/theme/about, #257); the rest
//     waits behind More… so the everyday menu stays four choices tall ─────────
const menuEl = document.getElementById('wb-menu')!;
const menuPanel = document.getElementById('wb-menu-panel') as HTMLDivElement;
const menuMoreBtn = document.getElementById('wb-menu-more') as HTMLButtonElement;
const menuExtra = document.getElementById('wb-menu-extra') as HTMLDivElement;
const setMenuMore = (open: boolean): void => {
  menuExtra.hidden = !open;
  menuMoreBtn.setAttribute('aria-expanded', String(open));
  menuMoreBtn.textContent = open ? 'Less…' : 'More…';
};
document.getElementById('wb-menu-btn')!.addEventListener('click', () => {
  menuPanel.hidden = !menuPanel.hidden;
  if (!menuPanel.hidden) setMenuMore(false); // always reopens slim
});
document.addEventListener('pointerdown', (e) => {
  if (!menuPanel.hidden && !menuEl.contains(e.target as Node)) menuPanel.hidden = true;
});
menuMoreBtn.addEventListener('click', () => setMenuMore(Boolean(menuExtra.hidden)));
menuPanel.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest('button');
  if (btn && btn !== menuMoreBtn) menuPanel.hidden = true; // More expands in place
});
document.getElementById('wb-search-open')!.addEventListener('click', () => openSearch(toast));
document.getElementById('wb-playground')!.addEventListener('click', () => openPlayground());
document.getElementById('wb-stress')!.addEventListener('click', () => openStressTest(toast));
document.getElementById('wb-guide')!.addEventListener('click', () => openGuide());
document.getElementById('wb-about')!.addEventListener('click', () => openAbout());

// Advanced pane tabs: JSON (default, what every e2e flow drives) ⇄ Explain
for (const tabBtn of document.querySelectorAll<HTMLButtonElement>('.wb-side-tab')) {
  tabBtn.addEventListener('click', () => {
    for (const b of document.querySelectorAll<HTMLButtonElement>('.wb-side-tab')) {
      const active = b === tabBtn;
      b.classList.toggle('active', active);
      b.setAttribute('aria-selected', String(active));
      document.getElementById(b.dataset.tab!)?.classList.toggle('active', active);
    }
  });
}

// toast
let toastTimer = 0;
function toast(message: string): void {
  const el = document.getElementById('wb-toast')!;
  el.textContent = message;
  el.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => { el.hidden = true; }, Math.max(2600, (message.match(/\S+/g) ?? []).length * 350));
}

document.title = `${PRODUCT_NAME} — ${PRODUCT_TAGLINE}`;

// restore autosaved project (before panels mount) — work survives refreshes
state.activeLens = uiPrefs.activeLens; // seed the lens before the pane mounts
const restored = state.restore();
state.markSavepoint(); // baseline for Discard, whether restored or default

// theme (stock light/dark base + optional tenant palette overrides)
const applyAppTheme = () => {
  setCustomPalette(state.customTheme);
  document.body.classList.toggle('wb-dark', state.themeMode === 'dark');
  applyTheme(state.themeMode);
  const tv = themeToggleView(state.themeMode);
  document.getElementById('wb-theme-icon')!.className = `ms-Icon ms-Icon--${tv.icon}`;
  document.getElementById('wb-theme-label')!.textContent = tv.label;
};
applyAppTheme();
document.getElementById('wb-theme')!.addEventListener('click', () => {
  state.themeMode = state.themeMode === 'light' ? 'dark' : 'light';
  applyAppTheme();
  state.emit('theme');
});
state.subscribe((reason) => {
  if (reason === 'theme' || reason === 'load') applyAppTheme();
});

// kind switch (in the JSON pane's head kebab: the surface on the canvas —
// FLOOR-AND-SHEETS Stage 1). Picking a type is an action, so it closes the
// kebab, same as the ☰ menu's example loader.
const kindSel = document.getElementById('wb-kind') as HTMLSelectElement;
kindSel.addEventListener('change', () => {
  const wasOnFloor = state.onFloor;
  state.setKind(kindSel.value as DocumentKind);
  toast(kindSel.value === 'grid'
    ? 'Back on the grid floor — your view is untouched and waits in the view list.'
    : wasOnFloor
    ? `Started a new ${kindSel.value === 'row' ? 'row' : 'tile'} view carrying the grid's columns — the grid itself is unchanged.`
    : `Same element tree, new wrapper: this view now lays out the whole ${kindSel.value === 'row' ? 'row' : 'tile'} and can embed column formatters via references.`);
  (document.getElementById('wb-json-kebab-panel') as HTMLDivElement).hidden = true;
});

// the wrapper kind only makes sense on a surface (floor or sheet): it stays
// disabled while a component WORKSHOP tab covers the canvas (the staged def
// is not a document — COLUMNS-COMPONENTS-VIEWS §2). The activeDocKey guard
// stays for the later phase where a component tab re-targets the canvas doc
// key; it's always 'main' today.
const refreshStudioDisabled = () => {
  kindSel.disabled = state.activeDocKey !== 'main' || state.activeComponentTab !== null;
};
state.subscribe((reason) => {
  if (reason === 'data' || reason === 'load' || reason === 'kind') {
    // drilled docs are kind 'column' — not a surface; keep showing the surface
    if (state.doc.kind !== 'column') kindSel.value = state.doc.kind;
    refreshStudioDisabled();
  }
});

// (The topbar copy button is gone (#257): the JSON button opens the pane,
//  and copying lives on the pane's own Copy / Copy (CSOM-safe) / Download row.)

// examples
const exampleSel = document.getElementById('wb-example') as HTMLSelectElement;
exampleSel.addEventListener('change', () => {
  const id = exampleSel.value;
  exampleSel.value = '';
  if (!id) return;
  const item = paletteItemById(id);
  if (!item) return;
  const root = instantiate(item, state.fields);
  const kind: DocumentKind = id === 'row-card' ? 'row' : id === 'tile-card' ? 'tile' : 'column';
  if (kind === 'column') {
    // a column example becomes the CURRENT field's LOOK — the grid renders
    // it embedded, with that column selected (one undoable step)
    state.loadDocument({ kind: 'column', root });
    toast(`Loaded example: ${item.label} — applied as the ${state.currentFieldName} column's look`);
  } else {
    state.loadViewDocument({ kind, root }, item.label);
    toast(`Loaded example: ${item.label} — added as its own view`);
  }
  (document.getElementById('wb-menu-panel') as HTMLDivElement).hidden = true;
});

// save / open / reset project
const saveProject = (): void => {
  const blob = new Blob([state.serializeProject()], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = PROJECT_FILE_NAME;
  a.click();
  URL.revokeObjectURL(a.href);
  toast('Project saved (formatter + schema + mock data)');
};
document.getElementById('wb-save')!.addEventListener('click', saveProject);
document.getElementById('wb-open')!.addEventListener('click', () => {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      state.loadProject(await file.text());
      toast(`Opened ${file.name}`);
    } catch (e) {
      toast(`Open failed: ${(e as Error).message}`);
    }
  });
  input.click();
});
document.getElementById('wb-reset')!.addEventListener('click', () => {
  if (!confirm('Reset to the default example project? Your autosaved work will be cleared.')) return;
  state.resetAll();
  toast('Reset to defaults');
});

// undo/redo (topbar)
const undoBtn = document.getElementById('wb-undo') as HTMLButtonElement;
const redoBtn = document.getElementById('wb-redo') as HTMLButtonElement;
const refreshUndoRedo = (): void => {
  undoBtn.disabled = !state.canUndo;
  redoBtn.disabled = !state.canRedo;
  undoBtn.title = state.canUndo ? 'Undo (Ctrl+Z)' : 'Nothing to undo';
  redoBtn.title = state.canRedo ? 'Redo (Ctrl+Y)' : 'Nothing to redo';
};
undoBtn.addEventListener('click', () => state.undo());
redoBtn.addEventListener('click', () => state.redo());
state.subscribe((reason) => { if (reason === 'document' || reason === 'load' || reason === 'kind') refreshUndoRedo(); });
refreshUndoRedo();

// ─── keyboard shortcuts ─────────────────────────────────────────────────────
document.addEventListener('keydown', (e) => {
  const inText = (e.target as HTMLElement).matches('input, textarea, select');
  const mod = e.ctrlKey || e.metaKey;
  // lens switching works even from a focused field
  if (mod && (e.key === '1' || e.key === '2' || e.key === '3')) {
    e.preventDefault();
    state.setLens(e.key === '1' ? 'simple' : e.key === '2' ? 'pro' : 'code');
    return;
  }
  // universal search — replaces the browser find, and works from a focused field
  if (mod && !e.shiftKey && e.key.toLowerCase() === 'f') { e.preventDefault(); openSearch(toast); return; }
  if (inText) return;
  if (mod && e.key === 'z') { e.preventDefault(); state.undo(); return; }
  if (mod && (e.key === 'y' || (e.shiftKey && e.key === 'Z'))) { e.preventDefault(); state.redo(); return; }
  if (mod && !e.shiftKey && e.key.toLowerCase() === 's') { e.preventDefault(); saveProject(); return; }
  if (mod && e.key === 'd' && state.selection) { e.preventDefault(); state.duplicateNode(state.selection); return; }
  if (mod && e.key === 'c' && state.selections.length) { e.preventDefault(); void copyNodes(state.selections); return; }
  if (mod && e.key === 'v') { e.preventDefault(); void pasteNodes(); return; }
  if (e.key === 'Escape') { state.select(null); return; }
  if (e.key === 'Delete' && state.selection?.length) { state.removeNode(state.selection); return; }
});

// persist the chosen lens (view pref, not the project)
state.subscribe((reason) => {
  if (reason === 'lens') { uiPrefs.activeLens = state.activeLens; saveUiPrefs(); }
});

// ─── panels ─────────────────────────────────────────────────────────────────
mountLeftPane(document.getElementById('wb-leftpane')!, { toast });
// the edit pane's minimize control rides the nav row the pane just rendered —
// shell-owned (it drives shell layout state), so leftPane.ts stays untouched
{
  const lpCollapse = document.createElement('button');
  lpCollapse.id = 'wb-lp-collapse';
  lpCollapse.className = 'wb-lp-collapse';
  lpCollapse.title = 'Minimize the edit pane to a bar — click the bar to bring it back';
  lpCollapse.setAttribute('aria-label', 'Minimize the edit pane to a bar');
  lpCollapse.textContent = '◂';
  lpCollapse.addEventListener('click', () => {
    uiPrefs.leftMode = 'bar';
    applyLayout();
    saveUiPrefs();
  });
  // cluster with the pane's kebab so the nav row keeps its 3 space-between
  // children (back · lens tabs · actions) — the ⋮ node moves, listeners ride
  const lpKebab = leftPaneEl.querySelector('#wb-kebab-btn');
  if (lpKebab) {
    const actions = document.createElement('span');
    actions.className = 'wb-lp-nav-actions';
    lpKebab.replaceWith(actions);
    actions.append(lpKebab, lpCollapse);
  } else {
    leftPaneEl.querySelector('.wb-lp-nav')?.appendChild(lpCollapse);
  }
}
// canvas view prefs (#216/#224): zoom + viewport ride inside wb-ui-prefs
// (additive fields — the frozen-keys rule)
const canvas = mountCanvas(document.getElementById('wb-canvas')!, toast, {
  get: () => ({ zoom: uiPrefs.canvasZoom, viewportWidth: uiPrefs.canvasViewportW }),
  set: (p) => { uiPrefs.canvasZoom = p.zoom; uiPrefs.canvasViewportW = p.viewportWidth; saveUiPrefs(); },
});
mountFxBar(document.getElementById('wb-fxbar')!, { accessory: document.getElementById('wb-titlecol-label')! });
const jsonPanel = mountJsonPanel(document.getElementById('wb-tab-json')!, toast);
mountExplainPanel(document.getElementById('wb-tab-explain')!);
mountDataPanel(document.getElementById('wb-tab-data')!, toast);
// the canvas tab strip mounts LAST: its first render may swap the workshop
// over #wb-canvas (a component tab restored active), so the canvas must exist
mountCanvasTabs(document.getElementById('wb-canvastabs')!, document.getElementById('wb-workshop')!, toast);

// ── share: mint links, restore backups, open incoming links safely ──
document.getElementById('wb-share')!.addEventListener('click', () => openShareDialog({ toast }));
wireRestoreBackup({ toast });

// extract-push: a snapshot sent from the companion extension lands through the
// same guarded import as a paste.
onPushedSnapshot((snapshotJson) => { applyImportedSchema(snapshotJson, toast); });

// ── companion extension hand-off (clipboard-free) ──
// The current formatter, supplied on demand to the extension's "Grab this
// formatter" button — the same payload the buttons below stage.
onFormatterRequest(() => buildCurrentApplyPayload());

// Top-level "Send to extension": surfaced only when the extension announces
// itself, so the deploy hand-off no longer hides behind Advanced.
const sendExtBtn = document.getElementById('wb-send-ext') as HTMLButtonElement;
onExtensionReady(() => { sendExtBtn.hidden = false; });
sendExtBtn.addEventListener('click', async () => {
  const { payload, error } = buildCurrentApplyPayload();
  if (!payload) { toast(error ?? 'Nothing to send.'); return; }
  try {
    const { staged } = await stageApplyToExtension(payload);
    toast(`Sent to the extension (${staged} formatter) — switch to your SharePoint list tab and click the FormatFX extension → Apply staged`);
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e));
  }
});

// debug outlines
(document.getElementById('wb-outlines') as HTMLInputElement).addEventListener('change', (e) => {
  canvas.setOutlines((e.target as HTMLInputElement).checked);
});

// Title context column in the column-formatter preview (persisted view pref)
const titleColCb = document.getElementById('wb-titlecol') as HTMLInputElement;
const titleColLabel = document.getElementById('wb-titlecol-label')!;
titleColCb.checked = uiPrefs.titleCol;
canvas.setTitleColumn(uiPrefs.titleCol);
titleColCb.addEventListener('change', () => {
  uiPrefs.titleCol = titleColCb.checked;
  canvas.setTitleColumn(titleColCb.checked);
  saveUiPrefs();
});
const refreshTitleColVisibility = () => {
  titleColLabel.style.display = state.doc.kind === 'column' ? '' : 'none';
};
state.subscribe((reason) => {
  if (reason === 'kind' || reason === 'load' || reason === 'data' || reason === 'document') refreshTitleColVisibility();
});
refreshTitleColVisibility();

// lint refresh after each render pass — also drives the topbar badge so makers
// in the default maker view can see issues without opening the studio.
const lintBadge = document.getElementById('wb-lint-badge') as HTMLElement;
const refreshLintBadge = ({ errors, warnings, runtime }: { errors: number; warnings: number; runtime: number }): void => {
  const errorTotal = errors + runtime;
  const count = errorTotal || warnings;
  if (!count) { lintBadge.hidden = true; lintBadge.removeAttribute('aria-label'); lintBadge.title = ''; return; }
  lintBadge.textContent = String(count);
  lintBadge.hidden = false;
  lintBadge.classList.toggle('wb-badge-warn', errorTotal === 0);
  const label = errorTotal
    ? `${errorTotal} lint error${errorTotal === 1 ? '' : 's'} — open the JSON pane to review`
    : `${warnings} lint warning${warnings === 1 ? '' : 's'} — open the JSON pane to review`;
  lintBadge.setAttribute('aria-label', label);
  lintBadge.title = label;
};
state.subscribe((reason) => {
  if (reason !== 'selection' && reason !== 'theme' && reason !== 'lens') {
    window.setTimeout(() => refreshLintBadge(jsonPanel.refreshLint(canvas.getRuntimeIssues())), 0);
  }
});
refreshLintBadge(jsonPanel.refreshLint(canvas.getRuntimeIssues()));
refreshStudioDisabled();
// restore() emits 'load' before the sync subscriber exists; drilled docs are
// kind 'column' (not a surface) but a fresh boot always lands on a surface
if (state.doc.kind !== 'column') kindSel.value = state.doc.kind;

// A share link in the fragment loads AFTER the panels mount (loadProject
// re-renders them) and with autosave paused, so the recipient's own work is
// never clobbered — see editor/shareUi.ts for the keep/discard flow.
const sharedPending = parseShareHash(location.hash) != null;
if (sharedPending) void openSharedWorkspaceFromHash({ toast });
else if (restored) toast('Restored your autosaved project');
