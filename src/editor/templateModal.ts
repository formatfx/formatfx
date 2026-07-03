/**
 * editor/templateModal.ts — the ROW VIEW BUILDER shell. Opens on the wireframe
 * GALLERY (pick a pre-built zone layout) unless the canvas already holds a
 * layout the builder produced — then it REOPENS it as editable zones
 * (configFromView's rebuild-verify gate guarantees losslessness).
 *
 * The editor resembles the app's Left Edit Pane: a TOP bar with the 2×2
 * action grid (↶ ↷ / Cancel Save) beside the FIELDS/COMPONENTS chips, then a
 * left SIDE column with the zone TREE over the contextual INSPECTOR, and the
 * PREVIEW canvas — the editable row with the always-live rows right below it
 * (no Edit/Preview toggle; both are simply on screen).
 *
 * Zones NEST — every selection and drag is a ZonePath, and every gesture
 * funnels through commit(), which feeds the MODAL-LOCAL undo/redo stack
 * (Ctrl/Cmd+Z, Shift for redo) — cheap because configs are immutable. The
 * modal touches the document only on Save (one undoable mutation), so no
 * in-modal gesture can corrupt a formatter — the worst case is Cancel.
 *
 * The pure brain (wireframes, zones, style precedence, kebab, path ops, the
 * round-trip parser) lives in rowTemplates.ts; the region painters in
 * templatePreview.ts / templateInspector.ts.
 */
