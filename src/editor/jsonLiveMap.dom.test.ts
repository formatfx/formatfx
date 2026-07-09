/**
 * jsonLiveMap.dom.test.ts — PR D wiring contracts (spec 2026-07-09 §4–5 + §6's
 * breadcrumb), mounted through the real jsonPanel:
 *   · while dirty, a per-frame-debounced tolerant parse keeps a WORKING map:
 *     squiggles are char-precise and live ("where's the missing comma"),
 *     the scope bar and breadcrumb keep tracking the hand-edited buffer;
 *   · lint issues underline the element's OPENING line only (the footer stays
 *     the detail view);
 *   · hover cards explain decorations and tokens, and hide on input;
 *   · lint footer rows flash the lines they point at even on a dirty buffer;
 *   · the squiggle layer carries the buffer text verbatim (alignment).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mountJsonPanel } from './jsonPanel';
import { state } from './state';
import { exportJsonWithMap, rangeForPath } from '../core/jsonMap';

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

function mountPanel() {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const api = mountJsonPanel(host, () => {});
  const shell = host.querySelector('#wb-json-shell') as HTMLDivElement;
  const textEl = host.querySelector('#wb-json-text') as HTMLTextAreaElement;
  return { host, shell, textEl, api };
}

/** Put `text` in the buffer with the caret at `caret`, as if typed. */
function type(textEl: HTMLTextAreaElement, text: string, caret: number): void {
  textEl.value = text;
  textEl.setSelectionRange(caret, caret);
  textEl.dispatchEvent(new Event('input', { bubbles: true }));
}

/** Wait (real timers — debounces are a frame, hovers 150 ms) for a condition. */
async function until(fn: () => boolean, ms = 1500): Promise<void> {
  const t0 = Date.now();
  while (!fn()) {
    if (Date.now() - t0 > ms) throw new Error('until(): condition never held');
    await new Promise((r) => setTimeout(r, 10));
  }
}

/** The panel's own map (same doc, same options as its regenerate). */
function panelMap() {
  return exportJsonWithMap(state.doc, { sanitizeWhitespace: true, keepMeta: true });
}

/** Hover the pointer over line/col using the test-DOM fallback metrics
 *  (charW 6.6, lineHeight 16, padding 8, gutter+pad 60 — geometry is
 *  arithmetic in the monospace box, so the math IS the contract). */
function hoverAtColLine(textEl: HTMLTextAreaElement, line: number, col: number): void {
  textEl.dispatchEvent(new MouseEvent('mousemove', {
    bubbles: true,
    clientX: 60 + col * 6.6 + 3,
    clientY: 8 + line * 16 + 4,
  }));
}

describe('live squiggles while dirty', () => {
  it('a missing comma grows a char-precise error squiggle within a frame, and it clears when the buffer parses again', async () => {
    const { shell, textEl } = mountPanel();
    const bad = '{"elmType": "div" "txtContent": "hi"}';
    type(textEl, bad, bad.length);
    await until(() => shell.querySelector('.wb-json-sq .wb-sq-err') !== null);
    // the squiggle layer carries the buffer text VERBATIM — alignment invariant
    const sqCode = shell.querySelector('.wb-json-sq code')!;
    expect(sqCode.textContent!.replace(/ $/, '')).toBe(textEl.value);

    const good = '{"elmType": "div", "txtContent": "hi"}';
    type(textEl, good, good.length);
    await until(() => shell.querySelector('.wb-json-sq .wb-sq-err') === null);
  });

  it("lint issues underline the element's opening line only", async () => {
    const { shell, api } = mountPanel();
    state.mutateDocument(() => {
      const node = state.nodeAt([0])!;
      node.style = { ...(node.style ?? {}), 'not-a-real-prop': '1' };
    });
    api.refreshLint([]);
    const warn = shell.querySelector('.wb-json-sq .wb-sq-warning');
    expect(warn).not.toBeNull();
    expect(warn!.textContent).not.toContain('\n'); // one line, not the subtree
    // …and a clean parse means no error squiggles alongside it
    expect(shell.querySelector('.wb-json-sq .wb-sq-err')).toBeNull();
  });
});

describe('the scope bar on a dirty buffer', () => {
  it('returns within a frame of a hand edit, tracking the live map', async () => {
    const { shell, textEl } = mountPanel();
    const bar = shell.querySelector('.wb-json-scopebar') as HTMLElement;
    state.select([0]);
    expect(bar.hidden).toBe(false);

    // a hand edit ANYWHERE hides it at the keystroke (offsets are stale)…
    type(textEl, ` ${textEl.value}`, 1);
    expect(bar.hidden).toBe(true);
    // …and the debounced live parse brings it straight back
    await until(() => !bar.hidden);
  });
});

