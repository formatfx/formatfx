// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Sam Yost

/**
 * editor/hoverReveal.ts — "Reveal on hover" as a maker-facing concept.
 *
 * The engine has known the sp-card-showOnHoverParent / sp-card-showOnHoverChild
 * pair for a while (schema suggestions, theme.ts emulation, the row-template
 * kebab); this module gives the inspector a first-class toggle so a maker
 * never has to know the class names (issue #203, semantics in HANDOFF §3.7).
 *
 * Pure tree logic only — the caller wraps mutations in state.mutateDocument()
 * so a toggle is one undoable gesture (both class edits together).
 *
 * Pairing rules mirrored from the linter (hover-child-no-parent):
 *  - the reveal selector is a DESCENDANT :hover — the parent class must sit on
 *    a strict ancestor, never on the element itself
 *  - the pairing never crosses a customCardProps boundary (the card body
 *    renders in a callout, not as a DOM descendant of the host)
 */

import type { SPElement, NodePath } from '../core/types';

export const HOVER_PARENT_CLASS = 'sp-card-showOnHoverParent';
export const HOVER_CHILD_CLASS = 'sp-card-showOnHoverChild';

/** Path segment that descends into customCardProps.formatter (state.ts convention). */
const CARD_SEGMENT = -1;

function classTokens(el: SPElement): string[] {
  const c = el.attributes?.class;
  return typeof c === 'string' ? c.split(/\s+/).filter(Boolean) : [];
}

/** A class value we can token-edit without corrupting it: absent, or a plain
 *  (non-expression) string. An =expression or AST object must stay hands-off. */
function classIsEditable(el: SPElement): boolean {
  const c = el.attributes?.class;
  return c === undefined || (typeof c === 'string' && !c.startsWith('='));
}

export function hasClassToken(el: SPElement, token: string): boolean {
  return classTokens(el).includes(token);
}

export function addClassToken(el: SPElement, token: string): void {
  if (hasClassToken(el, token)) return;
  el.attributes = el.attributes ?? {};
  const cur = el.attributes.class;
  el.attributes.class = typeof cur === 'string' && cur.trim() !== '' ? `${cur.trim()} ${token}` : token;
}

export function removeClassToken(el: SPElement, token: string): void {
  if (!el.attributes || !hasClassToken(el, token)) return;
  const rest = classTokens(el).filter((t) => t !== token);
  if (rest.length) el.attributes.class = rest.join(' ');
  else {
    delete el.attributes.class;
    if (Object.keys(el.attributes).length === 0) delete el.attributes;
  }
}

function nodeAt(root: SPElement, path: NodePath): SPElement | null {
  let node: SPElement | undefined = root;
  for (const i of path) {
    node = i === CARD_SEGMENT ? node?.customCardProps?.formatter : node?.children?.[i];
    if (!node) return null;
  }
  return node ?? null;
}

/** Strict-ancestor paths within the same rendered DOM tree (outermost first) —
 *  stops at the nearest customCardProps boundary, because the host's :hover
 *  can't reveal anything inside the callout. */
function inTreeAncestorPaths(path: NodePath): NodePath[] {
  const boundary = path.lastIndexOf(CARD_SEGMENT) + 1; // prefix length of the tree root
  const out: NodePath[] = [];
  for (let len = boundary; len < path.length; len++) out.push(path.slice(0, len));
  return out;
}

/** Any DOM descendant carries the child class (does not cross card boundaries). */
export function subtreeHasHoverChild(el: SPElement): boolean {
  for (const c of el.children ?? []) {
    if (hasClassToken(c, HOVER_CHILD_CLASS) || subtreeHasHoverChild(c)) return true;
  }
  return false;
}

export interface HoverRevealStatus {
  /** The element currently carries the child class. */
  on: boolean;
  /** The toggle is operable for this element. */
  can: boolean;
  /** Teaching text when !can (shown as the control's tooltip). */
  reason?: string;
}

export function hoverRevealStatus(root: SPElement, path: NodePath): HoverRevealStatus {
  const node = nodeAt(root, path);
  if (!node) return { on: false, can: false, reason: 'No element selected.' };
  const on = hasClassToken(node, HOVER_CHILD_CLASS);
  if (inTreeAncestorPaths(path).length === 0) {
    return { on, can: on, reason: on ? undefined : 'The root element has nothing above it to hover — move what you want revealed inside a container first.' };
  }
  if (!classIsEditable(node)) {
    return { on, can: false, reason: 'This element\'s class is driven by a formula — add sp-card-showOnHoverChild inside it by hand (Attributes section).' };
  }
  return { on, can: true };
}

/**
 * Toggle hover-reveal on the element at `path`. On: adds the child class and,
 * if no in-tree ancestor already carries it, puts the parent class on the
 * outermost sensible container (the tree root — the whole cell/row/tile is the
 * hover surface, same as the row-template kebab). Off: removes the child class
 * and sweeps now-inert parent classes off ancestors that have no other hover
 * child left in their subtree.
 */
export function setRevealOnHover(root: SPElement, path: NodePath, on: boolean): void {
  const node = nodeAt(root, path);
  if (!node) return;
  const ancestors = inTreeAncestorPaths(path)
    .map((p) => nodeAt(root, p))
    .filter((n): n is SPElement => n !== null);
  if (on) {
    addClassToken(node, HOVER_CHILD_CLASS);
    if (!ancestors.some((a) => hasClassToken(a, HOVER_PARENT_CLASS))) {
      const host = ancestors.find((a) => classIsEditable(a)) ?? ancestors[0];
      if (host) addClassToken(host, HOVER_PARENT_CLASS);
    }
  } else {
    removeClassToken(node, HOVER_CHILD_CLASS);
    for (const a of ancestors) {
      if (hasClassToken(a, HOVER_PARENT_CLASS) && classIsEditable(a) && !subtreeHasHoverChild(a)) {
        removeClassToken(a, HOVER_PARENT_CLASS);
      }
    }
  }
}
