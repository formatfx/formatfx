/**
 * The inspector's INSTANCE card (happy-dom) — COLUMNS-COMPONENTS-VIEWS §3.6:
 * a selected node stamped `_component` leads with a ⬡ card ahead of the
 * element sections — the def's name, one type-filtered "bound to" select per
 * slot (change = ONE undoable re-bake via the instance's updated map), the
 * workshop door, and "Detach to plain elements". A grid LOOK cell (a
 * `_field` cell whose column wears a look) also offers "Remove the look",
 * and its re-binds keep the look STORE and the placed cell in lockstep.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mountInspector } from './inspector';
import { state } from './state';
import { BUILTIN_COMPONENTS, bindComponentInstance } from './components';
import type { SPElement } from '../core/types';

const DEADLINE = BUILTIN_COMPONENTS[0]; // one 'Due' slot, types ['date']

function mount(toasts: string[] = []): HTMLElement {
  const host = document.createElement('div');
  document.body.appendChild(host);
  mountInspector(host, { toast: (m) => toasts.push(m) });
  return host;
}

/** A row view whose second child is a bound Deadline-chip instance. */
function viewWithInstance(): void {
  state.createView({
    kind: 'row',
    root: {
      elmType: 'div',
      children: [
        { elmType: 'span', txtContent: 'plain' },
        bindComponentInstance(DEADLINE, { Due: 'DueDate' }),
      ],
    },
  });
  state.select([1]);
}

const undoDepth = (): number => (state as unknown as { undoStack: string[] }).undoStack.length;

beforeEach(() => {
  document.body.innerHTML = '';
  localStorage.clear();
  state.resetAll();
  state.setLens('pro');
});

// unhook every mounted inspector from the state store — a leaked subscriber
// keeps re-rendering into its detached host on every state change, and the
// accumulated drag times later tests out
afterEach(() => {
  document.querySelectorAll<HTMLElement>('body > *').forEach((el) => {
    (el as unknown as { _unsub?: () => void })._unsub?.();
    el.remove();
  });
});

describe('when the card shows', () => {
  it('leads the pane for a stamped instance; a plain node gets no card', () => {
    viewWithInstance();
    const host = mount();
    const card = host.querySelector('.wb-inst-card');
    expect(card).not.toBeNull();
    expect(card!.querySelector('.wb-comp-mark')?.textContent).toBe('⬡');
    expect(card!.querySelector('.wb-inst-name')?.textContent).toBe('Deadline chip');
    // ahead of the sections: the card is the pane's first rendered block
    expect(host.firstElementChild).toBe(card);

    state.select([0]); // the plain span
    expect(host.querySelector('.wb-inst-card')).toBeNull();
  });

  it('shows in the Simple lens too — provenance is a maker concept', () => {
    state.setLens('simple');
    viewWithInstance();
    const host = mount();
    expect(host.querySelector('.wb-inst-card')).not.toBeNull();
  });

  it('a deleted def reads honestly and still offers Detach (but no slots, no workshop)', () => {
    state.createView({
      kind: 'row',
      root: { elmType: 'div', children: [{ elmType: 'div', txtContent: 'x', _component: { id: 'c-ghost', map: {} } } as SPElement] },
    });
    state.select([0]);
    const host = mount();
    expect(host.querySelector('.wb-inst-name')?.textContent).toContain('no longer in the library');
    expect(host.querySelector('.wb-inst-open')).toBeNull();
    expect(host.querySelector('.wb-inst-slot')).toBeNull();
    expect(host.querySelector('.wb-inst-detach')).not.toBeNull();
  });
});

