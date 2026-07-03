/**
 * editor/rowTemplates.ts — Pure brain for the ROW VIEW BUILDER: pre-built
 * wireframe layouts whose ZONES hold fields and components.
 * No DOM, no state imports — node-testable, like areas.ts / gridScaffold.ts.
 *
 * The model, in maker language:
 *   · a WIREFRAME is a pre-built arrangement of zones ("Lead + details",
 *     "Avatar card", …) that seeds the builder;
 *   · a ZONE is a region of the row that holds ITEMS — plain field cells or
 *     bound components (⬡) — and owns its space behavior:
 *       size  — 'hug' (take only what the content needs) or a fill weight
 *               (the conflict-free CSS-fr-like Normal/Wide/Widest of areas.ts);
 *       flow  — how items share the zone: 'side' (side by side, truncate),
 *               'wrap' (side by side until the zone tightens, then the right
 *               item moves BENEATH the left one — flex-wrap, allow-listed),
 *               'stack' (always vertical);
 *   · an ITEM is 'natural' (hug its content) or 'fill' (grow into the zone).
 *
 * COMPOSES the shipped engines: areas.ts weights, gridScaffold cells,
 * components.ts binding (component items are bound + instance-stamped, so the
 * ⬡ inventory sees them). The style compositor and kebab builder carry over
 * from the 2026-06-24 overhaul unchanged — their semantics are verified.
 */
import type { MockField, FieldType, SPElement, CustomRowAction } from '../core/types';
import type { AreaWeight, RowDensity } from './areas';
import { WEIGHT_FLEX, setRowDensity } from './areas';
import { gridCellForField } from './gridScaffold';
import { bindComponentInstance, type ComponentDef } from './components';

export type WireframeId = 'lead-detail' | 'avatar-card' | 'title-chips' | 'dashboard' | 'equal' | 'blank';
export type RowStyle = 'flat' | 'card' | 'minimalist';
export type LeftStripe = 'none' | 'neutral'; // 'status' deferred to v2
export type BorderStyle = 'none' | 'solid' | 'dashed';
export type KebabPosition = 'right' | 'left' | 'title' | 'hover';
export type KebabBehavior = 'native' | 'custom';
/** Toggles composeRowStyle may grey out; the value is the reason shown in the UI. */
export type StyleToggle = 'border' | 'zebra' | 'hoverHighlight' | 'leftStripe';

/** How a zone takes row space: hug the content, or fill at a weight. */
export type ZoneSize = 'hug' | AreaWeight;
/** How a zone's items share its space (the wrap-when-tight behavior lives here). */
export type ZoneFlow = 'side' | 'wrap' | 'stack';
export type ZoneAlign = 'left' | 'center' | 'right';
/** How an item takes zone space: its natural width, or grow to fill. */
export type ItemWidth = 'natural' | 'fill';

export interface FieldZoneItem {
  kind: 'field';
  fieldName: string;
  width: ItemWidth;
  text: 'truncate' | 'wrap';
}
export interface ComponentZoneItem {
  kind: 'component';
  componentId: string;
  /** slot key → column internal name (bestGuessMapping prefilled; '' = unmapped). */
  map: Record<string, string>;
  width: ItemWidth;
}
export type ZoneItem = FieldZoneItem | ComponentZoneItem;

export interface ZoneConfig {
  label: string;
  size: ZoneSize;
  flow: ZoneFlow;
  align: ZoneAlign;
  items: ZoneItem[];
}

export interface KebabActionFlags {
  defaultClick: boolean; editProps: boolean; share: boolean;
  delete: boolean; executeFlow: boolean; setValue: boolean;
}
export interface KebabConfig {
  enabled: boolean;
  behavior: KebabBehavior;
  position: KebabPosition;
  actions: KebabActionFlags;
  flowId?: string;
  setValueField?: string;
  setValueVal?: string;
}
export interface RowTemplateConfig {
  wireframeId: WireframeId;
  rowStyle: RowStyle;
  density: RowDensity;
  zebraStriping: boolean;
  hoverHighlight: boolean;
  hoverToken: string;          // a theme token name; default 'themeLighter'
  borderStyle: BorderStyle;
  borderColor: string;         // a theme token name for sp-css-borderColor-*
  leftStripe: LeftStripe;
  zones: ZoneConfig[];
  kebab: KebabConfig;
}

