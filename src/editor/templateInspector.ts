// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sam Yost. FormatFX is dual-licensed: AGPL-3.0-only (see LICENSE) or a commercial license (see LICENSING.md).

/**
 * editor/templateInspector.ts — the contextual inspector (below the zone tree
 * in the left side column). Three views, addressed by ZonePath since zones
 * nest:
 *   · a ZONE selected — its space behavior in plain language: Width
 *     (Hug content / Fill / Fill 2× / Fill 3×), Items flow (Side by side /
 *     Wrap when tight / Stacked), Align, rename, ＋ Nested zone, remove;
 *   · an ITEM selected — a field item's width/text controls, or a component
 *     item's slot mapping (type-filtered column pickers, best-guess prefilled;
 *     an unmapped slot blocks Save with a teaching hint);
 *   · nothing selected — the ROW or TILE: "Applies as" (the same zones
 *     re-target between a full-width row and a gallery tile), style, density,
 *     toggles, the tile box size, and the kebab (row layouts only — tiles
 *     get a teaching note instead).
 * Blank kebab params are refused with an inline hint, mirroring the engine.
 * Save/Cancel live in the top action grid, not here.
 */
import { state } from './state';
import {
  composeRowStyle, nodeAt, ZONE_SIZE_LABEL, TILE_DEFAULT_WIDTH, TILE_DEFAULT_HEIGHT,
  type BuilderTarget, type RowStyle, type KebabBehavior, type KebabPosition, type KebabActionFlags,
  type ZoneSize, type ZoneFlow, type ZoneAlign, type ItemWidth, type ZonePath, type ZoneConfig,
  type FieldZoneItem, type ComponentZoneItem, type ZoneItem,
} from './rowTemplates';
import type { RowDensity } from './areas';
import type { ComponentDef } from './components';
import { el, segmented, toggleCtl, type ModalUI, type ModalApi } from './templateUi';

const isZone = (node: ZoneConfig | ZoneItem): node is ZoneConfig => 'items' in node;

export function renderInspector(host: HTMLElement, ui: ModalUI, api: ModalApi): void {
  host.innerHTML = '';
  if (ui.stage === 'pick') return; // the gallery owns the whole canvas

  const sel = ui.selected;
  const node = sel ? nodeAt(ui.config, sel) : null;

  const head = el('div', 'wb-template-insp-head');
  head.appendChild(el('span', 'wb-template-insp-title', inspectorTitle(node, ui.config.target)));
  host.appendChild(head);

  const body = el('div', 'wb-template-insp-body');
  host.appendChild(body);

  if (sel && node) {
    if (isZone(node)) renderZoneView(body, api, sel, node);
    else renderItemView(body, api, sel, node);
  } else {
    renderRowView(body, ui, api);
  }
}

function inspectorTitle(node: ZoneConfig | ZoneItem | null, target: BuilderTarget): string {
  if (!node) return target === 'tile' ? 'Tile' : 'Row';
  if (isZone(node)) return `${node.label} zone`;
  if (node.kind === 'field') return `Item — ${node.fieldName || '(empty)'}`;
  return 'Item — component';
}

// ─── zone view ───────────────────────────────────────────────────────────────

/** A section wrapper that PEEKS its setting onto the preview's zone tags while
 *  hovered (data-peek stamp — see templateModal.setPeek; no rerender). */
function peekSection(api: ModalApi, peek: 'size' | 'flow' | 'align', ...children: HTMLElement[]): HTMLElement {
  const wrap = el('div', 'wb-template-peeksec');
  wrap.dataset.peekSection = peek;
  wrap.addEventListener('mouseenter', () => api.setPeek(peek));
  wrap.addEventListener('mouseleave', () => api.setPeek(null));
  wrap.append(...children);
  return wrap;
}

