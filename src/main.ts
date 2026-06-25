/**
 * main.ts — FormatFX: the visual sandbox for SharePoint list formatting.
 *
 * App shell: toolbar (formatter kind, theme, undo/redo, examples),
 * palette | tree | canvas | inspector | JSON/data tabs.
 */

import './style.css';
import { state } from './editor/state';
import { PRODUCT_NAME, PRODUCT_TAGLINE, PROJECT_FILE_NAME } from './branding';
import { applyTheme, setCustomPalette } from './core/theme';
import { mountPalette } from './editor/palette';
import { mountTree } from './editor/treeView';
import { mountCanvas } from './editor/canvas';
import { mountFxBar } from './editor/fxBar';
import { mountInspector } from './editor/inspector';
import { mountJsonPanel } from './editor/jsonPanel';
import { mountDataPanel, applyImportedSchema } from './editor/dataPanel';
import { onPushedSnapshot } from './editor/extensionBridge';
import { mountBreadcrumb } from './editor/breadcrumb';
import { paletteItemById } from './editor/palette';
import { instantiate } from './editor/presets';
import { openPlayground } from './editor/playground';
import { openGuide } from './editor/guide';
import { openAbout } from './editor/about';
import { themeToggleView } from './editor/themeToggle';
import type { DocumentKind, FormatterDocument } from './core/types';

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
      <button id="wb-copy" title="Copy the compiled JSON of what you're editing — paste straight into SharePoint's format pane"><i class="ms-Icon ms-Icon--Copy"></i> JSON</button>
      <button id="wb-undo" title="Undo (Ctrl+Z)" aria-label="Undo"><i class="ms-Icon ms-Icon--Undo" aria-hidden="true"></i></button>
      <button id="wb-redo" title="Redo (Ctrl+Y)" aria-label="Redo"><i class="ms-Icon ms-Icon--Redo" aria-hidden="true"></i></button>
      <button id="wb-studio-toggle" title="Advanced — the single door to the developer tools: validated JSON (the escape hatch, with Deploy), plus the Palette, Structure and Properties panes. The maker grid stays primary."><i class="ms-Icon ms-Icon--Code"></i> Advanced</button>
      <div class="wb-menu" id="wb-menu">
        <button id="wb-menu-btn" title="Project & view options" aria-label="Project and view options menu">☰</button>
        <div class="wb-menu-panel" id="wb-menu-panel" hidden>
          <button id="wb-save" title="Save project file (formatter + schema + mock data)"><i class="ms-Icon ms-Icon--Save"></i> Save project</button>
          <button id="wb-open" title="Open a saved project file"><i class="ms-Icon ms-Icon--OpenFolderHorizontal"></i> Open project…</button>
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
          <button id="wb-theme" title="Toggle light/dark theme emulation"><i class="ms-Icon" id="wb-theme-icon"></i> <span id="wb-theme-label"></span></button>
          <label class="wb-check" title="Outline every element on the canvas so you can see the boxes you're building"><input type="checkbox" id="wb-outlines"> Outline every element</label>
          <button id="wb-playground" title="A consequence-free sandbox-within-the-sandbox: click through every style property on sample elements">⚗ Style playground</button>
          <button id="wb-guide" title="What lists really are (SQL under React), the column type system and its constraints, the formatting JSON layer, and the field-tested gotchas — written for developers">📖 Field guide</button>
          <button id="wb-about" title="Version, build revision and the last merged pull request"><i class="ms-Icon ms-Icon--Info"></i> About</button>
          <hr>
          <button id="wb-reset" title="Reset to the default example project"><i class="ms-Icon ms-Icon--EraseTool"></i> Reset to default example</button>
        </div>
      </div>
    </div>
  </header>
  <div class="wb-ribbon" id="wb-ribbon" title="Where you are — and where this formatter saves">
    <div id="wb-breadcrumb" class="wb-breadcrumb"></div>
  </div>
  <main class="wb-layout" id="wb-layout">
    <aside class="wb-pane wb-pane-palette" id="wb-pane-palette">
      <h2><span class="wb-pane-title">Palette</span>
        <button id="wb-palette-toggle" title="Collapse or expand the palette — drag still works; hover for names" aria-label="Toggle palette collapse">⮜</button>
      </h2>
      <div id="wb-palette"></div>
    </aside>
    <div class="wb-resizer" data-col="palette" title="Drag to resize"></div>
    <aside class="wb-pane wb-pane-tree" id="wb-pane-tree">
      <div class="wb-tree-rail" id="wb-tree-rail" title="Hover to open Structure — it stays open until you click somewhere else">⬚<span>structure</span></div>
      <h2><span>Structure</span>
        <button id="wb-tree-peek" title="Auto-hide: shrink Structure to a rail; hover the rail to open it, click anywhere else to close" aria-label="Toggle Structure auto-hide">📌</button>
      </h2>
      <div id="wb-tree" class="wb-tree-split">
        <section class="wb-tree-sec" id="wb-tree-sec-view">
          <div class="wb-tree-sec-head" id="wb-tree-view-head" title="The view formatter on the canvas — click to collapse">
            <button class="wb-tree-sec-min" id="wb-tree-view-min" title="Collapse / expand the view formatter" aria-label="Collapse or expand view formatter">▾</button>
            <span>View formatter</span>
          </div>
          <div class="wb-tree-sec-body" id="wb-tree-view"></div>
        </section>
        <div class="wb-tree-vsplit" id="wb-tree-vsplit" title="Drag to share space between the two sections"></div>
        <section class="wb-tree-sec" id="wb-tree-sec-cols">
          <div class="wb-tree-sec-head" id="wb-tree-cols-head" title="Column formatters in the workspace — click to collapse">
            <button class="wb-tree-sec-min" id="wb-tree-cols-min" title="Collapse / expand the column formatters" aria-label="Collapse or expand column formatters">▾</button>
            <span>Column formatters</span>
          </div>
          <div class="wb-tree-sec-body" id="wb-tree-cols"></div>
        </section>
      </div>
    </aside>
    <div class="wb-resizer" data-col="tree" title="Drag to resize"></div>
    <section class="wb-pane wb-pane-canvas">
      <div id="wb-fxbar" title="The Sheet formula bar — paint the selected cell's properties with Excel-style formulas."></div>
      <label class="wb-check wb-preview-titlecol" id="wb-titlecol-label" title="Show the Title context column next to your formatted column — uncheck to show the formatter cell alone"><input type="checkbox" id="wb-titlecol" checked> Title column</label>
      <div id="wb-canvas" class="wb-canvas"></div>
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
      <div class="wb-side-rail" title="Hover to open the panel — it stays open until you click somewhere else">◧<span>panel</span></div>
      <nav class="wb-tabs">
        <button data-tab="inspector" class="active">Properties</button>
        <button data-tab="json" title="The validated-JSON escape hatch — paste/apply any formatter, copy the compiled output, or Deploy">JSON</button>
        <button id="wb-side-peek" title="Auto-hide: shrink this pane to a rail; hover the rail to open it, click anywhere else to close" aria-label="Toggle side panel auto-hide">📌</button>
        <button id="wb-side-max" title="Maximize or restore this pane — room for editing JSON" aria-label="Toggle side panel maximize">⛶</button>
      </nav>
      <div class="wb-side-adv" title="Advanced: change the wrapper this formatter compiles to. Normally the type follows what you build; use this to start a tile/gallery layout or switch the wrapper without rebuilding.">
        <span>Formatter type</span>
        <select id="wb-kind">
          <option value="grid">Grid — view columns</option>
          <option value="column">Column formatter</option>
          <option value="row">View (row) formatter</option>
          <option value="tile">Tile / Gallery</option>
        </select>
      </div>
      <div id="wb-tab-inspector" class="wb-tab active"></div>
      <div id="wb-tab-json" class="wb-tab"></div>
    </aside>
  </main>
  <div id="wb-toast" class="wb-toast" hidden></div>
