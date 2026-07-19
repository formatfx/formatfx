// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Sam Yost

/**
 * jsonDirtyGuard.dom.test.ts — the dirty-buffer safety contracts (owner ask
 * 2026-07-13): a dirty buffer is the maker's DRAFT.
 *   · document changes never clobber it (they used to clearDirty+regenerate);
 *   · Apply confirms when the canvas moved while the buffer was dirty — and
 *     only then (a never-diverged buffer applies without ceremony);
 *   · ↩ Discard edits is the non-Apply way out (resync from the canvas);
 *   · the sanitize toggle confirms before discarding hand-edits (it used to
 *     discard silently);
 *   · the canvas dims behind body.wb-json-editing while dirty — a cue, not a
 *     lock — and the class never outlives the dirty state or the mount.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mountJsonPanel } from './jsonPanel';
import { state } from './state';
import { exportJson } from '../core/serializer';

let toasts: string[] = [];

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.querySelectorAll<HTMLElement>('body > *').forEach((el) => {
    (el as unknown as { _unsub?: () => void })._unsub?.();
    el.remove();
  });
  document.body.classList.remove('wb-json-editing');
  state.resetAll();
});

beforeEach(() => {
  state.resetAll();
  toasts = [];
});

function mountPanel() {
  const host = document.createElement('div');
  document.body.appendChild(host);
  mountJsonPanel(host, (m) => toasts.push(m));
  const textEl = host.querySelector('#wb-json-text') as HTMLTextAreaElement;
  const applyBtn = host.querySelector('#wb-json-apply') as HTMLButtonElement;
  const revertBtn = host.querySelector('#wb-json-revert') as HTMLButtonElement;
  return { host, textEl, applyBtn, revertBtn };
}

/** Put `text` in the buffer with the caret at the end, as if typed. */
function type(textEl: HTMLTextAreaElement, text: string): void {
  textEl.value = text;
  textEl.setSelectionRange(text.length, text.length);
  textEl.dispatchEvent(new Event('input', { bubbles: true }));
}

const NAMED_JSON = '{"elmType": "div", "_elmName": "mine", "txtContent": "hand-edited"}';

/** A canvas-side edit while the buffer is dirty — the divergence event. */
function nudgeDocument(): void {
  state.mutateDocument(() => {
    const node = state.nodeAt([0]);
    if (node) node.style = { ...(node.style ?? {}), 'margin-top': '3px' };
  });
}

describe('the no-clobber subscriber', () => {
  it('a document change never replaces a dirty buffer — it dims the canvas and waits', () => {
    const { textEl, revertBtn } = mountPanel();
    type(textEl, NAMED_JSON);
    expect(document.body.classList.contains('wb-json-editing')).toBe(true);
    expect(revertBtn.hidden).toBe(false);

    nudgeDocument();
    expect(textEl.value).toBe(NAMED_JSON); // the draft survives
    expect(textEl.classList.contains('wb-json-dirty')).toBe(true);
  });

  it('a clean buffer keeps refreshing in place, exactly as before', () => {
    const { textEl } = mountPanel();
    const before = textEl.value;
    nudgeDocument();
    expect(textEl.value).not.toBe(before);
    expect(textEl.value).toContain('margin-top');
    expect(document.body.classList.contains('wb-json-editing')).toBe(false);
  });
});