function renderZoneView(host: HTMLElement, api: ModalApi, path: ZonePath, zone: ZoneConfig): void {
  host.appendChild(section('Zone name'));
  host.appendChild(textField('', zone.label, (v) => api.patchZone(path, { label: v.trim() || zone.label })));

  host.appendChild(peekSection(api, 'size',
    section('Size'),
    segmented<ZoneSize>('zonesize',
      (['hug', 'normal', 'wide', 'widest'] as ZoneSize[]).map((s) => [s, ZONE_SIZE_LABEL[s]] as const),
      zone.size, (s) => api.patchZone(path, { size: s })),
    hintNote('Hug takes only what the content needs; Fill zones share the leftover space by their weights — across the row, or down the tile.')));

  host.appendChild(peekSection(api, 'flow',
    section('Items'),
    segmented<ZoneFlow>('zoneflow',
      [['side', 'Side by side'], ['wrap', 'Wrap when tight'], ['stack', 'Stacked']], zone.flow,
      (f) => api.patchZone(path, { flow: f })),
    hintNote(zone.flow === 'wrap'
      ? 'Items sit side by side; when the zone runs out of room, the right item moves beneath the left one. Squeeze the preview to watch it.'
      : zone.flow === 'stack' ? 'Items always stack vertically.'
        : 'Items stay on one line; fill items truncate when squeezed.')));

  host.appendChild(peekSection(api, 'align',
    section('Align'),
    segmented<ZoneAlign>('align',
      [['left', 'Left'], ['center', 'Center'], ['right', 'Right']], zone.align,
      (al) => api.patchZone(path, { align: al }))));

  const nest = el('button', 'wb-template-mini wb-template-addnested', '＋ Nested zone') as HTMLButtonElement;
  nest.type = 'button';
  nest.title = 'Add a zone inside this zone — group items so they share space and wrap together';
  nest.addEventListener('click', () => api.addNestedZone(path));
  host.appendChild(nest);

  const rm = el('button', 'wb-template-remove', '✕ Remove zone') as HTMLButtonElement;
  rm.type = 'button';
  rm.setAttribute('aria-label', 'Remove zone');
  rm.addEventListener('click', () => api.removeNode(path));
  host.appendChild(rm);
}

// ─── item view ───────────────────────────────────────────────────────────────

function renderItemView(host: HTMLElement, api: ModalApi, path: ZonePath, item: ZoneItem): void {
  if (item.kind === 'zone') return; // zone items render as zones (nodeAt is zone-first)
  if (item.kind === 'field') renderFieldItem(host, api, path, item);
  else renderComponentItem(host, api, path, item);

  host.appendChild(section('Width'));
  host.appendChild(segmented<ItemWidth>('itemwidth',
    [['natural', 'Natural'], ['fill', 'Fill']], item.width,
    (w) => api.patchItem(path, { width: w })));
  host.appendChild(hintNote('Natural hugs the content; Fill grows into the zone (and, in a wrapping zone, takes the whole line once wrapped).'));

  const rm = el('button', 'wb-template-remove', '✕ Remove item') as HTMLButtonElement;
  rm.type = 'button';
  rm.setAttribute('aria-label', 'Remove item');
  rm.addEventListener('click', () => api.removeNode(path));
  host.appendChild(rm);
}

function renderFieldItem(host: HTMLElement, api: ModalApi, path: ZonePath, item: FieldZoneItem): void {
  const field = state.fields.find((f) => f.name === item.fieldName);
  host.appendChild(section('Field'));
  host.appendChild(el('span', 'wb-template-fieldname',
    field ? (field.displayName ?? field.name) : '(missing column)'));

  host.appendChild(section('Text'));
  host.appendChild(segmented<'truncate' | 'wrap'>('wrap',
    [['truncate', 'Truncate'], ['wrap', 'Wrap']], item.text,
    (w) => api.patchItem(path, { text: w })));
}

function renderComponentItem(host: HTMLElement, api: ModalApi, path: ZonePath, item: ComponentZoneItem): void {
  const def = api.components().find((c) => c.id === item.componentId);
  host.appendChild(section('Component'));
  if (!def) {
    host.appendChild(el('span', 'wb-template-fieldname', '(no longer exists — remove this item)'));
    return;
  }
  host.appendChild(el('span', 'wb-template-fieldname', `⬡ ${def.name}`));
  host.appendChild(hintNote(def.description));

  if (def.slots.length) host.appendChild(section('Columns it uses'));
  for (const slot of def.slots) {
    host.appendChild(slotPicker(def, slot.key, item, (col) =>
      api.patchItem(path, { map: { ...item.map, [slot.key]: col } })));
  }
  if (def.slots.some((s) => !item.map[s.key])) {
    host.appendChild(hint('Map every slot to a column to enable Save.'));
  }
}

/** A type-filtered column picker for one component slot — the same convention
 *  as the ⬡ library's mapping dialog (best-guess prefilled by the drop). */
