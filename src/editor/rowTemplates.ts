// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Sam Yost

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
 *   · an ITEM is 'natural' (hug its content) or 'fill' (grow into the zone);
 *   · a TARGET says what the layout applies AS: a full-width 'row', or a
 *     fixed 'tile' in the gallery grid — the same zones stack vertically
 *     inside the tile box (zone size then shares HEIGHT instead of width).
 *
 * COMPOSES the shipped engines: areas.ts weights, gridScaffold cells,
 * components.ts binding (component items are bound + instance-stamped, so the
 * ⬡ inventory sees them). The style compositor and kebab builder carry over
 * from the 2026-06-24 overhaul unchanged — their semantics are verified.
 */
import type { MockField, FieldType, SPElement, CustomRowAction } from '../core/types';
import type { AreaWeight, RowDensity } from './areas';
import { WEIGHT_FLEX, setRowDensity, rowDensityOf } from './areas';
import { gridCellForField, fieldRefsIn as gridFieldRefsIn } from './gridScaffold';
import { bindComponentInstance, type ComponentDef } from './components';
import { stripExpressionWhitespace } from '../core/linter';

export type WireframeId =
  | 'lead-detail' | 'avatar-card' | 'title-chips' | 'dashboard' | 'equal' | 'blank'
  | 'tile-headline' | 'tile-profile' | 'tile-stat' | 'tile-blank';
/** What the layout applies AS: a full-width row, or a fixed tile in the
 *  gallery grid. Same zones either way — a tile just stacks them vertically. */
export type BuilderTarget = 'row' | 'tile';
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
/**
 * The VERTICAL axis of a zone — how its items line up with each other:
 * for side/wrap flows this is the cross axis (`align-items`; 'middle' is the
 * classic centered row), for stack it's where the pile sits when the zone is
 * taller than its content (`justify-content`; 'baseline' has no meaning on a
 * column axis and paints as 'top'). Alignment always lives on the CONTAINER:
 * per-child `align-self` is reported broken on real SP (unverified — see
 * KNOWN_UNSUPPORTED_STYLES), so the builder never offers a per-item override.
 */
export type ZoneVAlign = 'top' | 'middle' | 'bottom' | 'baseline';
/** The row root adds 'stretch': zones fill the row's height, which is what
 *  lets each zone then place its own content via its `valign`. */
export type RootVAlign = ZoneVAlign | 'stretch';
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
/** ZONES NEST: a zone is itself a valid item of another zone. The nested
 *  zone's own `size` governs how it takes space in its parent; its `flow`
 *  governs its own items — the same two knobs at every depth. */
export interface NestedZoneItem {
  kind: 'zone';
  zone: ZoneConfig;
}
export type ZoneItem = FieldZoneItem | ComponentZoneItem | NestedZoneItem;

/**
 * The address of a zone OR an item anywhere in the nested structure:
 * `[rootZoneIndex, itemIndex, itemIndex, …]`. `[i]` is a root zone; each
 * further index steps into the current zone's `items`; a step that lands on a
 * `kind: 'zone'` item may keep descending. One address space for everything
 * the builder can select or drag.
 */
export type ZonePath = number[];

export interface ZoneConfig {
  label: string;
  size: ZoneSize;
  flow: ZoneFlow;
  align: ZoneAlign;
  valign: ZoneVAlign;
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
  /** 'row' = the classic full-width row; 'tile' = a fixed gallery tile whose
   *  zones stack top to bottom. The zone model is identical either way. */
  target: BuilderTarget;
  rowStyle: RowStyle;
  density: RowDensity;
  zebraStriping: boolean;
  hoverHighlight: boolean;
  hoverToken: string;          // a theme token name; default 'themeLighter'
  borderStyle: BorderStyle;
  borderColor: string;         // a theme token name for sp-css-borderColor-*
  leftStripe: LeftStripe;
  /** The TOP-LEVEL vertical relationship: how the zones line up against each
   *  other on the row (`align-items`; 'middle' is SP's classic row centering),
   *  or where the zone stack sits inside a tile box (`justify-content`; 'top'
   *  is where a column naturally starts — stretch/baseline are row ideas and
   *  paint as top there). */
  rootVAlign: RootVAlign;
  /** ROW only: how zones pack horizontally when none of them fills
   *  (`justify-content`; 'left' emits nothing). Tiles ignore it — their zones
   *  span the tile's width. */
  rootAlign: ZoneAlign;
  zones: ZoneConfig[];
  kebab: KebabConfig;
  /** The tile box (the wrapper's width/height) — meaningful only when
   *  target === 'tile'. SP's stock tile is 254×220. */
  tileWidth?: number;
  tileHeight?: number;
}

export const TILE_DEFAULT_WIDTH = 254;
export const TILE_DEFAULT_HEIGHT = 220;

/** The zebra conditional the builder folds into the ROOT's class expression
 *  (the `@rowIndex % 2` trick). It deliberately does NOT ride the wrapper's
 *  additionalRowClass: SharePoint IGNORES that property whenever a
 *  rowFormatter is present (MS syntax reference — they are mutually
 *  exclusive), so wrapper-borne zebra silently never striped on real SP. */
export const ZEBRA_CLASS_EXPR = "if(@rowIndex % 2 == 0,'ms-bgColor-themeLighter','')";
/** The RETIRED wrapper form older applied views carry. The round-trip parser
 *  refuses it like any other additionalRowClass now (reopen falls back to
 *  the gallery with the honest foreign note; re-Apply emits the root form). */
export const ZEBRA_ROW_CLASS = `=${ZEBRA_CLASS_EXPR}`;

