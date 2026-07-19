// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Sam Yost

/**
 * editor/foldState.ts — the SHARED fold set behind the JSON pane and the
 * Structure tree (owner ask 2026-07-16: "folding should sync between them").
 *
 * Pure view state, one Set of string keys, three key shapes:
 *
 *     '0/2'            an ELEMENT's whole object (numeric node path; -1 is
 *                      the customCardProps.formatter segment, '' the root)
 *     '#c/0/2'         an element's `children` ARRAY only — the parent's own
 *                      properties stay visible (the "children:[" fold)
 *     '@groupProps'    a wrapper SECTION (viewExtras subtree) — JSON-pane
 *                      only; the tree never shows wrapper chrome
 *
 * The set is the truth; each surface projects it its own way (the JSON pane
 * into fold cuts against its offset map, the tree into hidden child rows).
 * Folding is never an undo entry and never touches localStorage. The JSON
 * pane prunes keys that stop resolving (node deleted, no longer multi-line)
 * on its regenerate — the tree just re-reads.
 *
 * Notifications carry the ORIGIN so a surface can skip reacting to its own
 * writes (the tree always re-renders; the JSON pane re-applies its fold view
 * only for changes it didn't make itself — same idea as codeSync's SyncEcho).
 */

import type { NodePath } from '../core/types';

export type FoldOrigin = 'json' | 'tree' | 'reset';
type FoldListener = (origin: FoldOrigin) => void;

/** Fold key for an element's whole object. */
export const elmFoldKey = (path: NodePath): string => path.join('/');

/** Fold key for an element's `children` array (the parent element's path). */
export const childrenFoldKey = (path: NodePath): string => `#c/${path.join('/')}`;

/** Parse a children fold key back to the parent path, or null for other keys. */
export function childrenPathOfKey(key: string): NodePath | null {
  if (!key.startsWith('#c/')) return null;
  const rest = key.slice(3);
  return rest === '' ? [] : rest.split('/').map(Number);
}

class SharedFoldState {
  private folded = new Set<string>();
  private listeners = new Set<FoldListener>();

  has(key: string): boolean {
    return this.folded.has(key);
  }

  keys(): string[] {
    return [...this.folded];
  }

  /** Mutate the set in one gesture; subscribers are notified ONCE, and only
   *  when the set actually changed (a no-op toggle stays silent). */
  update(origin: FoldOrigin, fn: (folded: Set<string>) => void): void {
    const before = [...this.folded].sort().join('\n');
    fn(this.folded);
    if ([...this.folded].sort().join('\n') === before) return;
    for (const l of [...this.listeners]) l(origin);
  }

  /** Drop every fold — state.resetAll() calls this so a fresh workspace
   *  (and every test's beforeEach) never inherits another session's folds. */
  clear(origin: FoldOrigin = 'reset'): void {
    this.update(origin, (set) => set.clear());
  }

  /** Replace the whole set WITHOUT notifying — the surface-navigation seam
   *  (state.swapSelections stashes/restores folds per surface, PR #290
   *  review). Silent on purpose: the caller emits 'load' right after, which
   *  re-renders the tree and regenerates the JSON pane against the NEW doc.
   *  A notification here would fire the pane's applyFolds while its offset
   *  map still describes the OUTGOING surface — pruning the incoming keys
   *  against the wrong document. */
  swap(keys: string[]): void {
    this.folded = new Set(keys);
  }

  subscribe(fn: FoldListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}

export const foldState = new SharedFoldState();