function slotPicker(def: ComponentDef, key: string, item: ComponentZoneItem, onPick: (col: string) => void): HTMLElement {
  const slot = def.slots.find((s) => s.key === key)!;
  const wrap = el('label', 'wb-template-ctl');
  wrap.appendChild(el('span', undefined, slot.label));
  const sel = document.createElement('select');
  sel.dataset.slot = key;
  const empty = document.createElement('option');
  empty.value = '';
  empty.textContent = '(pick a column)';
  sel.appendChild(empty);
  for (const f of state.fields.filter((x) => !x.protected && slot.types.includes(x.type))) {
    const opt = document.createElement('option');
    opt.value = f.name;
    opt.textContent = f.displayName ?? f.name;
    sel.appendChild(opt);
  }
  sel.value = item.map[key] ?? '';
  sel.addEventListener('change', () => onPick(sel.value));
  wrap.appendChild(sel);
  return wrap;
}

// ─── row view + kebab ────────────────────────────────────────────────────────

function renderRowView(host: HTMLElement, ui: ModalUI, api: ModalApi): void {
  const config = ui.config;
  const composed = composeRowStyle(config, api.palette());
  const tile = config.target === 'tile';

  // the same zones re-target between a full-width row and a gallery tile —
  // flipping is modal-local (Save is still the only document write)
  host.appendChild(section('Applies as'));
  host.appendChild(segmented<BuilderTarget>('target',
    [['row', 'Row view'], ['tile', 'Tile']], config.target,
    (t) => api.setConfig({
      ...config, target: t,
      ...(t === 'tile'
        ? { tileWidth: config.tileWidth ?? TILE_DEFAULT_WIDTH, tileHeight: config.tileHeight ?? TILE_DEFAULT_HEIGHT }
        : {}),
    })));
  host.appendChild(hintNote(tile
    ? 'A gallery tile: the zones stack top to bottom inside a fixed tile.'
    : 'A list row: the zones sit side by side across the full row.'));

  host.appendChild(section(tile ? 'Tile style' : 'Row style'));
  host.appendChild(segmented<RowStyle>('rowstyle',
    [['flat', 'Flat'], ['card', 'Card'], ['minimalist', 'Minimalist']], config.rowStyle,
    (v) => api.setConfig({ ...config, rowStyle: v })));

  host.appendChild(section('Density'));
  host.appendChild(segmented<RowDensity>('density',
    [['roomy', 'Roomy'], ['compact', 'Compact']], config.density,
    (v) => api.setConfig({ ...config, density: v })));

  if (tile) {
    host.appendChild(section('Tile size'));
    host.appendChild(numberField('Width (px)', 'width', config.tileWidth ?? TILE_DEFAULT_WIDTH,
      (v) => api.setConfig({ ...config, tileWidth: v })));
    host.appendChild(numberField('Height (px)', 'height', config.tileHeight ?? TILE_DEFAULT_HEIGHT,
      (v) => api.setConfig({ ...config, tileHeight: v })));
    host.appendChild(hintNote('The tile box SharePoint lays the gallery out with. The stock tile is 254×220.'));
  }

  host.appendChild(section('Style toggles'));
  host.appendChild(toggleCtl('border', 'Border', config.borderStyle !== 'none', composed.disabled.border,
    (on) => api.setConfig({ ...config, borderStyle: on ? 'solid' : 'none' })));
  host.appendChild(toggleCtl('zebra', 'Zebra striping', config.zebraStriping, composed.disabled.zebra,
    (on) => api.setConfig({ ...config, zebraStriping: on })));
  host.appendChild(toggleCtl('hoverHighlight', 'Hover highlight', config.hoverHighlight, composed.disabled.hoverHighlight,
    (on) => api.setConfig({ ...config, hoverHighlight: on })));
  host.appendChild(toggleCtl('leftStripe', 'Left accent stripe', config.leftStripe !== 'none', composed.disabled.leftStripe,
    (on) => api.setConfig({ ...config, leftStripe: on ? 'neutral' : 'none' })));

  renderKebabSection(host, ui, api);
}