export interface ComposedRowStyle {
  rootStyle: Record<string, string>;
  rootClass: string[];
  /** Fold ZEBRA_CLASS_EXPR into the root's class (build-time concern). */
  zebra: boolean;
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
  // tiles sit in a grid, so "every other row" has no meaning there
  // (the target fact outranks any style reason, so it's stamped last)
  if (config.target === 'tile') {
    disabled.zebra = 'Striping alternates rows — tiles sit in a grid';
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

  // --- layer 4: background/state --- (zebra folds into the root CLASS at
  // build time — the @rowIndex modulus conditional, never the wrapper)
  return finalize(rootStyle, rootClass, disabled, zebraLive && config.zebraStriping, config);
}

function finalize(
  rootStyle: Record<string, string>, rootClass: string[],
  disabled: Partial<Record<StyleToggle, string>>,
  zebra: boolean, config: RowTemplateConfig,
): ComposedRowStyle {
  if (config.hoverHighlight) rootClass.push(`ms-bgColor-${config.hoverToken}--hover`);
  return { rootStyle, rootClass, zebra, disabled };
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
  align?: ZoneAlign;
  valign?: ZoneVAlign;
  want: FieldType[][];
}
export interface Wireframe {
  id: WireframeId;
  name: string;
  /** Which canvas this wireframe seeds — the gallery groups by it. */
  target: BuilderTarget;
  blurb: string;
  zones: WireframeZoneSpec[];
}

export const WIREFRAMES: Wireframe[] = [
  {
    id: 'lead-detail', name: 'Lead + details', target: 'row',
    blurb: 'A main field up front, supporting details trailing — the details wrap under each other when the row tightens.',
    zones: [
      { label: 'Lead', size: 'wide', flow: 'side', want: [['text', 'note']] },
      { label: 'Details', size: 'normal', flow: 'wrap', want: [['choice', 'choiceMulti'], ['date']] },
    ],
  },
  {
    id: 'avatar-card', name: 'Avatar card', target: 'row',
    blurb: 'A person up front, a stacked title + status in the middle, a date hugging the end.',
    zones: [
      { label: 'Who', size: 'hug', flow: 'side', want: [['person', 'personMulti']] },
      { label: 'Main', size: 'widest', flow: 'stack', want: [['text', 'note'], ['choice', 'choiceMulti']] },
      { label: 'When', size: 'hug', flow: 'stack', want: [['date']] },
    ],
  },
  {
    id: 'title-chips', name: 'Title + chips', target: 'row',
    blurb: 'A title that fills, then a shelf of chips that flows onto new lines as the row narrows.',
    zones: [
      { label: 'Title', size: 'wide', flow: 'side', want: [['text', 'note']] },
      { label: 'Chips', size: 'wide', flow: 'wrap', want: [['choice', 'choiceMulti'], ['person', 'personMulti'], ['date']] },
    ],
  },
  {
    id: 'dashboard', name: 'Dashboard', target: 'row',
    blurb: 'Title, status, progress and people on one line — each zone sized to its job.',
    zones: [
      { label: 'Title', size: 'wide', flow: 'side', want: [['text', 'note']] },
      { label: 'Status', size: 'hug', flow: 'side', want: [['choice', 'choiceMulti']] },
      { label: 'Progress', size: 'normal', flow: 'side', want: [['number', 'currency']] },
      { label: 'People', size: 'hug', flow: 'side', want: [['person', 'personMulti']] },
    ],
  },
  {
    id: 'equal', name: 'Equal columns', target: 'row',
    blurb: 'Three equal zones, grid-like — a neutral starting point.',
    zones: [
      { label: 'Left', size: 'normal', flow: 'side', want: [[]] },
      { label: 'Middle', size: 'normal', flow: 'side', want: [[]] },
      { label: 'Right', size: 'normal', flow: 'side', want: [[]] },
    ],
  },
  {
    id: 'blank', name: 'Blank', target: 'row',
    blurb: 'One empty zone — drop fields and components to build from nothing.',
    zones: [
      { label: 'Zone', size: 'normal', flow: 'wrap', want: [] },
    ],
  },
  // ── tile wireframes: the same zones, stacked top to bottom in a fixed tile ──
  {
    id: 'tile-headline', name: 'Headline tile', target: 'tile',
    blurb: 'A title up top, details in the middle, a footer hugging the bottom of the tile.',
    zones: [
      { label: 'Headline', size: 'hug', flow: 'side', want: [['text', 'note']] },
      { label: 'Body', size: 'normal', flow: 'wrap', want: [['choice', 'choiceMulti'], ['number', 'currency']] },
      { label: 'Footer', size: 'hug', flow: 'side', want: [['person', 'personMulti'], ['date']] },
    ],
  },
  {
    id: 'tile-profile', name: 'Profile tile', target: 'tile',
    blurb: 'A person front and center, name and status stacked beneath them.',
    zones: [
      { label: 'Who', size: 'normal', flow: 'side', align: 'center', want: [['person', 'personMulti']] },
      { label: 'About', size: 'hug', flow: 'stack', align: 'center', want: [['text', 'note'], ['choice', 'choiceMulti']] },
    ],
  },
  {
    id: 'tile-stat', name: 'Stat tile', target: 'tile',
    blurb: 'One big figure with its label — a dashboard card.',
    zones: [
      { label: 'Label', size: 'hug', flow: 'side', want: [['text', 'note']] },
      { label: 'Figure', size: 'normal', flow: 'side', align: 'center', want: [['number', 'currency']] },
      { label: 'Context', size: 'hug', flow: 'wrap', want: [['choice', 'choiceMulti'], ['date']] },
    ],
  },
  {
    id: 'tile-blank', name: 'Blank tile', target: 'tile',
    blurb: 'One zone filling the tile — build from nothing.',
    zones: [
      { label: 'Zone', size: 'normal', flow: 'wrap', want: [] },
    ],
  },
];

export function wireframeById(id: WireframeId): Wireframe {
  // fallback stays the ROW blank — tile is always an explicit pick
  return WIREFRAMES.find((w) => w.id === id) ?? WIREFRAMES.find((w) => w.id === 'blank')!;
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
  return { label, size: 'normal', flow: 'wrap', align: 'left', valign: 'middle', items: [] };
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
    const zone: ZoneConfig = {
      label: zs.label, size: zs.size, flow: zs.flow,
      align: zs.align ?? 'left', valign: zs.valign ?? defaultZoneVAlign(zs.flow), items: [],
    };
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
    wireframeId, target: wf.target, rowStyle: 'flat', density: 'roomy',
    zebraStriping: false, hoverHighlight: false, hoverToken: 'themeLighter',
    borderStyle: 'none', borderColor: 'neutralQuaternaryAlt', leftStripe: 'none',
    rootVAlign: defaultRootVAlign(wf.target), rootAlign: 'left',
    zones, kebab: { enabled: false, behavior: 'custom', position: 'right', actions: { ...EMPTY_ACTIONS } },
    ...(wf.target === 'tile' ? { tileWidth: TILE_DEFAULT_WIDTH, tileHeight: TILE_DEFAULT_HEIGHT } : {}),
  };
}

