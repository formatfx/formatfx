/**
 * editor/templateModal.ts — the ROW VIEW BUILDER shell. Opens on the wireframe
 * GALLERY (pick a pre-built zone layout) unless the canvas already holds a
 * layout the builder produced — then it REOPENS it as editable zones
 * (configFromView's rebuild-verify gate guarantees losslessness).
 *
 * The editor resembles the app's Left Edit Pane: a left SIDE column with the
 * zone TREE on top and the contextual INSPECTOR beneath it (always left — the
 * old dock toggle is gone), the CHIPS bar pinned above, and the PREVIEW canvas
 * with the width scrubber filling the rest.
 *
 * Every gesture funnels through commit(), which feeds the MODAL-LOCAL
 * undo/redo stack (Ctrl/Cmd+Z, Shift for redo, plus ↶/↷ buttons) — cheap
 * because configs are immutable. The modal touches the document only on Apply
 * (one undoable mutation), so no in-modal gesture can corrupt a formatter —
 * the worst case is Cancel.
 *
 * The pure brain (wireframes, zones, style precedence, kebab, ops, the
 * round-trip parser) lives in rowTemplates.ts; the region painters in
 * templatePreview.ts / templateInspector.ts.
 */
import { state } from './state';
import { isPureGrid } from './gridScaffold';
import { createOverlay, type OverlayHandle } from './overlay';
import { themePalette } from '../core/theme';
import {
  buildTemplateView, defaultConfigFor, applyBlocker, configFromView,
  addZone, insertZone, removeZone, moveZone, patchZone, newZone,
  addItem, removeItem, moveItem, patchItem,
  newFieldItem, newComponentItem, nextZoneSize,
  type RowTemplateConfig,
} from './rowTemplates';
import {
  BUILTIN_COMPONENTS, loadComponents, bestGuessMapping, componentKind,
  COMPONENTS_KEY, type ComponentDef,
} from './components';
import { renderChips, renderPreview, renderZoneTree } from './templatePreview';
import { renderInspector } from './templateInspector';
import { el, type ModalApi, type ModalUI, type Selection } from './templateUi';

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
  // zones. Anything it can't represent faithfully → the gallery, with an
  // honest note.
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
    stageWidth: null,
    foreignRow: !editingExisting && state.doc.kind === 'row',
  };
  /** Has the maker changed anything since the last wireframe pick? Re-picking
   *  over untouched seeds shouldn't nag; re-picking over real work (including
   *  a reopened layout) confirms. */
  let dirty = editingExisting;

  // ── modal-local undo/redo: immutable configs make this a pair of arrays ──
  const past: RowTemplateConfig[] = [];
  const future: RowTemplateConfig[] = [];

  let handle: OverlayHandle;
  handle = createOverlay('wb-template-modal-overlay', () => close());
  const overlay = handle.overlay;
  const modal = el('div', 'wb-template-modal');
  const chips = el('div', 'wb-template-fields');
  const main = el('div', 'wb-template-main');
  // the Left-Edit-Pane shape: tree over inspector, always on the left
  const side = el('div', 'wb-template-side');
  const treeHost = el('div', 'wb-template-treehost');
  const inspector = el('div', 'wb-template-inspector');
  side.append(treeHost, inspector);
  const preview = el('div', 'wb-template-preview');
  main.append(side, preview);
  modal.append(chips, main);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  // Ctrl/Cmd+Z (+Shift = redo, Ctrl+Y = redo) while the builder is open.
  // Capture-phase so the app's own undo never sees it; text inputs keep their
  // native editing undo (the browser owns Z inside a field).
  const undoKeys = (e: KeyboardEvent): void => {
    if (!(e.ctrlKey || e.metaKey)) return;
    const key = e.key.toLowerCase();
    if (key !== 'z' && key !== 'y') return;
    const t = e.target as HTMLElement | null;
    // editable surfaces keep their native editing undo (same guard as canvas.ts)
    if (t?.closest?.('input, textarea, select, [contenteditable], dialog')) return;
    e.preventDefault();
    e.stopPropagation();
    if (key === 'y' || e.shiftKey) redo();
    else undo();
  };
  document.addEventListener('keydown', undoKeys, true);
  function close(): void {
    document.removeEventListener('keydown', undoKeys, true);
    handle.close();
  }

  const palette = (): Record<string, string> => themePalette(state.themeMode);

  function rerender(): void {
    modal.dataset.stage = ui.stage;
    modal.dataset.mode = ui.mode;
    modal.dataset.peek = modal.dataset.peek ?? '';
    renderChips(chips, ui, api);
    renderZoneTree(treeHost, ui, api);
    renderPreview(preview, ui, api);
    renderInspector(inspector, ui, api);
  }

  /** Drop a selection that no longer points at anything after an undo/redo. */
  function sanitizeSelection(): void {
    const sel = ui.selected;
    if (!sel) return;
    const zone = ui.config.zones[sel.zone];
    if (!zone || (sel.item !== null && !zone.items[sel.item])) ui.selected = null;
  }

  /** THE mutation chokepoint: pushes undo history, invalidates redo. */
  function commit(next: RowTemplateConfig, sel?: Selection): void {
    if (next === ui.config) return; // guarded no-op from a pure op — no history noise
    past.push(ui.config);
    future.length = 0;
    ui.config = next;
    if (sel !== undefined) ui.selected = sel;
    dirty = true;
    sanitizeSelection();
    rerender();
  }

  function undo(): void {
    const prev = past.pop();
    if (!prev) return;
    future.push(ui.config);
    ui.config = prev;
    sanitizeSelection();
    rerender();
  }

  function redo(): void {
    const next = future.pop();
    if (!next) return;
    past.push(ui.config);
    ui.config = next;
    sanitizeSelection();
    rerender();
  }

  const setConfig = (next: RowTemplateConfig): void => commit(next);

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
    close();
  }

  const componentItemFor = (componentId: string) => {
    const def = comps.find((c) => c.id === componentId);
    return def ? newComponentItem(def.id, bestGuessMapping(def, state.fields)) : null;
  };

  const api: ModalApi = {
    selectZone: (zi) => { ui.selected = { zone: zi, item: null }; rerender(); },
    selectItem: (zi, ii) => { ui.selected = { zone: zi, item: ii }; rerender(); },
    selectKebab: () => { ui.selected = null; rerender(); }, // row view holds the kebab section
    deselect: () => { if (ui.selected !== null) { ui.selected = null; rerender(); } },
    dropField: (zi, field, at) =>
      commit(addItem(ui.config, zi, newFieldItem(field, ui.config.zones[zi]), at)),
    dropComponent: (zi, componentId, at) => {
      const item = componentItemFor(componentId);
      if (!item) return;
      const next = addItem(ui.config, zi, item, at);
      // select the new item so its slot mapping is immediately visible
      const ins = at === undefined ? next.zones[zi].items.length - 1 : Math.min(at, next.zones[zi].items.length - 1);
      commit(next, { zone: zi, item: ins });
    },
    addEmptyZone: () => {
      const next = addZone(ui.config, newZone(`Zone ${ui.config.zones.length + 1}`));
      // select it so the inspector (name field first) opens ready to shape it
      commit(next, { zone: next.zones.length - 1, item: null });
    },
    newZoneAt: (at, { field, componentId, move }) => {
      let next = insertZone(ui.config, at, newZone(`Zone ${ui.config.zones.length + 1}`));
      if (field) next = addItem(next, at, newFieldItem(field, next.zones[at]));
      if (componentId) {
        const item = componentItemFor(componentId);
        if (item) next = addItem(next, at, item);
      }
      if (move) {
        // the insert shifted the source zone when it sits at/after the new slot
        const fromZone = move.zone + (at <= move.zone ? 1 : 0);
        next = moveItem(next, fromZone, move.item, at, 0);
      }
      commit(next, { zone: at, item: next.zones[at].items.length ? 0 : null });
    },
    removeZone: (zi) => commit(removeZone(ui.config, zi), null),
    reorderZone: (from, to) => commit(moveZone(ui.config, from, to), { zone: to, item: null }),
    cycleZoneSize: (zi) => commit(patchZone(ui.config, zi, { size: nextZoneSize(ui.config.zones[zi].size) })),
    patchZone: (zi, patch) => commit(patchZone(ui.config, zi, patch)),
    removeItem: (zi, ii) => commit(removeItem(ui.config, zi, ii), { zone: zi, item: null }),
    moveItem: (fz, fi, tz, ti) => {
      const next = moveItem(ui.config, fz, fi, tz, ti);
      if (next === ui.config) return; // guarded no-op — don't dirty or rerender
      commit(next, { zone: tz, item: Math.min(ti, next.zones[tz].items.length - 1) });
    },
    patchItem: (zi, ii, patch) => commit(patchItem(ui.config, zi, ii, patch)),
    setConfig,
    pickWireframe: (id) => {
      if (dirty && ui.config.zones.some((z) => z.items.length)
        && !confirm('Start over from this layout? Your current zones are replaced (undo inside the builder brings them back).')) return;
      ui.stage = 'edit';
      if (dirty) {
        commit(defaultConfigFor(id, state.fields), null); // re-pick over work: undoable
      } else {
        // entering from an untouched gallery = the undo BASELINE, not a step
        ui.config = defaultConfigFor(id, state.fields);
        ui.selected = null;
        past.length = 0;
        future.length = 0;
        rerender();
      }
      dirty = false;
    },
    openGallery: () => { ui.stage = 'pick'; rerender(); },
    setMode: (m) => { ui.mode = m; rerender(); },
    setStageWidth: (w) => { ui.stageWidth = w; rerender(); },
    // hover-transient: a dataset stamp only — a rerender here would rebuild the
    // control under the pointer and make the peek flicker
    setPeek: (p) => { modal.dataset.peek = p ?? ''; },
    undo,
    redo,
    canUndo: () => past.length > 0,
    canRedo: () => future.length > 0,
    apply: doApply,
    cancel: () => close(),
    notify: onToast,
    palette,
    components: () => comps,
    applyBlocker: () => applyBlocker(ui.config, comps),
  };

  rerender();
}