export interface ComposedRowStyle {
  rootStyle: Record<string, string>;
  rootClass: string[];
  wrapperAdditionalRowClass?: string;
  disabled: Partial<Record<StyleToggle, string>>;
}

/** Single source of truth for style precedence, exclusion, and the UI grey-out map.
 *  `palette` is themePalette(mode) — only leftStripe bakes a concrete color (no
 *  shipped per-side border-color class exists); everything else stays class-based
 *  and theme-safe. */
export function composeRowStyle(config: RowTemplateConfig, palette: Record<string, string>): ComposedRowStyle {
  const rootStyle: Record<string, string> = {};
  const rootClass: string[] = [];
  const disabled: Partial<Record<StyleToggle, string>> = {};

  // --- exclusions first: base styles that OWN or NULLIFY a toggle's property ---
  if (config.rowStyle === 'card') {
    disabled.border = 'Card style manages its own border';
    disabled.zebra = 'Card fill covers row striping';
  } else if (config.rowStyle === 'minimalist') {
    disabled.border = 'Minimalist uses only a bottom separator';
  }
  const borderLive = !disabled.border;
  const zebraLive = !disabled.zebra;

  // --- layer 1: base rowStyle ---
  if (config.rowStyle === 'card') {
    rootClass.push('ms-bgColor-white', 'sp-css-borderColor-neutralQuaternaryAlt');
    rootStyle['border-width'] = '1px';
    rootStyle['border-style'] = 'solid';
    rootStyle['border-radius'] = '4px';
    rootStyle['box-shadow'] = '0 1.6px 3.6px 0 rgba(0,0,0,.13)';
  } else if (config.rowStyle === 'minimalist') {
    rootClass.push('sp-css-borderColor-neutralQuaternaryAlt');
    rootStyle['border-bottom-width'] = '1px';
    rootStyle['border-bottom-style'] = 'solid';
  }

  // --- layer 2: generic border (flat only) ---
  if (borderLive && config.borderStyle !== 'none') {
    rootClass.push(`sp-css-borderColor-${config.borderColor}`);
    rootStyle['border-width'] = '1px';
    rootStyle['border-style'] = config.borderStyle;
  }

  // --- layer 3: leftStripe wins border-left (inline beats the border-color class) ---
  if (config.leftStripe === 'neutral') {
    rootStyle['border-left'] = `3px solid ${palette.themePrimary}`;
  }

  // --- layer 4: background/state ---
  if (zebraLive && config.zebraStriping) {
    // ROOT carries nothing; the stripe lives on the view wrapper (see buildTemplateView).
    return finalize(rootStyle, rootClass, disabled,
      "=if(@rowIndex % 2 == 0,'ms-bgColor-themeLighter','')", config);
  }
  return finalize(rootStyle, rootClass, disabled, undefined, config);
}

function finalize(
  rootStyle: Record<string, string>, rootClass: string[],
  disabled: Partial<Record<StyleToggle, string>>,
  wrapperAdditionalRowClass: string | undefined, config: RowTemplateConfig,
): ComposedRowStyle {
  if (config.hoverHighlight) rootClass.push(`ms-bgColor-${config.hoverToken}--hover`);
  return { rootStyle, rootClass, wrapperAdditionalRowClass, disabled };
}

// ─── kebab ───────────────────────────────────────────────────────────────────

function actionRow(label: string, action: CustomRowAction): SPElement {
  return {
    elmType: 'button',
    txtContent: label,
    customRowAction: action,
    style: { 'display': 'block', 'width': '100%', 'text-align': 'left',
      'border': 'none', 'background-color': 'transparent', 'padding': '6px 8px', 'cursor': 'pointer' },
  };
}

