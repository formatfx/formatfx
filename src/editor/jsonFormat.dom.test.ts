/**
 * jsonFormat.dom.test.ts — wiring contracts for Format + typing assists:
 * the kebab command formats the buffer WITHOUT applying (stays dirty), and
 * keydown assists splice through the pane's dirty-marking path. Same
 * teardown discipline as jsonPanel.sync.test.ts.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mountJsonPanel } from './jsonPanel';
import { state } from './state';

afterEach(() => {
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
  const toasts: string[] = [];
  mountJsonPanel(host, (m) => toasts.push(m));
  const textEl = host.querySelector('#wb-json-text') as HTMLTextAreaElement;
  return { host, textEl, toasts };
}

describe('Format document', () => {
  it('the kebab has a Format button; formatting a hand-edited buffer keeps it dirty and does not touch the doc', () => {
    const { host, textEl } = mountPanel();
    const btn = host.querySelector('#wb-json-format') as HTMLButtonElement;
    expect(btn).not.toBeNull();

    const before = JSON.stringify(state.doc);
    textEl.value = '{"elmType":"div","txtContent":"hi"}'; // messy hand-edit
    textEl.dispatchEvent(new Event('input', { bubbles: true }));
    btn.click();

    expect(textEl.value).toContain('\n  "elmType": "div"'); // canonical 2-space
    expect(textEl.classList.contains('wb-json-dirty')).toBe(true); // NOT applied
    expect(JSON.stringify(state.doc)).toBe(before); // document untouched
  });

  it('a broken buffer re-indents and surfaces the parse error', () => {
    const { host, textEl } = mountPanel();
    textEl.value = '{\n"elmType": "div"\n"txtContent": "x"\n}'; // missing comma
    textEl.dispatchEvent(new Event('input', { bubbles: true }));
    (host.querySelector('#wb-json-format') as HTMLButtonElement).click();

    expect(textEl.value).toBe('{\n  "elmType": "div"\n  "txtContent": "x"\n}');
    const err = host.querySelector('#wb-json-import-error') as HTMLDivElement;
    expect(err.hidden).toBe(false);
    expect(err.textContent).toContain('Format is re-indent only');
  });

  it('formatting closes an open completion menu (its offsets die with the swap)', () => {
    const { textEl } = mountPanel();
    textEl.value = '{"elmType":"div" }';
    textEl.dispatchEvent(new Event('input', { bubbles: true }));
    const caret = textEl.value.length - 1; // bare key position before }
    textEl.setSelectionRange(caret, caret);
    textEl.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', ctrlKey: true, bubbles: true, cancelable: true }));
    expect(document.querySelector('.wb-fx-acmenu')).not.toBeNull(); // menu open

    textEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'F', altKey: true, shiftKey: true, bubbles: true, cancelable: true }));
    expect(textEl.value).toContain('\n  "elmType": "div"');
    expect(document.querySelector('.wb-fx-acmenu')).toBeNull(); // menu closed, not stale
  });

  it('Alt+Shift+F triggers the same command', () => {
    const { textEl } = mountPanel();
    textEl.value = '{"elmType":"div"}';
    textEl.dispatchEvent(new Event('input', { bubbles: true }));
    textEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'F', altKey: true, shiftKey: true, bubbles: true }));
    expect(textEl.value).toContain('\n  "elmType": "div"');
  });
});

describe('typing assists (wired)', () => {
  it('Enter after an opening brace splices an indented line through the dirty-marking path', () => {
    const { textEl } = mountPanel();
    textEl.value = '{\n  "style": {';
    textEl.dispatchEvent(new Event('input', { bubbles: true }));
    const caret = textEl.value.length;
    textEl.setSelectionRange(caret, caret);
    const e = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    textEl.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
    expect(textEl.value).toBe('{\n  "style": {\n    ');
    expect(textEl.selectionStart).toBe(textEl.value.length);
    expect(textEl.classList.contains('wb-json-dirty')).toBe(true);
  });

  it('quote skip-over moves the caret without editing', () => {
    const { textEl } = mountPanel();
    textEl.value = '{"a": "xy"}';
    textEl.dispatchEvent(new Event('input', { bubbles: true }));
    const caret = textEl.value.indexOf('xy') + 2;
    textEl.setSelectionRange(caret, caret);
    const before = textEl.value;
    const e = new KeyboardEvent('keydown', { key: '"', bubbles: true, cancelable: true });
    textEl.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
    expect(textEl.value).toBe(before);
    expect(textEl.selectionStart).toBe(caret + 1);
  });
});
