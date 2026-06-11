/**
 * core/schema.ts — Allow-lists and vocabulary for the SP formatting schema.
 *
 * Sources: official column/view formatting docs + field-tested quirks
 * documented in the TwFw knowledge base (.agent/rules, .agent/knowledge).
 */

import type { ElmType } from './types';

export const ELM_TYPES: ElmType[] = [
  'div', 'span', 'a', 'img', 'button', 'p', 'svg', 'path', 'filepreview',
];

/** Attributes accepted by the SP formatter renderer. */
export const ALLOWED_ATTRIBUTES = [
  'href', 'rel', 'src', 'class', 'target', 'title', 'role', 'iconName',
  'd', 'aria', 'data-interception', 'viewBox', 'preserveAspectRatio',
  'draggable', 'alt', 'id',
] as const;

/**
 * Style properties honored by the SP renderer (silently dropped otherwise).
 * Compiled from the published predefined-styles list and live probes.
 */
export const ALLOWED_STYLES = new Set<string>([
  'background-color', 'background-image', 'background-position', 'background-repeat', 'background-size',
  'fill', 'stroke', 'stroke-width', 'stroke-dasharray',
  'border', 'border-bottom', 'border-bottom-color', 'border-bottom-style', 'border-bottom-width',
  'border-color', 'border-left', 'border-left-color', 'border-left-style', 'border-left-width',
  'border-radius', 'border-bottom-left-radius', 'border-bottom-right-radius',
  'border-top-left-radius', 'border-top-right-radius',
  'border-right', 'border-right-color', 'border-right-style', 'border-right-width',
  'border-style', 'border-top', 'border-top-color', 'border-top-style', 'border-top-width', 'border-width',
  'outline', 'outline-color', 'outline-style', 'outline-width',
  'box-shadow', 'box-sizing',
  'color', 'opacity', 'visibility', 'display', 'overflow', 'overflow-x', 'overflow-y',
  'cursor', 'content', 'z-index',
  'position', 'top', 'right', 'bottom', 'left', 'float', 'clear',
  'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height',
  'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'flex', 'flex-basis', 'flex-direction', 'flex-flow', 'flex-grow', 'flex-shrink', 'flex-wrap',
  'align-items', 'justify-content', 'gap', 'row-gap', 'column-gap',
  'font', 'font-family', 'font-size', 'font-style', 'font-variant', 'font-weight',
  'line-height', 'letter-spacing', 'word-spacing', 'word-break', 'word-wrap', 'white-space',
  'text-align', 'text-decoration', 'text-indent', 'text-overflow', 'text-shadow',
  'text-transform', 'vertical-align', 'direction', 'unicode-bidi',
  'list-style', 'list-style-image', 'list-style-position', 'list-style-type',
  'table-layout', 'border-collapse', 'border-spacing', 'caption-side', 'empty-cells',
  'transform', 'object-fit', '-webkit-line-clamp', '-webkit-box-orient',
  '--inline-editor-border-width', '--inline-editor-border-style',
  '--inline-editor-border-radius', '--inline-editor-border-color',
]);

/**
 * Properties commonly assumed to work that SharePoint silently ignores.
 * (.agent/knowledge/sp-elements.md — "Unsupported CSS Properties")
 */
export const KNOWN_UNSUPPORTED_STYLES: Record<string, string> = {
  'pointer-events': 'silently ignored by the SP renderer',
  'align-self': 'not supported',
  'align-content': 'not supported',
  'justify-items': 'not supported',
  'justify-self': 'not supported',
  'order': 'not supported',
  'transition': 'not supported',
  'animation': 'not supported',
  'filter': 'not supported',
  'backdrop-filter': 'not supported',
  'aspect-ratio': 'not supported',
  'clip-path': 'not supported',
  'mask': 'not supported',
  'will-change': 'not supported',
  'grid': 'grid layout is not supported — use flex or display:table',
  'grid-template-columns': 'grid layout is not supported',
  'grid-template-rows': 'grid layout is not supported',
  'grid-area': 'grid layout is not supported',
  'grid-column': 'grid layout is not supported',
  'grid-row': 'grid layout is not supported',
};

/** Expression functions understood by the SP formatter engine. */
export const SP_FUNCTIONS = [
  'if', 'toString', 'Number', 'Date', 'cos', 'sin', 'abs', 'floor', 'ceiling', 'pow',
  'indexOf', 'lastIndexOf', 'substring', 'startsWith', 'endsWith',
  'replace', 'replaceAll', 'padStart', 'padEnd', 'toLowerCase', 'toUpperCase',
  'split', 'join', 'length', 'appendTo', 'removeFrom',
  'getDate', 'getMonth', 'getYear',
  'toLocaleString', 'toLocaleDateString', 'toLocaleTimeString',
  'addDays', 'addMinutes', 'loopIndex', 'getUserImage', 'getThumbnailImage',
] as const;

/** Special string tokens resolvable in expressions. */
export const SPECIAL_TOKENS = [
  '@currentField', '@me', '@now', '@rowIndex', '@isSelected',
  '@currentWeb', '@group', '@columnAggregate', '@lastIndexedTime',
  '@thumbnail', '@window.innerWidth', '@window.innerHeight',
] as const;