/** Action buttons, REFUSING any whose required param is blank (refuse-and-teach). */
function buildActionButtons(kebab: KebabConfig): SPElement[] {
  const out: SPElement[] = [];
  if (kebab.actions.defaultClick) out.push(actionRow('Open', { action: 'defaultClick' }));
  if (kebab.actions.editProps) out.push(actionRow('Edit', { action: 'editProps' }));
  if (kebab.actions.share) out.push(actionRow('Share', { action: 'share' }));
  if (kebab.actions.delete) out.push(actionRow('Delete', { action: 'delete' }));
  if (kebab.actions.executeFlow && kebab.flowId?.trim()) {
    out.push(actionRow('Run flow', { action: 'executeFlow', actionParams: JSON.stringify({ id: kebab.flowId.trim() }) }));
  }
  if (kebab.actions.setValue && kebab.setValueField?.trim() && kebab.setValueVal?.trim()) {
    out.push(actionRow('Set value', { action: 'setValue', actionInput: { [kebab.setValueField.trim()]: kebab.setValueVal.trim() } }));
  }
  return out;
}

/** The kebab trigger. ALWAYS a <button> with the glyph as direct txtContent and
 *  NO children array — the field-proven safe trigger (linter `card-trigger-button`). */
export function buildKebab(kebab: KebabConfig): SPElement | null {
  if (!kebab.enabled) return null;
  const triggerStyle: Record<string, string> = {
    'cursor': 'pointer', 'border': 'none', 'background-color': 'transparent', 'font-size': '18px', 'line-height': '1',
  };
  if (kebab.behavior === 'native') {
    return { elmType: 'button', txtContent: '⋯', attributes: { title: 'Item actions' },
      style: triggerStyle, customRowAction: { action: 'openContextMenu' } };
  }
  const actions = buildActionButtons(kebab);
  if (!actions.length) return null; // refuse an empty/all-blank custom kebab
  return {
    elmType: 'button', txtContent: '⋯', attributes: { title: 'Actions' }, style: triggerStyle,
    customCardProps: {
      openOnEvent: 'click', directionalHint: 'bottomRightEdge', isBeakVisible: true,
      formatter: { elmType: 'div',
        style: { 'display': 'flex', 'flex-direction': 'column', 'padding': '4px', 'min-width': '160px' },
        children: actions },
    },
  };
}

// ─── wireframes (the pre-built layouts) ──────────────────────────────────────

/** One seeded item slot in a wireframe zone: preferred field types, best first.
 *  `[]` = any type. A slot with no matching untaken field seeds nothing. */
export interface WireframeZoneSpec {
  label: string;
  size: ZoneSize;
  flow: ZoneFlow;
  want: FieldType[][];
}
export interface Wireframe {
  id: WireframeId;
  name: string;
  blurb: string;
  zones: WireframeZoneSpec[];
}

export const WIREFRAMES: Wireframe[] = [
  {
    id: 'lead-detail', name: 'Lead + details',
    blurb: 'A main field up front, supporting details trailing — the details wrap under each other when the row tightens.',
    zones: [
      { label: 'Lead', size: 'wide', flow: 'side', want: [['text', 'note']] },
      { label: 'Details', size: 'normal', flow: 'wrap', want: [['choice', 'choiceMulti'], ['date']] },
    ],
  },
  {
    id: 'avatar-card', name: 'Avatar card',
    blurb: 'A person up front, a stacked title + status in the middle, a date hugging the end.',
    zones: [
      { label: 'Who', size: 'hug', flow: 'side', want: [['person', 'personMulti']] },
      { label: 'Main', size: 'widest', flow: 'stack', want: [['text', 'note'], ['choice', 'choiceMulti']] },
      { label: 'When', size: 'hug', flow: 'stack', want: [['date']] },
    ],
  },
  {
    id: 'title-chips', name: 'Title + chips',
    blurb: 'A title that fills, then a shelf of chips that flows onto new lines as the row narrows.',
    zones: [
      { label: 'Title', size: 'wide', flow: 'side', want: [['text', 'note']] },
      { label: 'Chips', size: 'wide', flow: 'wrap', want: [['choice', 'choiceMulti'], ['person', 'personMulti'], ['date']] },
    ],
  },
  {
    id: 'dashboard', name: 'Dashboard',
    blurb: 'Title, status, progress and people on one line — each zone sized to its job.',
    zones: [
      { label: 'Title', size: 'wide', flow: 'side', want: [['text', 'note']] },
      { label: 'Status', size: 'hug', flow: 'side', want: [['choice', 'choiceMulti']] },
      { label: 'Progress', size: 'normal', flow: 'side', want: [['number', 'currency']] },
      { label: 'People', size: 'hug', flow: 'side', want: [['person', 'personMulti']] },
    ],
  },
  {
    id: 'equal', name: 'Equal columns',
    blurb: 'Three equal zones, grid-like — a neutral starting point.',
    zones: [
      { label: 'Left', size: 'normal', flow: 'side', want: [[]] },
      { label: 'Middle', size: 'normal', flow: 'side', want: [[]] },
      { label: 'Right', size: 'normal', flow: 'side', want: [[]] },
    ],
  },
  {
    id: 'blank', name: 'Blank',
    blurb: 'One empty zone — drop fields and components to build from nothing.',
    zones: [
      { label: 'Zone', size: 'normal', flow: 'wrap', want: [] },
    ],
  },
];

