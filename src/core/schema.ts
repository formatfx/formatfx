// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sam Yost. FormatFX is dual-licensed: AGPL-3.0 (see LICENSE) or a commercial license (see LICENSING.md).

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
  'pointer-events': 'reported ignored by the SP renderer — unverified, re-test before relying on it either way',
  'align-self': 'reported not to work — unverified; the safe route is align-items on the parent',
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

/**
 * Per-function reference: signature, plain-language summary, return kind, the
 * argument-count range SharePoint accepts, and a copy-paste example. The
 * structured sibling of STYLE_PROP_DOCS/ATTRIBUTE_DOCS, and the source the
 * linter's arg-count rule (core/linter.ts) checks against. Prior art for the
 * "name + signature + hover doc" shape: thechriskent/jsonify's HorseScript
 * IntelliSense; every claim here is grounded in Microsoft's formatting-syntax
 * reference, not lifted prose.
 *
 * `minArgs`/`maxArgs` follow the documented signatures, but stay deliberately
 * permissive where an argument is genuinely optional (e.g. a pad string) so a
 * working formatter is never falsely flagged — the house rule is to teach, not
 * to cry wolf. `summary` text avoids word-internal apostrophes (the example
 * chip parser splits on them); the 'quoted' literals live in `example`.
 */
export interface SPFunctionDoc {
  /** Human-readable call form, e.g. "substring(text, start, end)". */
  signature: string;
  /** One-line, plain-language explanation. */
  summary: string;
  /** What the call evaluates to. */
  returns: 'string' | 'number' | 'boolean' | 'date' | 'array' | 'any';
  /** Fewest / most arguments SP accepts — drives the fn-arg-count lint rule. */
  minArgs: number;
  maxArgs: number;
  /** A ready-to-paste example expression. */
  example: string;
  /** True for operators Microsoft documents as SharePoint Online-only. */
  onlineOnly?: boolean;
}

