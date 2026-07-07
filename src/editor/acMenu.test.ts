/**
 * acMenu.test.ts — the shared IntelliSense drop-down (DOM shell, #222).
 * The pure WHAT-to-offer logic is pinned in fxSuggest.test.ts; this file pins
 * the HOW: rich row rendering, keyboard highlight, accept and click-to-insert.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { openAcMenu } from './acMenu';
import type { SuggestItem } from './fxSuggest';

const ITEMS: SuggestItem[] = [
  { insert: '@currentField', type: 'string', doc: 'This column’s value', preview: 'In Progress' },
  { insert: '@rowIndex', type: 'number', doc: 'Row position', preview: '0' },
  { insert: '[Status]' }, // a plain template row — no metadata
];

const anchor = (): HTMLElement => {
  const el = document.createElement('textarea');
  document.body.appendChild(el);
  return el;
};

beforeEach(() => { document.body.innerHTML = ''; });

describe('openAcMenu — rich rows', () => {
  it('renders insert text, type badge, doc and live preview per item', () => {
    const menu = openAcMenu(anchor(), ITEMS, () => {});
    const rows = [...menu.el.querySelectorAll<HTMLElement>('.wb-fx-acopt')];
    expect(rows).toHaveLength(3);
    expect(rows[0].querySelector('.wb-fx-ac-ins')!.textContent).toBe('@currentField');
    expect(rows[0].querySelector('.wb-fx-ac-type')!.textContent).toBe('string');
    expect(rows[0].querySelector('.wb-fx-ac-doc')!.textContent).toBe('This column’s value');
    expect(rows[0].querySelector('.wb-fx-ac-val')!.textContent).toBe('In Progress');
    // a metadata-free item stays a plain monospace row (no rich spans)
    expect(rows[2].classList.contains('wb-fx-acopt-rich')).toBe(false);
    expect(rows[2].textContent).toBe('[Status]');
    menu.close();
  });

  it('close() removes the menu from the document', () => {
    const menu = openAcMenu(anchor(), ITEMS, () => {});
    expect(document.body.contains(menu.el)).toBe(true);
    menu.close();
    expect(document.body.contains(menu.el)).toBe(false);
  });
});

describe('openAcMenu — keyboard + click', () => {
  it('starts on the first item and move() wraps both ways', () => {
    const picked: string[] = [];
    const menu = openAcMenu(anchor(), ITEMS, (v) => picked.push(v));
    expect(menu.accept()).toBe(true);
    expect(picked).toEqual(['@currentField']);
    menu.move(1);
    menu.accept();
    expect(picked[1]).toBe('@rowIndex');
    menu.move(-1);
    menu.move(-1); // wraps past the start → last item
    menu.accept();
    expect(picked[2]).toBe('[Status]');
    menu.close();
  });

  it('accept() is false with nothing to offer; click inserts the row it hits', () => {
    const empty = openAcMenu(anchor(), [], () => { throw new Error('nothing to pick'); });
    expect(empty.accept()).toBe(false);
    empty.close();

    const picked: string[] = [];
    const menu = openAcMenu(anchor(), ITEMS, (v) => picked.push(v));
    const rows = [...menu.el.querySelectorAll<HTMLButtonElement>('.wb-fx-acopt')];
    rows[1].click();
    expect(picked).toEqual(['@rowIndex']);
    menu.close();
  });
});
