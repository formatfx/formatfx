/**
 * treeView.ts under model B (COLUMNS-COMPONENTS-VIEWS): the icon-only action
 * buttons carry accessible names; a bound component INSTANCE reads
 * "⬡ Name ← Column" — the teal ⬡ mark plus a right-aligned binding tag built
 * from the `_component` provenance (display names, deduped, ' · ' joined).
 * No § ink, no reference tag-buttons, no drill-in — those left with the
 * columnFormatterReference model. Dragover is ACCEPT-GATED: a row only
 * highlights payloads it will act on (the false-highlight fix).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { mountTree } from './treeView';
import { state } from './state';
import type { MockField, SPElement } from '../core/types';

const FIELDS: MockField[] = [
  { name: 'Status', type: 'choice' },
  { name: 'DueDate', displayName: 'Due date', type: 'date' },
  { name: 'Owner', type: 'person' },
];

function mountDoc(root: SPElement, kind: 'row' | 'grid' = 'row'): HTMLElement {
  state.doc = { kind, root };
  state.fields = FIELDS;
  state.selection = null;
  const host = document.createElement('div');
  document.body.append(host);
  mountTree(host);
  return host;
}

beforeEach(() => {
  document.body.innerHTML = '';
  localStorage.clear();
  state.resetAll();
});

describe('tree action buttons (a11y)', () => {
  it('gives every icon-only action button an accessible name and hides the glyph', () => {
    const host = mountDoc({ elmType: 'div', children: [{ elmType: 'span', txtContent: 'x' }] });

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

describe('component-instance rows (the "⬡ Name ← Column" binding language)', () => {
  /** A row view whose second child is a bound component instance. */
  const mountInstance = (map: Record<string, string>): HTMLElement =>
    mountDoc({
      elmType: 'div',
      children: [
        { elmType: 'span', txtContent: '[$Status]' },
        {
          elmType: 'div',
          _elmName: 'Deadline chip',
          _component: { id: 'builtin-deadline-chip', map },
          txtContent: '=toLocaleDateString([$DueDate])',
        },
      ],
    });

  it('an instance row gets the ⬡ mark, its name, and a right-aligned binding tag', () => {
    const host = mountInstance({ Due: 'DueDate' });
    const rows = host.querySelectorAll<HTMLElement>('.wb-tree-row');
    expect(rows.length).toBe(3); // root + plain span + the instance
    const inst = rows[2];
    // the ⬡ mark says "this is a component" — decorative, hidden from AT
    const mark = inst.querySelector('.wb-comp-mark');
    expect(mark?.textContent).toBe('⬡');
    expect(mark?.getAttribute('aria-hidden')).toBe('true');
    // the instance keeps its own name as the primary label
    expect(inst.querySelector('.wb-tree-name')?.textContent).toBe('Deadline chip');
    // the binding tag names the bound COLUMN by display name (from _component.map)
    const tag = inst.querySelector<HTMLElement>('.wb-tree-bindtag');
    expect(tag?.textContent).toBe('← Due date');
    expect(tag?.title).toContain('bound to Due date');
    expect(tag?.title).toContain('inspector'); // remapping lives there — read-only here
    // an instance row is an ordinary row otherwise: actions + eye intact
    expect(inst.querySelectorAll('.wb-tree-actions button').length).toBeGreaterThan(0);
    expect(inst.querySelector('.wb-tree-eye')).not.toBeNull();
  });

  it('multi-slot bindings dedupe columns and join with " · "', () => {
    const host = mountInstance({ Due: 'DueDate', Alt: 'DueDate', Who: 'Owner' });
    const tag = host.querySelector<HTMLElement>('.wb-tree-bindtag');
    expect(tag?.textContent).toBe('← Due date · Owner');
  });

  it('unmapped (empty) slots are filtered — a fully unmapped instance shows no tag, keeps the mark', () => {
    const host = mountInstance({ Due: '' });
    expect(host.querySelector('.wb-tree-bindtag')).toBeNull();
    expect(host.querySelector('.wb-comp-mark')?.textContent).toBe('⬡');
  });

  it('an unknown column name shows honestly as itself', () => {
    const host = mountInstance({ Due: 'Ghost' });
    expect(host.querySelector('.wb-tree-bindtag')?.textContent).toBe('← Ghost');
  });

  it('plain rows carry neither mark nor tag — and no § / reference ink exists at all', () => {
    const host = mountInstance({ Due: 'DueDate' });
    const plain = host.querySelectorAll<HTMLElement>('.wb-tree-row')[1];
    expect(plain.querySelector('.wb-comp-mark')).toBeNull();
    expect(plain.querySelector('.wb-tree-bindtag')).toBeNull();
    // the retired violet channel: no § mark, no reference tag-button anywhere
    expect(host.querySelector('.wb-style-mark')).toBeNull();
    expect(host.querySelector('.wb-tree-cfr-open')).toBeNull();
    expect(host.textContent).not.toContain('§');
    expect(host.textContent).not.toContain('reference');
  });

  it('clicking an instance row SELECTS it — a plain selection, no drill anywhere', () => {
    const host = mountInstance({ Due: 'DueDate' });
    host.querySelectorAll<HTMLElement>('.wb-tree-row')[2].click();
    expect(state.isSelected([1])).toBe(true);
  });
});