// Two function names (toString, toLocaleString) collide with Object.prototype
// members, so as object-literal keys their values are contextually typed
// against the prototype method instead of the index signature — breaking the
// `returns` literal-union check. An explicit `as SPFunctionDoc` on just those
// two sidesteps it; everything else is checked normally.
export const SP_FUNCTION_DOCS: Record<string, SPFunctionDoc> = {
  if: { signature: 'if(condition, valueIfTrue, valueIfFalse)', summary: 'Choose between two values from a condition — there is no else-if keyword, so nest another if() in the false slot.', returns: 'any', minArgs: 2, maxArgs: 3, example: "=if([$Status]=='Done','#107c10','#a80000')" },
  toString: { signature: 'toString(value)', summary: 'Convert a number, date or boolean to its text form.', returns: 'string', minArgs: 1, maxArgs: 1, example: '=toString(45)' } as SPFunctionDoc,
  Number: { signature: 'Number(value)', summary: 'Parse a value into a number — non-numeric text becomes NaN.', returns: 'number', minArgs: 1, maxArgs: 1, example: "=Number('365')" },
  Date: { signature: 'Date(value)', summary: 'Turn a date string or number into a date you can compare or format.', returns: 'date', minArgs: 1, maxArgs: 1, example: "=Date('12/26/1981')" },
  cos: { signature: 'cos(radians)', summary: 'Cosine of an angle given in radians.', returns: 'number', minArgs: 1, maxArgs: 1, example: '=cos(5)' },
  sin: { signature: 'sin(radians)', summary: 'Sine of an angle given in radians — the maths behind progress-ring arcs.', returns: 'number', minArgs: 1, maxArgs: 1, example: '=sin(@currentField)' },
  abs: { signature: 'abs(number)', summary: 'Absolute, always-positive value of a number.', returns: 'number', minArgs: 1, maxArgs: 1, example: '=abs(-45)', onlineOnly: true },
  floor: { signature: 'floor(number)', summary: 'Round down to the nearest whole number.', returns: 'number', minArgs: 1, maxArgs: 1, example: '=floor(45.5)', onlineOnly: true },
  ceiling: { signature: 'ceiling(number)', summary: 'Round up to the nearest whole number.', returns: 'number', minArgs: 1, maxArgs: 1, example: '=ceiling(45.5)', onlineOnly: true },
  pow: { signature: 'pow(base, exponent)', summary: 'Raise base to the power of exponent.', returns: 'number', minArgs: 2, maxArgs: 2, example: '=pow(2,3)', onlineOnly: true },
  indexOf: { signature: 'indexOf(textOrArray, search)', summary: 'Position of the first match (0-based) or -1 if absent — case-sensitive, and the standard workaround for string length.', returns: 'number', minArgs: 2, maxArgs: 2, example: "=indexOf('DogFood','F')", onlineOnly: true },
  lastIndexOf: { signature: 'lastIndexOf(textOrArray, search)', summary: 'Position of the last match (0-based) or -1 if absent.', returns: 'number', minArgs: 2, maxArgs: 2, example: "=lastIndexOf('DogFood DogFood','Dog')" },
  substring: { signature: 'substring(text, start, end)', summary: 'The slice of text between the start and end indexes (0-based).', returns: 'string', minArgs: 2, maxArgs: 3, example: "=substring('DogFood',3,6)", onlineOnly: true },
  startsWith: { signature: 'startsWith(text, search)', summary: 'True when text begins with the search string.', returns: 'boolean', minArgs: 2, maxArgs: 2, example: "=startsWith('DogFood','Dog')" },
  endsWith: { signature: 'endsWith(text, search)', summary: 'True when text ends with the search string.', returns: 'boolean', minArgs: 2, maxArgs: 2, example: "=endsWith('DogFood','Food')" },
  replace: { signature: 'replace(textOrArray, find, replacement)', summary: 'Replace the FIRST match of find with replacement.', returns: 'string', minArgs: 3, maxArgs: 3, example: "=replace('Hello world','world','everyone')" },
  replaceAll: { signature: 'replaceAll(textOrArray, find, replacement)', summary: 'Replace EVERY match of find with replacement.', returns: 'string', minArgs: 3, maxArgs: 3, example: "=replaceAll('a-b-c','-','')" },
  padStart: { signature: 'padStart(text, length, padString)', summary: 'Pad the start of text until it reaches length.', returns: 'string', minArgs: 2, maxArgs: 3, example: "=padStart('7',3,'0')" },
  padEnd: { signature: 'padEnd(text, length, padString)', summary: 'Pad the end of text until it reaches length.', returns: 'string', minArgs: 2, maxArgs: 3, example: "=padEnd('7',3,'0')" },
  toLowerCase: { signature: 'toLowerCase(text)', summary: 'Lower-case a string.', returns: 'string', minArgs: 1, maxArgs: 1, example: "=toLowerCase('DogFood')", onlineOnly: true },
  toUpperCase: { signature: 'toUpperCase(text)', summary: 'Upper-case a string.', returns: 'string', minArgs: 1, maxArgs: 1, example: "=toUpperCase('DogFood')", onlineOnly: true },
  split: { signature: 'split(text, separator)', summary: 'Break text into an array on each separator.', returns: 'array', minArgs: 2, maxArgs: 2, example: "=split('Hello World',' ')" },
  join: { signature: 'join(array, separator)', summary: 'Join a multi-value field into one string, separated by separator.', returns: 'string', minArgs: 2, maxArgs: 2, example: "=join(@currentField,', ')", onlineOnly: true },
  length: { signature: 'length(arrayOrValue)', summary: 'Count of items in a multi-value field — NOT string length (use indexOf for that).', returns: 'number', minArgs: 1, maxArgs: 1, example: '=length(@currentField)', onlineOnly: true },
  appendTo: { signature: 'appendTo(array, value)', summary: 'A copy of the array with value added to the end.', returns: 'array', minArgs: 2, maxArgs: 2, example: "=appendTo(@currentField,'Choice 4')" },
  removeFrom: { signature: 'removeFrom(array, value)', summary: 'A copy of the array with value removed if present.', returns: 'array', minArgs: 2, maxArgs: 2, example: "=removeFrom(@currentField,'Choice 4')" },
  getDate: { signature: 'getDate(date)', summary: 'Day of the month (1-31) of a date.', returns: 'number', minArgs: 1, maxArgs: 1, example: "=getDate(Date('12/26/1981'))", onlineOnly: true },
  getMonth: { signature: 'getMonth(date)', summary: 'Month of a date as a zero-based number (January is 0).', returns: 'number', minArgs: 1, maxArgs: 1, example: "=getMonth(Date('12/26/1981'))", onlineOnly: true },
  getYear: { signature: 'getYear(date)', summary: 'Four-digit year of a date.', returns: 'number', minArgs: 1, maxArgs: 1, example: "=getYear(Date('12/26/1981'))", onlineOnly: true },
  toLocaleString: { signature: 'toLocaleString(date)', summary: 'Date plus time, formatted for the viewer locale — an empty date renders as empty text.', returns: 'string', minArgs: 1, maxArgs: 1, example: '=toLocaleString(@now)' } as SPFunctionDoc,
  toLocaleDateString: { signature: 'toLocaleDateString(date)', summary: 'Just the date, formatted for the viewer locale.', returns: 'string', minArgs: 1, maxArgs: 1, example: '=toLocaleDateString(@now)' },
  toLocaleTimeString: { signature: 'toLocaleTimeString(date)', summary: 'Just the time, formatted for the viewer locale.', returns: 'string', minArgs: 1, maxArgs: 1, example: '=toLocaleTimeString(@now)' },
  addDays: { signature: 'addDays(date, days)', summary: 'A new date with days added — use a negative number to subtract.', returns: 'date', minArgs: 2, maxArgs: 2, example: '=addDays(@now,3)' },
  addMinutes: { signature: 'addMinutes(date, minutes)', summary: 'A new date with minutes added — a negative number subtracts.', returns: 'date', minArgs: 2, maxArgs: 2, example: '=addMinutes(@now,-30)' },
  loopIndex: { signature: 'loopIndex(iteratorName)', summary: 'The 0-based index of the current forEach item — pass the iterator name as a quoted string.', returns: 'number', minArgs: 1, maxArgs: 1, example: "=loopIndex('_tag')" },
  getUserImage: { signature: 'getUserImage(email, size)', summary: 'URL of a user profile photo at size s, m or l.', returns: 'string', minArgs: 2, maxArgs: 2, example: "=getUserImage([$Owner.email],'s')" },
  getThumbnailImage: { signature: 'getThumbnailImage(imageField, width, height)', summary: 'URL of a thumbnail for an Image-column value at the given size.', returns: 'string', minArgs: 1, maxArgs: 3, example: '=getThumbnailImage([$Photo],400,300)' },
};

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
export const META_KEYS = ['_elmName', '_factory', '_debug', '_component'] as const;

