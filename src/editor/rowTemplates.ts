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