function renderKebabSection(host: HTMLElement, ui: ModalUI, api: ModalApi): void {
  const config = ui.config;
  const k = config.kebab;
  host.appendChild(section('Row actions (kebab)'));
  if (config.target === 'tile') {
    // refuse-and-teach: every kebab position would render as a full-width
    // stacked strip inside a tile, so tiles don't offer it (SharePoint's own
    // tile hover menu still works)
    host.appendChild(el('div', 'wb-template-note wb-template-kebab-tilenote',
      'The kebab is a row-layout feature — in a tile every position would become a stacked strip. '
      + "Tiles keep SharePoint's own hover menu."));
    return;
  }
  host.appendChild(toggleCtl('kebab', 'Enable kebab', k.enabled, undefined,
    (on) => api.setConfig({ ...config, kebab: { ...k, enabled: on } })));
  if (!k.enabled) return;

  host.appendChild(segmented<KebabBehavior>('kebabBehavior',
    [['native', 'Native'], ['custom', 'Custom']], k.behavior,
    (v) => api.setConfig({ ...config, kebab: { ...k, behavior: v } })));
  host.appendChild(segmented<KebabPosition>('kebabPos',
    [['left', 'Left'], ['title', 'After title'], ['right', 'Right'], ['hover', 'Hover']], k.position,
    (v) => api.setConfig({ ...config, kebab: { ...k, position: v } })));

  if (k.behavior === 'native') {
    host.appendChild(el('div', 'wb-template-note', "Native opens SharePoint's built-in item menu."));
    return;
  }

  host.appendChild(el('div', 'wb-template-subsection', 'Actions'));
  const setAction = (key: keyof KebabActionFlags, on: boolean): void =>
    api.setConfig({ ...config, kebab: { ...k, actions: { ...k.actions, [key]: on } } });
  const setK = (patch: Partial<typeof k>): void => api.setConfig({ ...config, kebab: { ...k, ...patch } });

  (([['defaultClick', 'Open'], ['editProps', 'Edit'], ['share', 'Share'], ['delete', 'Delete'],
    ['executeFlow', 'Run flow'], ['setValue', 'Set value']]) as [keyof KebabActionFlags, string][])
    .forEach(([key, label]) => {
      host.appendChild(toggleCtl(`kebab-${key}`, label, k.actions[key], undefined, (on) => setAction(key, on)));
    });

  if (k.actions.executeFlow) {
    host.appendChild(textField('Flow ID', k.flowId ?? '', (v) => setK({ flowId: v })));
    if (!k.flowId?.trim()) host.appendChild(hint('Add a flow ID to enable the Run-flow action.'));
  }
  if (k.actions.setValue) {
    host.appendChild(textField('Set field', k.setValueField ?? '', (v) => setK({ setValueField: v })));
    host.appendChild(textField('To value', k.setValueVal ?? '', (v) => setK({ setValueVal: v })));
    if (!(k.setValueField?.trim() && k.setValueVal?.trim())) {
      host.appendChild(hint('Add a field and value to enable the Set-value action.'));
    }
  }
}

// ─── small helpers ───────────────────────────────────────────────────────────

function section(label: string): HTMLElement {
  return el('div', 'wb-template-section', label);
}

function hint(text: string): HTMLElement {
  return el('div', 'wb-template-hint', text);
}

function hintNote(text: string): HTMLElement {
  return el('div', 'wb-template-note', text);
}

/** A text input that commits on `change` (blur/Enter) — never on every keystroke,
 *  so the rerender that follows can't steal focus mid-type. */
function textField(label: string, value: string, onCommit: (v: string) => void): HTMLElement {
  const wrap = el('label', 'wb-template-ctl');
  if (label) wrap.appendChild(el('span', undefined, label));
  const inp = document.createElement('input');
  inp.type = 'text';
  inp.value = value;
  inp.addEventListener('change', () => onCommit(inp.value));
  wrap.appendChild(inp);
  return wrap;
}

/** A whole-pixel number input (the tile box) — commits on change like
 *  textField; a non-number or absurd value snaps back to what it was. */
function numberField(label: string, key: string, value: number, onCommit: (v: number) => void): HTMLElement {
  const wrap = el('label', 'wb-template-ctl');
  wrap.appendChild(el('span', undefined, label));
  const inp = document.createElement('input');
  inp.type = 'number';
  inp.dataset.tile = key;
  inp.min = '80';
  inp.max = '1000';
  inp.value = String(value);
  inp.addEventListener('change', () => {
    const v = Math.round(Number(inp.value));
    if (Number.isFinite(v) && v >= 80 && v <= 1000) onCommit(v);
    else inp.value = String(value);
  });
  wrap.appendChild(inp);
  return wrap;
}
