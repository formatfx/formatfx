/**
 * The Left Edit Pane container (happy-dom) — COLUMNS-COMPONENTS-VIEWS §3
 * (Phase C): the pane is nav row → this-view card → structure tree →
 * splitter → columns shelf → components library → views list → lens tabs →
 * draw toolbar → inspector/code. The formatter tablist, the document pill
 * and the view strip are GONE — the canvas tab strip is the one navigation
 * surface; the library is mounted always (no swap mode).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mountLeftPane } from './leftPane';
import { state } from './state';

function mount(toasts: string[] = []): HTMLElement {
  const host = document.createElement('div');
  document.body.appendChild(host);
  mountLeftPane(host, { toast: (m) => toasts.push(m) });
  return host;
}

beforeEach(() => {
  document.body.innerHTML = '';
  localStorage.clear();
  state.resetAll();
  state.setLens('pro');
});

afterEach(() => {
  // the pane's _unsub tears down its own and every child mount's subscription
  document.querySelectorAll<HTMLElement>('body > *').forEach((el) => {
    (el as unknown as { _unsub?: () => void })._unsub?.();
    el.remove();
  });
});

describe('structure (§3, top to bottom)', () => {
  it('keeps the nav row (back + snapshots) and buries the old chrome', () => {
    const host = mount();
    expect(host.querySelector('#wb-nav-back')).not.toBeNull();
    expect(host.querySelector('#wb-snap-btn')).not.toBeNull();
    // the dead chrome: no formatter tablist, no document pill, no view strip
    expect(host.querySelector('.wb-fmt-tablist')).toBeNull();
    expect(host.querySelector('.wb-fmt-tab')).toBeNull();
    expect(host.querySelector('.wb-doc-pill')).toBeNull();
    expect(host.querySelector('#wb-viewstrip')).toBeNull();
    expect(host.textContent).not.toContain('§');
  });

  it('mounts every section in §3 order: card, tree, splitter, shelf, library, views', () => {
    const host = mount();
    const ids = [...host.children].map((el) => el.id || el.className.split(' ')[0]);
    expect(ids).toEqual([
      'wb-lp-nav', 'wb-lp-viewcard', 'wb-lp-tree', 'wb-lp-splitter',
      'wb-lp-shelves', 'wb-lp-header', 'wb-drawbar', 'wb-lp-props',
    ]);
    const shelves = host.querySelector('#wb-lp-shelves')!;
    expect([...shelves.children].map((el) => el.id))
      .toEqual(['wb-lp-shelf', 'wb-lp-library', 'wb-lp-views']);
  });

  it('the tree renders the active surface; the library is ALWAYS mounted (no swap mode)', () => {
    const host = mount();
    // the grid's columns render as tree rows
    expect(host.querySelectorAll('#wb-tree-body .wb-tree-row').length).toBeGreaterThan(0);
    // the library is populated and visible right away — no tab to click first
    const lib = host.querySelector<HTMLElement>('#wb-lp-library')!;
    expect(lib.hidden).toBe(false);
    expect(lib.querySelectorAll('.wb-comp-row').length).toBeGreaterThan(0);
    expect(host.classList.contains('wb-lp-library-open')).toBe(false);
    // shelf chips and the views list are standing sections too
    expect(host.querySelectorAll('#wb-lp-shelf .wb-colchip').length).toBeGreaterThan(0);
    expect(host.querySelector('#wb-lp-views .wb-viewslist-head')).not.toBeNull();
  });

  it('the this-view card hides on the grid and shows on a view', () => {
    const host = mount();
    const card = host.querySelector<HTMLElement>('#wb-lp-viewcard')!;
    expect(card.hidden).toBe(true);
    state.createView({ kind: 'row', root: { elmType: 'div', children: [] } }, 'Board');
    expect(card.hidden).toBe(false);
    expect(card.querySelector('.wb-viewcard-name')?.textContent).toBe('Board');
  });
});

describe('the kept workspace (lens tabs · draw toolbar · back)', () => {
  it('lens tabs switch the lens and mark the pane', () => {
    const host = mount();
    const codeTab = [...host.querySelectorAll<HTMLButtonElement>('.wb-lens-tab')]
      .find((b) => b.dataset.lens === 'code')!;
    codeTab.click();
    expect(state.activeLens).toBe('code');
    expect(host.classList.contains('wb-lens-code')).toBe(true);
    expect(codeTab.getAttribute('aria-selected')).toBe('true');
  });

  it('the draw toolbar inserts (one undo step) and its undo/redo track the stack', () => {
    const host = mount();
    const undoBtn = host.querySelector<HTMLButtonElement>('.wb-tool-undo')!;
    expect(undoBtn.disabled).toBe(true);
    host.querySelector<HTMLButtonElement>('.wb-tool[data-tool="text"]')!.click();
    const kids = state.doc.root.children!;
    expect(kids[kids.length - 1]._elmName).toBe('Text');
    expect(undoBtn.disabled).toBe(false);
  });

  it('back retraces surface switches (navigation, not undo)', () => {
    const host = mount();
    const back = host.querySelector<HTMLButtonElement>('#wb-nav-back')!;
    expect(back.disabled).toBe(true);
    state.createView({ kind: 'row', root: { elmType: 'div', children: [] } });
    expect(back.disabled).toBe(false);
    back.click();
    expect(state.onFloor).toBe(true);
  });

  it('the splitter for the tree region survives the rebuild', () => {
    const host = mount();
    expect(host.querySelector('#wb-lp-splitter')).not.toBeNull();
    expect(host.querySelector('#wb-lp-tree')).not.toBeNull();
  });
});
