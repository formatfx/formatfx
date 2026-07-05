/**
 * canvas.ts: the column-preview header must render the current field name
 * (an imported internal name) as text, never as HTML — see the matching
 * textContent treatment of the body cells right below it.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mountCanvas } from './canvas';
import { state } from './state';

// Each test mounts a canvas onto a fresh body-level host, and mountCanvas
// installs document-level listeners (click, keydown) — tear every host down
// via its _unsub hook so no listener leaks into later tests. The Escape
// dispatch first closes any overlay a test left open via its own real path,
// so createOverlay detaches its document listener too (the viewMenu.test
// precedent) — a bare .remove() would leak it.
afterEach(() => {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  document.querySelectorAll<HTMLElement>('body > *').forEach((el) => {
    (el as unknown as { _unsub?: () => void })._unsub?.();
    el.remove();
  });
});

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

describe('simulate-hover pin (issue #203)', () => {
  const hoverDoc = () => ({
    kind: 'column' as const,
    root: {
      elmType: 'div' as const,
      attributes: { class: 'sp-card-showOnHoverParent' },
      children: [{ elmType: 'span' as const, attributes: { class: 'sp-card-showOnHoverChild' }, txtContent: '⋯' }],
    },
  });

  it('offers the pin only when the document uses the hover-child class', () => {
    state.resetAll();
    state.doc = { kind: 'column', root: { elmType: 'div', txtContent: 'x' } };
    state.selection = null;
    const host = document.createElement('div');
    document.body.appendChild(host);
    mountCanvas(host, () => {});
    expect(host.querySelector('.wb-canvas-hoverpin')).toBeNull();

    state.doc = hoverDoc();
    state.emit('document');
    expect(host.querySelector('.wb-canvas-hoverpin')).toBeTruthy();
    state.resetAll();
  });

  it('toggling the pin flags the canvas for force-reveal; Live mode stands it down', () => {
    state.resetAll();
    state.doc = hoverDoc();
    state.selection = null;
    const host = document.createElement('div');
    document.body.appendChild(host);
    mountCanvas(host, () => {});

    expect(host.classList.contains('wb-simulate-hover')).toBe(false);
    (host.querySelector('.wb-canvas-hoverpin') as HTMLButtonElement).click();
    expect(state.simulateHover).toBe(true);
    expect(host.classList.contains('wb-simulate-hover')).toBe(true);

    // Live mode must behave like real SP: the reveal class comes off and the
    // pin is disabled while live, even though the pin state itself is kept
    state.setCanvasMode('live');
    expect(host.classList.contains('wb-simulate-hover')).toBe(false);
    expect((host.querySelector('.wb-canvas-hoverpin') as HTMLButtonElement).disabled).toBe(true);

    state.setCanvasMode('select');
    expect(host.classList.contains('wb-simulate-hover')).toBe(true);

    state.setSimulateHover(false);
    expect(host.classList.contains('wb-simulate-hover')).toBe(false);
    state.resetAll();
  });
});

describe('Select/Live canvas mode (FLOOR-AND-SHEETS Stage 3)', () => {
  it('Select: a customRowAction click SELECTS; Live: it fires the behavior instead', () => {
    state.resetAll();
    const toasts: string[] = [];
    state.createView({
      kind: 'row',
      root: {
        elmType: 'div',
        children: [{ elmType: 'button', txtContent: 'Go', customRowAction: { action: 'executeFlow', actionParams: '{"id":"x"}' } }],
      },
    });
    const host = document.createElement('div');
    document.body.appendChild(host);
    mountCanvas(host, (m) => toasts.push(m));

    // the shared chrome renders the segmented toggle, Select active by default
    expect(host.querySelector('.wb-canvas-mode.active')?.textContent).toBe('Select');

    const clickButton = (): void => {
      (host.querySelector('.wb-mock-viewrow [data-sp-path="0"]') as HTMLElement)
        .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    };
    clickButton();
    expect(state.selection).toEqual([0]); // selected…
    expect(toasts.some((t) => t.includes('customRowAction'))).toBe(false); // …not fired

    state.setCanvasMode('live');
    clickButton();
    expect(toasts.some((t) => t.includes('customRowAction: executeFlow'))).toBe(true);
    expect(state.selection).toEqual([0]); // live clicks never change the selection

    state.setCanvasMode('select'); // leave the singleton the way we found it
    state.resetAll();
  });
});
