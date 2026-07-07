// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sam Yost. FormatFX is dual-licensed: AGPL-3.0 (see LICENSE) or a commercial license (see LICENSING.md).

/**
 * editor/modalUndo.ts — the modal-local undo brain (FLOOR-AND-SHEETS §2.3,
 * Stage 4's second half). Every tier-1/2 editor keeps a LOCAL ↶↷ stack that
 * bottoms out at the moment it opened: in-editor undo can never reach past
 * its own opening into the document's history, and committing (Save/Apply)
 * still collapses the whole session into exactly ONE app-level step. This is
 * the template builder's shipped pattern, extracted so the property dialogs
 * and the component editor share one implementation. Pure + node-tested.
 *
 * Usage: create with the editor's baseline state bag; call `commit(bag)`
 * after every gesture (a render() chokepoint works well — the no-op guard
 * eats identical snapshots, so UI-only re-renders never make a step);
 * `undo()`/`redo()` return a fresh deep clone to restore into the live
 * state, or null at the stack's edge. Snapshots are JSON — the state bags
 * these editors stage are plain data by construction.
 */

export interface ModalUndo<T> {
  /** Record the state after a gesture. Identical-to-current snapshots are
   *  ignored (the house no-op-snapshot invariant); a new gesture after an
   *  undo clears the redo tail. */
  commit(state: T): void;
  /** Step back; returns a clone of the previous state, or null at the
   *  baseline (the moment the editor opened — never past it). */
  undo(): T | null;
  /** Step forward; returns a clone of the undone state, or null. */
  redo(): T | null;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
}

export function createModalUndo<T>(baseline: T): ModalUndo<T> {
  const stack: string[] = [JSON.stringify(baseline)];
  let at = 0;
  return {
    commit(state: T): void {
      const snap = JSON.stringify(state);
      if (snap === stack[at]) return;
      stack.length = at + 1;
      stack.push(snap);
      at++;
    },
    undo(): T | null {
      if (at === 0) return null;
      at--;
      return JSON.parse(stack[at]) as T;
    },
    redo(): T | null {
      if (at >= stack.length - 1) return null;
      at++;
      return JSON.parse(stack[at]) as T;
    },
    get canUndo(): boolean { return at > 0; },
    get canRedo(): boolean { return at < stack.length - 1; },
  };
}

/**
 * The keyboard half: capture-phase Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z and
 * Ctrl/Cmd+Y for a modal editor. Capture + stopPropagation keeps the press
 * from ever reaching the app-level undo underneath the modal; text inputs
 * keep their native editing undo (the builder rule). Returns the detach
 * function — route it through the editor's close path.
 */
export function wireModalUndoKeys(onUndo: () => void, onRedo: () => void): () => void {
  const onKey = (e: KeyboardEvent): void => {
    const mod = e.ctrlKey || e.metaKey;
    if (!mod) return;
    const key = e.key.toLowerCase();
    const isUndo = key === 'z' && !e.shiftKey;
    const isRedo = (key === 'z' && e.shiftKey) || key === 'y';
    if (!isUndo && !isRedo) return;
    const t = e.target as HTMLElement;
    if (t.closest?.('input, textarea, select, [contenteditable]')) return;
    e.preventDefault();
    e.stopPropagation();
    if (isUndo) onUndo(); else onRedo();
  };
  document.addEventListener('keydown', onKey, true);
  return () => document.removeEventListener('keydown', onKey, true);
}

/** The ↶ ↷ button pair every modal editor's chrome renders — one look, one
 *  wiring. `refresh` is called back so the caller can sync disabled state
 *  after external changes too. */
export function modalUndoButtons(
  mu: ModalUndo<unknown>,
  onUndo: () => void,
  onRedo: () => void,
): { root: HTMLElement; refresh: () => void } {
  const root = document.createElement('span');
  root.className = 'wb-mu';
  const undoBtn = document.createElement('button');
  undoBtn.type = 'button';
  undoBtn.className = 'wb-mu-btn wb-mu-undo';
  undoBtn.textContent = '↶';
  undoBtn.title = 'Undo (Ctrl+Z) — inside this editor only; it bottoms out where you opened it';
  undoBtn.setAttribute('aria-label', 'Undo (in this editor)');
  undoBtn.addEventListener('click', onUndo);
  const redoBtn = document.createElement('button');
  redoBtn.type = 'button';
  redoBtn.className = 'wb-mu-btn wb-mu-redo';
  redoBtn.textContent = '↷';
  redoBtn.title = 'Redo (Ctrl+Y)';
  redoBtn.setAttribute('aria-label', 'Redo (in this editor)');
  redoBtn.addEventListener('click', onRedo);
  root.append(undoBtn, redoBtn);
  const refresh = (): void => {
    undoBtn.disabled = !mu.canUndo;
    redoBtn.disabled = !mu.canRedo;
  };
  refresh();
  return { root, refresh };
}
