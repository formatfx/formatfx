/**
 * editor/overlay.ts — the shared full-screen modal-overlay primitive.
 *
 * One place for the modal boilerplate the playground, the Format-cells dialog
 * and the field guide all need: a backdrop element, click-the-backdrop-to-close
 * and Esc-to-close, plus a close() that removes the node AND detaches the Esc
 * listener (a leaked document keydown handler is the classic modal bug).
 *
 * The caller appends its panel to `.overlay`, adds `.overlay` to the DOM, and
 * routes its own close path through `onClose` (so backdrop/Esc and the caller's
 * ✕ button all funnel to the same teardown).
 */

export interface OverlayHandle {
  /** The backdrop element — append the panel here, then add this to the DOM. */
  overlay: HTMLElement;
  /** Remove the overlay and detach the Esc listener. Idempotent. */
  close: () => void;
}

export function createOverlay(className: string, onClose: () => void): OverlayHandle {
  const overlay = document.createElement('div');
  overlay.className = className;
  // backdrop click — only when the press lands on the backdrop itself, not a child
  overlay.addEventListener('pointerdown', (e) => { if (e.target === overlay) onClose(); });
  const escHandler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
  document.addEventListener('keydown', escHandler);

  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', escHandler);
    overlay.remove();
  };

  return { overlay, close };
}
