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
import { mountInspector } from './editor/inspector';
import { mountJsonPanel } from './editor/jsonPanel';
import { mountDataPanel } from './editor/dataPanel';
import { paletteItemById } from './editor/palette';
import { instantiate } from './editor/presets';
import { openPlayground } from './editor/playground';
import type { DocumentKind, FormatterDocument } from './core/types';

const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `
  <header class="wb-topbar">
    <div class="wb-brand">
      <i class="ms-Icon ms-Icon--ColumnOptions"></i>
      <span>${PRODUCT_NAME}</span>
      <span class="wb-brand-sub">${PRODUCT_TAGLINE}</span>
    </div>
    <div class="wb-topbar-controls">
      <div class="wb-mode" id="wb-mode" title="Basic shows the everyday tools — presets, visual editing, your data. Advanced adds the raw JSON tab, loops, row actions, hover cards, CFRs and tenant themes.">
        <button data-mode="basic">Basic</button>
        <button data-mode="advanced">Advanced</button>
      </div>
      <label class="wb-adv" title="Switch between the main formatter and any registered column formatter — CFRs in the main formatter update live">Editing
        <select id="wb-activedoc"><option value="main">Main formatter</option></select>
      </label>
      <button id="wb-copy" title="Copy the compiled JSON of what you're editing — paste straight into SharePoint's format pane"><i class="ms-Icon ms-Icon--Copy"></i> JSON</button>
      <label title="What kind of formatter you're building: a column formatter lives on ONE column; row/tile formatters lay out the whole item and can embed column formatters via references">Type
        <select id="wb-kind">
          <option value="column">Column formatter</option>
          <option value="row">View (row) formatter</option>
          <option value="tile">Tile / Gallery</option>
        </select>
      </label>
      <label>Example
        <select id="wb-example">
          <option value="">— load —</option>
          <option value="status-pill">Status pill column</option>
          <option value="facepile">Facepile column</option>
          <option value="data-bar">Progress data bar</option>
          <option value="row-card">Row card view</option>
          <option value="tile-card">Gallery tile (3-layer)</option>
        </select>
      </label>
      <button id="wb-undo" title="Undo (Ctrl+Z)"><i class="ms-Icon ms-Icon--Undo"></i></button>
      <button id="wb-redo" title="Redo (Ctrl+Y)"><i class="ms-Icon ms-Icon--Redo"></i></button>
      <div class="wb-menu" id="wb-menu">
        <button id="wb-menu-btn" title="Project & view options">☰</button>
        <div class="wb-menu-panel" id="wb-menu-panel" hidden>
          <button id="wb-save" title="Save project file (formatter + schema + mock data)"><i class="ms-Icon ms-Icon--Save"></i> Save project</button>
          <button id="wb-open" title="Open a saved project file"><i class="ms-Icon ms-Icon--OpenFolderHorizontal"></i> Open project…</button>
          <button id="wb-theme" title="Toggle light/dark theme emulation"><i class="ms-Icon ms-Icon--Light"></i> <span id="wb-theme-label">Switch to light mode</span></button>
          <label class="wb-check" title="Outline every element on the canvas so you can see the boxes you're building"><input type="checkbox" id="wb-outlines"> Outline every element</label>
          <button id="wb-playground" title="A consequence-free sandbox-within-the-sandbox: click through every style property on sample elements">⚗ Style playground</button>
          <hr>
          <button id="wb-reset" title="Reset to the default example project"><i class="ms-Icon ms-Icon--EraseTool"></i> Reset to default example</button>
        </div>
      </div>
    </div>
  </header>
  <main class="wb-layout" id="wb-layout">
    <aside class="wb-pane wb-pane-palette" id="wb-pane-palette">
      <h2><span class="wb-pane-title">Palette</span>
        <button id="wb-palette-toggle" title="Collapse to icons — drag still works; hover for names">⮜</button>
      </h2>
      <div id="wb-palette"></div>
    </aside>
    <div class="wb-resizer" data-col="palette" title="Drag to resize"></div>
    <aside class="wb-pane wb-pane-tree">
      <h2>Structure</h2>
      <div id="wb-tree"></div>
    </aside>
    <div class="wb-resizer" data-col="tree" title="Drag to resize"></div>
    <section class="wb-pane wb-pane-canvas">
      <h2>Preview <span class="wb-hint">click an element to select · drag palette items in</span>
        <label class="wb-check wb-preview-titlecol" id="wb-titlecol-label" title="Show the Title context column next to your formatted column — uncheck to preview the formatter cell alone"><input type="checkbox" id="wb-titlecol" checked> Title column</label>
      </h2>
      <div id="wb-canvas" class="wb-canvas"></div>
    </section>
    <div class="wb-resizer" data-col="side" title="Drag to resize"></div>
    <aside class="wb-pane wb-pane-side" id="wb-pane-side">
      <div class="wb-side-rail" title="Hover to open the panel — it stays open until you click somewhere else">◧<span>panel</span></div>
      <nav class="wb-tabs">
        <button data-tab="inspector" class="active">Inspector</button>
        <button data-tab="json" class="wb-adv">JSON</button>
        <button data-tab="data">Data</button>
        <button id="wb-side-peek" title="Auto-hide: shrink this pane to a rail; hover the rail to open it, click anywhere else to close">📌</button>
        <button id="wb-side-max" title="Maximize this pane — room for editing data and JSON">⛶</button>
      </nav>
      <div id="wb-tab-inspector" class="wb-tab active"></div>
      <div id="wb-tab-json" class="wb-tab"></div>
      <div id="wb-tab-data" class="wb-tab"></div>
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
  mode: 'basic' | 'advanced';
  titleCol: boolean;
}
const uiPrefs: UiPrefs = {
  cols: { palette: 220, tree: 250, side: 360 },
  paletteCollapsed: false,
  sideMode: 'normal',
  mode: 'basic',
  titleCol: true,
  ...JSON.parse(localStorage.getItem('wb-ui-prefs') ?? '{}'),
};
const saveUiPrefs = () => {
  try { localStorage.setItem('wb-ui-prefs', JSON.stringify(uiPrefs)); } catch { /* private mode */ }
};
const sidePane = document.getElementById('wb-pane-side')!;
const applyLayout = () => {
  const p = uiPrefs.paletteCollapsed ? 58 : uiPrefs.cols.palette;
  const side = uiPrefs.sideMode === 'peek' ? 30
    : uiPrefs.sideMode === 'max' ? Math.max(560, Math.round(window.innerWidth * 0.62))
    : uiPrefs.cols.side;
  layout.style.gridTemplateColumns = `${p}px 5px ${uiPrefs.cols.tree}px 5px 1fr 5px ${side}px`;
  document.getElementById('wb-pane-palette')!.classList.toggle('wb-collapsed', uiPrefs.paletteCollapsed);
  (document.getElementById('wb-palette-toggle') as HTMLButtonElement).textContent = uiPrefs.paletteCollapsed ? '⮞' : '⮜';
  sidePane.classList.toggle('wb-peek', uiPrefs.sideMode === 'peek');
  if (uiPrefs.sideMode !== 'peek') sidePane.classList.remove('wb-peek-open');
  sidePane.style.setProperty('--wb-side-w', `${uiPrefs.cols.side}px`);
  document.getElementById('wb-side-peek')!.classList.toggle('active', uiPrefs.sideMode === 'peek');
  document.getElementById('wb-side-max')!.classList.toggle('active', uiPrefs.sideMode === 'max');
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
document.getElementById('wb-palette-toggle')!.addEventListener('click', () => {
  uiPrefs.paletteCollapsed = !uiPrefs.paletteCollapsed;
  applyLayout();
  saveUiPrefs();
});
for (const resizer of layout.querySelectorAll<HTMLElement>('.wb-resizer')) {
  const col = resizer.dataset.col as keyof UiPrefs['cols'];
  resizer.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    resizer.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const startW = uiPrefs.cols[col];
    if (col === 'palette' && uiPrefs.paletteCollapsed) return;
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

// ─── basic / advanced mode ──────────────────────────────────────────────────
// Basic (the default) hides the power-user surface: the raw JSON tab, the
// doc switcher, outlines, and the inspector/data sections marked `.wb-adv`.
// Sections that are marked `.wb-adv-active` (the element already uses the
// feature) stay visible in basic so nothing becomes uneditable.
const modeButtons = [...document.querySelectorAll<HTMLButtonElement>('#wb-mode button')];
const applyMode = () => {
  const basic = uiPrefs.mode === 'basic';
  document.body.classList.toggle('wb-basic', basic);
  for (const b of modeButtons) b.classList.toggle('active', b.dataset.mode === uiPrefs.mode);
  // never leave a hidden tab active — fall back to the inspector
  const activeTab = app.querySelector<HTMLButtonElement>('.wb-tabs button[data-tab].active');
  if (basic && activeTab?.classList.contains('wb-adv')) {
    app.querySelector<HTMLButtonElement>('.wb-tabs button[data-tab="inspector"]')!.click();
  }
};
for (const b of modeButtons) {
  b.addEventListener('click', () => {
    if (uiPrefs.mode === b.dataset.mode) return;
    uiPrefs.mode = b.dataset.mode as UiPrefs['mode'];
    applyMode();
    saveUiPrefs();
    toast(uiPrefs.mode === 'basic'
      ? 'Basic mode — drop in ready-made pieces and arrange them. Everything is click-only and undoable.'
      : 'Advanced mode — full surface: every preset, all properties, JSON tab, loops, actions, cards, CFRs, tenant theme.');
  });
}
applyMode();

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
  document.getElementById('wb-theme-label')!.textContent =
    state.themeMode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
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
    : `Same element tree, new wrapper: this formatter now lays out the whole ${kindSel.value === 'row' ? 'row' : 'tile'} and can embed column formatters via references.`);
});
state.subscribe((reason) => {
  if (reason === 'load' || reason === 'kind') kindSel.value = state.doc.kind;
});

// workspace switcher: main formatter ⇄ registered column formatters
const activeDocSel = document.getElementById('wb-activedoc') as HTMLSelectElement;
const refreshActiveDocSel = () => {
  activeDocSel.innerHTML = '';
  const main = document.createElement('option');
  main.value = 'main';
  main.textContent = state.mainDocLabel();
  activeDocSel.appendChild(main);
  for (const name of Object.keys(state.columnRefs)) {
    const o = document.createElement('option');
    o.value = name;
    o.textContent = `Column: ${name}`;
    activeDocSel.appendChild(o);
  }
  activeDocSel.value = state.activeDocKey;
  // wrapper kind/example only make sense on the main formatter
  kindSel.disabled = state.activeDocKey !== 'main';
  exampleSel.disabled = state.activeDocKey !== 'main';
};
activeDocSel.addEventListener('change', () => {
  if (activeDocSel.value === 'main') state.openMain();
  else state.openColumnRef(activeDocSel.value);
  toast(activeDocSel.value === 'main'
    ? 'Editing the main formatter — CFRs reflect your column edits'
    : `Editing the ${activeDocSel.value} column formatter`);
});
state.subscribe((reason) => {
  if (reason === 'data' || reason === 'load' || reason === 'kind') refreshActiveDocSel();
});

// one-click copy of whatever is being edited
document.getElementById('wb-copy')!.addEventListener('click', async () => {
  const { exportJson } = await import('./core/serializer');
  await navigator.clipboard.writeText(exportJson(state.doc, { sanitizeWhitespace: true }));
  toast(state.activeDocKey === 'main'
    ? 'Main formatter JSON copied — paste into the view\'s Format pane'
    : `${state.activeDocKey} column formatter JSON copied — paste into that column's Format pane`);
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
document.getElementById('wb-undo')!.addEventListener('click', () => state.undo());
document.getElementById('wb-redo')!.addEventListener('click', () => state.redo());
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
mountTree(document.getElementById('wb-tree')!);
const canvas = mountCanvas(document.getElementById('wb-canvas')!, toast);
mountInspector(document.getElementById('wb-tab-inspector')!);
const jsonPanel = mountJsonPanel(document.getElementById('wb-tab-json')!, toast);
mountDataPanel(document.getElementById('wb-tab-data')!, toast);

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
refreshActiveDocSel();
kindSel.value = state.doc.kind; // restore() emits 'load' before the sync subscriber exists

if (restored) toast('Restored your autosaved project');