export function wireframeById(id: WireframeId): Wireframe {
  return WIREFRAMES.find((w) => w.id === id) ?? WIREFRAMES[WIREFRAMES.length - 1];
}

const EMPTY_ACTIONS: KebabActionFlags = {
  defaultClick: false, editProps: false, share: false, delete: false, executeFlow: false, setValue: false,
};

/** A fresh field item with the flow-aware default width: fields FILL a zone
 *  unless it hugs (an avatar/meta zone wants natural content width). */
export function newFieldItem(fieldName: string, zone: Pick<ZoneConfig, 'size'>): FieldZoneItem {
  return { kind: 'field', fieldName, width: zone.size === 'hug' ? 'natural' : 'fill', text: 'truncate' };
}

/** A fresh component item — components ship their own layout, so they default
 *  to natural width; the mapping is bestGuessMapping-prefilled by the caller. */
export function newComponentItem(componentId: string, map: Record<string, string>): ComponentZoneItem {
  return { kind: 'component', componentId, map: { ...map }, width: 'natural' };
}

export function newZone(label = 'Zone'): ZoneConfig {
  // 'wrap' is the default flow: side by side until the zone tightens — the
  // graceful-shrink behavior makers almost always want.
  return { label, size: 'normal', flow: 'wrap', align: 'left', items: [] };
}

/** Seed a config from a wireframe: each zone's want-slots pick the first
 *  untaken schema field of an acceptable type (preference order; [] = any). */
export function defaultConfigFor(wireframeId: WireframeId, fields: MockField[]): RowTemplateConfig {
  const wf = wireframeById(wireframeId);
  const usable = fields.filter((f) => !f.protected);
  const taken = new Set<string>();
  const pick = (types: FieldType[]): MockField | undefined => {
    for (const t of types) {
      const f = usable.find((x) => x.type === t && !taken.has(x.name));
      if (f) return f;
    }
    return types.length === 0 ? usable.find((x) => !taken.has(x.name)) : undefined;
  };
  const zones: ZoneConfig[] = wf.zones.map((zs) => {
    const zone: ZoneConfig = { label: zs.label, size: zs.size, flow: zs.flow, align: 'left', items: [] };
    for (const want of zs.want) {
      const f = pick(want);
      if (!f) continue;
      taken.add(f.name);
      zone.items.push(newFieldItem(f.name, zone));
    }
    return zone;
  });
  // never seed a fully empty layout when the schema has fields — the first
  // zone gets the first field so the preview shows something real
  if (usable.length && zones.length && zones.every((z) => z.items.length === 0)) {
    zones[0].items.push(newFieldItem(usable[0].name, zones[0]));
  }
  return {
    wireframeId, rowStyle: 'flat', density: 'roomy',
    zebraStriping: false, hoverHighlight: false, hoverToken: 'themeLighter',
    borderStyle: 'none', borderColor: 'neutralQuaternaryAlt', leftStripe: 'none',
    zones, kebab: { enabled: false, behavior: 'custom', position: 'right', actions: { ...EMPTY_ACTIONS } },
  };
}

