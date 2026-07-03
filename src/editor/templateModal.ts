/**
 * editor/templateModal.ts — the ROW VIEW BUILDER shell. Opens on the wireframe
 * GALLERY (pick a pre-built zone layout), then three regions stacked
 * CHIPS (fields + components, the drag sources) → PREVIEW (the zone canvas,
 * with the width scrubber) → INSPECTOR (contextual: zone / item / row), with
 * the inspector dockable to the left. The modal edits a local config and
 * touches the document only on Apply (one undoable mutation), so no in-modal
 * gesture can corrupt a formatter — the worst case is Cancel.
 *
 * The pure brain (wireframes, zones, style precedence, kebab, ops) lives in
 * rowTemplates.ts; the region painters in templatePreview.ts / templateInspector.ts.
 */
import { state } from './state';
import { isPureGrid } from './gridScaffold';
import { createOverlay, type OverlayHandle } from './overlay';
import { themePalette } from '../core/theme';
import {
  buildTemplateView, defaultConfigFor, applyBlocker, configFromView,
  addZone, removeZone, moveZone, patchZone, newZone,
  addItem, removeItem, moveItem, patchItem,
  newFieldItem, newComponentItem, nextZoneSize,
  type RowTemplateConfig,
} from './rowTemplates';
import {
  BUILTIN_COMPONENTS, loadComponents, bestGuessMapping, componentKind,
  COMPONENTS_KEY, type ComponentDef,
} from './components';
import { renderChips, renderPreview } from './templatePreview';
import { renderInspector } from './templateInspector';
import { el, type Dock, type ModalApi, type ModalUI } from './templateUi';

/** New, additive localStorage key — remembers the inspector dock. The frozen-keys
 *  rule forbids RENAMES, not new keys; a missing/garbage value falls back to bottom. */
const DOCK_KEY = 'wb-template-inspector-dock';
function readDock(): Dock {
  try { return localStorage.getItem(DOCK_KEY) === 'left' ? 'left' : 'bottom'; } catch { return 'bottom'; }
}
function writeDock(d: Dock): void {
  try { localStorage.setItem(DOCK_KEY, d); } catch { /* private mode — dock just won't persist */ }
}

/** Element-kind components the builder offers as chips: built-ins + the maker's
 *  saved ones (read via the pure store loader — row components replace the whole
 *  view and stay in the ⬡ library where that copy is honest). */
function elementComponents(): ComponentDef[] {
  let customs: ComponentDef[] = [];
  try { customs = loadComponents(localStorage.getItem(COMPONENTS_KEY)); } catch { /* private mode */ }
  return [...BUILTIN_COMPONENTS, ...customs].filter((c) => componentKind(c) === 'element');
}

