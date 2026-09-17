/**
 * jsonFind.dom.test.ts — find and replace in the JSON pane (issue #321).
 * Ctrl+F opens the bar (Ctrl+H with the replace field focused); matches are
 * case-insensitive plain text, painted through the squiggle layer, walked
 * with Enter / Shift+Enter (wrapping); Esc closes. Replace splices the
 * current match, Replace all every match in one edit — both mark the
 * buffer dirty like typing does.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mountJsonPanel } from './jsonPanel';
import { state } from './state';

afterEach(() => { document.body.innerHTML = ''; state.resetAll(); });
beforeEach(() => { state.resetAll(); });

function mountPanel() {
  const host = document.createElement('div');
  document.body.appendChild(host);
  mountJsonPanel(host, () => {});
  const $ = <T extends HTMLElement>(sel: string): T => host.querySelector<T>(sel)!;
  return {
    host,
    textEl: $<HTMLTextAreaElement>('#wb-json-text'),
    shell: $('#wb-json-shell'),
    bar: $('#wb-json-find'),
    q: $<HTMLInputElement>('#wb-json-find-q'),
    r: $<HTMLInputElement>('#wb-json-find-r'),
    count: $('#wb-json-find-count'),
  };
}
const type = (ta: HTMLTextAreaElement, text: string): void => {
  ta.value = text;
  ta.dispatchEvent(new Event('input', { bubbles: true }));
};
const key = (el: HTMLElement, k: string, extra: KeyboardEventInit = {}): void => {
  el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...extra }));
};
const selected = (ta: HTMLTextAreaElement): string => ta.value.slice(ta.selectionStart, ta.selectionEnd);

describe('find (Ctrl+F)', () => {
  it('opens the bar, counts case-insensitively, paints matches, and Enter / Shift+Enter walk them with wrap', () => {
    const { host, textEl, bar, q, count } = mountPanel();
    type(textEl, '{"elmType":"div","txtContent":"Alpha alpha ALPHA"}');
    expect(bar.hidden).toBe(true);
    key(textEl, 'f', { ctrlKey: true });
    expect(bar.hidden).toBe(false);
    q.value = 'alpha';
    q.dispatchEvent(new Event('input', { bubbles: true }));
    expect(count.textContent).toBe('1 of 3');
    expect(host.querySelectorAll('.wb-json-sq .wb-sq-find').length).toBe(2);
    expect(host.querySelectorAll('.wb-json-sq .wb-sq-find-cur').length).toBe(1);
    expect(selected(textEl)).toBe('Alpha');
    key(q, 'Enter');
    expect(count.textContent).toBe('2 of 3');
    expect(selected(textEl)).toBe('alpha');
    key(q, 'Enter');
    key(q, 'Enter');
    expect(count.textContent).toBe('1 of 3'); // wrapped
    key(q, 'Enter', { shiftKey: true });
    expect(count.textContent).toBe('3 of 3');
    expect(selected(textEl)).toBe('ALPHA');
    key(q, 'Escape');
    expect(bar.hidden).toBe(true);
    expect(host.querySelectorAll('.wb-json-sq .wb-sq-find, .wb-json-sq .wb-sq-find-cur').length).toBe(0);
  });

  it('says so when nothing matches and the squiggle layer stays lossless', () => {
    const { host, textEl, q, count } = mountPanel();
    type(textEl, '{"elmType":"div"}');
    key(textEl, 'f', { ctrlKey: true });
    q.value = 'zzz';
    q.dispatchEvent(new Event('input', { bubbles: true }));
    expect(count.textContent).toBe('No matches');
    const sq = host.querySelector('.wb-json-sq code')!;
    expect(sq.textContent!.replace(/ $/, '')).toBe(textEl.value);
  });
});

describe('replace', () => {
  it('replaces the current match, then every remaining match at once, marking the buffer dirty', () => {
    const { host, textEl, shell, q, r, count } = mountPanel();
    type(textEl, '{"elmType":"div","txtContent":"a-b-a"}');
    // a clean buffer first: regenerate from the doc so dirty starts false
    key(textEl, 'f', { ctrlKey: true });
    q.value = 'a';
    q.dispatchEvent(new Event('input', { bubbles: true }));
    expect(count.textContent).toBe('1 of 2');
    r.value = 'x';
    host.querySelector<HTMLButtonElement>('#wb-json-find-replace')!.click();
    expect(textEl.value).toContain('"x-b-a"');
    expect(count.textContent).toBe('1 of 1');
    expect(shell.classList.contains('wb-json-dirty')).toBe(true);
    host.querySelector<HTMLButtonElement>('#wb-json-find-all')!.click();
    expect(textEl.value).toContain('"x-b-x"');
    expect(count.textContent).toBe('No matches');
  });

  it('Ctrl+H opens the bar with the replace field focused', () => {
    const { textEl, bar, r } = mountPanel();
    key(textEl, 'h', { ctrlKey: true });
    expect(bar.hidden).toBe(false);
    expect(document.activeElement).toBe(r);
  });
});