`;

// ─── resizable panes + collapsible palette (persisted UI prefs) ─────────────
const layout = document.getElementById('wb-layout')!;
interface UiPrefs {
  cols: { palette: number; tree: number; side: number };
  paletteCollapsed: boolean;
  sideMode: 'normal' | 'peek' | 'max';
  /** Structure pane auto-hide (pin to a rail), mirroring the side pane. */
  treeMode: 'normal' | 'peek';
  /** Structure pane split: top (view) section height (px) and per-section minimize. */
  treeViewH: number;
  treeViewMin: boolean;
  treeColsMin: boolean;
  /** The center Data dock: its height (px) and minimize/maximize state. */
  dataH: number;
  dataMode: 'normal' | 'min' | 'max';
  titleCol: boolean;
  /** When false (default), the studio panes are hidden — grid-first maker view. */
  studioOpen: boolean;
}
const uiPrefs: UiPrefs = {
  cols: { palette: 220, tree: 250, side: 360 },
  paletteCollapsed: false,
  sideMode: 'normal',
  treeMode: 'normal',
  treeViewH: 240,
  treeViewMin: false,
  treeColsMin: false,
  dataH: 220,
  dataMode: 'min',
  titleCol: true,
  studioOpen: false,
  ...JSON.parse(localStorage.getItem('wb-ui-prefs') ?? '{}'),
};
const saveUiPrefs = () => {
  try { localStorage.setItem('wb-ui-prefs', JSON.stringify(uiPrefs)); } catch { /* private mode */ }
};
const sidePane = document.getElementById('wb-pane-side')!;
const treePane = document.getElementById('wb-pane-tree')!;
const applyLayout = () => {
  const p = uiPrefs.paletteCollapsed ? 58 : uiPrefs.cols.palette;
  const side = uiPrefs.sideMode === 'peek' ? 30
    : uiPrefs.sideMode === 'max' ? Math.max(560, Math.round(window.innerWidth * 0.62))
    : uiPrefs.cols.side;
  // Structure can auto-hide to a rail (pinned) just like the side pane.
  const tree = uiPrefs.treeMode === 'peek' ? 30 : uiPrefs.cols.tree;
  // Layout modes: maker view (grid-first, studio panes hidden) vs studio open
  // (palette + Structure + preview/grid + Properties/JSON pane visible).
  layout.classList.toggle('wb-maker', !uiPrefs.studioOpen);
  document.getElementById('wb-studio-toggle')!.classList.toggle('active', uiPrefs.studioOpen);
  layout.style.gridTemplateColumns = uiPrefs.studioOpen
    ? `${p}px 5px ${tree}px 5px 1fr 5px ${side}px`
    : '1fr';
  document.getElementById('wb-pane-palette')!.classList.toggle('wb-collapsed', uiPrefs.paletteCollapsed);
  (document.getElementById('wb-palette-toggle') as HTMLButtonElement).textContent = uiPrefs.paletteCollapsed ? '⮞' : '⮜';
  sidePane.classList.toggle('wb-peek', uiPrefs.sideMode === 'peek');
  if (uiPrefs.sideMode !== 'peek') sidePane.classList.remove('wb-peek-open');
  sidePane.style.setProperty('--wb-side-w', `${uiPrefs.cols.side}px`);
  document.getElementById('wb-side-peek')!.classList.toggle('active', uiPrefs.sideMode === 'peek');
  document.getElementById('wb-side-max')!.classList.toggle('active', uiPrefs.sideMode === 'max');
  treePane.classList.toggle('wb-peek', uiPrefs.treeMode === 'peek');
  if (uiPrefs.treeMode !== 'peek') treePane.classList.remove('wb-peek-open');
  treePane.style.setProperty('--wb-tree-w', `${uiPrefs.cols.tree}px`);
  document.getElementById('wb-tree-peek')!.classList.toggle('active', uiPrefs.treeMode === 'peek');
};
window.addEventListener('resize', applyLayout);

// side pane modes: 📌 auto-hide (hover to open, outside click closes) · ⛶ maximize
document.getElementById('wb-side-peek')!.addEventListener('click', () => {
  uiPrefs.sideMode = uiPrefs.sideMode === 'peek' ? 'normal' : 'peek';
  applyLayout();
  saveUiPrefs();
});
document.getElementById('wb-side-max')!.addEventListener('click', () => {
  uiPrefs.sideMode = uiPrefs.sideMode === 'max' ? 'normal' : 'max';
  applyLayout();
  saveUiPrefs();
});
sidePane.addEventListener('mouseenter', () => {
  if (uiPrefs.sideMode === 'peek') sidePane.classList.add('wb-peek-open');
});
document.addEventListener('pointerdown', (e) => {
  if (uiPrefs.sideMode === 'peek' && !sidePane.contains(e.target as Node)) {
    sidePane.classList.remove('wb-peek-open');
  }
});
// Structure pane: pin/auto-hide to a rail, mirroring the side pane
document.getElementById('wb-tree-peek')!.addEventListener('click', () => {
  uiPrefs.treeMode = uiPrefs.treeMode === 'peek' ? 'normal' : 'peek';
  applyLayout();
  saveUiPrefs();
});
treePane.addEventListener('mouseenter', () => {
  if (uiPrefs.treeMode === 'peek') treePane.classList.add('wb-peek-open');
});
document.addEventListener('pointerdown', (e) => {
  if (uiPrefs.treeMode === 'peek' && !treePane.contains(e.target as Node)) {
    treePane.classList.remove('wb-peek-open');
  }
});
document.getElementById('wb-palette-toggle')!.addEventListener('click', () => {
  uiPrefs.paletteCollapsed = !uiPrefs.paletteCollapsed;
  applyLayout();
  saveUiPrefs();
});
document.getElementById('wb-studio-toggle')!.addEventListener('click', () => {
  const opening = !uiPrefs.studioOpen;
  uiPrefs.studioOpen = opening;
  applyLayout();
  saveUiPrefs();
  // the single Advanced door opens on the validated-JSON view (the escape
  // hatch); Palette/Structure/Properties stay one click away in the studio.
  if (opening) activateSideTab('json');
});

/** Activate one of the side-pane tabs (Properties / JSON) programmatically. */
function activateSideTab(tab: 'inspector' | 'json'): void {
  app.querySelectorAll('.wb-tabs button[data-tab]').forEach((b) => b.classList.remove('active'));
  app.querySelectorAll('.wb-tab').forEach((t) => t.classList.remove('active'));
  document.querySelector(`.wb-tabs button[data-tab="${tab}"]`)?.classList.add('active');
  document.getElementById(`wb-tab-${tab}`)?.classList.add('active');
}
for (const resizer of layout.querySelectorAll<HTMLElement>('.wb-resizer')) {
  const col = resizer.dataset.col as keyof UiPrefs['cols'];
  resizer.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    resizer.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const startW = uiPrefs.cols[col];
    if (col === 'palette' && uiPrefs.paletteCollapsed) return;
    if (col === 'tree' && uiPrefs.treeMode === 'peek') return;
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      // the side pane grows leftwards
      const next = col === 'side' ? startW - dx : startW + dx;
      uiPrefs.cols[col] = Math.max(56, Math.min(640, next));
      applyLayout();
    };
    const up = () => {
      resizer.removeEventListener('pointermove', move);
      resizer.removeEventListener('pointerup', up);
      saveUiPrefs();
    };
    resizer.addEventListener('pointermove', move);
    resizer.addEventListener('pointerup', up);
  });
}
applyLayout();

// ─── Structure pane: two stacked sections (view + columns) ──────────────────
// The top section is the view formatter, the bottom is the column formatters.
// Each minimizes independently; a splitter between them shares the height.
const treeSplit = document.getElementById('wb-tree')!;
const treeVSplit = document.getElementById('wb-tree-vsplit')!;
const treeViewMinBtn = document.getElementById('wb-tree-view-min') as HTMLButtonElement;
const treeColsMinBtn = document.getElementById('wb-tree-cols-min') as HTMLButtonElement;
const applyTreeSplit = () => {
  treeSplit.classList.toggle('wb-tv-min', uiPrefs.treeViewMin);
  treeSplit.classList.toggle('wb-tc-min', uiPrefs.treeColsMin);
  treeSplit.style.setProperty('--wb-tree-view-h', `${uiPrefs.treeViewH}px`);
  treeViewMinBtn.textContent = uiPrefs.treeViewMin ? '▸' : '▾';
  treeColsMinBtn.textContent = uiPrefs.treeColsMin ? '▸' : '▾';
};
const toggleSec = (which: 'view' | 'cols') => {
  if (which === 'view') uiPrefs.treeViewMin = !uiPrefs.treeViewMin;
  else uiPrefs.treeColsMin = !uiPrefs.treeColsMin;
  applyTreeSplit();
  saveUiPrefs();
};
// the head toggles, but its minimize button does too (so don't double-fire)
treeViewMinBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleSec('view'); });
treeColsMinBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleSec('cols'); });
document.getElementById('wb-tree-view-head')!.addEventListener('click', () => toggleSec('view'));
document.getElementById('wb-tree-cols-head')!.addEventListener('click', () => toggleSec('cols'));
// drag the splitter to share height (dragging down grows the view section)
treeVSplit.addEventListener('pointerdown', (e) => {
  if (uiPrefs.treeViewMin || uiPrefs.treeColsMin) return; // nothing to share
  e.preventDefault();
  treeVSplit.setPointerCapture(e.pointerId);
  const startY = e.clientY;
  const startH = uiPrefs.treeViewH;
  const move = (ev: PointerEvent) => {
    const splitH = treeSplit.clientHeight;
    uiPrefs.treeViewH = Math.max(60, Math.min(splitH - 120, startH + (ev.clientY - startY)));
    treeSplit.style.setProperty('--wb-tree-view-h', `${uiPrefs.treeViewH}px`);
  };
  const up = () => {
    treeVSplit.removeEventListener('pointermove', move);
    treeVSplit.removeEventListener('pointerup', up);
    saveUiPrefs();
  };
  treeVSplit.addEventListener('pointermove', move);
  treeVSplit.addEventListener('pointerup', up);
});
applyTreeSplit();

// Clicking a ⤷ chip opens that column formatter; make sure the bottom section
// is expanded and scroll the target into view. For a registered column that's
// the now-active header; for an unregistered reference (a no-op open) it's that
// name's "referenced but not in the workspace" row, briefly highlighted — so
// the click always lands somewhere meaningful.
function revealColumnSection(name: string): void {
  if (uiPrefs.treeColsMin) { uiPrefs.treeColsMin = false; applyTreeSplit(); saveUiPrefs(); }
  // the re-render from openColumnRef has already run synchronously; scroll next frame
  requestAnimationFrame(() => {
    const cols = document.getElementById('wb-tree-cols');
    if (!cols) return;
    const active = cols.querySelector<HTMLElement>('.wb-doc-header.active');
    if (active) { active.scrollIntoView({ block: 'nearest' }); return; }
    const missing = [...cols.querySelectorAll<HTMLElement>('.wb-doc-missing')]
      .find((el) => el.dataset.missingRef === name);
    if (missing) {
      missing.scrollIntoView({ block: 'nearest' });
      missing.classList.add('wb-flash');
      setTimeout(() => missing.classList.remove('wb-flash'), 1000);
    }
  });
}

// ─── center Data dock: collapse / maximize / drag-resize ────────────────────
// The Data editor lives below the preview (both modes), as its own panel with a
// draggable height and minimize/maximize — not a tab in the studio side pane.
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
// drag the splitter to set the dock height (dragging up grows it)
dataSplit.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  dataSplit.setPointerCapture(e.pointerId);
  const startY = e.clientY;
  const startH = dataDock.getBoundingClientRect().height;
  if (uiPrefs.dataMode !== 'normal') { uiPrefs.dataMode = 'normal'; applyDataDock(); }
  const move = (ev: PointerEvent) => {
    // clamp against the center column the dock lives in (leave room for the
    // preview above), not the window — so it can't outgrow its container
    const paneH = dataDock.parentElement?.clientHeight ?? window.innerHeight;
    uiPrefs.dataH = Math.max(90, Math.min(paneH - 160, startH - (ev.clientY - startY)));
    dataDock.style.setProperty('--wb-data-h', `${uiPrefs.dataH}px`);
  };
  const up = () => {
    dataSplit.removeEventListener('pointermove', move);
    dataSplit.removeEventListener('pointerup', up);
    saveUiPrefs();
  };
  dataSplit.addEventListener('pointermove', move);
  dataSplit.addEventListener('pointerup', up);
});
applyDataDock();

// ─── topbar ☰ menu (save/open/theme/outlines/reset live here) ───────────────
const menuEl = document.getElementById('wb-menu')!;
const menuPanel = document.getElementById('wb-menu-panel') as HTMLDivElement;
document.getElementById('wb-menu-btn')!.addEventListener('click', () => {
  menuPanel.hidden = !menuPanel.hidden;
});
document.addEventListener('pointerdown', (e) => {
  if (!menuPanel.hidden && !menuEl.contains(e.target as Node)) menuPanel.hidden = true;
});
menuPanel.addEventListener('click', (e) => {
  // button actions close the menu; the outlines checkbox keeps it open
  if ((e.target as HTMLElement).closest('button')) menuPanel.hidden = true;
});
document.getElementById('wb-playground')!.addEventListener('click', () => openPlayground());
document.getElementById('wb-guide')!.addEventListener('click', () => openGuide());
document.getElementById('wb-about')!.addEventListener('click', () => openAbout());

// toast
let toastTimer = 0;
function toast(message: string): void {
  const el = document.getElementById('wb-toast')!;
  el.textContent = message;
  el.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => { el.hidden = true; }, 2600);
}

document.title = `${PRODUCT_NAME} — ${PRODUCT_TAGLINE}`;

// restore autosaved project (before panels mount) — work survives refreshes
const restored = state.restore();

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

// kind switch
const kindSel = document.getElementById('wb-kind') as HTMLSelectElement;
kindSel.addEventListener('change', () => {
  state.setKind(kindSel.value as DocumentKind);
  toast(kindSel.value === 'column'
    ? 'Same element tree, new wrapper: this formatter now sits on ONE column (pick which in the Data tab). Your registered column formatters are untouched.'
    : kindSel.value === 'grid'
    ? 'Grid view: the same tree, column by column — click a header for actions, drag one onto another to group them into a row layout.'
    : `Same element tree, new wrapper: this formatter now lays out the whole ${kindSel.value === 'row' ? 'row' : 'tile'} and can embed column formatters via references.`);
});

// wrapper kind/example only make sense on the main formatter — preserve the
// disabling the old workspace <select> used to drive (the breadcrumb now owns
// doc navigation; this just keeps the Studio controls coherent).
const refreshStudioDisabled = () => {
  kindSel.disabled = state.activeDocKey !== 'main';
  exampleSel.disabled = state.activeDocKey !== 'main';
};
state.subscribe((reason) => {
  if (reason === 'data' || reason === 'load' || reason === 'kind') {
    kindSel.value = state.doc.kind;
    refreshStudioDisabled();
  }
});

// one-click copy of whatever is being edited
document.getElementById('wb-copy')!.addEventListener('click', async () => {
  const { exportJson } = await import('./core/serializer');
  await navigator.clipboard.writeText(exportJson(state.doc, { sanitizeWhitespace: true }));
  toast(state.activeDocKey !== 'main'
    ? `${state.activeDocKey} column formatter JSON copied — paste into that column's Format pane`
    : state.doc.kind === 'grid'
    ? 'View (row) formatter JSON copied — the grid ships as a row layout; for one column\'s JSON use its header menu'
    : 'Main formatter JSON copied — paste into the view\'s Format pane');
});

