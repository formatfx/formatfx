// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sam Yost. FormatFX is dual-licensed: AGPL-3.0-only (see LICENSE) or a commercial license (see LICENSING.md).

/**
 * core/theme.ts — Fluent UI theme token emulation.
 *
 * Generates real CSS for the class helpers SharePoint exposes to formatters:
 *   sp-css-backgroundColor-{token}, sp-css-color-{token}, sp-css-borderColor-{token}
 *   ms-bgColor-{token}, ms-fontColor-{token}, ms-borderColor-{token} (+ --hover)
 * plus a usable emulation of the sp-card-* gallery classes, so pasted
 * community formatters render meaningfully in the sandbox.
 */

export type ThemeMode = 'light' | 'dark';

const LIGHT: Record<string, string> = {
  themeDarker: '#004578', themeDark: '#005a9e', themeDarkAlt: '#106ebe',
  themePrimary: '#0078d4', themeSecondary: '#2b88d8', themeTertiary: '#71afe5',
  themeLight: '#c7e0f4', themeLighter: '#deecf9', themeLighterAlt: '#eff6fc',
  black: '#000000', neutralDark: '#201f1e', neutralPrimary: '#323130',
  neutralPrimaryAlt: '#3b3a39', neutralSecondary: '#605e5c', neutralSecondaryAlt: '#8a8886',
  neutralTertiary: '#a19f9d', neutralTertiaryAlt: '#c8c6c4',
  neutralQuaternary: '#d2d0ce', neutralQuaternaryAlt: '#e1dfdd',
  neutralLight: '#edebe9', neutralLighter: '#f3f2f1', neutralLighterAlt: '#faf9f8',
  white: '#ffffff',
  // semantic status classes SP also exposes
  green: '#107c10', greenDark: '#004b1c', greenLight: '#bad80a',
  red: '#e81123', redDark: '#a4262c', yellow: '#ffb900', yellowLight: '#fff100',
  orange: '#d83b01', orangeLight: '#ea4300', orangeLighter: '#ff8c00',
  blue: '#0078d4', blueDark: '#002050', blueMid: '#00188f', blueLight: '#00bcf2',
  purple: '#5c2d91', purpleDark: '#32145a', purpleLight: '#b4a0ff',
  teal: '#008272', tealDark: '#004b50', tealLight: '#00b294',
  magenta: '#b4009e', magentaDark: '#5c005c', magentaLight: '#e3008c',
  successBackground50: '#dff6dd', errorBackground50: '#fde7e9',
  warningBackground50: '#fff4ce', blockingBackground50: '#fed9cc',
};

const DARK: Record<string, string> = {
  ...LIGHT,
  themeDarker: '#82c7ff', themeDark: '#6cb8f6', themeDarkAlt: '#3aa0f3',
  themePrimary: '#2899f5', themeSecondary: '#0078d4', themeTertiary: '#235a85',
  themeLight: '#004c87', themeLighter: '#043862', themeLighterAlt: '#092c47',
  black: '#f8f8f8', neutralDark: '#f4f4f4', neutralPrimary: '#ffffff',
  neutralPrimaryAlt: '#dadada', neutralSecondary: '#d0d0d0', neutralSecondaryAlt: '#bdbdbd',
  neutralTertiary: '#c8c8c8', neutralTertiaryAlt: '#646464',
  neutralQuaternary: '#494949', neutralQuaternaryAlt: '#3f3f3f',
  neutralLight: '#3a3a3a', neutralLighter: '#313131', neutralLighterAlt: '#282828',
  white: '#1f1f1f',
};

export function themePalette(mode: ThemeMode): Record<string, string> {
  return mode === 'dark' ? DARK : LIGHT;
}

/**
 * Tenant palette overrides — token name → hex, e.g. captured from a real
 * SP page via JSON.stringify(window.__themeState__.theme) or exported from
 * the Fluent Theme Designer. Merged over the stock light/dark base so
 * partial palettes work.
 */
let customPalette: Record<string, string> | null = null;

export function setCustomPalette(palette: Record<string, string> | null): void {
  customPalette = palette;
}

export function getCustomPalette(): Record<string, string> | null {
  return customPalette;
}

/** Parse pasted theme JSON: accepts a flat token map, {palette:{...}}, or __themeState__.theme dumps. */
export function parseThemeJson(text: string): Record<string, string> {
  const parsed = JSON.parse(text);
  const obj = (parsed && typeof parsed === 'object' && 'palette' in parsed && typeof parsed.palette === 'object')
    ? parsed.palette
    : parsed;
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    throw new Error('Expected a JSON object of token → color.');
  }
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'string' && /^(#|rgb|hsl)/.test(v.trim())) out[k] = v.trim();
  }
  if (Object.keys(out).length < 3) {
    throw new Error('No color tokens found — expected entries like "themePrimary": "#536a8b".');
  }
  return out;
}

