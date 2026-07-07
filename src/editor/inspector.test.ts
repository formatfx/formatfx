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
import { ALLOWED_STYLES, STYLE_VALUE_SUGGESTIONS } from '../core/schema';
import { lintDocument } from '../core/linter';
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

// ─── #221: the visual Flex layout group ──────────────────────────────────────

/** A row view whose first child is a two-child box wearing `style`. */
function viewWithBox(style?: Record<string, string>): void {
  state.createView({
    kind: 'row',
    root: {
      elmType: 'div',
      children: [{
        elmType: 'div',
        ...(style ? { style } : {}),
        children: [{ elmType: 'span', txtContent: 'a' }, { elmType: 'span', txtContent: 'b' }],
      }],
    },
  });
  state.select([0]);
}

const boxStyle = (): Record<string, unknown> | undefined =>
  state.doc.root.children![0].style as Record<string, unknown> | undefined;

const flexBtn = (host: HTMLElement, prop: string, value: string): HTMLButtonElement =>
  host.querySelector<HTMLButtonElement>(`.wb-flexbtn[data-prop="${prop}"][data-value="${value}"]`)!;

describe('the visual Flex layout group (#221)', () => {
  it('refuses alignment controls on a non-flex element — the one-click make-flex door instead', () => {
    viewWithBox(); // no style at all
    const host = mount();
    expect(host.querySelectorAll('.wb-flexbtn')).toHaveLength(0); // never stamp no-op props
    const make = host.querySelector<HTMLButtonElement>('.wb-flex-make')!;
    expect(make.textContent).toContain('Make this a flex container');
    const before = undoDepth();
    make.click();
    expect(boxStyle()).toEqual({ display: 'flex' });
    expect(undoDepth()).toBe(before + 1); // ONE undoable step
    // the controls appear in place (local re-render on self-commit)
    expect(host.querySelectorAll('.wb-flexbtn').length).toBeGreaterThan(0);
    state.undo();
    expect(boxStyle()).toBeUndefined();
  });

  it('a display already set to something else is replaced honestly (the tooltip says so)', () => {
    viewWithBox({ display: 'block' });
    const host = mount();
    const make = host.querySelector<HTMLButtonElement>('.wb-flex-make')!;
    expect(make.title).toContain('display: block');
    make.click();
    expect(boxStyle()).toEqual({ display: 'flex' });
  });

  it('inline-flex and a conditional =if(…,"flex") display both count as flex containers', () => {
    viewWithBox({ display: 'inline-flex' });
    const host = mount();
    expect(host.querySelector('.wb-flex-make')).toBeNull();
    expect(host.querySelectorAll('.wb-flexbtn').length).toBeGreaterThan(0);

    viewWithBox({ display: "=if([$Done],'none','flex')" });
    expect(host.querySelector('.wb-flex-make')).toBeNull();
    expect(host.querySelectorAll('.wb-flexbtn').length).toBeGreaterThan(0);
  });

  it('renders all three rows with the full visual vocabulary, in the Simple lens too', () => {
    state.setLens('simple');
    viewWithBox({ display: 'flex' });
    const host = mount();
    const values = (prop: string) =>
      [...host.querySelectorAll<HTMLButtonElement>(`.wb-flexbtn[data-prop="${prop}"]`)].map((b) => b.dataset.value);
    expect(values('flex-direction')).toEqual(['row', 'column', 'row-reverse', 'column-reverse']);
    expect(values('justify-content')).toEqual(['flex-start', 'center', 'flex-end', 'space-between', 'space-around']);
    expect(values('align-items')).toEqual(['flex-start', 'center', 'flex-end', 'stretch']);
    // arrows on the direction buttons; live mini-diagram glyphs on the rest
    expect(flexBtn(host, 'flex-direction', 'row').querySelector('.wb-flexdir-arrow')?.textContent).toBe('→');
    expect(flexBtn(host, 'flex-direction', 'column').querySelector('.wb-flexdir-arrow')?.textContent).toBe('↓');
    expect(flexBtn(host, 'flex-direction', 'row-reverse').querySelector('.wb-flexdir-arrow')?.textContent).toBe('←');
    expect(flexBtn(host, 'flex-direction', 'column-reverse').querySelector('.wb-flexdir-arrow')?.textContent).toBe('↑');
    expect(flexBtn(host, 'justify-content', 'space-between').querySelector('.wb-flexglyph')).not.toBeNull();
    expect(flexBtn(host, 'align-items', 'stretch').querySelector('.wb-flexglyph')).not.toBeNull();
  });

  it('reflects the current values — explicit sets read active, unset props highlight the CSS default softly', () => {
    viewWithBox({ display: 'flex', 'flex-direction': 'column', 'justify-content': 'center' });
    const host = mount();
    expect(flexBtn(host, 'flex-direction', 'column').classList.contains('active')).toBe(true);
    expect(flexBtn(host, 'flex-direction', 'column').classList.contains('implicit')).toBe(false);
    expect(flexBtn(host, 'flex-direction', 'row').classList.contains('active')).toBe(false);
    expect(flexBtn(host, 'justify-content', 'center').classList.contains('active')).toBe(true);
    // align-items is NOT set → the default (stretch) is highlighted, marked implicit
    const stretch = flexBtn(host, 'align-items', 'stretch');
    expect(stretch.classList.contains('active')).toBe(true);
    expect(stretch.classList.contains('implicit')).toBe(true);
  });

  it('tooltips carry the CSS property and value names', () => {
    viewWithBox({ display: 'flex', 'justify-content': 'center' });
    const host = mount();
    expect(flexBtn(host, 'flex-direction', 'row-reverse').title).toContain('flex-direction: row-reverse');
    expect(flexBtn(host, 'align-items', 'stretch').title).toContain('align-items: stretch');
    expect(flexBtn(host, 'justify-content', 'space-around').title).toContain('justify-content: space-around');
    // the set value teaches the clear gesture
    expect(flexBtn(host, 'justify-content', 'center').title).toContain('click again to clear');
  });

  it('a click writes the property — ONE undo step, reflected immediately', () => {
    viewWithBox({ display: 'flex' });
    const host = mount();
    const before = undoDepth();
    flexBtn(host, 'justify-content', 'space-between').click();
    expect(boxStyle()).toEqual({ display: 'flex', 'justify-content': 'space-between' });
    expect(undoDepth()).toBe(before + 1);
    // the group re-rendered itself: the clicked value now reads active (explicit)
    const b = flexBtn(host, 'justify-content', 'space-between');
    expect(b.classList.contains('active')).toBe(true);
    expect(b.classList.contains('implicit')).toBe(false);
    state.undo(); // one Ctrl+Z reverts the click
    expect(boxStyle()).toEqual({ display: 'flex' });
  });

  it('clicking the active (set) value clears the property back to default — also one undo step', () => {
    viewWithBox({ display: 'flex', 'align-items': 'center' });
    const host = mount();
    const before = undoDepth();
    flexBtn(host, 'align-items', 'center').click();
    expect(boxStyle()).toEqual({ display: 'flex' }); // cleared, display untouched
    expect(undoDepth()).toBe(before + 1);
    // the default (stretch) takes the highlight back over
    expect(flexBtn(host, 'align-items', 'stretch').classList.contains('implicit')).toBe(true);
    state.undo();
    expect(boxStyle()).toEqual({ display: 'flex', 'align-items': 'center' });
  });

  it('justify/align glyphs follow the current direction — a column container previews vertically', () => {
    viewWithBox({ display: 'flex', 'flex-direction': 'column' });
    const host = mount();
    const glyph = flexBtn(host, 'justify-content', 'center').querySelector<HTMLElement>('.wb-flexglyph')!;
    expect(glyph.style.getPropertyValue('flex-direction')).toBe('column');
  });

  it('every emitted value is on the SP schema allow-list and lints clean', () => {
    viewWithBox({ display: 'flex' });
    const host = mount();
    const offered = [...host.querySelectorAll<HTMLButtonElement>('.wb-flexbtn')]
      .map((b) => [b.dataset.prop!, b.dataset.value!] as const);
    expect(offered.length).toBe(4 + 5 + 4);
    for (const [prop, value] of offered) {
      expect(ALLOWED_STYLES.has(prop)).toBe(true);
      // the schema's own value vocabulary for the property carries every offer
      expect(STYLE_VALUE_SUGGESTIONS[prop]).toContain(value);
    }
    // drive every button once — the document must stay lint-clean on css rules
    for (const [prop, value] of offered) {
      flexBtn(host, prop, value).click();
      expect(lintDocument(state.doc).filter((i) => i.rule.startsWith('css-'))).toEqual([]);
      const written = boxStyle()?.[prop];
      if (written !== undefined) expect(written).toBe(value);
    }
  });

  it('multi-select: one click writes the property to EVERY selected node as one undo step', () => {
    state.createView({
      kind: 'row',
      root: {
        elmType: 'div',
        children: [
          { elmType: 'div', style: { display: 'flex' }, children: [{ elmType: 'span', txtContent: 'a' }] },
          { elmType: 'div', style: { display: 'flex' }, children: [{ elmType: 'span', txtContent: 'b' }] },
        ],
      },
    });
    state.selectMulti([[0], [1]]);
    const host = mount();
    const before = undoDepth();
    flexBtn(host, 'flex-direction', 'column').click();
    expect(state.doc.root.children![0].style?.['flex-direction']).toBe('column');
    expect(state.doc.root.children![1].style?.['flex-direction']).toBe('column');
    expect(undoDepth()).toBe(before + 1);
  });
});

