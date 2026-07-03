/**
 * editor/templateInspector.ts — the contextual inspector. Three views:
 *   · a ZONE selected — its space behavior in plain language: Width
 *     (Hug content / Fill / Fill 2× / Fill 3×), Items flow (Side by side /
 *     Wrap when tight / Stacked), Align, rename, remove;
 *   · an ITEM selected — a field item's width/text controls, or a component
 *     item's slot mapping (type-filtered column pickers, best-guess prefilled;
 *     an unmapped slot blocks Apply with a teaching hint);
 *   · nothing selected — the ROW: style, density, toggles, and the kebab.
 * Blank kebab params are refused with an inline hint, mirroring the engine.
 */
import { state } from './state';
import {
  composeRowStyle, ZONE_SIZE_LABEL,
  type RowStyle, type KebabBehavior, type KebabPosition, type KebabActionFlags,
  type ZoneSize, type ZoneFlow, type ZoneAlign, type ItemWidth,
  type FieldZoneItem, type ComponentZoneItem,
} from './rowTemplates';
import type { RowDensity } from './areas';
import type { ComponentDef } from './components';
import { el, segmented, toggleCtl, type ModalUI, type ModalApi } from './templateUi';

export function renderInspector(host: HTMLElement, ui: ModalUI, api: ModalApi): void {
  host.innerHTML = '';
  if (ui.stage === 'pick') return; // the gallery owns the whole canvas

  const head = el('div', 'wb-template-insp-head');
  head.appendChild(el('span', 'wb-template-insp-title', inspectorTitle(ui)));
  host.appendChild(head);

  const body = el('div', 'wb-template-insp-body');
  host.appendChild(body);

  const sel = ui.selected;
  if (ui.mode === 'preview') {
    body.appendChild(el('div', 'wb-template-note', 'Switch to Edit to change the layout.'));
  } else if (sel && sel.item !== null && ui.config.zones[sel.zone]?.items[sel.item]) {
    renderItemView(body, ui, api, sel.zone, sel.item);
  } else if (sel && ui.config.zones[sel.zone]) {
    renderZoneView(body, ui, api, sel.zone);
  } else {
    renderRowView(body, ui, api);
  }

  host.appendChild(renderFooter(api));
}

