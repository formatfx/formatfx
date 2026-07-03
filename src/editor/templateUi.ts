/**
 * editor/templateUi.ts — small shared primitives for the row-view builder's
 * regions (chips bar, gallery + preview canvas, inspector). Keeps el()/
 * segmented()/the drag MIMEs and the UI<->Api contract in one place so the
 * region modules stay focused. No state import — everything flows through
 * ModalApi.
 */
import type { RowTemplateConfig, WireframeId, ZoneConfig, ZoneItemPatch } from './rowTemplates';
import type { ComponentDef } from './components';

/** Drag MIME for a field chip → zone. Mirrors the palette/tree/grid channels. */
export const FIELD_MIME = 'application/x-wb-field';
/** Drag MIME for a component chip → zone (payload: the component id). */
export const COMPONENT_MIME = 'application/x-wb-component';
/** Drag MIME for a zone → zone reorder (payload: the zone index). */
export const ZONE_MIME = 'application/x-wb-zone-order';
/** Drag MIME for an item move (payload: "zoneIdx:itemIdx"). */
export const ITEM_MIME = 'application/x-wb-zone-item';

export type Mode = 'edit' | 'preview';
export type Dock = 'bottom' | 'left';
/** 'pick' = the wireframe gallery; 'edit' = the zone canvas. */
export type Stage = 'pick' | 'edit';

/** What's selected on the canvas: a zone, or one item inside a zone. */
export type Selection = { zone: number; item: number | null } | null;

/** The preview width presets — how makers *watch* zones shrink and items wrap.
 *  null = full width; numbers are stage widths in px. */
export const STAGE_WIDTHS: readonly (readonly [string, number | null])[] = [
  ['Full', null], ['Medium', 560], ['Narrow', 360],
];

/** Modal-local UI state — the single source of truth while the builder is open. */
export interface ModalUI {
  config: RowTemplateConfig;
  stage: Stage;
  mode: Mode;
  selected: Selection;
  dock: Dock;
  /** Simulated row width in px (the squeeze scrubber); null = full width. */
  stageWidth: number | null;
}

/** Everything the region renderers may do — all mutations funnel through here so
 *  each gesture is one immutable config update followed by one rerender. */
export interface ModalApi {
  selectZone(zi: number): void;
  selectItem(zi: number, ii: number): void;
  selectKebab(): void;
  deselect(): void;
  /** Drop a field chip into a zone (appends an item). */
  dropField(zi: number, field: string): void;
  /** Drop a component chip into a zone (appends a best-guess-mapped item). */
  dropComponent(zi: number, componentId: string): void;
  /** Drop on the end gap: a NEW zone seeded with the payload. */
  dropNewZone(payload: { field?: string; componentId?: string }): void;
  removeZone(zi: number): void;
  reorderZone(from: number, to: number): void;
  cycleZoneSize(zi: number): void;
  patchZone(zi: number, patch: Partial<Omit<ZoneConfig, 'items'>>): void;
  removeItem(zi: number, ii: number): void;
  moveItem(fromZone: number, fromItem: number, toZone: number, toItem: number): void;
  patchItem(zi: number, ii: number, patch: ZoneItemPatch): void;
  setConfig(next: RowTemplateConfig): void;
  /** Seed from a wireframe and enter the editor (confirms over placed work). */
  pickWireframe(id: WireframeId): void;
  /** Back to the gallery (the current config is kept until a pick). */
  openGallery(): void;
  setMode(m: Mode): void;
  toggleDock(): void;
  setStageWidth(w: number | null): void;
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