// ─── Value suggestions for the inspector (low-code friendly pickers) ─────────

/**
 * Plain-language explanations + syntax examples for the style allow-list.
 * Surfaced as ⓘ tooltips and datalist labels in the inspector's Style
 * editor — written for people who know what they want but not the CSS for it.
 */
export const STYLE_PROP_DOCS: Record<string, string> = {
  'background-color': "Fill color behind the element — '#e1f5e1', 'transparent'. Conditional: =if([$Status]=='Done','#107c10','#a80000')",
  'background-image': "Gradient or picture — 'linear-gradient(to right, #0078d4, #5c2d91)' or 'url(https://…)'",
  'background-position': "Where the background image sits — 'center', 'top right', '10px 20px'",
  'background-repeat': "'no-repeat' (once), 'repeat-x' (tile sideways), 'repeat'",
  'background-size': "'cover' (fill the box, crop), 'contain' (fit inside), or '40px 40px'",
  'fill': "SVG shape fill color — '#0078d4'",
  'stroke': "SVG line/outline color — '#605e5c'",
  'stroke-width': "SVG line thickness — '2'",
  'stroke-dasharray': "SVG dash pattern — «drawn skipped»: '4 2' = 4 on, 2 off. Progress donuts drive the first number with an =expression",
  'border': "All four borders at once — «width style color»: '1px solid #e1dfdd'",
  'border-color': "Color of all four borders — '#e1dfdd'",
  'border-style': "'solid', 'dashed', 'dotted', 'none' — all four sides",
  'border-width': "Thickness of all four borders — '1px'",
  'border-radius': "Rounded corners — '4px'; pill = half the height ('12px'); circle = '50%'",
  'outline': "Like border but drawn OUTSIDE the box, takes no space — «width style color»: '2px dashed #0078d4'",
  'outline-color': "Outline color", 'outline-style': "'solid', 'dashed', 'dotted'", 'outline-width': "Outline thickness — '2px'",
  'box-shadow': "Shadow under the box — «x y blur color»: '0 2px 4px rgba(0,0,0,.2)'. Card feel: '0 1.6px 3.6px rgba(0,0,0,.1)'",
  'box-sizing': "'border-box' = width/height INCLUDE padding+border (almost always what you want)",
  'color': "Text color — '#323130', 'white', or conditional =if(…)",
  'opacity': "0 (invisible) → 1 (solid) — '0.6' = 60% visible; dims the whole element incl. children",
  'visibility': "'hidden' keeps the gap but does not paint — use display 'none' to remove entirely",
  'display': "'flex' (arrange children), 'inline-block', 'block', 'none' (gone). Conditional hide: =if([$Done],'none','flex')",
  'overflow': "What happens when content overflows the box — 'hidden' clips, 'auto' scrolls",
  'overflow-x': "Horizontal overflow only — 'hidden', 'auto'",
  'overflow-y': "Vertical overflow only — 'hidden', 'auto'",
  'cursor': "'pointer' = hand cursor on hover — pair with customRowAction so it reads as clickable",
  'content': "Generated content for pseudo-elements — rarely useful in SP formatting",
  'z-index': "Stacking order — higher sits on top: '1', '10'. Only works with position set",
  'position': "'relative' = nudge from normal spot (and anchor children); 'absolute' = pin by top/left inside nearest relative parent",
  'top': "Offset when position is set — '4px', '-2px'", 'right': "Offset when position is set — '4px'",
  'bottom': "Offset when position is set — '4px'", 'left': "Offset when position is set — '-8px' (overlap trick for facepiles)",
  'float': "Old-school wrap layout — prefer display 'flex'", 'clear': "Stops floating — prefer flex",
  'width': "'24px', '100%', 'auto'. Data-bar trick: =(@currentField*100/120)+'%'",
  'height': "'24px', '100%'. Avatars: equal width+height + border-radius '50%'",
  'min-width': "Never narrower than this — '24px' keeps tiny data bars readable",
  'min-height': "Never shorter than this — '32px'",
  'max-width': "Never wider than this — '200px' (pair with ellipsis)",
  'max-height': "Never taller than this — '60px'",
  'margin': "Space OUTSIDE the border — '4px' all · '2px 8px' vert/horiz · «top right bottom left»: '0 8px 0 0'. Always give units",
  'padding': "Space INSIDE, around content — '2px 10px' is the classic pill padding · «top right bottom left»: '0 8px 4px 8px'. Always give units",
  'flex': "How much space this CHILD claims — «grow shrink basis»: '1' = fill an equal share, '0 0 auto' = natural size, '2' = double share",
  'flex-basis': "The starting size of this child, before grow/shrink — '120px', 'auto'",
  'flex-direction': "'row' = children side by side, 'column' = stacked (the Alignment section sets this visually)",
  'flex-flow': "Shorthand for flex-direction + flex-wrap in one — 'row wrap', 'column nowrap'",
  'flex-grow': "How eagerly this child takes leftover space — '1' grows, '0' stays put",
  'flex-shrink': "May this child squish below its natural size? '0' = never (keeps icons round)",
  'flex-wrap': "'wrap' lets children flow onto new lines — pills, tags, chips",
  'align-items': "Cross-axis alignment of children — 'center', 'flex-start', 'stretch' (Alignment section does this visually)",
  'justify-content': "Main-axis packing — 'center', 'space-between', 'flex-end' (Alignment section does this visually)",
  'gap': "Space between flex children — '8px'. Supported by modern SP",
  'row-gap': "Vertical space between wrapped lines — '4px'",
  'column-gap': "Horizontal space between children — '8px'",
  'font': "Shorthand for all font props — prefer the individual font-* properties",
  'font-family': "Typeface — '\"Segoe UI\", sans-serif', 'monospace' for IDs/code",
  'font-size': "Text size — '13px' (SP body text is 13–14px), '12px' for captions",
  'font-style': "'italic' or 'normal'",
  'font-variant': "'small-caps'",
  'font-weight': "'600' = semibold (the SP emphasis weight), 'bold', 'normal'",
  'line-height': "Vertical rhythm of text — '20px' or unitless '1.4'",
  'letter-spacing': "Space between letters — '0.5px' makes UPPERCASE labels breathe",
  'word-spacing': "Space between words — '2px'",
  'word-break': "'break-all' force-wraps long IDs/URLs that have no spaces",
  'word-wrap': "'break-word' wraps a too-long word instead of overflowing",
  'white-space': "'nowrap' = one line (pair with ellipsis); 'pre-wrap' keeps the line breaks typed in the field",
  'text-align': "Horizontal alignment of text — 'center', 'right' (numbers)",
  'text-decoration': "'none' removes link underlines; 'line-through' strikes out done items",
  'text-indent': "First-line indent — '12px'",
  'text-overflow': "'ellipsis' shows … when clipped — needs overflow 'hidden' + white-space 'nowrap' too",
  'text-shadow': "Shadow behind the letters — «x y blur color»: '0 1px 2px rgba(0,0,0,.4)' lifts text off photos",
  'text-transform': "'uppercase', 'capitalize', 'lowercase'",
  'vertical-align': "Aligns inline elements to the text line — 'middle', 'text-bottom'",
  'direction': "'rtl' for right-to-left languages",
  'unicode-bidi': "Bidirectional text control — pairs with direction",
  'list-style': "Bullet style shorthand — 'none' removes bullets",
  'list-style-image': "Custom bullet image — 'url(…)'",
  'list-style-position': "'inside' or 'outside' the text block",
  'list-style-type': "'disc', 'decimal', 'none'",
  'table-layout': "'fixed' = columns honor your widths instead of content",
  'border-collapse': "'collapse' merges adjacent table cell borders into one",
  'border-spacing': "Gap between table cells — '0'",
  'caption-side': "'top' or 'bottom' for table captions",
  'empty-cells': "'hide' borders of empty table cells",
  'transform': "'rotate(45deg)', 'scale(1.2)', 'translateX(4px)' — chevrons, badges, micro-nudges",
  'object-fit': "How an <img> fills its box — 'cover' crops to fill, 'contain' letterboxes",
  '-webkit-line-clamp': "Max text lines, then … — '2'. Needs display '-webkit-box' + -webkit-box-orient 'vertical' + overflow 'hidden'",
  '-webkit-box-orient': "'vertical' — required partner of -webkit-line-clamp",
  '--inline-editor-border-width': "Styles the inline-edit affordance (inlineEditField) — '1px'",
  '--inline-editor-border-style': "Inline-edit border style — 'solid'",
  '--inline-editor-border-radius': "Inline-edit corner rounding — '4px'",
  '--inline-editor-border-color': "Inline-edit border color — '#0078d4'",
};
// the per-side / per-corner families, generated to stay in sync
for (const side of ['top', 'right', 'bottom', 'left']) {
  STYLE_PROP_DOCS[`border-${side}`] = `Border on the ${side} side only — «width style color»: '1px solid #e1dfdd'. Left accent stripe: '3px solid #0078d4'`;
  STYLE_PROP_DOCS[`border-${side}-color`] = `Color of the ${side} border`;
  STYLE_PROP_DOCS[`border-${side}-style`] = `'solid', 'dashed', 'dotted' — ${side} side`;
  STYLE_PROP_DOCS[`border-${side}-width`] = `Thickness of the ${side} border — '1px'`;
  STYLE_PROP_DOCS[`margin-${side}`] = `Space outside, ${side} side only — '8px' (the box-model diagram above edits this too)`;
  STYLE_PROP_DOCS[`padding-${side}`] = `Space inside, ${side} side only — '8px' (the box-model diagram above edits this too)`;
}
for (const corner of ['top-left', 'top-right', 'bottom-left', 'bottom-right']) {
  STYLE_PROP_DOCS[`border-${corner}-radius`] = `Round only the ${corner.replace('-', ' ')} corner — '4px'`;
}