describe('Columns mode (kind grid)', () => {
  it('the scaffold root gets NO row — the columns are the top level, look cells marked ⬡', () => {
    const host = mountDoc({
      elmType: 'div',
      _elmName: 'Row layout', // the pre-stamped promotion default
      children: [
        { elmType: 'div', _elmName: 'Status', _field: 'Status', txtContent: '[$Status]' },
        {
          elmType: 'div', _elmName: 'Deadline chip', _field: 'DueDate',
          _component: { id: 'builtin-deadline-chip', map: { Due: 'DueDate' } },
          txtContent: '=toLocaleDateString([$DueDate])',
        },
      ],
    }, 'grid');
    // one row per COLUMN — the wrapper div (and its stamped name) never renders
    const rows = host.querySelectorAll<HTMLElement>('.wb-tree-row');
    expect(rows.length).toBe(2);
    expect(host.textContent).not.toContain('Row layout');
    expect(rows[0].dataset.path).toBe('0');
    expect(rows[1].dataset.path).toBe('1');
    // columns sit at the visual top level (no phantom indent for the root)
    expect(rows[0].querySelector<HTMLElement>('.wb-tree-label')?.style.paddingLeft).toBe('0px');
    // an embedded look reads as what it is: a component instance bound to its column
    expect(rows[1].querySelector('.wb-comp-mark')?.textContent).toBe('⬡');
    expect(rows[1].querySelector('.wb-tree-bindtag')?.textContent).toBe('← Due date');
  });
});

describe('accept-gated dragover (the false-highlight fix)', () => {
  const dragover = (types: string[]): Event => {
    const ev = new Event('dragover', { bubbles: false, cancelable: true });
    (ev as unknown as { dataTransfer: unknown }).dataTransfer = {
      types,
      getData: () => '',
      setData: () => {},
      dropEffect: '',
      effectAllowed: '',
    };
    return ev;
  };

  const mountRow = (): HTMLElement => {
    const host = mountDoc({ elmType: 'div', children: [{ elmType: 'span', txtContent: 'x' }] });
    return host.querySelectorAll<HTMLElement>('.wb-tree-row')[1];
  };

  it('accepts a palette payload: highlights and prevents default', () => {
    const row = mountRow();
    const ev = dragover(['application/x-wb-palette']);
    row.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(row.classList.contains('droptarget')).toBe(true);
  });

  it('accepts a tree-node payload (reparent drag)', () => {
    const row = mountRow();
    const ev = dragover(['application/x-wb-node']);
    row.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(row.classList.contains('droptarget')).toBe(true);
  });

  it('IGNORES payloads it will not act on — no highlight, no preventDefault', () => {
    const row = mountRow();
    // a component library row, a grid column, a file from the OS — the old
    // unconditional preventDefault false-advertised drops the tree ignored
    for (const foreign of [['application/x-wb-component'], ['application/x-wb-grid-col'], ['Files'], []]) {
      const ev = dragover(foreign);
      row.dispatchEvent(ev);
      expect(ev.defaultPrevented, foreign.join()).toBe(false);
      expect(row.classList.contains('droptarget'), foreign.join()).toBe(false);
    }
  });

  it('dragleave clears the highlight', () => {
    const row = mountRow();
    row.dispatchEvent(dragover(['application/x-wb-node']));
    expect(row.classList.contains('droptarget')).toBe(true);
    row.dispatchEvent(new Event('dragleave'));
    expect(row.classList.contains('droptarget')).toBe(false);
  });
});