// examples
const exampleSel = document.getElementById('wb-example') as HTMLSelectElement;
exampleSel.addEventListener('change', () => {
  const id = exampleSel.value;
  exampleSel.value = '';
  if (!id) return;
  const item = paletteItemById(id);
  if (!item) return;
  const kind: DocumentKind = id === 'row-card' ? 'row' : id === 'tile-card' ? 'tile' : 'column';
  const doc: FormatterDocument = { kind, root: instantiate(item, state.fields) };
  if (kind === 'tile') { doc.tileWidth = 254; doc.tileHeight = 220; }
  state.loadDocument(doc);
  (document.getElementById('wb-menu-panel') as HTMLDivElement).hidden = true; // close the ☰ menu
  toast(`Loaded example: ${item.label}`);
});

// save / open / reset project
document.getElementById('wb-save')!.addEventListener('click', () => {
  const blob = new Blob([state.serializeProject()], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = PROJECT_FILE_NAME;
  a.click();
  URL.revokeObjectURL(a.href);
  toast('Project saved (formatter + schema + mock data)');
});
document.getElementById('wb-open')!.addEventListener('click', () => {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      state.loadProject(await file.text()); // theme reapplies via the 'load' subscriber
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

// undo/redo
const undoBtn = document.getElementById('wb-undo') as HTMLButtonElement;
const redoBtn = document.getElementById('wb-redo') as HTMLButtonElement;
const refreshUndoRedo = (): void => {
  undoBtn.disabled = !state.canUndo;
  redoBtn.disabled = !state.canRedo;
  // Dynamic tooltip gives sighted users empty-state feedback. The aria-label is
  // left as the state-agnostic "Undo"/"Redo" set in #66 — the disabled state
  // already conveys unavailability to assistive tech.
  undoBtn.title = state.canUndo ? 'Undo (Ctrl+Z)' : 'Nothing to undo';
  redoBtn.title = state.canRedo ? 'Redo (Ctrl+Y)' : 'Nothing to redo';
};
undoBtn.addEventListener('click', () => state.undo());
redoBtn.addEventListener('click', () => state.redo());
state.subscribe((reason) => { if (reason === 'document' || reason === 'load' || reason === 'kind') refreshUndoRedo(); });
refreshUndoRedo();
document.addEventListener('keydown', (e) => {
  const inText = (e.target as HTMLElement).matches('input, textarea, select');
  if (inText) return;
  if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); state.undo(); }
  if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key === 'Z'))) { e.preventDefault(); state.redo(); }
  if (e.key === 'Delete' && state.selection?.length) state.removeNode(state.selection);
});