export const ROW_ACTIONS = [
  'defaultClick', 'share', 'delete', 'editProps', 'openContextMenu',
  'setValue', 'embed', 'executeFlow', '',
] as const;

export const DIRECTIONAL_HINTS = [
  'topLeftEdge', 'topCenter', 'topRightEdge', 'topAutoEdge',
  'bottomLeftEdge', 'bottomCenter', 'bottomRightEdge', 'bottomAutoEdge',
  'leftTopEdge', 'leftCenter', 'leftBottomEdge',
  'rightTopEdge', 'rightCenter', 'rightBottomEdge',
] as const;

/** Editor-only metadata keys stripped on export. */
export const META_KEYS = ['_elmName', '_factory', '_debug'] as const;

// ─── Value suggestions for the inspector (low-code friendly pickers) ─────────

export const STYLE_VALUE_SUGGESTIONS: Record<string, string[]> = {
  'display': ['flex', 'inline-flex', 'block', 'inline-block', 'none', 'table', 'table-row', 'table-cell', "=if([$Field]=='','none','flex')"],
  'flex-direction': ['row', 'column', 'row-reverse', 'column-reverse'],
  'flex-wrap': ['wrap', 'nowrap'],
  'align-items': ['center', 'flex-start', 'flex-end', 'stretch', 'baseline'],
  'justify-content': ['center', 'flex-start', 'flex-end', 'space-between', 'space-around'],
  'position': ['relative', 'absolute', 'static'],
  'font-weight': ['400', '600', '700'],
  'font-size': ['10px', '11px', '12px', '13px', '14px', '16px', '20px'],
  'text-align': ['left', 'center', 'right'],
  'text-overflow': ['ellipsis', 'clip'],
  'white-space': ['nowrap', 'normal', 'pre-wrap'],
  'overflow': ['hidden', 'auto', 'visible'],
  'cursor': ['pointer', 'default'],
  'border-style': ['solid', 'dashed', 'dotted', 'none'],
  'border-radius': ['2px', '4px', '6px', '10px', '50%'],
  'padding': ['2px 8px', '4px', '4px 10px', '8px', '12px'],
  'margin': ['0', '2px', '4px', '6px 0', '0 4px'],
  'gap': ['4px', '6px', '8px', '12px'],
  'box-shadow': ['0 1.6px 3.6px rgba(0,0,0,.13)', '0 6.4px 14.4px rgba(0,0,0,.13)'],
  'object-fit': ['cover', 'contain'],
  'visibility': ['visible', 'hidden'],
};

const COLOR_CLASS_TOKENS = [
  'themePrimary', 'themeDark', 'themeLight', 'themeLighter', 'themeLighterAlt',
  'neutralPrimary', 'neutralSecondary', 'neutralTertiary', 'neutralLight', 'neutralLighter', 'white',
  'green', 'red', 'yellow', 'orange', 'blue', 'teal', 'purple',
];

export const CLASS_SUGGESTIONS: string[] = [
  ...COLOR_CLASS_TOKENS.map((t) => `ms-bgColor-${t}`),
  ...COLOR_CLASS_TOKENS.map((t) => `ms-fontColor-${t}`),
  ...COLOR_CLASS_TOKENS.map((t) => `sp-css-borderColor-${t}`),
  'sp-field-severity--good', 'sp-field-severity--low', 'sp-field-severity--warning',
  'sp-field-severity--severeWarning', 'sp-field-severity--blocked',
  'sp-field-customFormatBackground', 'sp-field-dataBars', 'sp-field-quickActionButton',
  'sp-field-trending--up', 'sp-field-trending--down',
  'sp-card-container', 'sp-card-subContainer', 'sp-card-borderHighlight',
  'sp-card-defaultClickButton', 'sp-card-displayColumnContainer', 'sp-card-label',
  'sp-card-content', 'sp-card-highlightedContent', 'sp-card-multiline',
  'sp-card-showOnHoverParent', 'sp-card-showOnHoverChild',
];

export const ICON_SUGGESTIONS = [
  'CheckMark', 'Cancel', 'Edit', 'Delete', 'Add', 'Mail', 'Calendar', 'Clock',
  'Contact', 'People', 'PeopleAdd', 'Flag', 'Tag', 'Pin', 'Link', 'Attach',
  'Warning', 'Error', 'Info', 'Completed', 'CircleFill', 'CircleRing',
  'FavoriteStar', 'FavoriteStarFill', 'Like', 'Dislike', 'Comment', 'Chat',
  'Forward', 'Back', 'ChevronDown', 'ChevronUp', 'ChevronRight', 'More',
  'Refresh', 'Sync', 'Download', 'Upload', 'Share', 'OpenInNewWindow',
  'View', 'Hide', 'Lock', 'Unlock', 'Flow', 'Lightning', 'Rocket', 'Home',
  'Folder', 'Document', 'Photo2', 'Globe', 'MapPin', 'Phone', 'Teams',
] as const;

export const ATTRIBUTE_VALUE_SUGGESTIONS: Record<string, string[]> = {
  'class': CLASS_SUGGESTIONS,
  'iconName': [...ICON_SUGGESTIONS],
  'target': ['_blank', '_self'],
  'role': ['button', 'presentation', 'img', 'link'],
  'rel': ['noopener noreferrer'],
  'draggable': ['false', 'true'],
};
