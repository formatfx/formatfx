/**
 * editor/overlay.ts — the shared modal-overlay primitive: backdrop-click and
 * Esc both close, close() tears down the Esc listener and removes the node.
 */
import { describe, it, expect } from 'vitest';
import { createOverlay } from './overlay';

describe('createOverlay', () => {
  it('builds an overlay element with the given class', () => {
    const h = createOverlay('wb-test-overlay', () => {});
    expect(h.overlay.className).toBe('wb-test-overlay');
    h.close();
  });

  it('closes on Esc and on a backdrop click, but not on a click inside the panel', () => {
    let closes = 0;
    const h = createOverlay('wb-test-overlay', () => closes++);
    const panel = document.createElement('div');
    h.overlay.appendChild(panel);
    document.body.appendChild(h.overlay);

    // a pointerdown inside the panel must NOT close
    panel.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(closes).toBe(0);

    // a pointerdown on the backdrop (the overlay itself) closes
    h.overlay.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(closes).toBe(1);

    // Esc closes
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(closes).toBe(2);

    h.close();
  });

  it('close() removes the node and detaches the Esc listener (idempotent)', () => {
    let closes = 0;
    const h = createOverlay('wb-test-overlay', () => closes++);
    document.body.appendChild(h.overlay);

    h.close();
    expect(h.overlay.isConnected).toBe(false);
    // listener is gone — a later Esc must not fire onClose
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(closes).toBe(0);
    // calling close again is harmless
    expect(() => h.close()).not.toThrow();
  });
});