/** Same idea for the attribute allow-list. */
export const ATTRIBUTE_DOCS: Record<string, string> = {
  'class': "SP/Fluent utility classes — theme-aware colors ('ms-bgColor-themePrimary', 'sp-field-severity--good') beat hex codes in dark mode",
  'iconName': "Fluent UI icon to render in this element — 'CheckMark', 'Warning', 'Flag' (value suggestions below)",
  'href': "Link target — 'https://…' or build one: ='mailto:'+[$Owner.email]",
  'target': "'_blank' opens the link in a new tab",
  'rel': "'noreferrer noopener' — pair with target _blank",
  'src': "Image URL — avatars: =getUserImage([$Owner.email],'S')",
  'alt': "Image description for screen readers",
  'title': "Tooltip on hover — also what screen readers announce; always set one on icons",
  'role': "Accessibility role — 'img', 'button', 'presentation'",
  'aria': "Aria attribute bundle for accessibility",
  'd': "SVG path data — the shape itself: 'M 0 0 L 10 10 …'",
  'viewBox': "SVG coordinate system — '0 0 20 20'",
  'preserveAspectRatio': "How the SVG scales in its box — 'xMidYMid meet'",
  'data-interception': "'off' makes SP open the href without its link interception",
  'draggable': "'false' stops image ghost-dragging",
  'id': "Element id — rarely needed; prefer classes",
};

