/**
 * #218 split-view sync DOM contracts — the JSON pane beside the canvas:
 *   · code → canvas: a caret landing in an element's JSON selects it and the
 *     canvas shows the EXISTING .wb-selected highlight (no parallel system);
 *   · canvas → code: a visual edit refreshes the text in place, preserving
 *     the caret; a canvas selection flashes the element's lines WITHOUT
 *     moving the caret;
 *   · the echo guard: code-originated selection never flashes/scrolls the
 *     pane it came from, and sync never creates undo entries.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mountJsonPanel } from './jsonPanel';
import { mountCanvas } from './canvas';
import { state } from './state';
import { exportJson } from '../core/serializer';
import { exportJsonWithMap, rangeForPath } from '../core/jsonMap';
import { lineSpanOf } from './codeSync';

// Same teardown discipline as canvas.test.ts: hosts carry _unsub hooks for
// their document-level listeners — tear them down so nothing leaks across tests.
afterEach(() => {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  document.querySelectorAll<HTMLElement>('body > *').forEach((el) => {
    (el as unknown as { _unsub?: () => void })._unsub?.();
    el.remove();
  });
  state.resetAll();
});

beforeEach(() => {
  state.resetAll();
});

function mountBoth() {
  const canvasHost = document.createElement('div');
  document.body.appendChild(canvasHost);
  mountCanvas(canvasHost, () => {});
  const panelHost = document.createElement('div');
  document.body.appendChild(panelHost);
  mountJsonPanel(panelHost, () => {});
  const textEl = panelHost.querySelector('#wb-json-text') as HTMLTextAreaElement;
  return { canvasHost, panelHost, textEl };
}

/** The panel's own map (same doc, same options as its regenerate). */
function panelMap() {
  return exportJsonWithMap(state.doc, { sanitizeWhitespace: true, keepMeta: true });
}

describe('code → canvas', () => {
  it('a caret click inside an element\'s JSON selects it and highlights it on the canvas', () => {
    const { canvasHost, textEl } = mountBoth();
    const { ranges } = panelMap();
    const r = rangeForPath(ranges, [0])!;
    textEl.setSelectionRange(r.start + 1, r.start + 1);
    textEl.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(state.selection).toEqual([0]);
    // the EXISTING canvas highlight, not a parallel one
    const hit = canvasHost.querySelector('[data-sp-path="0"]');
    expect(hit).not.toBeNull();
    expect(hit!.classList.contains('wb-selected')).toBe(true);
  });

  it('keyboard caret movement (keyup) syncs too, and re-clicking the same element is a no-op', () => {
    const { textEl } = mountBoth();
    const { ranges } = panelMap();
    const r1 = rangeForPath(ranges, [1])!;
    textEl.setSelectionRange(r1.start + 1, r1.start + 1);
    textEl.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowDown', bubbles: true }));
    expect(state.selection).toEqual([1]);

    let selectionEvents = 0;
    const unsub = state.subscribe((reason) => { if (reason === 'selection') selectionEvents++; });
    textEl.dispatchEvent(new MouseEvent('click', { bubbles: true })); // same caret, same element
    unsub();
    expect(selectionEvents).toBe(0); // no churn, no echo risk
  });

  it('a caret on wrapper chrome (the $schema line of a view doc) selects nothing', () => {
    const { textEl } = mountBoth();
    state.select([1]);
    textEl.setSelectionRange(2, 2); // inside the "$schema" line of the row wrapper
    textEl.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(state.selection).toEqual([1]); // unchanged
  });

  it('a dirty (hand-edited) buffer suspends caret sync — stale offsets never mis-select', () => {
    const { textEl } = mountBoth();
    const { ranges } = panelMap();
    textEl.dispatchEvent(new Event('input', { bubbles: true })); // user starts editing
    const r = rangeForPath(ranges, [0])!;
    textEl.setSelectionRange(r.start + 1, r.start + 1);
    textEl.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(state.selection).toEqual([]); // still the root default — untouched
  });
});

describe('canvas → code', () => {
  it('a canvas click flashes the element\'s lines in the JSON without moving the caret', () => {
    const { canvasHost, panelHost, textEl } = mountBoth();
    textEl.setSelectionRange(4, 4);
    const { text, ranges } = panelMap();

    const target = canvasHost.querySelector('[data-sp-path="1"]') as HTMLElement;
    expect(target).not.toBeNull();
    target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(state.selection).toEqual([1]);

    const bar = panelHost.querySelector('.wb-code-flashbar') as HTMLElement;
    expect(bar).not.toBeNull();
    const r = rangeForPath(ranges, [1])!;
    const { first, last } = lineSpanOf(text, r.start, r.end);
    expect(bar.dataset.lines).toBe(`${first + 1}-${last + 1}`);
    expect(textEl.selectionStart).toBe(4); // reading position is sacred
  });

  it('a visual document edit refreshes the JSON in place, preserving the caret (and adds no sync undo entries)', () => {
    const { textEl } = mountBoth();
    const before = textEl.value;
    textEl.setSelectionRange(2, 2); // in the common prefix (the opening brace line)
    expect(state.canUndo).toBe(false);

    state.mutateDocument(() => {
      const node = state.nodeAt([0])!;
      node.style = { ...(node.style ?? {}), 'background-color': '#ffeecc' };
    });

    expect(textEl.value).toBe(exportJson(state.doc, { sanitizeWhitespace: true, keepMeta: true }));
    expect(textEl.value).not.toBe(before);
    expect(textEl.selectionStart).toBe(2); // untouched — the edit is later in the text

    // exactly ONE undo entry (the gesture) — the view sync added none
    state.undo();
    expect(state.canUndo).toBe(false);
    expect(textEl.value).toBe(before); // and the refresh round-trips back
  });

  it('a caret after the changed region shifts by the length delta', () => {
    const { textEl } = mountBoth();
    const endBefore = textEl.value.length;
    textEl.setSelectionRange(endBefore, endBefore);
    state.mutateDocument(() => {
      const node = state.nodeAt([0])!;
      node.style = { ...(node.style ?? {}), color: '#123456' };
    });
    expect(textEl.selectionStart).toBe(textEl.value.length); // still at the very end
  });
});

describe('the echo guard', () => {
  it('code-originated selection does NOT flash/scroll the pane it came from', () => {
    const { panelHost, textEl } = mountBoth();
    const { ranges } = panelMap();
    const r = rangeForPath(ranges, [2])!;
    textEl.setSelectionRange(r.start + 1, r.start + 1);
    textEl.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(state.selection).toEqual([2]); // the selection DID sync out…
    expect(panelHost.querySelector('.wb-code-flashbar')).toBeNull(); // …but never bounced back
    expect(textEl.selectionStart).toBe(r.start + 1); // caret exactly where the user put it
  });

  it('an out-of-band selection (tree, lint row) still reveals in the code pane', () => {
    const { panelHost } = mountBoth();
    state.select([1]); // what a lint-row jump or tree click does
    expect(panelHost.querySelector('.wb-code-flashbar')).not.toBeNull();
  });
});