import { state } from './state';
import { isPureGrid } from './gridScaffold';
import { createOverlay, type OverlayHandle } from './overlay';
import { themePalette } from '../core/theme';
import {
  buildTemplateView, defaultConfigFor, applyBlocker, configFromView,
  addZone, insertZone, newZone, zoneAt, nodeAt,
  addItemAt, removeNode, moveNode, patchZoneAt, patchItemAt, nextZoneSize,
  newFieldItem, newComponentItem,
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
  const comps = elementComponents(); // cached per open — chips, previews, and Save all agree
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
  // TOP bar: the 2×2 action grid (undo/redo over cancel/save) beside the chips
  const top = el('div', 'wb-template-top');
  const actions = el('div', 'wb-template-actions');
  const chips = el('div', 'wb-template-fields');
  top.append(actions, chips);
  const main = el('div', 'wb-template-main');
  // the Left-Edit-Pane shape: tree over inspector, always on the left
  const side = el('div', 'wb-template-side');
  const treeHost = el('div', 'wb-template-treehost');
  const inspector = el('div', 'wb-template-inspector');
  side.append(treeHost, inspector);
  const preview = el('div', 'wb-template-preview');
  main.append(side, preview);
  modal.append(top, main);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  // Ctrl/Cmd+Z (+Shift = redo, Ctrl+Y = redo) while the builder is open.
  // Capture-phase so the app's own undo never sees it; editable surfaces keep
  // their native editing undo (same guard as canvas.ts).
  const undoKeys = (e: KeyboardEvent): void => {
    if (!(e.ctrlKey || e.metaKey)) return;
    const key = e.key.toLowerCase();
    if (key !== 'z' && key !== 'y') return;
    const t = e.target as HTMLElement | null;
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

  function renderActions(): void {
    actions.innerHTML = '';
    if (ui.stage === 'pick') return; // the gallery has no edit actions
    const mk = (cls: string, label: string, title: string, disabled: boolean, onClick: () => void, ariaLabel?: string): HTMLButtonElement => {
      const b = el('button', `wb-template-action ${cls}`, label) as HTMLButtonElement;
      b.type = 'button';
      b.title = title;
      // icon-only buttons need an explicit accessible name — title alone is
      // not reliably announced (same convention as the leftPane toolbar)
      if (ariaLabel) b.setAttribute('aria-label', ariaLabel);
      b.disabled = disabled;
      b.addEventListener('click', onClick);
      return b;
    };
    const blocker = applyBlocker(ui.config, comps);
    actions.append(
      mk('wb-template-undo', '↶', 'Undo (Ctrl+Z) — inside the builder only', past.length === 0, undo, 'Undo'),
      mk('wb-template-redo', '↷', 'Redo (Ctrl+Shift+Z)', future.length === 0, redo, 'Redo'),
      mk('wb-template-cancel', 'Cancel', 'Close without touching the view', false, () => close()),
      mk('wb-template-apply', 'Save', blocker ?? 'Save this layout to the view (one Ctrl+Z on the canvas reverts it)', Boolean(blocker), doApply),
    );
  }

  function rerender(): void {
    modal.dataset.stage = ui.stage;
    modal.dataset.peek = modal.dataset.peek ?? '';
    renderActions();
    renderChips(chips, ui, api);
    renderZoneTree(treeHost, ui, api);
    renderPreview(preview, ui, api);
    renderInspector(inspector, ui, api);
  }

  /** Drop a selection that no longer points at anything after an undo/redo. */
  function sanitizeSelection(): void {
    if (ui.selected && !nodeAt(ui.config, ui.selected)) ui.selected = null;
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
    select: (path) => { ui.selected = path; rerender(); },
    selectKebab: () => { ui.selected = null; rerender(); }, // row view holds the kebab section
    deselect: () => { if (ui.selected !== null) { ui.selected = null; rerender(); } },
    dropField: (zonePath, field, at) => {
      const zone = zoneAt(ui.config, zonePath);
      if (!zone) return;
      commit(addItemAt(ui.config, zonePath, newFieldItem(field, zone), at));
    },
    dropComponent: (zonePath, componentId, at) => {
      const zone = zoneAt(ui.config, zonePath);
      const item = componentItemFor(componentId);
      if (!zone || !item) return;
      const next = addItemAt(ui.config, zonePath, item, at);
      if (next === ui.config) return;
      // select the new item so its slot mapping is immediately visible
      const count = zoneAt(next, zonePath)!.items.length;
      const ins = at === undefined ? count - 1 : Math.max(0, Math.min(at, count - 1));
      commit(next, [...zonePath, ins]);
    },
    addEmptyZone: () => {
      const next = addZone(ui.config, newZone(`Zone ${ui.config.zones.length + 1}`));
      // select it so the inspector (name field first) opens ready to shape it
      commit(next, [next.zones.length - 1]);
    },
    addNestedZone: (zonePath) => {
      const parent = zoneAt(ui.config, zonePath);
      if (!parent) return;
      const next = addItemAt(ui.config, zonePath, { kind: 'zone', zone: newZone(`${parent.label} inner`) });
      if (next === ui.config) return;
      commit(next, [...zonePath, zoneAt(next, zonePath)!.items.length - 1]);
    },
    newRootZoneAt: (at, { field, componentId }) => {
      let next = insertZone(ui.config, at, newZone(`Zone ${ui.config.zones.length + 1}`));
      if (field) next = addItemAt(next, [at], newFieldItem(field, next.zones[at]));
      if (componentId) {
        const item = componentItemFor(componentId);
        if (item) next = addItemAt(next, [at], item);
      }
      commit(next, next.zones[at].items.length ? [at, 0] : [at]);
    },
    moveNode: (from, toZone, toIndex) => {
      const next = moveNode(ui.config, from, toZone, toIndex);
      if (next === ui.config) return; // guarded no-op — don't dirty or rerender
      // keep the MOVED node selected: it now sits in toZone (or at root)
      const landed = toZone.length === 0
        ? [Math.max(0, Math.min(toIndex, next.zones.length - 1))]
        : (() => {
          // re-aim toZone the same way moveNode did after the removal
          const adj = toZone.slice();
          const d = from.length - 1;
          if (adj.length > d && from.slice(0, d).every((v, i) => adj[i] === v) && adj[d] > from[d]) adj[d] -= 1;
          const count = zoneAt(next, adj)?.items.length ?? 1;
          return [...adj, Math.max(0, Math.min(toIndex, count - 1))];
        })();
      commit(next, landed);
    },
    removeNode: (path) => commit(removeNode(ui.config, path), path.length > 1 ? path.slice(0, -1) : null),
    cycleZoneSize: (zonePath) => {
      const zone = zoneAt(ui.config, zonePath);
      if (!zone) return;
      commit(patchZoneAt(ui.config, zonePath, { size: nextZoneSize(zone.size) }));
    },
    patchZone: (zonePath, patch) => commit(patchZoneAt(ui.config, zonePath, patch)),
    patchItem: (itemPath, patch) => commit(patchItemAt(ui.config, itemPath, patch)),
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