// ─── zone + item → SPElement ─────────────────────────────────────────────────

const ALIGN_JUSTIFY: Record<ZoneAlign, string> = { left: 'flex-start', center: 'center', right: 'flex-end' };
/** valign → align-items (the cross axis of a row flow). */
const VALIGN_ITEMS: Record<RootVAlign, string> = {
  top: 'flex-start', middle: 'center', bottom: 'flex-end', baseline: 'baseline', stretch: 'stretch',
};

/** The vertical default per flow: row flows center (SP's classic look), a
 *  stack starts at the top like text. These are also what pre-alignment
 *  builder trees carry, so defaults keep old layouts reopening byte-identically. */
export function defaultZoneVAlign(flow: ZoneFlow): ZoneVAlign {
  return flow === 'stack' ? 'top' : 'middle';
}
/** The root default per target: a row centers its zones, a tile stack starts
 *  at the top of the box. Same byte-compatibility contract as zone valign. */
export function defaultRootVAlign(target: BuilderTarget): RootVAlign {
  return target === 'tile' ? 'top' : 'middle';
}

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
  fields: MockField[], columnLooks: Record<string, SPElement>, components: ComponentDef[],
): SPElement {
  if (item.kind === 'zone') {
    // a nested zone builds like any zone — its own size IS its item sizing
    return buildZone(item.zone, fields, columnLooks, components);
  }
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
    ? gridCellForField(field, columnLooks)
    : { elmType: 'div', _elmName: 'Empty item' };
  applyItemSizing(cell, item.width, zone.flow);
  applyText(cell, item.text);
  return cell;
}

