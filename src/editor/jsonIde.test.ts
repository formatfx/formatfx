/**
 * jsonIde.test.ts — DOM contracts for the IDE-style JSON pane (#244), mounted
 * through the real jsonPanel so the wiring is what's tested:
 *   · the highlight overlay mirrors the buffer (regenerate AND hand input);
 *   · the gutter counts lines and tracks the caret's line;
 *   · contextual completions open at the caret, accept splices the buffer and
 *     marks it dirty (the Apply flow stays the one document write);
 *   · Ctrl+Space opens bare-position menus that never auto-pop;
 *   · the signature chip reads the active =function( argument;
 *   · the selected element's scope bar hides during hand edits.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mountJsonPanel } from './jsonPanel';
import { state } from './state';

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
  mountJsonPanel(host, () => {});
  const shell = host.querySelector('#wb-json-shell') as HTMLDivElement;
  const textEl = host.querySelector('#wb-json-text') as HTMLTextAreaElement;
  return { host, shell, textEl };
}

/** Put `text` in the buffer with the caret at `caret`, as if typed. */
function type(textEl: HTMLTextAreaElement, text: string, caret: number): void {
  textEl.value = text;
  textEl.setSelectionRange(caret, caret);
  textEl.dispatchEvent(new Event('input', { bubbles: true }));
}

const menu = (): HTMLElement | null => document.querySelector('.wb-fx-acmenu');
const menuTexts = (): string[] =>
  [...document.querySelectorAll<HTMLElement>('.wb-fx-acmenu .wb-fx-acopt')]
    .map((b) => (b.querySelector('.wb-fx-ac-ins') ?? b).textContent ?? '');

describe('the highlight overlay', () => {
  it('paints the generated JSON with classed token spans on mount', () => {
    const { shell } = mountPanel();
    const code = shell.querySelector('.wb-json-hl code')!;
    expect(code.querySelector('.wb-tok-key')).not.toBeNull();
    expect(code.querySelector('.wb-tok-str')).not.toBeNull();
    // the overlay text mirrors the buffer byte for byte
    const textEl = shell.querySelector('#wb-json-text') as HTMLTextAreaElement;
    expect(code.textContent!.replace(/ $/, '')).toBe(textEl.value);
  });

  it('repaints on hand input, formula strings reading as expressions', () => {
    const { shell, textEl } = mountPanel();
    const text = '{"elmType": "div", "txtContent": "=@now"}';
    type(textEl, text, text.length);
    const code = shell.querySelector('.wb-json-hl code')!;
    expect(code.querySelector('.wb-tok-expr')!.textContent).toBe('"=@now"');
  });

  it('the gutter counts the buffer lines and marks the caret line active', () => {
    const { shell, textEl } = mountPanel();
    const lines = textEl.value.split('\n').length;
    expect(shell.querySelectorAll('.wb-json-ln')).toHaveLength(lines);
    // move the caret to line 3 (offset after two newlines) via a caret key
    const off = textEl.value.split('\n').slice(0, 2).join('\n').length + 2;
    textEl.setSelectionRange(off, off);
    textEl.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowDown', bubbles: true }));
    const active = shell.querySelector('.wb-json-ln.active')!;
    expect(active.textContent).toBe('3');
  });
});

describe('contextual completions', () => {
  it('typing inside an elmType value opens the menu; Enter accepts, splices and dirties', () => {
    const { host, textEl } = mountPanel();
    const text = '{"elmType": "s"}';
    type(textEl, text, text.indexOf('"s"') + 2);
    expect(menu()).not.toBeNull();
    expect(menuTexts()).toContain('span');

    textEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(textEl.value).toBe('{"elmType": "span"}');
    // an accepted completion is a hand edit: apply-pending, like typing
    expect(host.querySelector('#wb-json-apply')!.classList.contains('wb-json-apply-pending')).toBe(true);
    // the redundant single-item echo menu does not reopen
    expect(menu()).toBeNull();
  });

  it('style-map key strings offer the allow-list with docs', () => {
    const { textEl } = mountPanel();
    const text = '{"style": {"back"}}';
    type(textEl, text, text.indexOf('back') + 4);
    expect(menuTexts()[0]).toBe('background-color');
    const rich = document.querySelector('.wb-fx-acmenu .wb-fx-ac-doc');
    expect(rich).not.toBeNull();
  });

  it('expression strings offer engine tokens and column refs', () => {
    const { textEl } = mountPanel();
    const text = '{"txtContent": "=@cur"}';
    type(textEl, text, text.indexOf('@cur') + 4);
    expect(menuTexts()).toContain('@currentField');
  });

  it('bare positions stay quiet while typing but answer Ctrl+Space; Escape closes', () => {
    const { textEl } = mountPanel();
    const text = '{"children": [{}]}';
    type(textEl, text, text.indexOf('{}') + 1);
    expect(menu()).toBeNull(); // no auto-pop on bare structure

    textEl.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', ctrlKey: true, bubbles: true, cancelable: true }));
    expect(menu()).not.toBeNull();
    expect(menuTexts().some((t) => t.startsWith('"elmType"'))).toBe(true);

    textEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(menu()).toBeNull();
  });

  it('scaffold picks land the caret inside the scaffold and chain the next menu', () => {
    const { textEl } = mountPanel();
    const text = '{"children": [{}]}';
    const inner = text.indexOf('{}') + 1;
    type(textEl, text, inner);
    textEl.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', ctrlKey: true, bubbles: true, cancelable: true }));
    const pick = [...document.querySelectorAll<HTMLButtonElement>('.wb-fx-acmenu .wb-fx-acopt')]
      .find((b) => b.textContent!.includes('"elmType"'))!;
    pick.click();
    expect(textEl.value).toBe('{"children": [{"elmType": ""}]}');
    expect(textEl.selectionStart).toBe(textEl.value.indexOf('""') + 1); // between the quotes
    // …and the VALUE menu chains open right away
    expect(menuTexts()).toContain('div');
  });
});

describe('the signature chip', () => {
  it('names the active call and argument inside an = expression', () => {
    const { shell, textEl } = mountPanel();
    const text = '{"txtContent": "=if("}';
    type(textEl, text, text.indexOf('(') + 1);
    const sig = shell.querySelector('.wb-json-sighint') as HTMLElement;
    expect(sig.hidden).toBe(false);
    expect(sig.textContent).toContain('if(');
    expect(sig.querySelector('b')!.textContent).toBe('condition');
  });

  it('stays hidden outside expressions', () => {
    const { shell, textEl } = mountPanel();
    const text = '{"txtContent": "plain"}';
    type(textEl, text, text.length - 2);
    expect((shell.querySelector('.wb-json-sighint') as HTMLElement).hidden).toBe(true);
  });
});

describe('the scope bar', () => {
  it('marks the selected element on a clean buffer and hides during hand edits', () => {
    const { shell, textEl } = mountPanel();
    const bar = shell.querySelector('.wb-json-scopebar') as HTMLElement;
    state.select([0]);
    expect(bar.hidden).toBe(false);

    textEl.dispatchEvent(new Event('input', { bubbles: true })); // hand edit begins
    expect(bar.hidden).toBe(true);
  });
});
