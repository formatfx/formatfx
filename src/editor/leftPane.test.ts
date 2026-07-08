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
      'wb-lp-shelves', 'wb-drawbar', 'wb-lp-props',
    ]);
    const shelves = host.querySelector('#wb-lp-shelves')!;
    // columns + components are now collapsible sections wrapping their mounts;
    // the views list is a plain (non-collapsible) sibling
    expect([...shelves.children].map((el) => (el as HTMLElement).dataset.sec ?? el.id))
      .toEqual(['columns', 'components', 'wb-lp-views']);
    expect(shelves.querySelector('.wb-lp-sec[data-sec="columns"] #wb-lp-shelf')).not.toBeNull();
    expect(shelves.querySelector('.wb-lp-sec[data-sec="components"] #wb-lp-library')).not.toBeNull();
    // the inspector is a collapsible section down in the props region
    expect(host.querySelector('.wb-lp-props .wb-lp-sec[data-sec="inspector"] #wb-lp-inspector')).not.toBeNull();
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

describe('collapsible sections (issue #236: Columns · Components · Inspector)', () => {
  const sec = (host: HTMLElement, id: string) =>
    host.querySelector<HTMLElement>(`.wb-lp-sec[data-sec="${id}"]`)!;
  const head = (host: HTMLElement, id: string) =>
    host.querySelector<HTMLButtonElement>(`.wb-lp-sec-head[data-sec-head="${id}"]`)!;

  it('mounts all three sections expanded by default, each with a header button', () => {
    const host = mount();
    for (const id of ['columns', 'components', 'inspector']) {
      expect(sec(host, id)).not.toBeNull();
      const h = head(host, id);
      expect(h).not.toBeNull();
      expect(h.getAttribute('aria-controls')).toBe(`wb-lp-${id === 'columns' ? 'shelf' : id === 'components' ? 'library' : 'inspector'}`);
      expect(sec(host, id).classList.contains('wb-collapsed')).toBe(false);
      expect(h.getAttribute('aria-expanded')).toBe('true');
    }
  });

  it('clicking a header folds the section (class + aria) and clicking again restores it', () => {
    const host = mount();
    const h = head(host, 'components');
    h.click();
    expect(sec(host, 'components').classList.contains('wb-collapsed')).toBe(true);
    expect(h.getAttribute('aria-expanded')).toBe('false');
    // the other sections are unaffected — collapse is per-section
    expect(sec(host, 'columns').classList.contains('wb-collapsed')).toBe(false);
    h.click();
    expect(sec(host, 'components').classList.contains('wb-collapsed')).toBe(false);
    expect(h.getAttribute('aria-expanded')).toBe('true');
  });

  it('persists the collapsed state across a remount (a reload)', () => {
    const host = mount();
    head(host, 'inspector').click();
    expect(sec(host, 'inspector').classList.contains('wb-collapsed')).toBe(true);
    // tear down and rebuild the pane as a reloaded session would
    (host as unknown as { _unsub?: () => void })._unsub?.();
    const host2 = mount();
    expect(sec(host2, 'inspector').classList.contains('wb-collapsed')).toBe(true);
    expect(head(host2, 'inspector').getAttribute('aria-expanded')).toBe('false');
    // the sections left alone come back expanded
    expect(sec(host2, 'columns').classList.contains('wb-collapsed')).toBe(false);
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