/**
 * Concept families for the style allow-list — the mental-model layer of the
 * inspector's doc cards. `plain` is written for someone who can't spell CSS;
 * the per-property one-liners in STYLE_PROP_DOCS stay the specific layer.
 */
export type StyleFamily =
  | 'box' | 'flex-container' | 'flex-child' | 'type' | 'paint'
  | 'place' | 'fit' | 'table' | 'svg' | 'misc';

const FLEX_GLOSSARY: Array<[string, string]> = [
  ['display', "'flex' switches the shelf on — children start lining up"],
  ['flex-direction', 'which way the shelf runs — row (→) or column (↓)'],
  ['flex-wrap', 'may children flow onto a new line when they run out of room?'],
  ['flex-flow', 'direction + wrap written as one'],
  ['justify-content', 'slide children ALONG the shelf — start, center, spread'],
  ['align-items', 'line children up ACROSS the shelf — top, middle, stretch'],
  ['gap', 'empty space between children'],
  ['flex', "on a CHILD: its share of the space — '1' = equal share"],
  ['flex-grow', 'on a CHILD: how eagerly it takes leftover room'],
  ['flex-shrink', 'on a CHILD: is it willing to squish?'],
  ['flex-basis', 'on a CHILD: its starting size'],
];

export const STYLE_FAMILY_EXPLAINS: Record<StyleFamily, { name: string; plain: string; glossary?: Array<[string, string]> }> = {
  box: {
    name: 'The box',
    plain: 'A box in a box: content in the middle, padding is the air INSIDE the walls, the border IS the wall, margin pushes neighbors away OUTSIDE.',
  },
  'flex-container': {
    name: 'Arranging children',
    glossary: FLEX_GLOSSARY,
    plain: "display 'flex' turns a parent into a shelf: direction picks which way it runs, justify slides children ALONG it, align lines them up ACROSS it, gap spaces them.",
  },
  'flex-child': {
    name: "A child's appetite",
    glossary: FLEX_GLOSSARY,
    plain: "On a CHILD inside a flex parent: grow = take leftover room, shrink = willing to squish, basis = starting size. 'flex: 1' = equal shares.",
  },
  type: {
    name: 'Text & type',
    plain: 'size = letter height, weight = stroke thickness, line-height = how tall each LINE stands, letter-spacing = air between letters; text-* dresses the words.',
  },
  paint: {
    name: 'Paint & ink',
    plain: 'Layers: color inks the TEXT, background paints the box BEHIND it, box-shadow falls on the page below, opacity fades the whole stack.',
  },
  place: {
    name: 'Breaking out',
    plain: "position 'relative' nudges a box (and anchors its children); 'absolute' pins it to that anchor — aim with top/left. z-index settles overlaps; transform moves the painted result without disturbing neighbors.",
  },
  fit: {
    name: "When it doesn't fit",
    plain: "Too big for its box? overflow 'hidden' clips, 'auto' scrolls; nowrap + ellipsis politely ends text with …; line-clamp caps the lines.",
  },
  table: {
    name: 'Tables & lists',
    plain: "Real-table fine print: collapse merges cell walls, table-layout 'fixed' makes columns obey your widths, list-style does the bullets.",
  },
  svg: {
    name: 'SVG drawing',
    plain: 'fill paints INSIDE the shape, stroke is the pen line around its edge, dasharray makes that line dashed — exactly how progress rings work.',
  },
  misc: {
    name: 'Special purpose',
    plain: 'Specialist switches — the examples show the typical trick.',
  },
};

