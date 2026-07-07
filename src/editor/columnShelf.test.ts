/**
 * The COLUMNS SHELF (happy-dom) — COLUMNS-COMPONENTS-VIEWS §3.4: one typed
 * chip per non-protected field; chips are DATA — draggable (FIELD_MIME,
 * payload = the field name) and click-to-insert through gridCellForField (a
 * look-wearing column arrives dressed, a bare one as the plain value), but
 * they carry NO formatter state of their own. Insert = ONE undoable step; on
 * the grid it lands as a new root column; a workshop covering the canvas
 * refuses and teaches.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { mountColumnShelf, FIELD_MIME } from './columnShelf';
import { FIELD_MIME as TEMPLATE_FIELD_MIME } from './templateUi';
import { state } from './state';

function mount(toasts: string[] = []): HTMLElement {
  const host = document.createElement('div');
  document.body.appendChild(host);
  mountColumnShelf(host, (m) => toasts.push(m));
  return host;
}

const chipFor = (host: HTMLElement, name: string): HTMLButtonElement =>
  [...host.querySelectorAll<HTMLButtonElement>('.wb-colchip')]
    .find((c) => c.querySelector('.wb-colchip-name')?.textContent === name)!;

beforeEach(() => {
  document.body.innerHTML = '';
  state.resetAll();
});

describe('the shelf', () => {
  it('renders one chip per NON-PROTECTED field: "Name" + a dim type tag', () => {
    const host = mount();
    const names = [...host.querySelectorAll('.wb-colchip-name')].map((n) => n.textContent);
    // the default schema: ID is protected and must not appear
    expect(names).toEqual(state.fields.filter((f) => !f.protected).map((f) => f.displayName ?? f.name));
    expect(names).not.toContain('ID');
    expect(chipFor(host, 'DueDate').querySelector('.wb-colchip-type')?.textContent).toBe('date');
    expect(chipFor(host, 'AssignedTo').querySelector('.wb-colchip-type')?.textContent).toBe('multi-person');
  });

  it('chips carry NO formatter state — a dressed column\'s chip looks exactly like a bare one', () => {
    const host = mount();
    // Status wears a look in the default workspace; Title doesn't
    expect(Object.hasOwn(state.columnLooks, 'Status')).toBe(true);
    const status = chipFor(host, 'Status');
    const title = chipFor(host, 'Title');
    expect(status.querySelector('.wb-comp-mark')).toBeNull();
    expect(status.querySelectorAll('*').length).toBe(title.querySelectorAll('*').length);
  });

  it('re-renders on schema changes', () => {
    const host = mount();
    state.fields.push({ name: 'Budget', type: 'currency' });
    state.emit('data');
    expect(chipFor(host, 'Budget').querySelector('.wb-colchip-type')?.textContent).toBe('currency');
  });

  it('FIELD_MIME is the one shared field payload (templateUi\'s declaration, re-exported)', () => {
    expect(FIELD_MIME).toBe('application/x-wb-field');
    expect(FIELD_MIME).toBe(TEMPLATE_FIELD_MIME);
  });

  it('chips are drag sources: FIELD_MIME payload = the field NAME', () => {
    const host = mount();
    const chip = chipFor(host, 'DueDate');
    expect(chip.draggable).toBe(true);
    const payload: Record<string, string> = {};
    const ev = new Event('dragstart');
    (ev as unknown as { dataTransfer: unknown }).dataTransfer = {
      setData: (mime: string, v: string) => { payload[mime] = v; },
      effectAllowed: '',
    };
    chip.dispatchEvent(ev);
    expect(payload).toEqual({ [FIELD_MIME]: 'DueDate' });
  });
});

describe('click-to-insert (the active surface, at the selection)', () => {
  it('on the grid: a NEW ROOT COLUMN, dressed when the column wears a look — one undo step', () => {
    const host = mount();
    expect(state.doc.kind).toBe('grid');
    const before = state.doc.root.children!.length;
    const undoDepth = (state as unknown as { undoStack: string[] }).undoStack.length;
    // Owner wears a look but is UNPLACED by default — the showcase insert
    chipFor(host, 'Owner').click();
    const children = state.doc.root.children!;
    expect(children.length).toBe(before + 1);
    const cell = children[children.length - 1];
    expect(cell._field).toBe('Owner');
    expect(cell._component?.id).toBe('palette-persona'); // arrived DRESSED (the look embeds)
    expect((state as unknown as { undoStack: string[] }).undoStack.length).toBe(undoDepth + 1);
    state.undo();
    expect(state.doc.root.children!.length).toBe(before);
  });

  it('a bare column arrives as the plain-value cell', () => {
    const host = mount();
    chipFor(host, 'Tags').click();
    const cell = state.doc.root.children!.at(-1)!;
    expect(cell._field).toBe('Tags');
    expect(cell._component).toBeUndefined();
    expect(cell.txtContent).toBe('[$Tags]');
  });

  it('on a view: inserts at the SELECTION, like a palette click', () => {
    state.createView({ kind: 'row', root: { elmType: 'div', children: [{ elmType: 'div', children: [] }] } });
    state.select([0]);
    const host = mount();
    chipFor(host, 'DueDate').click();
    expect(state.doc.root.children![0].children![0]._field).toBe('DueDate');
    expect(state.selection).toEqual([0, 0]); // insertNode selects the arrival
  });

  it('refuses and teaches while a component workshop covers the canvas', () => {
    const toasts: string[] = [];
    const host = mount(toasts);
    state.openComponentTab('builtin-deadline-chip');
    const before = JSON.stringify(state.doc.root);
    chipFor(host, 'DueDate').click();
    expect(JSON.stringify(state.doc.root)).toBe(before); // nothing landed anywhere
    expect(toasts.some((t) => t.includes('workshop'))).toBe(true);
    state.deactivateComponentTab();
  });
});
