// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Sam Yost

/**
 * lite/flatten.ts — open ANY gallery card in Lite.
 *
 * Copilot, the SharePoint card designer and community samples build cards
 * with flow layout (nested flex boxes). Lite edits free layout. This module
 * converts one into the other by MEASURING: the caller renders the pasted
 * card on the sample items and reports where each element really landed.
 *
 * What becomes a part (a "unit"): anything that shows content (text,
 * picture, icon, button, link), anything that loops (forEach) or has its own
 * behavior (row action, hover card, inline edit), and anything a rule shows
 * or hides. A unit keeps its whole inner tree, so its rules keep working.
 * Containers that only arrange their children dissolve; a container that
 * paints (fill, border, shadow) leaves a shape at its own position. Text
 * styles a dissolved container gave its children move down onto them.
 *
 * Nothing with content is dropped: a unit that never showed on a sample item
 * is placed over its container and named in the notes.
 *
 * The measuring is injected (Measure), so these rules are unit-tested
 * without a browser. lite/measure.ts supplies the DOM version.
 */

import type { SPElement, SPExpr, FormatterDocument, NodePath } from '../core/types';
import { cardSize, innerSize, isClickOverlay, isFreeCard, isRule, px, withRect, MIN_SIZE, type Rect } from './model';

export interface Measured {
  rect: Rect;
  paints: boolean;
  /** Inherited text styles this element sets for itself (by class or inline):
   *  its computed value differs from its parent's on some sample item. A
   *  dissolved ancestor's value must never override these. */
  own?: string[];
}
/** Where the element at `path` landed (card px, inside the border), merged
 *  over the sample items — or null when it never showed. */
export type Measure = (path: NodePath) => Measured | null;

export interface FlattenResult { doc: FormatterDocument; notes: string[] }

const CONTENT_TYPES = new Set(['img', 'svg', 'path', 'filepreview', 'button', 'a']);

/** Text styles CSS hands down to children. */
export const INHERITED = [
  'color', 'font-size', 'font-weight', 'font-family', 'font-style', 'line-height',
  'text-align', 'letter-spacing', 'text-transform', 'white-space', 'word-break',
];
const INHERITED_CLASS = /^(ms-font|sp-css-color|sp-field-fontSize)/;
/** Which inherited text styles a handed-down class sets. */
const CLASS_PROPS: Array<[RegExp, string[]]> = [
  [/^(ms-fontColor-|sp-css-color-)/, ['color']],
  [/^(ms-fontSize-|sp-field-fontSize)/, ['font-size']],
  [/^ms-fontWeight-/, ['font-weight']],
  [/^ms-font-/, ['font-size', 'font-weight']],
];
const PAINT_PROP = /^(background|border|box-shadow|opacity|outline)/;
/** Layout that only made sense inside the old flow (the part's box replaces
 *  it). Flex-ITEM props only: flex-direction/-wrap/-flow arrange the part's
 *  own children and must stay. */
const LAYOUT_PROP = /^(position|left|top|right|bottom|width|height|min-|max-|margin|transform|align-self|order|justify-self)|^(flex|flex-grow|flex-shrink|flex-basis)$/;

interface Inherit { style: Record<string, SPExpr>; classes: string[] }
const NOTHING: Inherit = { style: {}, classes: [] };

function classOf(el: SPElement): string | undefined {
  const c = el.attributes?.class;
  return typeof c === 'string' && !isRule(c) ? c : undefined;
}

function showsContent(el: SPElement): boolean {
  return CONTENT_TYPES.has(el.elmType) || el.txtContent !== undefined
    || el.attributes?.iconName !== undefined || el.columnFormatterReference !== undefined;
}

function hasBehavior(el: SPElement): boolean {
  return !!(el.customRowAction || el.customCardProps || el.inlineEditField || el.defaultHoverField);
}

/** A size or position a rule computes per item (a progress fill's width). */
function ruledLayout(el: SPElement): boolean {
  return Object.entries(el.style ?? {}).some(([k, v]) => LAYOUT_PROP.test(k) && isRule(v));
}

function shownByRule(el: SPElement): boolean {
  return isRule(el.style?.display) || isRule(el.style?.visibility);
}

/** Does this element become one part (keeping its inner tree)? */
export function isUnit(el: SPElement): boolean {
  if (showsContent(el) || !el.children?.length || hasBehavior(el) || shownByRule(el)) return true;
  // loops, and children sized by a rule, only work inside their own container
  if (el.children.some((c) => c.forEach || ruledLayout(c))) return true;
  // opacity fades the whole group: dissolving it would un-fade the children
  if (el.style?.opacity !== undefined || isRule(el.attributes?.class)) return true;
  return /\bsp-card-showOnHover/.test(classOf(el) ?? '');
}

function inherit(from: Inherit, el: SPElement): Inherit {
  const style = { ...from.style };
  for (const k of INHERITED) {
    const v = el.style?.[k];
    if (v !== undefined) style[k] = v;
  }
  const own = (classOf(el) ?? '').split(/\s+/).filter((c) => INHERITED_CLASS.test(c));
  return { style, classes: [...from.classes, ...own] };
}