describe('per-slot re-binding (type-filtered, one undo step)', () => {
  it('offers only columns the slot\'s types accept, current binding selected', () => {
    viewWithInstance();
    const host = mount();
    const sel = host.querySelector<HTMLSelectElement>('.wb-inst-slot-select[data-slot="Due"]')!;
    expect(sel.value).toBe('DueDate');
    // the default schema has exactly one date column — no wrong-typed offers
    expect([...sel.options].map((o) => o.value)).toEqual(['DueDate']);
  });

  it('changing the select re-bakes the instance from its def with the updated map — ONE undo step', () => {
    state.fields.push({ name: 'Review', type: 'date' });
    viewWithInstance();
    const host = mount();
    const before = undoDepth();
    const sel = host.querySelector<HTMLSelectElement>('.wb-inst-slot-select[data-slot="Due"]')!;
    sel.value = 'Review';
    sel.dispatchEvent(new Event('change'));
    const node = state.doc.root.children![1];
    expect(node._component?.map).toEqual({ Due: 'Review' });
    expect(JSON.stringify(node.txtContent)).toContain('[$Review]'); // the tree re-baked
    expect(JSON.stringify(node.txtContent)).not.toContain('[$DueDate]');
    expect(undoDepth()).toBe(before + 1);
    state.undo();
    expect(state.doc.root.children![1]._component?.map).toEqual({ Due: 'DueDate' });
  });

  it('a grid LOOK cell re-binds through applyComponentToColumn — store and cell in lockstep', () => {
    state.fields.push({ name: 'Review', type: 'date' });
    state.applyComponentToColumn('DueDate', DEADLINE, { Due: 'DueDate' });
    const i = state.floorDoc.root.children!.findIndex((c) => c._field === 'DueDate');
    state.select([i]);
    const host = mount();
    const before = undoDepth();
    const sel = host.querySelector<HTMLSelectElement>('.wb-inst-slot-select[data-slot="Due"]')!;
    sel.value = 'Review';
    sel.dispatchEvent(new Event('change'));
    expect(state.columnLooks.DueDate._component?.map).toEqual({ Due: 'Review' });
    expect(state.floorDoc.root.children![i]._component?.map).toEqual({ Due: 'Review' });
    expect(undoDepth()).toBe(before + 1);
    state.undo(); // one Ctrl+Z reverts BOTH
    expect(state.columnLooks.DueDate._component?.map).toEqual({ Due: 'DueDate' });
    expect(state.floorDoc.root.children![i]._component?.map).toEqual({ Due: 'DueDate' });
  });
});

// ─── the #212 click-action door: inline edit, multi-setValue, confirm recipe ──

/** A row view whose first child is a candidate division showing `ref`. */
function viewShowing(ref: string): void {
  state.createView({
    kind: 'row',
    root: {
      elmType: 'div',
      children: [{ elmType: 'div', children: [{ elmType: 'span', txtContent: ref }] }],
    },
  });
  state.select([0]);
}

function pickKind(host: HTMLElement, kind: string): void {
  const sel = host.querySelector<HTMLSelectElement>('.wb-cs-kind')!;
  sel.value = kind;
  sel.dispatchEvent(new Event('change', { bubbles: true }));
}

