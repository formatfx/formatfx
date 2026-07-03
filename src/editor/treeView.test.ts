/**
 * treeView.ts: the icon-only action buttons (rename/wrap/up/down/duplicate/
 * delete) must carry an accessible name — a screen reader announces the
 * aria-label, and the decorative glyph is hidden from the a11y tree.
 * Plus the single-row CFR presentation: a host element carrying a
 * columnFormatterReference renders as ONE normal tree row (no nested stub) —
 * row click selects the HOST; the "reference" tag-button is the explicit
 * door into the shared column formatter.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
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

describe('single-row CFR presentation', () => {
  afterEach(() => vi.restoreAllMocks());

  /** A row-view doc whose second child is a CFR host on [$Status]. */
  const mountCfrTree = (hostName?: string) => {
    state.doc = {
      kind: 'row',
      root: {
        elmType: 'div',
        children: [
          { elmType: 'span', txtContent: '[$Title]' },
          {
            elmType: 'div',
            columnFormatterReference: '[$Status]',
            style: { 'flex': '1', 'min-width': '0' },
            ...(hostName ? { _elmName: hostName } : {}),
          },
        ],
      },
    };
    state.columnRefs = { Status: { elmType: 'span', txtContent: '@currentField' } };
    state.selection = null;
    const host = document.createElement('div');
    document.body.append(host);
    mountTree(host);
    return host;
  };

  it('renders ONE row per CFR host — no stub row, § ink + a reference tag-button', () => {
    const host = mountCfrTree();
    // the old opaque stub row is gone
    expect(host.querySelector('.wb-tree-stylestub')).toBeNull();
    const rows = host.querySelectorAll('.wb-tree-row');
    expect(rows.length).toBe(3); // root + Title span + the host cell
    const cfrRow = rows[2];
    // nameless host borrows the referenced column's display name
    expect(cfrRow.querySelector('.wb-tree-name')?.textContent).toBe('Status');
    // violet survives as ink: the § mark, hidden from the a11y tree
    const mark = cfrRow.querySelector('.wb-style-mark');
    expect(mark?.textContent).toBe('§');
    expect(mark?.getAttribute('aria-hidden')).toBe('true');
    // the explicit drill-in affordance is a real button with a teaching name
    const open = cfrRow.querySelector<HTMLButtonElement>('button.wb-tree-cfr-open');
    expect(open?.textContent).toBe('reference');
    expect(open?.getAttribute('aria-label')).toContain('Open the Status column formatter');
    expect(open?.title).toContain('used in');
    // the host row keeps its normal actions (move/duplicate/delete + eye)
    expect(cfrRow.querySelectorAll('.wb-tree-actions button').length).toBeGreaterThan(0);
    expect(cfrRow.querySelector('.wb-tree-eye')).not.toBeNull();
  });

  it('an _elmName on the host stays the primary label', () => {
    const host = mountCfrTree('My status cell');
    const cfrRow = host.querySelectorAll('.wb-tree-row')[2];
    expect(cfrRow.querySelector('.wb-tree-name')?.textContent).toBe('My status cell');
    expect(cfrRow.querySelector('.wb-style-mark')?.textContent).toBe('§');
  });

  it('clicking the row selects the HOST element; only the tag drills in', () => {
    const host = mountCfrTree();
    const openSpy = vi.spyOn(state, 'openColumnRef').mockImplementation(() => {});
    const cfrRow = host.querySelectorAll<HTMLElement>('.wb-tree-row')[2];
    cfrRow.click();
    expect(state.isSelected([1])).toBe(true); // host selected, no drill-in
    expect(openSpy).not.toHaveBeenCalled();
    cfrRow.querySelector<HTMLButtonElement>('.wb-tree-cfr-open')!.click();
    expect(openSpy).toHaveBeenCalledWith('Status');
    expect(state.isSelected([1])).toBe(true); // the tag click didn't reselect
  });

  it('an unregistered reference keeps the teaching tooltip and stays inert', () => {
    const host = mountCfrTree();
    state.columnRefs = {}; // Status no longer registered — re-mount to re-render
    const host2 = document.createElement('div');
    document.body.append(host2);
    mountTree(host2);
    const openSpy = vi.spyOn(state, 'openColumnRef').mockImplementation(() => {});
    const cfrRow = host2.querySelectorAll<HTMLElement>('.wb-tree-row')[2];
    const tag = cfrRow.querySelector<HTMLElement>('.wb-tree-cfr-open')!;
    expect(tag.tagName).not.toBe('BUTTON'); // inert span, not a button
    expect(tag.classList.contains('wb-tree-cfr-missing')).toBe(true);
    expect(tag.title).toContain("isn't registered");
    tag.click();
    expect(openSpy).not.toHaveBeenCalled();
    host.remove();
  });
});
