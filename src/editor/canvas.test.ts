/**
 * canvas.ts: the column-preview header must render the current field name
 * (an imported internal name) as text, never as HTML — see the matching
 * textContent treatment of the body cells right below it.
 */
import { describe, it, expect } from 'vitest';
import { mountCanvas } from './canvas';
import { state } from './state';

describe('canvas column preview', () => {
  it('renders the current field name as text, not HTML (no DOM-XSS)', () => {
    state.doc = { kind: 'column', root: { elmType: 'div', txtContent: 'x' } };
    state.currentFieldName = '<img src=x onerror="globalThis.__xss=1">';
    state.selection = null;
    const host = document.createElement('div');
    document.body.appendChild(host);

    mountCanvas(host, () => {});

    // the payload is inert text in the header, never a parsed <img> element
    expect(host.querySelector('.wb-mock-header img')).toBeNull();
    const fmt = host.querySelector('.wb-mock-header .wb-mock-cell-fmt');
    expect(fmt?.textContent).toBe('<img src=x onerror="globalThis.__xss=1"> (formatted)');
  });
});

describe('row-view toolbar', () => {
  it('has a Templates button that opens the modal', () => {
    state.doc = { kind: 'row', root: { elmType: 'div', children: [] } };
    state.selection = null;
    const host = document.createElement('div');
    document.body.appendChild(host);
    mountCanvas(host, () => {});
    const btn = [...host.querySelectorAll('button')].find((b) => /Templates/.test(b.textContent ?? ''));
    expect(btn).toBeTruthy();
    btn!.click();
    expect(document.querySelector('.wb-template-modal')).toBeTruthy();
  });
});
