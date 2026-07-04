/**
 * editor/templateUi.ts — small shared primitives for the row-view builder's
 * regions (action grid + chips bar, gallery, canvas, zone tree, inspector).
 * Keeps el()/segmented()/the drag MIMEs, the positional-drop rule and the
 * UI<->Api contract in one place so the region modules stay focused. No state
 * import — everything flows through ModalApi.
 */
import type { BuilderTarget, RowTemplateConfig, WireframeId, ZoneConfig, ZoneItemPatch, ZonePath } from './rowTemplates';
import type { ComponentDef } from './components';

/** Drag MIME for a field chip → zone. Mirrors the palette/tree/grid channels. */
export const FIELD_MIME = 'application/x-wb-field';
/** Drag MIME for a component chip → zone (payload: the component id). */
export const COMPONENT_MIME = 'application/x-wb-component';
/** Drag MIME for ANY existing node — a zone or an item, root or nested — as a
 *  JSON ZonePath. One payload because zones nest: everything moves the same way. */
export const NODE_MIME = 'application/x-wb-node';

/** 'pick' = the wireframe gallery; 'edit' = the zone canvas. */
export type Stage = 'pick' | 'edit';

/** Which zone setting the preview tags currently PEEK (hovering an inspector
 *  section swaps every zone tag from its name to that setting's value). */
export type Peek = 'size' | 'flow' | 'align';

/** What's selected: a path into the nested zone structure (a zone or an item —
 *  nodeAt decides), or nothing. */
export type Selection = ZonePath | null;

/** Where a drag lands relative to the element under the pointer. */
export type DropPos = 'before' | 'after' | 'into';

/** The preview width presets — how makers *watch* zones shrink and items wrap.
 *  null = full width; numbers are stage widths in px. */
export const STAGE_WIDTHS: readonly (readonly [string, number | null])[] = [
  ['Full', null], ['Medium', 560], ['Narrow', 360],
];

/**
 * The one positional-drop rule, shared by the preview canvas and the zone
 * tree: near an edge = BETWEEN (insert before/after, drawn as an insertion
 * bar), on the body = INTO (when the target can contain the payload).
 * `offset` is the pointer's distance from the leading edge along the target's
 * axis; `size` the target's extent on that axis. Degenerate rects (jsdom,
 * collapsed elements) fall back to the containing drop so a blind drop still
 * lands somewhere sensible. Pure — unit-tested directly.
 */
export function dropPos(offset: number, size: number, canInto: boolean): DropPos {
  if (size <= 0) return canInto ? 'into' : 'after';
  const frac = offset / size;
  if (canInto) {
    if (frac < 0.3) return 'before';
    if (frac > 0.7) return 'after';
    return 'into';
  }
  return frac < 0.5 ? 'before' : 'after';
}

/** Modal-local UI state — the single source of truth while the builder is open. */
export interface ModalUI {
  config: RowTemplateConfig;
  stage: Stage;
  selected: Selection;
  /** Simulated row width in px (the squeeze scrubber); null = full width.
   *  Row target only — a tile's width is its own knob, not a viewport. */
  stageWidth: number | null;
  /** The canvas holds a row view or tile the round-trip parser REFUSED
   *  (hand-built or hand-edited) — the gallery says so instead of silently
   *  starting fresh. */
  foreignRow: boolean;
  /** Which wireframe group the gallery leads with ('+ New tileview…' and a
   *  tile doc lead with tiles; everything else leads with rows). */
  galleryFirst: BuilderTarget;
}

/** Everything the region renderers may do — all mutations funnel through the
 *  modal's commit() so each gesture is one undoable, immutable config step. */
