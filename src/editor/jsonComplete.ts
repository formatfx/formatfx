// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sam Yost. FormatFX is dual-licensed: AGPL-3.0-only (see LICENSE) or a commercial license (see LICENSING.md).

/**
 * editor/jsonComplete.ts — the super-contextual completion brain for the raw
 * JSON pane (#244). Pure and DOM-free; jsonComplete.test.ts is its contract.
 *
 * The problem it solves: mid-edit JSON is NOT valid JSON, so core/jsonMap's
 * offset↔path map (built from the last good serialize) goes stale the moment
 * a hand-edit starts — exactly when completions matter. So this module scans
 * the raw text up to the caret with a TOLERANT state machine (strings with
 * escapes, an object/array frame stack, key/value position tracking) and
 * classifies where the caret sits:
 *
 *   "elmType": "<caret>          → the 9 legal element types
 *   element object, key position → elmType/txtContent/style/… (with docs,
 *                                  minus the keys the object already has)
 *   "style": { "<caret>          → the style allow-list, STYLE_PROP_DOCS docs
 *   "attributes": { "<caret>     → the attribute allow-list + docs
 *   "class": "… <caret>          → Fluent/SP class catalog (per space-token)
 *   "txtContent": "=<caret>      → the SP expression layer: @tokens, [$refs
 *                                  (live mock previews) and the engine's own
 *                                  function catalog with signatures
 *
 * Everything offered is grounded in src/core allow-lists (schema.ts) or the
 * fx bar's engine-grounded item sources (fxSuggest.ts) — nothing invented, no
 * standalone `!` anywhere (there is no logical NOT — HANDOFF §3.1). Where a
 * value is genuinely free-form the menu stays SHUT: refuse-and-teach beats
 * guess-and-annoy.
 */

import type { MockField } from '../core/types';
import {
  ELM_TYPES, ALLOWED_ATTRIBUTES, ALLOWED_STYLES, ATTRIBUTE_DOCS,
  ATTRIBUTE_VALUE_SUGGESTIONS, STYLE_PROP_DOCS, STYLE_VALUE_SUGGESTIONS,
  SP_FUNCTION_DOCS, ROW_ACTIONS, DIRECTIONAL_HINTS, CLASS_SUGGESTIONS,
  type SPFunctionDoc,
} from '../core/schema';
import { SCHEMA_URLS } from '../core/types';
import { COMMAND_BUTTONS } from '../core/commandBar';
import {
  systemTokenItems, columnRefItems,
  type SuggestItem, type CompletionOpts, type SuggestValueType,
} from './fxSuggest';
import { scanString } from './jsonHighlight';

/** A SuggestItem that can also say where the caret lands inside its insert
 *  (index into `insert`; absent = after it). Scaffold keys use it to drop the
 *  caret between their `""` / `{}` / `[]` so the chained menu keeps flowing. */
export interface JsonSuggestItem extends SuggestItem {
  caretOffset?: number;
}

export interface JsonCompletion {
  items: JsonSuggestItem[];
  /** [from, to) text range an accepted pick replaces. */
  from: number;
  to: number;
  /** True when the caret sits on BARE structure (not inside a string) — the
   *  shell only auto-opens in-string menus; bare ones wait for Ctrl+Space so
   *  plain typing (newlines, commas) never fights a surprise popup. */
  bare: boolean;
}

// ─── the tolerant structural scan ────────────────────────────────────────────

interface ObjFrame {
  kind: 'obj';
  /** The key this object hangs under (null: root, or an array item). */
  key: string | null;
  /** Keys whose values are already complete, in source order. */
  keys: string[];
  /** The key whose value is being read right now (expectValue phase). */
  lastKey: string | null;
  /** A key string has closed but its `:` hasn't arrived yet. */
  pendingKey: string | null;
  expectValue: boolean;
}
interface ArrFrame {
  kind: 'arr';
  key: string | null;
  index: number;
}
type Frame = ObjFrame | ArrFrame;

interface ScanResult {
  frames: Frame[];
  /** Opening-quote offset when the caret is inside a string, else -1. */
  strStart: number;
  /** The open string is in key position (top frame expects a key). */
  strIsKey: boolean;
}

/** Unescape the trivial JSON escapes for filtering (`\"` `\\`); anything
 *  fancier passes through raw — good enough for a match partial. */
