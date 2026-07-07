// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sam Yost. FormatFX is dual-licensed: AGPL-3.0 (see LICENSE) or a commercial license (see LICENSING.md).

/**
 * editor/rowTemplates.ts — Pure brain for "pre-built row-view templates".
 * No DOM, no state imports — node-testable, like areas.ts / gridScaffold.ts.
 * COMPOSES the shipped row-view engine (areas.ts, gridScaffold.ts) and adds
 * only the new layers: skeletons, a conflict-resolving style compositor, and
 * a kebab builder. The verified SP semantics it must honor are in
 * docs/superpowers/plans/2026-06-24-rowview-templates.md "Decisions locked".
 */
import type { MockField, SPElement, CustomRowAction } from '../core/types';
import type { AreaWeight, RowDensity } from './areas';
import { setAreaWeight, setRowDensity } from './areas';
import { gridCellForField } from './gridScaffold';

export type RowTemplateId = 'split' | 'avatar' | 'equal' | 'header-detail';
export type RowStyle = 'flat' | 'card' | 'minimalist';
export type LeftStripe = 'none' | 'neutral'; // 'status' deferred to v2
export type BorderStyle = 'none' | 'solid' | 'dashed';
export type KebabPosition = 'right' | 'left' | 'title' | 'hover';
export type KebabBehavior = 'native' | 'custom';
/** Toggles composeRowStyle may grey out; the value is the reason shown in the UI. */
export type StyleToggle = 'border' | 'zebra' | 'hoverHighlight' | 'leftStripe';