/** Longhand groups: the same doc card serves the whole group. */
export const STYLE_GROUPS: string[][] = [
  ['padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left'],
  ['margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left'],
  ['border', 'border-width', 'border-style', 'border-color', 'border-top', 'border-right', 'border-bottom', 'border-left'],
  ['border-radius', 'border-top-left-radius', 'border-top-right-radius', 'border-bottom-left-radius', 'border-bottom-right-radius'],
  ['outline', 'outline-width', 'outline-style', 'outline-color'],
  ['overflow', 'overflow-x', 'overflow-y'],
  ['gap', 'row-gap', 'column-gap'],
  ['background-color', 'background-image', 'background-position', 'background-repeat', 'background-size'],
];

export function styleGroupOf(prop: string): string[] | null {
  // per-side border longhands (border-top-color …) fold into the border group
  const m = prop.match(/^border-(top|right|bottom|left)-(color|style|width)$/);
  if (m) return STYLE_GROUPS[2];
  return STYLE_GROUPS.find((g) => g.includes(prop)) ?? null;
}

const PLACE_SIDES = new Set(['top', 'right', 'bottom', 'left']);

/** Which concept family a style property belongs to (drives the doc card). */
export function styleFamilyOf(prop: string): StyleFamily {
  if (PLACE_SIDES.has(prop) || ['position', 'z-index', 'float', 'clear', 'transform'].includes(prop)) return 'place';
  if (['border-collapse', 'border-spacing', 'table-layout', 'caption-side', 'empty-cells'].includes(prop) || prop.startsWith('list-style')) return 'table';
  if (prop === 'fill' || prop.startsWith('stroke')) return 'svg';
  if (['flex', 'flex-grow', 'flex-shrink', 'flex-basis'].includes(prop)) return 'flex-child';
  if (['display', 'flex-direction', 'flex-flow', 'flex-wrap', 'align-items', 'justify-content', 'gap', 'row-gap', 'column-gap'].includes(prop)) return 'flex-container';
  if (prop.startsWith('overflow') || prop === 'object-fit' || prop === 'visibility'
    || ['text-overflow', 'white-space', 'word-break', 'word-wrap', '-webkit-line-clamp', '-webkit-box-orient'].includes(prop)) return 'fit';
  if (prop.startsWith('font') || prop.startsWith('text-') || ['line-height', 'letter-spacing', 'word-spacing', 'vertical-align', 'direction', 'unicode-bidi'].includes(prop)) return 'type';
  if (prop === 'color' || prop.startsWith('background') || prop === 'opacity' || prop === 'box-shadow') return 'paint';
  if (prop.startsWith('margin') || prop.startsWith('padding') || prop.startsWith('border') || prop.startsWith('outline')
    || prop === 'box-sizing' || /^(min-|max-)?(width|height)$/.test(prop)) return 'box';
  return 'misc';
}

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
  'opacity': ['1', '0.85', '0.6', '0.4', '0.2'],
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
