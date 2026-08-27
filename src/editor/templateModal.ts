// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Sam Yost

/**
 * editor/templateModal.ts — the ROW VIEW (and TILE) BUILDER shell, and the
 * ONE "New view" experience. Opens on the LAYOUT SELECTOR (stage 'pick'):
 * a narrow left list of every pre-built layout — row AND tile, one door —
 * that drills into a details pane on selection, beside a wide LIVE preview
 * rendered with the maker's real sample rows. Next enters the zone editor
 * (stage 'edit'); Back returns to the selector with the config KEPT — Next
 * on the same layout resumes it, so browsing never loses work. The modal
 * skips the selector only when the canvas already holds a layout the builder
 * produced — then it REOPENS it as editable zones (configFromView's
 * rebuild-verify gate guarantees losslessness). The config's TARGET decides
 * what the commit button writes: applyRowTemplate or applyTileTemplate —
 * or, when creating, state.createView — either way one undoable mutation.
 *
 * CHROME GEOMETRY (deliberate, mirrors the app): the top bar holds the title
 * with undo/redo CENTERED — the same spot the main topbar keeps them; the
 * chips bar sits below it (edit only); the footer holds the journey buttons
 * bottom-right in BOTH stages — Back/Next in the selector, Cancel/Create
 * (or Save when editing an existing sheet) in the editor.
 *
 * Zones NEST — every selection and drag is a ZonePath, and every gesture
 * funnels through commit(), which feeds the MODAL-LOCAL undo/redo stack
 * (Ctrl/Cmd+Z, Shift for redo) — cheap because configs are immutable. The
 * modal touches the document only on Create/Save (one undoable mutation), so
 * no in-modal gesture can corrupt a formatter — the worst case is Cancel,
 * and even Cancel confirms first once anything was touched.
 *
 * The pure brain (wireframes, zones, style precedence, kebab, path ops, the
 * round-trip parser, summarizeConfig) lives in rowTemplates.ts; the region
 * painters in templatePreview.ts / templateInspector.ts.
 */
import { state } from './state';
import { isPureGrid } from './gridScaffold';
import { createOverlay, type OverlayHandle } from './overlay';
import { themePalette } from '../core/theme';
import {
  buildTemplateView, defaultConfigFor, applyBlocker, configFromView,
  addZone, insertZone, newZone, zoneAt, nodeAt,
  addItemAt, removeNode, moveNode, patchZoneAt, patchItemAt,
  newFieldItem, newComponentItem,
  type RowTemplateConfig, type WireframeId,
} from './rowTemplates';
import {
  BUILTIN_COMPONENTS, loadComponents, bestGuessMapping, componentKind,
  COMPONENTS_KEY, flattenComponent, type ComponentDef,
} from './components';
import { paletteComponents } from './paletteComponents';
import { renderChips, renderPreview, renderZoneTree, renderLayoutSide } from './templatePreview';
import { renderInspector } from './templateInspector';
import { el, type ModalApi, type ModalUI, type Selection } from './templateUi';

/** Element-kind components the builder offers as chips: built-ins + the maker's
 *  saved ones (read via the pure store loader — row components replace the whole
 *  view and stay in the ⬡ library where that copy is honest). Customs resolve
 *  (inline-flatten, #225) before offering — the palette defs join the resolve
 *  POOL so a custom embedding one expands, without changing the chip offer. */
function elementComponents(): ComponentDef[] {
  let customs: ComponentDef[] = [];
  try { customs = loadComponents(localStorage.getItem(COMPONENTS_KEY)); } catch { /* private mode */ }
  const pool = [...BUILTIN_COMPONENTS, ...paletteComponents(), ...customs];
  return [...BUILTIN_COMPONENTS, ...customs]
    .map((c) => flattenComponent(c, pool))
    .filter((c) => componentKind(c) === 'element');
}