export interface ModalApi {
  /** Select the zone/item a path names (null = the row itself). */
  select(path: Selection): void;
  selectKebab(): void;
  deselect(): void;
  /** Drop a field chip into the zone at `zonePath` (`at` = index; omit = append). */
  dropField(zonePath: ZonePath, field: string, at?: number): void;
  /** Drop a component chip into a zone, best-guess-mapped (`at` optional). */
  dropComponent(zonePath: ZonePath, componentId: string, at?: number): void;
  /** Add an empty ROOT zone (the "+ Zone" button) and select it. */
  addEmptyZone(): void;
  /** Add an empty NESTED zone inside the zone at `zonePath` and select it. */
  addNestedZone(zonePath: ZonePath): void;
  /** A chip dropped BETWEEN root zones: spawn a new root zone at `at` with it. */
  newRootZoneAt(at: number, payload: { field?: string; componentId?: string }): void;
  /** Move any existing node (zone or item) — see rowTemplates.moveNode. */
  moveNode(from: ZonePath, toZone: ZonePath, toIndex: number): void;
  /** Remove whatever a path names (zone or item). */
  removeNode(path: ZonePath): void;
  cycleZoneSize(zonePath: ZonePath): void;
  patchZone(zonePath: ZonePath, patch: Partial<Omit<ZoneConfig, 'items'>>): void;
  patchItem(itemPath: ZonePath, patch: ZoneItemPatch): void;
  setConfig(next: RowTemplateConfig): void;
  /** Seed from a wireframe and enter the editor (confirms over placed work). */
  pickWireframe(id: WireframeId): void;
  /** Back to the gallery (the current config is kept until a pick). */
  openGallery(): void;
  setStageWidth(w: number | null): void;
  /** Transient hover state — stamps data-peek on the modal, NO rerender. */
  setPeek(p: Peek | null): void;
  /** Modal-local undo/redo over the config (Ctrl/Cmd+Z, Shift for redo). */
  undo(): void;
  redo(): void;
  canUndo(): boolean;
  canRedo(): boolean;
  apply(): void;
  cancel(): void;
  notify(msg: string): void;
  palette(): Record<string, string>;
  /** Built-ins + the maker's saved components (element-kind), cached per open. */
  components(): ComponentDef[];
  /** Why Apply is blocked, or null when it may proceed. */
  applyBlocker(): string | null;
}

export function el(tag: string, cls?: string, text?: string): HTMLElement {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

/**
 * A segmented (one-of-N) button group — the no-dropdown replacement for the old
 * `<select>`s. `dataKey` stamps `data-<key>="<value>"` on each button so tests
 * and e2e can target a specific option (e.g. data-rowstyle="card").
 */
export function segmented<T extends string>(
  dataKey: string, opts: readonly (readonly [T, string])[], value: T, onPick: (v: T) => void,
): HTMLElement {
  const wrap = el('div', 'wb-seg');
  for (const [v, label] of opts) {
    const b = el('button', 'wb-seg-btn', label) as HTMLButtonElement;
    b.type = 'button';
    b.dataset[dataKey] = v;
    if (v === value) b.classList.add('wb-seg-on');
    b.addEventListener('click', (e) => { e.stopPropagation(); onPick(v); });
    wrap.appendChild(b);
  }
  return wrap;
}

/**
 * A labelled checkbox that can be greyed-with-reason — the carry-over of the old
 * style toggle. `disabledReason` (from composeRowStyle) greys it and surfaces the
 * reason as a title so the exclusion is FELT, matching the existing contract.
 */
export function toggleCtl(
  name: string, label: string, checked: boolean,
  disabledReason: string | undefined, onChange: (on: boolean) => void,
): HTMLElement {
  const wrap = el('label', 'wb-template-ctl wb-template-toggle');
  wrap.dataset.toggle = name;
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.checked = checked && !disabledReason;
  if (disabledReason) {
    wrap.classList.add('wb-disabled');
    wrap.title = disabledReason;
    cb.disabled = true;
  }
  cb.addEventListener('change', () => onChange(cb.checked));
  wrap.append(cb, el('span', undefined, label));
  return wrap;
}