describe('the click-action picker (#212) — inline edit as a first-class action', () => {
  it('offers the flat vocabulary with value-writing actions last and ✏️-marked (click-only safety)', () => {
    viewShowing('[$Title]');
    const host = mount();
    const kindSel = host.querySelector<HTMLSelectElement>('.wb-cs-kind')!;
    expect([...kindSel.options].map((o) => o.value))
      .toEqual(['defaultClick', 'link', 'executeFlow', 'inlineEdit', 'confirmEdit', 'setValue']);
    const labels = [...kindSel.options].map((o) => o.textContent ?? '');
    expect(labels).toContain('✏️ Edit inline — type a new value right here');
    // every action that writes list data is marked; no read-only action is
    for (const l of labels) {
      expect(l.startsWith('✏️')).toBe(/inline|confirm|setValue/i.test(l));
    }
  });

  it('defaults the target to the shown column, pins it, and stamps inlineEditField as ONE undo step (no overlay)', () => {
    viewShowing('[$Title]');
    const host = mount();
    pickKind(host, 'inlineEdit');
    const fieldSel = host.querySelector<HTMLSelectElement>('.wb-cs-inlinefield')!;
    expect(fieldSel.value).toBe('Title'); // the column the element displays
    expect(fieldSel.disabled).toBe(true); // pinned until the 2a checkbox opts out
    const gen = host.querySelector<HTMLButtonElement>('.wb-cs-gen')!;
    expect(gen.disabled).toBe(false);
    const before = undoDepth();
    gen.click();
    const node = state.doc.root.children![0];
    expect(node.inlineEditField).toBe('[$Title]');
    expect(node.children).toHaveLength(1); // rides the element — no overlay child
    expect(node.customRowAction).toBeUndefined();
    expect(undoDepth()).toBe(before + 1);
    state.undo();
    expect(state.doc.root.children![0].inlineEditField).toBeUndefined();
  });

  it('type-filters to Text & Person: unsupported columns greyed WITH a reason, never offered silently', () => {
    viewShowing('[$Status]'); // Choice — not inline-editable
    const host = mount();
    pickKind(host, 'inlineEdit');
    const fieldSel = host.querySelector<HTMLSelectElement>('.wb-cs-inlinefield')!;
    expect(fieldSel.value).toBe(''); // refuses to guess a default
    expect(fieldSel.disabled).toBe(false);
    const opt = (name: string) => [...fieldSel.options].find((o) => o.value === name)!;
    expect(opt('Status').disabled).toBe(true);
    expect(opt('Status').title).toMatch(/Text & Person columns only/);
    expect(opt('DueDate').disabled).toBe(true);
    expect(opt('ID').disabled).toBe(true); // protected system column
    expect(opt('Title').disabled).toBe(false);
    expect(opt('Owner').disabled).toBe(false);
    expect(opt('AssignedTo').disabled).toBe(false); // personMulti IS a Person column
    // the shown column's refusal is taught inline, not hidden
    expect(host.querySelector('.wb-cs-note')?.textContent).toMatch(/Choice column/);
    const gen = host.querySelector<HTMLButtonElement>('.wb-cs-gen')!;
    expect(gen.disabled).toBe(true); // refuse until a supported column is picked
    fieldSel.value = 'Owner';
    fieldSel.dispatchEvent(new Event('change', { bubbles: true }));
    expect(gen.disabled).toBe(false);
    gen.click();
    expect(state.doc.root.children![0].inlineEditField).toBe('[$Owner]');
  });

  it('2a: "Write to a different column than the one shown" unlocks the (still filtered) target picker', () => {
    viewShowing('[$Title]');
    const host = mount();
    pickKind(host, 'inlineEdit');
    const cb = host.querySelector<HTMLInputElement>('.wb-cs-difftarget')!;
    expect(cb.checked).toBe(false);
    cb.checked = true;
    cb.dispatchEvent(new Event('change', { bubbles: true }));
    const fieldSel = host.querySelector<HTMLSelectElement>('.wb-cs-inlinefield')!; // rebuilt
    expect(fieldSel.disabled).toBe(false);
    expect(fieldSel.value).toBe('Title'); // still defaults to the shown column
    fieldSel.value = 'Tags';
    fieldSel.dispatchEvent(new Event('change', { bubbles: true }));
    host.querySelector<HTMLButtonElement>('.wb-cs-gen')!.click();
    expect(state.doc.root.children![0].inlineEditField).toBe('[$Tags]');
  });
});