export function openTemplateModal(
  onToast: (m: string) => void,
  opts: { createNew?: boolean } = {},
): void {
  const comps = elementComponents(); // cached per open — chips, previews, and Save all agree
  // Save-time routing (FLOOR-AND-SHEETS Stage 1): from the floor — or via an
  // explicit "+ New view…" — the commit button CREATES a new named sheet;
  // nothing is ever overwritten. Only with a sheet on the canvas does Save
  // replace that sheet's document.
  const creating = opts.createNew === true || state.activeDocKey !== 'main' || state.onFloor;
  // Reopen, don't restart: a row view OR tile the builder produced parses back
  // into zones. Anything it can't represent faithfully → the selector, with an
  // honest note. A create-new ask never reopens — it starts fresh.
  const rawRowClass = state.doc.viewExtras?.additionalRowClass;
  const reopened = creating ? null
    : state.doc.kind === 'row'
      ? configFromView(state.doc.root, typeof rawRowClass === 'string' ? rawRowClass : undefined,
        state.fields, state.columnLooks, comps)
      : state.doc.kind === 'tile'
        ? configFromView(state.doc.root, undefined, state.fields, state.columnLooks, comps, 'tile')
        : null;
  if (reopened?.target === 'tile') {
    // the tile box size lives on the document wrapper — reseed it from there
    reopened.tileWidth = state.doc.tileWidth ?? reopened.tileWidth;
    reopened.tileHeight = state.doc.tileHeight ?? reopened.tileHeight;
  }
  const editingExisting = reopened !== null;
  const ui: ModalUI = {
    config: reopened ?? defaultConfigFor('lead-detail', state.fields),
    stage: editingExisting ? 'edit' : 'pick',
    selected: null,
    stageWidth: null,
    foreignRow: !creating && !editingExisting && (state.doc.kind === 'row' || state.doc.kind === 'tile'),
    galleryFirst: reopened?.target ?? (state.doc.kind === 'tile' ? 'tile' : 'row'),
    pickSelected: null,
    pickDrilled: false,
  };
  /** Has the maker changed anything since the last wireframe pick? Re-picking
   *  over untouched seeds shouldn't nag; re-picking over real work (including
   *  a reopened layout) confirms. */
  let dirty = editingExisting;
  /** The wireframe of the last pick this open — null until one (a reopened
   *  config has no recoverable wireframe). Next on the same layout RESUMES
   *  instead of reseeding, so Back drops nothing. Resume identity is checked
   *  against ui.config.wireframeId (not this) so undo/redo can't desync the
   *  selector from what Next actually opens. */
  let seededFrom: WireframeId | null = null;
  /** Is there a config worth returning to untouched? (a reopened sheet, or
   *  anything seeded this open — the fresh-open placeholder doesn't count). */
  const keptConfig = (): boolean => editingExisting || seededFrom !== null;
  /** Would Next hand back ui.config exactly as left (vs reseeding)? */
  const resumesSelection = (): boolean =>
    ui.pickSelected !== null && seededFrom !== null && ui.pickSelected === ui.config.wireframeId;

  // ── modal-local undo/redo: immutable configs make this a pair of arrays ──
  const past: RowTemplateConfig[] = [];
  const future: RowTemplateConfig[] = [];

  let handle: OverlayHandle;
  handle = createOverlay('wb-template-modal-overlay', () => close());
  const overlay = handle.overlay;
  const modal = el('div', 'wb-template-modal');
  // TOP bar mirrors the app topbar's geometry: title left, undo/redo CENTERED
  // (the spot makers already know them by), a matching spacer right
  const top = el('div', 'wb-template-top');
  const title = el('div', 'wb-template-title');
  const actions = el('div', 'wb-template-actions');
  const topright = el('div', 'wb-template-topright');
  top.append(title, actions, topright);
  // the chips bar gets its own full-width row (edit stage only)
  const chipsbar = el('div', 'wb-template-chipsbar');
  const chips = el('div', 'wb-template-fields');
  chipsbar.appendChild(chips);
  const main = el('div', 'wb-template-main');
  // the Left-Edit-Pane shape: tree over inspector, always on the left —
  // in the selector the same side pane holds the layout list / details
  const side = el('div', 'wb-template-side');
  const treeHost = el('div', 'wb-template-treehost');
  const inspector = el('div', 'wb-template-inspector');
  side.append(treeHost, inspector);
  const preview = el('div', 'wb-template-preview');
  main.append(side, preview);
  // FOOTER: the journey buttons, bottom-right in BOTH stages (Back/Next ↔
  // Cancel/Create sit in the same spots)
  const foot = el('div', 'wb-template-foot');
  modal.append(top, chipsbar, main, foot);
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
    // the selector renders no config — a modal undo there would be INVISIBLE
    // work loss, and letting the event through would fire the APP's undo and
    // mutate the document behind the modal. Consume the shortcut, do nothing.
    if (ui.stage === 'pick') return;
    if (key === 'y' || e.shiftKey) redo();
    else undo();
  };
  document.addEventListener('keydown', undoKeys, true);
  /** Close, but never silently over touched work: once anything was committed
   *  (and not undone back to the baseline), Cancel / Escape / a backdrop
   *  click all confirm first. `force` skips the gate (a successful Apply
   *  already banked the work). */
  function close(force = false): void {
    if (!force && past.length > 0
      && !confirm('Discard your layout edits? Nothing has been saved to the view yet.')) return;
    document.removeEventListener('keydown', undoKeys, true);
    handle.close();
  }

  const palette = (): Record<string, string> => themePalette(state.themeMode);

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

  /** The title bar: what this modal IS on the left, undo/redo centered
   *  (edit stage only — the selector has nothing to undo). */
  function renderTop(): void {
    title.textContent = ui.stage === 'pick'
      ? (creating ? 'New view — start from a layout' : 'Start from a layout')
      : ui.config.target === 'tile' ? 'Tile layout' : 'Row layout';
    actions.innerHTML = '';
    if (ui.stage === 'pick') return;
    actions.append(
      mk('wb-template-undo', '↶', 'Undo (Ctrl+Z) — inside the builder only', past.length === 0, undo, 'Undo'),
      mk('wb-template-redo', '↷', 'Redo (Ctrl+Shift+Z)', future.length === 0, redo, 'Redo'),
    );
  }

  /** The footer: the journey buttons, bottom-right in both stages — Back/Next
   *  in the selector, Cancel/Create (or Save over an existing sheet) in the
   *  editor, so commit lives in the same spot throughout. */
  function renderFoot(): void {
    foot.innerHTML = '';
    if (ui.stage === 'pick') {
      // with nothing selected but a kept config (a reopened sheet backed out
      // to the list), Next becomes RESUME — the discoverable way home
      const resume = ui.pickSelected === null ? keptConfig() : resumesSelection();
      foot.append(
        mk('wb-template-back', 'Back', 'Back to the layout list (your selection stays previewed)',
          !ui.pickDrilled, () => api.backToList()),
        mk('wb-template-next', ui.pickSelected === null && keptConfig() ? 'Resume' : 'Next',
          resume
            ? 'Return to the builder — your layout is exactly as you left it'
            : ui.pickSelected
              ? 'Open the builder with this layout — drop columns, tune zones, add behaviors'
              : 'Pick a layout first',
          !(ui.pickSelected !== null || keptConfig()), () => api.confirmPick()),
      );
      return;
    }
    const blocker = applyBlocker(ui.config, comps);
    foot.append(
      mk('wb-template-cancel', 'Cancel', 'Close without touching the view', false, () => close()),
      mk('wb-template-apply', creating ? 'Create' : 'Save',
        blocker ?? (creating
          ? 'Create this view — it becomes its own named view in the list'
          : 'Save this layout to the view (one Ctrl+Z on the canvas reverts it)'),
        Boolean(blocker), doApply),
    );
  }

  function rerender(): void {
    modal.dataset.stage = ui.stage;
    modal.dataset.peek = modal.dataset.peek ?? '';
    renderTop();
    renderFoot();
    renderChips(chips, ui, api);
    if (ui.stage === 'pick') {
      renderLayoutSide(treeHost, ui, api);
      inspector.innerHTML = '';
    } else {
      renderZoneTree(treeHost, ui, api);
      renderInspector(inspector, ui, api);
    }
    renderPreview(preview, ui, api);
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
    const noun = ui.config.target === 'tile' ? 'Tile layout' : 'Row layout';
    // structural click-safety gate: creating adds a NEW named view, so there
    // is nothing to confirm. Only a Save that REPLACES an open sheet the
    // builder couldn't reopen losslessly (a foreign layout) asks first —
    // editing your own layout is what reopen is FOR, and a wireframe re-pick
    // over it already confirmed. Single-undo is the net either way.
    const pristine = !state.doc.root.children?.length || isPureGrid(state.doc.root);
    const overwrites = !creating && !editingExisting && !pristine;
    if (overwrites && !confirm(`Replace this view's layout with the ${noun.toLowerCase()}? Ctrl+Z reverts it in one step.`)) return;
    // zebra rides the root's own class expression now — the wrapper's
    // additionalRowClass is dead next to a rowFormatter on real SP
    const { root } = buildTemplateView(
      ui.config, state.fields, state.columnLooks, palette(), comps, { prune: true });
    if (creating) {
      const doc = ui.config.target === 'tile'
        ? {
          kind: 'tile' as const, root,
          tileWidth: ui.config.tileWidth ?? 254, tileHeight: ui.config.tileHeight ?? 220,
        }
        : { kind: 'row' as const, root };
      const sheet = state.createView(doc);
      onToast(sheet ? `${noun} created as “${sheet.name}” — it's in the view list` : `${noun} created`);
    } else {
      if (ui.config.target === 'tile') {
        state.applyTileTemplate(root, { width: ui.config.tileWidth, height: ui.config.tileHeight });
      } else {
        state.applyRowTemplate(root);
      }
      onToast(editingExisting ? `${noun} updated` : `${noun} applied`);
    }
    close(true); // the work is banked — no discard gate
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
    patchZone: (zonePath, patch) => commit(patchZoneAt(ui.config, zonePath, patch)),
    patchItem: (itemPath, patch) => commit(patchItemAt(ui.config, itemPath, patch)),
    setConfig,
    pickWireframe: (id) => {
      // anything at stake = uncommitted edits OR live undo history: a prior
      // re-pick leaves dirty=false with real states in `past`, and those must
      // keep both the confirm AND the undoable path — a baseline reset here
      // would wipe them silently and disarm the close gate
      const atStake = dirty || past.length > 0;
      // no item-count clause: atStake alone already spares untouched seeds,
      // and style/zone edits on a fieldless schema deserve the confirm too
      if (atStake
        && !confirm('Start over from this layout? Your current zones are replaced (undo inside the builder brings them back).')) return;
      ui.stage = 'edit';
      if (atStake) {
        commit(defaultConfigFor(id, state.fields), null); // re-pick over work: undoable
      } else {
        // entering from an untouched selector = the undo BASELINE, not a step
        ui.config = defaultConfigFor(id, state.fields);
        ui.selected = null;
        past.length = 0;
        future.length = 0;
        rerender();
      }
      dirty = false;
      seededFrom = id;
      // rerender replaced the focused selector row — same landing spot as resume
      (modal.querySelector('.wb-template-layouts') as HTMLElement | null)?.focus();
    },
    previewWireframe: (id) => {
      ui.pickSelected = id;
      ui.pickDrilled = true;
      rerender();
      // rerender replaced the focused list row — hand keyboard users the
      // details pane's back button so they keep a position
      (modal.querySelector('.wb-lay-back') as HTMLElement | null)?.focus();
    },
    backToList: () => {
      if (!ui.pickDrilled) return;
      ui.pickDrilled = false;
      rerender();
      // …and coming back, land on the row they came from — the Recent copy
      // counts too (the canonical row may sit in a folded group)
      (modal.querySelector(`[data-wireframe="${ui.pickSelected}"], [data-wireframe-recent="${ui.pickSelected}"]`) as HTMLElement | null)?.focus();
    },
    confirmPick: () => {
      const id = ui.pickSelected;
      if (id === null) {
        // RESUME with nothing selected: a kept config (reopened sheet backed
        // out to the list) returns exactly as left
        if (!keptConfig()) return;
        ui.stage = 'edit';
        rerender();
        return;
      }
      // selection matches the CURRENT config's layout → RESUME it (Back must
      // never cost work); anything else goes through pickWireframe's confirm
      if (resumesSelection()) {
        ui.stage = 'edit';
        rerender();
        // keyboard position on entering the editor: its own back arrow
        (modal.querySelector('.wb-template-layouts') as HTMLElement | null)?.focus();
        return;
      }
      api.pickWireframe(id);
    },
    isCreating: () => creating,
    resumeConfig: () => (resumesSelection() ? ui.config : null),
    resumeEdited: () => resumesSelection() && (dirty || past.length > 0),
    openGallery: () => {
      // back out with context: drill into the layout the CURRENT config
      // carries (config-derived, so undo/redo can't desync it); a reopened
      // sheet has no source wireframe → the list, with Next reading Resume
      ui.stage = 'pick';
      ui.pickSelected = seededFrom !== null ? ui.config.wireframeId : null;
      ui.pickDrilled = ui.pickSelected !== null;
      rerender();
      // keyboard position mirrors the drill state: the details back button,
      // or the top of the plain list
      (modal.querySelector(ui.pickDrilled ? '.wb-lay-back' : '.wb-lay-row') as HTMLElement | null)?.focus();
    },
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
