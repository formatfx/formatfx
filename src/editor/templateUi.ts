/**
 * editor/templateUi.ts — small shared primitives for the row-template modal's
 * three regions (fields bar, preview canvas, inspector). Keeps el()/segmented()/
 * the drag MIMEs and the UI<->Api contract in one place so the region modules
 * stay focused. No state import — everything flows through ModalApi.
 */
import type { RowTemplateConfig, RowAreaConfig, RowTemplateId } from './rowTemplates';

/** Drag MIME for a field chip → block. Mirrors the palette/tree/grid channels. */
export const FIELD_MIME = 'application/x-wb-field';
/** Drag MIME for a block → block reorder (distinct, so a drop can tell them apart). */
export const ORDER_MIME = 'application/x-wb-area-order';

export type Mode = 'edit' | 'preview';
export type Dock = 'bottom' | 'left';

/** Modal-local UI state — the single source of truth while the modal is open. */
export interface ModalUI {
  config: RowTemplateConfig;
  mode: Mode;
  selected: number | null; // selected area index, or null = row-level view
  dock: Dock;
}

/** Everything the region renderers may do — all mutations funnel through here so
 *  each gesture is one immutable config update followed by one rerender. */
export interface ModalApi {
  select(i: number): void;
  selectKebab(): void;
  deselect(): void;
  assign(i: number, field: string): void;
  add(field: string): void;
  remove(i: number): void;
  reorder(from: number, to: number): void;
  cycleWeight(i: number): void;
  patchArea(i: number, patch: Partial<RowAreaConfig>): void;
  setConfig(next: RowTemplateConfig): void;
  reseed(id: RowTemplateId): void;
  setMode(m: Mode): void;
  toggleDock(): void;
  apply(): void;
  cancel(): void;
  notify(msg: string): void;
  palette(): Record<string, string>;
  canApply(): boolean;
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