// ─── zone + item → SPElement ─────────────────────────────────────────────────

const ALIGN_JUSTIFY: Record<ZoneAlign, string> = { left: 'flex-start', center: 'center', right: 'flex-end' };

/** The item's flex behavior given its width and the zone's flow. The wrap-flow
 *  rules are the heart of the feature: NO min-width:0 there, so a squeezed item
 *  hits its content minimum and flex-wrap moves it beneath its neighbor instead
 *  of crushing it. */
function applyItemSizing(el: SPElement, width: ItemWidth, flow: ZoneFlow): void {
  el.style = { ...el.style };
  // gridCellForField ships the grid defaults (flex:1/min-width:0) — re-derive
  delete el.style['flex'];
  delete el.style['min-width'];
  if (flow === 'stack') {
    el.style['flex'] = '0 0 auto';
    if (width === 'fill') el.style['width'] = '100%';
    return;
  }
  if (flow === 'wrap') {
    if (width === 'fill') {
      el.style['flex'] = '1 1 auto'; // natural basis; grows to fill its line, wraps when tight
    } else {
      el.style['flex'] = '0 0 auto';
      el.style['max-width'] = '100%';
    }
    return;
  }
  // 'side': the classic single-line zone — fill items share, truncation absorbs
  if (width === 'fill') {
    el.style['flex'] = '1 1 0%';
    el.style['min-width'] = '0';
  } else {
    el.style['flex'] = '0 0 auto';
  }
}

function applyText(el: SPElement, text: 'truncate' | 'wrap'): void {
  el.style = el.style ?? {};
  if (text === 'truncate') {
    el.style['overflow'] = 'hidden';
    el.style['text-overflow'] = 'ellipsis';
    el.style['white-space'] = 'nowrap';
  } else {
    el.style['white-space'] = 'normal';
  }
}

function itemEl(
  item: ZoneItem, zone: ZoneConfig,
  fields: MockField[], columnRefs: Record<string, SPElement>, components: ComponentDef[],
): SPElement {
  if (item.kind === 'component') {
    const def = components.find((c) => c.id === item.componentId);
    if (!def) {
      // a component deleted while the builder held it — honest placeholder, never a guess
      return { elmType: 'div', _elmName: 'Missing component', txtContent: '⚠ missing component',
        style: { 'font-size': '11px', 'flex': '0 0 auto' } };
    }
    const bound = bindComponentInstance(def, item.map); // stamped — the ⬡ inventory sees it
    applyItemSizing(bound, item.width, zone.flow);
    return bound;
  }
  const field = fields.find((f) => f.name === item.fieldName);
  const cell: SPElement = field
    ? gridCellForField(field, columnRefs)
    : { elmType: 'div', _elmName: 'Empty item' };
  applyItemSizing(cell, item.width, zone.flow);
  applyText(cell, item.text);
  return cell;
}

/** A zone → its flex container. Exported for the brain tests. */
export function buildZone(
  zone: ZoneConfig,
  fields: MockField[], columnRefs: Record<string, SPElement>, components: ComponentDef[],
): SPElement {
  const style: Record<string, string> = { 'display': 'flex' };
  if (zone.size === 'hug') {
    style['flex'] = '0 0 auto';
  } else {
    style['flex'] = WEIGHT_FLEX[zone.size];
    style['min-width'] = '0'; // a fill zone must be allowed to shrink (areas.ts invariant)
  }
  if (zone.flow === 'stack') {
    style['flex-direction'] = 'column';
    style['gap'] = '2px';
    style['align-items'] = ALIGN_JUSTIFY[zone.align];
  } else {
    if (zone.flow === 'wrap') style['flex-wrap'] = 'wrap';
    style['gap'] = '8px';
    style['align-items'] = 'center';
    if (zone.align !== 'left') style['justify-content'] = ALIGN_JUSTIFY[zone.align];
  }
  if (zone.align !== 'left') style['text-align'] = zone.align;
  return {
    elmType: 'div',
    _elmName: `${zone.label} zone`,
    style,
    children: zone.items.map((it) => itemEl(it, zone, fields, columnRefs, components)),
  };
}

