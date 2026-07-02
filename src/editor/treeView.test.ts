/**
 * treeView.ts: the icon-only action buttons (rename/wrap/up/down/duplicate/
 * delete) must carry an accessible name — a screen reader announces the
 * aria-label, and the decorative glyph is hidden from the a11y tree.
 */
import { describe, it, expect } from 'vitest';
import { mountTree } from './treeView';
import { state } from './state';

describe('tree action buttons (a11y)', () => {
  it('gives every icon-only action button an accessible name and hides the glyph', () => {
    state.doc = {
      kind: 'column',
      root: { elmType: 'div', children: [{ elmType: 'span', txtContent: 'x' }] },
    };
    state.selection = null;
    const host = document.createElement('div');
    document.body.append(host);

    mountTree(host);

    const buttons = Array.from(host.querySelectorAll<HTMLButtonElement>('.wb-tree-actions button'));
    expect(buttons.length).toBeGreaterThan(0);
    for (const b of buttons) {
      // accessible name: aria-label must be present and match the tooltip text
      expect(b.getAttribute('aria-label')).toBeTruthy();
      expect(b.getAttribute('aria-label')).toBe(b.title);
      // the decorative glyph must not contribute to the accessible name
      const icon = b.querySelector('i');
      expect(icon?.getAttribute('aria-hidden')).toBe('true');
    }
  });
});