// tabs
for (const btn of app.querySelectorAll<HTMLButtonElement>('.wb-tabs button[data-tab]')) {
  btn.addEventListener('click', () => {
    app.querySelectorAll('.wb-tabs button[data-tab]').forEach((b) => b.classList.remove('active'));
    app.querySelectorAll('.wb-tab').forEach((t) => t.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`wb-tab-${btn.dataset.tab}`)!.classList.add('active');
  });
}

// panels
mountPalette(document.getElementById('wb-palette')!);
mountTree(
  document.getElementById('wb-tree-view')!,
  document.getElementById('wb-tree-cols')!,
  revealColumnSection,
);
const canvas = mountCanvas(document.getElementById('wb-canvas')!, toast);
// the Title-column view toggle rides on the right edge of the fx (edit) bar
mountFxBar(document.getElementById('wb-fxbar')!, { accessory: document.getElementById('wb-titlecol-label')! });
mountInspector(document.getElementById('wb-tab-inspector')!);
const jsonPanel = mountJsonPanel(document.getElementById('wb-tab-json')!, toast);
mountDataPanel(document.getElementById('wb-tab-data')!, toast);
mountBreadcrumb(document.getElementById('wb-breadcrumb')!, toast);

// extract-push: a snapshot sent from the companion extension lands through the
// same guarded import as a paste (a fresh tab auto-loads it; existing work is
// protected by the pure-grid guard).
onPushedSnapshot((snapshotJson) => { applyImportedSchema(snapshotJson, toast); });

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
  // only meaningful in the column-kind preview (incl. open column formatters)
  titleColLabel.style.display = state.doc.kind === 'column' ? '' : 'none';
};
state.subscribe((reason) => {
  if (reason === 'kind' || reason === 'load' || reason === 'data' || reason === 'document') refreshTitleColVisibility();
});
refreshTitleColVisibility();

// lint refresh after each render pass
state.subscribe((reason) => {
  if (reason !== 'selection' && reason !== 'theme') {
    window.setTimeout(() => jsonPanel.refreshLint(canvas.getRuntimeIssues()), 0);
  }
});
jsonPanel.refreshLint(canvas.getRuntimeIssues());
refreshStudioDisabled();
kindSel.value = state.doc.kind; // restore() emits 'load' before the sync subscriber exists

if (restored) toast('Restored your autosaved project');