export function buildThemeCss(mode: ThemeMode): string {
  const pal = { ...themePalette(mode), ...(customPalette ?? {}) };
  const rules: string[] = [];
  for (const [token, hex] of Object.entries(pal)) {
    rules.push(
      `.sp-css-backgroundColor-${token},.ms-bgColor-${token}{background-color:${hex};}`,
      `.sp-css-color-${token},.ms-fontColor-${token}{color:${hex};}`,
      `.sp-css-borderColor-${token},.ms-borderColor-${token}{border-color:${hex};}`,
      `.ms-bgColor-${token}--hover:hover{background-color:${hex};}`,
      `.ms-fontColor-${token}--hover:hover{color:${hex};}`,
    );
  }
  // sp-card-* gallery class emulation (canonical three-layer card scaffold)
  const cardBg = pal.white, border = pal.neutralLight, label = pal.neutralSecondary;
  rules.push(
    `.sp-card-container{position:relative;width:254px;min-height:50px;margin:8px;border-radius:6px;outline:none;}`,
    `.sp-card-container-noPadding .sp-card-subContainer{padding:0;}`,
    `.sp-card-subContainer{position:relative;display:flex;flex-direction:column;padding:12px;border-radius:6px;background:${cardBg};height:100%;box-sizing:border-box;}`,
    `.sp-card-borderHighlight{border:1px solid ${border};}`,
    `.sp-card-borderHighlight:hover{box-shadow:0 3.2px 7.2px rgba(0,0,0,.13),0 .6px 1.8px rgba(0,0,0,.11);}`,
    `.sp-card-defaultClickButton{position:absolute;inset:0;z-index:1;cursor:pointer;background:transparent;border:none;}`,
    `.sp-card-displayColumnContainer{margin:0 0 8px 0;}`,
    `.sp-card-lastTextColumnContainer{margin:0 0 4px 0;}`,
    `.sp-card-label{margin:0 0 2px 0;font-size:11px;color:${label};}`,
    `.sp-card-content{margin:0;font-size:13px;color:${pal.neutralPrimary};overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}`,
    `.sp-card-highlightedContent{font-size:15px;font-weight:600;}`,
    `.sp-card-multiline{white-space:normal;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:3;}`,
    `.sp-card-urlContent{color:${pal.themePrimary};text-decoration:none;}`,
    `.sp-card-boldText{font-weight:600;}`,
    `.sp-card-previewColumnContainer{margin:0 0 8px 0;display:flex;}`,
    `.sp-card-imageContainer{width:100%;height:96px;overflow:hidden;border-radius:4px;}`,
    `.sp-card-imagePreviewBackground{width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:${pal.neutralLighter};}`,
    `.sp-card-imagePreview{width:100%;height:100%;object-fit:cover;}`,
    `.sp-card-userContainer{display:inline-flex;margin-right:4px;}`,
    `.sp-card-userThumbnail{width:24px;height:24px;border-radius:50%;}`,
    `.sp-card-userTitle{font-size:12px;margin-left:6px;align-self:center;color:${pal.neutralPrimary};}`,
    `.sp-card-userOthers{font-size:11px;background:${pal.neutralLighter};border-radius:12px;padding:4px 6px;color:${pal.neutralSecondary};}`,
    `.sp-card-userEmptyText{font-size:12px;color:${pal.neutralTertiary};margin:0;}`,
    `.sp-card-showOnHoverChild{visibility:hidden;}`,
    `.sp-card-showOnHoverParent:hover .sp-card-showOnHoverChild{visibility:visible;}`,
    `.sp-card-keyboard-focusable:focus{outline:2px solid ${pal.themePrimary};}`,
    // sp-row-* — the multi-line row-card family (MS docs' rowFormatter
    // example; pnp view-samples/multi-line-view). SP doesn't document the
    // pixel values; these are calibrated against that sample's screenshot
    // (pnp-compare finding 12) — refine via the live visual-compare harness.
    `.sp-row-card{background:${cardBg};border:1px solid ${border};border-radius:6px;padding:14px 16px;margin:8px 0;box-shadow:0 1.6px 3.6px rgba(0,0,0,.08);}`,
    `.sp-row-title{font-size:16px;font-weight:600;color:${pal.neutralPrimary};}`,
    `.sp-row-listPadding{padding:8px 0;color:${pal.neutralPrimary};}`,
    `.sp-row-button{display:inline-block;background:${pal.neutralLighter};color:${pal.neutralPrimary};border:1px solid ${border};border-radius:2px;padding:6px 16px;font-size:13px;font-weight:600;cursor:pointer;}`,
    `.sp-field-severity--good{background:#dff6dd;}`,
    // severity--low paints NO tint on real SP — 'false' rows in the pnp
    // yesno-checkmark screenshot and 'In progress' rows in
    // text-conditional-format are plain white (pnp-compare finding 10)
    `.sp-field-severity--low{background:transparent;}`,
    `.sp-field-severity--warning{background:#fff4ce;}`,
    `.sp-field-severity--severeWarning{background:#fed9cc;}`,
    `.sp-field-severity--blocked{background:#fde7e9;}`,
    // data bars: SP paints the LIGHT theme tint with dark text (pnp
    // number-data-bar screenshot), not a solid primary bar
    `.sp-field-dataBars{background:${pal.themeLight};color:${pal.neutralPrimary};padding:0 4px;}`,
    `.sp-field-trending--up{color:#107c10;}`,
    `.sp-field-trending--down{color:#e81123;}`,
    `.sp-field-quickActionButton{display:inline-flex;align-items:center;cursor:pointer;color:${pal.themePrimary};background:transparent;border:none;font-size:13px;}`,
    `.sp-field-customFormatBackground{padding:4px 8px;}`,
    `.sp-field-fontSizeSmall{font-size:12px;} .sp-field-fontSizeMedium{font-size:14px;}`,
    `.sp-field-fontSizeLarge{font-size:18px;} .sp-field-fontSizeXLarge{font-size:24px;}`,
    `.sp-field-borderAllRegular{border:1px solid;} .sp-field-borderAllSolid{border-style:solid;}`,
  );
  return rules.join('\n');
}

let styleEl: HTMLStyleElement | null = null;

export function applyTheme(mode: ThemeMode): void {
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = 'sp-theme-emulation';
    document.head.appendChild(styleEl);
  }
  styleEl.textContent = buildThemeCss(mode);
}
