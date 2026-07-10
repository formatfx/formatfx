/**
 * jsonIdeExtras.dom.test.ts — PR E wiring contracts through the real panel
 * (spec 2026-07-09 §6): the eval chip rides the signature strip; the caret's
 * ref lights its occurrences in the overlay; color values chip; the size
 * meter tracks what COPY produces (doc + toggles, not the dirty buffer);
 * the syntax color mapper stores per theme and applies to <body>.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mountJsonPanel } from './jsonPanel';
import { state } from './state';
import { SYN_STORE_KEY } from './synPalette';

afterEach(() => {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  document.querySelectorAll<HTMLElement>('body > *').forEach((el) => {
    (el as unknown as { _unsub?: () => void })._unsub?.();
    el.remove();
  });
  document.body.removeAttribute('style');
  document.body.classList.remove('wb-dark');
  localStorage.clear();
  state.resetAll();
});

beforeEach(() => {
  localStorage.clear();
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

/** Caret-only move: click at `caret` (the panel repaints on click). */
function caretTo(textEl: HTMLTextAreaElement, caret: number): void {
  textEl.setSelectionRange(caret, caret);
  textEl.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

describe('the eval chip in the signature strip', () => {
  it("caret in a live string → the engine's value for the sample row, type-badged", () => {
    const { shell, textEl } = mountPanel();
    const text = '{"elmType": "div", "txtContent": "=[$Status]"}';
    type(textEl, text, text.indexOf('[$Status]') + 3);

    const sig = shell.querySelector('.wb-json-sighint') as HTMLElement;
    expect(sig.hidden).toBe(false);
    const chip = sig.querySelector('.wb-evalchip') as HTMLElement;
    expect(chip).not.toBeNull();
    expect(chip.textContent).toContain('→');
    expect(chip.querySelector('.wb-evalchip-type')!.textContent).toBe('text');
    // the value really came from the sample row
    expect(chip.textContent).toContain(String(state.rows[0].Status));
  });

  it('a broken formula chips the engine error; a caret outside shows nothing', () => {
    const { shell, textEl } = mountPanel();
    const text = '{"elmType": "div", "txtContent": "=if([$Status]"}';
    type(textEl, text, text.indexOf('=if(') + 4);
    const sig = shell.querySelector('.wb-json-sighint') as HTMLElement;
    const err = sig.querySelector('.wb-evalchip-error');
    expect(err).not.toBeNull();
    expect(err!.textContent).toContain('⚠');

    caretTo(textEl, 1); // wrapper chrome — no live string, no hint
    expect(sig.hidden).toBe(true);
  });
});

describe('occurrence highlighting through the panel', () => {
  it("the caret's ref lights every same-text occurrence in the overlay", () => {
    const { shell, textEl } = mountPanel();
    const text = '{"a": "=[$Status]", "b": "=[$Status]", "c": "=[$Other]"}';
    type(textEl, text, text.indexOf('[$Status]') + 3);
    const occ = shell.querySelectorAll('.wb-json-hl .wb-tok-occ');
    expect(occ.length).toBe(2);
    occ.forEach((el) => expect(el.textContent).toBe('[$Status]'));

    caretTo(textEl, 1); // caret off the ref: the lights go out
    expect(shell.querySelectorAll('.wb-json-hl .wb-tok-occ').length).toBe(0);
  });
});

describe('color chips through the panel', () => {
  it('a hex style value grows the swatch class with its --wb-chip', () => {
    const { shell, textEl } = mountPanel();
    const text = '{"elmType": "div", "style": {"color": "#e81123"}}';
    type(textEl, text, text.length);
    const chip = shell.querySelector('.wb-json-hl .wb-tok-color') as HTMLElement;
    expect(chip).not.toBeNull();
    expect(chip.getAttribute('style')).toContain('--wb-chip:#e81123');
  });
});

describe('the size meter', () => {
  it('shows the Copy output size and tracks the names toggle', () => {
    const { host } = mountPanel();
    const meter = host.querySelector('#wb-json-size') as HTMLElement;
    expect(meter.textContent).toMatch(/^[\d,.]+ (B|KB)$/);

    const before = meter.textContent;
    const namesEl = document.querySelector('#wb-json-names') as HTMLInputElement;
    namesEl.checked = !namesEl.checked; // default doc carries _elmName — size must move
    namesEl.dispatchEvent(new Event('change', { bubbles: true }));
    expect(meter.textContent).not.toBe(before);
  });

  it('a dirty buffer does not move it — the meter is the DOC (what Copy copies)', () => {
    const { host, textEl } = mountPanel();
    const meter = host.querySelector('#wb-json-size') as HTMLElement;
    const before = meter.textContent;
    type(textEl, ` ${textEl.value}`, 1);
    expect(meter.textContent).toBe(before);
  });
});

describe('the syntax color mapper', () => {
  it('kebab button opens the panel; a pick saves per theme and applies to <body>', () => {
    const { host } = mountPanel();
    const panel = host.querySelector('#wb-syn-panel') as HTMLElement;
    expect(panel.hidden).toBe(true);

    (document.querySelector('#wb-json-syncolors') as HTMLButtonElement).click();
    expect(panel.hidden).toBe(false);
    const inputs = panel.querySelectorAll<HTMLInputElement>('input[type="color"]');
    expect(inputs.length).toBe(7); // one per --wb-syn-x* slot

    const first = inputs[0]; // --wb-syn-xfield
    first.value = '#123456';
    first.dispatchEvent(new Event('input', { bubbles: true }));
    expect(document.body.style.getPropertyValue('--wb-syn-xfield')).toBe('#123456');
    expect(localStorage.getItem(SYN_STORE_KEY)).toContain('#123456');
    expect(JSON.parse(localStorage.getItem(SYN_STORE_KEY)!).dark).toEqual({}); // light-only pick
  });

  it('reset drops the current theme’s overrides and clears the inline vars', () => {
    const { host } = mountPanel();
    (document.querySelector('#wb-json-syncolors') as HTMLButtonElement).click();
    const panel = host.querySelector('#wb-syn-panel') as HTMLElement;
    const first = panel.querySelector<HTMLInputElement>('input[type="color"]')!;
    first.value = '#123456';
    first.dispatchEvent(new Event('input', { bubbles: true }));

    (panel.querySelector('#wb-syn-reset') as HTMLButtonElement).click();
    expect(document.body.style.getPropertyValue('--wb-syn-xfield')).toBe('');
    expect(localStorage.getItem(SYN_STORE_KEY)).toBeNull();
  });
});