function placeKebab(zoneEls: SPElement[], kebab: SPElement | null, position: KebabPosition): SPElement[] {
  if (!kebab) return zoneEls;
  switch (position) {
    case 'left': return [kebab, ...zoneEls];
    case 'title': return zoneEls.length ? [zoneEls[0], kebab, ...zoneEls.slice(1)] : [kebab];
    default: return [...zoneEls, kebab]; // right + hover
  }
}

function joinClass(existing: unknown, add: string): string {
  return `${typeof existing === 'string' ? existing + ' ' : ''}${add}`.trim();
}

export function buildTemplateView(
  config: RowTemplateConfig, fields: MockField[],
  columnRefs: Record<string, SPElement>, palette: Record<string, string>,
  components: ComponentDef[] = [],
  opts: { prune?: boolean } = {},
): { root: SPElement; additionalRowClass?: string } {
  const composed = composeRowStyle(config, palette);
  const zones = opts.prune ? config.zones.filter((z) => z.items.length > 0) : config.zones;
  const zoneEls = zones.map((z) => buildZone(z, fields, columnRefs, components));

  const kebab = config.kebab.enabled ? buildKebab(config.kebab) : null;
  if (kebab && config.kebab.position === 'hover') {
    kebab.attributes = { ...kebab.attributes, class: joinClass(kebab.attributes?.class, 'sp-card-showOnHoverChild') };
  }
  const children = placeKebab(zoneEls, kebab, config.kebab.position);

  const root: SPElement = {
    elmType: 'div', _elmName: 'Row layout',
    style: { 'display': 'flex', 'align-items': 'center', 'width': '100%', ...composed.rootStyle },
    children,
  };
  const cls = composed.rootClass.slice();
  if (kebab && config.kebab.position === 'hover') cls.push('sp-card-showOnHoverParent');
  if (cls.length) root.attributes = { class: cls.join(' ') };
  setRowDensity(root, config.density);          // areas.ts: gap + padding only
  return { root, additionalRowClass: composed.wrapperAdditionalRowClass };
}

// ─── free-form zone/item ops (immutable; consumed by the builder modal) ──────

export function addZone(config: RowTemplateConfig, zone: ZoneConfig = newZone()): RowTemplateConfig {
  return { ...config, zones: [...config.zones, zone] };
}

export function removeZone(config: RowTemplateConfig, i: number): RowTemplateConfig {
  return { ...config, zones: config.zones.filter((_, idx) => idx !== i) };
}

export function moveZone(config: RowTemplateConfig, from: number, to: number): RowTemplateConfig {
  const n = config.zones.length;
  // guard NaN/float indices (e.g. a malformed drag payload): without this, NaN
  // slips past the range checks below and splice(NaN, …) silently acts as index 0.
  if (!Number.isInteger(from) || !Number.isInteger(to)) return config;
  if (from < 0 || from >= n || to < 0 || to >= n || from === to) return config;
  const zones = config.zones.slice();
  const [moved] = zones.splice(from, 1);
  zones.splice(to, 0, moved);
  return { ...config, zones };
}

export function patchZone(config: RowTemplateConfig, i: number, patch: Partial<Omit<ZoneConfig, 'items'>>): RowTemplateConfig {
  if (i < 0 || i >= config.zones.length) return config;
  const zones = config.zones.map((z, idx) => (idx === i ? { ...z, ...patch } : z));
  return { ...config, zones };
}

export function addItem(config: RowTemplateConfig, zi: number, item: ZoneItem): RowTemplateConfig {
  if (zi < 0 || zi >= config.zones.length) return config;
  const zones = config.zones.map((z, idx) => (idx === zi ? { ...z, items: [...z.items, item] } : z));
  return { ...config, zones };
}

export function removeItem(config: RowTemplateConfig, zi: number, ii: number): RowTemplateConfig {
  const zone = config.zones[zi];
  if (!zone || ii < 0 || ii >= zone.items.length) return config;
  const zones = config.zones.map((z, idx) =>
    (idx === zi ? { ...z, items: z.items.filter((_, j) => j !== ii) } : z));
  return { ...config, zones };
}

