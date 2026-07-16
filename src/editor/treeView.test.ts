/**
 * treeView.ts under model B (COLUMNS-COMPONENTS-VIEWS): the icon-only action
 * buttons carry accessible names; a bound component INSTANCE reads
 * "⬡ Name ← Column" — the teal ⬡ mark plus a right-aligned binding tag built
 * from the `_component` provenance (display names, deduped, ' · ' joined).
 * No § ink, no reference tag-buttons, no drill-in — those left with the
 * columnFormatterReference model. Dragover is ACCEPT-GATED: a row only
 * highlights payloads it will act on (the false-highlight fix).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mountTree } from './treeView';
import { mountComponentWorkshop } from './componentEditor';
import { componentById } from './componentLibrary';
import { state } from './state';
import { foldState, elmFoldKey, childrenFoldKey } from './foldState';
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

describe('elemType far-right + hover-actions swap slot (#219, #220)', () => {
  it('moves elemType out of the label into a far-right meta slot shared with the hover actions', () => {
    const host = mountDoc({ elmType: 'div', children: [{ elmType: 'span', txtContent: 'x' }] });
    const row = host.querySelectorAll<HTMLElement>('.wb-tree-row')[1]; // the child span row
    const label = row.querySelector('.wb-tree-label');
    const meta = row.querySelector('.wb-tree-meta');
    expect(meta).not.toBeNull();
    // elemType left the label — it's metadata, out of the way until hovered
    expect(label?.querySelector('.wb-tree-elmtype')).toBeNull();
    const elmtype = meta!.querySelector('.wb-tree-elmtype');
    expect(elmtype?.textContent).toBe('span');
    // the hover actions share the SAME slot as elemType — CSS swaps one for
    // the other on row hover without any reflow, since both are always here
    expect(elmtype?.parentElement).toBe(meta);
    const actions = meta!.querySelector('.wb-tree-actions');
    expect(actions?.parentElement).toBe(meta);
    expect(actions?.querySelectorAll('button').length).toBeGreaterThan(0);
    // the meta slot is the row's last child — the far-right position
    expect(row.lastElementChild).toBe(meta);
  });

  it('keeps the meta slot far-right even on rows with a binding tag', () => {
    const host = mountDoc({
      elmType: 'div',
      children: [
        {
          elmType: 'div',
          _elmName: 'Deadline chip',
          _component: { id: 'builtin-deadline-chip', map: { Due: 'DueDate' } },
          txtContent: '=toLocaleDateString([$DueDate])',
        },
      ],
    });
    const row = host.querySelectorAll<HTMLElement>('.wb-tree-row')[1];
    expect(row.querySelector('.wb-tree-bindtag')).not.toBeNull();
    expect(row.lastElementChild).toBe(row.querySelector('.wb-tree-meta'));
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
    // an instance row is an ordinary row otherwise: actions intact
    expect(inst.querySelectorAll('.wb-tree-actions button').length).toBeGreaterThan(0);
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

  it('accepts a column-shelf chip (FIELD_MIME — §5)', () => {
    const row = mountRow();
    const ev = dragover(['application/x-wb-field']);
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

describe('field drops (§5: the shelf chip lands as its look-aware cell)', () => {
  const drop = (fieldName: string): Event => {
    const ev = new Event('drop', { bubbles: false, cancelable: true });
    (ev as unknown as { dataTransfer: unknown }).dataTransfer = {
      types: ['application/x-wb-field'],
      getData: (mime: string) => (mime === 'application/x-wb-field' ? fieldName : ''),
      setData: () => {},
    };
    return ev;
  };

  it('inserts gridCellForField at the drop row — dressed when the column wears a look', () => {
    state.resetAll(); // the default workspace: Status wears the status-pill look
    state.createView({ kind: 'row', root: { elmType: 'div', children: [{ elmType: 'div', children: [] }] } });
    const host = document.createElement('div');
    document.body.append(host);
    mountTree(host);
    const undoDepth = (state as unknown as { undoStack: string[] }).undoStack.length;
    const row = host.querySelectorAll<HTMLElement>('.wb-tree-row')[1]; // the child div
    row.dispatchEvent(drop('Status'));
    const cell = state.doc.root.children![0].children![0];
    expect(cell._field).toBe('Status');
    expect(cell._component?.id).toBe('palette-status-pill'); // the look embedded
    expect((state as unknown as { undoStack: string[] }).undoStack.length).toBe(undoDepth + 1);
  });

  it('a bare column lands as the plain-value cell; an unknown field is a no-op', () => {
    state.resetAll();
    state.createView({ kind: 'row', root: { elmType: 'div', children: [{ elmType: 'div', children: [] }] } });
    const host = document.createElement('div');
    document.body.append(host);
    mountTree(host);
    const row = host.querySelectorAll<HTMLElement>('.wb-tree-row')[1];
    row.dispatchEvent(drop('Tags'));
    expect(state.doc.root.children![0].children![0].txtContent).toBe('[$Tags]');

    const before = JSON.stringify(state.doc.root);
    row.dispatchEvent(drop('Ghost'));
    expect(JSON.stringify(state.doc.root)).toBe(before);
  });
});

describe('workshop mode (spec §C, 2026-07-09 — supersedes the v1 "never re-targets" constraint)', () => {
  let wsHost: HTMLElement;
  let wsHandle: { destroy(): void } | null = null;

  const openWorkshop = (): void => {
    state.openComponentTab('builtin-deadline-chip');
    wsHost = document.createElement('div');
    document.body.append(wsHost);
    wsHandle = mountComponentWorkshop(wsHost, componentById('builtin-deadline-chip')!, {
      onToast: () => {}, onSaved: () => {}, onDirtyChange: () => {},
    });
  };

  afterEach(() => {
    wsHandle?.destroy();
    wsHandle = null;
  });

  it('renders the STAGED component tree while a workshop tab is active, back to the surface on destroy', () => {
    const host = document.createElement('div');
    document.body.append(host);
    mountTree(host);
    const gridRows = host.querySelectorAll('.wb-tree-row').length;
    openWorkshop();
    const ctx = state.workshopCtx!;
    const stagedCount = (function count(el): number {
      let n = 1;
      (el.children ?? []).forEach((c: SPElement) => { n += count(c); });
      if (el.customCardProps?.formatter) n += count(el.customCardProps.formatter);
      return n;
    })(ctx.root());
    expect(host.querySelectorAll('.wb-tree-row').length).toBe(stagedCount);
    // destroying the workshop re-targets the tree back to the surface
    wsHandle!.destroy();
    wsHandle = null;
    state.deactivateComponentTab();
    expect(host.querySelectorAll('.wb-tree-row').length).toBe(gridRows);
  });

  it('row clicks move the STAGED selection, never the app selection', () => {
    openWorkshop();
    const host = document.createElement('div');
    document.body.append(host);
    mountTree(host);
    const appSel = JSON.stringify(state.selections);
    const rows = host.querySelectorAll<HTMLElement>('.wb-tree-row');
    const target = rows[rows.length - 1];
    const wantPath = target.dataset.path === '' ? [] : target.dataset.path!.split('.').map(Number);
    target.click();
    expect(state.workshopCtx!.selection()).toEqual(wantPath);
    expect(JSON.stringify(state.selections)).toBe(appSel);
    // and the row shows selected on the next paint
    const selRow = host.querySelector('.wb-tree-row.selected');
    expect(selRow).not.toBeNull();
  });

  it('structural actions are gated off; rename rides the staged commit (modal-undo, not app undo)', () => {
    openWorkshop();
    const host = document.createElement('div');
    document.body.append(host);
    mountTree(host);
    expect(host.querySelector('.wb-tree-actions [aria-label="Delete"]')).toBeNull();
    expect(host.querySelector('.wb-tree-actions [aria-label="Move up"]')).toBeNull();
    const appUndo = (state as unknown as { undoStack: string[] }).undoStack.length;
    // rename the staged node — a non-structural edit that rides ctx.commit
    const target = host.querySelectorAll<HTMLElement>('.wb-tree-row')[1] ?? host.querySelector<HTMLElement>('.wb-tree-row')!;
    target.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    const inp = host.querySelector<HTMLInputElement>('.wb-tree-rename')!;
    inp.value = 'Renamed in workshop';
    inp.dispatchEvent(new Event('blur'));
    const ctx = state.workshopCtx!;
    const anyRenamed = (function scan(el): boolean {
      if (el._elmName === 'Renamed in workshop') return true;
      return (el.children ?? []).some((c: SPElement) => scan(c));
    })(ctx.root());
    expect(anyRenamed).toBe(true);
    expect((state as unknown as { undoStack: string[] }).undoStack.length).toBe(appUndo);
    // the workshop's own undo pair knows about it
    expect(wsHost.querySelector<HTMLButtonElement>('.wb-mu-undo')!.disabled).toBe(false);
  });
});

describe('workshop mode — Copilot findings on PR #270', () => {
  let wsHost2: HTMLElement;
  let wsHandle2: { destroy(): void } | null = null;
  afterEach(() => { wsHandle2?.destroy(); wsHandle2 = null; });

  const openPillWorkshop = (): void => {
    // a def with an embed: seed a custom that embeds the deadline chip
    state.openComponentTab('builtin-deadline-chip');
    wsHost2 = document.createElement('div');
    document.body.append(wsHost2);
    wsHandle2 = mountComponentWorkshop(wsHost2, componentById('builtin-deadline-chip')!, {
      onToast: () => {}, onSaved: () => {}, onDirtyChange: () => {},
    });
  };

  it('an embed placeholder row is keyboard-operable (Enter/Space select)', () => {
    openPillWorkshop();
    // embed the persona builtin so a placeholder row exists
    const ctx = state.workshopCtx!;
    ctx.commit(() => {
      ctx.root().children = ctx.root().children ?? [];
      ctx.root().children!.push({ elmType: 'div', _embed: 'P' });
    });
    (state.workshopCtx as unknown as { embedNameOf(el: SPElement): string | null });
    const host = document.createElement('div');
    document.body.append(host);
    mountTree(host);
    const rows = [...host.querySelectorAll<HTMLElement>('.wb-tree-row')];
    const embedRow = rows.find((r) => r.querySelector('.wb-comp-mark'));
    expect(embedRow).toBeTruthy();
    embedRow!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    const want = embedRow!.dataset.path === '' ? [] : embedRow!.dataset.path!.split('.').map(Number);
    expect(state.workshopCtx!.selection()).toEqual(want);
  });

  it('an in-progress rename is dropped when the tree re-targets (no cross-root leak)', () => {
    const host = mountDoc({ elmType: 'div', children: [{ elmType: 'span', txtContent: 'x' }] });
    const row = host.querySelectorAll<HTMLElement>('.wb-tree-row')[1];
    row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(host.querySelector('.wb-tree-rename')).not.toBeNull();
    // the workshop opens — the tree re-targets to the staged root (with two
    // staged children so the stale numeric path [1] EXISTS over there)
    openPillWorkshop();
    const wctx = state.workshopCtx!;
    wctx.commit(() => {
      wctx.root().children = [{ elmType: 'span', txtContent: 'a' }, { elmType: 'span', txtContent: 'b' }];
    });
    expect(host.querySelector('.wb-tree-rename')).toBeNull();
    // and no staged node silently gained the surface rename input on blur
    expect(JSON.stringify(state.workshopCtx!.root())).not.toContain('wb-tree-rename');
  });
});


describe('fold chevrons (2026-07-16 — synced with the JSON pane via foldState)', () => {
  const FOLD_DOC = (): SPElement => ({
    elmType: 'div',
    children: [
      { elmType: 'span', txtContent: 'x' },
      { elmType: 'div', _elmName: 'Box', children: [{ elmType: 'span', txtContent: 'y' }] },
    ],
  });

  const rowByPath = (host: HTMLElement, p: string): HTMLElement | null =>
    host.querySelector<HTMLElement>(`.wb-tree-row[data-path="${p}"]`);
  const chevronOf = (host: HTMLElement, p: string): HTMLButtonElement | null =>
    rowByPath(host, p)?.querySelector<HTMLButtonElement>('button.wb-tree-fold') ?? null;

  it('parents get a chevron button, leaves get an aria-hidden spacer of the same slot', () => {
    const host = mountDoc(FOLD_DOC());
    expect(chevronOf(host, '')).not.toBeNull();
    expect(chevronOf(host, '1')).not.toBeNull();
    const leaf = rowByPath(host, '0')!;
    expect(leaf.querySelector('button.wb-tree-fold')).toBeNull();
    const spacer = leaf.querySelector('span.wb-tree-fold.wb-tree-fold-none');
    expect(spacer).not.toBeNull();
    expect(spacer!.getAttribute('aria-hidden')).toBe('true');
    const chev = chevronOf(host, '1')!;
    expect(chev.getAttribute('aria-expanded')).toBe('true');
    expect(chev.getAttribute('aria-label')).toContain('Collapse');
  });

  it('a chevron click collapses (hides child rows, folds children:[ in the shared set) without selecting', () => {
    const host = mountDoc(FOLD_DOC());
    const before = JSON.stringify(state.selections);
    chevronOf(host, '1')!.click();
    expect(rowByPath(host, '1.0')).toBeNull();          // the child row is gone
    expect(rowByPath(host, '1')).not.toBeNull();        // the node's own row stays
    expect(foldState.has(childrenFoldKey([1]))).toBe(true); // the JSON pane folds children:[
    expect(foldState.has(elmFoldKey([1]))).toBe(false);
    expect(JSON.stringify(state.selections)).toBe(before); // never a selection gesture
    const chev = chevronOf(host, '1')!;
    expect(chev.getAttribute('aria-expanded')).toBe('false');
    chev.click(); // expand again
    expect(rowByPath(host, '1.0')).not.toBeNull();
    expect(foldState.keys()).toEqual([]);
  });

  it('a JSON-side element fold collapses the row too, and the tree expand clears BOTH fold kinds', () => {
    const host = mountDoc(FOLD_DOC());
    foldState.update('json', (set) => {
      set.add(elmFoldKey([1]));
      set.add(childrenFoldKey([1]));
    });
    expect(rowByPath(host, '1.0')).toBeNull(); // collapsed by the other surface
    chevronOf(host, '1')!.click();
    expect(rowByPath(host, '1.0')).not.toBeNull();
    expect(foldState.keys()).toEqual([]); // elm AND children keys cleared
  });

  it('an elm fold hides the card subtree; a card-only node folds its element object', () => {
    const host = mountDoc({
      elmType: 'div',
      children: [{
        elmType: 'button',
        txtContent: 'c',
        customCardProps: {
          openOnEvent: 'hover',
          formatter: { elmType: 'div', children: [{ elmType: 'span', txtContent: 'inside' }] },
        },
      }],
    });
    expect(host.querySelector('.wb-tree-cardnote')).not.toBeNull();
    const chev = chevronOf(host, '0')!;
    expect(chev).not.toBeNull(); // card-only nodes are foldable too
    chev.click();
    expect(foldState.has(elmFoldKey([0]))).toBe(true); // the only JSON fold that hides a card
    expect(host.querySelector('.wb-tree-cardnote')).toBeNull();
    expect(rowByPath(host, `0.${-1}`)).toBeNull();
    chevronOf(host, '0')!.click();
    expect(host.querySelector('.wb-tree-cardnote')).not.toBeNull();
  });

  it('a collapsed row that hides the selection is marked, live across selection-only emits', () => {
    const host = mountDoc(FOLD_DOC());
    state.select([1, 0]);
    chevronOf(host, '1')!.click();
    expect(rowByPath(host, '1')!.classList.contains('wb-tree-holdsel')).toBe(true);
    state.select([0]); // selection-only emit — no full re-render
    expect(rowByPath(host, '1')!.classList.contains('wb-tree-holdsel')).toBe(false);
    state.select([1, 0]);
    expect(rowByPath(host, '1')!.classList.contains('wb-tree-holdsel')).toBe(true);
  });

  it('ArrowLeft collapses and ArrowRight expands a focused foldable row', () => {
    const host = mountDoc(FOLD_DOC());
    const key = (p: string, k: string) => rowByPath(host, p)!.dispatchEvent(
      new KeyboardEvent('keydown', { key: k, bubbles: true }));
    key('1', 'ArrowLeft');
    expect(foldState.has(childrenFoldKey([1]))).toBe(true);
    expect(rowByPath(host, '1.0')).toBeNull();
    key('1', 'ArrowRight');
    expect(foldState.keys()).toEqual([]);
    expect(rowByPath(host, '1.0')).not.toBeNull();
  });

  it('workshop collapses stay LOCAL — nothing lands in the shared foldState', () => {
    state.openComponentTab('builtin-deadline-chip');
    const wsHost = document.createElement('div');
    document.body.append(wsHost);
    const handle = mountComponentWorkshop(wsHost, componentById('builtin-deadline-chip')!, {
      onToast: () => {}, onSaved: () => {}, onDirtyChange: () => {},
    });
    const ctx = state.workshopCtx!;
    ctx.commit(() => {
      ctx.root().children = [{ elmType: 'span', txtContent: 'a' }];
    });
    const host = document.createElement('div');
    document.body.append(host);
    mountTree(host);
    const chev = host.querySelector<HTMLButtonElement>('.wb-tree-row[data-path=""] button.wb-tree-fold');
    expect(chev).not.toBeNull();
    chev!.click();
    expect(host.querySelector('.wb-tree-row[data-path="0"]')).toBeNull(); // collapsed here…
    expect(foldState.keys()).toEqual([]); // …but the shared set never heard of it
    handle.destroy();
    state.deactivateComponentTab();
  });
});