function asPart(el: SPElement, r: Rect, inh: Inherit, ownProps: string[] = []): SPElement {
  // a handed-down style never beats one the part sets itself, by class or inline
  const owned = (k: string): boolean => el.style?.[k] !== undefined || ownProps.includes(k);
  const style: Record<string, SPExpr> = {};
  for (const [k, v] of Object.entries(inh.style)) if (!owned(k)) style[k] = v;
  for (const [k, v] of Object.entries(el.style ?? {})) if (v !== undefined && !LAYOUT_PROP.test(k)) style[k] = v;
  // the measured box is the BORDER box; this keeps padding inside it
  style['box-sizing'] = 'border-box';
  style.margin = '0';
  const out: SPElement = { ...el, style: style as SPElement['style'] };
  const own = el.attributes?.class;
  const handed = inh.classes.filter((c) => !(CLASS_PROPS.find(([re]) => re.test(c))?.[1] ?? []).some(owned));
  if (handed.length && (own === undefined || !isRule(own))) {
    out.attributes = { ...(el.attributes ?? {}), class: [...handed, ...(typeof own === 'string' ? [own] : [])].join(' ') };
  }
  return withRect(out, r);
}

/** Where a part that never showed goes: its container's corner, at its own
 *  literal size when it has one (a hidden 10 px dot stays a dot). */
function fallbackRect(el: SPElement, around: Rect): Rect {
  return { x: around.x, y: around.y, w: px(el.style?.width) ?? around.w, h: px(el.style?.height) ?? around.h };
}

function asShape(el: SPElement, r: Rect): SPElement {
  const style: Record<string, SPExpr> = {};
  for (const [k, v] of Object.entries(el.style ?? {})) if (v !== undefined && PAINT_PROP.test(k)) style[k] = v;
  style['box-sizing'] = 'border-box';
  style.margin = '0';
  style.padding = '0';
  const cls = classOf(el);
  return withRect({
    elmType: 'div',
    _elmName: el._elmName ? `${el._elmName} background` : 'Background',
    ...(cls ? { attributes: { class: cls } } : {}),
    style: style as SPElement['style'],
  }, r);
}

function clampTo(r: Rect, inner: { w: number; h: number }): Rect {
  const x = Math.max(0, Math.min(r.x, inner.w - MIN_SIZE));
  const y = Math.max(0, Math.min(r.y, inner.h - MIN_SIZE));
  return {
    x, y,
    w: Math.max(MIN_SIZE, Math.min(r.w, inner.w - x)),
    h: Math.max(MIN_SIZE, Math.min(r.h, inner.h - y)),
  };
}

/** The new root keeps what still applies with absolute children: its paint,
 *  its classes and the text styles CSS still hands down. */
function rootStyle(root: SPElement, w: number, h: number): SPElement['style'] {
  const style: Record<string, SPExpr> = {};
  for (const [k, v] of Object.entries(root.style ?? {})) {
    if (v !== undefined && (PAINT_PROP.test(k) || INHERITED.includes(k))) style[k] = v;
  }
  return {
    position: 'relative', width: `${w}px`, height: `${h}px`,
    overflow: 'hidden', 'box-sizing': 'border-box', ...style,
    // the root IS the tile: no class margin (sp-card-container's 8 px) may shift it
    margin: '0',
  } as SPElement['style'];
}

export function flattenCard(doc: FormatterDocument, measure: Measure): FlattenResult {
  if (isFreeCard(doc)) return { doc, notes: [] };
  const { w, h } = cardSize(doc);
  const root = doc.root;
  // The root stays WHOLE (one part inside a fresh root) when it is content
  // itself (a bare column formatter), or when taking it apart would break a
  // loop, a rule-computed size, or a rule that shows or hides the card.
  const whole = showsContent(root) || !root.children?.length || shownByRule(root)
    || root.children.some((c) => c.forEach || ruledLayout(c));
  const newRoot: SPElement = whole
    ? { elmType: 'div', style: rootStyle({ elmType: 'div' }, w, h), children: [] }
    : { ...root, style: rootStyle(root, w, h), children: [] };
  const inner = innerSize({ ...doc, root: newRoot });
  const full: Rect = { x: 0, y: 0, w: inner.w, h: inner.h };

  const parts: SPElement[] = [];
  let overlay: SPElement | null = null;
  const unseen: string[] = [];
  let ruled = 0;

  const visit = (el: SPElement, path: NodePath, inh: Inherit, around: Rect): void => {
    if (isClickOverlay(el)) { overlay ??= el; return; }
    const m = measure(path);
    if (isUnit(el)) {
      // only a SEEN, unpainted, empty leaf with no behavior is a mere spacer
      const isSpacer = m !== null && !m.paints && !showsContent(el) && !el.children?.length && !hasBehavior(el);
      if (isSpacer) return;
      if (shownByRule(el)) ruled++;
      if (!m) unseen.push(el._elmName ?? (typeof el.txtContent === 'string' ? el.txtContent : el.elmType));
      parts.push(asPart(el, clampTo(m?.rect ?? fallbackRect(el, around), inner), inh, m?.own));
      return;
    }
    const here = m?.rect ?? around;
    if (m?.paints) parts.push(asShape(el, clampTo(here, inner)));
    const next = inherit(inh, el);
    el.children!.forEach((c, i) => visit(c, [...path, i], next, here));
  };

  if (whole) {
    parts.push(asPart(root, clampTo(measure([])?.rect ?? full, inner), NOTHING));
  } else {
    root.children!.forEach((c, i) => visit(c, [i], NOTHING, full));
  }

  newRoot.children = overlay ? [overlay, ...parts] : parts;
  const notes = [`Opened as free layout: ${parts.length} part${parts.length === 1 ? '' : 's'}.`];
  if (ruled) notes.push(`${ruled} part${ruled === 1 ? ' is' : 's are'} shown by a rule. Lite kept ${ruled === 1 ? 'it' : 'them'} whole.`);
  if (unseen.length) notes.push(`Not visible on the sample items, so placed over their container: ${unseen.slice(0, 3).join(', ')}${unseen.length > 3 ? '…' : ''}.`);
  return {
    doc: { ...doc, kind: 'tile', tileWidth: w, tileHeight: h, root: newRoot },
    notes,
  };
}