// ─── Theme colors: the primary theme-aware picker (theme style classes) ────────

function selectPlain(el: Partial<SPElement> = {}): void {
  state.createView({
    kind: 'row',
    root: { elmType: 'div', children: [{ elmType: 'div', txtContent: 'x', ...el } as SPElement] },
  });
  state.select([0]);
}
const node0 = (): SPElement => state.doc.root.children![0];
/** Find a theme swatch by the class token in its title (tokens are unique). */
function tcSwatch(host: HTMLElement, token: string): HTMLButtonElement {
  return [...host.querySelectorAll<HTMLButtonElement>('.wb-fc-swatch')].find((b) => b.title.includes(token))!;
}
function fillNoneChip(host: HTMLElement): HTMLButtonElement {
  const fillRow = [...host.querySelectorAll<HTMLElement>('.wb-field-row')]
    .find((r) => r.querySelector('.wb-field-label')?.textContent === 'Fill')!;
  return fillRow.querySelector<HTMLButtonElement>('.wb-fc-chip')!;
}

describe('Theme colors — the primary theme-aware color picker', () => {
  it('a Fill swatch writes attributes.class and clears the conflicting inline style, in one undo step', () => {
    selectPlain({ style: { 'background-color': '#d13438', color: '#fff' } });
    const host = mount();
    const before = undoDepth();
    tcSwatch(host, 'ms-bgColor-green').click();
    expect(node0().attributes?.class).toBe('ms-bgColor-green');
    expect(node0().style?.['background-color']).toBeUndefined(); // dead inline value cleared
    expect(node0().style?.color).toBe('#fff');                   // sibling untouched
    expect(undoDepth()).toBe(before + 1);
  });

  it('the demoted inline Background row shows "(governed by …)" once a theme fill is set', () => {
    selectPlain();
    const host = mount();
    tcSwatch(host, 'ms-bgColor-green').click(); // re-renders (direct mutate, not a selfCommit)
    expect(host.querySelector('.wb-governed-hint')?.textContent).toContain('ms-bgColor-green');
    expect(host.querySelector('.wb-field-row.wb-row-governed')).not.toBeNull();
  });

  it('the Status sub-row emits a severity class, replacing a solid fill on the same slot', () => {
    selectPlain({ attributes: { class: 'ms-bgColor-red' } });
    const host = mount();
    tcSwatch(host, 'sp-field-severity--blocked').click();
    expect(node0().attributes?.class).toBe('sp-field-severity--blocked');
  });

  it('"none" clears the theme fill', () => {
    selectPlain({ attributes: { class: 'ms-bgColor-green' } });
    const host = mount();
    fillNoneChip(host).click();
    expect(node0().attributes?.class).toBeUndefined();
  });

  it('refuses a formula-valued class — shows a note, offers no swatches, changes nothing', () => {
    const formula = "=if([$Status]=='Done','ms-bgColor-green','')";
    selectPlain({ attributes: { class: formula } });
    const host = mount();
    expect(host.querySelector('.wb-tc-note')).not.toBeNull();
    expect(host.querySelectorAll('.wb-fc-swatch').length).toBe(0);
    expect(node0().attributes?.class).toBe(formula);
  });
});
