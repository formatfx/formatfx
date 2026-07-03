/**
 * editor/playground.ts — the header's "restyling <name>" line shows the element
 * as a reference badge (editor/elmRef.ts). Its _elmName must render as TEXT,
 * never as HTML: _elmName is user-controlled — set by rename and arriving
 * verbatim in pasted/imported formatter JSON — so an innerHTML sink here is a
 * stored-XSS vector. This pins the fix so a future refactor can't quietly
 * reintroduce it.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { openElementPlayground, closePlayground } from './playground';
import { state } from './state';

afterEach(() => closePlayground());

describe('style playground — element name rendering (XSS)', () => {
  it('renders a malicious _elmName as inert text, injecting no elements', () => {
    const payload = '<img src=x onerror="window.__xss__=1">';
    state.doc = {
      kind: 'column',
      root: { elmType: 'div', _elmName: payload, txtContent: 'hi' },
    };

    (window as unknown as { __xss__?: number }).__xss__ = undefined;
    openElementPlayground([]);

    const sub = document.body.querySelector('.wb-pg-sub')!;
    expect(sub).toBeTruthy();
    // the name must appear literally, not be parsed into DOM
    expect(sub.textContent).toContain(payload);
    // no element from the payload may have been created inside the header…
    expect(sub.querySelector('img')).toBeNull();
    // …and the onerror must never have fired
    expect((window as unknown as { __xss__?: number }).__xss__).toBeUndefined();
  });

  it('shows the friendly name in a reference badge wearing the tree icon', () => {
    state.doc = {
      kind: 'column',
      root: { elmType: 'div', _elmName: 'Status pill', txtContent: 'hi' },
    };
    openElementPlayground([]);

    const badge = document.body.querySelector('.wb-pg-sub .wb-elmref');
    expect(badge).toBeTruthy();
    // the name is emphasized inside the badge…
    expect(badge!.querySelector('.wb-elmref-name')?.textContent).toBe('Status pill');
    // …beside the same glyph the Structure tree shows for a <div>
    expect(badge!.querySelector('i')?.className).toContain('ms-Icon--CubeShape');
  });
});