function rawPartial(text: string, from: number, to: number): string {
  return text.slice(from, to).replace(/\\(["\\/])/g, '$1');
}

/** Scan text[0, caret) maintaining the frame stack. Never throws. */
function scanTo(text: string, caret: number): ScanResult {
  const frames: Frame[] = [];
  const top = (): Frame | undefined => frames[frames.length - 1];

  /** A value just finished on the current top frame. */
  const completeValue = (): void => {
    const t = top();
    if (!t) return;
    if (t.kind === 'obj') {
      if (t.lastKey !== null) t.keys.push(t.lastKey);
      t.expectValue = false;
      t.lastKey = null;
    } else {
      t.index++;
    }
  };

  let i = 0;
  while (i < caret) {
    const c = text[i];
    if (c === '"') {
      const { end, closed } = scanString(text, i);
      if (!closed && caret <= end) {
        // the caret sits inside this (still-open) string
        const t = top();
        return { frames, strStart: i, strIsKey: t?.kind === 'obj' && !t.expectValue };
      }
      if (closed && caret < end) {
        // caret inside a terminated string (editing an existing key/value)
        const t = top();
        return { frames, strStart: i, strIsKey: t?.kind === 'obj' && !t.expectValue };
      }
      const t = top();
      if (t?.kind === 'obj' && !t.expectValue) {
        t.pendingKey = rawPartial(text, i + 1, Math.max(i + 1, end - (closed ? 1 : 0)));
      } else {
        completeValue();
      }
      i = end;
      continue;
    }
    if (c === ':') {
      const t = top();
      if (t?.kind === 'obj' && t.pendingKey !== null) {
        t.lastKey = t.pendingKey;
        t.pendingKey = null;
        t.expectValue = true;
      }
      i++;
      continue;
    }
    if (c === '{' || c === '[') {
      const t = top();
      const key = t?.kind === 'obj' && t.expectValue ? t.lastKey : null;
      // entering the child: the parent's member completes when the child closes
      frames.push(c === '{'
        ? { kind: 'obj', key, keys: [], lastKey: null, pendingKey: null, expectValue: false }
        : { kind: 'arr', key, index: 0 });
      i++;
      continue;
    }
    if (c === '}' || c === ']') {
      frames.pop();
      completeValue();
      i++;
      continue;
    }
    if (c === ',') {
      i++;
      continue;
    }
    if (/[0-9]/.test(c) || c === '-' || /[A-Za-z_$]/.test(c)) {
      // a number / true / false / null literal — consume and complete
      i++;
      while (i < caret && /[0-9A-Za-z_$.eE+-]/.test(text[i])) i++;
      if (i >= caret && i < text.length && /[0-9A-Za-z_$.eE+-]/.test(text[i])) {
        // the caret is INSIDE this literal — don't complete it yet
        return { frames, strStart: -1, strIsKey: false };
      }
      completeValue();
      continue;
    }
    i++;
  }
  return { frames, strStart: -1, strIsKey: false };
}

/** Keys present in the innermost object AFTER the caret (forward scan to its
 *  closing brace, depth-aware, strings skipped properly) — so "already used"
 *  filtering sees the whole object, not just the half before the caret.
 *  `from` must sit on structure, never inside a string (the caller passes the
 *  end of the caret's string when there is one, or the lexer desyncs). */
function keysAfterCaret(text: string, from: number): string[] {
  const keys: string[] = [];
  let depth = 0;
  let i = from;
  while (i < text.length) {
    const c = text[i];
    if (c === '"') {
      const { end, closed } = scanString(text, i);
      if (depth === 0 && closed) {
        let j = end;
        while (j < text.length && (text[j] === ' ' || text[j] === '\t')) j++;
        if (text[j] === ':') keys.push(rawPartial(text, i + 1, end - 1));
      }
      i = end;
      continue;
    }
    if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') {
      if (depth === 0) break;
      depth--;
    }
    i++;
  }
  return keys;
}

// ─── context classification ──────────────────────────────────────────────────

type JsonCtx =
  | 'element'      // an SPElement object
  | 'root'         // the top-level object: wrapper AND/OR element (column docs spread)
  | 'style'        // style / beakStyle maps
  | 'attributes'
  | 'rowAction'    // customRowAction
  | 'cardProps'    // customCardProps
  | 'commandBar'   // commandBarProps
  | 'command'      // one commandBarProps.commands[] entry
  | 'unknown';

/** The key an object frame hangs under, looking through array frames (an
 *  array item's context is the array's key: children[2] hangs under "children"). */
function hangKey(frames: Frame[], at: number): { key: string | null; viaArray: boolean } {
  const f = frames[at];
  if (f.key !== null) return { key: f.key, viaArray: false };
  const parent = frames[at - 1];
  if (parent?.kind === 'arr') return { key: parent.key, viaArray: true };
  return { key: null, viaArray: false };
}

function classify(frames: Frame[]): JsonCtx {
  const at = frames.length - 1;
  if (at < 0) return 'unknown';
  const f = frames[at];
  if (f.kind === 'arr') return 'unknown';
  if (at === 0) return 'root';
  const { key, viaArray } = hangKey(frames, at);
  if (key === 'style' || key === 'beakStyle') return 'style';
  if (key === 'attributes') return 'attributes';
  if (key === 'customRowAction') return 'rowAction';
  if (key === 'customCardProps') return 'cardProps';
  if (key === 'commandBarProps') return 'commandBar';
  if (viaArray && key === 'commands') return 'command';
  if (viaArray && key === 'children') return 'element';
  if (key === 'rowFormatter' || key === 'footerFormatter' || key === 'formatter') return 'element';
  return 'unknown';
}

// ─── the key catalogs (docs + value scaffolds) ───────────────────────────────

type ValueShape = 'string' | 'formula' | 'object' | 'array' | 'boolean' | 'number';

interface KeyDef {
  key: string;
  shape: ValueShape;
  type?: SuggestValueType;
  doc: string;
}

const ELEMENT_KEYS: KeyDef[] = [
  { key: 'elmType', shape: 'string', type: 'string', doc: 'What to render — div, span, a, img, button, p, svg, path, filepreview' },
  { key: 'txtContent', shape: 'formula', type: 'string', doc: 'The text inside the element — a literal or an =expression' },
  { key: 'style', shape: 'object', type: 'object', doc: 'CSS the SP renderer honors (allow-listed; anything else is silently dropped)' },
  { key: 'attributes', shape: 'object', type: 'object', doc: 'class / iconName / href / src / title … (allow-listed)' },
  { key: 'children', shape: 'array', type: 'array', doc: 'Child elements, rendered in order' },
  { key: 'forEach', shape: 'string', type: 'string', doc: 'Repeat this element per value of a multi-value field: "item in [$Field]"' },
  { key: 'customRowAction', shape: 'object', type: 'object', doc: 'Make it clickable — defaultClick, setValue, executeFlow, share, delete…' },
  { key: 'customCardProps', shape: 'object', type: 'object', doc: 'A hover/click callout card with its own formatter inside' },
  { key: 'inlineEditField', shape: 'string', type: 'string', doc: 'Let the value be edited inline — "[$FieldName]"' },
  { key: 'defaultHoverField', shape: 'string', type: 'string', doc: 'Show the default hover card of this field — "[$Editor]"' },
  { key: 'debugMode', shape: 'boolean', type: 'boolean', doc: 'true = SP logs errors for this element to the console' },
  { key: '_elmName', shape: 'string', type: 'string', doc: 'Editor-only element name (the Structure pane label) — SharePoint ignores it' },
];

const ROW_WRAPPER_KEYS: KeyDef[] = [
  { key: '$schema', shape: 'string', type: 'string', doc: 'Schema URL — unlocks IntelliSense in other editors and pins the format kind' },
  { key: 'rowFormatter', shape: 'object', type: 'object', doc: 'The element tree painting each row (view wrapper)' },
  { key: 'additionalRowClass', shape: 'formula', type: 'string', doc: 'Class(es) for the whole row — zebra stripes, conditional row tints (view wrapper)' },
  { key: 'hideSelection', shape: 'boolean', type: 'boolean', doc: 'Hide the row selection checkboxes (view wrapper)' },
  { key: 'hideColumnHeader', shape: 'boolean', type: 'boolean', doc: 'Hide the column header row (view wrapper)' },
  { key: 'hideListHeader', shape: 'boolean', type: 'boolean', doc: 'Hide the list header area (view wrapper)' },
  { key: 'commandBarProps', shape: 'object', type: 'object', doc: 'Customize the command bar — hide/rename/move buttons per key (view wrapper)' },
];

const COMMAND_BAR_KEYS: KeyDef[] = [
  { key: 'commands', shape: 'array', type: 'array', doc: 'One entry per command-bar button, addressed by key' },
];

const COMMAND_KEYS: KeyDef[] = [
  { key: 'key', shape: 'string', type: 'string', doc: 'Which button — "new", "share", "editInGridView"… Microsoft renamed some keys: emit old AND new (e.g. upload + UploadCommand) so hides survive rollouts' },
  { key: 'hide', shape: 'boolean', type: 'boolean', doc: 'true hides the button AND its right-click menu entry — also takes an =expression' },
  { key: 'text', shape: 'formula', type: 'string', doc: 'Rename the button — a literal or an =expression' },
  { key: 'title', shape: 'formula', type: 'string', doc: 'The button’s tooltip text' },
  { key: 'iconName', shape: 'string', type: 'string', doc: 'A Fluent UI icon name — "" removes the icon' },
  { key: 'primary', shape: 'boolean', type: 'boolean', doc: 'Primary (accent) styling — only honored when the command sits at position 0' },
  { key: 'position', shape: 'number', type: 'number', doc: 'Zero-based slot to move the command to' },
  { key: 'sectionType', shape: 'string', type: 'string', doc: '"Primary" or "Overflow" — which section of the bar holds the command' },
  { key: 'selectionModes', shape: 'array', type: 'array', doc: 'Limit to ["NoSelection","SingleSelection","MultiSelection"] states' },
];

const TILE_WRAPPER_KEYS: KeyDef[] = [
  { key: 'formatter', shape: 'object', type: 'object', doc: 'The element tree painting each tile (tile wrapper)' },
  { key: 'width', shape: 'number', type: 'number', doc: 'Tile width in px (tile wrapper)' },
  { key: 'height', shape: 'number', type: 'number', doc: 'Tile height in px (tile wrapper)' },
  { key: 'fillHorizontally', shape: 'boolean', type: 'boolean', doc: 'Stretch tiles to fill the row (tile wrapper)' },
];

const ROW_ACTION_KEYS: KeyDef[] = [
  { key: 'action', shape: 'string', type: 'string', doc: 'What the click does — defaultClick, share, delete, editProps, setValue, executeFlow, embed…' },
  { key: 'actionParams', shape: 'string', type: 'string', doc: 'Action argument — the flow id for executeFlow, the URL for embed' },
  { key: 'actionInput', shape: 'object', type: 'object', doc: 'setValue only: { "FieldName": value } pairs to write' },
];

const CARD_PROPS_KEYS: KeyDef[] = [
  { key: 'formatter', shape: 'object', type: 'object', doc: 'The element tree rendered inside the callout card' },
  { key: 'openOnEvent', shape: 'string', type: 'string', doc: '"hover" or "click" — what opens the card' },
  { key: 'directionalHint', shape: 'string', type: 'string', doc: 'Which side the card prefers — bottomCenter, rightCenter…' },
  { key: 'isBeakVisible', shape: 'boolean', type: 'boolean', doc: 'Show the little pointer beak on the card' },
  { key: 'beakStyle', shape: 'object', type: 'object', doc: 'Style map for the beak' },
];

function styleKeyDefs(): KeyDef[] {
  return [...ALLOWED_STYLES].map((p) => ({
    key: p, shape: 'formula' as const, type: 'string' as const, doc: STYLE_PROP_DOCS[p] ?? '',
  }));
}

function attributeKeyDefs(): KeyDef[] {
  return ALLOWED_ATTRIBUTES.map((a) => ({
    key: a, shape: 'formula' as const, type: 'string' as const, doc: ATTRIBUTE_DOCS[a] ?? '',
  }));
}

function keyDefsFor(ctx: JsonCtx): KeyDef[] {
  switch (ctx) {
    case 'element': return ELEMENT_KEYS;
    // the top-level object might be a view/tile wrapper OR a column formatter
    // (whose root element spreads into the wrapper) — offer the union
    case 'root': return [...ROW_WRAPPER_KEYS, ...TILE_WRAPPER_KEYS, ...ELEMENT_KEYS];
    case 'style': return styleKeyDefs();
    case 'attributes': return attributeKeyDefs();
    case 'rowAction': return ROW_ACTION_KEYS;
    case 'cardProps': return CARD_PROPS_KEYS;
    case 'commandBar': return COMMAND_BAR_KEYS;
    case 'command': return COMMAND_KEYS;
    default: return [];
  }
}

const SCAFFOLDS: Record<ValueShape, { text: string; caretBack: number }> = {
  string: { text: '""', caretBack: 1 },
  formula: { text: '""', caretBack: 1 },
  object: { text: '{}', caretBack: 1 },
  array: { text: '[]', caretBack: 1 },
  boolean: { text: '', caretBack: 0 },
  number: { text: '', caretBack: 0 },
};

// ─── value catalogs ──────────────────────────────────────────────────────────

const ELM_TYPE_DOCS: Record<string, string> = {
  div: 'Block container — the workhorse',
  span: 'Inline text container',
  a: 'Link (pair with attributes.href)',
  img: 'Image (pair with attributes.src)',
  button: 'Clickable button (pair with customRowAction)',
  p: 'Paragraph',
  svg: 'Vector canvas (children: path)',
  path: 'SVG shape (attributes.d carries the path data)',
  filepreview: 'Thumbnail of the item’s file',
};

const ROW_ACTION_DOCS: Record<string, string> = {
  defaultClick: 'What clicking the item normally does (open it)',
  share: 'Open the share dialog',
  delete: 'Open the delete confirmation',
  editProps: 'Open the edit-properties form',
  openContextMenu: 'Open the item’s … context menu',
  setValue: 'Write field values (actionInput carries them)',
  embed: 'Open a URL in an embed panel (actionParams)',
  executeFlow: 'Run a Power Automate flow (actionParams carries the flow id)',
};

/** Multi-value field types forEach can legally iterate. */
const FOREACH_TYPES = new Set(['choiceMulti', 'personMulti', 'lookupMulti']);

function plain(values: readonly string[], docs?: Record<string, string>): JsonSuggestItem[] {
  return values.filter((v) => v !== '').map((v) => ({ insert: v, ...(docs?.[v] ? { doc: docs[v] } : {}) }));
}

function valueItemsFor(ctx: JsonCtx, key: string | null, fields: MockField[]): JsonSuggestItem[] {
  if (!key) return [];
  if (ctx === 'style') return plain(STYLE_VALUE_SUGGESTIONS[key] ?? []);
  if (ctx === 'attributes') return plain(ATTRIBUTE_VALUE_SUGGESTIONS[key] ?? []);
  if (ctx === 'rowAction' && key === 'action') return plain(ROW_ACTIONS, ROW_ACTION_DOCS);
  if (ctx === 'cardProps') {
    if (key === 'openOnEvent') return plain(['hover', 'click']);
    if (key === 'directionalHint') return plain(DIRECTIONAL_HINTS);
    return [];
  }
  if (ctx === 'command') {
    // every real command key (rename aliases included), labeled by its button
    if (key === 'key') {
      return plain(
        COMMAND_BUTTONS.flatMap((btn) => [...btn.keys]),
        Object.fromEntries(COMMAND_BUTTONS.flatMap((btn) => btn.keys.map((k) => [k, btn.label]))),
      );
    }
    if (key === 'sectionType') return plain(['Primary', 'Overflow']);
    return [];
  }
  if (ctx === 'element' || ctx === 'root') {
    if (key === 'elmType') return plain(ELM_TYPES, ELM_TYPE_DOCS);
    if (key === 'forEach') {
      return fields.filter((f) => FOREACH_TYPES.has(f.type)).map((f) => ({
        insert: `item in [$${f.name}]`,
        type: 'array' as const,
        doc: `Repeat per value of “${f.displayName ?? f.name}”`,
      }));
    }
    if (key === 'inlineEditField' || key === 'defaultHoverField') {
      return fields.map((f) => ({ insert: `[$${f.name}]`, doc: f.displayName ?? f.name }));
    }
    if (key === '$schema') {
      // row and tile share one schema URL — two identical inserts would
      // collide (the accept handler resolves picks by insert text)
      return [
        { insert: SCHEMA_URLS.column, doc: 'Column formatting' },
        { insert: SCHEMA_URLS.row, doc: 'View (row) / tile formatting' },
      ];
    }
    if (key === 'additionalRowClass') return plain(CLASS_SUGGESTIONS);
  }
  return [];
}

// ─── the SP expression layer (inside "=…" strings) ───────────────────────────

const RETURN_BADGE: Record<string, SuggestValueType | undefined> = {
  string: 'string', number: 'number', boolean: 'boolean', date: 'date', array: 'array', any: undefined,
};

/** The engine's function catalog as completion items — name + signature docs
 *  from SP_FUNCTION_DOCS, grounded in what core/expressions actually runs. */
export function spFunctionItems(): JsonSuggestItem[] {
  const items = Object.entries(SP_FUNCTION_DOCS).map(([name, d]) => ({
    insert: `${name}(`,
    type: RETURN_BADGE[d.returns],
    doc: `${d.signature} — ${d.summary}`,
  }));
  items.push(
    { insert: 'true', type: 'boolean', doc: 'The yes value' },
    { insert: 'false', type: 'boolean', doc: 'The no value' },
  );
  return items;
}

const AT_RE = /@[A-Za-z0-9_.]*$/;
const WORD_RE = /[A-Za-z_][A-Za-z0-9_]*$/;

/** Where a `[$…]` pick should replace to: through a `]` ahead of the caret
 *  but still inside the string (so the pick's own `]` doesn't double up). */
function refReplaceEnd(text: string, caret: number, strEnd: number): number {
  const stop = text.slice(caret, strEnd);
  const close = stop.indexOf(']');
  const nextOpen = stop.indexOf('[');
  return close !== -1 && (nextOpen === -1 || close < nextOpen) ? caret + close + 1 : caret;
}

/** Completions inside an `=` formula string. `bodyStart` is the offset of the
 *  first char after `=`; `strEnd` the content end (closing quote or caret line
 *  end). Mirrors the fx bar's dispatch, SP dialect: @tokens, [$refs, functions. */
function exprCompletionAt(
  text: string, caret: number, bodyStart: number, strEnd: number,
  fields: MockField[], opts?: CompletionOpts,
): JsonCompletion | null {
  const before = text.slice(bodyStart, caret);

  // inside an open [$… (no ] between the [ and the caret)
  const lb = before.lastIndexOf('[');
  if (lb >= 0 && !before.slice(lb).includes(']')) {
    if (!before.slice(lb + 1).startsWith('$') && before.length > lb + 1) return null;
    const partial = before.slice(lb + 2).toLowerCase();
    const items = columnRefItems(fields, 'internal', opts?.ctx)
      .filter((i) => i.insert.slice(1, -1).toLowerCase().includes(partial));
    return items.length
      ? { items, from: bodyStart + lb, to: refReplaceEnd(text, caret, strEnd), bare: false }
      : null;
  }

  // @context token
  const at = before.match(AT_RE);
  if (at) {
    const partial = at[0].slice(1).toLowerCase();
    const items = systemTokenItems(opts)
      .filter((i) => i.insert.slice(1).toLowerCase().startsWith(partial));
    return items.length ? { items, from: caret - at[0].length, to: caret, bare: false } : null;
  }

  // a bare word → the engine's functions (+ true/false)
  const w = before.match(WORD_RE);
  if (w) {
    const partial = w[0].toLowerCase();
    const items = spFunctionItems().filter((i) => i.insert.toLowerCase().startsWith(partial));
    return items.length ? { items, from: caret - w[0].length, to: caret, bare: false } : null;
  }

  return null;
}

// ─── assembling completions ──────────────────────────────────────────────────

/** Rank filter: prefix matches first, then substring matches — both case-
 *  insensitive. An empty partial keeps catalog order. */
function rank(items: JsonSuggestItem[], partial: string): JsonSuggestItem[] {
  if (!partial) return items;
  const p = partial.toLowerCase();
  const starts = items.filter((i) => i.insert.toLowerCase().startsWith(p));
  const contains = items.filter((i) => !i.insert.toLowerCase().startsWith(p) && i.insert.toLowerCase().includes(p));
  return [...starts, ...contains];
}

/** End of the string CONTENT the caret sits in: the closing quote on the same
 *  line if there is one, else the caret itself (unterminated — replace nothing
 *  the user hasn't typed). */
function stringContentEnd(text: string, strStart: number, caret: number): number {
  const { end, closed } = scanString(text, strStart);
  if (closed && caret <= end - 1) return end - 1;
  return caret;
}

/** The next non-whitespace character at/after `i`, or ''. */
function nextSolid(text: string, i: number): string {
  while (i < text.length && /\s/.test(text[i])) i++;
  return i < text.length ? text[i] : '';
}

/** The last non-whitespace character before `i`, or ''. */
function prevSolid(text: string, i: number): string {
  let j = i - 1;
  while (j >= 0 && /\s/.test(text[j])) j--;
  return j >= 0 ? text[j] : '';
}

/** Build the full-member insert for a key picked at a BARE position:
 *  `"key": scaffold` with comma repair on both sides. */
function bareKeyItem(def: KeyDef, text: string, caret: number): JsonSuggestItem {
  const scaffold = SCAFFOLDS[def.shape];
  // a comma leads unless the previous solid char OPENS a container or already
  // separates ('' = start of buffer) — i.e. right after any completed value
  const prev = prevSolid(text, caret);
  const lead = prev === '' || '{[,:'.includes(prev) ? '' : ', ';
  const trail = nextSolid(text, caret) === '"' ? ',' : '';
  const core = `"${def.key}": ${scaffold.text}`;
  return {
    insert: `${lead}${core}${trail}`,
    caretOffset: lead.length + core.length - scaffold.caretBack,
    ...(def.type ? { type: def.type } : {}),
    ...(def.doc ? { doc: def.doc } : {}),
  };
}

export type { CompletionOpts } from './fxSuggest';

/**
 * What to offer at `caret` in the JSON pane's buffer — or null. The one entry
 * point the DOM shell calls; everything above is its machinery.
 */
export function jsonCompletionAt(
  text: string,
  caret: number,
  fields: MockField[],
  opts?: CompletionOpts,
): JsonCompletion | null {
  const scan = scanTo(text, caret);
  const ctx = classify(scan.frames);

  // ── caret inside a string ──
  if (scan.strStart >= 0) {
    const contentStart = scan.strStart + 1;
    const contentEnd = stringContentEnd(text, scan.strStart, caret);

    if (scan.strIsKey) {
      if (ctx === 'unknown') return null;
      const partial = rawPartial(text, contentStart, caret);
      const top = scan.frames[scan.frames.length - 1];
      const present = new Set([
        ...(top?.kind === 'obj' ? top.keys : []),
        // resume the forward scan AFTER this string — from inside it the lexer
        // would misread its closing quote as an opening one
        ...keysAfterCaret(text, scanString(text, scan.strStart).end),
      ]);
      const defs = keyDefsFor(ctx).filter((d) => !present.has(d.key));
      const items = rank(defs.map((d) => ({
        insert: d.key,
        ...(d.type ? { type: d.type } : {}),
        ...(d.doc ? { doc: d.doc } : {}),
      })), partial);
      return items.length ? { items, from: contentStart, to: contentEnd, bare: false } : null;
    }

    // a VALUE string — under which key?
    const top = scan.frames[scan.frames.length - 1];
    const key = top?.kind === 'obj' ? top.lastKey
      : top?.kind === 'arr' ? top.key : null;

    // the SP expression layer: any value string starting with `=`
    if (text[contentStart] === '=') {
      return exprCompletionAt(text, caret, contentStart + 1, contentEnd, fields, opts);
    }

    const catalog = valueItemsFor(ctx, key, fields);
    if (!catalog.length) return null;

    // class-like values complete per whitespace-separated token
    const tokenWise = (ctx === 'attributes' && key === 'class')
      || ((ctx === 'element' || ctx === 'root') && key === 'additionalRowClass');
    const typed = text.slice(contentStart, caret);
    const from = tokenWise ? contentStart + typed.length - (typed.split(/\s/).pop() ?? '').length : contentStart;
    const to = tokenWise ? caret : contentEnd;
    const partial = text.slice(from, caret);
    const items = rank(catalog, partial);
    return items.length ? { items, from, to, bare: false } : null;
  }

  // ── bare structure (not inside a string) ──
  const top = scan.frames[scan.frames.length - 1];
  if (!top) return null;

  if (top.kind === 'obj' && !top.expectValue && top.pendingKey === null) {
    // key position: offer full `"key": scaffold` members
    if (ctx === 'unknown') return null;
    const present = new Set([...top.keys, ...keysAfterCaret(text, caret)]);
    const defs = keyDefsFor(ctx).filter((d) => !present.has(d.key));
    const items = defs.map((d) => bareKeyItem(d, text, caret));
    return items.length ? { items, from: caret, to: caret, bare: true } : null;
  }

  if (top.kind === 'obj' && top.expectValue) {
    // bare value position (after `:`): booleans for boolean keys, quoted
    // catalog values for string keys — Ctrl+Space territory either way
    const def = keyDefsFor(ctx).find((d) => d.key === top.lastKey);
    if (def?.shape === 'boolean') {
      return {
        items: [
          { insert: 'true', type: 'boolean' },
          { insert: 'false', type: 'boolean' },
        ],
        from: caret, to: caret, bare: true,
      };
    }
    const catalog = valueItemsFor(ctx, top.lastKey, fields);
    if (catalog.length) {
      return {
        items: catalog.map((i) => ({ ...i, insert: `"${i.insert}"` })),
        from: caret, to: caret, bare: true,
      };
    }
  }

  return null;
}

// ─── signature help (the HorseScript-style parameter hint) ──────────────────
// Prior art: thechriskent/jsonify's HorseScript signature helper (MIT) — the
// idea, not the code: parse parenthesis nesting around the caret and show the
// function's signature with the active argument. Grounded in SP_FUNCTION_DOCS
// (the same catalog the linter's arg-count rule checks against).

export interface SignatureHint {
  name: string;
  /** 0-based argument the caret sits in. */
  argIndex: number;
  doc: SPFunctionDoc;
}

/** A raw JSON-string slice unescaped to its logical value — the SP layer
 *  must see `\"` as a double quote, `\\` as a backslash. Lenient: a trailing
 *  lone backslash or malformed \u passes through instead of throwing. */
const JSON_ESCAPES: Record<string, string> = {
  '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t',
};
function unescapeJson(raw: string): string {
  let out = '';
  let i = 0;
  while (i < raw.length) {
    const c = raw[i];
    if (c !== '\\' || i + 1 >= raw.length) { out += c; i++; continue; }
    const n = raw[i + 1];
    if (n === 'u' && /^[0-9a-fA-F]{4}$/.test(raw.slice(i + 2, i + 6))) {
      out += String.fromCharCode(parseInt(raw.slice(i + 2, i + 6), 16));
      i += 6;
      continue;
    }
    out += JSON_ESCAPES[n] ?? n;
    i += 2;
  }
  return out;
}

/**
 * The innermost UNCLOSED function call around the caret, when the caret sits
 * inside an `=` expression string — else null. SP string literals may use
 * single OR double quotes (core/expressions' tokenizer accepts both, with no
 * escapes inside); double quotes reach this buffer JSON-escaped as `\"`, so
 * the body is unescaped through the JSON layer before the scan. Parens and
 * commas inside either literal style never nest. Only the call name and
 * argument INDEX leave this function, so losing raw offsets to the unescape
 * is free.
 */
export function signatureHintAt(text: string, caret: number): SignatureHint | null {
  const scan = scanTo(text, caret);
  if (scan.strStart < 0 || scan.strIsKey) return null;
  const contentStart = scan.strStart + 1;
  if (text[contentStart] !== '=') return null;

  const body = unescapeJson(text.slice(contentStart + 1, caret));
  const stack: Array<{ name: string; argIndex: number }> = [];
  let i = 0;
  while (i < body.length) {
    const c = body[i];
    if (c === "'" || c === '"') {
      // an SP string literal (either quote style) — skip to its closer
      const close = body.indexOf(c, i + 1);
      if (close === -1) break; // unterminated literal: nothing after it counts
      i = close + 1;
      continue;
    }
    if (c === '(') {
      const name = body.slice(0, i).match(/([A-Za-z_][A-Za-z0-9_]*)\s*$/)?.[1] ?? '';
      stack.push({ name, argIndex: 0 });
      i++;
      continue;
    }
    if (c === ')') {
      stack.pop();
      i++;
      continue;
    }
    if (c === ',' && stack.length) {
      stack[stack.length - 1].argIndex++;
      i++;
      continue;
    }
    i++;
  }
  // the innermost call with a name the engine actually knows
  for (let k = stack.length - 1; k >= 0; k--) {
    const call = stack[k];
    const doc = SP_FUNCTION_DOCS[call.name];
    if (doc) return { name: call.name, argIndex: call.argIndex, doc };
  }
  return null;
}