describe('the divergence-aware Apply', () => {
  it('confirms when the canvas moved while dirty; declining aborts the apply', () => {
    const confirmSpy = vi.fn().mockReturnValue(false);
    vi.stubGlobal('confirm', confirmSpy);
    const { textEl, applyBtn } = mountPanel();
    type(textEl, NAMED_JSON);
    nudgeDocument();
    const docBefore = exportJson(state.doc, { keepMeta: true });

    applyBtn.click();
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(confirmSpy.mock.calls[0][0]).toContain('canvas changed');
    expect(exportJson(state.doc, { keepMeta: true })).toBe(docBefore); // nothing applied
    expect(textEl.value).toBe(NAMED_JSON); // the draft still stands

    confirmSpy.mockReturnValue(true);
    applyBtn.click();
    expect(exportJson(state.doc, { keepMeta: true })).toContain('hand-edited'); // applied now
  });

  it('a buffer that never diverged applies without any confirm', () => {
    const confirmSpy = vi.fn().mockReturnValue(true);
    vi.stubGlobal('confirm', confirmSpy);
    const { textEl, applyBtn } = mountPanel();
    type(textEl, NAMED_JSON);
    applyBtn.click();
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(exportJson(state.doc, { keepMeta: true })).toContain('hand-edited');
    expect(document.body.classList.contains('wb-json-editing')).toBe(false);
  });

  it('divergence resets with the dirty state — the next clean-edited apply is quiet again', () => {
    const confirmSpy = vi.fn().mockReturnValue(true);
    vi.stubGlobal('confirm', confirmSpy);
    const { textEl, applyBtn, revertBtn } = mountPanel();
    type(textEl, NAMED_JSON);
    nudgeDocument();
    revertBtn.click(); // back in sync — the fork is gone
    type(textEl, NAMED_JSON);
    applyBtn.click(); // no nudge this time
    expect(confirmSpy).not.toHaveBeenCalled();
  });
});

describe('↩ Discard edits', () => {
  it('drops the hand-edits, resyncs from the canvas, and undims', () => {
    const { textEl, revertBtn } = mountPanel();
    const cleanText = textEl.value;
    type(textEl, '{"elmType": "div"');
    nudgeDocument();

    revertBtn.click();
    expect(textEl.value).not.toBe(cleanText); // resynced to the NUDGED doc…
    expect(textEl.value).toContain('margin-top');
    expect(textEl.classList.contains('wb-json-dirty')).toBe(false);
    expect(revertBtn.hidden).toBe(true);
    expect(document.body.classList.contains('wb-json-editing')).toBe(false);
    expect(toasts.some((t) => t.includes('discarded'))).toBe(true);
  });
});

describe('the sanitize toggle on a dirty buffer', () => {
  it('confirms before discarding; declining keeps the draft and flips the box back', () => {
    const confirmSpy = vi.fn().mockReturnValue(false);
    vi.stubGlobal('confirm', confirmSpy);
    const { textEl } = mountPanel();
    const sanitizeEl = document.querySelector('#wb-json-sanitize') as HTMLInputElement;
    expect(sanitizeEl.checked).toBe(true);
    type(textEl, NAMED_JSON);

    sanitizeEl.checked = false;
    sanitizeEl.dispatchEvent(new Event('change', { bubbles: true }));
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(textEl.value).toBe(NAMED_JSON); // the draft survives
    expect(sanitizeEl.checked).toBe(true); // the box flipped back
    expect(textEl.classList.contains('wb-json-dirty')).toBe(true);

    confirmSpy.mockReturnValue(true);
    sanitizeEl.checked = false;
    sanitizeEl.dispatchEvent(new Event('change', { bubbles: true }));
    expect(textEl.value).not.toBe(NAMED_JSON); // regenerated from the doc
    expect(textEl.classList.contains('wb-json-dirty')).toBe(false);
  });

  it('a clean buffer toggles without ceremony', () => {
    const confirmSpy = vi.fn().mockReturnValue(true);
    vi.stubGlobal('confirm', confirmSpy);
    mountPanel();
    const sanitizeEl = document.querySelector('#wb-json-sanitize') as HTMLInputElement;
    sanitizeEl.checked = false;
    sanitizeEl.dispatchEvent(new Event('change', { bubbles: true }));
    expect(confirmSpy).not.toHaveBeenCalled();
  });
});

describe('teardown hygiene', () => {
  it('unmounting a dirty panel removes the canvas dim class', () => {
    const { host, textEl } = mountPanel();
    type(textEl, NAMED_JSON);
    expect(document.body.classList.contains('wb-json-editing')).toBe(true);
    (host as unknown as { _unsub: () => void })._unsub();
    host.remove();
    expect(document.body.classList.contains('wb-json-editing')).toBe(false);
  });
});