export interface RowAreaConfig {
  fieldName: string;            // '' = empty drop slot
  weight: AreaWeight;
  wrapping: 'wrap' | 'truncate';
  align: 'left' | 'center' | 'right';
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
  templateId: RowTemplateId;
  rowStyle: RowStyle;
  density: RowDensity;
  zebraStriping: boolean;
  hoverHighlight: boolean;
  hoverToken: string;          // a theme token name; default 'themeLighter'
  borderStyle: BorderStyle;
  borderColor: string;         // a theme token name for sp-css-borderColor-*
  leftStripe: LeftStripe;
  areas: RowAreaConfig[];
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

// ─── skeletons + view assembly ───────────────────────────────────────────────

const EMPTY_ACTIONS: KebabActionFlags = {
  defaultClick: false, editProps: false, share: false, delete: false, executeFlow: false, setValue: false,
};

/** Skeleton → slot count + the index of the heavier "title" slot (-1 = none). */
const SKELETONS: Record<RowTemplateId, { slots: number; titleIdx: number }> = {
  split: { slots: 3, titleIdx: 0 },            // Title (wide) + 2 content
  avatar: { slots: 3, titleIdx: 1 },           // icon/avatar + Title + details
  equal: { slots: 3, titleIdx: -1 },           // equal columns
  'header-detail': { slots: 2, titleIdx: 0 },  // header + detail
};

export function defaultConfigFor(templateId: RowTemplateId, fields: MockField[]): RowTemplateConfig {
  const skel = SKELETONS[templateId];
  const usable = fields.filter((f) => !f.protected);
  const areas: RowAreaConfig[] = Array.from({ length: skel.slots }, (_, i) => ({
    fieldName: usable[i]?.name ?? '',
    weight: i === skel.titleIdx ? 'wide' : 'normal',
    wrapping: 'truncate',
    align: 'left',
  }));
  return {
    templateId, rowStyle: 'flat', density: 'roomy',
    zebraStriping: false, hoverHighlight: false, hoverToken: 'themeLighter',
    borderStyle: 'none', borderColor: 'neutralQuaternaryAlt', leftStripe: 'none',
    areas, kebab: { enabled: false, behavior: 'custom', position: 'right', actions: { ...EMPTY_ACTIONS } },
  };
}

function applyWrapAlign(cell: SPElement, wrapping: 'wrap' | 'truncate', align: 'left' | 'center' | 'right'): void {
  cell.style = cell.style ?? {};
  if (wrapping === 'truncate') {
    cell.style['overflow'] = 'hidden';
    cell.style['text-overflow'] = 'ellipsis';
    cell.style['white-space'] = 'nowrap';
  } else {
    cell.style['white-space'] = 'normal';
  }
  cell.style['text-align'] = align;
}

function placeKebab(areas: SPElement[], kebab: SPElement | null, position: KebabPosition): SPElement[] {
  if (!kebab) return areas;
  switch (position) {
    case 'left': return [kebab, ...areas];
    case 'title': return areas.length ? [areas[0], kebab, ...areas.slice(1)] : [kebab];
    default: return [...areas, kebab]; // right + hover
  }
}

function joinClass(existing: unknown, add: string): string {
  return `${typeof existing === 'string' ? existing + ' ' : ''}${add}`.trim();
}

export function buildTemplateView(
  config: RowTemplateConfig, fields: MockField[],
  columnRefs: Record<string, SPElement>, palette: Record<string, string>,
): { root: SPElement; additionalRowClass?: string } {
  const composed = composeRowStyle(config, palette);
  const areaEls = config.areas.map((a) => {
    const field = fields.find((f) => f.name === a.fieldName);
    const cell: SPElement = field
      ? gridCellForField(field, columnRefs)
      : { elmType: 'div', _elmName: 'Empty area', style: { 'flex': '1', 'min-width': '0' } };
    setAreaWeight(cell, a.weight);              // areas.ts: flex + load-bearing min-width:0
    applyWrapAlign(cell, a.wrapping, a.align);
    return cell;
  });

  const kebab = config.kebab.enabled ? buildKebab(config.kebab) : null;
  if (kebab && config.kebab.position === 'hover') {
    kebab.attributes = { ...kebab.attributes, class: joinClass(kebab.attributes?.class, 'sp-card-showOnHoverChild') };
  }
  const children = placeKebab(areaEls, kebab, config.kebab.position);

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

// ─── free-form area ops (immutable; consumed by the direct-manipulation modal) ─
// buildTemplateView already iterates config.areas generically, so arbitrary
// block counts need no engine change — only these pure array ops.

export function newArea(fieldName = ''): RowAreaConfig {
  return { fieldName, weight: 'normal', wrapping: 'truncate', align: 'left' };
}

export function addArea(config: RowTemplateConfig, fieldName = ''): RowTemplateConfig {
  return { ...config, areas: [...config.areas, newArea(fieldName)] };
}

export function removeArea(config: RowTemplateConfig, i: number): RowTemplateConfig {
  return { ...config, areas: config.areas.filter((_, idx) => idx !== i) };
}

export function moveArea(config: RowTemplateConfig, from: number, to: number): RowTemplateConfig {
  const n = config.areas.length;
  // guard NaN/float indices (e.g. a malformed drag payload): without this, NaN
  // slips past the range checks below and splice(NaN, …) silently acts as index 0.
  if (!Number.isInteger(from) || !Number.isInteger(to)) return config;
  if (from < 0 || from >= n || to < 0 || to >= n || from === to) return config;
  const areas = config.areas.slice();
  const [moved] = areas.splice(from, 1);
  areas.splice(to, 0, moved);
  return { ...config, areas };
}

export function setAreaField(config: RowTemplateConfig, i: number, fieldName: string): RowTemplateConfig {
  return patchArea(config, i, { fieldName });
}

export function patchArea(config: RowTemplateConfig, i: number, patch: Partial<RowAreaConfig>): RowTemplateConfig {
  if (i < 0 || i >= config.areas.length) return config;
  const areas = config.areas.map((a, idx) => (idx === i ? { ...a, ...patch } : a));
  return { ...config, areas };
}

const WEIGHT_CYCLE: AreaWeight[] = ['normal', 'wide', 'widest'];
/** The next weight in the Normal → Wide → Widest → Normal cycle (divider click). */
export function nextWeight(w: AreaWeight): AreaWeight {
  return WEIGHT_CYCLE[(WEIGHT_CYCLE.indexOf(w) + 1) % WEIGHT_CYCLE.length];
}

/** The order buildTemplateView lays out root children: each entry is an area
 *  index or 'kebab'. Mirrors placeKebab + the buildKebab-null refusal EXACTLY,
 *  so the Edit overlay can map rendered DOM children back to areas (and skip the
 *  spliced kebab slot) without guessing. Pinned by rowTemplates.test.ts. */
export function childSlotOrder(config: RowTemplateConfig): (number | 'kebab')[] {
  const areaSlots: (number | 'kebab')[] = config.areas.map((_, i) => i);
  const kebabEl = config.kebab.enabled ? buildKebab(config.kebab) : null;
  if (!kebabEl) return areaSlots;
  switch (config.kebab.position) {
    case 'left': return ['kebab', ...areaSlots];
    case 'title': return areaSlots.length ? [areaSlots[0], 'kebab', ...areaSlots.slice(1)] : ['kebab'];
    default: return [...areaSlots, 'kebab']; // right + hover
  }
}
