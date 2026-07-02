import { describe, it, expect, beforeEach } from 'vitest';
import { state } from './state';
import { mountTree } from './treeView';
import { mountInspector } from './inspector';
import { mountCanvas } from './canvas';

describe('Panel selection synchronization and multi-select stress tests', () => {
  beforeEach(() => {
    state.resetAll();
  });

  it('updates selection on state and tree view rows when clicked or ctrl-toggled', () => {
    state.doc = {
      kind: 'row',
      root: {
        elmType: 'div',
        children: [
          { elmType: 'span', txtContent: 'Span A' },
          { elmType: 'span', txtContent: 'Span B' }
        ]
      }
    };
    state.selection = []; // Select root initially

    const viewHost = document.createElement('div');
    document.body.appendChild(viewHost);

    mountTree(viewHost);

    const rows = viewHost.querySelectorAll<HTMLElement>('.wb-tree-row');
    expect(rows).toHaveLength(3); // root + two children

    const rootRow = [...rows].find(r => r.dataset.path === '');
    const spanARow = [...rows].find(r => r.dataset.path === '0');
    const spanBRow = [...rows].find(r => r.dataset.path === '1');

    expect(rootRow).toBeTruthy();
    expect(spanARow).toBeTruthy();
    expect(spanBRow).toBeTruthy();

    // Verify initial selection CSS classes
    expect(rootRow!.classList.contains('selected')).toBe(true);
    expect(spanARow!.classList.contains('selected')).toBe(false);
    expect(spanBRow!.classList.contains('selected')).toBe(false);

    // 1. Click on Span A row -> should select Span A
    spanARow!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(state.selection).toEqual([0]);
    expect(rootRow!.classList.contains('selected')).toBe(false);
    expect(spanARow!.classList.contains('selected')).toBe(true);

    // 2. Toggle Span B into the selection with Ctrl+click (checkboxes are gone —
    // the row highlight IS the selection UI)
    spanBRow!.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));

    // Under multi-select, Span A and Span B should both be selected
    expect(state.selections).toEqual([[0], [1]]);
    expect(spanARow!.classList.contains('selected')).toBe(true);
    expect(spanBRow!.classList.contains('selected')).toBe(true);

    // Cleanup DOM
    (viewHost as any)._unsub?.();
    viewHost.remove();
  });

  it('handles Ctrl/Cmd/Shift key modifiers in tree view to multi-select', () => {
    state.doc = {
      kind: 'row',
      root: {
        elmType: 'div',
        children: [
          { elmType: 'span', txtContent: 'Span A' },
          { elmType: 'span', txtContent: 'Span B' }
        ]
      }
    };
    state.selection = [];

    const viewHost = document.createElement('div');
    document.body.appendChild(viewHost);

    mountTree(viewHost);

    const spanARow = viewHost.querySelector<HTMLElement>('[data-path="0"]');
    const spanBRow = viewHost.querySelector<HTMLElement>('[data-path="1"]');

    // Plain click on Span A collapses to Span A only
    spanARow!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(state.selections).toEqual([[0]]);

    // Ctrl+click on Span B adds Span B to selections
    spanBRow!.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
    expect(state.selections).toEqual([[0], [1]]);

    // Shift+click on Span A removes Span A from selections
    spanARow!.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }));
    expect(state.selections).toEqual([[1]]);

    // Cleanup DOM
    (viewHost as any)._unsub?.();
    viewHost.remove();
  });

  it('updates selection on canvas clicks and updates canvas highlights on selection changes', () => {
    state.doc = {
      kind: 'row',
      root: {
        elmType: 'div',
        children: [
          { elmType: 'span', txtContent: 'Span A' },
          { elmType: 'span', txtContent: 'Span B' }
        ]
      }
    };
    state.selection = [];

    const host = document.createElement('div');
    document.body.appendChild(host);

    mountCanvas(host, () => {});

    // Find canvas elements with data-sp-path attributes
    const rootEl = host.querySelector('[data-sp-path=""]');
    const spanAEl = host.querySelector('[data-sp-path="0"]');
    const spanBEl = host.querySelector('[data-sp-path="1"]');

    expect(rootEl).toBeTruthy();
    expect(spanAEl).toBeTruthy();
    expect(spanBEl).toBeTruthy();

    // Initial highlight check
    expect(rootEl!.classList.contains('wb-selected')).toBe(true);
    expect(spanAEl!.classList.contains('wb-selected')).toBe(false);
    expect(spanBEl!.classList.contains('wb-selected')).toBe(false);

    // Canvas click on Span B selects Span B
    spanBEl!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(state.selection).toEqual([1]);
    expect(rootEl!.classList.contains('wb-selected')).toBe(false);
    expect(spanBEl!.classList.contains('wb-selected')).toBe(true);

    // Ctrl+click on Span A multi-selects
    spanAEl!.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
    expect(state.selections).toEqual([[1], [0]]);
    expect(spanAEl!.classList.contains('wb-selected')).toBe(true);
    expect(spanBEl!.classList.contains('wb-selected')).toBe(true);

    // Cleanup DOM
    (host as any)._unsub?.();
    host.remove();
  });

  it('propagates kvEditor style changes to all selected nodes via commitAll under multi-selection', () => {
    state.doc = {
      kind: 'row',
      root: {
        elmType: 'div',
        children: [
          { elmType: 'span', txtContent: 'Span A', style: { color: 'red', 'font-size': '12px' } },
          { elmType: 'span', txtContent: 'Span B', style: { color: 'blue', 'font-weight': 'bold' } }
        ]
      }
    };

    // Select both children: Span A and Span B
    state.selectMulti([[0], [1]]);

    const host = document.createElement('div');
    document.body.appendChild(host);

    mountInspector(host);

    const styleSection = [...host.querySelectorAll<HTMLDetailsElement>('.wb-inspector-section')]
      .find(s => s.querySelector('.wb-sec-title')?.textContent === 'Style (all properties)');
    expect(styleSection).toBeTruthy();

    const kvRows = styleSection!.querySelectorAll<HTMLElement>('.wb-kv-row');
    expect(kvRows).toHaveLength(2);

    const colorRow = [...kvRows].find(row => row.querySelector<HTMLInputElement>('.wb-kv-key')?.value === 'color');
    expect(colorRow).toBeTruthy();

    const colorValInput = colorRow!.querySelector<HTMLInputElement>('.wb-kv-val');
    expect(colorValInput?.value).toBe('red');

    // Simulate changing color from 'red' to 'green'
    colorValInput!.value = 'green';
    colorValInput!.dispatchEvent(new Event('change', { bubbles: true }));

    // Verify both nodes are updated to green
    const nodeA = state.nodeAt([0]);
    const nodeB = state.nodeAt([1]);
    expect(nodeA?.style?.color).toBe('green');
    expect(nodeB?.style?.color).toBe('green');

    // Check that non-modified styles are untouched
    expect(nodeA?.style?.['font-size']).toBe('12px');
    expect(nodeB?.style?.['font-weight']).toBe('bold');

    // Cleanup DOM
    (host as any)._unsub?.();
    host.remove();
  });

  it('preserves focus on the active input during kvEditor change commits (DOM recycling)', () => {
    state.doc = {
      kind: 'row',
      root: {
        elmType: 'div',
        children: [
          { elmType: 'span', txtContent: 'Span A', style: { color: 'red' } }
        ]
      }
    };

    state.select([0]);

    const host = document.createElement('div');
    document.body.appendChild(host);

    mountInspector(host);

    const styleSection = [...host.querySelectorAll<HTMLDetailsElement>('.wb-inspector-section')]
      .find(s => s.querySelector('.wb-sec-title')?.textContent === 'Style (all properties)');
    expect(styleSection).toBeTruthy();

    const colorRow = styleSection!.querySelector('.wb-kv-row');
    expect(colorRow).toBeTruthy();

    const colorValInput = colorRow!.querySelector<HTMLInputElement>('.wb-kv-val');
    expect(colorValInput).toBeTruthy();

    // Focus the input
    colorValInput!.focus();
    expect(document.activeElement).toBe(colorValInput);

    // Simulate typing/changing value
    colorValInput!.value = 'orange';
    colorValInput!.dispatchEvent(new Event('change', { bubbles: true }));

    // Focus must still be on the same input element
    expect(document.activeElement).toBe(colorValInput);
    expect(colorValInput!.value).toBe('orange');

    // Cleanup DOM
    (host as any)._unsub?.();
    host.remove();
  });

  it('cleans up panel subscriptions via public unsubscribe hooks when remounting', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    // Mount once
    mountInspector(host);
    const firstInspectorUnsub = (host as any)._unsub;
    expect(typeof firstInspectorUnsub).toBe('function');

    // Mount again (simulating navigation or hot reload)
    mountInspector(host);
    const secondInspectorUnsub = (host as any)._unsub;
    expect(typeof secondInspectorUnsub).toBe('function');
    expect(secondInspectorUnsub).not.toBe(firstInspectorUnsub);

    // Mount tree view
    const viewHost = document.createElement('div');
    document.body.appendChild(viewHost);
    mountTree(viewHost);
    expect(typeof (viewHost as any)._unsub).toBe('function');

    // Clean up DOM
    (host as any)._unsub?.();
    (viewHost as any)._unsub?.();
    host.remove();
    viewHost.remove();
  });
});