describe('the multi-row setValue form (#212 part 2b)', () => {
  it('grows to ordered rows, refuses blanks and duplicates, and emits one multi-entry actionInput', () => {
    viewShowing('[$Title]');
    const host = mount();
    pickKind(host, 'setValue');
    const gen = host.querySelector<HTMLButtonElement>('.wb-cs-gen')!;
    expect(gen.disabled).toBe(true);
    const setRow = (i: number, field: string, value: string) => {
      const f = host.querySelectorAll<HTMLSelectElement>('.wb-cs-field')[i];
      f.value = field;
      f.dispatchEvent(new Event('change', { bubbles: true }));
      const v = host.querySelectorAll<HTMLInputElement>('.wb-cs-value')[i];
      v.value = value;
      v.dispatchEvent(new Event('input', { bubbles: true }));
    };
    setRow(0, 'Status', 'Done');
    expect(gen.disabled).toBe(false);
    host.querySelector<HTMLButtonElement>('.wb-cs-addrow')!.click();
    expect(host.querySelectorAll('.wb-cs-field')).toHaveLength(2);
    expect(gen.disabled).toBe(true); // the new row is blank — refuse
    setRow(1, 'Status', 'x'); // same column twice — last-wins is a silent trap
    expect(gen.disabled).toBe(true);
    setRow(1, 'Tags', 'reviewed');
    expect(gen.disabled).toBe(false);
    gen.click();
    const overlay = state.doc.root.children![0].children![1];
    expect(overlay.customRowAction).toEqual({
      action: 'setValue',
      actionInput: { Status: 'Done', Tags: 'reviewed' },
    });
    // entries emit IN ROW ORDER — the draft-commit pattern depends on it
    expect(Object.keys(overlay.customRowAction!.actionInput as Record<string, unknown>))
      .toEqual(['Status', 'Tags']);
  });

  it('a row can be removed again', () => {
    viewShowing('[$Title]');
    const host = mount();
    pickKind(host, 'setValue');
    host.querySelector<HTMLButtonElement>('.wb-cs-addrow')!.click();
    expect(host.querySelectorAll('.wb-cs-field')).toHaveLength(2);
    host.querySelector<HTMLButtonElement>('.wb-cs-removerow')!.click();
    expect(host.querySelectorAll('.wb-cs-field')).toHaveLength(1);
  });
});

describe('the "Editable with confirm" recipe (#212 part 2b)', () => {
  it('one gesture stamps the whole loop — draft edit surface + gated confirm row — as ONE undo step', () => {
    viewShowing('[$Status]');
    const host = mount();
    pickKind(host, 'confirmEdit');
    const real = host.querySelector<HTMLSelectElement>('.wb-cs-real')!;
    expect(real.value).toBe('Status'); // defaults to the shown column
    const draft = host.querySelector<HTMLSelectElement>('.wb-cs-draft')!;
    // only scratch Text columns are offered as drafts
    expect([...draft.options].filter((o) => o.value !== '').map((o) => o.value)).toEqual(['Title', 'Tags']);
    const gen = host.querySelector<HTMLButtonElement>('.wb-cs-gen')!;
    expect(gen.disabled).toBe(true); // the draft is a deliberate choice — no guessed default
    draft.value = 'Tags';
    draft.dispatchEvent(new Event('change', { bubbles: true }));
    expect(gen.disabled).toBe(false);
    const before = undoDepth();
    gen.click();

    const node = state.doc.root.children![0];
    expect(node.children).toHaveLength(2);
    const [surface, confirm] = node.children!;
    expect(surface.inlineEditField).toBe('[$Tags]');
    expect(surface.children![0].txtContent).toBe('[$Status]'); // original content wrapped
    expect(String(confirm.style?.display)).toBe("=if([$Tags]!='','flex','none')");
    const save = confirm.children!.find((c) => c.txtContent === 'Save')!;
    expect(save.customRowAction).toEqual({ action: 'setValue', actionInput: { Status: '[$Tags]', Tags: '' } });
    const cancel = confirm.children!.find((c) => c.txtContent === 'Cancel')!;
    expect(cancel.customRowAction).toEqual({ action: 'setValue', actionInput: { Tags: '' } });

    expect(undoDepth()).toBe(before + 1);
    state.undo(); // ONE Ctrl+Z reverts the whole assembly
    const back = state.doc.root.children![0];
    expect(back.children).toHaveLength(1);
    expect(back.children![0].inlineEditField).toBeUndefined();
  });

  it('the draft picker greys the chosen real column — a draft must be a different column', () => {
    viewShowing('[$Title]'); // Title (a Text column) is both shown and the default real
    const host = mount();
    pickKind(host, 'confirmEdit');
    const draft = host.querySelector<HTMLSelectElement>('.wb-cs-draft')!;
    const title = [...draft.options].find((o) => o.value === 'Title')!;
    expect(title.disabled).toBe(true);
    expect(title.title).toMatch(/real column/);
    expect([...draft.options].find((o) => o.value === 'Tags')!.disabled).toBe(false);
  });

  it('a protected displayed column never rides into the recipe as the default real target', () => {
    viewShowing('[$ID]'); // the element shows a protected system column
    const host = mount();
    pickKind(host, 'confirmEdit');
    // the picker only offers writable columns, so the seed stays empty …
    expect(host.querySelector<HTMLSelectElement>('.wb-cs-real')!.value).toBe('');
    const draft = host.querySelector<HTMLSelectElement>('.wb-cs-draft')!;
    draft.value = 'Tags';
    draft.dispatchEvent(new Event('change', { bubbles: true }));
    // … and Generate stays off until the maker deliberately picks one
    expect(host.querySelector<HTMLButtonElement>('.wb-cs-gen')!.disabled).toBe(true);
  });

  it('refuses and TEACHES when the schema has no scratch Text column — never writes straight to the real field', () => {
    state.fields = state.fields.filter((f) => f.type !== 'text');
    viewShowing('[$Status]');
    const host = mount();
    pickKind(host, 'confirmEdit');
    expect(host.querySelector('.wb-cs-draft')).toBeNull();
    expect(host.querySelector('.wb-cs-note')?.textContent).toMatch(/Add a single-line text column/);
    expect(host.querySelector<HTMLButtonElement>('.wb-cs-gen')!.disabled).toBe(true);
  });
});