export function openTemplateModal(onToast: (m: string) => void): void {
  const comps = elementComponents(); // cached per open — chips, previews, and Apply all agree
  // Reopen, don't restart: a row view the builder produced parses back into
  // zones (configFromView's rebuild-verify gate guarantees losslessness), so
  // the builder opens straight onto the editable layout. Anything it can't
  // represent faithfully → the gallery, with an honest note.
  const rawRowClass = state.doc.viewExtras?.additionalRowClass;
  const reopened = state.doc.kind === 'row'
    ? configFromView(state.doc.root, typeof rawRowClass === 'string' ? rawRowClass : undefined,
      state.fields, state.columnRefs, comps)
    : null;
  const editingExisting = reopened !== null;
  const ui: ModalUI = {
    config: reopened ?? defaultConfigFor('lead-detail', state.fields),
    stage: editingExisting ? 'edit' : 'pick',
    mode: 'edit',
    selected: null,
    dock: readDock(),
    stageWidth: null,
    foreignRow: !editingExisting && state.doc.kind === 'row',
  };
  /** Has the maker changed anything since the last wireframe pick? Re-picking
   *  over untouched seeds shouldn't nag; re-picking over real work (including
   *  a reopened layout) confirms. */
  let dirty = editingExisting;

  let handle: OverlayHandle;
  handle = createOverlay('wb-template-modal-overlay', () => handle.close());
  const overlay = handle.overlay;
  const modal = el('div', 'wb-template-modal');
  const chips = el('div', 'wb-template-fields');
  const main = el('div', 'wb-template-main');
  const preview = el('div', 'wb-template-preview');
  const inspector = el('div', 'wb-template-inspector');
  main.append(preview, inspector);
  modal.append(chips, main);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  const palette = (): Record<string, string> => themePalette(state.themeMode);

  function rerender(): void {
    modal.dataset.stage = ui.stage;
    modal.dataset.dock = ui.dock;
    modal.dataset.mode = ui.mode;
    modal.dataset.peek = modal.dataset.peek ?? '';
    renderChips(chips, ui, api);
    renderPreview(preview, ui, api);
    renderInspector(inspector, ui, api);
  }

  function setConfig(next: RowTemplateConfig): void { ui.config = next; dirty = true; rerender(); }

  function doApply(): void {
    if (applyBlocker(ui.config, comps)) return;
    // structural click-safety gate: confirm only when the current layout is
    // genuinely hand-built (not a pristine grid) AND the builder didn't reopen
    // it losslessly — editing your own layout is what reopen is FOR, and a
    // wireframe re-pick over it already confirmed. Single-undo is the net.
    const overwrites = !editingExisting && state.doc.kind !== 'grid' && !isPureGrid(state.doc.root);
    if (overwrites && !confirm('Replace the current row layout with this one? Ctrl+Z reverts it in one step.')) return;
    const { root, additionalRowClass } = buildTemplateView(
      ui.config, state.fields, state.columnRefs, palette(), comps, { prune: true });
    state.applyRowTemplate(root, additionalRowClass);
    onToast(editingExisting ? 'Row layout updated' : 'Row layout applied');
    handle.close();
  }

  const api: ModalApi = {
    selectZone: (zi) => { ui.selected = { zone: zi, item: null }; rerender(); },
    selectItem: (zi, ii) => { ui.selected = { zone: zi, item: ii }; rerender(); },
    selectKebab: () => { ui.selected = null; rerender(); }, // row view holds the kebab section
    deselect: () => { if (ui.selected !== null) { ui.selected = null; rerender(); } },
    dropField: (zi, field) => setConfig(addItem(ui.config, zi, newFieldItem(field, ui.config.zones[zi]))),
    dropComponent: (zi, componentId) => {
      const def = comps.find((c) => c.id === componentId);
      if (!def) return;
      const next = addItem(ui.config, zi, newComponentItem(def.id, bestGuessMapping(def, state.fields)));
      ui.config = next;
      dirty = true;
      // select the new item so its slot mapping is immediately visible
      ui.selected = { zone: zi, item: next.zones[zi].items.length - 1 };
      rerender();
    },
    addEmptyZone: () => {
      const next = addZone(ui.config, newZone(`Zone ${ui.config.zones.length + 1}`));
      ui.config = next;
      dirty = true;
      // select it so the inspector (name field first) opens ready to shape it
      ui.selected = { zone: next.zones.length - 1, item: null };
      rerender();
    },
    removeZone: (zi) => { ui.config = removeZone(ui.config, zi); dirty = true; ui.selected = null; rerender(); },
    reorderZone: (from, to) => { ui.config = moveZone(ui.config, from, to); dirty = true; ui.selected = { zone: to, item: null }; rerender(); },
    cycleZoneSize: (zi) => setConfig(patchZone(ui.config, zi, { size: nextZoneSize(ui.config.zones[zi].size) })),
    patchZone: (zi, patch) => setConfig(patchZone(ui.config, zi, patch)),
    removeItem: (zi, ii) => { ui.config = removeItem(ui.config, zi, ii); dirty = true; ui.selected = { zone: zi, item: null }; rerender(); },
    moveItem: (fz, fi, tz, ti) => {
      const next = moveItem(ui.config, fz, fi, tz, ti);
      if (next === ui.config) return; // guarded no-op — don't dirty or rerender
      ui.config = next;
      dirty = true;
      ui.selected = { zone: tz, item: Math.min(ti, next.zones[tz].items.length - 1) };
      rerender();
    },
    patchItem: (zi, ii, patch) => setConfig(patchItem(ui.config, zi, ii, patch)),
    setConfig,
    pickWireframe: (id) => {
      if (dirty && ui.config.zones.some((z) => z.items.length)
        && !confirm('Start over from this layout? Your current zones are replaced.')) return;
      ui.config = defaultConfigFor(id, state.fields);
      ui.selected = null;
      ui.stage = 'edit';
      dirty = false;
      rerender();
    },
    openGallery: () => { ui.stage = 'pick'; rerender(); },
    setMode: (m) => { ui.mode = m; rerender(); },
    toggleDock: () => { ui.dock = ui.dock === 'bottom' ? 'left' : 'bottom'; writeDock(ui.dock); rerender(); },
    setStageWidth: (w) => { ui.stageWidth = w; rerender(); },
    // hover-transient: a dataset stamp only — a rerender here would rebuild the
    // control under the pointer and make the peek flicker
    setPeek: (p) => { modal.dataset.peek = p ?? ''; },
    apply: doApply,
    cancel: () => handle.close(),
    notify: onToast,
    palette,
    components: () => comps,
    applyBlocker: () => applyBlocker(ui.config, comps),
  };

  rerender();
}
