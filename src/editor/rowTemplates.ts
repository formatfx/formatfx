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