describe('the card actions', () => {
  it('"Open in workshop ✎" opens the def\'s canvas tab', () => {
    viewWithInstance();
    const host = mount();
    (host.querySelector('.wb-inst-open') as HTMLButtonElement).click();
    expect(state.activeComponentTab).toBe(DEADLINE.id);
    expect(state.openTabs.some((t) => t.kind === 'component' && t.defId === DEADLINE.id)).toBe(true);
    state.deactivateComponentTab();
  });

  it('"Detach to plain elements" deletes the stamp, keeps the tree, teaches — one undo step', () => {
    const toasts: string[] = [];
    viewWithInstance();
    const host = mount(toasts);
    const before = undoDepth();
    (host.querySelector('.wb-inst-detach') as HTMLButtonElement).click();
    const node = state.doc.root.children![1];
    expect(node._component).toBeUndefined();
    expect(node.txtContent).toBeDefined(); // the elements stayed
    expect(undoDepth()).toBe(before + 1);
    expect(toasts.some((t) => t.includes('workshop edits won\'t reach'))).toBe(true);
    // the card is gone from the re-rendered pane — it's plain elements now
    expect(host.querySelector('.wb-inst-card')).toBeNull();
  });

  it('a grid look cell also detaches its STORED look (no silent restamp later)', () => {
    state.applyComponentToColumn('DueDate', DEADLINE, { Due: 'DueDate' });
    const i = state.floorDoc.root.children!.findIndex((c) => c._field === 'DueDate');
    state.select([i]);
    const host = mount();
    (host.querySelector('.wb-inst-detach') as HTMLButtonElement).click();
    expect(state.floorDoc.root.children![i]._component).toBeUndefined();
    expect(state.columnLooks.DueDate._component).toBeUndefined(); // unstamped, imported-like
    expect(Object.hasOwn(state.columnLooks, 'DueDate')).toBe(true); // the look itself survives
  });

  it('"Remove the look" appears ONLY for a grid look cell and routes to removeColumnLook', () => {
    viewWithInstance();
    const host = mount();
    expect(host.querySelector('.wb-inst-removelook')).toBeNull(); // a view instance is not a look

    state.minimizeView();
    state.applyComponentToColumn('DueDate', DEADLINE, { Due: 'DueDate' });
    const i = state.floorDoc.root.children!.findIndex((c) => c._field === 'DueDate');
    state.select([i]);
    const before = undoDepth();
    (host.querySelector('.wb-inst-removelook') as HTMLButtonElement).click();
    expect(Object.hasOwn(state.columnLooks, 'DueDate')).toBe(false);
    expect(state.floorDoc.root.children![i]._component).toBeUndefined(); // plain cell again
    expect(undoDepth()).toBe(before + 1);
  });
});
