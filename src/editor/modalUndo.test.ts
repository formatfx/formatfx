/**
 * The modal-local undo brain (FLOOR-AND-SHEETS §2.3, Stage 4): bottoms out
 * at the editor's opening, no-op commits never make a step, a fresh gesture
 * clears the redo tail, and restores are clones (never live references).
 */
import { describe, it, expect } from 'vitest';
import { createModalUndo, wireModalUndoKeys } from './modalUndo';

describe('createModalUndo', () => {
  it('bottoms out at the baseline — never past the moment the editor opened', () => {
    const mu = createModalUndo({ n: 0 });
    expect(mu.canUndo).toBe(false);
    expect(mu.undo()).toBeNull();
    mu.commit({ n: 1 });
    expect(mu.canUndo).toBe(true);
    expect(mu.undo()).toEqual({ n: 0 });
    expect(mu.undo()).toBeNull(); // the baseline is the floor
  });

  it('no-op commits never make a step (UI-only re-renders are free)', () => {
    const mu = createModalUndo({ n: 0 });
    mu.commit({ n: 0 });
    mu.commit({ n: 0 });
    expect(mu.canUndo).toBe(false);
  });

  it('undo/redo walk the trail; a fresh gesture clears the redo tail', () => {
    const mu = createModalUndo({ n: 0 });
    mu.commit({ n: 1 });
    mu.commit({ n: 2 });
    expect(mu.undo()).toEqual({ n: 1 });
    expect(mu.canRedo).toBe(true);
    expect(mu.redo()).toEqual({ n: 2 });
    expect(mu.undo()).toEqual({ n: 1 });
    mu.commit({ n: 9 }); // a new gesture after undo…
    expect(mu.canRedo).toBe(false); // …drops the {n:2} branch
    expect(mu.undo()).toEqual({ n: 1 });
  });

  it('re-committing the restored state after an undo is a no-op (the render-chokepoint pattern)', () => {
    const mu = createModalUndo({ n: 0 });
    mu.commit({ n: 1 });
    const restored = mu.undo()!;
    mu.commit(restored); // render() after undo re-commits what it restored
    expect(mu.canRedo).toBe(true); // the redo tail survives
    expect(mu.redo()).toEqual({ n: 1 });
  });

  it('restores are clones — mutating a restore never corrupts the stack', () => {
    const mu = createModalUndo({ list: [1] });
    mu.commit({ list: [1, 2] });
    const back = mu.undo()!;
    back.list.push(99);
    expect(mu.redo()).toEqual({ list: [1, 2] });
    expect(mu.undo()).toEqual({ list: [1] });
  });
});

describe('wireModalUndoKeys', () => {
  const press = (init: KeyboardEventInit & { target?: HTMLElement }): void => {
    const { target, ...rest } = init;
    const ev = new KeyboardEvent('keydown', { ...rest, bubbles: true, cancelable: true });
    (target ?? document.body).dispatchEvent(ev);
  };

  it('Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y route to the modal handlers; detach stops them', () => {
    let undos = 0; let redos = 0;
    const detach = wireModalUndoKeys(() => undos++, () => redos++);
    press({ key: 'z', ctrlKey: true });
    press({ key: 'Z', ctrlKey: true, shiftKey: true });
    press({ key: 'y', ctrlKey: true });
    expect([undos, redos]).toEqual([1, 2]);
    detach();
    press({ key: 'z', ctrlKey: true });
    expect(undos).toBe(1);
  });

  it('text inputs keep their native editing undo (the builder rule)', () => {
    let undos = 0;
    const detach = wireModalUndoKeys(() => undos++, () => {});
    const input = document.createElement('input');
    document.body.appendChild(input);
    press({ key: 'z', ctrlKey: true, target: input });
    expect(undos).toBe(0);
    input.remove();
    detach();
  });
});