function inspectorTitle(ui: ModalUI): string {
  const sel = ui.selected;
  if (ui.mode === 'preview' || !sel) return 'Row';
  const zone = ui.config.zones[sel.zone];
  if (!zone) return 'Row';
  if (sel.item === null) return `${zone.label} zone`;
  const item = zone.items[sel.item];
  if (!item) return `${zone.label} zone`;
  return item.kind === 'field' ? `Item — ${item.fieldName || '(empty)'}` : 'Item — component';
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

function renderZoneView(host: HTMLElement, ui: ModalUI, api: ModalApi, zi: number): void {
  const zone = ui.config.zones[zi];

  host.appendChild(section('Zone name'));
  host.appendChild(textField('', zone.label, (v) => api.patchZone(zi, { label: v.trim() || zone.label })));

  host.appendChild(peekSection(api, 'size',
    section('Width'),
    segmented<ZoneSize>('zonesize',
      (['hug', 'normal', 'wide', 'widest'] as ZoneSize[]).map((s) => [s, ZONE_SIZE_LABEL[s]] as const),
      zone.size, (s) => api.patchZone(zi, { size: s })),
    hintNote('Hug takes only what the content needs; Fill zones share the leftover space by their weights.')));

  host.appendChild(peekSection(api, 'flow',
    section('Items'),
    segmented<ZoneFlow>('zoneflow',
      [['side', 'Side by side'], ['wrap', 'Wrap when tight'], ['stack', 'Stacked']], zone.flow,
      (f) => api.patchZone(zi, { flow: f })),
    hintNote(zone.flow === 'wrap'
      ? 'Items sit side by side; when the zone runs out of room, the right item moves beneath the left one. Squeeze the preview to watch it.'
      : zone.flow === 'stack' ? 'Items always stack vertically.'
        : 'Items stay on one line; fill items truncate when squeezed.')));

  host.appendChild(peekSection(api, 'align',
    section('Align'),
    segmented<ZoneAlign>('align',
      [['left', 'Left'], ['center', 'Center'], ['right', 'Right']], zone.align,
      (al) => api.patchZone(zi, { align: al }))));

  const rm = el('button', 'wb-template-remove', '✕ Remove zone') as HTMLButtonElement;
  rm.type = 'button';
  rm.setAttribute('aria-label', 'Remove zone');
  rm.addEventListener('click', () => api.removeZone(zi));
  host.appendChild(rm);
}

// ─── item view ───────────────────────────────────────────────────────────────

function renderItemView(host: HTMLElement, ui: ModalUI, api: ModalApi, zi: number, ii: number): void {
  const item = ui.config.zones[zi].items[ii];
  if (item.kind === 'field') renderFieldItem(host, api, zi, ii, item);
  else renderComponentItem(host, api, zi, ii, item);

  host.appendChild(section('Width'));
  host.appendChild(segmented<ItemWidth>('itemwidth',
    [['natural', 'Natural'], ['fill', 'Fill']], item.width,
    (w) => api.patchItem(zi, ii, { width: w })));
  host.appendChild(hintNote('Natural hugs the content; Fill grows into the zone (and, in a wrapping zone, takes the whole line once wrapped).'));

  const rm = el('button', 'wb-template-remove', '✕ Remove item') as HTMLButtonElement;
  rm.type = 'button';
  rm.setAttribute('aria-label', 'Remove item');
  rm.addEventListener('click', () => api.removeItem(zi, ii));
  host.appendChild(rm);
}

function renderFieldItem(host: HTMLElement, api: ModalApi, zi: number, ii: number, item: FieldZoneItem): void {
  const field = state.fields.find((f) => f.name === item.fieldName);
  host.appendChild(section('Field'));
  host.appendChild(el('span', 'wb-template-fieldname',
    field ? (field.displayName ?? field.name) : '(missing column)'));

  host.appendChild(section('Text'));
  host.appendChild(segmented<'truncate' | 'wrap'>('wrap',
    [['truncate', 'Truncate'], ['wrap', 'Wrap']], item.text,
    (w) => api.patchItem(zi, ii, { text: w })));
}

function renderComponentItem(host: HTMLElement, api: ModalApi, zi: number, ii: number, item: ComponentZoneItem): void {
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
      api.patchItem(zi, ii, { map: { ...item.map, [slot.key]: col } })));
  }
  if (def.slots.some((s) => !item.map[s.key])) {
    host.appendChild(hint('Map every slot to a column to enable Apply.'));
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

  host.appendChild(section('Row style'));
  host.appendChild(segmented<RowStyle>('rowstyle',
    [['flat', 'Flat'], ['card', 'Card'], ['minimalist', 'Minimalist']], config.rowStyle,
    (v) => api.setConfig({ ...config, rowStyle: v })));

  host.appendChild(section('Density'));
  host.appendChild(segmented<RowDensity>('density',
    [['roomy', 'Roomy'], ['compact', 'Compact']], config.density,
    (v) => api.setConfig({ ...config, density: v })));

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

function renderFooter(api: ModalApi): HTMLElement {
  const footer = el('div', 'wb-template-buttons');
  const cancel = el('button', 'wb-template-cancel', 'Cancel') as HTMLButtonElement;
  cancel.type = 'button';
  cancel.addEventListener('click', () => api.cancel());
  const apply = el('button', 'wb-template-apply', 'Apply') as HTMLButtonElement;
  apply.type = 'button';
  const blocker = api.applyBlocker();
  apply.disabled = Boolean(blocker);
  apply.title = blocker ?? '';
  apply.addEventListener('click', () => api.apply());
  footer.append(cancel, apply);
  return footer;
}
