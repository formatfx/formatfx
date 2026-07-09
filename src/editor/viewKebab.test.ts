// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sam Yost. FormatFX is dual-licensed: AGPL-3.0-only (see LICENSE) or a commercial license (see LICENSING.md).

/**
 * The View kebab panel (happy-dom) — spec §A (2026-07-09-view-chrome-workshop).
 * Everything view-scoped lives here now: density, row class, the hide
 * toggles, tile box props, and the Command buttons drill-in. Every gesture is
 * ONE undoable mutation; the panel is body-owned (the view card re-renders on
 * every 'document' emit and would destroy an inline panel), redraws in place
 * on document changes, and closes on Escape / outside pointerdown / surface
 * switches.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { openViewKebab, closeViewKebab } from './viewKebab';
import { state } from './state';
import { rowDensityOf } from './areas';
import { readCommandState, COMMAND_BUTTONS, COMMAND_PRESETS } from '../core/commandBar';

const undoDepth = (): number => (state as unknown as { undoStack: string[] }).undoStack.length;

function openOnRowView(viewExtras?: Record<string, unknown>): HTMLElement {
  state.createView({ kind: 'row', root: { elmType: 'div', children: [] }, ...(viewExtras ? { viewExtras } : {}) });
  const anchor = document.createElement('button');
  document.body.appendChild(anchor);
  openViewKebab(anchor, () => {});
  return document.body.querySelector('.wb-viewkebab') as HTMLElement;
}

beforeEach(() => {
  document.body.innerHTML = '';
  state.resetAll();
});

afterEach(() => closeViewKebab());

describe('panel mechanics', () => {
  it('mounts once on body with the Escape-owner marker; same anchor toggles, another anchor replaces', () => {
    const panel = openOnRowView();
    expect(panel).toBeTruthy();
    expect(panel.classList.contains('wb-esc-owner')).toBe(true);
    const anchor = document.body.querySelector('button')!;
    // a second click on the same ⋮ toggles the panel shut…
    openViewKebab(anchor as HTMLElement, () => {});
    expect(document.body.querySelectorAll('.wb-viewkebab').length).toBe(0);
    // …and opening from another anchor never stacks panels
    openViewKebab(anchor as HTMLElement, () => {});
    const other = document.createElement('button');
    document.body.appendChild(other);
    openViewKebab(other, () => {});
    expect(document.body.querySelectorAll('.wb-viewkebab').length).toBe(1);
  });

  it('Escape closes; a surface switch closes', () => {
    openOnRowView();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(document.body.querySelector('.wb-viewkebab')).toBeNull();

    openViewKebab(document.body.querySelector('button')!, () => {});
    expect(document.body.querySelector('.wb-viewkebab')).toBeTruthy();
    state.minimizeView(); // back to the grid — the panel's view is gone
    expect(document.body.querySelector('.wb-viewkebab')).toBeNull();
  });

  it('Ctrl+Z of a panel gesture keeps the panel open on the same tab (redraw, not close)', () => {
    const panel = openOnRowView();
    [...panel.querySelectorAll<HTMLButtonElement>('[data-prop="hideSelection"] .wb-viewcard-segbtn')]
      .find((b) => b.textContent === 'Hide')!.click();
    expect(state.doc.hideSelection).toBe(true);
    state.undo(); // same tab — an undo of the panel's own gesture
    const after = document.body.querySelector('.wb-viewkebab');
    expect(after).toBeTruthy();
    expect(state.doc.hideSelection).toBeUndefined();
    // and the seg redrew back to Show
    const show = [...after!.querySelectorAll<HTMLButtonElement>('[data-prop="hideSelection"] .wb-viewcard-segbtn')]
      .find((b) => b.textContent === 'Show')!;
    expect(show.classList.contains('active')).toBe(true);
  });

  it('a row⇄tile flip keeps the panel open and swaps the kind-gated rows', () => {
    const panel = openOnRowView();
    expect(panel.querySelector('[data-prop="hideColumnHeader"]')).toBeTruthy();
    state.setKind('tile');
    const after = document.body.querySelector('.wb-viewkebab')!;
    expect(after).toBeTruthy();
    expect(after.querySelector('[data-prop="hideColumnHeader"]')).toBeNull();
    expect(after.querySelector('[data-prop="tileWidth"] input')).toBeTruthy();
  });
});

describe('main mode — the view-scoped settings', () => {
  it('density rides the panel: one click, one undo step, seg redraws in place', () => {
    const panel = openOnRowView();
    const seg = panel.querySelector('[data-prop="density"]')!;
    const compact = [...seg.querySelectorAll<HTMLButtonElement>('.wb-viewcard-segbtn')]
      .find((b) => b.textContent === 'Compact')!;
    const d = undoDepth();
    compact.click();
    expect(rowDensityOf(state.doc.root)).toBe('compact');
    expect(undoDepth()).toBe(d + 1);
    // the panel survived its own mutation and reflects the new state
    const after = document.body.querySelector('.wb-viewkebab [data-prop="density"] .active');
    expect(after?.textContent).toBe('Compact');
  });

  it('row class commits from the panel (one mutation, empty clears clean)', () => {
    const panel = openOnRowView();
    const inp = panel.querySelector('.wb-viewcard-rowclass') as HTMLInputElement;
    const d = undoDepth();
    inp.value = 'sp-zebra';
    inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(state.doc.viewExtras?.additionalRowClass).toBe('sp-zebra');
    expect(undoDepth()).toBe(d + 1);
    // clearing deletes the key AND the now-empty viewExtras (clean export)
    const inp2 = document.body.querySelector('.wb-viewkebab .wb-viewcard-rowclass') as HTMLInputElement;
    inp2.value = '';
    inp2.dispatchEvent(new Event('blur'));
    expect(state.doc.viewExtras).toBeUndefined();
    expect(undoDepth()).toBe(d + 2);
  });

  it('a no-op row-class commit pushes NO undo step', () => {
    const panel = openOnRowView();
    const d = undoDepth();
    const inp = panel.querySelector('.wb-viewcard-rowclass') as HTMLInputElement;
    inp.dispatchEvent(new Event('blur')); // '' → '' — nothing changed
    expect(undoDepth()).toBe(d);
  });

  it('other viewExtras keys survive a row-class clear (carried verbatim — the import contract)', () => {
    const panel = openOnRowView({ additionalRowClass: 'x', hideListHeader: true });
    const inp = panel.querySelector('.wb-viewcard-rowclass') as HTMLInputElement;
    expect(inp.value).toBe('x');
    inp.value = '';
    inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(state.doc.viewExtras).toEqual({ hideListHeader: true });
  });

  it('Selection boxes: Hide sets true, Show removes the prop entirely (clean export)', () => {
    const panel = openOnRowView();
    const row = panel.querySelector('[data-prop="hideSelection"]')!;
    const btn = (label: string) => [...row.querySelectorAll<HTMLButtonElement>('.wb-viewcard-segbtn')]
      .find((b) => b.textContent === label)!;
    const d = undoDepth();
    btn('Hide').click();
    expect(state.doc.hideSelection).toBe(true);
    expect(undoDepth()).toBe(d + 1);
    // redraw kept the panel; flip back → prop leaves the doc, not `false` residue
    const rowAfter = document.body.querySelector('.wb-viewkebab [data-prop="hideSelection"]')!;
    [...rowAfter.querySelectorAll<HTMLButtonElement>('.wb-viewcard-segbtn')]
      .find((b) => b.textContent === 'Show')!.click();
    expect(state.doc.hideSelection).toBeUndefined();
    expect(undoDepth()).toBe(d + 2);
  });

  it('List header rides viewExtras and cleans up after itself', () => {
    const panel = openOnRowView();
    const hide = [...panel.querySelectorAll<HTMLButtonElement>('[data-prop="hideListHeader"] .wb-viewcard-segbtn')]
      .find((b) => b.textContent === 'Hide')!;
    hide.click();
    expect(state.doc.viewExtras?.hideListHeader).toBe(true);
    [...document.body.querySelectorAll<HTMLButtonElement>('.wb-viewkebab [data-prop="hideListHeader"] .wb-viewcard-segbtn')]
      .find((b) => b.textContent === 'Show')!.click();
    expect(state.doc.viewExtras).toBeUndefined();
  });

  it('kind gating: a row view shows column-header toggle, no tile rows; a tile view the reverse', () => {
    const panel = openOnRowView();
    expect(panel.querySelector('[data-prop="hideColumnHeader"]')).toBeTruthy();
    expect(panel.querySelector('[data-prop="tileWidth"]')).toBeNull();
    closeViewKebab();
    state.resetAll();
    state.createView({ kind: 'tile', root: { elmType: 'div', children: [] } });
    const anchor = document.createElement('button');
    document.body.appendChild(anchor);
    openViewKebab(anchor, () => {});
    const tilePanel = document.body.querySelector('.wb-viewkebab')!;
    expect(tilePanel.querySelector('[data-prop="hideColumnHeader"]')).toBeNull();
    expect(tilePanel.querySelector('[data-prop="hideListHeader"]')).toBeNull();
    expect(tilePanel.querySelector('[data-prop="tileWidth"] input')).toBeTruthy();
    expect(tilePanel.querySelector('[data-prop="fillHorizontally"]')).toBeTruthy();
  });

  it('tile width commits as one mutation', () => {
    state.createView({ kind: 'tile', root: { elmType: 'div', children: [] } });
    const anchor = document.createElement('button');
    document.body.appendChild(anchor);
    openViewKebab(anchor, () => {});
    const inp = document.body.querySelector('.wb-viewkebab [data-prop="tileWidth"] input') as HTMLInputElement;
    const d = undoDepth();
    inp.value = '300';
    inp.dispatchEvent(new Event('change'));
    expect(state.doc.tileWidth).toBe(300);
    expect(undoDepth()).toBe(d + 1);
  });
});

describe('the Command buttons drill-in', () => {
  it('the row badges the hidden count and drills into presets + five groups', () => {
    const panel = openOnRowView({
      commandBarProps: { commands: [{ key: 'new', hide: true }] },
    });
    const row = panel.querySelector('.wb-viewkebab-commands') as HTMLButtonElement;
    expect(row.querySelector('.wb-viewkebab-count')?.textContent).toContain('1');
    row.click();
    const drill = document.body.querySelector('.wb-viewkebab')!;
    expect(drill.querySelectorAll('.wb-viewkebab-preset').length).toBe(COMMAND_PRESETS.length);
    expect(drill.querySelectorAll('.wb-viewkebab-group').length).toBe(5);
    expect(drill.querySelectorAll('.wb-viewkebab-cmd').length).toBe(COMMAND_BUTTONS.length);
    // back returns to main mode
    (drill.querySelector('.wb-viewkebab-back') as HTMLButtonElement).click();
    expect(document.body.querySelector('.wb-viewkebab [data-prop="density"]')).toBeTruthy();
  });

  it('a row toggle is one undo step and stays in the drill-in; aria-pressed = hidden', () => {
    const panel = openOnRowView();
    (panel.querySelector('.wb-viewkebab-commands') as HTMLButtonElement).click();
    const cmd = document.body.querySelector('.wb-viewkebab-cmd[data-cmd="editInGridView"]') as HTMLButtonElement;
    expect(cmd.getAttribute('aria-pressed')).toBe('false');
    const d = undoDepth();
    cmd.click();
    expect(undoDepth()).toBe(d + 1);
    expect(readCommandState(state.doc.viewExtras).hidden.has('editInGridView')).toBe(true);
    const after = document.body.querySelector('.wb-viewkebab-cmd[data-cmd="editInGridView"]')!;
    expect(after.getAttribute('aria-pressed')).toBe('true');
    // still in the drill-in after the redraw
    expect(document.body.querySelector('.wb-viewkebab-preset')).toBeTruthy();
  });

  it('a preset is ONE undo step; Ctrl+Z restores the prior set wholesale', () => {
    const panel = openOnRowView();
    (panel.querySelector('.wb-viewkebab-commands') as HTMLButtonElement).click();
    const d = undoDepth();
    (document.body.querySelector('.wb-viewkebab-preset[data-preset="entryOnly"]') as HTMLButtonElement).click();
    expect(undoDepth()).toBe(d + 1);
    const state1 = readCommandState(state.doc.viewExtras);
    expect(state1.hidden.has('share')).toBe(true);
    expect(state1.hidden.has('new')).toBe(false);
    state.undo();
    expect(readCommandState(state.doc.viewExtras).hidden.size).toBe(0);
  });

  it('a formula-driven hide shows the 𝑓x marker instead of a plain state', () => {
    const panel = openOnRowView({
      commandBarProps: { commands: [{ key: 'share', hide: "=if([$A]=='x',true,false)" }] },
    });
    (panel.querySelector('.wb-viewkebab-commands') as HTMLButtonElement).click();
    const cmd = document.body.querySelector('.wb-viewkebab-cmd[data-cmd="share"]')!;
    expect(cmd.querySelector('.wb-viewkebab-fx')).toBeTruthy();
  });
});