/** A zone → its flex container. Exported for the brain tests. */
export function buildZone(
  zone: ZoneConfig,
  fields: MockField[], columnLooks: Record<string, SPElement>, components: ComponentDef[],
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
    // valign is the MAIN axis here: where the pile sits when the zone is
    // taller than its content (a stretched row zone, a tile height share).
    // 'top' is the CSS start and emits nothing — exactly what old trees carry;
    // 'baseline' has no meaning on a column axis and paints as top too.
    if (zone.valign === 'middle') style['justify-content'] = 'center';
    else if (zone.valign === 'bottom') style['justify-content'] = 'flex-end';
  } else {
    if (zone.flow === 'wrap') style['flex-wrap'] = 'wrap';
    style['gap'] = '8px';
    style['align-items'] = VALIGN_ITEMS[zone.valign]; // 'middle' = the old hardcoded center
    if (zone.align !== 'left') style['justify-content'] = ALIGN_JUSTIFY[zone.align];
  }
  if (zone.align !== 'left') style['text-align'] = zone.align;
  return {
    elmType: 'div',
    _elmName: `${zone.label} zone`,
    style,
    children: zone.items.map((it) => itemEl(it, zone, fields, columnLooks, components)),
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

/** Drop content-free zones at every depth (Apply never ships empty divs). */
export function pruneZones(zones: ZoneConfig[]): ZoneConfig[] {
  const pruneOne = (z: ZoneConfig): ZoneConfig => ({
    ...z,
    items: z.items
      .map((it) => (it.kind === 'zone' ? { kind: 'zone' as const, zone: pruneOne(it.zone) } : it))
      .filter((it) => it.kind !== 'zone' || it.zone.items.length > 0),
  });
  return zones.map(pruneOne).filter((z) => z.items.length > 0);
}

export function buildTemplateView(
  config: RowTemplateConfig, fields: MockField[],
  columnLooks: Record<string, SPElement>, palette: Record<string, string>,
  components: ComponentDef[] = [],
  opts: { prune?: boolean } = {},
): { root: SPElement } {
  const composed = composeRowStyle(config, palette);
  const zones = opts.prune ? pruneZones(config.zones) : config.zones;
  const zoneEls = zones.map((z) => buildZone(z, fields, columnLooks, components));

  // the kebab is a row-layout feature: in a vertical tile every position would
  // read as a full-width stacked strip, so tiles refuse it (teach, don't guess)
  const kebab = config.target !== 'tile' && config.kebab.enabled ? buildKebab(config.kebab) : null;
  if (kebab && config.kebab.position === 'hover') {
    kebab.attributes = { ...kebab.attributes, class: joinClass(kebab.attributes?.class, 'sp-card-showOnHoverChild') };
  }
  const children = placeKebab(zoneEls, kebab, config.kebab.position);

  // the root's own alignment (the top-level relationship the zones share):
  // a tile places its stack on the column main axis — 'top' emits nothing
  // (byte-compatible with pre-alignment trees), and the row-only ideas
  // (stretch/baseline) land as top rather than emitting something unverified.
  const tileJustify: Record<string, string> = config.rootVAlign === 'middle'
    ? { 'justify-content': 'center' }
    : config.rootVAlign === 'bottom' ? { 'justify-content': 'flex-end' } : {};
  const root: SPElement = config.target === 'tile'
    ? {
      // the tile stack: zones top to bottom, filling the fixed tile box
      // (border-box so the density padding never overflows it; hug zones at
      // the bottom really hug the bottom because the root spans full height)
      elmType: 'div', _elmName: 'Tile layout',
      style: {
        'display': 'flex', 'flex-direction': 'column', 'box-sizing': 'border-box',
        'width': '100%', 'height': '100%', 'overflow': 'hidden',
        ...tileJustify, ...composed.rootStyle,
      },
      children,
    }
    : {
      elmType: 'div', _elmName: 'Row layout',
      style: {
        'display': 'flex', 'align-items': VALIGN_ITEMS[config.rootVAlign], 'width': '100%',
        ...(config.rootAlign !== 'left' ? { 'justify-content': ALIGN_JUSTIFY[config.rootAlign] } : {}),
        ...composed.rootStyle,
      },
      children,
    };
  const cls = composed.rootClass.slice();
  if (kebab && config.kebab.position === 'hover') cls.push('sp-card-showOnHoverParent');
  if (composed.zebra) {
    // statics + the modulus conditional in ONE class expression — this is
    // the striping that actually works on real SP (wrapper zebra died with
    // the additionalRowClass retirement, see ZEBRA_CLASS_EXPR)
    root.attributes = {
      class: cls.length ? `='${cls.join(' ')} ' + ${ZEBRA_CLASS_EXPR}` : `=${ZEBRA_CLASS_EXPR}`,
    };
  } else if (cls.length) {
    root.attributes = { class: cls.join(' ') };
  }
  setRowDensity(root, config.density);          // areas.ts: gap + padding only
  return { root };
}

/** Fold a retired wrapper additionalRowClass into the ROOT's class, where
 *  conditional row styling actually works on real SP (the wrapper form is
 *  ignored next to a rowFormatter). Handles the stored row-component defs
 *  from before the retirement: static classes append; an `=`-expression
 *  composes with any existing static class; an expression-on-expression
 *  collision keeps the root's own class (never emit un-parseable output). */
export function foldRowClassIntoRoot(root: SPElement, rowClass: string): SPElement {
  const out = JSON.parse(JSON.stringify(root)) as SPElement;
  const existing = out.attributes?.class;
  // an AST (object-form) class is a supported SPExpr the string composer
  // can't rewrite — REFUSE the fold rather than overwrite either side
  if (existing !== undefined && typeof existing !== 'string') return out;
  let next: string;
  if (existing === undefined) {
    next = rowClass;
  } else if (rowClass.startsWith('=') && existing.startsWith('=')) {
    // both are class-string expressions — compose them (a space between)
    next = `=(${existing.slice(1)}) + ' ' + (${rowClass.slice(1)})`;
  } else if (rowClass.startsWith('=')) {
    next = `='${existing} ' + ${rowClass.slice(1)}`;
  } else if (existing.startsWith('=')) {
    next = `=(${existing.slice(1)}) + ' ${rowClass}'`;
  } else {
    next = `${existing} ${rowClass}`;
  }
  out.attributes = { ...out.attributes, class: next };
  return out;
}

// ─── free-form zone/item ops (immutable; consumed by the builder modal) ──────

export function addZone(config: RowTemplateConfig, zone: ZoneConfig = newZone()): RowTemplateConfig {
  return insertZone(config, config.zones.length, zone);
}

/** Insert a zone at `at` (clamped) — dropping a payload BETWEEN zones spawns
 *  a new zone right there. */
export function insertZone(config: RowTemplateConfig, at: number, zone: ZoneConfig = newZone()): RowTemplateConfig {
  if (!Number.isInteger(at)) return config;
  const zones = config.zones.slice();
  zones.splice(Math.max(0, Math.min(at, zones.length)), 0, zone);
  return { ...config, zones };
}

// ─── path resolvers + immutable descent (zones nest — flat indices retired) ──

/** The zone a path names: a root zone, or a nested `kind:'zone'` item's zone.
 *  Null when the path doesn't land on a zone. */
export function zoneAt(config: RowTemplateConfig, path: ZonePath): ZoneConfig | null {
  if (!path.length || !path.every(Number.isInteger)) return null;
  let zone: ZoneConfig | undefined = config.zones[path[0]];
  for (let d = 1; zone && d < path.length; d++) {
    const item: ZoneItem | undefined = zone.items[path[d]];
    zone = item && item.kind === 'zone' ? item.zone : undefined;
  }
  return zone ?? null;
}

/** What a path selects: the ZONE when it names one (zone-first semantics),
 *  else the leaf item, else null. */
export function nodeAt(config: RowTemplateConfig, path: ZonePath): ZoneConfig | ZoneItem | null {
  const zone = zoneAt(config, path);
  if (zone) return zone;
  if (path.length < 2) return null;
  const parent = zoneAt(config, path.slice(0, -1));
  return parent?.items[path[path.length - 1]] ?? null;
}

/** Rebuild the zone a path names through `fn`, immutably. Null = bad path. */
function mapZoneAt(zones: ZoneConfig[], path: ZonePath, fn: (z: ZoneConfig) => ZoneConfig): ZoneConfig[] | null {
  if (!path.length || !path.every(Number.isInteger)) return null;
  const walkItems = (items: ZoneItem[], rest: ZonePath): ZoneItem[] | null => {
    const item = items[rest[0]];
    if (!item || item.kind !== 'zone') return null;
    const zone = rest.length === 1 ? fn(item.zone)
      : ((): ZoneConfig | null => {
        const inner = walkItems(item.zone.items, rest.slice(1));
        return inner ? { ...item.zone, items: inner } : null;
      })();
    if (!zone) return null;
    return items.map((it, i) => (i === rest[0] ? { kind: 'zone', zone } : it));
  };
  const root = zones[path[0]];
  if (!root) return null;
  const next = path.length === 1 ? fn(root)
    : ((): ZoneConfig | null => {
      const inner = walkItems(root.items, path.slice(1));
      return inner ? { ...root, items: inner } : null;
    })();
  if (!next) return null;
  return zones.map((z, i) => (i === path[0] ? next : z));
}

export function patchZoneAt(config: RowTemplateConfig, path: ZonePath, patch: Partial<Omit<ZoneConfig, 'items'>>): RowTemplateConfig {
  if (!zoneAt(config, path)) return config;
  const zones = mapZoneAt(config.zones, path, (z) => ({ ...z, ...patch }));
  return zones ? { ...config, zones } : config;
}

/** A cross-kind item patch: any per-item knob except the discriminant. */
export type ZoneItemPatch = Partial<Omit<FieldZoneItem, 'kind'>> & Partial<Omit<ComponentZoneItem, 'kind'>>;

export function patchItemAt(config: RowTemplateConfig, itemPath: ZonePath, patch: ZoneItemPatch): RowTemplateConfig {
  if (itemPath.length < 2) return config;
  const idx = itemPath[itemPath.length - 1];
  const parent = zoneAt(config, itemPath.slice(0, -1));
  const item = parent?.items[idx];
  if (!item || item.kind === 'zone') return config; // zones are patched via patchZoneAt
  const zones = mapZoneAt(config.zones, itemPath.slice(0, -1), (z) => ({
    ...z,
    items: z.items.map((it, i) => (i === idx ? { ...it, ...patch } as ZoneItem : it)),
  }));
  return zones ? { ...config, zones } : config;
}

/** Insert an item into the zone at `zonePath` (`at` clamped; omit = append). */
export function addItemAt(config: RowTemplateConfig, zonePath: ZonePath, item: ZoneItem, at?: number): RowTemplateConfig {
  if (!zoneAt(config, zonePath)) return config;
  const zones = mapZoneAt(config.zones, zonePath, (z) => {
    const items = z.items.slice();
    const ins = at === undefined || !Number.isInteger(at)
      ? items.length
      : Math.max(0, Math.min(at, items.length));
    items.splice(ins, 0, item);
    return { ...z, items };
  });
  return zones ? { ...config, zones } : config;
}

/** Remove whatever a path names — a root zone, a nested zone, or a leaf item. */
export function removeNode(config: RowTemplateConfig, path: ZonePath): RowTemplateConfig {
  if (!path.length || !path.every(Number.isInteger)) return config;
  if (path.length === 1) {
    if (!config.zones[path[0]]) return config;
    return { ...config, zones: config.zones.filter((_, i) => i !== path[0]) };
  }
  const idx = path[path.length - 1];
  const parent = zoneAt(config, path.slice(0, -1));
  if (!parent || !parent.items[idx]) return config;
  const zones = mapZoneAt(config.zones, path.slice(0, -1), (z) => ({
    ...z,
    items: z.items.filter((_, i) => i !== idx),
  }));
  return zones ? { ...config, zones } : config;
}

/**
 * THE move: relocate whatever `from` names to `toZone` at `toIndex`.
 * `toZone: []` = the root row — zones land as root zones, leaf items get
 * wrapped in a fresh zone (dropping a field between root zones spawns one).
 * Into a zone, zones land as NESTED zone items and leaves as themselves.
 * `toIndex` is the index in the target's POST-REMOVAL list (the caller
 * adjusts for same-parent forward moves, as before). Refuses a drop into the
 * moved zone's own subtree. Guarded no-ops return the same config reference.
 */
export function moveNode(config: RowTemplateConfig, from: ZonePath, toZone: ZonePath, toIndex: number): RowTemplateConfig {
  if (!from.length || !from.every(Number.isInteger) || !toZone.every(Number.isInteger) || !Number.isInteger(toIndex)) return config;
  // never into your own subtree (equal prefix includes "into itself")
  if (toZone.length >= from.length && from.every((v, i) => toZone[i] === v)) return config;

  const node = nodeAt(config, from);
  if (!node) return config;
  const asZone = 'items' in node ? node as ZoneConfig : null; // ZoneConfig has items; leaf items don't
  const asItem = asZone ? null : node as ZoneItem;

  const removed = removeNode(config, from);
  if (removed === config) return config;

  // the removal shifted any sibling that sat after `from` in the same parent —
  // re-aim the target path at the same zone it named before the removal
  const adj = toZone.slice();
  const d = from.length - 1;
  if (adj.length > d && from.slice(0, d).every((v, i) => adj[i] === v) && adj[d] > from[d]) adj[d] -= 1;

  if (adj.length === 0) {
    // landing on the root row: a zone stays a zone; a leaf gets a zone of its own
    const zone = asZone ?? { ...newZone(`Zone ${config.zones.length + 1}`), items: [asItem as ZoneItem] };
    return insertZone(removed, Math.max(0, Math.min(toIndex, removed.zones.length)), zone);
  }
  const item: ZoneItem = asZone ? { kind: 'zone', zone: asZone } : (asItem as ZoneItem);
  const next = addItemAt(removed, adj, item, toIndex);
  return next === removed ? config : next; // bad target after removal → whole move refuses
}

export const ZONE_SIZE_LABEL: Record<ZoneSize, string> = {
  hug: 'Hug content', normal: 'Fill', wide: 'Fill 2×', widest: 'Fill 3×',
};

export const ZONE_FLOW_LABEL: Record<ZoneFlow, string> = {
  side: 'Side by side', wrap: 'Wrap when tight', stack: 'Stacked',
};

export const ZONE_ALIGN_LABEL: Record<ZoneAlign, string> = {
  left: 'Left', center: 'Center', right: 'Right',
};

export const ZONE_VALIGN_LABEL: Record<RootVAlign, string> = {
  top: 'Top', middle: 'Middle', bottom: 'Bottom', baseline: 'Text baseline', stretch: 'Fill height',
};

// ─── config summary (the layout selector's details pane) ────────────────────

export interface ConfigSummary {
  /** Display names of the columns the config places, in layout order. */
  fields: string[];
  /** Names of the components the config places ('(missing)' for lost defs). */
  components: string[];
  /** Human sentences for every click/hover behavior Apply would write. */
  behaviors: string[];
  /** Top-level zones with the house vocabulary (ZONE_*_LABEL). */
  zones: { label: string; size: string; flow: string }[];
}

/** Maker-facing phrase for EVERY CustomRowAction the schema type admits —
 *  typed exhaustively so a new action is a compile error here, never a raw
 *  internal id leaking into the details pane. */
const ROW_ACTION_PHRASE: Record<Exclude<CustomRowAction['action'], ''>, string> = {
  defaultClick: 'opens the item', editProps: 'opens the edit form', share: 'shares the item',
  delete: 'deletes the item', executeFlow: 'runs a flow', setValue: 'sets a column value',
  openContextMenu: "opens SharePoint's item menu", embed: 'opens the embed dialog',
  copyLink: 'copies a link to the item', comment: 'opens the comments pane',
  openApprovalDialog: 'opens the approval dialog', executeQuickStep: 'runs a Quick Step',
  previewFileAction: 'previews the file (libraries only)',
  copyFile: 'copies the file (libraries only)', moveFile: 'moves the file (libraries only)',
};

/** Every behavior phrase an element tree would fire on real SP. */
function treeBehaviors(root: SPElement, out: Set<string>): void {
  const action = root.customRowAction?.action;
  if (action) out.add(ROW_ACTION_PHRASE[action]);
  // hyperlinks are click behaviors too — a details pane that misses them
  // would claim "no behaviors" over a link-bearing component
  if (root.elmType === 'a' && root.attributes?.href !== undefined) out.add('opens a link');
  if (root.customCardProps) {
    out.add('shows a card on hover or click');
    const inner = (root.customCardProps as { formatter?: SPElement }).formatter;
    if (inner) treeBehaviors(inner, out);
  }
  for (const child of root.children ?? []) treeBehaviors(child, out);
}

/**
 * What a config amounts to, in maker words — the pure source for the layout
 * selector's details pane. Derived from the SAME rules Apply uses (kebab
 * refusals, component defs), so the pane never promises what Apply won't write.
 */
export function summarizeConfig(
  config: RowTemplateConfig, fields: MockField[], components: ComponentDef[],
  columnLooks: Record<string, SPElement> = {},
): ConfigSummary {
  const fieldNames: string[] = [];
  const compNames: string[] = [];
  const behaviors = new Set<string>();
  const walk = (z: ZoneConfig): void => {
    for (const it of z.items) {
      if (it.kind === 'zone') { walk(it.zone); continue; }
      if (it.kind === 'field') {
        const f = fields.find((x) => x.name === it.fieldName);
        const label = f?.displayName ?? it.fieldName;
        if (label && !fieldNames.includes(label)) fieldNames.push(label);
        // a column LOOK can carry actions/links/hover cards — the built cell
        // embeds it (gridCellForField), so the pane must scan the same cell
        // the preview and Apply render, or it under-reports
        if (f) {
          const contributed = new Set<string>();
          treeBehaviors(gridCellForField(f, columnLooks), contributed);
          for (const b of contributed) behaviors.add(`“${label}” ${b}`);
        }
        continue;
      }
      const def = components.find((c) => c.id === it.componentId);
      if (!compNames.includes(def?.name ?? '(missing)')) compNames.push(def?.name ?? '(missing)');
      if (def) {
        const contributed = new Set<string>();
        treeBehaviors(def.root, contributed);
        for (const b of contributed) behaviors.add(`“${def.name}” ${b}`);
      }
    }
  };
  config.zones.forEach(walk);
  // the kebab exists on rows only (buildTemplateView refuses it on tiles), and
  // an all-blank custom kebab is refused too — mirror buildKebab exactly
  const kebabEl = config.target === 'row' ? buildKebab(config.kebab) : null;
  if (kebabEl) {
    const kb = new Set<string>();
    treeBehaviors(kebabEl, kb);
    kb.delete('shows a card on hover or click'); // the menu IS the card — name its actions instead
    behaviors.add(`Row menu (⋯) — ${[...kb].join(', ')}`);
  }
  if (config.hoverHighlight) {
    behaviors.add(config.target === 'tile' ? 'Highlights the tile on hover' : 'Highlights the row on hover');
  }
  if (config.zebraStriping && config.target === 'row') behaviors.add('Stripes alternating rows');
  return {
    fields: fieldNames, components: compNames, behaviors: [...behaviors],
    zones: config.zones.map((z) => ({
      label: z.label, size: ZONE_SIZE_LABEL[z.size], flow: ZONE_FLOW_LABEL[z.flow],
    })),
  };
}

/** Why Apply is blocked, or null when it may proceed (refuse-and-teach: an
 *  unmapped component slot would silently render blank on real SP). */
export function applyBlocker(config: RowTemplateConfig, components: ComponentDef[]): string | null {
  const hasContent = (z: ZoneConfig): boolean =>
    z.items.some((it) => (it.kind === 'zone' ? hasContent(it.zone) : true));
  if (!config.zones.some(hasContent)) {
    return 'Drop at least one field or component into a zone first';
  }
  const check = (z: ZoneConfig): string | null => {
    for (const it of z.items) {
      if (it.kind === 'zone') {
        const nested = check(it.zone);
        if (nested) return nested;
        continue;
      }
      if (it.kind !== 'component') continue;
      const def = components.find((c) => c.id === it.componentId);
      if (!def) return `A zone holds a component that no longer exists — remove it (${z.label})`;
      if (def.slots.some((s) => !it.map[s.key])) {
        return `Map every slot of “${def.name}” to a column (select it to finish the mapping)`;
      }
    }
    return null;
  };
  for (const z of config.zones) {
    const blocked = check(z);
    if (blocked) return blocked;
  }
  return null;
}

// ─── the round-trip parser (reopen an applied layout as editable zones) ──────
// configFromView is the builder's memory: it turns a row-view tree the builder
// (or an exact equivalent) produced back into a RowTemplateConfig. The parse is
// deliberately BEST-EFFORT — correctness comes from the rebuild-verify gate at
// the end: the parsed config is rebuilt through buildTemplateView and must
// deep-equal the original tree + wrapper class. Anything hand-edited beyond
// what the builder can represent fails that gate and returns null, so a lossy
// reopen-then-Apply can never silently destroy a maker's work (refuse-don't-
// guess, structurally).

/** Order-insensitive deep equality over plain JSON-ish values (objects compare
 *  by key set — undefined-valued keys ignored; arrays stay ordered). */
function deepEq(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length
      && a.every((v, i) => deepEq(v, b[i]));
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a).filter((k) => (a as Record<string, unknown>)[k] !== undefined);
    const kb = Object.keys(b).filter((k) => (b as Record<string, unknown>)[k] !== undefined);
    if (ka.length !== kb.length) return false;
    return ka.every((k) => deepEq((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
  }
  return false;
}

const classListOf = (el: SPElement): string[] =>
  (typeof el.attributes?.class === 'string' ? el.attributes.class : '').split(/\s+/).filter(Boolean);

/** Kebab candidate: the exact trigger shape buildKebab emits. */
function isKebabEl(el: SPElement): boolean {
  return el.elmType === 'button' && el.txtContent === '⋯'
    && (el.customRowAction?.action === 'openContextMenu' || Boolean(el.customCardProps));
}

function parseKebab(el: SPElement, index: number, lastIndex: number): KebabConfig | null {
  const hover = classListOf(el).includes('sp-card-showOnHoverChild');
  const position: KebabPosition = hover ? 'hover'
    : index === 0 ? 'left' : index === lastIndex ? 'right' : index === 1 ? 'title' : 'right';
  if (index !== 0 && index !== 1 && index !== lastIndex) return null; // not a spot placeKebab uses
  const actions: KebabActionFlags = {
    defaultClick: false, editProps: false, share: false, delete: false, executeFlow: false, setValue: false,
  };
  if (el.customRowAction?.action === 'openContextMenu') {
    return { enabled: true, behavior: 'native', position, actions };
  }
  const kebab: KebabConfig = { enabled: true, behavior: 'custom', position, actions };
  for (const b of el.customCardProps?.formatter.children ?? []) {
    const a = b.customRowAction;
    switch (a?.action) {
      case 'defaultClick': actions.defaultClick = true; break;
      case 'editProps': actions.editProps = true; break;
      case 'share': actions.share = true; break;
      case 'delete': actions.delete = true; break;
      case 'executeFlow': {
        actions.executeFlow = true;
        try { kebab.flowId = String((JSON.parse(a.actionParams ?? '{}') as { id?: string }).id ?? ''); } catch { return null; }
        break;
      }
      case 'setValue': {
        actions.setValue = true;
        const entries = Object.entries(a.actionInput ?? {});
        if (entries.length !== 1) return null;
        kebab.setValueField = entries[0][0];
        kebab.setValueVal = String(entries[0][1]);
        break;
      }
      default: return null; // an action the builder never emits
    }
  }
  return kebab;
}

function parseItemWidth(el: SPElement, flow: ZoneFlow): ItemWidth {
  if (flow === 'stack') return el.style?.['width'] === '100%' ? 'fill' : 'natural';
  const flex = String(el.style?.['flex'] ?? '');
  return flex.startsWith('1') ? 'fill' : 'natural';
}

function parseItem(el: SPElement, flow: ZoneFlow, fields: MockField[]): ZoneItem | null {
  // The _field stamp wins over _component: a look-embedded FIELD cell is a
  // baked component instance too (gridCellForField clones the look, whose
  // root carries the look's _component stamp, and adds _field), and must
  // reopen as the field item that built it. Only a deliberately placed
  // component (stamped, but no column identity) parses as a component item.
  if (el._component && !el._field) {
    return { kind: 'component', componentId: el._component.id, map: { ...el._component.map }, width: parseItemWidth(el, flow) };
  }
  // a NESTED zone: the builder names every zone "<label> zone" — recurse.
  // (A hand-made lookalike that isn't equivalent fails the rebuild-verify gate.)
  if (el.elmType === 'div' && el.style?.['display'] === 'flex'
    && typeof el._elmName === 'string' && el._elmName.endsWith(' zone')) {
    const zone = parseZone(el, 0, fields);
    return zone ? { kind: 'zone', zone } : null;
  }
  // a field cell: the single field it renders is DERIVED, exactly like the
  // grid's column↔field mapping (the _field stamp, else the one [$Field] referenced)
  let fieldName: string | undefined = el._field;
  if (!fieldName) {
    const refs = [...gridFieldRefsIn(el)];
    if (refs.length === 1) fieldName = refs[0];
  }
  if (!fieldName || !fields.some((f) => f.name === fieldName)) return null;
  return {
    kind: 'field', fieldName,
    width: parseItemWidth(el, flow),
    text: el.style?.['white-space'] === 'normal' ? 'wrap' : 'truncate',
  };
}

function parseZone(el: SPElement, index: number, fields: MockField[]): ZoneConfig | null {
  if (el.elmType !== 'div' || el.style?.['display'] !== 'flex') return null;
  const flow: ZoneFlow = el.style['flex-direction'] === 'column' ? 'stack'
    : el.style['flex-wrap'] === 'wrap' ? 'wrap' : 'side';
  const size: ZoneSize = el.style['flex'] === '0 0 auto' ? 'hug'
    : (['normal', 'wide', 'widest'] as const).find((w) => WEIGHT_FLEX[w] === el.style?.['flex']) ?? 'normal';
  const alignKey = flow === 'stack' ? el.style['align-items'] : el.style['justify-content'];
  const align: ZoneAlign = alignKey === 'center' ? 'center' : alignKey === 'flex-end' ? 'right' : 'left';
  // the vertical axis mirrors buildZone: a stack's pile position rides
  // justify-content (absent = top), a row flow's cross axis rides align-items
  const valignKey = flow === 'stack' ? el.style['justify-content'] : el.style['align-items'];
  const valign: ZoneVAlign = valignKey === 'center' ? 'middle'
    : valignKey === 'flex-end' ? 'bottom'
      : valignKey === 'baseline' ? 'baseline'
        : valignKey === 'flex-start' ? 'top'
          : flow === 'stack' ? 'top' : 'middle'; // absent/foreign → the flow default (gate verifies)
  const label = typeof el._elmName === 'string' && el._elmName.endsWith(' zone')
    ? el._elmName.slice(0, -' zone'.length)
    : `Zone ${index + 1}`;
  const items: ZoneItem[] = [];
  for (const child of el.children ?? []) {
    const item = parseItem(child, flow, fields);
    if (!item) return null;
    items.push(item);
  }
  return { label, size, flow, align, valign, items };
}

/**
 * Reopen an applied row view OR tile as the builder config that produced it,
 * or null when the tree can't be represented losslessly (→ the caller falls
 * back to the wireframe gallery and Apply keeps its overwrite confirm). Pure.
 * `target` names which canvas the tree claims to be — the rebuild-verify gate
 * makes a cross-target parse structurally impossible (a tile stack never
 * deep-equals a row rebuild and vice versa).
 */
export function configFromView(
  root: SPElement,
  additionalRowClass: string | undefined,
  fields: MockField[],
  columnLooks: Record<string, SPElement>,
  components: ComponentDef[],
  target: BuilderTarget = 'row',
): RowTemplateConfig | null {
  if (root.elmType !== 'div' || root.style?.['display'] !== 'flex') return null;
  // The builder never writes additionalRowClass anymore (SP ignores it next
  // to a rowFormatter) — ANY wrapper class is foreign now, including the
  // retired wrapper-zebra form: those reopen via the gallery + foreign note,
  // and the next Apply emits the working root-class form.
  if (additionalRowClass) return null;

  // zebra lives in the root's CLASS EXPRESSION: either bare
  // `=if(@rowIndex % 2…)` or `='<statics> ' + if(@rowIndex % 2…)`.
  // Matching is WHITESPACE-INSENSITIVE (sanitize-on-export strips spaces
  // outside quotes, and the app's own export must reopen) — quoted statics
  // keep their trailing space either way. Any OTHER class expression is
  // foreign; a plain string is all statics.
  const rawClass = root.attributes?.class;
  let zebraStriping = false;
  let staticClasses = typeof rawClass === 'string' ? rawClass : '';
  if (typeof rawClass === 'string' && rawClass.startsWith('=')) {
    const sanZebra = stripExpressionWhitespace(`=${ZEBRA_CLASS_EXPR}`);
    const san = stripExpressionWhitespace(rawClass);
    if (san === sanZebra) {
      zebraStriping = true; staticClasses = '';
    } else {
      const m = new RegExp(`^='(.*) '\\+${sanZebra.slice(1).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`).exec(san);
      if (!m) return null;
      zebraStriping = true; staticClasses = m[1];
    }
  } else if (rawClass !== undefined && typeof rawClass !== 'string') {
    return null; // AST class on the root is foreign to the builder
  }

  const classes = staticClasses.split(/\s+/).filter(Boolean);
  const rowStyle: RowStyle = classes.includes('ms-bgColor-white') && root.style['border-radius'] === '4px'
    ? 'card'
    : root.style['border-bottom-style'] === 'solid' && root.style['border-style'] === undefined
      && classes.includes('sp-css-borderColor-neutralQuaternaryAlt')
      ? 'minimalist' : 'flat';
  const borderColorClass = classes.find((c) => c.startsWith('sp-css-borderColor-'));
  const genericBorder = rowStyle === 'flat'
    && (root.style['border-style'] === 'solid' || root.style['border-style'] === 'dashed');
  const stripe = /^3px solid (.+)$/.exec(String(root.style['border-left'] ?? ''));
  const hoverClass = classes.map((c) => /^ms-bgColor-(.+)--hover$/.exec(c)).find(Boolean);

  const kids = root.children ?? [];
  // tiles never carry a kebab — a kebab-shaped child there is foreign by
  // construction (it won't parse as a zone, so the whole reopen refuses)
  const kebabIdx = target === 'tile' ? -1 : kids.findIndex(isKebabEl);
  let kebab: KebabConfig = {
    enabled: false, behavior: 'custom', position: 'right',
    actions: { defaultClick: false, editProps: false, share: false, delete: false, executeFlow: false, setValue: false },
  };
  if (kebabIdx !== -1) {
    if (kids.some((k, i) => i !== kebabIdx && isKebabEl(k))) return null; // one kebab max
    const parsed = parseKebab(kids[kebabIdx], kebabIdx, kids.length - 1);
    if (!parsed) return null;
    kebab = parsed;
  }

  const zones: ZoneConfig[] = [];
  for (let i = 0; i < kids.length; i++) {
    if (i === kebabIdx) continue;
    const zone = parseZone(kids[i], zones.length, fields);
    if (!zone) return null;
    zones.push(zone);
  }

  // the root's alignment knobs, mirroring the build emission exactly:
  // row valign ← align-items (center = the default 'middle'); row halign ←
  // justify-content (absent = 'left'); tile valign ← justify-content (absent = 'top')
  const rvi = root.style['align-items'];
  const rji = root.style['justify-content'];
  const rootVAlign: RootVAlign = target === 'tile'
    ? (rji === 'center' ? 'middle' : rji === 'flex-end' ? 'bottom' : 'top')
    : (rvi === 'flex-start' ? 'top' : rvi === 'flex-end' ? 'bottom'
      : rvi === 'baseline' ? 'baseline' : rvi === 'stretch' ? 'stretch' : 'middle');
  const rootAlign: ZoneAlign = target === 'tile' ? 'left'
    : rji === 'center' ? 'center' : rji === 'flex-end' ? 'right' : 'left';

  const config: RowTemplateConfig = {
    // the source wireframe isn't recoverable (and nothing rebuilds from it)
    wireframeId: target === 'tile' ? 'tile-blank' : 'blank',
    target,
    rowStyle,
    density: rowDensityOf(root),
    zebraStriping,
    hoverHighlight: Boolean(hoverClass),
    hoverToken: hoverClass?.[1] ?? 'themeLighter',
    borderStyle: genericBorder ? (root.style['border-style'] as BorderStyle) : 'none',
    borderColor: borderColorClass?.slice('sp-css-borderColor-'.length) ?? 'neutralQuaternaryAlt',
    leftStripe: stripe ? 'neutral' : 'none',
    rootVAlign,
    rootAlign,
    zones,
    kebab,
    // the tile box size lives on the DOCUMENT wrapper, not the tree — the
    // caller reseeds it from the doc; the parse only carries the defaults
    ...(target === 'tile' ? { tileWidth: TILE_DEFAULT_WIDTH, tileHeight: TILE_DEFAULT_HEIGHT } : {}),
  };

  // ── the losslessness gate: rebuild and require byte-equivalence ──
  // leftStripe bakes a theme color at build time; verify against the color the
  // ORIGINAL carries so a light/dark toggle between Apply and reopen still
  // round-trips (the next Apply re-bakes the current theme, which is correct).
  const verifyPalette = { themePrimary: stripe?.[1] ?? '' };
  const rebuilt = buildTemplateView(config, fields, columnLooks, verifyPalette, components);
  // whitespace-insensitive equivalence: sanitize-on-export strips spaces in
  // every =expression, and the app's own export must reopen losslessly
  if (!deepEq(normalizeExprs(rebuilt.root), normalizeExprs(root))) return null;
  return config;
}

/** Deep-copy with every '='-expression string sanitized — the equivalence the
 *  rebuild-verify gate compares under (semantics-preserving per the linter's
 *  own sanitize treatment; quoted literals keep their spaces). */
function normalizeExprs<T>(v: T): T {
  if (typeof v === 'string') {
    return (v.startsWith('=') ? stripExpressionWhitespace(v) : v) as unknown as T;
  }
  if (Array.isArray(v)) return v.map(normalizeExprs) as unknown as T;
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v)) out[k] = normalizeExprs(val);
    return out as unknown as T;
  }
  return v;
}

/** The order buildTemplateView lays out root children: each entry is a zone
 *  index or 'kebab'. Mirrors placeKebab + the buildKebab-null refusal EXACTLY,
 *  so the Edit overlay can map rendered DOM children back to zones (and skip the
 *  spliced kebab slot) without guessing. Pinned by rowTemplates.test.ts. */
export function childSlotOrder(config: RowTemplateConfig): (number | 'kebab')[] {
  const zoneSlots: (number | 'kebab')[] = config.zones.map((_, i) => i);
  const kebabEl = config.target !== 'tile' && config.kebab.enabled ? buildKebab(config.kebab) : null;
  if (!kebabEl) return zoneSlots;
  switch (config.kebab.position) {
    case 'left': return ['kebab', ...zoneSlots];
    case 'title': return zoneSlots.length ? [zoneSlots[0], 'kebab', ...zoneSlots.slice(1)] : ['kebab'];
    default: return [...zoneSlots, 'kebab']; // right + hover
  }
}
