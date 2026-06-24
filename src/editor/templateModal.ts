/**
 * editor/templateModal.ts — the row-template modal SHELL. Three regions stacked
 * FIELDS (drag source) → PREVIEW (the editing canvas) → INSPECTOR (contextual),
 * with the inspector dockable to the left. The modal edits a local config and
 * touches the document only on Apply (one undoable mutation), so no in-modal
 * gesture can corrupt a formatter — the worst case is Cancel.
 *
 * The pure brain (skeletons, style precedence, kebab, area ops) lives in
 * rowTemplates.ts; the region painters in templatePreview.ts / templateInspector.ts.
 */
import { state } from './state';
import { isPureGrid } from './gridScaffold';
import { createOverlay, type OverlayHandle } from './overlay';
import { themePalette } from '../core/theme';
import {
  buildTemplateView, defaultConfigFor,
  addArea, removeArea, moveArea, setAreaField, patchArea, nextWeight,
  type RowTemplateConfig,
} from './rowTemplates';
import { renderFields, renderPreview } from './templatePreview';
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

export function openTemplateModal(onToast: (m: string) => void): void {
  const ui: ModalUI = {
    config: defaultConfigFor('split', state.fields),
    mode: 'edit',
    selected: null,
    dock: readDock(),
  };

  let handle: OverlayHandle;
  handle = createOverlay('wb-template-modal-overlay', () => handle.close());
  const overlay = handle.overlay;
  const modal = el('div', 'wb-template-modal');
  const fields = el('div', 'wb-template-fields');
  const main = el('div', 'wb-template-main');
  const preview = el('div', 'wb-template-preview');
  const inspector = el('div', 'wb-template-inspector');
  main.append(preview, inspector);
  modal.append(fields, main);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  const palette = (): Record<string, string> => themePalette(state.themeMode);
  const canApply = (): boolean => ui.config.areas.some((a) => a.fieldName);

  function rerender(): void {
    modal.dataset.dock = ui.dock;
    modal.dataset.mode = ui.mode;
    renderFields(fields, ui, api);
    renderPreview(preview, ui, api);
    renderInspector(inspector, ui, api);
  }

  function setConfig(next: RowTemplateConfig): void { ui.config = next; rerender(); }

  function doApply(): void {
    if (!canApply()) return;
    // structural click-safety gate: confirm only when the current layout is
    // genuinely hand-built (not a pristine grid). Single-undo is the safety net.
    const dirty = state.doc.kind !== 'grid' && !isPureGrid(state.doc.root);
    if (dirty && !confirm('Replace the current row layout with this template? Ctrl+Z reverts it in one step.')) return;
    const { root, additionalRowClass } = buildTemplateView(ui.config, state.fields, state.columnRefs, palette());
    state.applyRowTemplate(root, additionalRowClass);
    onToast('Template applied');
    handle.close();
  }

  const api: ModalApi = {
    select: (i) => { ui.selected = i; rerender(); },
    selectKebab: () => { ui.selected = null; rerender(); }, // row view holds the kebab section
    deselect: () => { if (ui.selected !== null) { ui.selected = null; rerender(); } },
    assign: (i, field) => setConfig(setAreaField(ui.config, i, field)),
    add: (field) => setConfig(addArea(ui.config, field)),
    remove: (i) => { ui.config = removeArea(ui.config, i); ui.selected = null; rerender(); },
    reorder: (from, to) => { ui.config = moveArea(ui.config, from, to); ui.selected = to; rerender(); },
    cycleWeight: (i) => setConfig(patchArea(ui.config, i, { weight: nextWeight(ui.config.areas[i].weight) })),
    patchArea: (i, patch) => setConfig(patchArea(ui.config, i, patch)),
    setConfig,
    reseed: (id) => {
      if (ui.config.areas.some((a) => a.fieldName) && !confirm('Replace the current blocks with the chosen skeleton?')) return;
      ui.config = defaultConfigFor(id, state.fields);
      ui.selected = null;
      rerender();
    },
    setMode: (m) => { ui.mode = m; rerender(); },
    toggleDock: () => { ui.dock = ui.dock === 'bottom' ? 'left' : 'bottom'; writeDock(ui.dock); rerender(); },
    apply: doApply,
    cancel: () => handle.close(),
    notify: onToast,
    palette,
    canApply,
  };

  rerender();
}