describe('hover cards', () => {
  it('hovering a squiggle explains the parse problem; typing hides the card', async () => {
    const { shell, textEl } = mountPanel();
    const bad = '{"elmType": "div" "txtContent": "hi"}';
    type(textEl, bad, bad.length);
    await until(() => shell.querySelector('.wb-json-sq .wb-sq-err') !== null);

    hoverAtColLine(textEl, 0, bad.indexOf('"txtContent"')); // the 1-char decoration
    const card = shell.querySelector('.wb-json-hover') as HTMLElement;
    await until(() => !card.hidden);
    expect(card.querySelector('.wb-hover-title')!.textContent).toBe('Problem');
    expect(card.querySelector('.wb-hover-body')!.textContent).toMatch(/','/);

    type(textEl, bad, bad.length); // any input hides the card
    expect(card.hidden).toBe(true);
  });

  it('hovering a field ref names the column and its type', async () => {
    const { shell, textEl } = mountPanel();
    const text = '{"elmType": "div", "txtContent": "=[$Status]"}';
    type(textEl, text, text.length);

    hoverAtColLine(textEl, 0, text.indexOf('[$Status]') + 2);
    const card = shell.querySelector('.wb-json-hover') as HTMLElement;
    await until(() => !card.hidden);
    expect(card.querySelector('.wb-hover-title')!.textContent).toBe('[$Status]');
    expect(card.querySelector('.wb-hover-body')!.textContent).toContain('choice');
  });
});

describe('the breadcrumb strip', () => {
  it("shows the caret's element chain; a crumb click selects without flashing the pane it came from", () => {
    const { host, textEl } = mountPanel();
    const crumbs = host.querySelector('#wb-json-crumbs') as HTMLElement;
    const { ranges } = panelMap();
    const r = rangeForPath(ranges, [1])!;
    textEl.setSelectionRange(r.start + 1, r.start + 1);
    textEl.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(crumbs.hidden).toBe(false);
    const parts = [...crumbs.querySelectorAll<HTMLButtonElement>('.wb-crumb')];
    expect(parts.length).toBe(2); // root › child
    const child = state.nodeAt([1])! as { _elmName?: string; elmType: string };
    expect(parts[1].textContent).toBe(child._elmName ?? child.elmType);

    parts[0].click(); // the root crumb
    expect(state.selection).toEqual([]);
    expect(host.querySelector('.wb-code-flashbar')).toBeNull(); // echo: never flashes itself
  });

  it('stays live on a dirty buffer, labelled from the BUFFER (the working map)', async () => {
    const { host, textEl } = mountPanel();
    const crumbs = host.querySelector('#wb-json-crumbs') as HTMLElement;
    const text = '{"elmType": "div", "children": [{"elmType": "span", "txtContent": "hi"}]}';
    const caret = text.indexOf('"hi"') + 1;
    type(textEl, text, caret);
    textEl.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowLeft', bubbles: true }));

    await until(() => !crumbs.hidden && crumbs.querySelectorAll('.wb-crumb').length === 2);
    const labels = [...crumbs.querySelectorAll('.wb-crumb')].map((b) => b.textContent);
    expect(labels).toEqual(['div', 'span']); // buffer truth, not doc labels
  });

  it('hides on wrapper chrome (the $schema line of a view doc)', () => {
    const { host, textEl } = mountPanel();
    const crumbs = host.querySelector('#wb-json-crumbs') as HTMLElement;
    textEl.setSelectionRange(2, 2);
    textEl.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(crumbs.hidden).toBe(true);
  });
});

describe('lint rows flash the lines they point at', () => {
  it('clicking a lint row on a DIRTY buffer flashes via the live map', async () => {
    const { host, textEl, api } = mountPanel();
    state.mutateDocument(() => {
      const node = state.nodeAt([0])!;
      node.style = { ...(node.style ?? {}), 'not-a-real-prop': '1' };
    });
    api.refreshLint([]);

    // dirty: revealSelection bails, so the row itself must flash the range —
    // via the LIVE map, which lands a frame after the keystroke (poll-click)
    type(textEl, ` ${textEl.value}`, 1);
    const row = host.querySelector('.wb-lint-item.wb-lint-warning') as HTMLElement;
    expect(row).not.toBeNull();
    await until(() => {
      row.click();
      return host.querySelector('.wb-code-flashbar') !== null;
    });
  });
});