/** Move an item within or across zones. `toItem` is the insertion index in the
 *  TARGET zone's post-removal item list; out-of-range clamps to the end. */
export function moveItem(
  config: RowTemplateConfig, fromZone: number, fromItem: number, toZone: number, toItem: number,
): RowTemplateConfig {
  if (![fromZone, fromItem, toZone, toItem].every(Number.isInteger)) return config;
  const src = config.zones[fromZone];
  const dst = config.zones[toZone];
  if (!src || !dst || fromItem < 0 || fromItem >= src.items.length) return config;
  if (fromZone === toZone && fromItem === toItem) return config;
  const zones = config.zones.map((z) => ({ ...z, items: z.items.slice() }));
  const [moved] = zones[fromZone].items.splice(fromItem, 1);
  const target = zones[toZone].items;
  target.splice(Math.max(0, Math.min(toItem, target.length)), 0, moved);
  return { ...config, zones };
}

/** A cross-kind item patch: any per-item knob except the discriminant. */
export type ZoneItemPatch = Partial<Omit<FieldZoneItem, 'kind'>> & Partial<Omit<ComponentZoneItem, 'kind'>>;

export function patchItem(
  config: RowTemplateConfig, zi: number, ii: number, patch: ZoneItemPatch,
): RowTemplateConfig {
  const zone = config.zones[zi];
  if (!zone || ii < 0 || ii >= zone.items.length) return config;
  const zones = config.zones.map((z, idx) =>
    (idx === zi ? { ...z, items: z.items.map((it, j) => (j === ii ? { ...it, ...patch } as ZoneItem : it)) } : z));
  return { ...config, zones };
}

const SIZE_CYCLE: ZoneSize[] = ['hug', 'normal', 'wide', 'widest'];
/** The next size in the Hug → Fill → Fill 2× → Fill 3× → Hug cycle (divider click). */
export function nextZoneSize(s: ZoneSize): ZoneSize {
  return SIZE_CYCLE[(SIZE_CYCLE.indexOf(s) + 1) % SIZE_CYCLE.length];
}

export const ZONE_SIZE_LABEL: Record<ZoneSize, string> = {
  hug: 'Hug content', normal: 'Fill', wide: 'Fill 2×', widest: 'Fill 3×',
};

/** Why Apply is blocked, or null when it may proceed (refuse-and-teach: an
 *  unmapped component slot would silently render blank on real SP). */
export function applyBlocker(config: RowTemplateConfig, components: ComponentDef[]): string | null {
  if (!config.zones.some((z) => z.items.length > 0)) {
    return 'Drop at least one field or component into a zone first';
  }
  for (const z of config.zones) {
    for (const it of z.items) {
      if (it.kind !== 'component') continue;
      const def = components.find((c) => c.id === it.componentId);
      if (!def) return `A zone holds a component that no longer exists — remove it (${z.label})`;
      if (def.slots.some((s) => !it.map[s.key])) {
        return `Map every slot of “${def.name}” to a column (select it to finish the mapping)`;
      }
    }
  }
  return null;
}

/** The order buildTemplateView lays out root children: each entry is a zone
 *  index or 'kebab'. Mirrors placeKebab + the buildKebab-null refusal EXACTLY,
 *  so the Edit overlay can map rendered DOM children back to zones (and skip the
 *  spliced kebab slot) without guessing. Pinned by rowTemplates.test.ts. */
export function childSlotOrder(config: RowTemplateConfig): (number | 'kebab')[] {
  const zoneSlots: (number | 'kebab')[] = config.zones.map((_, i) => i);
  const kebabEl = config.kebab.enabled ? buildKebab(config.kebab) : null;
  if (!kebabEl) return zoneSlots;
  switch (config.kebab.position) {
    case 'left': return ['kebab', ...zoneSlots];
    case 'title': return zoneSlots.length ? [zoneSlots[0], 'kebab', ...zoneSlots.slice(1)] : ['kebab'];
    default: return [...zoneSlots, 'kebab']; // right + hover
  }
}
