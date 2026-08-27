// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Sam Yost

/**
 * The component WORKSHOP's editing-context seam (spec §C,
 * docs/superpowers/specs/2026-07-09-view-chrome-workshop-design.md).
 *
 * While a workshop is mounted it REGISTERS `state.workshopCtx`: the staged
 * tree's root, the staged selection, and a commit() that lands on the
 * workshop's modal-undo stack (one gesture = one ↶ step) and emits the
 * 'workshop' reason — never the app undo stack, never autosave. The
 * embedded "style the selected element" panel is GONE: the real inspector
 * rides this seam instead (owner brief 2026-07-09 — supersedes the v1
 * "a workshop tab never re-targets the tree" constraint).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mountComponentWorkshop } from './componentEditor';
import { componentById } from './componentLibrary';
import { state } from './state';

let host: HTMLElement;
let handle: { destroy(): void } | null = null;

function mountWorkshop(defId = 'builtin-deadline-chip') {
  const def = componentById(defId)!;
  host = document.createElement('div');
  document.body.appendChild(host);
  const h = mountComponentWorkshop(host, def, {
    onToast: () => {}, onSaved: () => {}, onDirtyChange: () => {},
  });
  handle = h;
  return h;
}

beforeEach(() => {
  document.body.innerHTML = '';
  state.resetAll();
  state.openComponentTab('builtin-deadline-chip');
});

afterEach(() => {
  handle?.destroy();
  handle = null;
});

describe('the workshop editing context', () => {
  it('registers on mount, unregisters on destroy, and emits workshop on both', () => {
    const reasons: string[] = [];
    const unsub = state.subscribe((r) => reasons.push(r));
    expect(state.workshopCtx).toBeNull();
    const h = mountWorkshop();
    expect(state.workshopCtx).not.toBeNull();
    expect(reasons).toContain('workshop');
    h.destroy();
    handle = null;
    expect(state.workshopCtx).toBeNull();
    unsub();
  });

  it('exposes the staged root and a CARD_SEGMENT-aware node resolver', () => {
    mountWorkshop();
    const ctx = state.workshopCtx!;
    expect(ctx.root().elmType).toBeTruthy();
    expect(ctx.nodeAt([])).toBe(ctx.root());
    expect(ctx.nodeAt([999])).toBeNull();
  });

  it('select() updates the staged selection and emits workshop (never app selection)', () => {
    mountWorkshop();
    const ctx = state.workshopCtx!;
    const appSel = state.selection;
    const reasons: string[] = [];
    const unsub = state.subscribe((r) => reasons.push(r));
    ctx.select([]);
    expect(ctx.selection()).toEqual([]);
    expect(reasons).toContain('workshop');
    expect(reasons).not.toContain('selection');
    expect(state.selection).toEqual(appSel);
    unsub();
  });

  it('commit() mutates the staged tree as ONE modal-undo step and never touches app undo', () => {
    mountWorkshop();
    const ctx = state.workshopCtx!;
    const appUndoDepth = (state as unknown as { undoStack: string[] }).undoStack.length;
    ctx.select([]);
    const before = ctx.root().style?.['background-color'];
    ctx.commit(() => {
      const n = ctx.nodeAt([])!;
      n.style = { ...n.style, 'background-color': '#123456' };
    });
    expect(ctx.root().style?.['background-color']).toBe('#123456');
    expect((state as unknown as { undoStack: string[] }).undoStack.length).toBe(appUndoDepth);
    // the workshop's own ↶ takes it back
    const undoBtn = host.querySelector<HTMLButtonElement>('.wb-mu-undo')!;
    expect(undoBtn.disabled).toBe(false);
    undoBtn.click();
    expect(ctx.root().style?.['background-color']).toBe(before);
  });

  it('the embedded style panel is gone — the Properties pane owns element styling', () => {
    mountWorkshop();
    expect(host.querySelector('.wb-ce-style')).toBeNull();
    expect(host.textContent).not.toContain('Style the selected element');
    // the preview caption points at the Properties pane instead
    expect(host.textContent).toContain('Properties');
  });
});

describe('the JSON pane seam: ctx.def() + ctx.applyDef()', () => {
  it('def() is a detached snapshot of the whole staged def', () => {
    mountWorkshop();
    const ctx = state.workshopCtx!;
    const snap = ctx.def();
    expect(snap.id).toBe('builtin-deadline-chip');
    expect(snap.root).toEqual(ctx.root());
    snap.name = 'mutated';
    snap.root.txtContent = 'mutated';
    expect(ctx.def().name).not.toBe('mutated');
    expect(ctx.root().txtContent).not.toBe('mutated');
  });

  it('applyDef() stages the replacement — tree, identity fields, slots — and re-renders the workshop', () => {
    const dirtyLog: boolean[] = [];
    const def = componentById('builtin-deadline-chip')!;
    host = document.createElement('div');
    document.body.appendChild(host);
    handle = mountComponentWorkshop(host, def, {
      onToast: () => {}, onSaved: () => {}, onDirtyChange: (d) => dirtyLog.push(d),
    });
    const ctx = state.workshopCtx!;
    const reasons: string[] = [];
    const unsub = state.subscribe((r) => reasons.push(r));
    const next = ctx.def();
    next.name = 'Renamed chip';
    next.root = { elmType: 'div', txtContent: 'replaced-by-apply' };
    next.slots = [{ key: 'Due', label: 'A fresh slot label', types: ['date'] }];
    ctx.applyDef(next);
    unsub();
    expect(ctx.def().name).toBe('Renamed chip');
    expect(ctx.root().txtContent).toBe('replaced-by-apply');
    expect(dirtyLog).toContain(true);
    expect(reasons).toContain('workshop');
    // the identity inputs, slots list and preview all show the applied def
    expect(host.querySelector<HTMLInputElement>('input.wb-ce-name')!.value).toBe('Renamed chip');
    expect(host.querySelector<HTMLInputElement>('input.wb-ce-slotlabel')!.value).toBe('A fresh slot label');
    expect(host.querySelector('.wb-ce-preview')!.textContent).toContain('replaced-by-apply');
    // detached: mutating the caller's object after apply changes nothing
    next.root.txtContent = 'later-mutation';
    expect(ctx.root().txtContent).toBe('replaced-by-apply');
  });

  it('applyDef() keeps the staged identity — id and builtin are the tab\'s, not the JSON\'s', () => {
    mountWorkshop();
    const ctx = state.workshopCtx!;
    const next = ctx.def();
    next.id = 'evil-id';
    delete next.builtin;
    ctx.applyDef(next);
    expect(ctx.def().id).toBe('builtin-deadline-chip');
  });

  it('applyDef() is ONE modal-undo step: ↶ restores the previous tree', () => {
    mountWorkshop();
    const ctx = state.workshopCtx!;
    const beforeTxt = ctx.root().txtContent;
    const next = ctx.def();
    next.root = { elmType: 'div', txtContent: 'applied-tree' };
    ctx.applyDef(next);
    const undoBtn = host.querySelector<HTMLButtonElement>('.wb-mu-undo')!;
    expect(undoBtn.disabled).toBe(false);
    undoBtn.click();
    expect(ctx.root().txtContent).toBe(beforeTxt);
  });
});
