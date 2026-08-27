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
  it('identity edits announce on the staged seam like tree edits do — even when already dirty', () => {
    mountWorkshop();
    const ctx = state.workshopCtx!;
    // already dirty: the announce must not be riding the clean→dirty flip
    ctx.commit(() => { ctx.root().txtContent = 'x'; });
    for (const sel of ['input.wb-ce-name', 'input.wb-ce-desc', 'input.wb-ce-slotlabel', 'input.wb-ce-slotdesc']) {
      const input = host.querySelector<HTMLInputElement>(sel);
      if (!input) continue; // slot rows exist only when the def has slots
      const reasons: string[] = [];
      const unsub = state.subscribe((r) => reasons.push(r));
      input.value = `${input.value}!`;
      input.dispatchEvent(new Event('input'));
      unsub();
      expect(reasons, `${sel} must emit workshop`).toContain('workshop');
    }
  });

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

  it('↶ after Apply returns to the TRUE pre-Apply state — typed edits made just before survive', () => {
    mountWorkshop();
    const ctx = state.workshopCtx!;
    const name = host.querySelector<HTMLInputElement>('input.wb-ce-name')!;
    name.value = 'Typed before apply';
    name.dispatchEvent(new Event('input')); // staged mutation, deliberately no ↶ step
    const next = ctx.def();
    next.root = { elmType: 'div', txtContent: 'applied' };
    ctx.applyDef(next);
    host.querySelector<HTMLButtonElement>('.wb-mu-undo')!.click();
    // Copilot review, PR #312: without a pre-Apply rebase commit, undo landed
    // on the older baseline and silently discarded the typed rename
    expect(ctx.def().name).toBe('Typed before apply');
    expect(ctx.root().txtContent).not.toBe('applied');
  });

  it('a no-op Apply after typing leaks NO hidden undo step', () => {
    mountWorkshop();
    const ctx = state.workshopCtx!;
    const name = host.querySelector<HTMLInputElement>('input.wb-ce-name')!;
    name.value = 'Typed';
    name.dispatchEvent(new Event('input')); // staged mutation, no ↶ step
    ctx.applyDef(ctx.def()); // content-identical apply
    // Copilot review, PR #312: committing the rebase BEFORE the no-op check
    // pushed the typed state as a hidden snapshot a LATER gesture exposes —
    // land a real gesture and count the undo depth
    ctx.commit(() => { ctx.root().txtContent = 'gesture'; });
    const undoBtn = host.querySelector<HTMLButtonElement>('.wb-mu-undo')!;
    undoBtn.click(); // undoes the gesture…
    expect(ctx.root().txtContent).not.toBe('gesture');
    // …and that must land on BASELINE: no hidden extra step in between
    expect(undoBtn.disabled).toBe(true);
  });

  it('applying an UNCHANGED def stages nothing — no dot, no ↶ step (but the pane still re-canonicalizes)', () => {
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
    ctx.applyDef(ctx.def()); // verbatim round-trip (a whitespace-only JSON edit)
    unsub();
    expect(dirtyLog).toEqual([]); // no unsaved dot, nothing to Save
    expect(host.querySelector<HTMLButtonElement>('.wb-mu-undo')!.disabled).toBe(true);
    expect(reasons).toContain('workshop'); // the JSON pane still re-syncs its buffer
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

  it('applyDef() is ONE modal-undo step: ↶ restores the WHOLE previous def, never a half-applied mix', () => {
    mountWorkshop();
    const ctx = state.workshopCtx!;
    const before = ctx.def();
    const next = ctx.def();
    next.root = { elmType: 'div', txtContent: 'applied-tree' };
    next.name = 'Applied name';
    next.slots = [{ key: 'Due', label: 'Applied slot label', types: ['date'] }];
    ctx.applyDef(next);
    const undoBtn = host.querySelector<HTMLButtonElement>('.wb-mu-undo')!;
    expect(undoBtn.disabled).toBe(false);
    undoBtn.click();
    // tree AND identity AND slots — an undone Apply must never leave the old
    // root referencing a new slot list (Copilot review, PR #312)
    const restored = ctx.def();
    expect(restored.root).toEqual(before.root);
    expect(restored.name).toBe(before.name);
    expect(restored.slots).toEqual(before.slots);
    // the workshop chrome re-seeded with the restored identity
    expect(host.querySelector<HTMLInputElement>('input.wb-ce-name')!.value).toBe(before.name);
    // and ↷ brings the applied def back whole
    host.querySelector<HTMLButtonElement>('.wb-mu-redo')!.click();
    expect(ctx.def().name).toBe('Applied name');
    expect(ctx.root().txtContent).toBe('applied-tree');
  });
});
